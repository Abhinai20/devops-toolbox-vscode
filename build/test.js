#!/usr/bin/env node
// Smoke test: loads the built webview document in a real DOM, checks it comes
// up clean, that tool switching works, and that a sample of tools spanning the
// different categories still produce correct output after the build's
// rewrites. Run with `npm test`.

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const MEDIA = path.resolve(__dirname, '..', 'media');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Mermaid is a 3.5MB browser bundle that needs a layout engine jsdom doesn't
// have. The build already proves the file is wired in; stub it so the rest of
// app.js can be exercised.
const SKIP_VENDOR = new Set(['mermaid.min.js']);

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => errors.push(e.message));
virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

let html = fs.readFileSync(path.join(MEDIA, 'toolbox.html'), 'utf8');
html = html.split('%%ROOT%%').join('.').replace('%%CSP%%', "default-src 'none'");
// Inline every local script so jsdom doesn't need a web server.
html = html.replace(/<script src="\.\/([^"]+)"><\/script>/g, (full, rel) => {
  const file = path.basename(rel);
  if (SKIP_VENDOR.has(file)) return '<script>window.mermaid = { initialize() {}, render: async () => ({ svg: "<svg/>" }) };</script>';
  const code = fs.readFileSync(path.join(MEDIA, rel), 'utf8');
  return `<script>\n${code}\n</script>`;
});
// The shim calls this; the real one is injected by VS Code.
html = html.replace('<body>', '<body>\n<script>window.acquireVsCodeApi = () => ({ postMessage() {}, getState: () => null, setState() {} });</script>');

const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, url: 'https://localhost/' });
const { window } = dom;
const doc = window.document;
const $ = (sel) => doc.querySelector(sel);

console.log('\nDocument');
check('loads with no script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const catalogue = JSON.parse(fs.readFileSync(path.join(MEDIA, 'tools.json'), 'utf8'));
check(
  `all ${catalogue.length} tools have a nav button and a panel`,
  catalogue.every((t) => $(`.tab-btn[data-tool="${t.id}"]`) && doc.getElementById(`panel-${t.id}`))
);
check('exactly one panel starts visible', doc.querySelectorAll('.tool-panel.active').length === 1);
// Only the files the build itself produces - a loose pattern over the whole
// inlined document matches harmless things in vendor bundles (lodash's
// "toStringTag" contains "gtag").
const built = ['toolbox.html', 'app.js', 'shim.js']
  .map((f) => fs.readFileSync(path.join(MEDIA, f), 'utf8'))
  .join('\n');
check('no AdSense or analytics survived the build', !/googlesyndication|google-analytics|googletagmanager|gtag\(/i.test(built));
check('no remote script or style is referenced', !/<(script|link)[^>]+(src|href)="https?:/i.test(built));
// A blanket ban on the word "fetch" can't work: the cURL -> Code generator
// emits `fetch(...)` as output text. Assert the two things that actually
// decide it - no remote host is named anywhere, and the webview's CSP leaves
// no origin to reach even if one were.
const appJs = fs.readFileSync(path.join(MEDIA, 'app.js'), 'utf8');
check('no remote endpoint is referenced', !/datamuse|workers\.dev|googleapis|pagead|cdn\.jsdelivr/i.test(appJs));
check('the excluded tool\'s code is gone too', !/REPHRASE_ENDPOINT/.test(appJs));
check('the webview CSP blocks every network origin', /connect-src 'none'/.test(
  fs.readFileSync(path.resolve(__dirname, '..', 'src', 'extension.js'), 'utf8')
));

console.log('\nTool switching');
function activate(tool) {
  const btn = $(`.tab-btn[data-tool="${tool}"]`);
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return doc.getElementById(`panel-${tool}`).classList.contains('active');
}
check('clicking a nav button shows that panel', activate('jwt'));
check('only one panel is visible after switching', doc.querySelectorAll('.tool-panel.active').length === 1);
check('a "Related tools" link switches panels too', (() => {
  const link = doc.querySelector('#panel-jwt .related-tools a');
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return doc.querySelectorAll('.tool-panel.active').length === 1;
})());
check('the quick pick\'s activate message switches panels', (() => {
  window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'activate', tool: 'cidr' } }));
  return doc.getElementById('panel-cidr').classList.contains('active');
})());

console.log('\nTools');
function run(tool, inputs, buttonId, resultId) {
  activate(tool);
  for (const [id, value] of Object.entries(inputs)) {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`no input #${id}`);
    el.value = value;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  doc.getElementById(buttonId).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return (doc.getElementById(resultId).textContent || '').trim();
}

// A valid 24-bit network: broadcast and host count are arithmetic, so a wrong
// answer here means the build broke the tool rather than the environment.
try {
  const out = run('cidr', { 'cidr-input': '10.20.30.0/24' }, 'cidr-calc-btn', 'cidr-result');
  check('CIDR calculator computes 10.20.30.0/24', /10\.20\.30\.255/.test(out) && /254/.test(out), out.slice(0, 120));
} catch (e) { check('CIDR calculator runs', false, e.message); }

// Signed with the HS256 example from jwt.io; only the decode is checked.
try {
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const out = run('jwt', { 'jwt-input': token }, 'jwt-decode-btn', 'jwt-result');
  check('JWT decoder reads the payload', /John Doe/.test(out) && /HS256/.test(out), out.slice(0, 120));
} catch (e) { check('JWT decoder runs', false, e.message); }

try {
  const out = run('yaml', { 'yaml-input': 'a: 1\nb: [2, 3]\n' }, 'yaml-check-btn', 'yaml-result');
  check('YAML validator accepts valid YAML', /valid/i.test(out), out.slice(0, 120));
  const bad = run('yaml', { 'yaml-input': 'a: 1\n  b: 2\n' }, 'yaml-check-btn', 'yaml-result');
  check('YAML validator rejects bad indentation', !/^valid/i.test(bad) && bad.length > 0, bad.slice(0, 120));
} catch (e) { check('YAML validator runs', false, e.message); }

try {
  const out = run('chmod', { 'chmod-octal': '755' }, 'chmod-to-symbolic-btn', 'chmod-result');
  check('chmod calculator expands 755', /rwxr-xr-x/.test(out), out.slice(0, 120));
} catch (e) { check('chmod calculator runs', false, e.message); }

try {
  const out = run('cron', { 'cron-input': '0 9 * * 1-5' }, 'cron-explain-btn', 'cron-result');
  check('cron explainer reads "0 9 * * 1-5"', /9/.test(out) && /mon/i.test(out), out.slice(0, 120));
} catch (e) { check('cron explainer runs', false, e.message); }

console.log('\nRuntime');
check('no errors logged while running the tools', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
