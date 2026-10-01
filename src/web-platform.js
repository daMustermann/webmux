/**
 * Shared web-platform engine.
 *
 * Every provider here is a normal web chat, so all of them are driven the same
 * way: find the tab, type into the input, wait for a *new and finished* answer.
 *
 * The hard part is the waiting. A fixed sleep is wrong in both directions: a
 * fast provider wastes time, and a backgrounded tab renders late, so the sleep
 * returns the previous turn and the caller mistakes it for an answer. That
 * produced an infinite loop where the agent's own reply was fed back in as the
 * user's next question. So we poll the DOM, track whether the tail text
 * changed, and only accept it once it has stopped growing.
 */

const ANSWER_SETTLE_MS = 2500;
const POLL_INTERVAL_MS = 1200;
const CDP_URL = process.env.WEBMUX_CDP_URL || 'http://127.0.0.1:9223';

// Text a freshly created answer block shows before any content arrives.
const PLACEHOLDER_RE =
  /^(thinking|denken abgeschlossen|loading|generating|denke|思考中|思考|wait|…|\.\.\.)[\s.。!]*$/i;

function looksLikePlaceholder(text) {
  if (!text) {
    return true;
  }
  const trimmed = text.trim();
  if (PLACEHOLDER_RE.test(trimmed)) {
    return true;
  }
  // A block that only carries a collapsed reasoning header is not an answer.
  return /^thought process\s*$/i.test(trimmed);
}

async function playwright() {
  return require('playwright');
}

async function allPages() {
  const { chromium } = await playwright();
  const browser = await chromium.connectOverCDP(CDP_URL);
  return { browser, pages: browser.contexts().flatMap(c => c.pages()) };
}

async function countAnswers(page, platform) {
  const selector = platform.answerSelectors.join(', ');
  return page.$$eval(selector, nodes => nodes.length).catch(() => 0);
}

async function readLastAnswer(page, platform) {
  const selector = platform.answerSelectors.join(', ');
  const texts = await page
    .$$eval(selector, nodes => nodes.map(n => (n.innerText || n.textContent || '').trim()))
    .catch(() => []);
  if (!texts.length) {
    return null;
  }
  let text = texts[texts.length - 1];
  if (platform.stripLeading) {
    text = text.replace(platform.stripLeading, '').trim();
  }
  return text;
}

