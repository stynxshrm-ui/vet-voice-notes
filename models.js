// Model registry for the AI model dropdown, read from models.json (edit that file, not this one).
// The file is re-read whenever it changes, so new models and prices apply without a restart.
// Every provider except Anthropic uses the OpenAI-compatible /chat/completions API.
import { readFileSync, statSync } from 'node:fs';

const env = process.env;
const FILE = new URL('./models.json', import.meta.url);
const PROVIDERS = ['openai-compatible', 'anthropic', 'offline'];

function validate(list) {
  const ids = new Set();
  for (const m of list) {
    const where = `models.json: model "${m.id ?? '?'}"`;
    if (!m.id || !m.label || !m.group) throw new Error(`${where} needs id, label and group`);
    if (ids.has(m.id)) throw new Error(`${where} is listed twice`);
    ids.add(m.id);
    if (!PROVIDERS.includes(m.provider)) throw new Error(`${where}: provider must be one of ${PROVIDERS.join(', ')}`);
    if (m.provider === 'openai-compatible' && !m.baseUrl) throw new Error(`${where} needs baseUrl`);
    if (m.provider !== 'offline' && !m.model) throw new Error(`${where} needs model`);
    if (m.provider !== 'offline' && !m.local && !m.keyEnv) throw new Error(`${where} needs keyEnv (or local: true)`);
    if (m.price && !(Number.isFinite(m.price.input) && Number.isFinite(m.price.output))) throw new Error(`${where}: price needs numeric input and output`);
    if (m.maxTokens !== undefined && !(Number.isInteger(m.maxTokens) && m.maxTokens >= 256)) throw new Error(`${where}: maxTokens must be a whole number of at least 256`);
  }
  return list;
}

// Cached by modification time. A broken edit keeps the last good list (and logs why) instead of taking the app down.
let cache = { mtime: 0, list: [] };
export function models() {
  let mtime;
  try { mtime = statSync(FILE).mtimeMs; } catch (e) { if (cache.list.length) return cache.list; throw new Error('models.json not found'); }
  if (mtime === cache.mtime) return cache.list;
  try {
    const list = validate(JSON.parse(readFileSync(FILE, 'utf8')).models || []).filter(m => m.enabled !== false);
    cache = { mtime, list };
    console.log(`Loaded ${list.length} models from models.json`);
  } catch (e) {
    if (!cache.list.length) throw e;
    console.error(`Ignoring models.json change, keeping previous models: ${e.message}`);
    cache.mtime = mtime;
  }
  return cache.list;
}

export function costUsd(m, usage) {
  return m.price && usage ? (usage.input * m.price.input + usage.output * m.price.output) / 1e6 : null;
}

export const resolve = m => ({
  ...m,
  model: (m.modelEnv && env[m.modelEnv]) || m.model,
  baseUrl: (m.baseUrlEnv && env[m.baseUrlEnv]) || m.baseUrl,
});
export const isAvailable = m => m.provider === 'offline' || m.local || !!env[m.keyEnv];
export const find = id => { const m = models().find(x => x.id === id); return m && resolve(m); };

// What the UI shows: where the text goes. Important for client and patient data.
export function destination(m) {
  if (m.provider === 'offline') return 'Nothing leaves this server.';
  if (m.local) return `Sent to your own server (${new URL(m.baseUrl).host}). Stays on your network.`;
  const host = m.provider === 'anthropic' ? 'api.anthropic.com' : new URL(m.baseUrl).host;
  return `Pseudonymized text is sent to ${host} (third-party cloud).`;
}

export const publicList = () => models().map(m => ({
  id: m.id, group: m.group, label: m.label, available: isAvailable(m), destination: destination(resolve(m)),
  needs: isAvailable(m) ? null : m.keyEnv, reasoning: !!m.reasoning,
  price: m.price ? [m.price.input, m.price.output] : null, priceChecked: m.price?.checked || null, priceSource: m.price?.source || null,
}));
