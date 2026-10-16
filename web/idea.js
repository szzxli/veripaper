/* veripaper §0 — idea evaluator ("rich vein detector").
 * Input: a 1-paragraph research idea.
 * Output: publication heat (OpenAlex, live), trend, venue distribution,
 * top-cited papers, and a BYOK LLM assessment on a strict rubric.
 * Numbers without a key; judgment with a key. Never inflates.
 */
'use strict';

const OA = 'https://api.openalex.org/works';
const OA_MAIL = 'dev@veripaper.local';
const oaSleep = ms => new Promise(r => setTimeout(r, ms));
const iesc = s => String(s || '').replace(/[&<>"]/g,
  m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

async function oaGet(params) {
  params.mailto = OA_MAIL;
  const url = OA + '?' + new URLSearchParams(params);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('OpenAlex HTTP ' + r.status);
  return r.json();
}

async function heatByYear(query, years, onStep) {
  const out = {};
  for (const y of years) {
    if (onStep) onStep(`Counting ${y} publications…`);
    try {
      const d = await oaGet({ search: query, filter: `publication_year:${y}`, 'per-page': '1' });
      out[y] = d.meta.count;
    } catch { out[y] = null; }
    await oaSleep(350);
  }
  return out;
}

function trendLabel(counts) {
  // use last two full years; current year is partial
  const ys = Object.keys(counts).map(Number).sort();
  const full = ys.filter(y => y < new Date().getFullYear());
  if (full.length < 2) return { label: 'insufficient data', dir: 'flat' };
  const a = counts[full[full.length - 2]], b = counts[full[full.length - 1]];
  if (a == null || b == null) return { label: 'insufficient data', dir: 'flat' };
  if (a === 0) return b > 0 ? { label: 'emerging from zero', dir: 'rising' } : { label: 'no signal', dir: 'flat' };
  const r = b / a;
  if (r >= 1.25) return { label: 'rising', dir: 'rising' };
  if (r <= 0.75) return { label: 'cooling', dir: 'cooling' };
  return { label: 'steady', dir: 'flat' };
}

function veinHeuristic(total, trend) {
  // heuristic, not truth — labeled as such in the UI
  if (total == null) return 'unknown — could not reach the index';
  if (total === 0) return 'no signal — blue ocean or no traction; verify with an expert';
  if (total < 20) return 'thin — few publications; high risk, high novelty potential';
  if (trend.dir === 'rising' && total < 800) return 'rich-vein candidate — growing attention, not yet saturated';
  if (total >= 800 && trend.dir !== 'rising') return 'crowded — narrow the angle or find a sub-gap';
  return 'moderate — viable, differentiation matters';
}

async function topVenues(query, onStep) {
  if (onStep) onStep('Finding where it gets published…');
  try {
    const d = await oaGet({
      search: query, filter: 'from_publication_date:2023-01-01',
      'group_by': 'primary_location.source.display_name', 'per-page': '1',
    });
    return (d.group_by || []).slice(0, 5).map(g => ({ venue: g.key, count: g.count }));
  } catch { return null; }
}

async function topPapers(query, onStep) {
  if (onStep) onStep('Finding the most-cited papers…');
  try {
    const d = await oaGet({
      search: query, filter: 'from_publication_date:2023-01-01',
      sort: 'cited_by_count:desc', 'per-page': '5',
      select: 'id,doi,title,publication_year,cited_by_count',
    });
    return (d.results || []).map(p => ({
      title: p.title, year: p.publication_year,
      cited: p.cited_by_count, doi: p.doi,
    }));
  } catch { return null; }
}

const IDEA_SYSTEM = `You evaluate a research idea for academic potential. Be strict and honest; never inflate.
You receive: the idea text, yearly publication counts on the topic, top venues, and the 5 most-cited recent papers.
Reply with exactly these lines, no extra text:
NOVELTY: <1-5> | <one sentence: what exists vs what is new; write UNCERTAIN if unclear>
FEASIBILITY: <1-5> | <one sentence: can a typical lab execute this>
ACADEMIC_IMPACT: <1-5> | <one sentence>
SOCIAL_VALUE: <1-5> | <one sentence>
VERDICT: <RICH_VEIN | NARROW_IT | BLUE_OCEAN_VERIFY | WEAK> | <one sentence>
Rules: 5 = exceptional, 1 = poor. If the idea is vague, say so and score feasibility low. Base novelty ONLY on the papers listed; never invent prior work.`;

async function judgeIdea(idea, heat, venues, papers, apiKey, model) {
  const ctx = [
    `IDEA: ${idea}`,
    `YEARLY COUNTS: ${JSON.stringify(heat)}`,
    `TOP VENUES: ${venues ? venues.map(v => `${v.venue} (${v.count})`).join('; ') : 'unavailable'}`,
    `TOP PAPERS: ${papers ? papers.map(p => `"${p.title}" (${p.year}, ${p.cited} cites)`).join('; ') : 'unavailable'}`,
  ].join('\n');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model || 'openai/gpt-4o-mini', temperature: 0.3, max_tokens: 400,
        messages: [
          { role: 'system', content: IDEA_SYSTEM },
          { role: 'user', content: ctx },
        ],
      }),
    });
    if (!r.ok) return { error: `LLM request failed (HTTP ${r.status})` };
    const text = ((await r.json()).choices[0].message.content || '').trim();
    const get = k => {
      const m = new RegExp('^' + k + ':\\s*(.+)$', 'im').exec(text);
      return m ? m[1].trim() : null;
    };
    const out = {};
    for (const k of ['NOVELTY', 'FEASIBILITY', 'ACADEMIC_IMPACT', 'SOCIAL_VALUE', 'VERDICT']) out[k] = get(k);
    if (!out.VERDICT) return { error: 'unparseable LLM output' };
    return out;
  } catch (e) {
    return { error: 'LLM request failed: ' + (e.message || e) };
  } finally { clearTimeout(to); }
}

