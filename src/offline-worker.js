// Runs on-device models (no internet needed once downloaded) off the UI thread:
// Whisper for speech recognition and NLLB-200 for EN ⇄ JA translation.
// Model files are cached by the browser after the first download.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
// ONNX Runtime files are served with the app so they work offline too.
env.backends.onnx.wasm.wasmPaths = new URL('./ort/', self.location.href).href;
// GitHub Pages cannot enable cross-origin isolation, so no wasm threads.
env.backends.onnx.wasm.numThreads = 1;

export const ASR_MODELS = {
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
};
const MT_MODEL = 'Xenova/nllb-200-distilled-600M';
const NLLB = { en: 'eng_Latn', ja: 'jpn_Jpan' };
const WHISPER = { en: 'english', ja: 'japanese' };

let asr = null;
let asrKey = null;
let mt = null;

function progress(id) {
  return (p) => {
    if (p.status === 'progress' || p.status === 'done') {
      self.postMessage({ id, progress: { file: p.file, loaded: p.loaded, total: p.total, status: p.status } });
    }
  };
}

async function loadAsr(id, size, gpu) {
  const key = `${size}:${gpu}`;
  if (asr && asrKey === key) return asr;
  const model = ASR_MODELS[size] || ASR_MODELS.base;
  if (gpu && 'gpu' in navigator) {
    try {
      asr = await pipeline('automatic-speech-recognition', model, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback: progress(id),
      });
      asrKey = key;
      return asr;
    } catch {
      // WebGPU unavailable or unsupported on this GPU: fall back to wasm.
    }
  }
  asr = await pipeline('automatic-speech-recognition', model, { dtype: 'q8', progress_callback: progress(id) });
  asrKey = key;
  return asr;
}

async function loadMt(id) {
  if (!mt) mt = await pipeline('translation', MT_MODEL, { dtype: 'q8', progress_callback: progress(id) });
  return mt;
}

const handlers = {
  async load(id, { asrSize, gpu, withMt }) {
    if (asrSize) await loadAsr(id, asrSize, gpu);
    if (withMt) await loadMt(id);
    return true;
  },
  async transcribe(id, { audio, lang, asrSize, gpu }) {
    const model = await loadAsr(id, asrSize, gpu);
    const out = await model(audio, { language: WHISPER[lang], task: 'transcribe', chunk_length_s: 30 });
    return (out.text || '').trim();
  },
  async translate(id, { text, from, to }) {
    const model = await loadMt(id);
    const out = await model(text, { src_lang: NLLB[from], tgt_lang: NLLB[to], max_length: 512 });
    return (out[0]?.translation_text || '').trim();
  },
};

self.onmessage = async ({ data }) => {
  const { id, type, ...args } = data;
  try {
    const result = await handlers[type](id, args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
