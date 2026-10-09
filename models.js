// Model registry for the "AI Post-Processing Mode" dropdown.
// Every entry except Claude uses the OpenAI-compatible /chat/completions API.
// Provider model IDs change often — verify them against each provider's docs and override
// via the env var in `modelEnv` without touching code.
const env = process.env;

export const MODELS = [
  // --- Cloud APIs (pay-as-you-go) ---
  { id: 'deepseek-v4-flash', group: 'Cloud API (Ultra-Low Cost)', label: 'DeepSeek V4 Flash (Fast, Dirt Cheap)',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', modelEnv: 'DEEPSEEK_FLASH_MODEL', keyEnv: 'DEEPSEEK_API_KEY' },
  { id: 'deepseek-v4-pro', group: 'Cloud API (Ultra-Low Cost)', label: 'DeepSeek V4 Pro (High Reasoning / Deep Clean)',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', modelEnv: 'DEEPSEEK_PRO_MODEL', keyEnv: 'DEEPSEEK_API_KEY' },
  { id: 'qwen3.8-flash', group: 'Cloud API (Ultra-Low Cost)', label: 'Alibaba Qwen 3.8 Flash (Excellent Multi-lingual)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', modelEnv: 'QWEN_FLASH_MODEL', keyEnv: 'DASHSCOPE_API_KEY' },
  { id: 'qwen3.7-plus', group: 'Cloud API (Ultra-Low Cost)', label: 'Alibaba Qwen 3.7 Plus (Balanced & Stable)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus', modelEnv: 'QWEN_PLUS_MODEL', keyEnv: 'DASHSCOPE_API_KEY' },

  { id: 'openai-mini', group: 'Cloud API (Ultra-Low Cost)', label: 'OpenAI GPT-4o mini (Cheap, Reliable JSON)',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', modelEnv: 'OPENAI_MODEL', keyEnv: 'OPENAI_API_KEY' },

  // --- Hosted inference (free developer tiers) ---
  { id: 'groq-qwen', group: 'Hosted Inference (Free Tier Available)', label: 'Groq Cloud: Qwen 3.8 27B (Fast)',
    baseUrl: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b', modelEnv: 'GROQ_QWEN_MODEL', keyEnv: 'GROQ_API_KEY' },
  { id: 'groq-gpt-oss-120b', group: 'Hosted Inference (Free Tier Available)', label: 'Groq Cloud: GPT-OSS 120B (Deep Formatting)',
    baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', modelEnv: 'GROQ_GPT_OSS_120B_MODEL', keyEnv: 'GROQ_API_KEY' },
  { id: 'groq-gpt-oss-20b', group: 'Hosted Inference (Free Tier Available)', label: 'Groq Cloud: GPT-OSS 20B (Ultra-Fast)',
    baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b', modelEnv: 'GROQ_GPT_OSS_20B_MODEL', keyEnv: 'GROQ_API_KEY' },

  // --- Self-hosted (no key; text stays on your network) ---
  { id: 'local-ollama-qwen3', group: 'Self-Hosted (Private Server)', label: 'Local: Ollama / Qwen 3 (100% Private)', local: true,
    baseUrl: env.OLLAMA_URL || 'http://localhost:11434/v1', model: 'qwen3', modelEnv: 'OLLAMA_MODEL' },
  { id: 'local-vllm-deepseek', group: 'Self-Hosted (Private Server)', label: 'Local: vLLM / DeepSeek 7B (High Throughput)', local: true,
    baseUrl: env.VLLM_URL || 'http://localhost:8000/v1', model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', modelEnv: 'VLLM_MODEL' },

  // --- Anthropic (different API shape) ---
  { id: 'claude-haiku', group: 'Anthropic', label: 'Claude Haiku (Reliable baseline)', provider: 'anthropic',
    model: 'claude-haiku-5-5', modelEnv: 'ANTHROPIC_MODEL', keyEnv: 'ANTHROPIC_API_KEY' },

  // --- No AI ---
  { id: 'offline', group: 'No AI', label: 'Offline rules only (no AI, basic cleanup)', provider: 'offline' },
];

export const resolve = m => ({ ...m, model: (m.modelEnv && env[m.modelEnv]) || m.model });
export const isAvailable = m => m.provider === 'offline' || m.local || !!env[m.keyEnv];
export const find = id => { const m = MODELS.find(x => x.id === id); return m && resolve(m); };

// What the UI shows: where the text goes. Important for HR data.
export function destination(m) {
  if (m.provider === 'offline') return 'Nothing leaves this server.';
  if (m.local) return `Sent to your own server (${new URL(m.baseUrl).host}). Stays on your network.`;
  const host = m.provider === 'anthropic' ? 'api.anthropic.com' : new URL(m.baseUrl).host;
  return `Pseudonymized text is sent to ${host} (third-party cloud).`;
}

export const publicList = () => MODELS.map(m => ({
  id: m.id, group: m.group, label: m.label, available: isAvailable(m), destination: destination(resolve(m)),
  needs: isAvailable(m) ? null : m.keyEnv,
}));
