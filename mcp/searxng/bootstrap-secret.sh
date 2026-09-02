#!/bin/sh
set -eu

secret_dir=/var/lib/searxng-secret
secret_file=$secret_dir/secret
original_entrypoint=/usr/local/searxng/entrypoint.sh

fail() {
    printf '%s\n' 'SearXNG secret bootstrap failed: persistent secret storage is unavailable or invalid.' >&2
    exit 1
}

if [ -n "${SEARXNG_SECRET:-}" ]; then
    exec "$original_entrypoint" "$@"
fi

[ -d "$secret_dir" ] || fail
chmod 700 "$secret_dir" || fail
[ "$(stat -c '%a' "$secret_dir")" = 700 ] || fail

lock_dir=$secret_dir/.lock
attempts=0
while ! mkdir "$lock_dir" 2>/dev/null; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 100 ] || fail
    sleep 0.1
done
trap 'rmdir "$lock_dir" 2>/dev/null || :' EXIT HUP INT TERM

if [ -L "$secret_file" ]; then
    fail
fi

if [ -e "$secret_file" ]; then
    [ -f "$secret_file" ] || fail
    secret=$(cat "$secret_file") || fail
    [ "${#secret}" -eq 64 ] || fail
    case "$secret" in
        *[!0123456789abcdef]*) fail ;;
    esac
    chmod 600 "$secret_file" || fail
else
    secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n') || fail
    [ "${#secret}" -eq 64 ] || fail
    temporary_file=$secret_dir/.secret.$$
    (umask 077 && printf '%s' "$secret" > "$temporary_file") || fail
    chmod 600 "$temporary_file" || fail
    mv -n "$temporary_file" "$secret_file" 2>/dev/null || {
        rm -f "$temporary_file"
        fail
    }
fi

rmdir "$lock_dir" || fail
trap - EXIT HUP INT TERM
export SEARXNG_SECRET=$secret
exec "$original_entrypoint" "$@"
