/**
 * Platform descriptors.
 *
 * Each entry describes one provider's web chat: where it lives, how its input
 * box is shaped, and how to recognise a finished answer. Everything else —
 * waiting, streaming detection, thread recycling, persona injection — is shared
 * in web-platform.js.
 *
 * Selectors in this file were measured against the live DOM, not guessed. Web
 * frontends rename their classes regularly, so treat a selector as something to
 * re-verify when a provider starts returning nothing.
 */

const platforms = {
  deepseek: {
    label: 'DeepSeek',
    hostMatch: 'deepseek.com',
    excludeHosts: [],
    url: 'https://chat.deepseek.com/',
    inputSelectors: ['textarea[placeholder*="消息"]', 'textarea'],
    sendSelectors: ['button[type="submit"]', 'button:has-text("发送")'],
    // DeepSeek renamed its answer container to ds-markdown; the older names are
    // kept as fallbacks.
    answerSelectors: ['.ds-markdown', '.ds-assistant-message-main-content', '.ds-message'],
    maxThreadAnswers: 8
  },

  kimi: {
    label: 'Kimi',
    // EU/global frontend on kimi.ai rather than the moonshot.cn build.
    hostMatch: 'kimi.ai',
    excludeHosts: [],
    url: 'https://www.kimi.ai/',
    inputSelectors: ['div[contenteditable="true"]', 'textarea[placeholder]', 'textarea'],
    sendSelectors: ['button[aria-label*="Send" i]', 'button:has-text("Send")'],
    // Kimi renders its reasoning into a sibling markdown-container inside the
    // same segment, so scope to the last .markdown or the chain of thought
    // leaks into the reply.
    answerSelectors: ['.segment-assistant .markdown-container:last-of-type .markdown'],
    maxThreadAnswers: 8,
    // Kimi ships a built-in system prompt that pins the assistant identity and
    // explicitly refuses identity changes, so a persona cannot be installed.
    supportsPersona: false
  },

  qwen: {
    label: 'Qwen',
    hostMatch: 'qwen.ai',
    excludeHosts: [],
    url: 'https://chat.qwen.ai/',
    inputSelectors: ['textarea[placeholder]', 'div[contenteditable="true"]', 'textarea'],
    sendSelectors: ['button[aria-label*="Send" i]', 'button:has-text("Send")'],
    answerSelectors: ['.qwen-markdown', '.custom-qwen-markdown'],
    maxThreadAnswers: 8
  },

  glm: {
    label: 'GLM',
    hostMatch: 'z.ai',
    // autoclaw.z.ai is a separate product on the same host and has no chat box.
    excludeHosts: ['autoclaw.'],
    url: 'https://chat.z.ai/',
    inputSelectors: ['textarea[placeholder]', 'div[contenteditable="true"]', 'textarea'],
    sendSelectors: ['button[aria-label*="Send" i]', 'button:has-text("Send")'],
    // Answers live in .chat-assistant; user turns use .chat-user, so the two
    // must not be mixed up. GLM prefixes a "Thought Process" header that is
    // stripped on read.
    answerSelectors: ['.chat-assistant'],
    stripLeading: /^\s*thought process\s*/i,
    // GLM takes noticeably longer once a persona turn is in the chat.
    answerTimeoutMs: 180000,
    maxThreadAnswers: 8
  }
};

module.exports = { platforms };
