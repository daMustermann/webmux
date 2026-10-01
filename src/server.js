/**
 * webmux — OpenAI-compatible server in front of free web chat UIs.
 *
 * Listens on 127.0.0.1 and speaks the subset of the OpenAI API that agent
 * runtimes actually use, so a provider can be pointed at it by base URL:
 *
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions
 *
 * Credentials never leave the machine. You log in once in a real browser and
 * the bridge attaches to that session over the DevTools protocol.
 */

const express = require('express');
const cors = require('cors');

const { platforms } = require('./platforms');
const webPlatform = require('./web-platform');

const PORT = Number(process.env.WEBMUX_PORT || 3001);
const HOST = process.env.WEBMUX_HOST || '127.0.0.1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Model catalogue. Context windows are the published limits, not a measured
// maximum — the real ceiling is whatever the provider's web UI enforces.
const models = [
  { id: 'webmux/deepseek-web', name: 'DeepSeek (Web)', provider: 'deepseek-web', contextWindow: 128000 },
  { id: 'webmux/qwen-web', name: 'Qwen (Web)', provider: 'qwen-web', contextWindow: 128000 },
  { id: 'webmux/glm-web', name: 'GLM (Web)', provider: 'glm-web', contextWindow: 128000 },
  { id: 'webmux/kimi-web', name: 'Kimi (Web)', provider: 'kimi-web', contextWindow: 128000 },
  { id: 'webmux/auto', name: 'Auto', provider: 'auto', contextWindow: 128000 }
];

function resolvePlatformKey(modelId) {
  if (!modelId || modelId === 'webmux/auto') {
    return 'deepseek';
  }
  for (const key of Object.keys(platforms)) {
    if (modelId.includes(key)) {
      return key;
    }
  }
  return 'deepseek';
}

app.get('/health', async (req, res) => {
  const { pages } = await webPlatform.allPages().catch(() => ({ pages: [] }));
  const attached = pages.length > 0;
  const status = Object.fromEntries(
    Object.entries(platforms).map(([key, platform]) => [
      key,
      {
        url: platform.url,
        tabOpen: pages.some(p => p.url().includes(platform.hostMatch))
      }
    ])
  );
  res.json({ status: 'healthy', browserAttached: attached, models: models.length, platforms: status });
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'webmux',
      name: m.name,
      provider: m.provider,
      context_window: m.contextWindow
    }))
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages } = req.body || {};
    const userMessage = (messages || []).filter(m => m.role === 'user').pop();
    if (!userMessage) {
      return res.status(400).json({
        error: { message: 'keine Nutzernachricht in der Anfrage', type: 'invalid_request_error' }
      });
    }

    // Web chats have no system role, so the client prompt is delivered as the
    // opening turn of the conversation instead.
    const systemMessage = (messages || []).filter(m => m.role === 'system').pop();
    const key = resolvePlatformKey(model);
    const platform = platforms[key];

    const answer = await webPlatform.chat(platform, userMessage.content, systemMessage?.content || '');

    // OpenAI clients reject fractional token counts, and the character/4
    // estimate has to be floored.
    const promptTokens = Math.floor(userMessage.content.length / 4);
    const completionTokens = Math.floor(answer.length / 4);

    res.json({
      id: `chatcmpl-${Math.random().toString(36).slice(2, 15)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    });
  } catch (error) {
    console.error('❌ Anfrage fehlgeschlagen:', error.message);
    res.status(500).json({
      error: { message: error.message, type: 'service_error', code: 'webmux_error' }
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`webmux läuft auf http://${HOST}:${PORT}`);
  console.log(`Modelle: ${models.length} · ${Object.values(platforms).map(p => p.label).join(', ')}`);
});

module.exports = { app, resolvePlatformKey };
