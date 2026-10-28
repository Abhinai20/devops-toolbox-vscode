// --- VS Code webview shim (added by build.js, not part of the website) ---
// 1. A webview document has no navigable history; app.js calls pushState on
//    every tool switch to keep the website's URL in sync, which throws here.
//    activateTool() does the actual switching and runs before this, so making
//    these no-ops costs the extension nothing.
history.pushState = function () {};
history.replaceState = function () {};
// 2. Follow the editor's theme on first open. VS Code puts vscode-light /
//    vscode-high-contrast-light on <body>; the site is dark by default and
//    reads its own saved choice from localStorage, which still wins.
(function () {
  var stored = null;
  try { stored = localStorage.getItem('toolbox-theme'); } catch (e) { /* storage blocked */ }
  if (stored === 'light' || stored === 'dark') return;
  if (document.body.classList.contains('vscode-light')
    || document.body.classList.contains('vscode-high-contrast-light')) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
// 3. The "Open Tool..." quick pick asks the webview to switch tools. Clicking
//    the nav button reuses app.js's own handler rather than duplicating it.
window.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'activate') return;
  var btn = document.querySelector('.tab-btn[data-tool="' + e.data.tool + '"]');
  if (btn) btn.click();
});
// 4. Markdown -> Word builds a Blob and clicks a download link. Webviews
//    block downloads, so hand the file to the extension host instead, which
//    opens a real Save dialog.
(function () {
  if (typeof URL.createObjectURL !== 'function') return; // no Blob URLs here
  var vscode = acquireVsCodeApi();
  var lastBlob = null;
  var realCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    lastBlob = blob;
    return realCreate(blob);
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[download]');
    if (!a || !lastBlob) return;
    e.preventDefault();
    var name = a.getAttribute('download') || 'document.docx';
    var blob = lastBlob;
    lastBlob = null;
    blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var binary = '';
      for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      vscode.postMessage({ type: 'saveFile', name: name, data: btoa(binary) });
    });
  }, true);
})();
