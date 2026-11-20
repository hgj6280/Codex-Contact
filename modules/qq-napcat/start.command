#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:$HOME/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")"
exec "$HOME/.nvm/versions/node/v24.15.0/bin/node" bootstrap.mjs
