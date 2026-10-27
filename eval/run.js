// Runs the fake eval dictations through one or more models against a running server.
//   node eval/run.js groq-gpt-oss-120b openai-mini
// Env: EVAL_URL (default http://localhost:3000), APP_USER / APP_PASSWORD if the server has a password.
import '../env.js';
import { readFile } from 'node:fs/promises';
import { PATIENTS, SAMPLES } from '../public/patients.js';
import { recordToText } from '../public/render.js';

const URL_ = process.env.EVAL_URL || 'http://localhost:3000';
const auth = process.env.APP_PASSWORD ? { authorization: 'Basic ' + Buffer.from(`${process.env.APP_USER || 'vet'}:${process.env.APP_PASSWORD}`).toString('base64') } : {};
const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const models = process.argv.slice(2);
if (!models.length) { console.error('Usage: node eval/run.js <modelId> [modelId…]  (ids from GET /api/models)'); process.exit(1); }

// Same aliases the browser uses, so the eval sees what the model sees in the app.
function pseudonymize(text, p) {
  return text.replace(new RegExp(`\\b${p.owner}\\b`, 'gi'), 'Owner A').replace(new RegExp(`\\b${p.owner.split(' ')[0]}\\b`, 'gi'), 'Owner A')
    .replace(new RegExp(`\\b${p.name}\\b`, 'gi'), 'Patient A');
}

function check(c, note) {
  const text = recordToText(c.templateId, note).toLowerCase(), problems = [];
  for (const s of c.mustContain) if (!text.includes(s.toLowerCase())) problems.push(`missing "${s}"`);
  for (const s of c.mustNotContain) if (text.includes(s.toLowerCase())) problems.push(`should not contain "${s}"`);
  const types = (note.flags || []).map(f => f.type);
  for (const f of c.expectFlags || []) if (!types.includes(f)) problems.push(`no ${f} flag`);
  return problems;
}

const summary = [];
for (const modelId of models) {
  let passed = 0, cost = 0, priced = true, ms = 0;
  console.log(`\n=== ${modelId}`);
  for (const c of cases) {
    const s = c.sample && SAMPLES[c.sample], p = PATIENTS.find(x => x.id === (c.patientId || s.patient));
    const call = () => fetch(`${URL_}/api/refine`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ text: pseudonymize(c.text || s.text, p), modelId, templateId: c.templateId, detail: 'balanced',
        patient: { species: p.species, breed: p.breed, sex: p.sex, age: p.age, weight: p.weight } }) });
    let r, d;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await call();
      d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      const wait = !r.ok && /try again in ([\d.]+)(ms|s)/i.exec(d.error || ''); // provider rate limit (e.g. Groq free tier)
      if (!wait) break;
      const secs = wait[2] === 'ms' ? Number(wait[1]) / 1000 : Number(wait[1]);
      console.log(`  … rate limited, waiting ${Math.ceil(secs)}s`);
      await new Promise(res => setTimeout(res, (secs + 1) * 1000));
    }
    if (!r.ok) { console.log(`  ✗ ${c.id}: ${d.error}`); continue; }
    const problems = check(c, d.note);
    if (!problems.length) passed++;
    ms += d.ms; if (d.cost == null) priced = false; else cost += d.cost;
    console.log(`  ${problems.length ? '✗' : '✓'} ${c.id} (${(d.ms / 1000).toFixed(1)}s)${problems.length ? ': ' + problems.join('; ') : ''}`);
  }
  summary.push({ model: modelId, passed: `${passed}/${cases.length}`, avgSec: (ms / cases.length / 1000).toFixed(1), costPerNote: priced ? `$${(cost / cases.length).toFixed(5)}` : 'no price set' });
}
console.log('');
console.table(summary);
