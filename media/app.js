// ---------- Tab switching ----------
// Nav items are real <a href> tags (each tool has its own crawlable page
// under /tools/) so search engines can discover and index them individually.
// For users with JS, clicks are intercepted to switch instantly in-page
// instead of reloading, and the URL bar is updated via pushState so the
// address stays shareable/bookmarkable.
//
// IMPORTANT: relative hrefs must always be resolved against the page's
// stable <link rel="canonical"> URL, NEVER against window.location. After
// one pushState, window.location no longer matches the physically loaded
// document (it's still the same DOM, just a spoofed address), so resolving
// the *next* relative href against it drifts further with every click -
// e.g. clicking several tools in a row from index.html would accumulate
// "/tools/tools/tools/..." forever, since each click's relative "tools/x.html"
// href got re-resolved against the previous click's already-fake location.
// The canonical link never changes, so anchoring to it keeps every computed
// URL correct no matter how many in-page switches happen first.
const CANONICAL_BASE = (document.querySelector('link[rel="canonical"]') || {}).href || window.location.href;
function activateTool(tool) {
  const targetBtn = document.querySelector(`.tab-btn[data-tool="${tool}"]`);
  const targetPanel = document.getElementById('panel-' + tool);
  if (!targetBtn || !targetPanel) return false;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tool-panel').forEach((p) => p.classList.remove('active'));
  targetBtn.classList.add('active');
  targetPanel.classList.add('active');
  return true;
}
// pushState/replaceState throw a SecurityError if given a URL whose origin
// doesn't match the document's actual origin (e.g. testing on localhost
// while the canonical tag hardcodes the production domain). Passing a
// path-only string (no scheme/host) sidesteps this entirely - browsers
// always resolve a path-only history URL against the current page's own
// origin, so it's correct in production AND safe to test locally.
function toSameOriginPath(href) {
  const resolved = new URL(href, CANONICAL_BASE);
  return resolved.pathname + resolved.search + resolved.hash;
}
(() => {
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn) history.replaceState({ tool: activeBtn.dataset.tool }, '', toSameOriginPath(window.location.href));
})();
document.querySelectorAll('.tab-btn, .related-tools a').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const href = btn.getAttribute('href');
    const tool = btn.dataset.tool;
    if (!href) return;
    const targetPath = toSameOriginPath(href);
    // .related-tools links don't carry data-tool; derive it from the filename.
    const targetTool = tool
      || (/(^|\/)index\.html$|^\.\.\/?$|\/$/i.test(href) ? 'yaml' : null)
      || (href.match(/([a-z0-9]+)\.html$/i) || [])[1]
      || null;
    if (!targetTool || !activateTool(targetTool)) return; // no matching panel on this page (shouldn't happen) - let the real link navigate
    e.preventDefault();
    if (targetPath !== window.location.pathname + window.location.search + window.location.hash) {
      history.pushState({ tool: targetTool }, '', targetPath);
    }
  });
});
window.addEventListener('popstate', (e) => {
  const tool = e.state && e.state.tool;
  if (!tool) return;
  activateTool(tool);
});
// (Categories default to open so every tool is always reachable in one
// click; each can still be individually collapsed via its <summary> to
// tidy up, but opening one never hides another.)

// ---------- Universal Clear buttons ----------
document.querySelectorAll('.clear-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panel = document.getElementById('panel-' + btn.dataset.clear);
    if (!panel) return;
    panel.querySelectorAll('textarea, input[type="text"], input[type="datetime-local"]').forEach((el) => {
      el.value = '';
    });
    panel.querySelectorAll('select').forEach((el) => { el.selectedIndex = 0; });
    panel.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = false; });
    panel.querySelectorAll('.mode-btn-row').forEach((group) => {
      const buttons = group.querySelectorAll('.mode-btn');
      buttons.forEach((b) => b.classList.remove('active'));
      if (buttons[0]) buttons[0].classList.add('active');
    });
    panel.querySelectorAll('.result-box').forEach((box) => {
      box.className = box.className
        .split(' ')
        .filter((c) => c !== 'result-success' && c !== 'result-error')
        .concat('result-idle')
        .filter((c, i, arr) => arr.indexOf(c) === i)
        .join(' ');
      box.textContent = 'Cleared.';
    });
  });
});

// Null-safe event binding. Every tool page now ships ONLY its own panel, so
// most element ids are absent on any given page - a bare
// document.getElementById('x').addEventListener(...) would throw and halt the
// rest of this file. bind() simply does nothing when the element isn't here.
function bind(id, type, handler, options) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(type, handler, options);
}

// ---------- YAML Validator ----------
bind('yaml-check-btn', 'click', () => {
  const input = document.getElementById('yaml-input').value;
  const resultEl = document.getElementById('yaml-result');

  if (!input.trim()) {
    resultEl.className = 'result-box result-idle';
    resultEl.textContent = 'Paste some YAML first.';
    return;
  }

  try {
    // Support multi-document YAML (---) separated files, common in k8s manifests
    const docs = jsyaml.loadAll(input);
    resultEl.className = 'result-box result-success';
    const docCount = docs.length;
    resultEl.textContent =
      `Valid YAML — ${docCount} document${docCount === 1 ? '' : 's'} parsed successfully.\n\n` +
      JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2);
  } catch (e) {
    resultEl.className = 'result-box result-error';
    let msg = e.message || String(e);
    // js-yaml errors already include line/column info in the message
    resultEl.textContent = 'Invalid YAML:\n\n' + msg;
  }
});

// ---------- Terraform Plan Formatter ----------
bind('tf-format-btn', 'click', () => {
  const input = document.getElementById('tf-input').value;
  const resultEl = document.getElementById('tf-result');

  if (!input.trim()) {
    resultEl.className = 'result-box result-idle tf-output';
    resultEl.textContent = 'Paste a terraform plan first.';
    return;
  }

  const lines = input.split('\n');
  const frag = document.createDocumentFragment();

  lines.forEach((line) => {
    const span = document.createElement('span');
    const trimmed = line.trimStart();

    if (trimmed.startsWith('-/+') || trimmed.startsWith('+/-')) {
      span.className = 'tf-line-replace';
    } else if (trimmed.startsWith('+')) {
      span.className = 'tf-line-add';
    } else if (trimmed.startsWith('-')) {
      span.className = 'tf-line-remove';
    } else if (trimmed.startsWith('~')) {
      span.className = 'tf-line-change';
    } else {
      span.className = 'tf-line-plain';
    }
    span.textContent = line + '\n';
    frag.appendChild(span);
  });

  resultEl.className = 'result-box result-success tf-output';
  resultEl.innerHTML = '';
  resultEl.appendChild(frag);
});

// ---------- Cron Explainer ----------
// Minimal, dependency-free 5-field cron parser (minute hour dom month dow).
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function describeField(field, unitSingular, names, offset) {
  offset = offset || 0;
  if (field === '*') return null; // "every" - contributes nothing to the sentence
  const parts = field.split(',').map((p) => p.trim());
  const described = parts.map((part) => {
    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const base = range === '*' ? `every ${step} ${unitSingular}(s)` : `every ${step} ${unitSingular}(s) starting at ${range}`;
      return base;
    }
    if (part.includes('-')) {
      const [start, end] = part.split('-');
      const s = names ? names[(parseInt(start, 10) + offset) % names.length] : start;
      const e = names ? names[(parseInt(end, 10) + offset) % names.length] : end;
      return `${s} through ${e}`;
    }
    return names ? names[(parseInt(part, 10) + offset) % names.length] : part;
  });
  return described.join(', ');
}

function explainCron(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}. Example: "30 6 * * 1,4"`);
  }
  const [minute, hour, dom, month, dow] = fields;

  const isSimpleNumber = (f) => /^\d+$/.test(f);

  let timePart;
  if (minute === '*' && hour === '*') {
    timePart = 'every minute';
  } else if (isSimpleNumber(minute) && isSimpleNumber(hour)) {
    // The common, friendly case: a single fixed time - format as 12-hour clock.
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    timePart = `at ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  } else if (hour === '*') {
    const minDesc = describeField(minute, 'minute') || `minute ${minute}`;
    timePart = `at ${minDesc} of every hour`;
  } else {
    // Hour and/or minute is a list, range, or step (e.g. "9-17", "*/2") -
    // describe both in plain 24-hour terms rather than risk a wrong 12-hour
    // conversion on a range.
    const minDesc = isSimpleNumber(minute) ? `minute ${minute}` : (describeField(minute, 'minute') || 'minute 0');
    const hourDesc = describeField(hour, 'hour') || `hour ${hour}`;
    timePart = `at ${minDesc}, during hour(s) ${hourDesc} (24-hour clock)`;
  }

  const domDesc = describeField(dom, 'day');
  const monthDesc = describeField(month, 'month', MONTH_NAMES, -1);
  const dowDesc = describeField(dow, 'day', DOW_NAMES);

  let dayPart;
  if (!domDesc && !dowDesc) {
    dayPart = 'every day';
  } else if (dowDesc && !domDesc) {
    dayPart = `on ${dowDesc}`;
  } else if (domDesc && !dowDesc) {
    dayPart = `on day ${domDesc} of the month`;
  } else {
    dayPart = `on day ${domDesc} of the month AND on ${dowDesc}`;
  }

  let sentence = `Runs ${timePart}, ${dayPart}`;
  if (monthDesc) sentence += `, in ${monthDesc}`;
  return sentence + '.';
}

bind('cron-explain-btn', 'click', () => {
  const input = document.getElementById('cron-input').value;
  const resultEl = document.getElementById('cron-result');

  if (!input.trim()) {
    resultEl.className = 'result-box result-idle';
    resultEl.textContent = 'Enter a cron expression first.';
    return;
  }

  try {
    const explanation = explainCron(input);
    resultEl.className = 'result-box result-success';
    resultEl.textContent = explanation;
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Could not parse: ' + e.message;
  }
});

// Explain the default example on load
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cron-explain-btn')?.click();
});

