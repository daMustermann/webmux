#!/bin/sh
# Start a Chromium instance for webmux to attach to.
#
# It needs its own profile directory, and it must be a *separate process* from
# your everyday browser: Chromium only allows one instance per binary, so
# opening your normal browser would silently evict the debug instance and the
# bridge would lose its tabs.
set -e

PORT=${WEBMUX_CDP_PORT:-9223}
PROFILE=${WEBMUX_PROFILE:-$HOME/.config/webmux/profile}
CHROME=${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}

if [ -z "$CHROME" ]; then
  echo "Kein Chromium/Chrome gefunden. Setze CHROME=/pfad/zum/browser." >&2
  exit 1
fi

if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "Browser läuft bereits auf Port ${PORT}"
  exit 0
fi

echo "Starte $CHROME mit Profil $PROFILE auf Port $PORT"
setsid "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --remote-allow-origins='*' \
  about:blank >/dev/null 2>&1 &

i=0
while [ $i -lt 30 ]; do
  if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    echo "CDP bereit auf http://127.0.0.1:${PORT}"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "Browser hat den Debug-Port nicht geoeffnet." >&2
exit 1
