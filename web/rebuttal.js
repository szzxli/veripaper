/* veripaper §8 — rebuttal manager (Phase 6).
 * Paste reviews → split into points → classify → response template →
 * status tracking (localStorage) → export. Pure frontend.
 * The tool structures the work; the science in the responses is yours.
 */
'use strict';

const RB_CATS = [
  ['methodology', /method|approach|algorithm|architect|model design|framework/i],
  ['experiments', /experiment|baseline|ablation|dataset|result|evaluat|benchmark|sota|comparison/i],
  ['theory', /proof|theorem|assumption|lemma|bound|convergence/i],
  ['novelty', /novel|incremental|contribution|originality|marginal/i],
  ['related work', /related work|citation|prior work|missing ref|literature/i],
  ['clarity', /unclear|confus|writing|typo|presentation|figure|notation|readab/i],
  ['reproducibility', /reproduc|code|implementation|hyperparameter|detail/i],
  ['ethics', /ethic|bias|privacy|dual.?use|fairness/i],
];
function rbClassify(text) {
  for (const [cat, re] of RB_CATS) if (re.test(text)) return cat;
  return 'other';
}

function rbParse(raw) {
  // split into reviewer blocks, then into numbered points
  const blocks = [];
  const lines = raw.split('\n');
  let cur = { reviewer: 'Reviewer', points: [] };
  const revRe = /^\s*(reviewer\s*#?\s*\d+|r\s*\d+)\s*[:\-–.]?\s*(.*)$/i;
  const ptRe = /^\s*(?:Q\s?\d+|question\s?\d+|\d+\s*[.)]\s*|[-*•]\s+)(.+)$/i;
  for (const ln of lines) {
    const rm = revRe.exec(ln);
    if (rm) {
      if (cur.buf && cur.buf.trim()) cur.points.push(cur.buf.trim());
      if (cur.points.length) blocks.push(cur);
      cur = { reviewer: rm[1].replace(/\s+/g, ' ').trim(), points: [], buf: '' };
      if (rm[2]) cur.buf = rm[2];
      continue;
    }
    const pm = ptRe.exec(ln);
    if (pm) {
      if (cur.buf && cur.buf.trim()) cur.points.push(cur.buf.trim());
      cur.buf = pm[1];
    } else {
      cur.buf = (cur.buf ? cur.buf + ' ' : '') + ln.trim();
    }
  }
  if (cur.buf && cur.buf.trim()) cur.points.push(cur.buf.trim());
  if (cur.points.length || blocks.length === 0) blocks.push(cur);
  // flatten with ids
  const out = [];
  blocks.forEach((b, bi) => {
    b.points.forEach((p, pi) => {
      if (p.length < 8) return;
      out.push({ id: `r${bi}p${pi}`, reviewer: b.reviewer, text: p, cat: rbClassify(p) });
    });
  });
  return out;
}

function rbKey() { return (window.VP ? VP.rbKey() : 'veripaper.rebuttal.v1.none'); }
/* Persisted doc shape: {state, raw, points}. Old flat-state keys are normalized. */
function normRb(o) {
  if (o && typeof o === 'object' && 'state' in o && 'points' in o) return o;
  return { state: (o && typeof o === 'object') ? o : {}, raw: '', points: [] };
}
function rbLoad() {
  try {
    const k = rbKey();
    let raw = localStorage.getItem(k);
    if (!raw) {
      // one-time migration from the pre-project global key
      const legacy = localStorage.getItem('veripaper.rebuttal.v1');
      if (legacy && k !== 'veripaper.rebuttal.v1') { localStorage.setItem(k, legacy); return normRb(JSON.parse(legacy)); }
    }
    return normRb(JSON.parse(raw || '{}'));
  } catch { return { state: {}, raw: '', points: [] }; }
}
function rbSave(doc) { try { localStorage.setItem(rbKey(), JSON.stringify(doc)); } catch {} }

const RB_TEMPLATE = pt =>
`We thank the reviewer for raising this point regarding ${pt.cat}.

[Your response: address the concern directly, 2-4 sentences.]

Evidence: [table / figure / experiment / proof sketch supporting the answer]

Change made: [revised §X / added Table N / clarified p. Y — or "no change, because …"]`;

/* ---------------- UI ---------------- */

