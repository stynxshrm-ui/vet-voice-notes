import { recordToText, summaryToText } from './render.js';
import { PATIENTS, SAMPLES } from './patients.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Speech to text (Web Worker, WebGPU with WASM fallback) ----------
const worker = new Worker('worker.js', { type: 'module' });
let recorder, chunks = [], stream, modelReady = null;

worker.onmessage = ({ data: m }) => {
  if (m.type === 'progress') $('prog').style.width = `${m.pct}%`, status(`Downloading speech model… ${Math.round(m.pct)}% (cached after first use)`);
  if (m.type === 'ready') { $('prog').style.width = '0'; $('devBadge').textContent = `speech: ${m.device === 'webgpu' ? 'WebGPU ⚡' : 'WASM (CPU)'}`; status('Model ready.'); }
  if (m.type === 'result') { $('raw').value = ($('raw').value + ' ' + m.text).trim(); status('Transcribed. Edit if needed, then write the record.'); $('mic').disabled = false; $('drop').classList.remove('busy'); }
  if (m.type === 'error') { status('Error: ' + m.message); $('mic').disabled = false; $('drop').classList.remove('busy'); }
};
const status = t => $('status').textContent = t;
const loadModel = () => { status('Loading speech model…'); worker.postMessage({ type: 'load', model: $('model').value }); };
$('model').onchange = loadModel;

async function toFloat32(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 }); // decodeAudioData resamples to 16 kHz for Whisper
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const mono = new Float32Array(buf.length); // average channels so stereo files aren't half-silent
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  return mono;
}

function ensureModel() { if (!modelReady) { modelReady = true; loadModel(); } }

async function transcribeBlob(blob) {
  $('mic').disabled = true; $('drop').classList.add('busy');
  status('Decoding audio…');
  try {
    const audio = await toFloat32(blob);
    ensureModel();
    status(`Transcribing locally… (${Math.round(audio.length / 16000)}s of audio)`);
    worker.postMessage({ type: 'transcribe', model: $('model').value, audio }, [audio.buffer]);
  } catch {
    status('Could not read that audio file. Try WAV, MP3 or M4A.');
    $('mic').disabled = false; $('drop').classList.remove('busy');
  }
}

$('mic').onclick = async () => {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch { return status('Microphone access denied.'); }
  chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    $('mic').classList.remove('rec');
    transcribeBlob(new Blob(chunks));
  };
  recorder.start(); $('mic').classList.add('rec'); status('Recording… click again to stop.');
};

// ---------- Upload a recording ----------
const ALLOWED = /\.(wav|mp3|m4a)$/i;
function handleFile(f) {
  if (!f) return;
  if (!ALLOWED.test(f.name)) return status('Unsupported file type. Use WAV, MP3 or M4A.');
  $('fileName').textContent = `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`;
  transcribeBlob(f);
}
$('drop').onclick = () => $('file').click();
$('file').onchange = e => { handleFile(e.target.files[0]); e.target.value = ''; };
$('drop').ondragover = e => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = e => { e.preventDefault(); $('drop').classList.remove('over'); handleFile(e.dataTransfer.files[0]); };

// ---------- Patients & templates ----------
const patient = () => PATIENTS.find(p => p.id === $('patient').value);
$('patient').innerHTML = PATIENTS.map(p => `<option value="${p.id}">${esc(p.name)} — ${esc(p.species)}, ${esc(p.breed)} (${esc(p.owner)})</option>`).join('');
const showPatient = () => { const p = patient(); $('ptInfo').textContent = `${p.id} · ${p.sex} · ${p.age} · ${p.weight} on file · Owner: ${p.owner}`; renderLog(); };
$('patient').onchange = showPatient;

