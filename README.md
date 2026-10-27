# Vet Voice Notes

After a consult, the vet dictates by voice. The app turns the dictation into a structured clinical record, flags anything to check, and writes a plain-language summary for the client. The record is then saved to the patient's history. Speech-to-text runs **in the browser**; only text goes to the server.

> **Demo only.** There is no real access control, audit trail, database or practice-management integration ("Send to PMS" is simulated). Use fake data. Do not enter real client or patient information.

## How it works

```
Mic or audio file ─► Whisper (in-browser, WebGPU/WASM) ─► raw transcript
                                                              │
        pet/owner names swapped for "Patient A / Owner A" (in browser)
                                                              ▼
   Node server ─► LLM extracts JSON for the chosen template ─► app renders record ─► vet edits ─► save / PMS
                                                                                        │
                                                         client summary written from the edited record
```

- **Speech-to-text:** [Transformers.js](https://huggingface.co/docs/transformers.js) runs Whisper (tiny.en or base.en) in a Web Worker, on WebGPU when available, otherwise WASM. Audio never leaves the browser. The model (about 40–75 MB) is downloaded once and cached.
- **Templates** ([templates.js](templates.js)): Consult (SOAP), Recheck, Vaccination / health check, Dental / GA, Phone call, AFAST / TFAST ultrasound. The LLM only *extracts* into JSON; [public/render.js](public/render.js) writes the record text.
- **Never assumes normal:** anything not dictated shows as "Not stated" or "not assessed".
- **AFAST / TFAST:** the AFAST fluid score (DH, SR, CC, HR; 0, 1/2 or 1 each) is calculated by the app, not the model. Views that weren't scanned show "not assessed" and the score is marked partial. Interpretation lines are drafts for the vet to confirm.
- **Flags:** dose/unit problems, a weight-based drug with no weight, controlled drugs, euthanasia/consent, and mismatches with the patient on file. Misheard drug names fixed using [vocab.js](vocab.js) are listed for the vet to confirm.
- **Items to bill:** vaccines, procedures, tests and dispensed drugs mentioned in the dictation.
- **Client summary:** a second AI pass over the vet-edited record. It uses plain language, copies doses exactly and adds nothing new. Copying is disabled until the vet ticks "I've checked this summary".
- **Patients and history:** five fake patients ([public/patients.js](public/patients.js)); saved records live in the browser's `localStorage`.
- **Cost:** each record shows its AI cost (when the model has a price set), and a calculator compares monthly running cost with VetNotes' published plans.
- **Compare mode:** run one transcript through several models side by side, with timing and cost.

## Quick start

Requires Node 20.12 or newer. There are no dependencies to install.

```bash
cp .env.example .env     # add the API keys you want
node server.js           # http://localhost:3000
```

Use Chrome or Edge for WebGPU. The mic needs `localhost` or HTTPS. Click "Insert sample dictation for this template" to try each template without a mic.

## Choosing a model (eval)

[eval/cases.json](eval/cases.json) holds fake dictations with facts that must appear (doses, tooth numbers, the AFAST partial score), things that must not (a changed cytology grade, "negative" for an unscanned view), and expected flags. With the server running:

```bash
node eval/run.js groq-qwen groq-gpt-oss-120b openai-mini
```

It waits and retries when a provider rate-limits (Groq's free tier allows about 8k tokens per minute). Run it before a demo and default to the cheapest model that passes everything.

## Configuration

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, `ANTHROPIC_API_KEY` | Model providers; models without a key are greyed out |
| `OLLAMA_URL`, `VLLM_URL` | Self-hosted OpenAI-compatible servers (local use only) |
| `APP_PASSWORD`, `APP_USER` | Basic Auth login (user defaults to `vet`) |
| `RATE_LIMIT_PER_MIN` | AI requests per visitor per minute (default 20) |

### Models and prices: [models.json](models.json)

All AI models, their model IDs and their prices live in `models.json`. Edit it to add a model, hide one (`"enabled": false`), or update a price. The server re-reads it when it changes, so refresh the page and the dropdown and cost calculator pick it up, with no restart. A broken edit (bad JSON, missing field) is ignored and the previous list kept; the server log says why.

```json
{ "id": "groq-gpt-oss-120b", "group": "Hosted Inference", "label": "Groq Cloud: GPT-OSS 120B", "enabled": true,
  "provider": "openai-compatible", "baseUrl": "https://api.groq.com/openai/v1", "model": "openai/gpt-oss-120b", "keyEnv": "GROQ_API_KEY",
  "reasoning": true, "price": { "input": 0.15, "output": 0.60, "checked": "2026-10-27", "source": "where you got it" } }
```

`price` is USD per million tokens. Optional `maxTokens` caps how much the model may write per request (default 3000, or 8000 for Anthropic); lower it to fit a provider's output-per-minute limit. If a record hits the cap, the app refuses it with a clear message instead of saving a cut-off note. The `_help` block at the top of the file explains every field. API keys stay in `.env`, never in `models.json`.

## Deploy (Render)

1. Push this repo to GitHub (make sure `.env` is not committed).
2. In Render choose **New → Blueprint** and select the repo. It reads [render.yaml](render.yaml).
3. Set `APP_PASSWORD` and your API keys in the dashboard.

With `NODE_ENV=production` the server refuses to start without `APP_PASSWORD`.

## Privacy notes

- Audio stays in the browser. Only text is sent to the server.
- The selected patient's name and owner name (full and first name) are pseudonymized automatically, plus any extra names you list. Nicknames and misspellings will still go out.
- Cloud models receive the pseudonymized text. The UI shows where the text goes for the selected model.

## Project layout

```
server.js         static files, /api/models, /api/templates, /api/refine, /api/summary, /api/pms (stub), auth, rate limit
templates.js      template registry: instructions + JSON shape per template
prompts.js        core clinical-scribe rules and the client-summary prompt
vocab.js          drug/breed/shorthand spellings given to the model
models.json       AI models and prices (edit this)
models.js         loads and validates models.json
public/           index.html, app.js (UI), render.js (record text + AFAST score), patients.js (fake data + samples), worker.js (Whisper)
eval/             fake eval cases and runner
samples/          short synthetic voice clips for testing uploads
docs/research/    pricing research: speech-to-text hosting options and transcription provider prices
```

## Known limitations

- Whisper tiny/base running in the browser may mishear accents and drug names. Check the transcript before writing the record.
- Small models can drop details or break the JSON. Use the eval and compare mode.
- No real PMS integration, authentication beyond a shared password, database or audit log.
