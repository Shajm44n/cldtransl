// Experimental: use the headset's play/pause and next/previous buttons.
// Browsers only deliver media-key events while the page is playing audio, so
// this plays a silent loop and listens for Media Session actions.

let audio = null;

function silentWavUrl(seconds = 5) {
  const rate = 8000;
  const samples = rate * seconds;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128); // 8-bit silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export const headsetSupported = 'mediaSession' in navigator;

// handlers: { toggle(), switchSide() }
export async function enableHeadsetButtons(handlers) {
  if (!headsetSupported) throw new Error('Headset buttons are not supported in this browser.');
  if (!audio) {
    audio = new Audio(silentWavUrl());
    audio.loop = true;
  }
  await audio.play();
  navigator.mediaSession.metadata = new MediaMetadata({ title: 'Kakehashi', artist: 'Press play/pause to talk' });
  const set = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* action not supported */
    }
  };
  // Keep the silent loop running so the next press is delivered too.
  const press = () => {
    audio.play().catch(() => {});
    navigator.mediaSession.playbackState = 'playing';
    handlers.toggle();
  };
  set('play', press);
  set('pause', press);
  set('nexttrack', () => handlers.switchSide());
  set('previoustrack', () => handlers.switchSide());
  navigator.mediaSession.playbackState = 'playing';
}

export function disableHeadsetButtons() {
  audio?.pause();
  if (!headsetSupported) return;
  for (const action of ['play', 'pause', 'nexttrack', 'previoustrack']) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      /* ignore */
    }
  }
}