let templates = [];
fetch('/api/templates').then(r => r.json()).then(({ templates: list }) => {
  templates = list;
  const cats = [...new Set(list.map(t => t.category))];
  $('template').innerHTML = cats.map(c => `<optgroup label="${esc(c)}">${list.filter(t => t.category === c).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
});
const templateName = id => templates.find(t => t.id === id)?.name || id;

$('sample').onclick = () => {
  const s = SAMPLES[$('template').value] || SAMPLES.consult_soap;
  $('raw').value = s.text; $('patient').value = s.patient; showPatient();
};

// ---------- Pseudonymization (client-side, reversible) ----------
// Pet and owner names become "Patient A" / "Owner A"; extra names become "Person A/B…".
function buildAliasMap(p, extraCsv) {
  const extra = extraCsv.split(',').map(s => s.trim()).filter(Boolean);
  return [
    { name: p.name, alias: 'Patient A' },
    { name: p.owner, alias: 'Owner A' },
    { name: p.owner.split(' ')[0], alias: 'Owner A' }, // restore() maps "Owner A" back to the full name (first match wins)
    ...extra.map((n, i) => ({ name: n, alias: `Person ${String.fromCharCode(65 + i)}` })),
  ];
}
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pseudonymize(text, map) {
  // Longest names first so "Jenny Walsh" is replaced before "Jenny".
  return [...map].sort((a, b) => b.name.length - a.name.length)
    .reduce((t, { name, alias }) => t.replace(new RegExp(`\\b${reEsc(name)}\\b`, 'gi'), alias), text);
}
function restore(obj, map) {
  const swap = s => map.reduce((t, { name, alias }) => t.split(alias).join(name), s);
  return JSON.parse(swap(JSON.stringify(obj)));
}
const aiContext = p => ({ species: p.species, breed: p.breed, sex: p.sex, age: p.age, weight: p.weight }); // no names

// ---------- Models ----------
let models = [];
fetch('/api/models').then(r => r.ok ? r.json() : Promise.reject(new Error(`/api/models returned HTTP ${r.status} — restart the server (node server.js) so it picks up the latest code`))).then(({ models: list }) => {
  models = list;
  const groups = [...new Set(list.map(m => m.group))];
  $('aiModel').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${list.filter(m => m.group === g).map(m =>
    `<option value="${esc(m.id)}" ${m.available ? '' : 'disabled'}>${esc(m.label)}${m.available ? '' : ` — needs ${esc(m.needs)}`}</option>`).join('')}</optgroup>`).join('');
  const first = list.find(m => m.available && m.id !== 'offline') || list.find(m => m.available);
  $('aiModel').value = first.id; showModel(); buildPicker(); calc();
}).catch(e => { $('cmpPick').textContent = 'Could not load models: ' + e.message; $('aiDest').textContent = 'Could not load models: ' + e.message; });
function showModel() {
  const m = models.find(x => x.id === $('aiModel').value);
  $('aiDest').textContent = m ? '🔒 ' + m.destination : '';
  $('aiBadge').textContent = 'AI: ' + (m ? m.label.split(' (')[0] : '…');
}
$('aiModel').onchange = showModel;

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
const money = c => c == null ? 'cost n/a (no price set for this model)' : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(3)}`;

async function refineOnce(modelId, map) {
  const p = patient();
  const data = await post('/api/refine', { text: pseudonymize($('raw').value.trim(), map), modelId, templateId: $('template').value, detail: $('detail').value, patient: aiContext(p) });
  return { ...data, note: restore(data.note, map) };
}

// ---------- Write record ----------
let current = null; // { patientId, templateId, note, cost }

$('refine').onclick = async () => {
  if (!$('raw').value.trim()) return $('refineStatus').textContent = 'Nothing to format yet.';
  $('refine').disabled = true; $('refineStatus').textContent = 'Writing record…';
  try {
    const { note, ms, offline, cost, usage } = await refineOnce($('aiModel').value, buildAliasMap(patient(), $('names').value));
    useNote(note, $('template').value, cost);
    recordMeasurement('record', usage);
    $('refineStatus').textContent = (offline ? 'Offline rules only — pick an AI model for a real record. ' : 'Done. ') + `(${(ms / 1000).toFixed(1)}s)`;
  } catch (e) { $('refineStatus').textContent = 'Error: ' + e.message; }
  $('refine').disabled = false;
};

const list = a => a?.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="muted">None mentioned</span>';
const HI = ['dose_unit', 'missing_weight', 'species_mismatch'];
const flagsHtml = f => f?.length ? `<h4 style="margin-top:0">⚠ Check before saving</h4>${f.map(x => `<div class="flag ${HI.includes(x.type) ? 'hi' : ''}"><b>${esc(x.type.replace(/_/g, ' '))}:</b> ${esc(x.note)}</div>`).join('')}` : '';

function useNote(note, templateId, cost) {
  current = { patientId: $('patient').value, templateId, note, cost };
  $('flags').innerHTML = flagsHtml(note.flags);
  $('record').value = `${note.title || templateName(templateId)}\n${patient().name} (${patient().id}) · ${new Date().toLocaleDateString()}\n\n${recordToText(templateId, note)}`;
  $('bill').innerHTML = templateId === 'afast_tfast' ? '<span class="muted">AFAST/TFAST scan</span>' : list(note.items_to_bill);
  $('unclear').innerHTML = note.unclear?.length ? `<h4>Please confirm</h4>${list(note.unclear)}` : '';
  $('cost').hidden = false; $('cost').textContent = `This record: ${money(cost)}`;
  $('saveStatus').textContent = ''; $('summary').value = ''; $('approve').checked = false; $('copySummary').disabled = true;
  $('resultCard').hidden = false; $('summaryCard').hidden = false;
  current.pmsRef = null; current.saved = false;
}

$('copy').onclick = () => navigator.clipboard.writeText($('record').value).then(() => $('copy').textContent = 'Copied ✓', () => {});

// ---------- Client summary ----------
$('summarize').onclick = async () => {
  const p = PATIENTS.find(x => x.id === current.patientId), map = buildAliasMap(p, $('names').value);
  $('summarize').disabled = true; $('sumStatus').textContent = 'Writing summary…';
  try {
    const { note, cost, ms, usage } = await post('/api/summary', { recordText: pseudonymize($('record').value, map), modelId: $('aiModel').value, readingLevel: $('level').value });
    $('summary').value = summaryToText(restore(note, map), { vet: $('vetName').value, clinic: $('clinic').value });
    recordMeasurement('summary', usage);
    $('sumStatus').textContent = `Done (${(ms / 1000).toFixed(1)}s, ${money(cost)})`;
    $('approve').checked = false; $('copySummary').disabled = true;
  } catch (e) { $('sumStatus').textContent = 'Error: ' + e.message; }
  $('summarize').disabled = false;
};
$('approve').onchange = () => $('copySummary').disabled = !$('approve').checked || !$('summary').value.trim();
$('summary').oninput = () => { $('approve').checked = false; $('copySummary').disabled = true; };
$('copySummary').onclick = () => navigator.clipboard.writeText($('summary').value).then(() => $('copySummary').textContent = 'Copied ✓', () => {});

// ---------- Patient history (localStorage stands in for the PMS database) ----------
const store = { get: () => { try { return JSON.parse(localStorage.getItem('vet-log') || '[]'); } catch { return []; } }, set: v => localStorage.setItem('vet-log', JSON.stringify(v)) };
function entry() {
  return { patientId: current.patientId, templateId: current.templateId, title: current.note.title, text: $('record').value,
    flags: current.note.flags || [], items: current.note.items_to_bill || [], summary: $('approve').checked ? $('summary').value : null,
    pmsRef: current.pmsRef, savedAt: new Date().toISOString() };
}
$('save').onclick = () => {
  if (current.saved) return $('saveStatus').textContent = 'Already saved for this consult.';
  store.set([entry(), ...store.get()]); current.saved = true;
  $('saveStatus').textContent = `Saved to ${PATIENTS.find(p => p.id === current.patientId).name}'s history.`; renderLog();
};
$('pms').onclick = async () => {
  $('pms').disabled = true;
  try {
    const { ref } = await post('/api/pms', { patientId: current.patientId, recordText: $('record').value });
    current.pmsRef = ref; $('saveStatus').textContent = `Sent to PMS (simulated) — ref ${ref}.`;
    if (!current.saved) $('save').click();
  } catch (e) { $('saveStatus').textContent = 'Error: ' + e.message; }
  $('pms').disabled = false;
};
function renderLog() {
  const all = store.get(), pid = $('patient').value, items = all.filter(n => n.patientId === pid);
  $('log').innerHTML = items.length ? items.map(n => `<div class="log"><div style="min-width:0"><b>${esc(n.title)}</b><br><small>${new Date(n.savedAt).toLocaleString()} · ${esc(templateName(n.templateId))}${n.pmsRef ? ' · ' + esc(n.pmsRef) : ''}${n.flags?.length ? ' · ⚠ ' + n.flags.length + ' flag(s)' : ''}</small>
    <details><summary class="muted" style="font-size:13px">Show record${n.summary ? ' and client summary' : ''}</summary><pre>${esc(n.text)}</pre>${n.summary ? `<pre>${esc(n.summary)}</pre>` : ''}</details></div>
    <button data-at="${esc(n.savedAt)}">Delete</button></div>`).join('') : `<span class="muted">No saved records for ${esc(patient().name)} yet.</span>`;
  $('log').querySelectorAll('button').forEach(b => b.onclick = () => { store.set(store.get().filter(n => n.savedAt !== b.dataset.at)); renderLog(); });
}
showPatient();

