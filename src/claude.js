// Calls to Claude for the translator, interpreter and "ask" features.
import Anthropic from '@anthropic-ai/sdk';
import {
  LANGS,
  translatorSystem,
  interpreterSystem,
  askSystem,
  INTERPRETER_SCHEMA,
  conversationBlock,
} from './prompts.js';

let client = null;
let clientKey = null;

function getClient(apiKey) {
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');
  if (!client || clientKey !== apiKey) {
    // The key is stored only on this device and sent only to api.anthropic.com.
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = apiKey;
  }
  return client;
}

// If a request is declined by a safety classifier, the API retries it on a
// fallback model in the same call. Haiku has no server-side fallback.
function fallbackParams(model) {
  if (model.startsWith('claude-haiku')) return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

function textOf(message) {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

function checkStop(message) {
  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to translate this.');
  }
}

export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use the selected model.';
  if (err instanceof Anthropic.NotFoundError) return 'Model not found. Pick another model in Settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited. Wait a moment and try again.';
  if (err instanceof Anthropic.APIUserAbortError) return 'Cancelled.';
  if (err instanceof Anthropic.APIConnectionError) return 'No connection to Claude. Check your internet.';
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? '?'}): ${err.message}`;
  return err?.message || String(err);
}

function utteranceMessage({ text, from, to, speaker, history }) {
  const who = speaker === 'me' ? 'The user' : 'The partner';
  return `${conversationBlock(history)}${who} just said (${LANGS[from].name}, from speech recognition):
<utterance>${text}</utterance>

Translate it into ${LANGS[to].name}.`;
}

// Direct translator: streams plain text. Effort is low to keep latency short.
export async function translate({ settings, text, from, to, speaker, history, onText, signal }) {
  const stream = getClient(settings.apiKey).beta.messages.stream(
    {
      model: settings.model,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      system: translatorSystem(settings),
      messages: [{ role: 'user', content: utteranceMessage({ text, from, to, speaker, history }) }],
      ...fallbackParams(settings.model),
    },
    { signal },
  );
  let partial = '';
  stream.on('text', (delta) => {
    partial += delta;
    onText?.(partial);
  });
  const message = await stream.finalMessage();
  checkStop(message);
  return textOf(message);
}

// Interpreter: structured output with translation, nuance, terms and replies.
export async function interpret({ settings, text, from, to, speaker, history, signal }) {
  const stream = getClient(settings.apiKey).beta.messages.stream(
    {
      model: settings.model,
      max_tokens: 16000,
      output_config: {
        effort: settings.interpreterEffort || 'medium',
        format: { type: 'json_schema', schema: INTERPRETER_SCHEMA },
      },
      system: interpreterSystem(settings),
      messages: [{ role: 'user', content: utteranceMessage({ text, from, to, speaker, history }) }],
      ...fallbackParams(settings.model),
    },
    { signal },
  );
  const message = await stream.finalMessage();
  checkStop(message);
  if (message.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try a shorter phrase.');
  try {
    return JSON.parse(textOf(message));
  } catch {
    throw new Error('Could not read the interpreter response. Try again.');
  }
}

// Free-form question to the interpreter, streamed.
export async function ask({ settings, question, history, onText, signal }) {
  const stream = getClient(settings.apiKey).beta.messages.stream(
    {
      model: settings.model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: askSystem(settings),
      messages: [{ role: 'user', content: `${conversationBlock(history)}My question: ${question}` }],
      ...fallbackParams(settings.model),
    },
    { signal },
  );
  let partial = '';
  stream.on('text', (delta) => {
    partial += delta;
    onText?.(partial);
  });
  const message = await stream.finalMessage();
  checkStop(message);
  return textOf(message);
}
