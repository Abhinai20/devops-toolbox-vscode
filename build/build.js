#!/usr/bin/env node
// Generates media/toolbox.html from the live DevOps Toolbox website.
//
// The website is the single source of truth: every tool panel, the sidebar
// nav and all the logic in app.js are read straight out of
// ../abhinai20.github.io/devops-toolbox/ and reassembled into ONE document.
// The site ships one panel per page (each tools/*.html holds its own
// <section class="tool-panel">), but app.js has always had the single-page
// switching logic for all of them - activateTool() just needs every panel
// present in the same DOM. That is exactly what this build produces, so the
// extension gets the full toolbox with no forked copy of any tool's code.
//
// Re-run after changing anything on the website: `npm run build`.

const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..', '..', 'abhinai20.github.io', 'devops-toolbox');
const OUT = path.resolve(__dirname, '..', 'media');

// Tools deliberately left out of the extension, with the reason. Each one is
// dropped from the nav, from the panel list, and from every "Related tools"
// list that points at it.
// `section` is the tool's "// ---------- Name ----------" heading in app.js;
// its code is cut out too, so the shipped bundle contains no remote endpoint
// at all. Dropping only the panel would leave unreachable fetch() calls in a
// package whose entire promise is that nothing leaves your machine.
const EXCLUDE = {
  paraphraser: {
    reason: 'calls a remote rewrite API and api.datamuse.com - the extension promises nothing leaves your machine',
    section: 'Synonym Rephraser',
  },
};

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

// Nav labels are HTML; the quick pick renders plain text.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Pull out a balanced <tag ...>...</tag> block starting at `from`, counting
// nested opens so an inner <section>/<nav> can't end the block early.
function extractBlock(html, tag, from) {
  const openRe = new RegExp(`<${tag}\\b`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 0;
  let i = from;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) throw new Error(`unterminated <${tag}> at ${from}`);
    if (open && open.index < close.index) {
      depth++;
      i = open.index + open[0].length;
    } else {
      depth--;
      i = close.index + close[0].length;
      if (depth === 0) return html.slice(from, i);
    }
  }
  throw new Error(`unterminated <${tag}> at ${from}`);
}