// ---------- Compare mode ----------
function buildPicker() {
  $('cmpPick').className = 'pick';
  $('cmpPick').innerHTML = models.filter(m => m.id !== 'offline').map(m =>
    `<label class="${m.available ? '' : 'off'}" title="${esc(m.available ? m.destination : 'needs ' + m.needs)}"><input type="checkbox" value="${esc(m.id)}" ${m.available ? '' : 'disabled'}>${esc(m.label.split(' (')[0])}</label>`).join('');
}
$('compare').onclick = async () => {
  const ids = [...$('cmpPick').querySelectorAll('input:checked')].map(i => i.value);
  if (!$('raw').value.trim()) return $('cmpStatus').textContent = 'Nothing to compare yet.';
  if (ids.length < 2) return $('cmpStatus').textContent = 'Tick at least two models.';
  const map = buildAliasMap(patient(), $('names').value), templateId = $('template').value;
  $('compare').disabled = true; $('cmpStatus').textContent = `Running ${ids.length} models in parallel…`;
  $('cmpGrid').innerHTML = ids.map(id => `<div class="col" id="cmp-${CSS.escape(id)}"><h3>${esc(models.find(m => m.id === id).label.split(' (')[0])}</h3><div class="muted">Waiting…</div></div>`).join('');
  await Promise.all(ids.map(async id => {
    const col = document.getElementById('cmp-' + CSS.escape(id)), name = models.find(m => m.id === id).label.split(' (')[0];
    try {
      const { note, ms, cost } = await refineOnce(id, map);
      col.innerHTML = `<h3>${esc(name)}</h3><div class="meta">${(ms / 1000).toFixed(1)}s · ${money(cost)} · ${note.flags?.length || 0} flag(s)</div>${flagsHtml(note.flags)}<pre>${esc(recordToText(templateId, note))}</pre><div class="actions"><button data-use>Use this one</button></div>`;
      col.querySelector('[data-use]').onclick = () => { useNote(note, templateId, cost); $('resultCard').scrollIntoView({ behavior: 'smooth' }); };
    } catch (e) { col.className = 'col err'; col.innerHTML = `<h3>${esc(name)}</h3>${esc(e.message)}`; }
  }));
  $('cmpStatus').textContent = 'Done. Check: no invented findings, doses kept exactly, unmentioned items left "not stated", and the cost.';
  $('compare').disabled = false;
};

