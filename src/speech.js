// Speech recognition (mic → text) and speech synthesis (text → speaker).
// Both use the phone's current audio route, so a connected Bluetooth headset
// is used automatically for the microphone and for playback.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const recognitionSupported = !!Recognition;
export const synthesisSupported = 'speechSynthesis' in window;

export const STT_LOCALE = { en: 'en-US', ja: 'ja-JP' };

let micStream = null;
let micDeviceId = null;

// Lists microphones. Labels are only available after mic permission is granted.
export async function listMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export async function requestMicPermission() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

// Opens a specific microphone (e.g. the Bluetooth headset) so it can be handed
// to the recogniser on browsers that support start(track).
async function micTrack(deviceId) {
  if (!deviceId || deviceId === 'default') return null;
  if (micStream && micDeviceId === deviceId && micStream.getAudioTracks()[0]?.readyState === 'live') {
    return micStream.getAudioTracks()[0];
  }
  releaseMic();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
  });
  micDeviceId = deviceId;
  return micStream.getAudioTracks()[0];
}

export function releaseMic() {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  micDeviceId = null;
}

// One listening turn. Resolves with the final transcript ('' if nothing heard).
export class Listener {
  constructor() {
    this.rec = null;
  }

  get active() {
    return !!this.rec;
  }

  async listen({ lang, sttLocale, deviceId, onInterim }) {
    if (!Recognition) throw new Error('Speech recognition is not supported in this browser. Use Chrome on Android or Safari on iPhone.');
    this.abort();
    const rec = new Recognition();
    rec.lang = sttLocale || STT_LOCALE[lang];
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    this.rec = rec;

    let track = null;
    try {
      track = await micTrack(deviceId);
    } catch {
      track = null; // Fall back to the system default microphone.
    }

    return new Promise((resolve, reject) => {
      let finalText = '';
      let interimText = '';
      rec.onresult = (e) => {
        interimText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interimText += r[0].transcript;
        }
        onInterim?.((finalText + interimText).trim());
      };
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        this.rec = null;
        const messages = {
          'not-allowed': 'Microphone permission was denied.',
          'service-not-allowed': 'Speech recognition is not allowed here. On iPhone, enable Siri & Dictation.',
          'audio-capture': 'No microphone found. Check that your headset is connected.',
          network: 'Speech recognition needs an internet connection.',
          'language-not-supported': `Speech recognition does not support ${rec.lang} on this device.`,
        };
        reject(new Error(messages[e.error] || `Speech recognition error: ${e.error}`));
      };
      rec.onend = () => {
        if (this.rec === rec) this.rec = null;
        // A manual stop can end the session before the last result is marked final.
        resolve((finalText || interimText).trim());
      };
      try {
        if (track) rec.start(track);
        else rec.start();
      } catch (err) {
        if (track) {
          try {
            rec.start();
            return;
          } catch {
            /* fall through */
          }
        }
        this.rec = null;
        reject(err);
      }
    });
  }

  // Stop listening and keep what was heard.
  stop() {
    this.rec?.stop();
  }

  // Stop listening and discard.
  abort() {
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.onresult = null;
      rec.abort();
    }
  }
}

// ---- Speech synthesis ----

let voices = [];
function loadVoices() {
  voices = synthesisSupported ? speechSynthesis.getVoices() : [];
}
if (synthesisSupported) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function voicesFor(lang) {
  return voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang));
}

function pickVoice(lang, preferredURI, locale) {
  const candidates = voicesFor(lang);
  return (
    candidates.find((v) => v.voiceURI === preferredURI) ||
    candidates.find((v) => v.lang.replace('_', '-').toLowerCase() === (locale || '').toLowerCase()) ||
    candidates.find((v) => v.localService) ||
    candidates[0] ||
    null
  );
}

// iOS only allows speech after a user gesture; call this from a tap handler.
export function unlockSpeech() {
  if (!synthesisSupported || unlockSpeech.done) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
  unlockSpeech.done = true;
}

export function stopSpeaking() {
  if (synthesisSupported) speechSynthesis.cancel();
}

export function speak(text, lang, { rate = 1, voiceURI, locale } = {}) {
  if (!synthesisSupported || !text) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang, voiceURI, locale);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || locale || (lang === 'ja' ? 'ja-JP' : 'en-US');
    u.rate = rate;
    // Chrome sometimes never fires onend; guard with a generous timeout.
    const timer = setTimeout(resolve, 4000 + text.length * 250);
    u.onend = u.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}
