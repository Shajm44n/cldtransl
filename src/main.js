import Anthropic from '@anthropic-ai/sdk';
import { LANGS } from './prompts.js';
import { translate, interpret, ask, friendlyError } from './claude.js';
import { Recorder } from './recorder.js';
import { applyGlossary, cultureHints, PHRASEBOOK } from './local.js';
import { asrReady, mtReady, offlineStatus, downloadPack, warmUp, transcribe, translateOffline, forgetPack } from './offline.js';
import {
  Listener,
  recognitionSupported,
  synthesisSupported,
  STT_LOCALE,
  listMicrophones,
  requestMicPermission,
  releaseMic,
  voicesFor,
  speak,
  stopSpeaking,
  unlockSpeech,
} from './speech.js';
import { enableHeadsetButtons, disableHeadsetButtons, headsetSupported } from './headset.js';

const $ = (id) => document.getElementById(id);

// ---- Persistent state ----

const OLD_DEFAULT_CONTEXT = `My company: Acsia (automotive software). Always keep "Acsia" in Latin letters. Speech recognition may hear it as "Asia" or "Axia".
Lila: (describe what Lila is – a product, project or person – and how it should be written in Japanese)
Topics: automotive software, software-defined vehicles, AI.
People: (add names and titles, e.g. Tanaka-san, 部長 at …)`;

const DEFAULT_CONTEXT = `My company: Acsia (automotive software). Always keep "Acsia" and "LiLA" in Latin letters.
Product: LiLA, Acsia's agentic AI platform (SpecFlow, SafeFlow, CodeFlow, TestFlow).
People: (add names and titles, e.g. Tanaka-san, 部長 at …)

Speech-recognition fixes, one per line as "heard => correct":
Axia => Acsia
Acsia Tech => Acsia
Lila => LiLA
Leela => LiLA
Spec flow => SpecFlow
Safe flow => SafeFlow
Code flow => CodeFlow
Test flow => TestFlow`;

const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  formality: 'polite',
  interpreterEffort: 'medium',
  micId: 'default',
  enLocale: 'en-US',
  voiceEn: '',
  voiceJa: '',
  rate: 1,
  speak: 'both',
  showBig: false,
  autoTurn: false,
  headset: false,
  context: DEFAULT_CONTEXT,
  mode: 'translator',
  typeLang: 'en',
  engine: 'auto',
  asrSize: 'base',
  gpu: true,
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) – keep working in memory */
  }
}

const settings = { ...DEFAULTS, ...load('kakehashi.settings', {}) };
if (settings.context === OLD_DEFAULT_CONTEXT) settings.context = DEFAULT_CONTEXT;
let history = load('kakehashi.history', []).filter((h) => !h.pending);
const saveSettings = () => save('kakehashi.settings', settings);
const saveHistory = () => save('kakehashi.history', history.slice(-100));

// side → languages
const SIDES = {
  me: { from: 'en', to: 'ja' },
  partner: { from: 'ja', to: 'en' },
};

const listener = new Listener();
let capture = null; // the active Web Speech listener or on-device recorder
let listeningSide = null;
let currentAbort = null;
let busy = false;

// ---- Engine choice ----

const isSamsungBrowser = /SamsungBrowser/i.test(navigator.userAgent);

// Claude when online with a key (unless forced offline), otherwise on-device.
function useClaude() {
  if (settings.engine === 'offline') return false;
  if (settings.engine === 'claude') return true;
  return navigator.onLine && !!settings.apiKey;
}

function canTranslateOffline() {
  return mtReady() || 'Translator' in self;
}

function renderEngine() {
  const claude = useClaude();
  const chip = $('engineChip');
  chip.textContent = claude ? '☁︎ Claude' : '📴 Offline';
  chip.classList.toggle('offline', !claude);
}

// ---- Rendering ----

