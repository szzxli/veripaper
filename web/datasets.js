/* veripaper §6 — dataset & methods checklist (Phase 3).
 * Pure frontend knowledge base: paper type × target venue → checklist.
 * Venue items aligned with public checklists (NeurIPS paper checklist,
 * ACL reproducibility checklist, Nature reporting summary). Guidance, not
 * verification — the author owns the science.
 */
'use strict';

const DS_TYPES = {
  'empirical-ml': 'Empirical ML',
  'survey': 'Survey / position',
  'theory': 'Theory',
  'systems': 'Systems / engineering',
  'human-study': 'Human study / annotation',
};

const DS_VENUES = {
  'generic': 'Any venue (core)',
  'neurips': 'NeurIPS',
  'icml': 'ICML',
  'iclr': 'ICLR',
  'acl': 'ACL / EMNLP / NAACL',
  'nature': 'Nature / Science family',
};

/* item: {sec, item, where, how, bar} */
const DS_BASE = {
  'empirical-ml': [
    { sec: 'Datasets', item: 'Name every dataset used, per experiment.',
      where: 'Experiments §, one table', how: 'Public (HuggingFace, Papers-with-Code) or collected in-house',
      bar: 'Train/val/test splits fixed before tuning; test set touched once; sizes and licenses stated.' },
    { sec: 'Datasets', item: 'Document data collection / preprocessing exactly.',
      where: 'Appendix or supplement', how: 'Scripts + random seeds + filtering rules published',
      bar: 'A stranger can rebuild the dataset from your description + code.' },
    { sec: 'Baselines', item: 'Compare against recognized baselines including current SOTA.',
      where: 'Results table', how: 'Re-run baselines yourself when feasible; cite numbers otherwise',
      bar: '≥3 baselines; same data splits and metric for all; no cherry-picked weak baselines.' },
    { sec: 'Ablations', item: 'Ablate each claimed contribution separately.',
      where: 'Ablation table/figure', how: 'Remove or swap one component at a time',
      bar: 'Every "we introduce X" claim maps to a row showing X matters.' },
    { sec: 'Statistics', item: 'Report variance, not just means.',
      where: 'All result tables', how: '≥3 random seeds; mean ± std',
      bar: 'Any "significantly better" claim backed by a significance test or CIs.' },
    { sec: 'Compute', item: 'Report compute resources honestly.',
      where: 'Experiments § or appendix', how: 'GPU/TPU type × hours, total budget',
      bar: 'Enough detail for a lab to estimate reproduction cost.' },
    { sec: 'Reproducibility', item: 'One-command reproduction.',
      where: 'Code repo (linked)', how: 'Code + data + environment + seeds',
      bar: 'Fresh checkout → documented command → your headline numbers.' },
    { sec: 'Claims & limits', item: 'Claims match what the experiments show; limitations stated.',
      where: 'Abstract/intro + dedicated Limitations §', how: 'Re-read each claim against the tables',
      bar: 'No claim stronger than the evidence; failure modes named.' },
  ],
  'survey': [
    { sec: 'Coverage', item: 'Define the search protocol.',
      where: 'Method §', how: '≥2 databases (e.g. Semantic Scholar, arXiv, ACL Anthology); keywords + date range',
      bar: 'PRISMA-style flow: screened → included counts reported.' },
    { sec: 'Coverage', item: 'State inclusion / exclusion criteria explicitly.',
      where: 'Method §', how: 'Written before screening, not after',
      bar: 'A second researcher applying your criteria gets ~the same set.' },
    { sec: 'Taxonomy', item: 'Organize the field into a falsifiable taxonomy.',
      where: 'Core sections', how: 'Dimensions grounded in the papers, with borderline cases discussed',
      bar: 'Every included paper fits somewhere; misfits are named, not hidden.' },
    { sec: 'Gaps', item: 'Name open problems with evidence, not vibes.',
      where: 'Discussion / future work', how: 'Each gap cites the papers that bound it',
      bar: 'A reader can tell which gaps are crowded vs genuinely open.' },
    { sec: 'Data', item: 'Publish the surveyed corpus.',
      where: 'Supplement / repo', how: 'BibTeX + per-paper tags',
      bar: 'The survey is re-runnable when the field moves on.' },
  ],
  'theory': [
    { sec: 'Assumptions', item: 'State every assumption up front.',
      where: 'Before the first theorem', how: 'Numbered assumptions, referenced in proofs',
      bar: 'No hidden regularity / boundedness / i.i.d. smuggled into proofs.' },
    { sec: 'Proofs', item: 'Full proofs for all claims.',
      where: 'Main text or appendix', how: 'Self-contained; lemmas proved or cited',
      bar: 'A graduate student can check each step without guessing.' },
    { sec: 'Grounding', item: 'Connect theory to something measurable.',
      where: 'Experiments or discussion', how: 'Simulations or real data testing key predictions',
      bar: 'At least one prediction of the theory is empirically checked.' },
    { sec: 'Scope', item: 'Say where the theory does not apply.',
      where: 'Limitations', how: 'Counterexamples or boundary conditions',
      bar: 'The reader knows when to trust it and when not to.' },
  ],
  'systems': [
    { sec: 'Benchmarks', item: 'Evaluate on standard benchmarks for the task.',
      where: 'Evaluation §', how: 'Public benchmark suites; report all metrics they define',
      bar: 'No benchmark shopping — report the suite, not a subset.' },
    { sec: 'Setup', item: 'Fix the hardware/software stack.',
      where: 'Evaluation §', how: 'Machine, OS, library versions, thread counts',
      bar: 'Numbers are meaningless without the stack that produced them.' },
    { sec: 'End-to-end', item: 'Measure end-to-end, not just kernels.',
      where: 'Results', how: 'Include I/O, preprocessing, serving overhead where relevant',
      bar: 'Speedups that vanish end-to-end are labeled as micro-benchmarks.' },
    { sec: 'Artifact', item: 'Ship the artifact.',
      where: 'Repo / artifact appendix', how: 'Build scripts + evaluation harness',
      bar: 'AE-style: documented steps reproduce the headline figure.' },
  ],
  'human-study': [
    { sec: 'Ethics', item: 'Ethics approval / exemption documented.',
      where: 'Ethics statement', how: 'IRB or equivalent; consent procedure described',
      bar: 'No approval, no submission at most venues.' },
    { sec: 'Participants', item: 'Report who the participants were.',
      where: 'Method §', how: 'N, recruitment channel, demographics, compensation',
      bar: 'N justified (power analysis or precedent); dropouts reported.' },
    { sec: 'Protocol', item: 'Pre-register the protocol and instrument.',
      where: 'Appendix / OSF', how: 'Questionnaire, task UI, instructions frozen before launch',
      bar: 'Deviations from the plan are disclosed, not silently fixed.' },
    { sec: 'Agreement', item: 'Measure annotator agreement.',
      where: 'Method §', how: "Cohen's κ / Krippendorff's α on a shared subset",
      bar: 'Agreement reported before any label is trusted; adjudication described.' },
    { sec: 'Data', item: 'Release annotations with a data statement.',
      where: 'Supplement', how: 'Anonymized; license stated',
      bar: 'Another team can re-analyze from your release.' },
  ],
};

