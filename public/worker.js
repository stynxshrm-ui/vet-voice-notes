// Whisper runs here so the UI never freezes. Audio never leaves the browser.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
env.allowLocalModels = false;

let asr = null, loadedKey = null, gpuBroken = false;

const build = (model, device) => pipeline('automatic-speech-recognition', model, {
  device,
  dtype: device === 'webgpu' ? 'fp32' : 'q8',
  progress_callback: p => { if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, pct: p.progress }); },
});

let inflight = null, inflightModel = null;
function load(model) {
  if (inflight && inflightModel === model) return inflight; // share one load between 'load' and 'transcribe'
  inflightModel = model;
  return inflight = doLoad(model).catch(e => { inflight = null; throw e; });
}

async function doLoad(model) {
  // navigator.gpu can exist while no usable GPU adapter does, so try WebGPU and fall back to WASM.
  // Probe for a real adapter first: ORT-web caches a failed WebGPU init, so a retry in the same worker would not recover.
  const adapter = navigator.gpu && !gpuBroken ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  const tryGpu = !!adapter;
  if (asr && loadedKey?.startsWith(model)) return loadedKey.split('|')[1];
  let device = tryGpu ? 'webgpu' : 'wasm';
  try {
    asr = await build(model, device);
  } catch (e) {
    if (device === 'wasm') throw e;
    gpuBroken = true; device = 'wasm';
    console.warn('WebGPU unavailable, falling back to WASM:', e.message);
    try { asr = await build(model, device); }
    catch (e2) { throw new Error(`WebGPU failed (${e.message}); WASM failed (${e2.message})`); }
  }
  loadedKey = `${model}|${device}`;
  return device;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const device = await load(data.model);
      self.postMessage({ type: 'ready', device });
    } else if (data.type === 'transcribe') {
      await load(data.model);
      const out = await asr(data.audio, { chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ type: 'result', text: out.text.trim() });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message || String(e) });
  }
};
