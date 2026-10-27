// Turns the model's JSON into record text. All arithmetic (AFAST score) happens here, never in the model.
// Anything not dictated renders as "not stated" / "not assessed" — never as normal.

const has = v => v !== null && v !== undefined && String(v).trim() !== '';
const bullets = a => (a || []).filter(has).map(x => `- ${x}`);

// ---------- Consult-style templates ----------
function vitalsLine(v = {}) {
  const parts = [['T', v.temp], ['BW', v.weight], ['BCS', v.bcs], ['HR', v.hr], ['RR', v.rr], ['MM/CRT', v.mm_crt]].filter(([, x]) => has(x));
  return parts.length ? parts.map(([k, x]) => `${k} ${x}`).join(', ') : null;
}
const med = m => [m.drug, m.dose, m.route, m.frequency, m.duration && `(${m.duration})`].filter(has).join(' ');

function consultText(r, templateId) {
  const p = r.plan || {}, out = [];
  out.push('HISTORY', has(r.history) ? r.history : 'Not stated', '');
  if (templateId !== 'phone_call') {
    const exam = [vitalsLine(r.vitals), ...(r.exam || []).filter(e => has(e.finding)).map(e => `${e.system}: ${e.finding}`)].filter(Boolean);
    out.push('EXAM', ...(exam.length ? exam : ['Not stated']), '');
  }
  out.push('ASSESSMENT', ...(r.assessment?.length ? bullets(r.assessment) : ['Not stated']), '');
  const section = (label, lines) => lines.length ? [`${label}:`, ...lines] : [];
  const plan = [
    ...section('Diagnostics', bullets(p.diagnostics)),
    ...section('Treatment', bullets(p.treatment)),
    ...section('Medications', bullets((p.medications || []).map(med))),
    ...section(templateId === 'phone_call' ? 'Advice given' : 'Advice', bullets(p.advice)),
    ...(has(p.recheck) ? [`Recheck: ${p.recheck}`] : []),
  ];
  out.push('PLAN', ...(plan.length ? plan : ['Not stated']));
  return out.join('\n');
}

// ---------- AFAST / TFAST ----------
const AFAST_SITES = ['DH', 'SR', 'CC', 'HR'];
const SCORE = { '0': 0, '1/2': 0.5, '½': 0.5, '0.5': 0.5, '1': 1 };
const fmt = n => String(n); // decimals ("1.5/4"); "1 1/2/4" would be ambiguous

export function afastScore(afast = {}) {
  const scored = AFAST_SITES.filter(s => has(afast[s]) && String(afast[s]).trim() in SCORE);
  const score = scored.reduce((t, s) => t + SCORE[String(afast[s]).trim()], 0);
  const missing = AFAST_SITES.filter(s => !scored.includes(s));
  const text = !scored.length ? 'not assessed'
    : missing.length ? `${fmt(score)}/4 (partial: ${scored.length} of 4 views scored; ${missing.join(', ')} not assessed)`
      : `${fmt(score)}/4`;
  return { score, scored, missing, text };
}

const TFAST_VIEWS = [['cts_left', 'CTS - Left hemithorax'], ['cts_right', 'CTS - Right hemithorax'],
  ['pcs_left', 'PCS - Left hemithorax'], ['pcs_right', 'PCS - Right hemithorax'], ['subxiphoid', 'Sub-xiphoid view']];
const TFAST_FIELDS = [['pleural_fluid', 'pleural fluid'], ['pericardial_fluid', 'pericardial fluid'], ['pneumothorax', 'pneumothorax'], ['b_lines', 'b-lines']];
const normal = v => /^(absent|negative|none|no\b|wnl|within normal|normal|not present)/i.test(String(v).trim());

function afastText(r) {
  const a = r.afast || {}, t = r.tfast || {}, s = afastScore(a), out = [];
  out.push(`Operator: ${has(r.operator) ? r.operator : 'Not stated'}`, `Patient positioning: ${has(r.positioning) ? r.positioning : 'Not stated'}`, '');

  out.push('AFAST', 'Fluid scoring (0 negative, 1/2 soft positive, 1 positive):',
    ...AFAST_SITES.map(k => `- ${k}: ${has(a[k]) ? a[k] : 'not assessed'}`), '', `Abdominal Fluid Score (AFS): ${s.text}`);
  if (has(r.afast_notes)) out.push(`Notes: ${r.afast_notes}`);
  const positive = s.scored.filter(k => SCORE[String(a[k]).trim()] > 0);
  const afastDraft = !s.scored.length ? 'AFAST not performed / not dictated.'
    : positive.length ? `Free abdominal fluid at ${positive.map(k => `${k} (${a[k]})`).join(', ')}.`
      : s.missing.length ? `No free abdominal fluid at the views scored; ${s.missing.join(', ')} not assessed.` : 'Negative for free abdominal fluid.';
  out.push(`AFAST interpretation (draft - vet to confirm): ${afastDraft}`, '');

  out.push('TFAST');
  const findings = [];
  let assessed = 0;
  for (const [key, label] of TFAST_VIEWS) {
    const v = t[key] || {};
    if (!TFAST_FIELDS.some(([f]) => has(v[f]))) { out.push(`- ${label}: not assessed`); continue; }
    assessed++;
    out.push(`- ${label}: ${TFAST_FIELDS.map(([f, name]) => `${name} ${has(v[f]) ? v[f] : 'not stated'}`).join(', ')}`);
    TFAST_FIELDS.forEach(([f, name]) => { if (has(v[f]) && !normal(v[f])) findings.push(`${name} ${v[f]} (${label})`); });
  }
  if (has(r.tfast_notes)) out.push(`Notes: ${r.tfast_notes}`);
  const tfastDraft = !assessed ? 'TFAST not performed / not dictated.'
    : findings.length ? `Abnormal: ${findings.join('; ')}.`
      : `No abnormal findings at the ${assessed} view(s) assessed${assessed < TFAST_VIEWS.length ? '; remaining views not assessed' : ''}.`;
  out.push(`TFAST interpretation (draft - vet to confirm): ${tfastDraft}`);
  if (has(r.vet_interpretation)) out.push('', `Vet interpretation: ${r.vet_interpretation}`);
  return out.join('\n');
}

export const recordToText = (templateId, r) => templateId === 'afast_tfast' ? afastText(r) : consultText(r, templateId);

// ---------- Client summary ----------
export function summaryToText(s, { vet, clinic }) {
  return [
    s.greeting || '', '',
    ...(s.paragraphs || []).flatMap(p => [p, '']),
    ...(s.home_care?.length ? ['At home:', ...bullets(s.home_care), ''] : []),
    ...(has(s.next_visit) ? [`Next visit: ${s.next_visit}`, ''] : []),
    vet, clinic,
  ].filter(x => x !== undefined).join('\n').trim();
}