/* venue overlays: appended when the venue is selected */
const DS_VENUE_OVERLAY = {
  'neurips': [
    { sec: 'NeurIPS checklist', item: 'Claims, limitations, theory, reproducibility, compute, data/code access, ethics, broader impacts — each answered.',
      where: 'Paper + checklist form', how: 'Align with the public NeurIPS paper checklist',
      bar: 'Every checklist answer points at a section, not a promise.' },
    { sec: 'NeurIPS checklist', item: 'Safeguards for high-risk artifacts (models, datasets, scraped data).',
      where: 'Broader impacts / safeguards note', how: 'Access controls, usage terms where needed',
      bar: 'Reviewers should not have to ask "should this be released?"' },
  ],
  'icml': [
    { sec: 'ICML', item: 'Same bar as NeurIPS: reproducibility appendix expected, code at submission (anonymized).',
      where: 'Appendix + supplement', how: 'Anonymized repo link in the submission',
      bar: 'Results reproducible without contacting the authors.' },
  ],
  'iclr': [
    { sec: 'ICLR', item: 'OpenReview: the full history is public. Write every response as if quoted.',
      where: 'Submission + rebuttal', how: 'Code expected; community reviews are blunt',
      bar: 'Nothing in the paper you would not defend in public.' },
  ],
  'acl': [
    { sec: 'ACL reproducibility', item: 'Answer the ACL reproducibility checklist: data splits, preprocessing, hyperparameters, runtime, seeds.',
      where: 'Appendix', how: 'Public ACL checklist items, one by one',
      bar: 'A reader can re-run training and evaluation from the appendix alone.' },
  ],
  'nature': [
    { sec: 'Nature reporting', item: 'Reporting Summary: statistics, software, data availability, replication counts.',
      where: 'Reporting Summary + Methods', how: 'Nature Portfolio reporting standards',
      bar: 'Exact N per experiment, biological vs technical replicates distinguished.' },
    { sec: 'Nature reporting', item: 'Data and code availability statements are mandatory.',
      where: 'End of paper', how: 'Repositories with DOIs (Zenodo etc.)',
      bar: 'No "available on request" for the core claims.' },
  ],
  'generic': [],
};

