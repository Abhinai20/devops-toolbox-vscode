#!/usr/bin/env node
// Renders media/toolbox.html into a plain browser-loadable page so the whole
// toolbox can be smoke-tested in a real browser without installing the
// extension. Stubs the two things only VS Code provides: acquireVsCodeApi()
// and the body theme class.
//
//   node build/harness.js && npx --yes http-server media -p 8099
//   -> http://localhost:8099/harness.html

const fs = require('fs');
const path = require('path');

const MEDIA = path.resolve(__dirname, '..', 'media');
const html = fs.readFileSync(path.join(MEDIA, 'toolbox.html'), 'utf8');

const stub = `<script>
window.acquireVsCodeApi = function () {
  return {
    postMessage: function (m) { console.log('[harness] postMessage', JSON.stringify(m).slice(0, 200)); },
    getState: function () { return null; },
    setState: function () {},
  };
};
document.addEventListener('DOMContentLoaded', function () { document.body.classList.add('vscode-dark'); });
</script>`;

const out = html
  .split('%%ROOT%%')
  .join('.')
  // The harness runs on http://localhost, where the extension's CSP source
  // (vscode-webview://...) means nothing. Everything is local either way.
  .replace('%%CSP%%', "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'")
  .replace('<body>', '<body>\n' + stub);

fs.writeFileSync(path.join(MEDIA, 'harness.html'), out);
console.log('Wrote media/harness.html (test only - excluded from the package)');
