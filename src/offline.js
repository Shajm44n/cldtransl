// Offline engine: on-device speech recognition and translation, no Claude and
// no internet needed once the offline pack is downloaded.
// Translation prefers Chrome's built-in on-device Translator when the phone
// has it, and otherwise uses the NLLB model in offline-worker.js.

const STATE_KEY = 'kakehashi.offline';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// { asrSize: 'base'|'small', gpu, mt: 'builtin'|'nllb', ready }
const state = loadState();

export const offlineStatus = () => ({ ...state });
export const asrReady = () => !!(state.ready && state.asrSize);
export const mtReady = () => !!(state.ready && state.mt);

// ---- Worker plumbing ----

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker('offline-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if (data.progress) return p.onProgress?.(data.progress);
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Offline engine crashed.'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function call(type, args = {}, onProgress, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, type, ...args }, transfer);
  });
}

// ---- Chrome built-in Translator (on-device) ----

const builtins = {};

async function builtinTranslator(from, to, { download = false, onProgress } = {}) {
  if (!('Translator' in self)) return null;
  const key = `${from}-${to}`;
  if (builtins[key]) return builtins[key];
  try {
    const availability = await self.Translator.availability({ sourceLanguage: from, targetLanguage: to });
    if (availability === 'unavailable') return null;
    if (availability !== 'available' && !download) return null;
    builtins[key] = await self.Translator.create({
      sourceLanguage: from,
      targetLanguage: to,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress?.({ file: `Translator ${key}`, loaded: e.loaded, total: 1 }));
      },
    });
    return builtins[key];
  } catch {
    return null;
  }
}

// ---- Public API ----

// Downloads everything needed offline. Must be called from a tap (user gesture).
export async function downloadPack({ asrSize = 'base', gpu = true, onProgress }) {
  // Keep the app files (incl. the ONNX runtime) in the offline cache.
  for (const f of ['offline-worker.js', 'ort/ort-wasm-simd-threaded.jsep.mjs', 'ort/ort-wasm-simd-threaded.jsep.wasm']) {
    onProgress?.({ file: f, status: 'progress', loaded: 0, total: 1 });
    await fetch(f, { cache: 'reload' }).then((r) => r.ok && r.arrayBuffer());
  }

  const en2ja = await builtinTranslator('en', 'ja', { download: true, onProgress });
  const ja2en = await builtinTranslator('ja', 'en', { download: true, onProgress });
  const useBuiltin = !!(en2ja && ja2en);

  await call('load', { asrSize, gpu, withMt: !useBuiltin }, onProgress);
  Object.assign(state, { asrSize, gpu, mt: useBuiltin ? 'builtin' : 'nllb', ready: true });
  saveState();
  return offlineStatus();
}

// Loads cached models into memory in the background so the first use is fast.
export function warmUp() {
  if (!state.ready) return;
  call('load', { asrSize: state.asrSize, gpu: state.gpu, withMt: state.mt === 'nllb' }).catch(() => {});
}

export async function transcribe(audio, lang) {
  if (!asrReady()) throw new Error('Download the offline pack in Settings to use voice input without internet.');
  return call('transcribe', { audio, lang, asrSize: state.asrSize, gpu: state.gpu }, null, [audio.buffer]);
}

export async function translateOffline(text, from, to) {
  if (state.mt === 'builtin' || !state.ready) {
    const t = await builtinTranslator(from, to);
    if (t) return (await t.translate(text)).trim();
  }
  if (state.ready && state.mt === 'nllb') return call('translate', { text, from, to });
  throw new Error('No internet and no offline pack. Download the offline pack in Settings while you are online.');
}

export function forgetPack() {
  for (const k of Object.keys(state)) delete state[k];
  saveState();
  worker?.terminate();
  worker = null;
  return caches?.delete?.('transformers-cache');
}
