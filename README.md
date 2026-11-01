# Kakehashi (架け橋) – English ⇄ Japanese AI interpreter

A phone app (installable web app / PWA) for live English ⇄ Japanese conversations through your **Bluetooth headset**, powered by Claude.

## Modes

**Translator.** Fast, direct translation. Tap **🇬🇧 I speak** or **🇯🇵 相手 · Partner**, talk, and the translation appears on screen and is read aloud.

**Interpreter.** Translates as a professional interpreter would, then adds:
- 💡 **Nuance**: hidden meaning and cultural signals, such as 「前向きに検討します」 often meaning *no*, keigo and hierarchy cues, and advice when your English would sound too blunt in Japanese.
- **Terms**: short explanations of automotive, AI and cultural terminology (SDV, AUTOSAR, ADAS, ISO 26262, 根回し, 稟議 …).
- **Suggested replies**: when your partner speaks, up to two natural Japanese replies with romaji. Tap one and the phone says it in Japanese.
- **Ask the interpreter**: type a question at any time, for example "How do I politely decline?" or "What does 部長 mean?"

**Phrases.** A ready-made Japanese phrasebook for meetings and for pitching **LiLA** (all four flows, on-premise, case-study results). Tap a phrase to have it spoken; long-press to show it full-screen. Works fully offline.

The interpreter knows automotive software, AI, Japanese business culture, and **Acsia's LiLA agentic AI platform** (SpecFlow, SafeFlow, CodeFlow, TestFlow). Add your own people, products and terms under **Settings → Context & glossary**. This also helps fix speech-recognition errors, such as "Acsia" being heard as "Asia".

## Offline mode (no Claude, no internet)

In **Settings → Engine**, *Auto* uses Claude when you're online with an API key and switches to the on-device engine when you're not. If the connection drops mid-conversation, it falls back automatically. *Offline only* never uses the internet.

Tap **Download offline pack** once on Wi-Fi. This downloads several hundred MB, which the phone then keeps:
- **Speech recognition:** Whisper (Base or Small) runs on the phone, using the GPU via WebGPU when available.
- **Translation:** Chrome's built-in on-device translator when the phone has it, otherwise the NLLB-200 model.
- **Culture hints:** offline notes for phrases such as 「検討します」, 「難しい」 and 「持ち帰って」.
- **Phrasebook:** always available.

Offline translation is more literal than Claude, and the full interpreter (deep nuance, suggested replies, "Ask") needs Claude.

## Samsung Galaxy S23 Ultra

- Open the app in **Chrome**, not Samsung Internet. Samsung Internet has no voice input, and the app shows a warning if you open it there (the offline pack also works around this). In Chrome: ⋮ → **Add to Home screen → Install**.
- Allow the microphone when asked. Connect your Galaxy Buds or other headset **before** opening the app.
- For offline use, download the offline pack on Wi-Fi with the GPU option on (the S23 Ultra's GPU supports WebGPU in Chrome).
- Japanese voice: Settings → General management → Text-to-speech → Google speech engine (or Samsung) → install Japanese voice data. Downloading the voice data also makes read-aloud work offline.

## Using it with a Bluetooth headset

1. Pair and connect the headset to your phone.
2. Open the app (see *Install* below). For Claude, add an Anthropic API key in **Settings**. A Claude.ai Pro/Max subscription can't be used by other apps, so sign in to <https://console.anthropic.com/settings/keys> with the same email, add credit and create a key. The key is stored only on your phone and is sent only to `api.anthropic.com`. Offline mode needs no key.
3. The microphone and read-aloud use the phone's current audio route, so with the headset connected you speak into the headset and hear translations in it.
   - **Settings → Microphone → Find microphones** lets you pick the headset mic explicitly, on browsers that support it.
   - **Read aloud → Only partner → English** plays only the English translations in your ear.
   - **Show my Japanese full-screen** puts your translated sentence in large text so your partner can read it. This helps because, with a headset connected, the phone can't also play the Japanese out of its own speaker.
4. **Hands-free**: after each translation the app automatically listens for the other person.
5. **Headset buttons** (experimental): play/pause starts or stops listening, and next track switches speaker.

## Install on your phone

The app must be served over HTTPS:

1. In this GitHub repo: **Settings → Pages → Source: GitHub Actions**.
2. Merge to `main`. The workflow in `.github/workflows/pages.yml` builds and publishes it to **https://shajm44n.github.io/cldtransl/**.
3. On the phone, open that URL:
   - **Android (Chrome)**: menu ⋮ → *Add to Home screen / Install app*.
   - **iPhone (Safari)**: Share → *Add to Home Screen*. Voice input on iOS needs *Siri & Dictation* enabled.

## Develop

```bash
npm install
npm run dev     # http://localhost:8080 (the phone can use your computer's LAN IP, but mic access needs HTTPS or localhost)
npm run build   # outputs dist/
```

| File | Purpose |
|---|---|
| `src/main.js` | UI, conversation flow, settings |
| `src/claude.js` | Claude API calls (translator, interpreter, ask) |
| `src/prompts.js` | System prompts, interpreter output schema |
| `src/speech.js` | Speech recognition and text-to-speech |
| `src/headset.js` | Headset media-button control |
| `src/offline.js`, `src/offline-worker.js` | On-device engine (Whisper, Chrome Translator / NLLB) |
| `src/recorder.js` | Mic capture with silence detection for on-device speech recognition |
| `src/local.js` | Glossary fixes, offline culture hints, phrasebook |
| `public/` | HTML, CSS, PWA manifest, service worker, icons |

**Models**: Claude Opus 5.5 is the default for best quality. Sonnet 5.5 and Haiku 5.5 can be picked in Settings for lower latency and cost.

**Adding languages later**: add an entry to `LANGS` in `src/prompts.js` and `STT_LOCALE` in `src/speech.js`, then adjust the sides in `src/main.js`.
