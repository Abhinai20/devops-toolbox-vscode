#!/usr/bin/env node
// Checks the things a Marketplace listing gets judged on BEFORE the first
// upload, because version numbers can't be reused: publish 0.1.0 with a dead
// repository link and the fix has to ship as 0.1.1.
//
// Run by `npm run publish`. Run it alone any time with `npm run preflight`.

const fs = require('fs');
const path = require('path');
const https = require('https');

const pkg = require('../package.json');

let failures = 0;
let warnings = 0;
function fail(msg, fix) {
  failures++;
  console.log(`  FAIL ${msg}${fix ? `\n       → ${fix}` : ''}`);
}
function warn(msg) {
  warnings++;
  console.log(`  warn ${msg}`);
}
function ok(msg) {
  console.log(`  ok   ${msg}`);
}

function head(url) {
  return new Promise((resolve) => {
    https
      .get(url, { method: 'GET', headers: { 'User-Agent': 'preflight' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', () => resolve(0));
  });
}

(async () => {
  console.log('\nListing');

  if (/REPLACE|YOUR_PUBLISHER/i.test(pkg.publisher)) {
    fail('publisher is still the placeholder', 'set "publisher" in package.json to your registered name');
  } else {
    const status = await head(`https://marketplace.visualstudio.com/publishers/${pkg.publisher}`);
    if (status === 200) ok(`publisher "${pkg.publisher}" is registered on the VS Code Marketplace`);
    else if (status === 0) warn(`could not reach the Marketplace to check publisher "${pkg.publisher}"`);
    else
      fail(
        `publisher "${pkg.publisher}" is not registered (HTTP ${status})`,
        'create it at https://marketplace.visualstudio.com/manage, or change "publisher"'
      );
  }

  if (pkg.repository && pkg.repository.url) {
    const status = await head(pkg.repository.url);
    if (status === 200) ok('repository URL resolves');
    else if (status === 0) warn('could not reach the repository URL');
    else
      fail(
        `repository URL 404s (${pkg.repository.url})`,
        'push the repo, make it public, or remove "repository" from package.json'
      );
  }

  if (pkg.homepage) {
    const status = await head(pkg.homepage);
    if (status === 200) ok('homepage URL resolves');
    else if (status !== 0) warn(`homepage returned HTTP ${status}`);
  }

  console.log('\nPackage');

  // The Marketplace requires at least 128x128. Read it straight out of the
  // PNG's IHDR rather than trusting the generator.
  const icon = fs.readFileSync(path.resolve(__dirname, '..', pkg.icon));
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  if (width >= 128 && height >= 128) ok(`icon is ${width}x${height}`);
  else fail(`icon is ${width}x${height}, the Marketplace requires at least 128x128`);

  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  // Relative image paths break on the Marketplace, which renders the README
  // from its own origin.
  const relativeImages = [...readme.matchAll(/!\[[^\]]*\]\((?!https?:)([^)]+)\)/g)].map((m) => m[1]);
  if (relativeImages.length) {
    fail(`README has relative image links that won't render: ${relativeImages.join(', ')}`, 'use absolute https URLs');
  } else ok('README has no relative image links');

  if (/<!-- TOOLS:START -->\s*<!-- TOOLS:END -->/.test(readme)) {
    fail('the README tool list is empty', 'run npm run build');
  } else ok('README tool list is populated');

  const changelog = fs.readFileSync(path.resolve(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  if (changelog.includes(pkg.version)) ok(`CHANGELOG mentions ${pkg.version}`);
  else warn(`CHANGELOG has no entry for ${pkg.version}`);

  console.log(
    failures
      ? `\n${failures} blocker(s)${warnings ? `, ${warnings} warning(s)` : ''} — not safe to publish\n`
      : `\nReady to publish${warnings ? ` (${warnings} warning(s))` : ''}\n`
  );
  process.exit(failures ? 1 : 0);
})();