// ---------- Markdown to Word ----------
bind('md-convert-btn', 'click', () => {
  const input = document.getElementById('md-input').value;
  const previewEl = document.getElementById('md-preview');

  if (!input.trim()) {
    previewEl.className = 'result-box result-idle md-preview';
    previewEl.textContent = 'Paste some Markdown first.';
    return;
  }

  let bodyHtml;
  try {
    bodyHtml = marked.parse(input);
  } catch (e) {
    previewEl.className = 'result-box result-error';
    previewEl.textContent = 'Could not parse Markdown: ' + e.message;
    return;
  }

  previewEl.className = 'result-box result-success md-preview';
  previewEl.innerHTML = bodyHtml;

  // html-docx-js needs a full HTML document string, not just a fragment.
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`;

  try {
    const converted = htmlDocx.asBlob(fullHtml);
    const url = URL.createObjectURL(converted);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    previewEl.className = 'result-box result-error md-preview';
    previewEl.textContent = 'Preview generated, but the .docx download failed: ' + e.message;
  }
});

// ---------- Shared helpers ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseAsJsonOrYaml(text) {
  try {
    return { data: JSON.parse(text), from: 'json' };
  } catch (e) {
    try {
      return { data: jsyaml.load(text), from: 'yaml' };
    } catch (e2) {
      throw new Error('Could not parse as JSON or YAML: ' + e2.message);
    }
  }
}

// ---------- JSON <-> YAML ----------
bind('jy-to-yaml-btn', 'click', () => {
  const resultEl = document.getElementById('jy-result');
  try {
    const { data } = parseAsJsonOrYaml(document.getElementById('jy-input').value);
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = jsyaml.dump(data);
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = e.message;
  }
});
bind('jy-to-json-btn', 'click', () => {
  const resultEl = document.getElementById('jy-result');
  try {
    const { data } = parseAsJsonOrYaml(document.getElementById('jy-input').value);
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = e.message;
  }
});

// ---------- Kubernetes Manifest Analyzer ----------
function findContainers(obj, path, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => findContainers(item, `${path}[${i}]`, out));
    return;
  }
  for (const key of Object.keys(obj)) {
    if ((key === 'containers' || key === 'initContainers') && Array.isArray(obj[key])) {
      obj[key].forEach((c, i) => out.push({ container: c, path: `${path}.${key}[${i}]` }));
    } else {
      findContainers(obj[key], `${path}.${key}`, out);
    }
  }
}
bind('k8s-lint-btn', 'click', () => {
  const resultEl = document.getElementById('k8s-result');
  let manifest;
  try {
    manifest = jsyaml.load(document.getElementById('k8s-input').value);
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Invalid YAML: ' + e.message;
    return;
  }
  if (!manifest || typeof manifest !== 'object') {
    resultEl.className = 'result-box result-idle';
    resultEl.textContent = 'Nothing to analyze.';
    return;
  }
  const findings = [];
  const containers = [];
  findContainers(manifest, '$', containers);

  if (manifest?.spec?.hostNetwork === true || manifest?.spec?.template?.spec?.hostNetwork === true) {
    findings.push('⚠️ hostNetwork is enabled — the pod shares the host\'s network namespace, a real security exposure.');
  }

  if (containers.length === 0) {
    findings.push('ℹ️ No containers found in this manifest (this analyzer looks for spec.containers or spec.template.spec.containers).');
  }

  containers.forEach(({ container: c, path }) => {
    const name = c.name || path;
    const image = c.image || '';
    if (!image) {
      findings.push(`⚠️ [${name}] No image specified.`);
    } else if (image.endsWith(':latest') || !image.includes(':')) {
      findings.push(`⚠️ [${name}] Image "${image}" uses (or defaults to) the :latest tag — deployments become non-reproducible. Pin a specific version or digest.`);
    }
    if (!c.resources || !c.resources.limits) {
      findings.push(`⚠️ [${name}] No resource limits set — this container can consume unbounded CPU/memory on the node.`);
    }
    if (!c.resources || !c.resources.requests) {
      findings.push(`ℹ️ [${name}] No resource requests set — the scheduler can't make good bin-packing decisions for this pod.`);
    }
    if (!c.livenessProbe) {
      findings.push(`ℹ️ [${name}] No livenessProbe — Kubernetes can't detect and restart this container if it hangs.`);
    }
    if (!c.readinessProbe) {
      findings.push(`ℹ️ [${name}] No readinessProbe — traffic may be sent to this container before it's actually ready.`);
    }
    const sc = c.securityContext || {};
    if (sc.privileged === true) {
      findings.push(`⚠️ [${name}] Container runs privileged=true — full access to the host, avoid unless absolutely required.`);
    }
    if (sc.runAsNonRoot !== true && sc.runAsUser !== undefined && sc.runAsUser !== 0) {
      // has explicit non-root user, fine - no finding
    } else if (sc.runAsNonRoot !== true) {
      findings.push(`ℹ️ [${name}] runAsNonRoot is not set to true — this container may run as root by default.`);
    }
  });

  if (findings.length === 0) {
    resultEl.className = 'result-box result-success';
    resultEl.textContent = 'No issues found by these checks. (This is a lightweight linter, not a substitute for a full policy engine like kube-linter or OPA Gatekeeper.)';
  } else {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = findings.join('\n\n');
  }
});

// ---------- Dockerfile Checker ----------
bind('docker-lint-btn', 'click', () => {
  const input = document.getElementById('docker-input').value;
  const resultEl = document.getElementById('docker-result');
  if (!input.trim()) {
    resultEl.className = 'result-box result-idle';
    resultEl.textContent = 'Paste a Dockerfile first.';
    return;
  }
  // Join line continuations (trailing backslash) before splitting into instructions
  const joined = input.replace(/\\\s*\n/g, ' ');
  const lines = joined.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  const findings = [];
  let hasUser = false, hasHealthcheck = false, runCount = 0, fromCount = 0;

  lines.forEach((line) => {
    const upper = line.toUpperCase();
    if (upper.startsWith('FROM')) {
      fromCount++;
      const imageRef = line.split(/\s+/)[1] || '';
      if (imageRef.endsWith(':latest') || (!imageRef.includes(':') && !imageRef.includes('@'))) {
        findings.push(`⚠️ "${line}" — base image has no pinned tag (or uses :latest). Builds become non-reproducible over time.`);
      }
    }
    if (upper.startsWith('USER')) {
      hasUser = true;
      if (/^USER\s+root\b/i.test(line) || /^USER\s+0\b/.test(line)) {
        findings.push(`⚠️ "${line}" — explicitly runs as root.`);
      }
    }
    if (upper.startsWith('HEALTHCHECK')) hasHealthcheck = true;
    if (upper.startsWith('RUN')) {
      runCount++;
      if (/apt-get install/i.test(line) && !/--no-install-recommends/i.test(line)) {
        findings.push(`ℹ️ "${line}" — consider --no-install-recommends to keep the image smaller.`);
      }
      if (/apt-get install/i.test(line) && !/=/.test(line)) {
        findings.push(`ℹ️ "${line}" — package versions aren't pinned, so builds can silently pick up newer packages over time.`);
      }
    }
    if (upper.startsWith('ADD') && !/https?:\/\//i.test(line) && !/\.(tar|tgz|gz)\b/i.test(line)) {
      findings.push(`ℹ️ "${line}" — ADD is used for a plain local file/directory; COPY is preferred (ADD's extra behavior — URL fetch, auto-extract — isn't needed here).`);
    }
  });

  if (fromCount === 0) findings.unshift('⚠️ No FROM instruction found — is this a complete Dockerfile?');
  if (!hasUser) findings.push('⚠️ No USER instruction found — the container will run as root by default.');
  if (!hasHealthcheck) findings.push('ℹ️ No HEALTHCHECK instruction — orchestrators can\'t tell if the app inside is actually healthy, just that the process is running.');
  if (runCount > 4) findings.push(`ℹ️ ${runCount} separate RUN instructions — consider combining related ones with && to reduce the number of image layers.`);

  if (findings.length === 0) {
    resultEl.className = 'result-box result-success';
    resultEl.textContent = 'No issues found by these checks.';
  } else {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = findings.join('\n\n');
  }
});

// ---------- JWT Decoder ----------
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
bind('jwt-decode-btn', 'click', () => {
  const resultEl = document.getElementById('jwt-result');
  const token = document.getElementById('jwt-input').value.trim();
  const parts = token.split('.');
  if (parts.length < 2) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Not a valid JWT — expected 3 dot-separated parts (header.payload.signature).';
    return;
  }
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    let out = 'HEADER:\n' + JSON.stringify(header, null, 2) + '\n\nPAYLOAD:\n' + JSON.stringify(payload, null, 2);
    const dateFields = ['exp', 'iat', 'nbf'];
    const dateLines = dateFields.filter((f) => typeof payload[f] === 'number').map((f) => `  ${f}: ${new Date(payload[f] * 1000).toISOString()}`);
    if (dateLines.length) out += '\n\nTIMESTAMPS (decoded):\n' + dateLines.join('\n');
    if (payload.exp) {
      const msLeft = payload.exp * 1000 - Date.now();
      out += '\n\n' + (msLeft < 0 ? `Expired ${Math.round(-msLeft / 60000)} minute(s) ago.` : `Expires in ${Math.round(msLeft / 60000)} minute(s).`);
    }
    out += '\n\n(Signature not verified — this is a read-only decoder.)';
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = out;
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Could not decode: ' + e.message;
  }
});

// ---------- Regex Tester ----------
bind('regex-test-btn', 'click', () => {
  const resultEl = document.getElementById('regex-result');
  const pattern = document.getElementById('regex-pattern').value;
  const flags = document.getElementById('regex-flags').value;
  const text = document.getElementById('regex-text').value;
  let re;
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Invalid regex: ' + e.message;
    return;
  }
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'No matches.';
    return;
  }
  let html = '';
  let lastIndex = 0;
  matches.forEach((m) => {
    html += escapeHtml(text.slice(lastIndex, m.index));
    html += `<span class="regex-match">${escapeHtml(m[0])}</span>`;
    lastIndex = m.index + m[0].length;
  });
  html += escapeHtml(text.slice(lastIndex));
  const summary = matches.map((m, i) => {
    const groups = m.slice(1).filter((g) => g !== undefined);
    return `Match ${i + 1}: "${m[0]}" at index ${m.index}` + (groups.length ? ` — groups: ${JSON.stringify(groups)}` : '');
  }).join('\n');
  resultEl.className = 'result-box result-success';
  resultEl.innerHTML = `<div style="margin-bottom:12px; white-space:pre-wrap;">${html}</div><div style="white-space:pre-wrap; color:var(--text-muted); border-top:1px solid var(--border); padding-top:10px;">${escapeHtml(summary)}</div>`;
});