const transcript = $('transcript');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function cardHtml(h) {
  if (h.kind === 'qa') {
    return `<div class="who">💬 You asked</div>
      <div class="source">${esc(h.source)}</div>
      <div class="answer translation ${h.pending ? 'pending' : ''}" style="font-size:16px">${esc(h.answer)}</div>
      ${h.error ? `<div class="error">${esc(h.error)}</div>` : ''}`;
  }
  const from = LANGS[h.from];
  const to = LANGS[h.to];
  const who = h.speaker === 'me' ? 'You' : 'Partner';
  const tag = h.offline ? ' · 📴 offline' : h.mode === 'interpreter' ? ' · interpreter' : '';
  let html = `<div class="who">${from.flag} ${who} · ${from.native} → ${to.native}${tag}</div>
    <div class="source" lang="${h.from}">${esc(h.source)}</div>
    <div class="translation ${h.pending ? 'pending' : ''}" lang="${h.to}">${esc(h.translation)}</div>`;
  if (h.romaji) html += `<div class="romaji">${esc(h.romaji)}</div>`;
  if (h.nuance) html += `<div class="nuance">💡 ${esc(h.nuance)}</div>`;
  if (h.terms?.length) {
    html += `<ul class="terms">${h.terms.map((t) => `<li><b>${esc(t.term)}</b> – ${esc(t.meaning)}</li>`).join('')}</ul>`;
  }
  if (h.replies?.length) {
    html += `<div class="replies">${h.replies
      .map(
        (r, i) => `<button class="reply" data-reply="${i}">
          <span class="ja" lang="ja">🔊 ${esc(r.ja)}</span>
          <span class="r">${esc(r.romaji)}</span>
          <span class="en">${esc(r.en)}</span></button>`,
      )
      .join('')}</div>`;
  }
  if (h.error) html += `<div class="error">${esc(h.error)} <button class="link-btn" data-act="retry">Retry</button></div>`;
  if (!h.pending && !h.error && h.translation) {
    html += `<div class="actions">
      <button data-act="play">🔊 Play</button>
      ${h.to === 'ja' ? '<button data-act="show">⛶ Show</button>' : ''}
      <button data-act="copy">Copy</button></div>`;
  }
  return html;
}

function renderCard(h) {
  let el = transcript.querySelector(`[data-id="${h.id}"]`);
  if (!el) {
    el = document.createElement('article');
    el.dataset.id = h.id;
    transcript.appendChild(el);
  }
  el.className = `card ${h.kind === 'qa' ? 'qa' : h.speaker}`;
  el.innerHTML = cardHtml(h);
  $('emptyState').hidden = true;
  transcript.scrollTop = transcript.scrollHeight;
}

function renderAll() {
  transcript.querySelectorAll('.card').forEach((c) => c.remove());
  $('emptyState').hidden = history.length > 0;
  history.forEach(renderCard);
}

function renderMode() {
  const phrases = settings.mode === 'phrases';
  document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === settings.mode)));
  document.querySelectorAll('.mode-help').forEach((p) => (p.hidden = p.dataset.for !== settings.mode));
  $('askForm').hidden = settings.mode !== 'interpreter';
  $('transcript').hidden = phrases;
  $('phrases').hidden = !phrases;
  $('typeForm').hidden = phrases;
}

function renderPhrases() {
  $('phrases').innerHTML =
    `<p class="hint">Works offline. Tap a phrase to say it in Japanese, or long-press to show it full-screen.</p>` +
    PHRASEBOOK.map(
      (group, g) => `<h3>${esc(group.title)}</h3>` +
        group.phrases
          .map(
            ([ja, romaji, en], i) => `<button class="reply phrase" data-phrase="${g}:${i}">
              <span class="ja" lang="ja">🔊 ${esc(ja)}</span>
              <span class="r">${esc(romaji)}</span>
              <span class="en">${esc(en)}</span></button>`,
          )
          .join(''),
    ).join('');
}

function renderMics() {
  for (const side of ['me', 'partner']) {
    const btn = side === 'me' ? $('micMe') : $('micPartner');
    btn.classList.toggle('listening', listeningSide === side);
    btn.classList.toggle('busy', busy && listeningSide !== side);
  }
}

function setLive(text) {
  $('live').hidden = text == null;
  $('liveText').textContent = text || 'Listening…';
}