function dsChecklist(type, venue) {
  const base = DS_BASE[type] || [];
  const over = DS_VENUE_OVERLAY[venue] || [];
  return base.concat(over);
}

/* ---------------- UI ---------------- */

function initDatasets() {
  const tSel = document.getElementById('ds-type');
  const vSel = document.getElementById('ds-venue');
  const btn = document.getElementById('ds-btn');
  const out = document.getElementById('ds-result');
  if (!tSel) return;
  const fromProject = () => {
    if (!window.VP) return;
    const p = VP.active();
    if (p) { tSel.value = p.paperType || 'empirical-ml'; vSel.value = p.targetVenue || 'generic'; }
  };
  const render = () => {
    const items = dsChecklist(tSel.value, vSel.value);
    const p = window.VP ? VP.active() : null;
    const ck = p ? p.checklist : {};
    let html = `<div class="finding"><p class="claim"><b>${items.length} checks</b> — ${iesc(DS_TYPES[tSel.value])} × ${iesc(DS_VENUES[vSel.value])}` +
      (p ? ` · saved to project "${iesc(p.name)}"` : '') + `</p><div class="detail">`;
    let sec = '';
    items.forEach((it, idx) => {
      const key = tSel.value + '|' + vSel.value + '|' + idx;
      if (it.sec !== sec) { sec = it.sec; html += `<div style="margin:10px 0 4px;color:var(--navy)"><b>${iesc(sec)}</b></div>`; }
      html += `<div style="margin-bottom:10px"><label style="cursor:pointer"><input type="checkbox" data-ds="${iesc(key)}"${ck[key] ? ' checked' : ''} style="margin-right:8px;accent-color:var(--navy)">` +
        `<b>${iesc(it.item)}</b></label><br>` +
        `<span style="font-size:12.5px;margin-left:24px">Where: ${iesc(it.where)} · How: ${iesc(it.how)}<br>` +
        `<i>Bar: ${iesc(it.bar)}</i></span></div>`;
    });
    html += `</div></div><p class="hint">Guidance aligned with public venue checklists — not a guarantee of acceptance. When in doubt, read three accepted papers from the venue and copy their Methods section's rigor, not their prose.</p>`;
    out.innerHTML = html;
    out.querySelectorAll('input[data-ds]').forEach(cb => cb.addEventListener('change', e => {
      if (!window.VP) return;
      const k = e.target.dataset.ds;
      VP.update(p => { if (e.target.checked) p.checklist[k] = true; else delete p.checklist[k]; });
    }));
  };
  const syncProject = () => {
    if (!window.VP) return;
    VP.update(p => { p.paperType = tSel.value; p.targetVenue = vSel.value; });
  };
  btn.addEventListener('click', () => { syncProject(); render(); });
  tSel.addEventListener('change', syncProject);
  vSel.addEventListener('change', syncProject);
  fromProject();
  render();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initDatasets);
else
  initDatasets();
