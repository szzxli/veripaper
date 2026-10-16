/* veripaper — project workspace.
 * One project carries context across the whole chain:
 * idea (§0) → checklist (§6) → venues (§7) → grounding (§1)
 * → reviews (§8) → submissions (§9) → acceptance.
 * Stored in localStorage. Loaded FIRST so other modules can call VP.*.
 */
'use strict';

const PJ_KEY = 'veripaper.projects.v1';

function pjBlank(name) {
  return {
    id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: name || 'Untitled project',
    created: new Date().toISOString(),
    idea: null,            // {text, heat, trend, total, venues, papers, judgment}
    paperType: 'empirical-ml',
    targetVenue: 'generic',
    checklist: {},         // "type|venue|idx" -> true
    venueShortlist: [],    // [{name, url, why}]
    groundRuns: [],        // [{at, total, verified, cited, unverified, stale}]
    submissions: [],       // [{venue, status, submitted, deadline, note}]
  };
}

function pjLoadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(PJ_KEY) || 'null');
    if (s && Array.isArray(s.projects)) return s;
  } catch {}
  const p = pjBlank('My first project');
  return { activeId: p.id, projects: [p] };
}
function pjSaveStore(s) { try { localStorage.setItem(PJ_KEY, JSON.stringify(s)); } catch {} }

const VP = {
  _s: pjLoadStore(),
  _lastId: null,
  _cbs: [],
  _switchCbs: [],
  onChange(cb) { this._cbs.push(cb); },
  onSwitch(cb) { this._switchCbs.push(cb); },
  _emit() {
    pjSaveStore(this._s);
    const nowId = this._s.activeId;
    const switched = this._lastId !== null && nowId !== this._lastId;
    this._lastId = nowId;
    this._cbs.forEach(cb => { try { cb(); } catch {} });
    if (switched) this._switchCbs.forEach(cb => { try { cb(); } catch {} });
  },
  list() { return this._s.projects; },
  active() { return this._s.projects.find(p => p.id === this._s.activeId) || null; },
  create(name) {
    const p = pjBlank(name);
    this._s.projects.push(p);
    this._s.activeId = p.id;
    this._emit();
    return p;
  },
  remove(id) {
    this._s.projects = this._s.projects.filter(p => p.id !== id);
    if (!this._s.projects.length) this._s.projects.push(pjBlank('My first project'));
    if (this._s.activeId === id) this._s.activeId = this._s.projects[0].id;
    try { localStorage.removeItem('veripaper.rebuttal.v1.' + id); } catch {}
    this._emit();
  },
  rename(id, name) {
    const p = this._s.projects.find(x => x.id === id);
    if (p && name.trim()) p.name = name.trim();
    this._emit();
  },
  setActive(id) {
    if (this._s.projects.some(p => p.id === id)) { this._s.activeId = id; this._emit(); }
  },
  update(fn) { const p = this.active(); if (p) { fn(p); this._emit(); } },
  rbKey() { const p = this.active(); return 'veripaper.rebuttal.v1.' + (p ? p.id : 'none'); },
  recordGround(evidence) {
    const c = { total: 0, verified: 0, cited: 0, unverified: 0, stale: 0 };
    (evidence || []).forEach(e => {
      c.total++;
      if (e.label === 'VERIFIED') c.verified++;
      else if (e.label === 'CITED') c.cited++;
      else if (e.label === 'UNVERIFIED') c.unverified++;
      if (e.stale) c.stale++;
    });
    this.update(p => { p.groundRuns.push(Object.assign({ at: new Date().toISOString() }, c)); });
  },
};
window.VP = VP;

const pjesc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function pjSummary(p) {
  const parts = [];
  parts.push(p.idea ? 'idea ✓' : 'idea —');
  const done = Object.keys(p.checklist || {}).filter(k => p.checklist[k]).length;
  parts.push(`checklist ${done} done`);
  parts.push(p.venueShortlist && p.venueShortlist.length ? `venues ×${p.venueShortlist.length}` : 'venues —');
  parts.push(p.groundRuns.length ? `grounded ×${p.groundRuns.length}` : 'ground —');
  const subs = (p.submissions || []).filter(s => s.status === 'accepted').length;
  parts.push(subs ? `ACCEPTED ✓` : `submissions ×${(p.submissions || []).length}`);
  return parts.join(' · ');
}