function showBanner(html) {
  const b = $('banner');
  b.innerHTML = html;
  b.hidden = !html;
}

function checkSetup() {
  const problems = [];
  const settingsLink = '<button class="link-btn" data-open-settings>Settings</button>';
  if (isSamsungBrowser && !asrReady()) {
    problems.push(`You are in Samsung Internet, which has no voice input. Open this page in <b>Chrome</b> (⋮ → Open in Chrome), or download the offline pack in ${settingsLink}.`);
  } else if (!recognitionSupported && !asrReady()) {
    problems.push(`Voice input is not available in this browser. Use Chrome, or download the offline pack in ${settingsLink}. Typing still works.`);
  }
  if (settings.engine !== 'offline' && !settings.apiKey && !canTranslateOffline()) {
    problems.push(`Add your Anthropic API key, or download the offline pack, in ${settingsLink}.`);
  }
  if (!synthesisSupported) problems.push('Read-aloud is not available in this browser.');
  showBanner(problems.join('<br>'));
  renderEngine();
}

// ---- Core flow ----

function voiceOpts(lang) {
  return {
    rate: settings.rate,
    voiceURI: lang === 'ja' ? settings.voiceJa : settings.voiceEn,
    locale: lang === 'ja' ? 'ja-JP' : settings.enLocale,
  };
}

function shouldSpeak(entry) {
  if (settings.speak === 'off') return false;
  if (settings.speak === 'partner') return entry.speaker === 'partner';
  return true;
}

function showBig(entry) {
  $('bigText').textContent = entry.translation;
  $('bigSub').textContent = entry.source;
  $('bigView').hidden = false;
}

async function processUtterance(entry) {
  busy = true;
  renderMics();
  entry.pending = true;
  entry.error = null;
  entry.translation = '';
  renderCard(entry);

  const controller = new AbortController();
  currentAbort = controller;
  const prior = history.filter((h) => h !== entry);
  const runOffline = async () => {
    entry.offline = true;
    entry.translation = await translateOffline(entry.source, entry.from, entry.to);
    entry.nuance = entry.mode === 'interpreter' ? cultureHints(entry.source, entry.from) : '';
    entry.romaji = '';
    entry.terms = [];
    entry.replies = [];
  };
  const runClaude = async () => {
    const args = {
      settings,
      text: entry.source,
      from: entry.from,
      to: entry.to,
      speaker: entry.speaker,
      history: prior,
      signal: controller.signal,
    };
    if (entry.mode === 'interpreter') {
      const r = await interpret(args);
      Object.assign(entry, {
        translation: r.translation,
        romaji: r.romaji,
        nuance: r.nuance,
        terms: r.terms,
        replies: entry.speaker === 'partner' ? r.suggested_replies : [],
      });
    } else {
      entry.translation = await translate({
        ...args,
        onText: (t) => {
          entry.translation = t;
          renderCard(entry);
        },
      });
    }
  };
  try {
    entry.offline = false;
    if (!useClaude()) {
      await runOffline();
    } else {
      await runClaude();
    }
  } catch (err) {
    // Lost connection mid-conversation: fall back to the on-device engine.
    if (err instanceof Anthropic.APIConnectionError && !(err instanceof Anthropic.APIUserAbortError) && canTranslateOffline()) {
      try {
        await runOffline();
      } catch (offlineErr) {
        entry.error = friendlyError(offlineErr);
      }
    } else {
      entry.error = friendlyError(err);
    }
  } finally {
    entry.pending = false;
    currentAbort = null;
    busy = false;
    renderCard(entry);
    renderMics();
    saveHistory();
  }
  return finishUtterance(entry);
}

async function finishUtterance(entry) {
  if (entry.error) return false;
  if (settings.showBig && entry.speaker === 'me' && entry.to === 'ja') showBig(entry);
  if (shouldSpeak(entry)) await speak(entry.translation, entry.to, voiceOpts(entry.to));
  return true;
}