/* ---------------- UI ---------------- */

const IDEA_SAMPLE = `Using retrieval-augmented generation to verify citations in academic drafts: each claim is checked against the cited paper's abstract, with honest downgrade when support is uncertain.`;

function renderIdea(ev) {
  const { heat, trend, total, venues, papers, judgment, keyError } = ev;
  let html = '';
  // heat
  html += `<div class="finding"><p class="claim"><b>Publication heat</b> (OpenAlex, live)</p><div class="detail">`;
  const ys = Object.keys(heat).map(Number).sort();
  const parts = ys.map(y => `${y}: ${heat[y] == null ? 'n/a' : heat[y].toLocaleString()}`);
  html += parts.join(' &nbsp;·&nbsp; ') + '<br>';
  html += `Trend: <b>${iesc(trend.label)}</b> &nbsp;·&nbsp; Heuristic read: <b>${iesc(veinHeuristic(total, trend))}</b>`;
  html += `<br><span style="font-size:12px">Heuristic only — a number, not a verdict. 2026 is a partial year.</span></div></div>`;
  // venues
  html += `<div class="finding"><p class="claim"><b>Where it gets published</b></p><div class="detail">`;
  html += venues ? venues.map(v => `${iesc(v.venue)} (${v.count.toLocaleString()})`).join('<br>') : 'unavailable — the index did not respond';
  html += `</div></div>`;
  // papers
  html += `<div class="finding"><p class="claim"><b>Most-cited recent papers</b> — check your idea against these first</p><div class="detail">`;
  if (papers && papers.length) {
    html += '<ol style="margin-left:18px">' + papers.map(p =>
      `<li><b>${iesc(p.title)}</b> (${p.year || 'n/a'}, ${p.cited == null ? 'n/a' : p.cited.toLocaleString()} cites)` +
      (p.doi ? ` — <a href="https://doi.org/${iesc(p.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))}" target="_blank" rel="noopener" style="color:var(--navy)">doi</a>` : '') + '</li>'
    ).join('') + '</ol>';
  } else html += 'unavailable — the index did not respond';
  html += `</div></div>`;
  // judgment
  html += `<div class="finding"><p class="claim"><b>Assessment</b></p><div class="detail">`;
  if (judgment && !judgment.error) {
    const rows = [['Novelty', 'NOVELTY'], ['Feasibility', 'FEASIBILITY'], ['Academic impact', 'ACADEMIC_IMPACT'], ['Social value', 'SOCIAL_VALUE']];
    html += rows.map(([label, k]) => `<div><b>${label}:</b> ${iesc(judgment[k] || 'n/a')}</div>`).join('');
    html += `<div style="margin-top:8px"><span class="label l-cited">${iesc((judgment.VERDICT || '').split('|')[0].trim())}</span> ${iesc((judgment.VERDICT || '').split('|').slice(1).join('|').trim())}</div>`;
  } else if (keyError) {
    html += `<span style="color:var(--crimson)">${iesc(keyError)}</span>`;
  } else {
    html += `Add an OpenRouter key above for scored judgment. Without it you still get the heat numbers, venues, and papers — the raw material for your own verdict.`;
  }
  html += `</div></div>`;
  html += `<p class="hint">Scores are a second opinion, not peer review. A low heat count can mean a blue ocean or a dead end — talk to someone in the field before committing months.</p>`;
  return html;
}

function initIdea() {
  const ta = document.getElementById('idea-input');
  const key = document.getElementById('idea-key');
  const btn = document.getElementById('idea-btn');
  const sample = document.getElementById('idea-sample');
  const prog = document.getElementById('idea-progress');
  const out = document.getElementById('idea-result');
  if (!ta) return;
  sample.addEventListener('click', () => { ta.value = IDEA_SAMPLE; });
  btn.addEventListener('click', async () => {
    const idea = ta.value.trim();
    if (idea.length < 20) { out.innerHTML = '<p class="hint">Describe the idea in 2–5 sentences first — or load the sample.</p>'; return; }
    const apiKey = key.value.trim() || null;
    btn.disabled = true; btn.textContent = 'Evaluating…'; out.innerHTML = '';
    const step = s => { prog.textContent = s; };
    try {
      const query = idea.slice(0, 300);
      const yr = new Date().getFullYear();
      const years = [yr - 3, yr - 2, yr - 1, yr];
      const heat = await heatByYear(query, years, step);
      const total = years.reduce((a, y) => a + (heat[y] || 0), 0);
      const trend = trendLabel(heat);
      const venues = await topVenues(query, step);
      await oaSleep(350);
      const papers = await topPapers(query, step);
      let judgment = null, keyError = null;
      if (apiKey) {
        step('Scoring the idea…');
        judgment = await judgeIdea(idea, heat, venues, papers, apiKey);
        if (judgment.error) { keyError = judgment.error; judgment = null; }
      }
      prog.textContent = '';
      out.innerHTML = renderIdea({ heat, trend, total, venues, papers, judgment, keyError });
    } catch (err) {
      prog.textContent = '';
      out.innerHTML = `<p class="hint" style="color:var(--crimson)">The index did not respond (${iesc(err.message || err)}). Your idea never left this page — try again in a minute.</p>`;
    }
    btn.disabled = false; btn.textContent = 'Evaluate this idea';
  });
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initIdea);
else
  initIdea();
