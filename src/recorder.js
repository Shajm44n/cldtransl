// Records one utterance from the microphone as 16 kHz mono audio for the
// on-device Whisper model. Stops automatically after a pause in speech.

export class Recorder {
  constructor() {
    this.done = null;
    this.cancelled = false;
  }

  async record({ deviceId, onLevel, silenceMs = 1300, maxMs = 30000, noSpeechMs = 8000 } = {}) {
    const audio = { echoCancellation: true, noiseSuppression: true, channelCount: 1 };
    if (deviceId && deviceId !== 'default') audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    const started = performance.now();
    let heardSpeech = false;
    let lastSpeech = started;
    let noiseFloor = 0.01;

    return new Promise((resolve) => {
      const finish = () => {
        node.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        if (this.cancelled || !heardSpeech) return resolve(null);
        const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        resolve(out);
      };
      this.done = finish;

      node.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        onLevel?.(rms);
        const now = performance.now();
        if (rms > Math.max(0.015, noiseFloor * 3)) {
          heardSpeech = true;
          lastSpeech = now;
        } else if (!heardSpeech) {
          noiseFloor = noiseFloor * 0.9 + rms * 0.1;
        }
        if (
          (heardSpeech && now - lastSpeech > silenceMs) ||
          now - started > maxMs ||
          (!heardSpeech && now - started > noSpeechMs)
        ) {
          this.stop();
        }
      };
      source.connect(node);
      node.connect(ctx.destination);
    });
  }

  // Stop and keep what was recorded.
  stop() {
    const done = this.done;
    this.done = null;
    done?.();
  }

  // Stop and discard.
  abort() {
    this.cancelled = true;
    this.stop();
  }
}