function newEntry(side, text) {
  const { from, to } = SIDES[side];
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'utterance',
    mode: settings.mode === 'interpreter' ? 'interpreter' : 'translator',
    speaker: side,
    from,
    to,
    source: text,
    translation: '',
  };
  history.push(entry);
  return entry;
}

// Listens for one utterance. Uses the browser's speech recognition when online,
// and the on-device Whisper model when offline or when the browser has none.
async function captureSpeech(lang) {
  const webSpeech = recognitionSupported && (useClaude() || !asrReady());
  if (webSpeech) {
    capture = listener;
    return listener.listen({
      lang,
      sttLocale: lang === 'en' ? settings.enLocale : STT_LOCALE.ja,
      deviceId: settings.micId,
      onInterim: (t) => setLive(t || 'Listening…'),
    });
  }
  if (!asrReady()) throw new Error('Voice input needs the offline pack here. Download it in Settings.');
  const rec = new Recorder();
  capture = rec;
  setLive('Listening on device… (tap again when done)');
  const audio = await rec.record({ deviceId: settings.micId });
  if (!audio || capture !== rec) return '';
  setLive('Recognising speech on device…');
  return transcribe(audio, lang);
}

async function startListening(side) {
  if (settings.engine !== 'offline' && !settings.apiKey && !canTranslateOffline()) {
    openSettings();
    return;
  }
  unlockSpeech();
  stopSpeaking();
  $('bigView').hidden = true;
  listeningSide = side;
  renderMics();
  setLive('Listening…');
  const lang = SIDES[side].from;
  let text = '';
  try {
    text = applyGlossary(await captureSpeech(lang), settings.context);
  } catch (err) {
    showBanner(esc(err.message));
  }
  if (listeningSide !== side) return; // Cancelled or switched to the other side.
  listeningSide = null;
  setLive(null);
  renderMics();
  if (!text) return;

  const ok = await processUtterance(newEntry(side, text));
  if (ok && settings.autoTurn && !listeningSide && !busy) {
    startListening(side === 'me' ? 'partner' : 'me');
  }
}

function stopListening(keep = true) {
  if (keep) {
    capture?.stop(); // startListening continues with what was heard.
  } else {
    listeningSide = null;
    capture?.abort();
    capture = null;
    setLive(null);
    renderMics();
  }
}

function onMic(side) {
  if (listeningSide === side) {
    stopListening(true);
    return;
  }
  if (listeningSide) stopListening(false);
  currentAbort?.abort();
  startListening(side);
}

async function askInterpreter(question) {
  if (!useClaude()) {
    showBanner('Asking the interpreter needs Claude (internet and API key). The Phrases tab works offline.');
    return;
  }
  const entry = { id: `${Date.now()}-q`, kind: 'qa', source: question, answer: '', pending: true };
  history.push(entry);
  renderCard(entry);
  try {
    entry.answer = await ask({
      settings,
      question,
      history: history.filter((h) => h !== entry),
      onText: (t) => {
        entry.answer = t;
        renderCard(entry);
      },
    });
  } catch (err) {
    entry.error = friendlyError(err);
  } finally {
    entry.pending = false;
    renderCard(entry);
    saveHistory();
  }
}

// ---- Settings dialog ----

const dialog = $('settings');

function fillVoices(select, lang, current) {
  const list = voicesFor(lang);
  select.innerHTML =
    `<option value="">Automatic</option>` +
    list.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  select.value = list.some((v) => v.voiceURI === current) ? current : '';
}

async function fillMics(askPermission = false) {
  const select = $('sMic');
  try {
    if (askPermission) await requestMicPermission();
    const mics = await listMicrophones();
    select.innerHTML =
      `<option value="default">System default (headset when connected)</option>` +
      mics
        .filter((m) => m.deviceId && m.deviceId !== 'default')
        .map((m, i) => `<option value="${esc(m.deviceId)}">${esc(m.label || `Microphone ${i + 1}`)}</option>`)
        .join('');
    select.value = [...select.options].some((o) => o.value === settings.micId) ? settings.micId : 'default';
  } catch (err) {
    showBanner(`Microphone access failed: ${esc(err.message)}`);
  }
}