// ---------- Cost calculator ----------
// VetNotes plans as quoted to us, by concurrent recordings (currency as quoted).
const VETNOTES = [{ name: 'Solo', max: 1, price: 62 }, { name: 'Regular Clinical', max: 3, price: 125 }, { name: 'Large Clinic', max: 8, price: 242 }];
// Tokens per consult (record + client summary), fitted to measured calls in October 2026:
// input = fixed prompt (~1,750) + ~3.2 per spoken word; output = ~250 + a per-word rate that depends on the model —
// about 4 for normal models, about 14 for reasoning models (their hidden reasoning is billed as output).
const WORDS_PER_MIN = 130, IN_BASE = 1750, IN_PER_WORD = 3.2, OUT_BASE = 250;
const outPerWordDefault = m => m?.reasoning ? 14 : 4;
const measured = {}; // modelId -> { words, recIn, recOut, sumIn, sumOut } from the last real consult in this tab

function recordMeasurement(kind, usage) {
  const id = $('aiModel').value, words = $('raw').value.trim().split(/\s+/).length;
  if (!usage) return;
  if (kind === 'record') measured[id] = { words, recIn: usage.input, recOut: usage.output };
  else if (measured[id]) Object.assign(measured[id], { sumIn: usage.input, sumOut: usage.output });
  calc();
}