function extractPanel(html, file) {
  const start = html.search(/<section class="tool-panel\b/i);
  if (start === -1) return null;
  const block = extractBlock(html, 'section', start);
  const id = (block.match(/id="panel-([a-z0-9_-]+)"/i) || [])[1];
  if (!id) throw new Error(`panel in ${file} has no id="panel-..."`);
  return { id, html: block };
}

// ---------- collect every panel ----------

const panels = new Map();

const indexHtml = read(path.join(SITE, 'index.html'));
const indexPanel = extractPanel(indexHtml, 'index.html');
if (indexPanel) panels.set(indexPanel.id, indexPanel.html);

const toolFiles = fs.readdirSync(path.join(SITE, 'tools')).filter((f) => f.endsWith('.html'));
for (const file of toolFiles) {
  const panel = extractPanel(read(path.join(SITE, 'tools', file)), file);
  if (!panel) {
    console.warn(`  ! ${file} has no tool panel - skipped`);
    continue;
  }
  if (panels.has(panel.id) && panels.get(panel.id) !== panel.html) {
    throw new Error(`two different panels both claim id="panel-${panel.id}"`);
  }
  panels.set(panel.id, panel.html);
}

// ---------- nav ----------

const navStart = indexHtml.search(/<nav class="tool-nav\b/i);
if (navStart === -1) throw new Error('no <nav class="tool-nav"> in index.html');
let nav = extractBlock(indexHtml, 'nav', navStart);

// The class is "tab-btn" on every tool but the one the page opens on, which
// is "tab-btn active" - match the prefix, or that tool silently vanishes.
const navTools = [...nav.matchAll(/<a class="tab-btn[^"]*"[^>]*data-tool="([a-z0-9_-]+)"/gi)].map((m) => m[1]);

// Drop excluded tools from the nav, then any category left empty by that.
for (const tool of Object.keys(EXCLUDE)) {
  nav = nav.replace(new RegExp(`\\s*<a class="tab-btn[^"]*"[^>]*data-tool="${tool}"[^>]*>.*?</a>`, 'gi'), '');
}
nav = nav.replace(/\s*<details class="nav-group"[^>]*>\s*<summary[^>]*>[^<]*<\/summary>\s*<\/details>/gi, '');

const included = navTools.filter((t) => !EXCLUDE[t] && panels.has(t));
const missing = navTools.filter((t) => !EXCLUDE[t] && !panels.has(t));
if (missing.length) throw new Error(`nav links with no panel: ${missing.join(', ')}`);
// And the other direction: a panel the nav never links to is unreachable, so
// the build would quietly ship fewer tools than the website has.
const orphans = [...panels.keys()].filter((t) => !EXCLUDE[t] && !navTools.includes(t));
if (orphans.length) throw new Error(`panels with no nav link: ${orphans.join(', ')}`);

// The site's nav links are real page URLs. app.js intercepts a click, calls
// activateTool() and only calls preventDefault() when a matching panel exists
// - with every panel in the document that is always true, so the href is
// never followed. It still has to stay a real .html name: the click handler
// derives the tool id from the filename for "Related tools" links.
// Normalise the class too: the website's "active" tab is whichever page you
// loaded, which is meaningless here - the extension decides its own.
nav = nav.replace(/<a class="tab-btn[^"]*"([^>]*)href="[^"]*"/gi, '<a class="tab-btn"$1href="#"');
nav = nav.replace(
  new RegExp(`<a class="tab-btn"([^>]*data-tool="${included[0]}")`, 'i'),
  '<a class="tab-btn active"$1'
);
// The brand logo is the one nav link with no panel behind it.
nav = nav.replace(/<a href="\/" class="logo">([\s\S]*?)<\/a>/i, '<span class="logo">$1</span>');
nav = nav.replace(/(<span class="nav-badge">[\s\S]*?<b>)\d+(<\/b>)/i, `$1${included.length}$2`);
nav = nav.replace(
  /(<p class="tagline">)[^<]*(<\/p>)/i,
  '$1Every tool runs locally inside VS Code — nothing you paste leaves your machine.$2'
);

// ---------- tool index, for the "Open Tool…" quick pick ----------

// Read the labels/keywords/categories off the nav itself so the quick pick
// can never drift out of sync with what the webview actually contains.
const catalogue = [];
{
  const groupRe = /<details class="nav-group"[^>]*>\s*<summary[^>]*>([^<]*)<\/summary>([\s\S]*?)<\/details>/gi;
  let group;
  while ((group = groupRe.exec(nav))) {
    const category = decodeEntities(group[1].trim());
    const linkRe = /<a class="tab-btn[^"]*"[^>]*data-tool="([a-z0-9_-]+)"[^>]*data-kw="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    let link;
    while ((link = linkRe.exec(group[2]))) {
      catalogue.push({
        id: link[1],
        label: decodeEntities(link[3].trim()),
        category,
        keywords: link[2].trim(),
      });
    }
  }
}
if (catalogue.length !== included.length) {
  throw new Error(`catalogue has ${catalogue.length} tools but ${included.length} are in the nav`);
}

// ---------- panels, in nav order ----------

const body = included
  .map((tool, i) => {
    let html = panels.get(tool);
    // Exactly one panel starts visible.
    html = html.replace(/^(<section class="tool-panel)(\s+active)?"/i, i === 0 ? '$1 active"' : '$1"');
    // A "Related tools" link to an excluded tool would find no panel, so
    // app.js would let the browser follow a dead href. Drop those entries.
    for (const tool2 of Object.keys(EXCLUDE)) {
      html = html.replace(new RegExp(`<li><a href="[^"]*${tool2}\\.html">[^<]*</a></li>`, 'gi'), '');
    }
    html = html.replace(/<div class="related-tools"><h2>[^<]*<\/h2><ul>\s*<\/ul><\/div>/gi, '');
    return html;
  })
  .join('\n\n');

// ---------- assemble ----------

const shim = `
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
`.trim();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="%%CSP%%">
<title>DevOps Toolbox</title>
<link rel="stylesheet" href="%%ROOT%%/style.css">
</head>
<body>

<div class="layout">
${nav}

<main>
${body}
</main>
</div>

<script src="%%ROOT%%/vendor/js-yaml.min.js"></script>
<script src="%%ROOT%%/vendor/marked.umd.min.js"></script>
<script src="%%ROOT%%/vendor/html-docx.js"></script>
<script src="%%ROOT%%/vendor/mermaid.min.js"></script>
<script src="%%ROOT%%/shim.js"></script>
<script src="%%ROOT%%/app.js"></script>
</body>
</html>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'toolbox.html'), html);
fs.writeFileSync(path.join(OUT, 'shim.js'), shim + '\n');
// app.js ships whole except for the excluded tools' own sections, which are
// cut between their "// ---------- Name ----------" heading and the next one.
let appJs = read(path.join(SITE, 'assets', 'app.js'));
for (const [tool, { section }] of Object.entries(EXCLUDE)) {
  if (!section) continue;
  const headingRe = new RegExp(`^// -{5,} ${section} -{5,}$`, 'm');
  const start = appJs.search(headingRe);
  if (start === -1) throw new Error(`no "// ---------- ${section} ----------" heading in app.js for ${tool}`);
  const after = appJs.slice(start).search(/^\/\/ -{5,} .+ -{5,}$/m);
  const next = appJs.slice(start + after + 1).search(/^\/\/ -{5,} .+ -{5,}$/m);
  if (next === -1) throw new Error(`${section} is the last section in app.js - nothing marks where it ends`);
  appJs = appJs.slice(0, start) + appJs.slice(start + after + 1 + next);
}
fs.writeFileSync(path.join(OUT, 'app.js'), appJs);
fs.copyFileSync(path.join(SITE, 'assets', 'style.css'), path.join(OUT, 'style.css'));
fs.writeFileSync(path.join(OUT, 'tools.json'), JSON.stringify(catalogue, null, 2) + '\n');

// The README is the Marketplace listing, so its tool list is generated from
// the same catalogue rather than hand-maintained - a listing that promises a
// tool the package doesn't have is the one bug users see first.
const readmeFile = path.resolve(__dirname, '..', 'README.md');
if (fs.existsSync(readmeFile)) {
  const byCategory = new Map();
  for (const tool of catalogue) {
    if (!byCategory.has(tool.category)) byCategory.set(tool.category, []);
    byCategory.get(tool.category).push(tool.label);
  }
  const list = [...byCategory]
    .map(([category, labels]) => `**${category}** — ${labels.join(' · ')}`)
    .join('\n\n');
  const readme = read(readmeFile).replace(
    /<!-- TOOLS:START -->[\s\S]*?<!-- TOOLS:END -->/,
    `<!-- TOOLS:START -->\n${list}\n<!-- TOOLS:END -->`
  );
  fs.writeFileSync(readmeFile, readme);
}

console.log(`Built media/toolbox.html — ${included.length} tools`);
for (const [tool, why] of Object.entries(EXCLUDE)) console.log(`  excluded ${tool}: ${why}`);