function openSettings() {
  $('sApiKey').value = settings.apiKey;
  $('sModel').value = settings.model;
  $('sFormality').value = settings.formality;
  $('sEffort').value = settings.interpreterEffort;
  $('sEnLocale').value = settings.enLocale;
  $('sRate').value = settings.rate;
  $('sSpeak').value = settings.speak;
  $('sShowBig').checked = settings.showBig;
  $('sAutoTurn').checked = settings.autoTurn;
  $('sHeadset').checked = settings.headset;
  $('sHeadset').disabled = !headsetSupported;
  $('sContext').value = settings.context;
  $('sEngine').value = settings.engine;
  $('sAsrSize').value = settings.asrSize;
  $('sGpu').checked = settings.gpu;
  renderOfflineStatus();
  fillVoices($('sVoiceEn'), 'en', settings.voiceEn);
  fillVoices($('sVoiceJa'), 'ja', settings.voiceJa);
  fillMics(false);
  dialog.showModal();
}

async function applyHeadset() {
  if (settings.headset) {
    try {
      await enableHeadsetButtons({
        toggle: () => {
          if (listeningSide) stopListening(true);
          else startListening(lastSide);
        },
        switchSide: () => {
          lastSide = lastSide === 'me' ? 'partner' : 'me';
          if (listeningSide) {
            stopListening(false);
            startListening(lastSide);
          }
        },
      });
    } catch (err) {
      showBanner(`Headset buttons: ${esc(err.message)}`);
    }
  } else {
    disableHeadsetButtons();
  }
}
let lastSide = 'me';

dialog.addEventListener('close', () => {
  const prevMic = settings.micId;
  Object.assign(settings, {
    apiKey: $('sApiKey').value.trim(),
    model: $('sModel').value,
    formality: $('sFormality').value,
    interpreterEffort: $('sEffort').value,
    micId: $('sMic').value,
    enLocale: $('sEnLocale').value,
    voiceEn: $('sVoiceEn').value,
    voiceJa: $('sVoiceJa').value,
    rate: Number($('sRate').value),
    speak: $('sSpeak').value,
    showBig: $('sShowBig').checked,
    autoTurn: $('sAutoTurn').checked,
    headset: $('sHeadset').checked,
    context: $('sContext').value,
    engine: $('sEngine').value,
    asrSize: $('sAsrSize').value,
    gpu: $('sGpu').checked,
  });
  if (prevMic !== settings.micId) releaseMic();
  $('quickAutoTurn').checked = settings.autoTurn;
  saveSettings();
  checkSetup();
  applyHeadset();
});

// ---- Event wiring ----

document.querySelectorAll('.modes button').forEach((b) =>
  b.addEventListener('click', () => {
    settings.mode = b.dataset.mode;
    saveSettings();
    renderMode();
  }),
);

$('micMe').addEventListener('click', () => {
  lastSide = 'me';
  onMic('me');
});
$('micPartner').addEventListener('click', () => {
  lastSide = 'partner';
  onMic('partner');
});

$('settingsBtn').addEventListener('click', openSettings);

function renderOfflineStatus(extra = '') {
  const s = offlineStatus();
  const builtin = 'Translator' in self ? 'Chrome on-device translator available.' : '';
  $('sOfflineStatus').innerHTML = s.ready
    ? `✅ Offline pack ready: speech model “${esc(s.asrSize)}”, translation ${s.mt === 'builtin' ? 'by Chrome on-device translator' : 'by NLLB model'}. ${extra}`
    : `Not downloaded. ${builtin} ${extra}`;
}