// ---------- Unix Timestamp Converter ----------
bind('ts-to-date-btn', 'click', () => {
  const resultEl = document.getElementById('ts-result');
  const raw = document.getElementById('ts-unix').value.trim();
  const ts = Number(raw);
  if (!raw || Number.isNaN(ts)) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Enter a valid Unix timestamp (seconds).';
    return;
  }
  const d = new Date(ts * 1000);
  resultEl.className = 'result-box result-success';
  resultEl.textContent = `UTC:   ${d.toUTCString()}\nISO:   ${d.toISOString()}\nLocal: ${d.toString()}`;
});
bind('ts-to-unix-btn', 'click', () => {
  const resultEl = document.getElementById('ts-result');
  const raw = document.getElementById('ts-date').value;
  if (!raw) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Pick a date/time first.';
    return;
  }
  const d = new Date(raw);
  resultEl.className = 'result-box result-success';
  resultEl.textContent = `Unix timestamp (seconds): ${Math.floor(d.getTime() / 1000)}\nUnix timestamp (ms):      ${d.getTime()}`;
});

// ---------- Timezone Converter ----------
const TIMEZONES = [
  ['UTC', 'UTC'],
  ['New York (ET)', 'America/New_York'],
  ['Los Angeles (PT)', 'America/Los_Angeles'],
  ['London (UK)', 'Europe/London'],
  ['India (IST)', 'Asia/Kolkata'],
  ['Tokyo (JST)', 'Asia/Tokyo'],
  ['Sydney (AEST/AEDT)', 'Australia/Sydney'],
];
bind('tz-convert-btn', 'click', () => {
  const resultEl = document.getElementById('tz-result');
  const raw = document.getElementById('tz-datetime').value;
  if (!raw) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Pick a date/time first.';
    return;
  }
  const d = new Date(raw);
  const lines = TIMEZONES.map(([label, tz]) => {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, dateStyle: 'medium', timeStyle: 'short',
    }).format(d);
    return `${label.padEnd(20)} ${formatted}`;
  });
  resultEl.className = 'result-box result-success tf-output';
  resultEl.textContent = lines.join('\n');
});

// ---------- cURL -> Code ----------
function tokenizeShell(str) {
  const tokens = [];
  let current = '', inSingle = false, inDouble = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else current += c;
    } else if (inDouble) {
      if (c === '\\' && (str[i + 1] === '"' || str[i + 1] === '\\')) { current += str[i + 1]; i++; }
      else if (c === '"') inDouble = false;
      else current += c;
    } else if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (/\s/.test(c)) { if (current) { tokens.push(current); current = ''; } }
    else current += c;
  }
  if (current) tokens.push(current);
  return tokens;
}
function parseCurl(cmd) {
  cmd = cmd.trim().replace(/^curl\s+/, '').replace(/\\\s*\n/g, ' ');
  const tokens = tokenizeShell(cmd);
  let url = null, method = null, headers = [], data = null, user = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') method = tokens[++i];
    else if (t === '-H' || t === '--header') headers.push(tokens[++i]);
    else if (t === '-d' || t === '--data' || t === '--data-raw') data = tokens[++i];
    else if (t === '-u' || t === '--user') user = tokens[++i];
    else if (t.startsWith('-')) { /* skip unrecognized flag */ }
    else url = t;
  }
  if (!method) method = data ? 'POST' : 'GET';
  return { url, method, headers, data, user };
}
function generateJs({ url, method, headers, data }) {
  const headerLines = headers.map((h) => {
    const idx = h.indexOf(':');
    return `    "${h.slice(0, idx).trim()}": "${h.slice(idx + 1).trim()}"`;
  }).join(',\n');
  return `fetch("${url}", {
  method: "${method}",
  headers: {
${headerLines || '    // no headers'}
  },${data ? `\n  body: ${JSON.stringify(data)},` : ''}
})
  .then((res) => res.json())
  .then((data) => console.log(data));`;
}
function generatePython({ url, method, headers, data }) {
  const headerDict = headers.length
    ? '{\n' + headers.map((h) => { const i = h.indexOf(':'); return `    "${h.slice(0, i).trim()}": "${h.slice(i + 1).trim()}"`; }).join(',\n') + '\n}'
    : 'None';
  return `import requests

response = requests.request(
    "${method}",
    "${url}",
    headers=${headerDict},${data ? `\n    data=${JSON.stringify(data)},` : ''}
)
print(response.json())`;
}
function generatePowerShell({ url, method, headers, data }) {
  const headerLines = headers.map((h) => { const i = h.indexOf(':'); return `    "${h.slice(0, i).trim()}" = "${h.slice(i + 1).trim()}"`; }).join('\n');
  return `Invoke-RestMethod -Uri "${url}" -Method ${method}${headers.length ? ` -Headers @{\n${headerLines}\n}` : ''}${data ? ` -Body '${data}'` : ''}`;
}
bind('curl-convert-btn', 'click', () => {
  const resultEl = document.getElementById('curl-result');
  const input = document.getElementById('curl-input').value;
  if (!input.trim()) {
    resultEl.className = 'result-box result-idle tf-output';
    resultEl.textContent = 'Paste a curl command first.';
    return;
  }
  try {
    const parsed = parseCurl(input);
    if (!parsed.url) throw new Error('Could not find a URL in that command.');
    const out = `// JavaScript (fetch)\n${generateJs(parsed)}\n\n# Python (requests)\n${generatePython(parsed)}\n\n# PowerShell\n${generatePowerShell(parsed)}`;
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = out;
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Could not parse: ' + e.message;
  }
});

