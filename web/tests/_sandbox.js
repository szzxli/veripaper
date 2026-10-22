/* Shared test sandbox: evaluates web/ground.js with a stubbed DOM, an
 * injectable fetch and an in-memory localStorage. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ground.js'), 'utf8');

function mkEl() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, checked: true, style: {}, dataset: {},
    addEventListener() {}, click() {}, scrollIntoView() {}, appendChild() {}, remove() {},
  };
}
function resp(status, body, headers) {
  const h = headers || {};
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: n => { const k = Object.keys(h).find(x => x.toLowerCase() === String(n).toLowerCase()); return k ? h[k] : null; } },
    json: async () => { if (typeof body === 'string') throw new SyntaxError('not json'); return body; },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}
function makeSandbox(fetchImpl, opts) {
  opts = opts || {};
  const store = {};
  const calls = [];
  const sandbox = {
    console,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
    document: {
      readyState: 'complete', addEventListener: () => {},
      getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(),
    },
    window: {}, navigator: {}, location: { href: '' },
    fetch: async (url, init) => { calls.push(String(url)); return (fetchImpl || (async () => resp(404, {})))(String(url), init); },
    URL, URLSearchParams, Blob: function () {}, AbortController,
  };
  if (opts.storage !== false) {
    sandbox.localStorage = {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
  }
  if (opts.nliLoader) sandbox.window.vpNliLoader = opts.nliLoader;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'ground.js' });
  sandbox.__calls = calls;
  return sandbox;
}
function harness() {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ok  ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
  };
  const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { ok, done };
}
module.exports = { makeSandbox, resp, harness, SRC };
