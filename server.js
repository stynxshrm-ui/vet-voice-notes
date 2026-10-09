import './env.js';
// Zero-dependency server: static files + /api/refine (calls Claude, or a local fallback with no API key).
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_PROMPT, buildUserMessage } from './prompts.js';
import { find, isAvailable, publicList, MODELS } from './models.js';

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD;
const USER = process.env.APP_USER || 'hr';
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN) || 20;

// Public deployments must be password protected, otherwise anyone can spend your API credits.
if (process.env.NODE_ENV === 'production' && !PASSWORD) { console.error('Refusing to start: set APP_PASSWORD when NODE_ENV=production.'); process.exit(1); }

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function authorized(req) {
  if (!PASSWORD) return true;
  const [u, ...rest] = Buffer.from((req.headers.authorization || '').replace(/^Basic /i, ''), 'base64').toString().split(':');
  return same(u || '', USER) && same(rest.join(':'), PASSWORD);
}

const hits = new Map(); // ip -> timestamps of recent /api/refine calls
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

const userMsg = body => buildUserMessage({ ...body, today: new Date().toISOString().slice(0, 10) });

async function callModel(m, body) {
  const key = process.env[m.keyEnv];
  const anthropic = m.provider === 'anthropic';
  const r = await fetch(anthropic ? 'https://api.anthropic.com/v1/messages' : `${m.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: anthropic
      ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    body: JSON.stringify(anthropic
      ? { model: m.model, max_tokens: 2000, temperature: 0.2, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMsg(body) }] }
      : { model: m.model, max_tokens: 2000, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMsg(body) }] }),
  }).catch(e => { throw new Error(`Could not reach ${m.label}: ${e.cause?.code || e.message}`); });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `${m.label}: HTTP ${r.status}`);
  const text = anthropic ? data.content.map(c => c.text || '').join('') : data.choices?.[0]?.message?.content || '';
  return extractJson(text);
}

// Crude offline fallback so the demo works without a key. Clearly labelled in the UI.
function refineLocally({ text }) {
  const filler = /\b(um+|uh+|you know|i mean|like,|basically|sort of|kind of)\b[,]?\s*/gi;
  const sentences = text.replace(filler, '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
    .map(s => s[0].toUpperCase() + s.slice(1));
  const actions = sentences.filter(s => /\b(will|need to|needs to|should|follow up|by (monday|tuesday|wednesday|thursday|friday|next week))\b/i.test(s));
  const flags = [];
  if (/\b(pregnan|disab|religio|age|race|gender)\w*/i.test(text)) flags.push({ type: 'protected_characteristic', note: 'Mentions a possibly protected characteristic — review before saving.' });
  if (/\b(sick|medical|diagnos|medication|surgery)\w*/i.test(text)) flags.push({ type: 'medical', note: 'Mentions health information.' });
  if (/\b(harass|discriminat|retaliat|threat|fire|terminate|lawsuit)\w*/i.test(text)) flags.push({ type: 'legal_risk', note: 'Contains language that may need HR/legal review.' });
  return {
    title: 'Untitled note (offline preview)', summary: sentences.slice(0, 2).join(' '), context: null,
    key_points: sentences, concerns: [],
    action_items: actions.map(a => ({ owner: null, action: a, due: null })),
    follow_up: null, flags, unclear: ['Offline rules only — choose an AI model for real formatting.'],
  };
}

async function readBody(req) {
  let s = ''; for await (const c of req) { s += c; if (s.length > 200_000) throw new Error('Body too large'); }
  return JSON.parse(s || '{}');
}

http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="HR Voice Notes demo"' }); return res.end('Authentication required'); }
    if (req.method === 'GET' && req.url === '/api/models') return send(200, { models: publicList() });
    if (req.method === 'POST' && req.url === '/api/refine') {
      if (rateLimited(req)) return send(429, { error: `Too many requests — limit is ${RATE_LIMIT} per minute. Wait a moment and retry.` });
      const body = await readBody(req);
      if (!body.text?.trim()) return send(400, { error: 'No text provided' });
      const m = find(body.modelId);
      if (!m) return send(400, { error: 'Unknown model' });
      if (!isAvailable(m)) return send(400, { error: `${m.label} is not configured (set ${m.keyEnv}).` });
      const t0 = Date.now();
      const note = m.provider === 'offline' ? refineLocally(body) : await callModel(m, body);
      return send(200, { note, offline: m.provider === 'offline', ms: Date.now() - t0 });
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
}).listen(PORT, () => console.log(`HR voice notes demo: http://localhost:${PORT}  (models available: ${MODELS.filter(isAvailable).map(m => m.id).join(', ')})`));