// ---------- CIDR Calculator ----------
function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error('Invalid IPv4 address: ' + ip);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
function cidrInfo(cidr) {
  const [ip, prefixStr] = cidr.trim().split('/');
  const prefix = Number(prefixStr);
  if (!ip || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Expected format: IP/prefix, e.g. 10.0.0.0/24');
  }
  const ipInt = ipToInt(ip);
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = Math.pow(2, 32 - prefix);
  let firstUsable, lastUsable, usableCount;
  if (prefix === 32) { firstUsable = network; lastUsable = network; usableCount = 1; }
  else if (prefix === 31) { firstUsable = network; lastUsable = broadcast; usableCount = 2; }
  else { firstUsable = (network + 1) >>> 0; lastUsable = (broadcast - 1) >>> 0; usableCount = total - 2; }
  return {
    network: intToIp(network), broadcast: intToIp(broadcast), mask: intToIp(mask),
    total, usableCount, firstUsable: intToIp(firstUsable), lastUsable: intToIp(lastUsable), prefix,
  };
}
bind('cidr-calc-btn', 'click', () => {
  const resultEl = document.getElementById('cidr-result');
  try {
    const r = cidrInfo(document.getElementById('cidr-input').value);
    const lines = [
      `Network address:    ${r.network}/${r.prefix}`,
      `Subnet mask:        ${r.mask}`,
      `Broadcast address:  ${r.broadcast}`,
      `Total addresses:    ${r.total.toLocaleString()}`,
      `Usable hosts:       ${r.usableCount.toLocaleString()}`,
      `First usable IP:    ${r.firstUsable}`,
      `Last usable IP:     ${r.lastUsable}`,
    ];
    if (r.prefix >= 31) lines.push('', '(Note: /31 and /32 have no distinct network/broadcast address by the usual convention — RFC 3021 point-to-point and host routes.)');
    resultEl.className = 'result-box result-success';
    resultEl.textContent = lines.join('\n');
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- Kubernetes Quantity Converter ----------
function parseK8sQuantity(q) {
  q = q.trim();
  const m = q.match(/^(-?\d+(?:\.\d+)?)([EPTGMK]i|[munkKMGTPE]?)$/);
  if (!m) throw new Error('Invalid quantity. Expected formats like 500m, 1Gi, 250Mi, or a plain number.');
  const num = parseFloat(m[1]);
  const suf = m[2];
  const binary = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };
  const decimal = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
  const value = binary[suf] !== undefined ? num * binary[suf] : num * decimal[suf];
  return { value };
}
function formatBytes(bytes) {
  const units = [['Ei', 2 ** 60], ['Pi', 2 ** 50], ['Ti', 2 ** 40], ['Gi', 2 ** 30], ['Mi', 2 ** 20], ['Ki', 2 ** 10]];
  for (const [label, size] of units) {
    if (Math.abs(bytes) >= size) return `${(bytes / size).toFixed(3).replace(/\.?0+$/, '')} ${label}B`;
  }
  return `${bytes} B`;
}
bind('k8sq-convert-btn', 'click', () => {
  const resultEl = document.getElementById('k8sq-result');
  try {
    const raw = document.getElementById('k8sq-input').value.trim();
    if (!raw) throw new Error('Enter a quantity.');
    const { value } = parseK8sQuantity(raw);
    resultEl.className = 'result-box result-success';
    resultEl.textContent = [
      `Raw value:       ${value.toLocaleString('en-US')}`,
      `As bytes/units:  ${formatBytes(value)}`,
      `As CPU cores:    ${value}`,
    ].join('\n');
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- chmod Calculator ----------
function symbolicToOctal(sym) {
  sym = sym.trim();
  if (sym.length !== 9 || !/^[rwxst-]{9}$/i.test(sym)) throw new Error('Expected 9 characters like rwxr-xr--.');
  let octal = '';
  for (let i = 0; i < 3; i++) {
    const chunk = sym.slice(i * 3, i * 3 + 3);
    let v = 0;
    if (chunk[0].toLowerCase() === 'r') v += 4;
    if (chunk[1].toLowerCase() === 'w') v += 2;
    if (chunk[2] !== '-') v += 1;
    octal += v;
  }
  return octal;
}
function octalToSymbolic(oct) {
  oct = oct.trim();
  if (!/^[0-7]{3,4}$/.test(oct)) throw new Error('Expected 3 or 4 octal digits, e.g. 754.');
  const digits = oct.length === 4 ? oct.slice(1) : oct;
  const map = { 0: '---', 1: '--x', 2: '-w-', 3: '-wx', 4: 'r--', 5: 'r-x', 6: 'rw-', 7: 'rwx' };
  return digits.split('').map((d) => map[d]).join('');
}
bind('chmod-to-octal-btn', 'click', () => {
  const resultEl = document.getElementById('chmod-result');
  try {
    const sym = document.getElementById('chmod-symbolic').value;
    if (!sym.trim()) throw new Error('Enter a symbolic permission string.');
    const octal = symbolicToOctal(sym);
    document.getElementById('chmod-octal').value = octal;
    resultEl.className = 'result-box result-success';
    resultEl.textContent = `${sym.trim()} = ${octal}\nchmod ${octal} file`;
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});
bind('chmod-to-symbolic-btn', 'click', () => {
  const resultEl = document.getElementById('chmod-result');
  try {
    const oct = document.getElementById('chmod-octal').value;
    if (!oct.trim()) throw new Error('Enter an octal permission value.');
    const sym = octalToSymbolic(oct);
    document.getElementById('chmod-symbolic').value = sym;
    resultEl.className = 'result-box result-success';
    resultEl.textContent = `${oct.trim()} = ${sym}\nchmod ${oct.trim()} file`;
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- Shared: XML pretty-printer ----------
// The standalone XML Formatter tool was removed; formatXml() stays because
// the XML <-> JSON Converter below still pretty-prints its output with it.
function formatXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) throw new Error('Invalid XML: ' + errorNode.textContent.trim().split('\n')[0]);
  const serialized = new XMLSerializer().serializeToString(doc);
  const withBreaks = serialized.replace(/></g, '>\n<');
  const lines = withBreaks.split('\n');
  let depth = 0;
  const indented = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^<\/[^>]+>$/.test(trimmed)) depth = Math.max(0, depth - 1);
    indented.push('  '.repeat(depth) + trimmed);
    if (/^<[^/!?][^>]*[^/]>$/.test(trimmed) && !/^<[^>]+\/>$/.test(trimmed)) depth += 1;
  }
  return indented.join('\n');
}

// ---------- CIDR Overlap Checker ----------
function cidrRange(cidr) {
  const [ip, prefixStr] = cidr.trim().split('/');
  const prefix = Number(prefixStr);
  if (!ip || Number.isNaN(prefix) || prefix < 0 || prefix > 32) throw new Error('Invalid CIDR: ' + cidr);
  const ipInt = ipToInt(ip);
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return { network, broadcast, cidr: cidr.trim() };
}
function rangesOverlap(a, b) {
  return a.network <= b.broadcast && b.network <= a.broadcast;
}
bind('cidroverlap-check-btn', 'click', () => {
  const resultEl = document.getElementById('cidroverlap-result');
  try {
    const lines = document.getElementById('cidroverlap-input').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('Enter at least two CIDR blocks, one per line.');
    const ranges = lines.map(cidrRange);
    const overlaps = [];
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (rangesOverlap(ranges[i], ranges[j])) overlaps.push(`${ranges[i].cidr}  <->  ${ranges[j].cidr}`);
      }
    }
    resultEl.className = overlaps.length ? 'result-box result-error' : 'result-box result-success';
    resultEl.textContent = overlaps.length
      ? `Found ${overlaps.length} overlap(s):\n\n` + overlaps.join('\n')
      : `No overlaps found among ${ranges.length} CIDR blocks.`;
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- XML <-> JSON Converter ----------
function xmlNodeToObj(node) {
  const children = Array.from(node.children);
  if (children.length === 0) return node.textContent;
  const obj = {};
  for (const child of children) {
    const val = xmlNodeToObj(child);
    if (obj[child.tagName] !== undefined) {
      if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [obj[child.tagName]];
      obj[child.tagName].push(val);
    } else {
      obj[child.tagName] = val;
    }
  }
  return obj;
}
function jsonToXmlString(val, key) {
  if (Array.isArray(val)) return val.map((v) => jsonToXmlString(v, key)).join('');
  if (val !== null && typeof val === 'object') {
    return `<${key}>` + Object.entries(val).map(([k, v]) => jsonToXmlString(v, k)).join('') + `</${key}>`;
  }
  return `<${key}>${String(val)}</${key}>`;
}
bind('xmljson-to-json-btn', 'click', () => {
  const resultEl = document.getElementById('xmljson-result');
  try {
    const input = document.getElementById('xmljson-input').value;
    if (!input.trim()) throw new Error('Paste some XML first.');
    const doc = new DOMParser().parseFromString(input, 'application/xml');
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) throw new Error('Invalid XML: ' + errorNode.textContent.trim().split('\n')[0]);
    const obj = { [doc.documentElement.tagName]: xmlNodeToObj(doc.documentElement) };
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = JSON.stringify(obj, null, 2);
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = e.message;
  }
});
bind('xmljson-to-xml-btn', 'click', () => {
  const resultEl = document.getElementById('xmljson-result');
  try {
    const input = document.getElementById('xmljson-input').value;
    if (!input.trim()) throw new Error('Paste some JSON first.');
    const parsed = JSON.parse(input);
    const keys = Object.keys(parsed);
    const xml = keys.length === 1
      ? jsonToXmlString(parsed[keys[0]], keys[0])
      : jsonToXmlString(parsed, 'root');
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = formatXml(xml);
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = e.message;
  }
});

// ---------- JSON Schema Generator ----------
function inferSchema(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', items: value.length ? inferSchema(value[0]) : {} };
  const t = typeof value;
  if (t === 'object') {
    const properties = {};
    for (const k of Object.keys(value)) properties[k] = inferSchema(value[k]);
    return { type: 'object', properties, required: Object.keys(value) };
  }
  if (t === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  return { type: t };
}
bind('jsonschema-generate-btn', 'click', () => {
  const resultEl = document.getElementById('jsonschema-result');
  try {
    const input = document.getElementById('jsonschema-input').value;
    if (!input.trim()) throw new Error('Paste some sample JSON first.');
    const parsed = JSON.parse(input);
    const schema = { $schema: 'http://json-schema.org/draft-07/schema#', ...inferSchema(parsed) };
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = JSON.stringify(schema, null, 2);
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Invalid JSON: ' + e.message;
  }
});

// ---------- Secret Scanner ----------
const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub Personal Access Token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'Generic API key/secret assignment', re: /\b(api[_-]?key|apikey|secret|token)\b\s*[:=]\s*['"][A-Za-z0-9\-_]{16,}['"]/gi },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
];
bind('secretscanner-scan-btn', 'click', () => {
  const resultEl = document.getElementById('secretscanner-result');
  try {
    const input = document.getElementById('secretscanner-input').value;
    if (!input.trim()) throw new Error('Paste some text to scan.');
    const findings = [];
    for (const p of SECRET_PATTERNS) {
      const matches = input.match(p.re);
      if (matches) findings.push(`${p.name}: ${matches.length} match(es)\n  ` + [...new Set(matches)].join('\n  '));
    }
    resultEl.className = findings.length ? 'result-box result-error' : 'result-box result-success';
    resultEl.textContent = findings.length
      ? `Found ${findings.length} potential secret pattern(s):\n\n` + findings.join('\n\n')
      : 'No known secret patterns detected. (This is a heuristic scan, not a guarantee — always double-check manually.)';
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});


// ---------- Cron Builder ----------
bind('cronbuilder-build-btn', 'click', () => {
  const resultEl = document.getElementById('cronbuilder-result');
  try {
    const get = (id) => {
      const v = document.getElementById(id).value.trim();
      return v === '' ? '*' : v;
    };
    const minute = get('cronbuilder-minute');
    const hour = get('cronbuilder-hour');
    const dom = get('cronbuilder-dom');
    const month = get('cronbuilder-month');
    const dow = get('cronbuilder-dow');
    const validPart = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(,\d+)*)$/;
    for (const [label, v] of [['minute', minute], ['hour', hour], ['day of month', dom], ['month', month], ['day of week', dow]]) {
      if (!validPart.test(v)) throw new Error(`Invalid ${label} field: "${v}"`);
    }
    const expr = [minute, hour, dom, month, dow].join(' ');
    resultEl.className = 'result-box result-success';
    resultEl.textContent = expr;
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- TLS Certificate Decoder ----------
function parseDer(bytes, offset) {
  const tag = bytes[offset];
  const lenByte = bytes[offset + 1];
  let lenOffset = offset + 2;
  let length;
  if (lenByte & 0x80) {
    const numBytes = lenByte & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i++) length = (length << 8) | bytes[lenOffset + i];
    lenOffset += numBytes;
  } else {
    length = lenByte;
  }
  const valueStart = lenOffset;
  const valueEnd = valueStart + length;
  const constructed = (tag & 0x20) !== 0;
  let children = null;
  if (constructed) {
    children = [];
    let p = valueStart;
    while (p < valueEnd) {
      const child = parseDer(bytes, p);
      children.push(child);
      p = child.end;
    }
  }
  return { tag, length, valueStart, valueEnd, children, end: valueEnd };
}
function oidToString(bytes, start, end) {
  const parts = [];
  const first = bytes[start];
  parts.push(Math.floor(first / 40), first % 40);
  let val = 0;
  for (let i = start + 1; i < end; i++) {
    val = (val << 7) | (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) { parts.push(val); val = 0; }
  }
  return parts.join('.');
}
const OID_NAMES = { '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU' };
function parseX509Name(node, bytes) {
  const parts = [];
  for (const rdnSet of node.children) {
    for (const attrSeq of rdnSet.children) {
      const [oidNode, valNode] = attrSeq.children;
      const oid = oidToString(bytes, oidNode.valueStart, oidNode.valueEnd);
      const name = OID_NAMES[oid] || oid;
      const value = new TextDecoder('utf-8').decode(bytes.slice(valNode.valueStart, valNode.valueEnd));
      parts.push(`${name}=${value}`);
    }
  }
  return parts.join(', ');
}
function parseCertTime(bytes, start, end) {
  const str = String.fromCharCode(...bytes.slice(start, end));
  let m;
  if ((m = str.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    let year = parseInt(m[1], 10);
    year += year < 50 ? 2000 : 1900;
    return new Date(Date.UTC(year, +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  }
  if ((m = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  }
  throw new Error('Unrecognized certificate time format.');
}
function certBytesToHex(bytes, start, end) {
  return Array.from(bytes.slice(start, end)).map((b) => b.toString(16).padStart(2, '0')).join(':');
}
function parseCertificatePem(pemStr) {
  const b64 = pemStr.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\s+/g, '');
  if (!b64) throw new Error('No certificate data found. Expected a PEM block starting with -----BEGIN CERTIFICATE-----.');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const cert = parseDer(bytes, 0);
  const tbsCert = cert.children[0];
  const children = tbsCert.children;
  let ci = 0;
  if (children[ci].tag === 0xa0) ci++;
  const serialNode = children[ci++];
  ci++;
  const issuerNode = children[ci++];
  const validityNode = children[ci++];
  const subjectNode = children[ci++];
  const notBefore = parseCertTime(bytes, validityNode.children[0].valueStart, validityNode.children[0].valueEnd);
  const notAfter = parseCertTime(bytes, validityNode.children[1].valueStart, validityNode.children[1].valueEnd);
  return {
    serialNumber: certBytesToHex(bytes, serialNode.valueStart, serialNode.valueEnd),
    issuer: parseX509Name(issuerNode, bytes),
    subject: parseX509Name(subjectNode, bytes),
    notBefore,
    notAfter,
  };
}
bind('tlsdecoder-decode-btn', 'click', () => {
  const resultEl = document.getElementById('tlsdecoder-result');
  try {
    const input = document.getElementById('tlsdecoder-input').value;
    if (!input.trim()) throw new Error('Paste a PEM certificate first.');
    const info = parseCertificatePem(input);
    const now = new Date();
    const isExpired = now > new Date(info.notAfter);
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = [
      `Subject:       ${info.subject}`,
      `Issuer:        ${info.issuer}`,
      `Serial Number: ${info.serialNumber}`,
      `Valid From:    ${info.notBefore}`,
      `Valid Until:   ${info.notAfter}`,
      `Status:        ${isExpired ? 'EXPIRED' : 'Valid (not expired)'}`,
    ].join('\n');
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Could not parse certificate: ' + e.message;
  }
});

// ---------- Mermaid Diagram Preview ----------
if (window.mermaid) mermaid.initialize({ startOnLoad: false, theme: 'dark' });
bind('mermaid-render-btn', 'click', async () => {
  const resultEl = document.getElementById('mermaid-result');
  try {
    const input = document.getElementById('mermaid-input').value;
    if (!input.trim()) throw new Error('Paste some Mermaid syntax first.');
    const id = 'mermaid-svg-' + Date.now();
    const { svg } = await mermaid.render(id, input);
    resultEl.className = 'result-box result-success';
    resultEl.innerHTML = svg;
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Could not render diagram: ' + (e.message || String(e));
  }
});


// ---------- K8s Resource Quota Calculator ----------
bind('resourcequota-calc-btn', 'click', () => {
  const resultEl = document.getElementById('resourcequota-result');
  try {
    const lines = document.getElementById('resourcequota-input').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Paste at least one quantity.');
    let total = 0;
    for (const line of lines) total += parseK8sQuantity(line).value;
    resultEl.className = 'result-box result-success';
    resultEl.textContent = [
      `Sum of ${lines.length} value(s): ${total.toLocaleString('en-US')}`,
      `As bytes/units: ${formatBytes(total)}`,
      `As CPU cores/millicores: ${total}${total < 1 ? ` (${Math.round(total * 1000)}m)` : ''}`,
    ].join('\n');
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- REST Endpoint Mock Generator ----------
bind('restmock-generate-btn', 'click', () => {
  const resultEl = document.getElementById('restmock-result');
  try {
    const method = document.getElementById('restmock-method').value;
    const path = document.getElementById('restmock-path').value.trim();
    const jsonRaw = document.getElementById('restmock-json').value;
    if (!path || !jsonRaw.trim()) throw new Error('Fill in a path and sample JSON.');
    const sample = JSON.parse(jsonRaw);
    const indented = JSON.stringify(sample, null, 2).split('\n').join('\n  ');
    const code = `const express = require('express');\nconst app = express();\n\napp.${method.toLowerCase()}('${path}', (req, res) => {\n  res.json(${indented});\n});\n\napp.listen(3000, () => console.log('Mock server running on http://localhost:3000'));`;
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = code;
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Invalid JSON: ' + e.message;
  }
});


// ---------- .env File Validator ----------
function parseEnvFile(text) {
  const lines = text.split('\n');
  const seen = {};
  const issues = [];
  const entries = [];
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) { issues.push(`Line ${i + 1}: doesn't look like KEY=VALUE: "${line}"`); return; }
    const [, key, value] = m;
    if (seen[key]) issues.push(`Line ${i + 1}: duplicate key "${key}" (also defined on line ${seen[key]})`);
    seen[key] = i + 1;
    if (!value) issues.push(`Line ${i + 1}: "${key}" has an empty value`);
    entries.push({ key, value });
  });
  return { entries, issues };
}
bind('envparser-check-btn', 'click', () => {
  const resultEl = document.getElementById('envparser-result');
  try {
    const input = document.getElementById('envparser-input').value;
    if (!input.trim()) throw new Error('Paste a .env file first.');
    const { entries, issues } = parseEnvFile(input);
    resultEl.className = issues.length ? 'result-box result-error' : 'result-box result-success';
    resultEl.textContent = [
      `${entries.length} key(s) found, ${issues.length} issue(s):`,
      '',
      ...(issues.length ? issues.map((i) => '- ' + i) : ['No issues found.']),
    ].join('\n');
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- Nginx Config Formatter ----------
function formatNginxConfig(input) {
  const compact = input.replace(/\s+/g, ' ').trim();
  let depth = 0;
  const lines = [];
  let current = '';
  for (let i = 0; i < compact.length; i++) {
    const c = compact[i];
    if (c === '{') {
      lines.push('  '.repeat(depth) + current.trim() + ' {');
      current = '';
      depth++;
    } else if (c === '}') {
      if (current.trim()) lines.push('  '.repeat(depth) + current.trim());
      current = '';
      depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + '}');
    } else if (c === ';') {
      lines.push('  '.repeat(depth) + current.trim() + ';');
      current = '';
    } else {
      current += c;
    }
  }
  return lines.filter((l) => l.trim()).join('\n');
}
bind('nginxfmt-format-btn', 'click', () => {
  const resultEl = document.getElementById('nginxfmt-result');
  try {
    const input = document.getElementById('nginxfmt-input').value;
    if (!input.trim()) throw new Error('Paste an nginx config first.');
    resultEl.className = 'result-box result-success tf-output';
    resultEl.textContent = formatNginxConfig(input);
  } catch (e) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = e.message;
  }
});

// ---------- Cron Next Run Calculator ----------
function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    let m;
    if (part === '*') { for (let i = min; i <= max; i++) values.add(i); }
    else if ((m = part.match(/^\*\/(\d+)$/))) { const step = +m[1]; for (let i = min; i <= max; i += step) values.add(i); }
    else if ((m = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/))) {
      const step = m[3] ? +m[3] : 1;
      for (let i = +m[1]; i <= +m[2]; i += step) values.add(i);
    } else if ((m = part.match(/^\d+$/))) { values.add(+part); }
    else throw new Error('Unsupported cron field syntax: ' + part);
  }
  return values;
}
function nextCronRuns(expr, count, fromDate) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Expected a 5-field cron expression (minute hour day-of-month month day-of-week).');
  const [minF, hourF, domF, monthF, dowF] = fields;
  const minutes = parseCronField(minF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = domF === '*' ? null : parseCronField(domF, 1, 31);
  const months = parseCronField(monthF, 1, 12);
  const dows = dowF === '*' ? null : parseCronField(dowF, 0, 6);
  const results = [];
  let cursor = new Date(fromDate.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60000);
  let iterations = 0;
  while (results.length < count && iterations < 600000) {
    iterations++;
    const min = cursor.getUTCMinutes(), hr = cursor.getUTCHours(), dom = cursor.getUTCDate(), mon = cursor.getUTCMonth() + 1, dow = cursor.getUTCDay();
    const domOk = doms === null || doms.has(dom);
    const dowOk = dows === null || dows.has(dow);
    const dayOk = (doms === null && dows === null) ? true : (doms !== null && dows !== null) ? (domOk || dowOk) : (domOk && dowOk);
    if (minutes.has(min) && hours.has(hr) && months.has(mon) && dayOk) results.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 60000);
  }
  if (results.length < count) throw new Error('Could not find enough matching run times (check the expression).');
  return results;
}
bind('cronnext-calc-btn', 'click', () => {
  const resultEl = document.getElementById('cronnext-result');
  try {
    const expr = document.getElementById('cronnext-input').value.trim();
    if (!expr) throw new Error('Enter a cron expression.');
    const runs = nextCronRuns(expr, 5, new Date());
    resultEl.className = 'result-box result-success';
    resultEl.textContent = runs.map((d) => d.toISOString().replace('T', ' ').replace('.000Z', ' UTC')).join('\n');
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
  }
});

// ---------- find Command Builder ----------
function buildFindCommand(o) {
  const parts = ['find', o.path || '.'];
  if (o.maxdepth) parts.push('-maxdepth', o.maxdepth);
  if (o.mindepth) parts.push('-mindepth', o.mindepth);
  if (o.type) parts.push('-type', o.type);
  if (o.name) parts.push(o.iname ? '-iname' : '-name', `'${o.name}'`);
  if (o.mtimeOp && o.mtimeDays !== '') parts.push('-mtime', `${o.mtimeOp}${o.mtimeDays}`);
  if (o.sizeOp && o.sizeNum !== '') parts.push('-size', `${o.sizeOp}${o.sizeNum}${o.sizeUnit || 'k'}`);
  if (o.perm) parts.push('-perm', o.perm);
  if (o.action === 'delete') parts.push('-delete');
  else if (o.action === 'exec' && o.execCmd) parts.push('-exec', o.execCmd, '{}', '\\;');
  return parts.join(' ');
}
bind('findbuilder-action', 'change', (e) => {
  document.getElementById('findbuilder-execcmd').style.display = e.target.value === 'exec' ? '' : 'none';
});
bind('findbuilder-build-btn', 'click', () => {
  const resultEl = document.getElementById('findbuilder-result');
  const action = document.getElementById('findbuilder-action').value;
  if (action === 'exec' && !document.getElementById('findbuilder-execcmd').value.trim()) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Enter a command to run with -exec.';
    return;
  }
  const cmd = buildFindCommand({
    path: document.getElementById('findbuilder-path').value.trim(),
    name: document.getElementById('findbuilder-name').value.trim(),
    iname: document.getElementById('findbuilder-iname').checked,
    type: document.getElementById('findbuilder-type').value,
    mtimeOp: document.getElementById('findbuilder-mtime-op').value,
    mtimeDays: document.getElementById('findbuilder-mtime').value.trim(),
    sizeOp: document.getElementById('findbuilder-size-op').value,
    sizeNum: document.getElementById('findbuilder-size').value.trim(),
    sizeUnit: document.getElementById('findbuilder-size-unit').value,
    perm: document.getElementById('findbuilder-perm').value.trim(),
    action,
    execCmd: document.getElementById('findbuilder-execcmd').value.trim(),
  });
  resultEl.className = 'result-box result-success tf-output';
  resultEl.textContent = cmd;
});

// ---------- sed Command Builder ----------
function buildSedCommand(o) {
  let script;
  if (o.mode === 'substitute') {
    const delim = o.delimiter || '/';
    const flags = (o.global ? 'g' : '') + (o.ignoreCase ? 'i' : '') + (o.printOnly ? 'p' : '');
    script = `${o.range || ''}s${delim}${o.pattern}${delim}${o.replacement}${delim}${flags}`;
  } else if (o.mode === 'delete') {
    script = `${o.range || `/${o.pattern}/`}d`;
  } else if (o.mode === 'print') {
    script = `${o.range || `/${o.pattern}/`}p`;
  }
  const parts = ['sed'];
  if (o.mode === 'print') parts.push('-n');
  if (o.inPlace) parts.push(o.backupSuffix ? `-i${o.backupSuffix}` : '-i');
  parts.push(`'${script}'`);
  if (o.file) parts.push(o.file);
  return parts.join(' ');
}
bind('sedbuilder-mode', 'change', (e) => {
  const isSub = e.target.value === 'substitute';
  document.getElementById('sedbuilder-sub-fields').style.display = isSub ? '' : 'none';
  document.getElementById('sedbuilder-range-fields').style.display = isSub ? 'none' : '';
});
bind('sedbuilder-inplace', 'change', (e) => {
  document.getElementById('sedbuilder-backup').style.display = e.target.checked ? '' : 'none';
});
bind('sedbuilder-build-btn', 'click', () => {
  const resultEl = document.getElementById('sedbuilder-result');
  const mode = document.getElementById('sedbuilder-mode').value;
  const pattern = mode === 'substitute'
    ? document.getElementById('sedbuilder-pattern').value.trim()
    : document.getElementById('sedbuilder-dpattern').value.trim();
  const range = mode === 'substitute' ? '' : document.getElementById('sedbuilder-range').value.trim();
  if (mode === 'substitute' && !pattern) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Enter a pattern to match.';
    return;
  }
  if (mode !== 'substitute' && !pattern && !range) {
    resultEl.className = 'result-box result-error tf-output';
    resultEl.textContent = 'Enter a pattern or a line range.';
    return;
  }
  const cmd = buildSedCommand({
    mode,
    pattern,
    replacement: document.getElementById('sedbuilder-replacement').value,
    global: document.getElementById('sedbuilder-global').checked,
    ignoreCase: document.getElementById('sedbuilder-icase').checked,
    range,
    inPlace: document.getElementById('sedbuilder-inplace').checked,
    backupSuffix: document.getElementById('sedbuilder-backup').value.trim(),
    file: document.getElementById('sedbuilder-file').value.trim(),
  });
  resultEl.className = 'result-box result-success tf-output';
  resultEl.textContent = cmd;
});



// ---------- kubectl JSONPath Tester ----------
// kubectl's -o jsonpath= is notoriously fiddly and normally can only be
// iterated against a live cluster. This evaluates the same common subset
// against pasted JSON: dot paths, [*], [n], [a:b] slices and .. descent.
function jpTokenize(expr) {
  // kubectl wraps expressions in {...}; accept with or without.
  let e = expr.trim();
  if (e.startsWith('{') && e.endsWith('}')) e = e.slice(1, -1).trim();
  if (e.startsWith('$')) e = e.slice(1);
  const tokens = [];
  let i = 0;
  while (i < e.length) {
    const c = e[i];
    if (c === '.') {
      if (e[i + 1] === '.') { tokens.push({ t: 'descend' }); i += 2; continue; }
      i++; continue;
    }
    if (c === '[') {
      const close = e.indexOf(']', i);
      if (close === -1) throw new Error('unclosed [ at position ' + i);
      const inner = e.slice(i + 1, close).trim();
      i = close + 1;
      if (inner === '*') { tokens.push({ t: 'wild' }); continue; }
      if (inner.includes(':')) {
        const [a, b] = inner.split(':');
        tokens.push({ t: 'slice', from: a === '' ? null : Number(a), to: b === '' ? null : Number(b) });
        continue;
      }
      const unquoted = inner.replace(/^['"]|['"]$/g, '');
      if (unquoted !== inner) { tokens.push({ t: 'key', k: unquoted }); continue; }
      tokens.push({ t: 'index', n: Number(inner) });
      continue;
    }
    if (c === '*') { tokens.push({ t: 'wild' }); i++; continue; }
    const m = e.slice(i).match(/^[A-Za-z0-9_$@-]+/);
    if (!m) throw new Error('unexpected character "' + c + '" at position ' + i);
    tokens.push({ t: 'key', k: m[0] });
    i += m[0].length;
  }
  return tokens;
}

function jpEval(data, tokens) {
  let cur = [data];
  for (const tok of tokens) {
    const next = [];
    for (const node of cur) {
      if (node === null || node === undefined) continue;
      if (tok.t === 'key') {
        if (typeof node === 'object' && !Array.isArray(node) && tok.k in node) next.push(node[tok.k]);
      } else if (tok.t === 'index') {
        if (Array.isArray(node)) {
          const idx = tok.n < 0 ? node.length + tok.n : tok.n;
          if (idx >= 0 && idx < node.length) next.push(node[idx]);
        }
      } else if (tok.t === 'slice') {
        if (Array.isArray(node)) {
          const from = tok.from === null ? 0 : tok.from;
          const to = tok.to === null ? node.length : tok.to;
          next.push(...node.slice(from, to));
        }
      } else if (tok.t === 'wild') {
        if (Array.isArray(node)) next.push(...node);
        else if (typeof node === 'object') next.push(...Object.values(node));
      } else if (tok.t === 'descend') {
        const stack = [node];
        while (stack.length) {
          const n = stack.pop();
          if (n && typeof n === 'object') {
            next.push(n);
            stack.push(...(Array.isArray(n) ? n : Object.values(n)));
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

bind('jsonpath-run-btn', 'click', () => {
  const resultEl = document.getElementById('jsonpath-result');
  const raw = document.getElementById('jsonpath-input').value.trim();
  const expr = document.getElementById('jsonpath-expr').value.trim();
  if (!raw) { resultEl.className = 'result-box result-idle'; resultEl.textContent = 'Paste some JSON first.'; return; }
  if (!expr) { resultEl.className = 'result-box result-idle'; resultEl.textContent = 'Enter a JSONPath expression.'; return; }
  let data;
  try {
    data = parseAsJsonOrYaml(raw).data;
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = e.message;
    return;
  }
  let matches;
  try {
    matches = jpEval(data, jpTokenize(expr));
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Could not parse the expression: ' + e.message;
    return;
  }
  if (!matches.length) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'No matches. kubectl would print an empty result here.';
    return;
  }
  // kubectl joins scalar results with spaces; show that plus the structured list.
  const scalars = matches.every((m) => m === null || typeof m !== 'object');
  const lines = [];
  lines.push(matches.length + ' match(es).');
  lines.push('');
  if (scalars) {
    lines.push('kubectl would print:');
    lines.push(matches.map((m) => String(m)).join(' '));
    lines.push('');
  }
  matches.forEach((m, i) => {
    lines.push('[' + i + '] ' + (typeof m === 'object' && m !== null ? JSON.stringify(m, null, 2) : String(m)));
  });
  resultEl.className = 'result-box result-success';
  resultEl.textContent = lines.join('\n');
});

// ---------- IAM Policy Analyzer ----------
// aws accessanalyzer validate-policy needs credentials and the CLI; this is
// the same class of check on a pasted document, offline.
const IAM_SENSITIVE = [
  'iam:', 'sts:assumerole', 'kms:', 'secretsmanager:', 'ec2:terminateinstances',
  's3:deletebucket', 'organizations:', 'cloudtrail:stoplogging', 'lambda:invokefunction',
];

function iamFindings(policy) {
  const out = [];
  const statements = [].concat(policy.Statement || []);
  if (!statements.length) out.push(['high', 'No Statement array found — this does not look like an IAM policy document.']);

  statements.forEach((st, idx) => {
    const label = 'Statement ' + (st.Sid ? '"' + st.Sid + '"' : '#' + (idx + 1));
    const effect = st.Effect;
    const actions = [].concat(st.Action || st.NotAction || []).map((a) => String(a).toLowerCase());
    const resources = [].concat(st.Resource || st.NotResource || []).map((r) => String(r));
    const hasCondition = !!st.Condition && Object.keys(st.Condition).length > 0;

    if (effect !== 'Allow' && effect !== 'Deny') out.push(['high', label + ': Effect is "' + effect + '" — must be exactly "Allow" or "Deny".']);
    if (st.NotAction) out.push(['medium', label + ': uses NotAction, which grants everything except the listed actions. Easy to widen accidentally — prefer an explicit Action list.']);
    if (st.NotResource) out.push(['medium', label + ': uses NotResource, same inversion risk as NotAction.']);

    if (effect === 'Allow') {
      const starAction = actions.includes('*');
      const starResource = resources.includes('*');
      if (starAction && starResource) {
        out.push(['high', label + ': Action "*" on Resource "*" — this is full administrator access.']);
      } else {
        if (starAction) out.push(['high', label + ': Action "*" grants every API call on the listed resources.']);
        if (starResource) out.push(['medium', label + ': Resource "*" — the listed actions apply to every resource in the account.']);
      }
      actions.filter((a) => a.endsWith(':*')).forEach((a) => {
        out.push(['medium', label + ': "' + a + '" grants every action in that service.']);
      });
      const sensitive = actions.filter((a) => IAM_SENSITIVE.some((s) => a.startsWith(s)));
      if (sensitive.length && !hasCondition) {
        out.push(['medium', label + ': sensitive action(s) ' + sensitive.join(', ') + ' with no Condition block. Consider scoping by source IP, MFA, or tag.']);
      }
      const principal = st.Principal;
      if (principal === '*' || (principal && principal.AWS === '*')) {
        out.push(['high', label + ': Principal "*" — this is world-readable unless a Condition restricts it.' + (hasCondition ? ' A Condition is present; verify it actually narrows the principal.' : '')]);
      }
    }
    if (!st.Action && !st.NotAction) out.push(['high', label + ': no Action or NotAction key.']);
    if (!st.Resource && !st.NotResource && !st.Principal) out.push(['medium', label + ': no Resource key (valid only for identity-based policies attached where resource is implied).']);
  });
  return out;
}

bind('iampolicy-check-btn', 'click', () => {
  const resultEl = document.getElementById('iampolicy-result');
  const raw = document.getElementById('iampolicy-input').value.trim();
  if (!raw) { resultEl.className = 'result-box result-idle'; resultEl.textContent = 'Paste an IAM policy document first.'; return; }
  let policy;
  try {
    policy = JSON.parse(raw);
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Not valid JSON: ' + e.message;
    return;
  }
  let findings;
  try {
    findings = iamFindings(policy);
  } catch (e) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Could not analyze: ' + e.message;
    return;
  }
  if (!findings.length) {
    resultEl.className = 'result-box result-success';
    resultEl.textContent = 'No issues found against these checks. That is not a proof of least privilege — it only means none of the common over-permission patterns matched.';
    return;
  }
  const high = findings.filter((f) => f[0] === 'high').length;
  const lines = [findings.length + ' finding(s), ' + high + ' high severity:', ''];
  findings.forEach((f) => lines.push((f[0] === 'high' ? '[HIGH]   ' : '[MEDIUM] ') + f[1]));
  resultEl.className = high ? 'result-box result-error' : 'result-box result-success';
  resultEl.textContent = lines.join('\n');
});

// ---------- Version Constraint Checker ----------
// Handles npm/semver ranges AND Terraform's pessimistic "~>" operator, which
// behaves differently from npm's "~" and is a common source of surprise.
function vParse(v) {
  const m = String(v).trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.*))?$/);
  if (!m) return null;
  return { major: +m[1], minor: +(m[2] || 0), patch: +(m[3] || 0), pre: m[4] || '', parts: [m[2], m[3]] };
}
function vCmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre && !b.pre) return -1;
  if (!a.pre && b.pre) return 1;
  return a.pre < b.pre ? -1 : a.pre > b.pre ? 1 : 0;
}
function vSatisfiesOne(ver, clause) {
  const c = clause.trim();
  if (!c || c === '*') return true;
  const m = c.match(/^(~>|>=|<=|!=|=|>|<|\^|~)?\s*(.+)$/);
  if (!m) return false;
  const op = m[1] || '=';
  const target = vParse(m[2]);
  if (!target) return false;
  const cmp = vCmp(ver, target);
  if (op === '=') return cmp === 0;
  if (op === '!=') return cmp !== 0;
  if (op === '>') return cmp > 0;
  if (op === '<') return cmp < 0;
  if (op === '>=') return cmp >= 0;
  if (op === '<=') return cmp <= 0;
  if (op === '^') {
    // npm caret: allow changes that do not modify the leftmost non-zero part.
    if (cmp < 0) return false;
    if (target.major > 0) return ver.major === target.major;
    if (target.minor > 0) return ver.major === 0 && ver.minor === target.minor;
    return ver.major === 0 && ver.minor === 0 && ver.patch === target.patch;
  }
  if (op === '~') {
    // npm tilde: allow patch-level changes if a minor is specified.
    if (cmp < 0) return false;
    if (target.parts[0] === undefined) return ver.major === target.major;
    return ver.major === target.major && ver.minor === target.minor;
  }
  if (op === '~>') {
    // Terraform pessimistic: the RIGHTMOST specified component may increment.
    if (cmp < 0) return false;
    if (target.parts[1] !== undefined) return ver.major === target.major && ver.minor === target.minor;
    if (target.parts[0] !== undefined) return ver.major === target.major;
    return ver.major === target.major;
  }
  return false;
}
function vSatisfies(ver, constraint) {
  // Comma- or space-separated clauses are ANDed (both npm and Terraform style).
  // Match operator+version as one unit so "~> 1.5" survives its internal space;
  // longest operators first so "~>" beats "~" and ">=" beats ">".
  const clauses = String(constraint).match(/(?:~>|[~^]|[<>!]=|[<>=])?\s*v?\d[A-Za-z0-9.+-]*/g);
  if (!clauses) return false;
  return clauses.every((clause) => vSatisfiesOne(ver, clause));
}

bind('semver-check-btn', 'click', () => {
  const resultEl = document.getElementById('semver-result');
  const constraint = document.getElementById('semver-constraint').value.trim();
  const raw = document.getElementById('semver-versions').value.trim();
  if (!constraint) { resultEl.className = 'result-box result-idle'; resultEl.textContent = 'Enter a constraint first.'; return; }
  if (!raw) { resultEl.className = 'result-box result-idle'; resultEl.textContent = 'Enter one or more versions to test.'; return; }
  const versions = raw.split(/[\s,]+/).filter(Boolean);
  const lines = [];
  let matched = 0, bad = 0;
  versions.forEach((v) => {
    const parsed = vParse(v);
    if (!parsed) { lines.push('  ?  ' + v + '  (not a parseable version)'); bad++; return; }
    let ok = false;
    try { ok = vSatisfies(parsed, constraint); } catch (e) { ok = false; }
    if (ok) matched++;
    lines.push((ok ? '  YES  ' : '  no   ') + v);
  });
  const head = matched + ' of ' + versions.length + ' version(s) satisfy "' + constraint + '"'
    + (bad ? ', ' + bad + ' unparseable' : '') + ':';
  const note = constraint.includes('~>')
    ? '\n\nNote: "~>" is Terraform’s pessimistic operator — the rightmost specified component may increment. "~> 1.5" allows 1.6 but not 2.0; "~> 1.5.0" allows 1.5.9 but not 1.6.0.'
    : '';
  resultEl.className = matched ? 'result-box result-success' : 'result-box result-error';
  resultEl.textContent = head + '\n\n' + lines.join('\n') + note;
});


// ---------- SLO / Error Budget Calculator ----------
// The classic SRE question ("how much downtime does 99.9% actually buy me?")
// is pure arithmetic with units nobody keeps in their head, and there is no
// CLI for it at all.
const SLO_WINDOWS = { '1': 'day', '7': 'week', '28': '28 days', '30': '30 days', '90': 'quarter (90d)', '365': 'year' };

function fmtDuration(seconds) {
  if (seconds < 1) return (seconds * 1000).toFixed(0) + ' ms';
  if (seconds < 60) return seconds.toFixed(1) + ' s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  if (s && !d) parts.push(s + 's');
  return parts.join(' ') || '0s';
}

bind('slo-calc-btn', 'click', () => {
  const resultEl = document.getElementById('slo-result');
  const target = parseFloat(document.getElementById('slo-target').value);
  const days = parseFloat(document.getElementById('slo-window').value);
  const observedRaw = document.getElementById('slo-observed').value.trim();

  if (!isFinite(target) || target <= 0 || target >= 100) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Enter an SLO target between 0 and 100 (exclusive), e.g. 99.9';
    return;
  }
  const windowSeconds = days * 86400;
  const budgetFraction = (100 - target) / 100;
  const budgetSeconds = windowSeconds * budgetFraction;

  const lines = [];
  lines.push(target + '% over ' + (SLO_WINDOWS[String(days)] || days + ' days') + ' allows:');
  lines.push('');
  lines.push('  Error budget   ' + fmtDuration(budgetSeconds));
  lines.push('  Per day        ' + fmtDuration(86400 * budgetFraction));
  lines.push('  Per week       ' + fmtDuration(604800 * budgetFraction));
  lines.push('  Per 30 days    ' + fmtDuration(2592000 * budgetFraction));

  if (observedRaw) {
    const observed = parseFloat(observedRaw);
    if (!isFinite(observed) || observed < 0 || observed > 100) {
      resultEl.className = 'result-box result-error';
      resultEl.textContent = 'Observed availability must be between 0 and 100.';
      return;
    }
    const usedSeconds = windowSeconds * ((100 - observed) / 100);
    const remaining = budgetSeconds - usedSeconds;
    const pctUsed = budgetSeconds === 0 ? 100 : (usedSeconds / budgetSeconds) * 100;
    lines.push('');
    lines.push('Observed ' + observed + '%:');
    lines.push('  Budget spent   ' + fmtDuration(usedSeconds) + '  (' + pctUsed.toFixed(1) + '% of budget)');
    if (remaining >= 0) {
      lines.push('  Remaining      ' + fmtDuration(remaining));
      lines.push('');
      lines.push('  Within SLO. ' + (pctUsed > 75 ? 'Budget is more than three-quarters spent - treat further risk as expensive.' : 'Room to take deliberate risk.'));
    } else {
      lines.push('  Overspent by   ' + fmtDuration(-remaining));
      lines.push('');
      lines.push('  SLO breached. The usual policy response is to freeze feature risk and spend the cycle on reliability.');
    }
  }
  resultEl.className = 'result-box result-success';
  resultEl.textContent = lines.join('\n');
});

// ---------- Kubernetes Manifest Generator ----------
// kubectl create deployment --dry-run gets you a Deployment and nothing else;
// stitching a matching Service and Ingress by hand is the actual chore.
function yamlQuote(v) {
  return /^[A-Za-z0-9._/-]+$/.test(v) ? v : JSON.stringify(v);
}

bind('k8sgen-generate-btn', 'click', () => {
  const resultEl = document.getElementById('k8sgen-result');
  const name = document.getElementById('k8sgen-name').value.trim();
  const image = document.getElementById('k8sgen-image').value.trim();
  const port = parseInt(document.getElementById('k8sgen-port').value, 10);
  const replicas = parseInt(document.getElementById('k8sgen-replicas').value, 10);
  const svcType = document.getElementById('k8sgen-svctype').value;
  const host = document.getElementById('k8sgen-host').value.trim();

  if (!name) { resultEl.className = 'result-box result-error'; resultEl.textContent = 'App name is required.'; return; }
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'App name must be a valid RFC 1123 label: lowercase alphanumerics and "-", starting and ending alphanumeric.';
    return;
  }
  if (!image) { resultEl.className = 'result-box result-error'; resultEl.textContent = 'Container image is required.'; return; }
  if (!isFinite(port) || port < 1 || port > 65535) { resultEl.className = 'result-box result-error'; resultEl.textContent = 'Container port must be 1-65535.'; return; }
  const reps = isFinite(replicas) && replicas > 0 ? replicas : 1;

  const warn = [];
  if (!image.includes(':') || image.endsWith(':latest')) warn.push('# WARNING: image has no tag or uses :latest - pin a digest or version for reproducible rollouts.');

  const out = [];
  if (warn.length) { out.push(warn.join('\n')); out.push(''); }
  out.push('apiVersion: apps/v1');
  out.push('kind: Deployment');
  out.push('metadata:');
  out.push('  name: ' + name);
  out.push('  labels:');
  out.push('    app: ' + name);
  out.push('spec:');
  out.push('  replicas: ' + reps);
  out.push('  selector:');
  out.push('    matchLabels:');
  out.push('      app: ' + name);
  out.push('  template:');
  out.push('    metadata:');
  out.push('      labels:');
  out.push('        app: ' + name);
  out.push('    spec:');
  out.push('      containers:');
  out.push('        - name: ' + name);
  out.push('          image: ' + yamlQuote(image));
  out.push('          ports:');
  out.push('            - containerPort: ' + port);
  out.push('          resources:');
  out.push('            requests:');
  out.push('              cpu: 100m');
  out.push('              memory: 128Mi');
  out.push('            limits:');
  out.push('              memory: 256Mi');
  out.push('          readinessProbe:');
  out.push('            httpGet:');
  out.push('              path: /healthz');
  out.push('              port: ' + port);
  out.push('          securityContext:');
  out.push('            allowPrivilegeEscalation: false');
  out.push('            runAsNonRoot: true');
  out.push('            capabilities:');
  out.push('              drop: ["ALL"]');
  out.push('---');
  out.push('apiVersion: v1');
  out.push('kind: Service');
  out.push('metadata:');
  out.push('  name: ' + name);
  out.push('spec:');
  out.push('  type: ' + svcType);
  out.push('  selector:');
  out.push('    app: ' + name);
  out.push('  ports:');
  out.push('    - port: 80');
  out.push('      targetPort: ' + port);
  out.push('      protocol: TCP');
  if (host) {
    out.push('---');
    out.push('apiVersion: networking.k8s.io/v1');
    out.push('kind: Ingress');
    out.push('metadata:');
    out.push('  name: ' + name);
    out.push('spec:');
    out.push('  rules:');
    out.push('    - host: ' + yamlQuote(host));
    out.push('      http:');
    out.push('        paths:');
    out.push('          - path: /');
    out.push('            pathType: Prefix');
    out.push('            backend:');
    out.push('              service:');
    out.push('                name: ' + name);
    out.push('                port:');
    out.push('                  number: 80');
  }
  resultEl.className = 'result-box result-success';
  resultEl.textContent = out.join('\n');
});


// ---------- Config Diff (JSON / YAML) ----------
// A generic line-based diff is a one-liner. A STRUCTURAL diff is not: it
// ignores key order and formatting and reports paths, which is what you
// actually want when comparing two manifests or two values.yaml files.
function sdType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
function sdFormat(v) {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}
function structDiff(a, b, path, out) {
  const ta = sdType(a), tb = sdType(b);
  if (ta !== tb) { out.push(['~', path, sdFormat(a) + '  ->  ' + sdFormat(b)]); return; }
  if (ta === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const p = path ? path + '.' + k : k;
      if (!(k in a)) out.push(['+', p, sdFormat(b[k])]);
      else if (!(k in b)) out.push(['-', p, sdFormat(a[k])]);
      else structDiff(a[k], b[k], p, out);
    }
    return;
  }
  if (ta === 'array') {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const p = path + '[' + i + ']';
      if (i >= a.length) out.push(['+', p, sdFormat(b[i])]);
      else if (i >= b.length) out.push(['-', p, sdFormat(a[i])]);
      else structDiff(a[i], b[i], p, out);
    }
    return;
  }
  if (a !== b) out.push(['~', path, sdFormat(a) + '  ->  ' + sdFormat(b)]);
}

bind('structdiff-run-btn', 'click', () => {
  const resultEl = document.getElementById('structdiff-result');
  const leftRaw = document.getElementById('structdiff-left').value.trim();
  const rightRaw = document.getElementById('structdiff-right').value.trim();
  if (!leftRaw || !rightRaw) {
    resultEl.className = 'result-box result-idle';
    resultEl.textContent = 'Paste a document into both sides.';
    return;
  }
  let left, right;
  try { left = parseAsJsonOrYaml(leftRaw).data; }
  catch (e) { resultEl.className = 'result-box result-error'; resultEl.textContent = 'Left side: ' + e.message; return; }
  try { right = parseAsJsonOrYaml(rightRaw).data; }
  catch (e) { resultEl.className = 'result-box result-error'; resultEl.textContent = 'Right side: ' + e.message; return; }

  const out = [];
  structDiff(left, right, '', out);
  if (!out.length) {
    resultEl.className = 'result-box result-success';
    resultEl.textContent = 'Structurally identical. Key order and formatting were ignored.';
    return;
  }
  const added = out.filter((d) => d[0] === '+').length;
  const removed = out.filter((d) => d[0] === '-').length;
  const changed = out.filter((d) => d[0] === '~').length;
  const lines = [`${out.length} difference(s): ${added} added, ${removed} removed, ${changed} changed.`, ''];
  for (const [sign, p, detail] of out) lines.push(sign + ' ' + (p || '(root)') + ': ' + detail);
  resultEl.className = 'result-box result-success tf-output';
  resultEl.textContent = lines.join('\n');
});

// ---------- VPC Subnet Planner ----------
// Splitting a VPC CIDR into per-AZ subnets, and remembering that AWS takes
// five addresses out of every subnet, is a recurring design chore with no
// CLI equivalent.
function spIpToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !isFinite(p) || p < 0 || p > 255)) throw new Error('Invalid IPv4 address: ' + ip);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
function spIntToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

bind('subnetplanner-plan-btn', 'click', () => {
  const resultEl = document.getElementById('subnetplanner-result');
  const cidr = document.getElementById('subnetplanner-cidr').value.trim();
  const newPrefix = parseInt(document.getElementById('subnetplanner-prefix').value, 10);
  const cloud = document.getElementById('subnetplanner-cloud').value;

  const m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!m) { resultEl.className = 'result-box result-error'; resultEl.textContent = 'Enter a CIDR block like 10.0.0.0/16'; return; }
  const basePrefix = parseInt(m[2], 10);
  if (basePrefix < 0 || basePrefix > 32) { resultEl.className = 'result-box result-error'; resultEl.textContent = 'Base prefix must be 0-32.'; return; }
  if (!isFinite(newPrefix) || newPrefix < basePrefix || newPrefix > 32) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'Subnet prefix must be between the base prefix (/' + basePrefix + ') and /32.';
    return;
  }
  let baseInt;
  try { baseInt = spIpToInt(m[1]); } catch (e) { resultEl.className = 'result-box result-error'; resultEl.textContent = e.message; return; }

  const count = Math.pow(2, newPrefix - basePrefix);
  if (count > 256) {
    resultEl.className = 'result-box result-error';
    resultEl.textContent = 'That split produces ' + count.toLocaleString() + ' subnets. Narrow the range (max 256 shown).';
    return;
  }
  const size = Math.pow(2, 32 - newPrefix);
  const maskInt = count === 1 ? baseInt : (baseInt & (((-1) << (32 - basePrefix)) >>> 0)) >>> 0;
  const reserved = cloud === 'aws' ? 5 : cloud === 'azure' ? 5 : 2;
  const usable = Math.max(0, size - reserved);

  const lines = [];
  lines.push(cidr + ' split into ' + count + ' x /' + newPrefix + ' subnet(s)');
  lines.push(cloud === 'plain'
    ? 'Plain IPv4: network + broadcast reserved, so ' + usable.toLocaleString() + ' usable host(s) each.'
    : (cloud === 'aws' ? 'AWS' : 'Azure') + ' reserves 5 addresses per subnet, so ' + usable.toLocaleString() + ' usable host(s) each.');
  lines.push('');
  lines.push('#    CIDR'.padEnd(26) + 'Range'.padEnd(34) + 'Usable');
  for (let i = 0; i < count; i++) {
    const net = (maskInt + i * size) >>> 0;
    const last = (net + size - 1) >>> 0;
    const label = String(i + 1).padEnd(5);
    const c = (spIntToIp(net) + '/' + newPrefix).padEnd(21);
    const range = (spIntToIp(net) + ' - ' + spIntToIp(last)).padEnd(34);
    lines.push(label + c + range + usable.toLocaleString());
  }
  resultEl.className = 'result-box result-success tf-output';
  resultEl.textContent = lines.join('\n');
});


