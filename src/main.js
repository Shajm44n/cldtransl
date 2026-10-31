import { LANGS } from './prompts.js';
import { translate, interpret, ask, friendlyError } from './claude.js';
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

const DEFAULT_CONTEXT = `My company: Acsia (automotive software). Always keep "Acsia" in Latin letters. Speech recognition may hear it as "Asia" or "Axia".
Lila: (describe what Lila is – a product, project or person – and how it should be written in Japanese)
Topics: automotive software, software-defined vehicles, AI.
People: (add names and titles, e.g. Tanaka-san, 部長 at …)`;

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
let history = load('kakehashi.history', []).filter((h) => !h.pending);
const saveSettings = () => save('kakehashi.settings', settings);
const saveHistory = () => save('kakehashi.history', history.slice(-100));

// side → languages
const SIDES = {
  me: { from: 'en', to: 'ja' },
  partner: { from: 'ja', to: 'en' },
};

const listener = new Listener();
let listeningSide = null;
let currentAbort = null;
let busy = false;

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
  let html = `<div class="who">${from.flag} ${who} · ${from.native} → ${to.native}${h.mode === 'interpreter' ? ' · interpreter' : ''}</div>
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
  document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === settings.mode)));
  document.querySelectorAll('.mode-help').forEach((p) => (p.hidden = p.dataset.for !== settings.mode));
  $('askForm').hidden = settings.mode !== 'interpreter';
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
  if (!settings.apiKey) problems.push('Add your Anthropic API key in <button class="link-btn" data-open-settings>Settings</button>.');
  if (!recognitionSupported) problems.push('Voice input is not available in this browser. Use Chrome on Android or Safari on iPhone; typing still works.');
  if (!synthesisSupported) problems.push('Read-aloud is not available in this browser.');
  showBanner(problems.join('<br>'));
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
  try {
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
  } catch (err) {
    entry.error = friendlyError(err);
  } finally {
    entry.pending = false;
    currentAbort = null;
    busy = false;
    renderCard(entry);
    renderMics();
    saveHistory();
  }

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
    mode: settings.mode,
    speaker: side,
    from,
    to,
    source: text,
    translation: '',
  };
  history.push(entry);
  return entry;
}

async function startListening(side) {
  if (!settings.apiKey) {
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
    text = await listener.listen({
      lang,
      sttLocale: lang === 'en' ? settings.enLocale : STT_LOCALE.ja,
      deviceId: settings.micId,
      onInterim: (t) => setLive(t || 'Listening…'),
    });
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
    listener.stop(); // startListening continues with what was heard.
  } else {
    listeningSide = null;
    listener.abort();
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
  if (!settings.apiKey) return openSettings();
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
  if (!settings.apiKey) return openSettings();
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

renderMode();
renderAll();
checkSetup();
if (settings.headset) {
  // Media playback needs a user gesture, so wait for the first tap.
  document.addEventListener('click', applyHeadset, { once: true });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
