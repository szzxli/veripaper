/* veripaper regression: in-page project dialogs + onSwitch coordination.
 * Evals web/project.js with DOM/localStorage stubs, clicks the project-bar
 * buttons, and drives the modal. A dead button (no dialog) fails loudly.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkEl(tag) {
  const el = {
    tag: tag || 'div', children: [], style: {}, dataset: {},
    value: '', textContent: '', innerHTML: '', type: '',
    _listeners: {},
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    click() { (this._listeners.click || []).forEach(f => f({ target: this })); },
    focus() {}, select() {},
    querySelectorAll() { return []; },
    setAttribute() {},
  };
  return el;
}
// find descendant by predicate (depth-first)
function find(el, pred) {
  if (pred(el)) return el;
  for (const c of el.children || []) { const r = find(c, pred); if (r) return r; }
  return null;
}

const store = {};
const els = {};
const body = mkEl('body');
const sandbox = {
  console,
  setTimeout: (fn) => 0, clearTimeout: () => {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  document: {
    readyState: 'complete',
    addEventListener: () => {},
    getElementById: id => (els[id] = els[id] || mkEl('#' + id)),
    createElement: t => mkEl(t),
    body,
  },
  window: {},
  navigator: {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'project.js'), 'utf8'), sandbox, { filename: 'project.js' });

const VP = sandbox.window.VP;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); };
};
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  console.log('— project dialogs —');
  ok('VP exposed', !!VP && typeof VP.create === 'function');
  ok('vpPrompt exposed', typeof sandbox.window.vpPrompt === 'function');
  ok('vpConfirm exposed', typeof sandbox.window.vpConfirm === 'function');
  ok('one default project', VP.list().length === 1);

  // 1. + New -> dialog appears -> type name -> OK -> project created + active
  els['pj-new'].click();
  await tick();
  let ov = body.children.find(c => c._listeners.click);
  ok('new: dialog opens (not a dead button)', !!ov, 'body children: ' + body.children.length);
  let input = find(ov, e => e.tag === 'input');
  ok('new: dialog has text input', !!input);
  input.value = 'QA Test';
  let okBtn = find(ov, e => e.tag === 'button' && e.textContent === 'OK');
  okBtn.click();
  await tick(); await tick();
  ok('new: dialog closed', body.children.length === 0);
  ok('new: project created', VP.list().some(p => p.name === 'QA Test'));
  ok('new: created project is active', VP.active().name === 'QA Test');

  // 2. Cancel path: dialog -> Cancel -> no new project
  const n0 = VP.list().length;
  els['pj-new'].click(); await tick();
  ov = body.children.find(c => c._listeners.click);
  const cancelBtn = find(ov, e => e.tag === 'button' && e.textContent === 'Cancel');
  cancelBtn.click(); await tick(); await tick();
  ok('new-cancel: no project added', VP.list().length === n0);

  // 3. Rename
  els['pj-rename'].click(); await tick();
  ov = body.children.find(c => c._listeners.click);
  input = find(ov, e => e.tag === 'input');
  ok('rename: input prefilled with current name', input && input.value === 'QA Test', input && input.value);
  input.value = 'QA Test 2';
  find(ov, e => e.tag === 'button' && e.textContent === 'OK').click();
  await tick(); await tick();
  ok('rename: applied', VP.active().name === 'QA Test 2');

  // 4. Escape key cancels (keydown on document not needed — input handles it)
  els['pj-rename'].click(); await tick();
  ov = body.children.find(c => c._listeners.click);
  input = find(ov, e => e.tag === 'input');
  (input._listeners.keydown || []).forEach(f => f({ key: 'Escape', stopPropagation() {} }));
  await tick(); await tick();
  ok('rename-escape: dialog closed, name kept', body.children.length === 0 && VP.active().name === 'QA Test 2');

  // 5. Delete with danger styling
  els['pj-del'].click(); await tick();
  ov = body.children.find(c => c._listeners.click);
  const delBtn = find(ov, e => e.tag === 'button' && e.textContent === 'Delete');
  ok('delete: danger-styled confirm shown', !!delBtn && /8c2f1b/.test(delBtn.style.cssText || ''));
  delBtn.click(); await tick(); await tick();
  ok('delete: project removed', !VP.list().some(p => p.name === 'QA Test 2'));

  console.log('— onSwitch coordination —');
  let switched = 0;
  VP.onSwitch(() => { switched++; });
  const a = VP.create('Proj A');
  VP.setActive(a.id);           // create() already made it active; switch to first then back
  const first = VP.list()[0];
  VP.setActive(first.id);
  const s1 = switched;
  VP.update(p => { p.note = 'x'; });   // data update, NOT a switch
  ok('switch fires on activeId change', s1 >= 1, 'switches: ' + switched);
  ok('data update does not fire switch', switched === s1, 'switches: ' + switched);

  console.log('— persistence —');
  const raw = store['veripaper.projects.v1'];
  ok('localStorage written', !!raw && raw.includes('Proj A'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