// ---------- Nav filter ----------
// 36 tools in one sidebar is a wall of text; this narrows it as you type and
// hides any category left with nothing in it.
bind('nav-filter', 'input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('.nav-group').forEach((group) => {
    let groupHas = false;
    group.querySelectorAll('.tab-btn').forEach((btn) => {
      const hay = (btn.textContent + ' ' + (btn.dataset.kw || '')).toLowerCase();
      const hit = !q || hay.includes(q);
      btn.hidden = !hit;
      if (hit) { groupHas = true; shown++; }
    });
    group.hidden = !groupHas;
    if (q && groupHas) group.open = true;
  });
  let empty = document.getElementById('nav-empty');
  if (!shown) {
    if (!empty) {
      empty = document.createElement('p');
      empty.id = 'nav-empty';
      empty.className = 'nav-empty';
      document.getElementById('tool-nav').appendChild(empty);
    }
    empty.textContent = 'No tool matches "' + e.target.value.trim() + '".';
    empty.hidden = false;
  } else if (empty) {
    empty.hidden = true;
  }
});

// ---------- Theme toggle ----------
// Dark by default; the choice is remembered per browser. Both themes use the
// same brand palette, only the ground changes.
(function () {
  let stored = null;
  try { stored = localStorage.getItem('toolbox-theme'); } catch (err) { /* private mode */ }
  if (stored === 'light' || stored === 'dark') document.documentElement.setAttribute('data-theme', stored);
  bind('theme-toggle', 'click', () => {
    const current = document.documentElement.getAttribute('data-theme')
      || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('toolbox-theme', next); } catch (err) { /* private mode */ }
  });
})();
