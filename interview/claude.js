// AI calls for the Interview tab, through the app's AI layer (llm.js; Settings → AI → Interview picks
// Claude Code CLI, Gemini CLI or Gemini API). The file keeps its old name so callers don't change.
//   ask(prompt, { system, model, engine, timeoutMs }) → the reply text (one-shot)
//   new Conversation({ system, model, engine }) → one long-lived conversation:
//     await conv.send(text, { onText(delta) }) → { text, firstMs, totalMs }; turns run one at a time, in order.
//     conv.close(); conv.closed
// `model` is a session model key: 'sonnet' / 'opus' (Claude) or 'gemini-flash' / 'gemini-pro'.
// No tools, no user settings/hooks/MCP, no saved session: the model only talks.
const llm = require('../llm');

const TIER = { sonnet: 'sonnet', opus: 'opus', haiku: 'haiku', 'gemini-flash': 'sonnet', 'gemini-pro': 'opus', 'gemini-flash-lite': 'haiku' };
const LABEL = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', 'gemini-flash': 'Gemini Flash', 'gemini-pro': 'Gemini Pro', 'gemini-flash-lite': 'Gemini Flash-Lite' };

// The engine for a model key. A session keeps the engine it started on; a Gemini key while Settings say
// Claude (or the reverse) follows the key.
function engineOf(model, engine) {
  const e = engine || llm.engineFor('interview');
  const wantsGemini = String(model || '').startsWith('gemini-');
  if (wantsGemini && !llm.isGemini(e)) return llm.engineStatus('gemini-cli').ok ? 'gemini-cli' : 'gemini-api';
  if (!wantsGemini && model && llm.isGemini(e)) return 'claude';
  return e;
}
// The session model key for a tier on the current interview engine ('opus' → 'gemini-pro' on Gemini).
function modelKey(tier, engine = llm.engineFor('interview')) {
  const t = TIER[tier] || 'sonnet';
  if (!llm.isGemini(engine)) return t;
  return t === 'opus' ? 'gemini-pro' : t === 'haiku' ? 'gemini-flash-lite' : 'gemini-flash';
}

// One-shot jobs (problem prep, debrief) pass a tier ('opus'): they run on the Interview engine in Settings.
function ask(prompt, { system = '', model = null, engine = null, timeoutMs = 6 * 60000 } = {}) {
  const e = engine || (String(model || '').startsWith('gemini-') ? engineOf(model) : llm.engineFor('interview'));
  return llm.ask(prompt, { engine: e, tier: TIER[model] || 'opus', system, timeoutMs });
}

class Conversation {
  constructor({ system, model = null, engine = null, turnTimeoutMs = 120000 }) {
    this.model = model;
    this.chat = new llm.Chat({ engine: engineOf(model, engine), tier: TIER[model] || 'sonnet', system, turnTimeoutMs, name: 'The interviewer' });
    this.engine = this.chat.engine;
  }
  get closed() { return this.chat.closed; }
  // content: a string, or Anthropic content blocks (text + image) for a board snapshot.
  send(content, { onText } = {}) { return this.chat.send(content, { onText }); }
  close() { this.chat.close(); }
}

module.exports = { ask, Conversation, modelKey, engineOf, LABEL };
