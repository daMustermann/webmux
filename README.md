# webmux

An OpenAI-compatible HTTP bridge that routes agent traffic to **free web chat
interfaces** instead of paid APIs. Log in once in a real browser; webmux attaches
to that session and exposes DeepSeek, Qwen, GLM and Kimi as ordinary OpenAI
endpoints.

Useful when you want large models without a paid API key, or as a fallback when
a provider is rate-limiting you.

```
┌────────────┐   OpenAI API    ┌───────────┐   DevTools    ┌───────────┐   https
│ your agent │ ─────────────► │  webmux   │   protocol    │ Chromium  │ ────────► provider
└────────────┘   127.0.0.1     └───────────┘                └───────────┘
```

## Providers

| Provider | Site | Persona | Notes |
|---|---|---|---|
| DeepSeek | `chat.deepseek.com` | yes | fast, reliable |
| Qwen | `chat.qwen.ai` | yes | |
| GLM | `chat.z.ai` | yes | slow to answer, 180 s budget |
| Kimi | `www.kimi.ai` | **no** | ships a system prompt that pins its identity |

## Setup

Requires Node 22.12+ and Chromium.

```bash
npm install
npx playwright install chromium   # only if you have no system Chromium
npm run browser                    # starts Chromium on :9223 with its own profile
```

Log in to the providers you want in the browser window that opens. Keep the
window open — closing it drops the bridge's tabs.

```bash
npm start                          # webmux on http://127.0.0.1:3001
```

## Point an agent at it

```bash
curl http://127.0.0.1:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"webmux/deepseek-web","messages":[{"role":"user","content":"hi"}]}'
```

Any client that takes a `base_url` works. In [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw):

```toml
[providers.models.custom.webmux]
kind      = "custom"
uri       = "http://127.0.0.1:3001/v1"
model     = "webmux/deepseek-web"
api_key   = "local"
wire_api  = "chat_completions"
```

```bash
zeroclaw config set agents.main.model_provider custom.webmux
```

## How it works

There is no API to call, so webmux drives the web UI: it finds the tab, types
into the input box, and reads the answer back out of the DOM. Two details
matter more than the rest:

**Waiting is the hard part.** A fixed sleep is wrong in both directions. A fast
provider wastes time on it, and a backgrounded tab renders late — so the sleep
returns the *previous* turn. That is not a cosmetic problem: an agent reading
its own old reply as the user's new question loops forever. webmux instead
snapshots the last answer before sending, polls the DOM, and accepts the result
only once the text has stopped growing for 2.5 s.

**Threads have to be recycled.** Long chats slow the web UI down and eventually
stop rendering new answers. Past a threshold webmux opens a fresh chat. That
also means conversation history does not survive — bring your own.

System prompts are delivered as the opening turn, because a web chat has no
system role.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WEBMUX_PORT` | `3001` | server port |
| `WEBMUX_HOST` | `127.0.0.1` | bind address |
| `WEBMUX_CDP_URL` | `http://127.0.0.1:9223` | browser endpoint |
| `WEBMUX_CDP_PORT` | `9223` | port used by `npm run browser` |
| `WEBMUX_PROFILE` | `~/.config/webmux/profile` | browser profile |
| `CHROME` | autodetected | browser binary |

## Security

- Listens on loopback only. Do not expose it to a network.
- The browser profile holds live session cookies. It is a plain Chromium profile
  directory — protect it like any other browser profile.
- Only the providers you are logged into are reachable.

## Legal

Automating a provider's web UI usually conflicts with that provider's terms of
service, and a long-running automated session can get an account suspended. That
risk is real and it is yours to weigh — the same models are usually available
through a real API at a cost, or through a provider with free tiers that permit
it. Use this on your own accounts, keep it light, and do not use it for anything
you would not do by hand.

## License

MIT