$('sDownload').addEventListener('click', async () => {
  const btn = $('sDownload');
  const bar = $('sProgress');
  btn.disabled = true;
  bar.hidden = false;
  const files = {};
  try {
    await downloadPack({
      asrSize: $('sAsrSize').value,
      gpu: $('sGpu').checked,
      onProgress: (p) => {
        if (!p.file) return;
        files[p.file] = { loaded: p.loaded || 0, total: p.total || p.loaded || 1 };
        const all = Object.values(files);
        const loaded = all.reduce((n, f) => n + f.loaded, 0);
        const total = all.reduce((n, f) => n + f.total, 0);
        bar.value = total ? loaded / total : 0;
        const mb = (n) => (n / 1e6).toFixed(0);
        $('sOfflineStatus').textContent = total > 1e6 ? `Downloading… ${mb(loaded)} / ${mb(total)} MB` : 'Preparing…';
      },
    });
    renderOfflineStatus();
  } catch (err) {
    renderOfflineStatus(`⚠️ Download failed: ${esc(err.message)}`);
  } finally {
    btn.disabled = false;
    bar.hidden = true;
    checkSetup();
  }
});

$('sForget').addEventListener('click', async () => {
  if (!confirm('Delete the downloaded offline models from this phone?')) return;
  await forgetPack();
  renderOfflineStatus();
  checkSetup();
});
$('sMicRefresh').addEventListener('click', () => fillMics(true));
$('sClear').addEventListener('click', () => {
  if (!confirm('Clear the whole conversation?')) return;
  history = [];
  saveHistory();
  renderAll();
});
$('banner').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-settings]')) openSettings();
});

$('quickAutoTurn').checked = settings.autoTurn;
$('quickAutoTurn').addEventListener('change', (e) => {
  settings.autoTurn = e.target.checked;
  saveSettings();
});

$('stopBtn').addEventListener('click', () => {
  stopSpeaking();
  if (listeningSide) stopListening(false);
  currentAbort?.abort();
});

$('typeLang').textContent = settings.typeLang.toUpperCase();
$('typeLang').addEventListener('click', () => {
  settings.typeLang = settings.typeLang === 'en' ? 'ja' : 'en';
  $('typeLang').textContent = settings.typeLang.toUpperCase();
  saveSettings();
});

$('typeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('typeInput').value.trim();
  if (!text) return;
  unlockSpeech();
  $('typeInput').value = '';
  processUtterance(newEntry(settings.typeLang === 'en' ? 'me' : 'partner', text));
});

$('askForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('askInput').value.trim();
  if (!q) return;
  $('askInput').value = '';
  askInterpreter(q);
});

$('phrases').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-phrase]');
  if (!btn) return;
  const [g, i] = btn.dataset.phrase.split(':').map(Number);
  unlockSpeech();
  speak(PHRASEBOOK[g].phrases[i][0], 'ja', voiceOpts('ja'));
});
$('phrases').addEventListener('contextmenu', (e) => {
  const btn = e.target.closest('[data-phrase]');
  if (!btn) return;
  e.preventDefault();
  const [g, i] = btn.dataset.phrase.split(':').map(Number);
  const [ja, , en] = PHRASEBOOK[g].phrases[i];
  showBig({ translation: ja, source: en });
});

$('engineChip').addEventListener('click', openSettings);
window.addEventListener('online', checkSetup);
window.addEventListener('offline', checkSetup);

transcript.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const entry = history.find((h) => h.id === card.dataset.id);
  if (!entry) return;
  const reply = e.target.closest('[data-reply]');
  if (reply) {
    unlockSpeech();
    speak(entry.replies[Number(reply.dataset.reply)].ja, 'ja', voiceOpts('ja'));
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'play') {
    unlockSpeech();
    speak(entry.translation, entry.to, voiceOpts(entry.to));
  } else if (act === 'show') {
    showBig(entry);
  } else if (act === 'copy') {
    navigator.clipboard?.writeText(entry.translation);
  } else if (act === 'retry') {
    processUtterance(entry);
  }
});

$('bigClose').addEventListener('click', () => ($('bigView').hidden = true));

// ---- Start ----

renderPhrases();
renderMode();
renderAll();
checkSetup();
if ('requestIdleCallback' in window) requestIdleCallback(warmUp);
else setTimeout(warmUp, 2000);
if (settings.headset) {
  // Media playback needs a user gesture, so wait for the first tap.
  document.addEventListener('click', applyHeadset, { once: true });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