function calc() {
  const n = id => Math.max(0, Number($(id).value) || 0);
  const vets = Math.max(1, n('cVets')), consults = vets * n('cConsults') * n('cDays'), words = Math.round(n('cMins') * WORDS_PER_MIN);
  const m = models.find(x => x.id === $('aiModel').value), meas = m && measured[m.id];
  // Per-word rates: from this model's last real record + summary if we have one, else the fitted defaults.
  const full = meas && meas.sumIn != null && meas.words > 0;
  const inPerWord = full ? Math.max(0, (meas.recIn + meas.sumIn - IN_BASE) / meas.words) : IN_PER_WORD;
  const outPerWord = full ? Math.max(0, (meas.recOut + meas.sumOut - OUT_BASE) / meas.words) : outPerWordDefault(m);
  const tokIn = IN_BASE + inPerWord * words, tokOut = OUT_BASE + outPerWord * words;
  const price = m?.price;
  const perConsult = price ? (tokIn * price[0] + tokOut * price[1]) / 1e6 : null;
  const ours = perConsult == null ? null : consults * perConsult + n('cHost');
  const tier = VETNOTES.find(t => vets <= t.max);
  $('cOut').innerHTML = `
    <div class="tile us"><span class="muted">Our running cost (AI + hosting)</span><b>${ours == null ? 'n/a' : `$${ours.toFixed(2)}/mo`}</b><small class="muted">${consults.toLocaleString()} consults · ${perConsult == null ? '' : `${money(perConsult)} AI per consult · `}no limit on vets recording at once</small></div>
    <div class="tile"><span class="muted">VetNotes ${tier ? esc(tier.name) : 'Enterprise'} plan</span><b>${tier ? `$${tier.price}/mo` : 'Custom quote'}</b><small class="muted">${tier ? `up to ${tier.max} concurrent recording${tier.max > 1 ? 's' : ''}` : 'more than 8 concurrent recordings'} (published price, currency as quoted)</small></div>`;
  const k = x => Math.round(x).toLocaleString();
  $('cBasis').innerHTML = !m ? '' : !price
    ? `${esc(m.label.split(' (')[0])}: no per-token price${m.needs ? '' : ' (self-hosted: you pay for your own hardware instead)'}. Add a "price" to this model in models.json to include it.`
    : `Basis for <b>${esc(m.label.split(' (')[0])}</b> (change the AI model above to compare): ${n('cMins')} min × ${WORDS_PER_MIN} words/min ≈ ${k(words)} words → about ${k(tokIn)} input + ${k(tokOut)} output tokens per consult (record + client summary)`
      + ` × $${price[0]} / $${price[1]} per million tokens = ${money(perConsult)}. `
      + (full ? `Token rates measured on your last consult with this model (${meas.words} words).` : `Token rates are averages from test runs${m.reasoning ? ' for reasoning models, which bill hidden reasoning as output' : ''}; write a record and a client summary with this model to measure them.`)
      + ` Price from ${esc(m.priceSource || 'models.json')}, checked ${esc(m.priceChecked || 'unknown')}; update it in models.json.`;
}
['cVets', 'cConsults', 'cDays', 'cMins', 'cHost'].forEach(id => $(id).oninput = calc);
$('aiModel').addEventListener('change', calc);
calc();