/* ---------------- in-page dialog (replaces native prompt/confirm) ----------------
 * Native dialogs are silently suppressed in some contexts (automation,
 * popup blockers, some mobile browsers), leaving dead buttons. This modal
 * matches the journal aesthetic and always renders. Returns a Promise:
 *   vpPrompt(title, message, initial) -> string | null
 *   vpConfirm(title, message, okLabel) -> boolean
 */
function vpDialog(opts) {
  return new Promise(resolve => {
    const done = v => { try { document.body.removeChild(ov); } catch {} resolve(v); };
    const ov = document.createElement('div');
    ov.setAttribute('role', 'dialog');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(22,50,79,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fffdf8;border:1px solid #ddd2ba;border-top:4px solid #16324f;max-width:430px;width:100%;padding:24px 26px;font-family:Georgia,"Times New Roman",serif;color:#211d16;box-shadow:0 12px 40px rgba(22,50,79,.25)';
    const t = document.createElement('div');
    t.style.cssText = 'font-size:19px;font-weight:700;color:#16324f;margin-bottom:10px';
    t.textContent = opts.title || '';
    const m = document.createElement('div');
    m.style.cssText = 'font-size:14.5px;line-height:1.65;color:#5c554a;margin-bottom:14px';
    m.textContent = opts.message || '';
    card.appendChild(t); card.appendChild(m);
    let input = null;
    if (opts.input) {
      input = document.createElement('input');
      input.type = 'text'; input.value = opts.initial || '';
      input.style.cssText = 'width:100%;padding:10px 12px;border:1px solid #ddd2ba;background:#fff;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;color:#211d16;margin-bottom:6px';
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') done(input.value);
        else if (e.key === 'Escape') done(null);
        e.stopPropagation();
      });
      card.appendChild(input);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:14px';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:9px 20px;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-weight:600;font-size:13.5px;cursor:pointer;background:none;color:#16324f;border:1px solid #16324f';
    const okb = document.createElement('button');
    okb.textContent = opts.okLabel || 'OK';
    const danger = !!opts.danger;
    okb.style.cssText = 'padding:9px 20px;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-weight:600;font-size:13.5px;cursor:pointer;color:#fff;border:1px solid ' + (danger ? '#8c2f1b' : '#16324f') + ';background:' + (danger ? '#8c2f1b' : '#16324f');
    cancel.addEventListener('click', () => done(opts.input ? null : false));
    okb.addEventListener('click', () => done(opts.input ? (input ? input.value : '') : true));
    row.appendChild(cancel); row.appendChild(okb); card.appendChild(row);
    ov.appendChild(card);
    ov.addEventListener('click', e => { if (e.target === ov) done(opts.input ? null : false); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); done(opts.input ? null : false); }
    });
    document.body.appendChild(ov);
    if (input) { input.focus(); input.select(); } else okb.focus();
  });
}
window.vpPrompt = (title, message, initial) => vpDialog({ title, message, input: true, initial });
window.vpConfirm = (title, message, okLabel, danger) => vpDialog({ title, message, okLabel, danger });