async function openChatPage(platform) {
  const { chromium } = await playwright();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto(platform.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Retire this platform's other chat tabs. Left open they keep answering in
  // parallel, and whichever one the selector picks next may be a stale thread.
  for (const old of context.pages()) {
    try {
      const url = old.url();
      if (
        old !== page &&
        url.includes(platform.hostMatch) &&
        !platform.excludeHosts.some(h => url.includes(h))
      ) {
        await old.close();
      }
    } catch (e) {
      // tab already gone
    }
  }
  return page;
}

async function findChatPage(platform) {
  const { pages } = await allPages();
  const candidates = pages.filter(p => {
    try {
      const url = p.url();
      return (
        url.includes(platform.hostMatch) &&
        !platform.excludeHosts.some(h => url.includes(h)) &&
        !url.includes('signin')
      );
    } catch (e) {
      return false;
    }
  });
  if (candidates.length === 0) {
    return null;
  }

  // Skip sibling pages on the same host that have no chat input at all.
  const usable = [];
  for (const page of candidates) {
    const inputs = await page
      .$$eval(platform.inputSelectors.join(', '), nodes => nodes.length)
      .catch(() => 0);
    if (inputs > 0) {
      usable.push(page);
    }
  }
  if (usable.length === 0) {
    return candidates[candidates.length - 1];
  }

  // Prefer the shortest thread. Long chats slow the web UI down and eventually
  // stop rendering new answers, so working in a fresh one is both faster and
  // the only thing that keeps a persona installed.
  let best = usable[usable.length - 1];
  let bestAnswers = Infinity;
  for (const page of usable) {
    const answers = await countAnswers(page, platform);
    if (answers < bestAnswers) {
      bestAnswers = answers;
      best = page;
    }
  }
  return best;
}

async function sendText(page, platform, text) {
  let input = null;
  for (const selector of platform.inputSelectors) {
    try {
      input = await page.waitForSelector(selector, { timeout: 4000 });
      if (input) {
        break;
      }
    } catch (e) {
      continue;
    }
  }
  if (!input) {
    throw new Error(`${platform.label}: Eingabefeld nicht gefunden`);
  }

  await input.fill('');
  await input.fill(text);

  try {
    await input.press('Enter');
    return;
  } catch (e) {
    // fall through to the send button
  }

  for (const selector of platform.sendSelectors || []) {
    try {
      const button = await page.waitForSelector(selector, { timeout: 2500 });
      if (button) {
        await button.click();
        return;
      }
    } catch (e) {
      continue;
    }
  }
  throw new Error(`${platform.label}: Senden fehlgeschlagen`);
}

async function waitForAnswer(page, platform, beforeCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  // Snapshot the last answer *before* the question is sent. The reply may
  // arrive as a new block or as a rewrite of the existing last one, but the
  // tail always differs from this snapshot — whereas counting blocks alone
  // breaks on long chats, where the provider streams into the previous block.
  const before = await readLastAnswer(page, platform);
  let lastText = null;
  let stableSince = 0;

  while (Date.now() < deadline) {
    const count = await countAnswers(page, platform);
    const current = await readLastAnswer(page, platform);
    const grew = count > beforeCount;
    const changed = current && current !== before;

    if ((grew || changed) && current && !looksLikePlaceholder(current)) {
      if (current !== lastText) {
        lastText = current;
        stableSince = Date.now();
      } else if (stableSince && Date.now() - stableSince >= ANSWER_SETTLE_MS) {
        return current;
      }
    } else if (lastText && looksLikePlaceholder(current)) {
      // retracted or regenerated — keep waiting for real text
      stableSince = 0;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  return lastText;
}

async function installPersona(page, platform, systemPrompt) {
  if (!systemPrompt || platform.supportsPersona === false) {
    if (platform.supportsPersona === false) {
      console.log(`🧠 ${platform.label}: Anbieter blockt Identitätswechsel, Persona wird nicht gesetzt`);
    }
    return;
  }
  const existing = await countAnswers(page, platform);
  if (existing >= (platform.maxThreadAnswers || 8)) {
    console.log(`🧠 ${platform.label}: Thread zu lang (${existing}), neuer Chat wird vorbereitet`);
    return;
  }
  const newest = existing > 0 ? await readLastAnswer(page, platform) : null;
  if (existing > 0 && newest && /krabbe/i.test(newest)) {
    return; // persona is already in this thread
  }
  console.log(`🧠 ${platform.label}: Persona wird injiziert (${systemPrompt.length} Zeichen)`);
  await sendText(page, platform, systemPrompt);
  await page.waitForTimeout(6000);
}

/**
 * Run one turn against a web platform and return the assistant's answer.
 */
async function chat(platform, message, systemPrompt = '') {
  const waitMs = platform.answerTimeoutMs || 120000;
  let page = await findChatPage(platform);

  if (systemPrompt && page) {
    const existing = await countAnswers(page, platform);
    if (existing >= (platform.maxThreadAnswers || 8)) {
      console.log(`🧠 ${platform.label}: Thread zu lang (${existing}), neuer Chat`);
      page = await openChatPage(platform);
    }
  }
  if (!page) {
    page = await openChatPage(platform);
  }

  await installPersona(page, platform, systemPrompt);

  const before = await countAnswers(page, platform);
  console.log(
    `💬 ${platform.label}:`,
    message.length > 160 ? `${message.slice(0, 160)}…` : message
  );

  await sendText(page, platform, message);
  console.log('⌛ warte auf Antwort…');

  const answer = await waitForAnswer(page, platform, before, waitMs);
  if (answer) {
    return answer;
  }
  return (
    `Antwort im ${platform.label}-Browserfenster prüfen — ` +
    'die Web-Oberfläche hat nicht innerhalb des Zeitfensters geantwortet.'
  );
}

module.exports = { chat, findChatPage, openChatPage, allPages };
