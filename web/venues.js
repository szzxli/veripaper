/* veripaper §7 — venue matcher (Phase 5).
 * Pure frontend: match topic keywords + paper type against venue profiles,
 * rank by transparent score, show reasons. Acceptance rates are approximate
 * and move yearly — verify on the venue site before submitting.
 */
'use strict';

/* acc: approximate recent acceptance rate; '~' = rough, 'varies' = check site */
const VENUE_DB = [
  { id: 'neurips', name: 'NeurIPS', fields: ['machine learning', 'deep learning', 'reinforcement learning', 'generative models', 'llm', 'optimization', 'theory', 'datasets', 'benchmarks'], types: ['empirical-ml', 'theory', 'systems'], acc: '~26%', cycle: 'Annual (Dec)', likes: 'Large-scale empirical results, foundational theory, datasets & benchmarks.', url: 'https://neurips.cc' },
  { id: 'icml', name: 'ICML', fields: ['machine learning', 'deep learning', 'reinforcement learning', 'theory', 'optimization', 'generative models'], types: ['empirical-ml', 'theory'], acc: '~27%', cycle: 'Annual (Jul)', likes: 'Core ML advances; strong theory and rigorous empirics.', url: 'https://icml.cc' },
  { id: 'iclr', name: 'ICLR', fields: ['deep learning', 'representation learning', 'generative models', 'llm', 'reinforcement learning'], types: ['empirical-ml', 'theory'], acc: '~32%', cycle: 'Annual (May)', likes: 'Representation learning; open review — write defensively.', url: 'https://iclr.cc' },
  { id: 'aaai', name: 'AAAI', fields: ['ai', 'machine learning', 'nlp', 'vision', 'robotics', 'reasoning', 'multi-agent'], types: ['empirical-ml', 'theory', 'systems'], acc: '~23%', cycle: 'Annual (Feb)', likes: 'Broad AI; good second home for strong ML work.', url: 'https://aaai.org' },
  { id: 'acl', name: 'ACL', fields: ['nlp', 'llm', 'language models', 'dialogue', 'translation', 'retrieval'], types: ['empirical-ml', 'survey', 'human-study'], acc: '~21%', cycle: 'Annual (Jul/Aug)', likes: 'Core NLP; reproducibility checklist enforced.', url: 'https://aclanthology.org' },
  { id: 'emnlp', name: 'EMNLP', fields: ['nlp', 'llm', 'language models', 'retrieval', 'dialogue', 'evaluation'], types: ['empirical-ml', 'survey', 'human-study'], acc: '~22%', cycle: 'Annual (Nov)', likes: 'Empirical NLP; slightly broader than ACL.', url: 'https://aclanthology.org' },
  { id: 'cvpr', name: 'CVPR', fields: ['vision', 'image', 'video', 'detection', 'segmentation', 'generative models'], types: ['empirical-ml', 'systems'], acc: '~25%', cycle: 'Annual (Jun)', likes: 'Vision SOTA with strong ablations.', url: 'https://cvpr.thecvf.com' },
  { id: 'kdd', name: 'KDD', fields: ['data mining', 'recommendation', 'graphs', 'anomaly detection', 'applied ml'], types: ['empirical-ml', 'systems'], acc: '~20%', cycle: 'Annual (Aug)', likes: 'Applied ML at scale; real-world data a plus.', url: 'https://kdd.org' },
  { id: 'www', name: 'WWW', fields: ['web', 'recommendation', 'graphs', 'social networks', 'retrieval', 'applied ml'], types: ['empirical-ml', 'systems', 'human-study'], acc: '~20%', cycle: 'Annual (Apr/May)', likes: 'Web-scale systems and measurement.', url: 'https://www2026.thewebconf.org' },
  { id: 'sigir', name: 'SIGIR', fields: ['retrieval', 'search', 'recommendation', 'rag', 'evaluation'], types: ['empirical-ml', 'human-study'], acc: '~23%', cycle: 'Annual (Jul)', likes: 'IR fundamentals; RAG verification fits well.', url: 'https://sigir.org' },
  { id: 'chi', name: 'CHI', fields: ['hci', 'human study', 'usability', 'annotation', 'interaction'], types: ['human-study', 'systems', 'survey'], acc: '~26%', cycle: 'Annual (Apr/May)', likes: 'Human-centered work; rigorous user studies.', url: 'https://chi2026.acm.org' },
  { id: 'jmlr', name: 'JMLR', fields: ['machine learning', 'theory', 'deep learning'], types: ['theory', 'empirical-ml', 'survey'], acc: 'varies', cycle: 'Rolling (journal)', likes: 'Archival ML; no deadline pressure; thorough reviews.', url: 'https://jmlr.org' },
  { id: 'tmlr', name: 'TMLR', fields: ['machine learning', 'deep learning', 'theory'], types: ['empirical-ml', 'theory', 'survey'], acc: '~30%', cycle: 'Rolling (journal)', likes: 'ML journal with open review; good for mature work.', url: 'https://jmlr.org/tmlr' },
  { id: 'nature', name: 'Nature / Science', fields: ['breakthrough', 'interdisciplinary', 'biology', 'physics', 'materials'], types: ['empirical-ml', 'human-study', 'systems'], acc: '~8%', cycle: 'Rolling (journal)', likes: 'Field-defining results with broad significance. ML-only work rarely fits.', url: 'https://nature.com' },
  { id: 'natcomm', name: 'Nature Communications', fields: ['interdisciplinary', 'applied ml', 'biology', 'materials', 'nlp'], types: ['empirical-ml', 'human-study', 'systems', 'survey'], acc: '~50%', cycle: 'Rolling (journal)', likes: 'Solid cross-disciplinary work; high bar on reporting.', url: 'https://nature.com/ncomms' },
];

