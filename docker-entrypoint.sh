#!/bin/sh
set -eu

secret_file=${DAYFRONT_AUTH_SESSION_SECRET_FILE:-}

case "$secret_file" in
  /data/*)
    secret_directory=${secret_file%/*}
    mkdir -p "$secret_directory"
    chown node:node "$secret_directory"
    if [ -e "$secret_file" ]; then
      chown node:node "$secret_file"
      chmod 600 "$secret_file"
    fi
    ;;
esac

exec su-exec node "$@"