function initProjectBar() {
  const sel = document.getElementById('pj-select');
  if (!sel) return;
  const hint = document.getElementById('pj-hint');
  const render = () => {
    const cur = VP.active();
    sel.innerHTML = VP.list().map(p =>
      `<option value="${p.id}"${p.id === (cur && cur.id) ? ' selected' : ''}>${pjesc(p.name)}</option>`).join('');
    if (hint && cur) hint.textContent = pjSummary(cur) + ' — one project carries idea → checklist → venues → grounding → reviews → acceptance.';
    // notify dependent modules
    if (window.PJ_refresh) window.PJ_refresh();
  };
  sel.addEventListener('change', () => VP.setActive(sel.value));
  document.getElementById('pj-new').addEventListener('click', async () => {
    const name = await window.vpPrompt('New project', 'Give this research project a name. It will carry your idea, checklist, venues, ground runs and submissions.', 'New project');
    if (name !== null) VP.create(name.trim() || 'Untitled project');
  });
  document.getElementById('pj-rename').addEventListener('click', async () => {
    const cur = VP.active(); if (!cur) return;
    const name = await window.vpPrompt('Rename project', 'Rename this project.', cur.name);
    if (name !== null && name.trim()) VP.rename(cur.id, name);
  });
  document.getElementById('pj-del').addEventListener('click', async () => {
    const cur = VP.active(); if (!cur) return;
    const yes = await window.vpConfirm('Delete project',
      `Delete "${cur.name}"? Its idea, checklist, venue shortlist, ground runs, submissions and rebuttal state go with it. This cannot be undone.`,
      'Delete', true);
    if (yes) VP.remove(cur.id);
  });
  VP.onChange(render);
  render();
}

/* ---------------- §9 submissions tracker ---------------- */

const SUB_STATUS = ['drafting', 'submitted', 'under review', 'revision', 'accepted', 'rejected'];

function initSubmissions() {
  const venue = document.getElementById('sub-venue');
  if (!venue) return;
  const status = document.getElementById('sub-status');
  const submitted = document.getElementById('sub-date');
  const deadline = document.getElementById('sub-deadline');
  const note = document.getElementById('sub-note');
  const out = document.getElementById('sub-list');
  const render = () => {
    const p = VP.active();
    const subs = (p && p.submissions) || [];
    if (!subs.length) { out.innerHTML = '<p class="hint">No submissions yet. Add one when the draft goes out.</p>'; return; }
    out.innerHTML = subs.map((s, i) =>
      `<div class="finding" style="border-top-color:var(--bronze)"><p class="claim"><b>${pjesc(s.venue)}</b> ` +
      `<span class="label ${s.status === 'accepted' ? 'l-verified' : s.status === 'rejected' ? 'l-unverified' : 'l-cited'}">${pjesc(s.status.toUpperCase())}</span></p>` +
      `<div class="detail">` +
      (s.submitted ? `submitted ${pjesc(s.submitted)} · ` : '') +
      (s.deadline ? `deadline <b>${pjesc(s.deadline)}</b> · ` : '') +
      (s.note ? pjesc(s.note) : '') +
      `<div class="btnrow" style="margin-top:8px"><select data-sub="st" data-i="${i}" style="padding:6px;border:1px solid var(--line);font-family:var(--sans);font-size:13px">` +
      SUB_STATUS.map(x => `<option${x === s.status ? ' selected' : ''}>${x}</option>`).join('') +
      `</select><button class="btn ghost" data-sub="del" data-i="${i}" style="padding:6px 14px;font-size:13px">Remove</button></div>` +
      `</div></div>`).join('');
    out.querySelectorAll('[data-sub="st"]').forEach(el => el.addEventListener('change', e => {
      VP.update(p => { p.submissions[+e.target.dataset.i].status = e.target.value; });
    }));
    out.querySelectorAll('[data-sub="del"]').forEach(el => el.addEventListener('click', e => {
      VP.update(p => { p.submissions.splice(+e.target.dataset.i, 1); });
    }));
  };
  document.getElementById('sub-add').addEventListener('click', () => {
    if (!venue.value.trim()) { venue.focus(); return; }
    VP.update(p => { p.submissions.push({ venue: venue.value.trim(), status: status.value, submitted: submitted.value, deadline: deadline.value, note: note.value.trim() }); });
    venue.value = ''; note.value = ''; submitted.value = ''; deadline.value = '';
  });
  VP.onChange(render);
  window.PJ_refresh = () => { render(); if (window.RB_refresh) window.RB_refresh(); };
  render();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', () => { initProjectBar(); initSubmissions(); });
else { initProjectBar(); initSubmissions(); }
