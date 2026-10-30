#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not found"

if [[ -f auth.caddyfile && $FORCE -eq 0 ]]; then
  USER_NAME="$(awk '{print $1; exit}' auth.caddyfile)"
  PASS="<unchanged>"
  log "auth.caddyfile exists, keeping it"
else
  USER_NAME=nudge
  PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)"
  HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PASS")"
  [[ "$HASH" == \$2* ]] || die "unexpected hash output: $HASH"
  printf '%s %s\n' "$USER_NAME" "$HASH" > auth.caddyfile
  chmod 600 auth.caddyfile
  log "auth.caddyfile written"
fi

if [[ ! -f .env || $FORCE -eq 1 ]]; then
  TZ_VALUE="$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)"
  printf 'HTTP_PORT=8080\nTZ=%s\n' "$TZ_VALUE" > .env
  log ".env written: HTTP_PORT=8080 TZ=$TZ_VALUE"
else
  log ".env exists, keeping it"
fi

mkdir -p data

printf '\nuser: %s\npass: %s\nstart: docker compose up -d --build\n' "$USER_NAME" "$PASS"
