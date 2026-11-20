#!/bin/zsh
set -eu
base="${0:A:h}"
node_path="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$HOME/Library/LaunchAgents/local.codexremotecontact.chat-hub.plist")"
exec "$node_path" "$base/rollback-qq-chat-storage.mjs"
