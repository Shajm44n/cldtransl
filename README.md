# Kakehashi (架け橋) – English ⇄ Japanese AI interpreter

A phone app (installable web app / PWA) for live English ⇄ Japanese conversations through your **Bluetooth headset**, powered by Claude.

## Modes

**Translator.** Fast, direct translation. Tap **🇬🇧 I speak** or **🇯🇵 相手 · Partner**, talk, and the translation appears on screen and is read aloud.

**Interpreter.** Translates as a professional interpreter would, then adds:
- 💡 **Nuance**: hidden meaning and cultural signals, such as 「前向きに検討します」 often meaning *no*, keigo and hierarchy cues, and advice when your English would sound too blunt in Japanese.
- **Terms**: short explanations of automotive, AI and cultural terminology (SDV, AUTOSAR, ADAS, ISO 26262, 根回し, 稟議 …).
- **Suggested replies**: when your partner speaks, up to two natural Japanese replies with romaji. Tap one and the phone says it in Japanese.
- **Ask the interpreter**: type a question at any time, for example "How do I politely decline?" or "What does 部長 mean?"

The interpreter knows automotive software, AI, Acsia and Japanese business culture. Add your own people, products and terms under **Settings → Context & glossary**. This also helps fix speech-recognition errors, such as "Acsia" being heard as "Asia".

## Using it with a Bluetooth headset

1. Pair and connect the headset to your phone.
2. Open the app (see *Install* below) and add your Anthropic API key in **Settings** (get one at <https://console.anthropic.com>). The key is stored only on your phone and is sent only to `api.anthropic.com`.
3. The microphone and read-aloud use the phone's current audio route, so with the headset connected you speak into the headset and hear translations in it.
   - **Settings → Microphone → Find microphones** lets you pick the headset mic explicitly, on browsers that support it.
   - **Read aloud → Only partner → English** plays only the English translations in your ear.
   - **Show my Japanese full-screen** puts your translated sentence in large text so your partner can read it. This helps because, with a headset connected, the phone can't also play the Japanese out of its own speaker.
4. **Hands-free**: after each translation the app automatically listens for the other person.
5. **Headset buttons** (experimental): play/pause starts or stops listening, and next track switches speaker.

## Install on your phone

The app must be served over HTTPS:

1. In this GitHub repo: **Settings → Pages → Source: GitHub Actions**.
2. Merge to `main`. The workflow in `.github/workflows/pages.yml` builds and publishes it to `https://<user>.github.io/cldtransl/`.
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
| `public/` | HTML, CSS, PWA manifest, service worker, icons |

**Models**: Claude Opus 5.5 is the default for best quality. Sonnet 5.5 and Haiku 5.5 can be picked in Settings for lower latency and cost.

**Adding languages later**: add an entry to `LANGS` in `src/prompts.js` and `STT_LOCALE` in `src/speech.js`, then adjust the sides in `src/main.js`.