function venueScore(venue, keywords, ptype) {
  let score = 0;
  const reasons = [];
  const kwHits = keywords.filter(k => venue.fields.some(f => f.includes(k) || k.includes(f)));
  if (kwHits.length) { score += kwHits.length * 2; reasons.push(`topic overlap: ${kwHits.slice(0, 3).join(', ')}`); }
  if (venue.types.includes(ptype)) { score += 3; reasons.push('paper type fits the venue'); }
  return { score, reasons };
}

function matchVenues(topic, ptype) {
  const keywords = topic.toLowerCase().split(/[^a-z0-9+]+/).filter(w => w.length > 2);
  return VENUE_DB.map(v => {
    const { score, reasons } = venueScore(v, keywords, ptype);
    return Object.assign({ score, reasons }, v);
  }).sort((a, b) => b.score - a.score);
}

/* ---------------- UI ---------------- */

function initVenues() {
  const topic = document.getElementById('vn-topic');
  const tSel = document.getElementById('vn-type');
  const btn = document.getElementById('vn-btn');
  const sample = document.getElementById('vn-sample');
  const out = document.getElementById('vn-result');
  if (!topic) return;
  sample.addEventListener('click', () => { topic.value = 'retrieval-augmented citation verification for academic drafts'; });
  btn.addEventListener('click', () => {
    const t = topic.value.trim();
    if (t.length < 4) { out.innerHTML = '<p class="hint">Describe the topic in a few words — or load the sample.</p>'; return; }
    const ranked = matchVenues(t, tSel.value).slice(0, 6);
    let html = `<div class="finding"><p class="claim"><b>Top fits</b> for "${escVn(t)}"</p><div class="detail">`;
    html += `<ol style="margin-left:18px">` + ranked.map((v, i) =>
      `<li style="margin-bottom:10px"><b><a href="${v.url}" target="_blank" rel="noopener" style="color:var(--navy)">${escVn(v.name)}</a></b> ` +
      `<span class="label ${i === 0 ? 'l-verified' : 'l-cited'}">${i === 0 ? 'BEST FIT' : 'fit ' + (i + 1)}</span><br>` +
      `<span style="font-size:12.5px">Why: ${escVn(v.reasons.join('; ') || 'general fit')} · ${escVn(v.likes)}<br>` +
      `Acceptance ≈ ${escVn(v.acc)} · ${escVn(v.cycle)}</span></li>`
    ).join('') + `</ol></div></div>`;
    html += `<p class="hint">Scoring is keyword overlap + paper-type fit — a starting filter, not a prediction. Acceptance rates move yearly; verify on the venue site. When torn between two, read last year's accepted papers in both and ask which room your paper belongs in.</p>`;
    out.innerHTML = html;
  });
}
const escVn = s => String(s || '').replace(/[&<>"]/g,
  m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initVenues);
else
  initVenues();
