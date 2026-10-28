const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// One panel at a time: reopening focuses the existing one instead of stacking
// duplicates, so the tool you had open (and whatever you'd pasted into it) is
// still there.
let panel = null;

function mediaPath(context, ...parts) {
  return vscode.Uri.joinPath(context.extensionUri, 'media', ...parts);
}

function loadCatalogue(context) {
  const file = mediaPath(context, 'tools.json').fsPath;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildHtml(context, webview) {
  const root = webview.asWebviewUri(mediaPath(context)).toString();
  const html = fs.readFileSync(mediaPath(context, 'toolbox.html').fsPath, 'utf8');

  // connect-src 'none' is the point of the whole extension: every tool runs on
  // what you paste, locally, and the CSP makes that a guarantee rather than a
  // promise - there is no origin any script here could send data to.
  // 'unsafe-inline' styles are needed for the inline style attributes the
  // tools set on results and for the <style> block Mermaid injects when it
  // renders a diagram.
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    "connect-src 'none'",
  ].join('; ');

  return html.split('%%ROOT%%').join(root).replace('%%CSP%%', csp);
}

// Markdown -> Word hands the finished .docx back here, because a webview
// can't save a file itself.
async function saveFile(message) {
  const target = await vscode.window.showSaveDialog({
    saveLabel: 'Save',
    defaultUri: vscode.Uri.file(path.join(require('os').homedir(), message.name || 'document.docx')),
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(message.data, 'base64'));
  const open = await vscode.window.showInformationMessage(
    `Saved ${path.basename(target.fsPath)}`,
    'Reveal in Explorer'
  );
  if (open) await vscode.commands.executeCommand('revealFileInOS', target);
}

function openToolbox(context, tool) {
  if (panel) {
    panel.reveal(panel.viewColumn);
  } else {
    panel = vscode.window.createWebviewPanel('devopsToolbox', 'DevOps Toolbox', vscode.ViewColumn.Active, {
      enableScripts: true,
      // Without this the webview is torn down and rebuilt whenever you tab
      // away, losing whatever you had pasted into a tool.
      retainContextWhenHidden: true,
      localResourceRoots: [mediaPath(context)],
    });
    panel.iconPath = mediaPath(context, 'icon.png');
    panel.webview.html = buildHtml(context, panel.webview);
    panel.webview.onDidReceiveMessage(
      (message) => {
        if (message && message.type === 'saveFile') saveFile(message);
      },
      undefined,
      context.subscriptions
    );
    panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);
  }
  if (tool) panel.webview.postMessage({ type: 'activate', tool });
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('devopsToolbox.open', () => openToolbox(context)),

    vscode.commands.registerCommand('devopsToolbox.openTool', async () => {
      const catalogue = loadCatalogue(context);
      // A QuickPickItem is only matched on label, description and detail, so
      // the keywords have to live in one of them to be searchable - putting
      // them in `detail` keeps the main line clean and still lets "k8s" find
      // the Kubernetes tools and "token" find the JWT one.
      const items = catalogue.map((t) => ({
        label: t.label,
        description: t.category,
        detail: t.keywords,
        id: t.id,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'DevOps Toolbox',
        placeHolder: `Search ${catalogue.length} offline tools — try "jwt", "cron", "cidr", "k8s"…`,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (picked) openToolbox(context, picked.id);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
