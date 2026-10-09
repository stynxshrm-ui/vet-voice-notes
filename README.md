# HR Voice Notes

Dictate HR and operations notes by voice, then turn the rambling transcript into a clean, neutral, structured record. Speech-to-text runs **in the browser**; only text goes to the server.

> **Demo only.** There is no real access control, audit trail or database. Use fake data. Do not enter real employee information.

## How it works

```
Mic or audio file ─► Whisper (in-browser, WebGPU/WASM) ─► raw transcript
                                                              │
                 names swapped for "Employee A/B…" (in browser)
                                                              ▼
                 Node server ─► your chosen LLM ─► structured JSON ─► review ─► save
```

- **Speech-to-text:** [Transformers.js](https://huggingface.co/docs/transformers.js) runs Whisper (tiny.en or base.en) in a Web Worker. It uses WebGPU when a GPU adapter exists and falls back to WASM. Audio never leaves the browser. The first load downloads the model (about 40–75 MB) and caches it.
- **Upload or record:** use the mic, or drop a WAV, MP3 or M4A file.
- **Pseudonymization:** names you list are replaced with `Employee A`, `Employee B`… before the text is sent to any AI, then restored in the result.
- **AI formatting:** a prompt ([prompts.js](prompts.js)) rewrites the transcript as a neutral, factual note with a summary, key points, concerns, action items and follow-up. It does not invent facts. It also flags medical, legal-risk, protected-characteristic and speculative content, and lists anything that needs verification.
- **Model picker and compare mode:** choose from several cheap models, or tick several and run the same transcript through all of them side by side with timings.

## Quick start

Requires Node 20.12 or newer. There are no dependencies to install.

```bash
cp .env.example .env     # add the API keys you want
node server.js           # http://localhost:3000
```

Use Chrome or Edge for WebGPU. The mic needs `localhost` or HTTPS.

Models with no key are greyed out in the dropdown. "Offline rules only" works with no key, but it is only basic cleanup.

## Configuration

Set these in `.env` (local) or in your host's environment settings (deployed):

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | GPT-4o mini |
| `GROQ_API_KEY` | Qwen 3.8 27B, GPT-OSS 120B and 20B on Groq (free tier available) |
| `DEEPSEEK_API_KEY` | DeepSeek V4 Flash and Pro |
| `DASHSCOPE_API_KEY` | Alibaba Qwen (international endpoint) |
| `ANTHROPIC_API_KEY` | Claude Haiku |
| `OLLAMA_URL`, `VLLM_URL` | Self-hosted OpenAI-compatible servers (local use only) |
| `APP_PASSWORD`, `APP_USER` | Basic Auth login (user defaults to `hr`) |
| `RATE_LIMIT_PER_MIN` | AI requests per visitor per minute (default 20) |

Provider model IDs change often. Override any of them without editing code, for example `GROQ_QWEN_MODEL=...` (see `modelEnv` in [models.js](models.js)). To see what Groq currently offers: `GET https://api.groq.com/openai/v1/models`.

## Deploy (Render)

1. Push this repo to GitHub (make sure `.env` is not committed).
2. In Render choose **New → Blueprint** and select the repo. It reads [render.yaml](render.yaml).
3. Set `APP_PASSWORD` and your API keys in the dashboard.
4. Share the HTTPS URL, username `hr` and the password with testers.

With `NODE_ENV=production` the server refuses to start without `APP_PASSWORD`, so a public deployment cannot be left open by accident. Ollama and vLLM entries will not work on a hosted server because they point at `localhost` there.

## Privacy notes

- Audio stays in the browser. Only text is sent to the server.
- Only the names you list are pseudonymized. Nicknames, misspellings and names you forget will still go out.
- Cloud models receive the pseudonymized note text. DeepSeek and Alibaba are China-hosted services. The UI shows where the text goes for the selected model.
- Saved notes live in each browser's `localStorage`. They are not shared and not backed up.

## Project layout

```
server.js        static files, /api/models, /api/refine, auth, rate limit
models.js        model registry for the dropdown (endpoints, keys, overrides)
prompts.js       system prompt and message builder for HR formatting
env.js           loads .env before anything else
public/          index.html, app.js (UI), worker.js (Whisper)
samples/         two short synthetic voice clips for testing uploads
render.yaml      Render blueprint
```

## Testing with the samples

Drag [samples/sample-10s.mp3](samples/sample-10s.mp3) or [samples/vet-hr-10s.mp3](samples/vet-hr-10s.mp3) onto the upload box. They are synthetic voices, so accuracy is not representative. Try the "Insert sample dictation" button as well. It contains a back problem, medication, "lazy" and a guess that someone may leave, to test the flags and neutral rewrite.

## Known limitations

- WASM transcription is slow on long recordings. WebGPU is much faster where available.
- Small models can break the JSON format or add details. Use compare mode to check.
- No authentication beyond a shared password, no database, no audit log.
