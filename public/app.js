const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAMPLE = "Um so I had my one on one with Mark this morning, around ten. He's been, you know, kind of lazy on the Henderson account, he missed the Tuesday and Thursday deadlines. He said his back has been bothering him and he's on some medication so that's probably why. I told him I need the revised report by next Friday and that we'll check in again Monday. Dana from finance is going to send him the budget numbers. Honestly I think he might be looking to leave, he seems checked out.";

// ---------- Speech to text (Web Worker, WebGPU with WASM fallback) ----------
const worker = new Worker('worker.js', { type: 'module' });
let recorder, chunks = [], stream, modelReady = null;

worker.onmessage = ({ data: m }) => {
  if (m.type === 'progress') $('prog').style.width = `${m.pct}%`, status(`Downloading speech model… ${Math.round(m.pct)}% (cached after first use)`);
  if (m.type === 'ready') { $('prog').style.width = '0'; $('devBadge').textContent = `speech: ${m.device === 'webgpu' ? 'WebGPU ⚡' : 'WASM (CPU)'}`; status('Model ready.'); }
  if (m.type === 'result') { $('raw').value = ($('raw').value + ' ' + m.text).trim(); status('Transcribed. Edit if needed, then format.'); $('mic').disabled = false; $('drop').classList.remove('busy'); }
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
$('sample').onclick = () => $('raw').value = SAMPLE;

// ---------- Pseudonymization (client-side, reversible) ----------
function buildAliasMap(namesCsv) {
  const names = namesCsv.split(',').map(s => s.trim()).filter(Boolean);
  return names.map((n, i) => ({ name: n, alias: `Employee ${String.fromCharCode(65 + i)}` }));
}
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pseudonymize(text, map) {
  // Longest names first so "Priya Sharma" is replaced before "Priya".
  return [...map].sort((a, b) => b.name.length - a.name.length)
    .reduce((t, { name, alias }) => t.replace(new RegExp(`\\b${reEsc(name)}\\b`, 'gi'), alias), text);
}
function restore(obj, map) {
  const swap = s => map.reduce((t, { name, alias }) => t.split(alias).join(name), s);
  return JSON.parse(swap(JSON.stringify(obj)));
}

// ---------- Refine ----------
let current = null;
let models = [];
fetch('/api/models').then(r => r.ok ? r.json() : Promise.reject(new Error(`/api/models returned HTTP ${r.status} — restart the server (node server.js) so it picks up the latest code`))).then(({ models: list }) => {
  models = list;
  const groups = [...new Set(list.map(m => m.group))];
  $('aiModel').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${list.filter(m => m.group === g).map(m =>
    `<option value="${esc(m.id)}" ${m.available ? '' : 'disabled'}>${esc(m.label)}${m.available ? '' : ` — needs ${esc(m.needs)}`}</option>`).join('')}</optgroup>`).join('');
  const first = list.find(m => m.available && m.id !== 'offline') || list.find(m => m.available);
  $('aiModel').value = first.id; showModel(); buildPicker();
}).catch(e => { $('cmpPick').textContent = 'Could not load models: ' + e.message; $('aiDest').textContent = 'Could not load models: ' + e.message; });
function showModel() {
  const m = models.find(x => x.id === $('aiModel').value);
  $('aiDest').textContent = m ? '🔒 ' + m.destination : '';
  $('aiBadge').textContent = 'AI: ' + (m ? m.label.split(' (')[0] : '…');
}
$('aiModel').onchange = showModel;

async function refineOnce(modelId, map) {
  const r = await fetch('/api/refine', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: pseudonymize($('raw').value.trim(), map), modelId, noteType: $('noteType').value, detail: $('detail').value }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return { note: restore(data.note, map), ms: data.ms, offline: data.offline };
}

$('refine').onclick = async () => {
  if (!$('raw').value.trim()) return $('refineStatus').textContent = 'Nothing to format yet.';
  $('refine').disabled = true; $('refineStatus').textContent = 'Formatting…';
  try {
    const { note, ms, offline } = await refineOnce($('aiModel').value, buildAliasMap($('names').value));
    current = { ...note, noteType: $('noteType').value };
    render(current);
    $('refineStatus').textContent = (offline ? 'Offline rules only — pick an AI model for real formatting. ' : 'Done. ') + `(${(ms / 1000).toFixed(1)}s)`;
  } catch (e) { $('refineStatus').textContent = 'Error: ' + e.message; }
  $('refine').disabled = false;
};

// ---------- Compare mode ----------
const cmpNotes = {};
function buildPicker() {
  $('cmpPick').className = 'pick';
  $('cmpPick').innerHTML = models.filter(m => m.id !== 'offline').map(m =>
    `<label class="${m.available ? '' : 'off'}" title="${esc(m.available ? m.destination : 'needs ' + m.needs)}"><input type="checkbox" value="${esc(m.id)}" ${m.available ? '' : 'disabled'}>${esc(m.label.split(' (')[0])}</label>`).join('');
}
$('compare').onclick = async () => {
  const ids = [...$('cmpPick').querySelectorAll('input:checked')].map(i => i.value);
  if (!$('raw').value.trim()) return $('cmpStatus').textContent = 'Nothing to compare yet.';
  if (ids.length < 2) return $('cmpStatus').textContent = 'Tick at least two models.';
  const map = buildAliasMap($('names').value);
  $('compare').disabled = true; $('cmpStatus').textContent = `Running ${ids.length} models in parallel…`;
  $('cmpGrid').innerHTML = ids.map(id => `<div class="col" id="cmp-${CSS.escape(id)}"><h3>${esc(models.find(m => m.id === id).label.split(' (')[0])}</h3><div class="muted">Waiting…</div></div>`).join('');
  await Promise.all(ids.map(async id => {
    const col = document.getElementById('cmp-' + CSS.escape(id)), name = models.find(m => m.id === id).label.split(' (')[0];
    try {
      const { note, ms } = await refineOnce(id, map);
      cmpNotes[id] = { ...note, noteType: $('noteType').value };
      col.innerHTML = `<h3>${esc(name)}</h3><div class="meta">${(ms / 1000).toFixed(1)}s · ${note.flags?.length || 0} flag(s) · ${note.key_points?.length || 0} key points</div>${noteHtml(note)}<div class="actions"><button data-use="${esc(id)}">Use this one</button></div>`;
      col.querySelector('[data-use]').onclick = () => { current = cmpNotes[id]; render(current); $('resultCard').scrollIntoView({ behavior: 'smooth' }); };
    } catch (e) { col.className = 'col err'; col.innerHTML = `<h3>${esc(name)}</h3>${esc(e.message)}`; }
  }));
  $('cmpStatus').textContent = 'Done. Check: did each model flag the medical/legal content, avoid inventing facts, and keep valid structure?';
  $('compare').disabled = false;
};

const list = a => a?.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="muted">None</span>';
function noteHtml(n) {
  const hi = t => ['legal_risk', 'protected_characteristic', 'escalation'].includes(t);
  return `
    ${n.flags?.length ? `<h4>⚠ Review before saving</h4>${n.flags.map(f => `<div class="flag ${hi(f.type) ? 'hi' : ''}"><b>${esc(f.type.replace(/_/g, ' '))}:</b> ${esc(f.note)}</div>`).join('')}` : ''}
    <h3>${esc(n.title)}</h3><div class="muted">${esc(n.summary)}</div>
    <h4>Context</h4><div>${esc(n.context) || '<span class="muted">Not stated</span>'}</div>
    <h4>Key points</h4>${list(n.key_points)}
    <h4>Concerns</h4>${list(n.concerns)}
    <h4>Action items</h4>${n.action_items?.length ? `<ul>${n.action_items.map(a => `<li>${esc(a.action)} <span class="muted">— ${esc(a.owner || 'owner TBD')}, ${esc(a.due || 'no date')}</span></li>`).join('')}</ul>` : '<span class="muted">None</span>'}
    <h4>Follow-up</h4><div>${esc(n.follow_up) || '<span class="muted">None stated</span>'}</div>
    ${n.unclear?.length ? `<h4>Needs verification</h4>${list(n.unclear)}` : ''}`;
}
function render(n) { $('result').innerHTML = noteHtml(n); $('resultCard').hidden = false; }

const toText = n => [
  n.title, '', `Summary: ${n.summary}`, `Context: ${n.context || 'Not stated'}`, '', 'Key points:', ...(n.key_points || []).map(x => `- ${x}`),
  '', 'Concerns:', ...(n.concerns?.length ? n.concerns : ['None']).map(x => `- ${x}`),
  '', 'Action items:', ...(n.action_items?.length ? n.action_items : [{ action: 'None' }]).map(a => `- ${a.action}${a.owner ? ` (${a.owner}` : ' ('}${a.due ? `, due ${a.due})` : ')'}`.replace(' ()', '')),
  '', `Follow-up: ${n.follow_up || 'None stated'}`,
].join('\n');
$('copy').onclick = () => navigator.clipboard.writeText(toText(current)).then(() => $('copy').textContent = 'Copied ✓', () => {});

// ---------- Saved log (localStorage stands in for the database) ----------
const store = { get: () => { try { return JSON.parse(localStorage.getItem('hr-log') || '[]'); } catch { return []; } }, set: v => localStorage.setItem('hr-log', JSON.stringify(v)) };
$('save').onclick = () => { store.set([{ ...current, savedAt: new Date().toISOString() }, ...store.get()]); renderLog(); $('save').textContent = 'Saved ✓'; setTimeout(() => $('save').textContent = 'Save to log', 1500); };
function renderLog() {
  const items = store.get();
  $('log').innerHTML = items.length ? items.map((n, i) => `<div class="log"><div><b>${esc(n.title)}</b><br><small>${new Date(n.savedAt).toLocaleString()} · ${esc(n.noteType)}${n.flags?.length ? ' · ⚠ ' + n.flags.length + ' flag(s)' : ''}</small><div>${esc(n.summary)}</div></div><button data-i="${i}">Delete</button></div>`).join('') : '<span class="muted">Nothing saved yet.</span>';
  $('log').querySelectorAll('button').forEach(b => b.onclick = () => { const a = store.get(); a.splice(+b.dataset.i, 1); store.set(a); renderLog(); });
}
renderLog();
