import './env.js';
// Zero-dependency server: static files + /api/refine (dictation -> record), /api/summary (record -> client message).
import http from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystem, buildUserMessage, SUMMARY_SYSTEM, buildSummaryMessage } from './prompts.js';
import { findTemplate, publicTemplates } from './templates.js';
import { find, isAvailable, publicList, costUsd, models } from './models.js';

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD;
const USER = process.env.APP_USER || 'vet';
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN) || 20;

// Public deployments must be password protected, otherwise anyone can spend your API credits.
if (process.env.NODE_ENV === 'production' && !PASSWORD) { console.error('Refusing to start: set APP_PASSWORD when NODE_ENV=production.'); process.exit(1); }

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function authorized(req) {
  if (!PASSWORD) return true;
  const [u, ...rest] = Buffer.from((req.headers.authorization || '').replace(/^Basic /i, ''), 'base64').toString().split(':');
  return same(u || '', USER) && same(rest.join(':'), PASSWORD);
}

const hits = new Map(); // ip -> timestamps of recent AI calls
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now); hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}
const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function extractJson(s) {
  s = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Model did not return JSON');
  return JSON.parse(s.slice(a, b + 1));
}

async function callModel(m, system, user) {
  const key = process.env[m.keyEnv];
  const anthropic = m.provider === 'anthropic';
  // Per-model cap from models.json; Claude needs more room because it thinks by default.
  const maxTokens = m.maxTokens || (anthropic ? 8000 : 3000);
  const r = await fetch(anthropic ? 'https://api.anthropic.com/v1/messages' : `${m.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: anthropic
      ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    body: JSON.stringify(anthropic
      ? { model: m.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] } // current Claude models reject custom temperature
      : { model: m.model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  }).catch(e => { throw new Error(`Could not reach ${m.label}: ${e.cause?.code || e.message}`); });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `${m.label}: HTTP ${r.status}`);
  // A record cut off at the cap could silently miss its plan or medications, so refuse it rather than save it.
  const truncated = anthropic ? data.stop_reason === 'max_tokens' : data.choices?.[0]?.finish_reason === 'length';
  if (truncated) throw new Error(`${m.label} stopped at its ${maxTokens}-token limit before finishing. Raise "maxTokens" for this model in models.json, or use a shorter dictation.`);
  const text = anthropic ? data.content.map(c => c.text || '').join('') : data.choices?.[0]?.message?.content || '';
  const u = data.usage || {};
  const usage = { input: u.input_tokens ?? u.prompt_tokens ?? 0, output: u.output_tokens ?? u.completion_tokens ?? 0 };
  return { json: extractJson(text), usage };
}

// Crude offline fallback so the demo works without a key. Clearly labelled in the UI.
const filler = /\b(um+|uh+|you know|i mean|like,|basically|sort of|kind of)\b[,]?\s*/gi;
const sentencesOf = text => text.replace(filler, '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1));
function refineLocally({ text, templateId }) {
  const unclear = ['Offline rules only - choose an AI model for real formatting.'];
  if (templateId === 'afast_tfast') return { title: 'AFAST/TFAST (offline preview)', operator: null, positioning: null, afast: {}, tfast: {}, afast_notes: sentencesOf(text).join(' '), tfast_notes: null, vet_interpretation: null, flags: [], unclear };
  const flags = /\b(euthan|consent)\w*/i.test(text) ? [{ type: 'euthanasia_consent', note: 'Mentions euthanasia or consent.' }] : [];
  return { title: 'Untitled note (offline preview)', history: sentencesOf(text).join(' '), vitals: {}, exam: [], assessment: [],
    plan: { diagnostics: [], treatment: [], medications: [], advice: [], recheck: null }, items_to_bill: [], flags, unclear };
}
const summaryLocally = () => ({ greeting: 'Hi Owner A,', paragraphs: ['Thanks for bringing Patient A in today. (Offline preview - choose an AI model to write the real summary.)'], home_care: [], next_visit: null });

async function readBody(req) {
  let s = ''; for await (const c of req) { s += c; if (s.length > 200_000) throw new Error('Body too large'); }
  return JSON.parse(s || '{}');
}

// Shared checks + timing + cost for both AI endpoints.
async function runAi(req, send, body, offline, call) {
  if (rateLimited(req)) return send(429, { error: `Too many requests - limit is ${RATE_LIMIT} per minute. Wait a moment and retry.` });
  const m = find(body.modelId);
  if (!m) return send(400, { error: 'Unknown model' });
  if (!isAvailable(m)) return send(400, { error: `${m.label} is not configured (set ${m.keyEnv}).` });
  const t0 = Date.now();
  if (m.provider === 'offline') return send(200, { note: offline(), offline: true, ms: Date.now() - t0, usage: null, cost: 0 });
  const { json, usage } = await call(m);
  return send(200, { note: json, offline: false, ms: Date.now() - t0, usage, cost: costUsd(m, usage) });
}

http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Vet Voice Notes demo"' }); return res.end('Authentication required'); }
    if (req.method === 'GET' && req.url === '/api/models') return send(200, { models: publicList() });
    if (req.method === 'GET' && req.url === '/api/templates') return send(200, { templates: publicTemplates() });
    if (req.method === 'POST' && req.url === '/api/refine') {
      const body = await readBody(req);
      if (!body.text?.trim()) return send(400, { error: 'No text provided' });
      const t = findTemplate(body.templateId);
      if (!t) return send(400, { error: 'Unknown template' });
      const user = buildUserMessage({ ...body, today: new Date().toISOString().slice(0, 10) });
      return await runAi(req, send, body, () => refineLocally(body), m => callModel(m, buildSystem(t), user)); // await: keep provider errors inside this try
    }
    if (req.method === 'POST' && req.url === '/api/summary') {
      const body = await readBody(req);
      if (!body.recordText?.trim()) return send(400, { error: 'No record provided' });
      return await runAi(req, send, body, summaryLocally, m => callModel(m, SUMMARY_SYSTEM, buildSummaryMessage(body)));
    }
    if (req.method === 'POST' && req.url === '/api/pms') {
      // Stand-in for a practice-management-system integration: accepts the record and returns a reference.
      const body = await readBody(req);
      if (!body.patientId || !body.recordText) return send(400, { error: 'patientId and recordText are required' });
      return send(200, { ok: true, ref: 'PMS-' + randomUUID().slice(0, 8).toUpperCase() });
    }
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });
    const path = normalize(req.url.split('?')[0]).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, path === '/' ? 'index.html' : path);
    if (!file.startsWith(PUBLIC)) return send(403, { error: 'Forbidden' });
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch (e) {
    if (e.code === 'ENOENT') return send(404, { error: 'Not found' });
    console.error(e); send(500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Vet voice notes demo: http://localhost:${PORT}  (models available: ${models().filter(isAvailable).map(m => m.id).join(', ')})`));