function initRebuttal() {
  const ta = document.getElementById('rb-input');
  const btn = document.getElementById('rb-btn');
  const clear = document.getElementById('rb-clear');
  const out = document.getElementById('rb-result');
  const prog = document.getElementById('rb-progress');
  if (!ta) return;
  let doc = rbLoad();
  let state = doc.state || {};
  // auto-restore: refresh or code update lands back on the previous session
  let points = Array.isArray(doc.points) ? doc.points : [];
  if (points.length && doc.raw) ta.value = doc.raw;
  const persist = () => rbSave({ state, raw: doc.raw, points });

  const statusLabel = { pending: 'l-stale', addressed: 'l-verified', declined: 'l-unverified' };

  function render() {
    if (!points.length) { out.innerHTML = ''; prog.textContent = ''; return; }
    const counts = { pending: 0, addressed: 0, declined: 0 };
    points.forEach(p => counts[state[p.id] && state[p.id].status || 'pending']++);
    let html = `<div class="finding"><p class="claim"><b>${points.length} points</b> — ` +
      `<span class="label l-verified">${counts.addressed} addressed</span> ` +
      `<span class="label l-stale">${counts.pending} pending</span> ` +
      `<span class="label l-unverified">${counts.declined} declined</span></p>`;
    html += `<div class="detail"><button id="rb-export" class="btn ghost" style="padding:7px 16px;font-size:13px">Copy all responses</button></div></div>`;
    points.forEach((p, i) => {
      const st = state[p.id] || { status: 'pending', resp: RB_TEMPLATE(p) };
      html += `<div class="finding" data-pid="${p.id}">` +
        `<p class="claim"><b>${i + 1}. [${escRb(p.reviewer)} · ${escRb(p.cat)}]</b> ` +
        `<span class="label ${statusLabel[st.status]}">${st.status.toUpperCase()}</span></p>` +
        `<div class="detail"><i>"${escRb(p.text.slice(0, 220))}${p.text.length > 220 ? '…' : ''}"</i>` +
        `<textarea data-r="resp" rows="6" style="width:100%;margin-top:8px;padding:10px;border:1px solid var(--line);font-family:var(--sans);font-size:13px">${escRb(st.resp)}</textarea>` +
        `<div class="btnrow" style="margin-top:8px">` +
        `<button class="btn ghost" data-r="addressed" style="padding:6px 14px;font-size:13px">Mark addressed</button>` +
        `<button class="btn ghost" data-r="declined" style="padding:6px 14px;font-size:13px">Decline w/ reason</button>` +
        `<button class="btn ghost" data-r="pending" style="padding:6px 14px;font-size:13px">Reopen</button>` +
        `</div></div></div>`;
    });
    out.innerHTML = html;
    prog.textContent = `${counts.addressed}/${points.length} addressed`;
    out.querySelectorAll('.finding[data-pid]').forEach(card => {
      const pid = card.dataset.pid;
      card.querySelector('[data-r="resp"]').addEventListener('input', e => {
        state[pid] = state[pid] || { status: 'pending', resp: '' };
        state[pid].resp = e.target.value; persist();
      });
      card.querySelectorAll('button[data-r]').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.r;
        state[pid] = state[pid] || { status: 'pending', resp: RB_TEMPLATE(points.find(x => x.id === pid)) };
        state[pid].status = v; persist(); render();
      }));
    });
    const exp = document.getElementById('rb-export');
    if (exp) exp.addEventListener('click', () => {
      const md = points.map((p, i) => {
        const st = state[p.id] || { status: 'pending', resp: RB_TEMPLATE(p) };
        return `### ${i + 1}. ${p.reviewer} — ${p.cat} [${st.status}]\n\n> ${p.text}\n\n${st.resp}`;
      }).join('\n\n---\n\n');
      navigator.clipboard.writeText('# Rebuttal\n\n' + md).then(
        () => { exp.textContent = 'Copied'; setTimeout(() => exp.textContent = 'Copy all responses', 1500); },
        () => { exp.textContent = 'Copy failed'; });
    });
  }

  btn.addEventListener('click', () => {
    const raw = ta.value.trim();
    if (raw.length < 30) { out.innerHTML = '<p class="hint">Paste the reviews first — a few sentences at minimum.</p>'; return; }
    points = rbParse(raw);
    if (!points.length) { out.innerHTML = '<p class="hint">Could not split into points. Try numbering them (1. 2. 3.) or prefixing reviewers (Reviewer 1: …).</p>'; return; }
    points.forEach(p => { if (!state[p.id]) state[p.id] = { status: 'pending', resp: RB_TEMPLATE(p) }; });
    doc.raw = raw; doc.points = points; persist();
    render();
  });
  clear.addEventListener('click', async () => {
    const yes = window.vpConfirm
      ? await window.vpConfirm('Clear rebuttal state', 'Clear all rebuttal points and drafted responses for the current project? This cannot be undone.', 'Clear', true)
      : confirm('Clear all rebuttal state?');
    if (!yes) return;
    state = {}; doc = { state, raw: '', points: [] }; persist(); points = []; ta.value = ''; render();
  });
  // re-render when the active project switches (project.js calls this)
  window.RB_refresh = () => { doc = rbLoad(); state = doc.state || {}; points = Array.isArray(doc.points) ? doc.points : []; ta.value = doc.raw || ''; render(); };
}
const escRb = s => String(s || '').replace(/[&<>"]/g,
  m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initRebuttal);
else
  initRebuttal();
