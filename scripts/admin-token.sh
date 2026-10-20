#!/bin/sh
# Show or reset the admin token through the api container (the file is ${DATA_DIR:-/data}/secrets/admin.token).
#   scripts/admin-token.sh show    print the token (ADMIN_TOKEN when the container sets it, else the file)
#   scripts/admin-token.sh reset   write a fresh random token; the api and ui pick it up on their next request
set -eu
cd "$(dirname "$0")/.."
case "${1:-}" in
  show) docker compose exec -T api sh -c 'if [ -n "$ADMIN_TOKEN" ]; then printf %s "$ADMIN_TOKEN"; else cat "${DATA_DIR:-/data}/secrets/admin.token"; fi; echo' ;;
  reset) docker compose exec -T api sh -c '
    set -e
    [ -z "$ADMIN_TOKEN" ] || { echo "ADMIN_TOKEN is set in the api container; unset it to use the generated token." >&2; exit 1; }
    umask 077
    d="${DATA_DIR:-/data}/secrets"; mkdir -p "$d"
    t=$(head -c32 /dev/urandom | od -An -tx1 | tr -d " \n")
    [ "${#t}" -ge 64 ] || { echo "could not generate a token" >&2; exit 1; }
    printf %s "$t" > "$d/admin.token.new"
    mv "$d/admin.token.new" "$d/admin.token"
    echo "admin token reset"' ;;
  *) echo "usage: $0 show|reset" >&2; exit 2 ;;
esac
