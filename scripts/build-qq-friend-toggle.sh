#!/bin/zsh
set -euo pipefail
taskSources="$(cd "$(dirname "$0")" && pwd)"
taskBuild="$(mktemp -d /tmp/qq-friend-toggle-build.XXXXXX)"
taskApp="$HOME/Library/Application Support/CodexRemoteContact/QQ群友开关.app"
taskDesktop="$HOME/Desktop/QQ群友开关.app"
osacompile -o "$taskBuild/QQ群友开关.app" "$taskSources/qq-friend-toggle.applescript"
cp "$taskSources/qq-admin-fetch.mjs" "$taskBuild/QQ群友开关.app/Contents/Resources/"
cp "$taskSources/qq-friend-toggle.mjs" "$taskBuild/QQ群友开关.app/Contents/Resources/qq-friend-toggle.mjs"
cp "$taskSources/qq-friend-toggle.Info.plist" "$taskBuild/QQ群友开关.app/Contents/Info.plist"
codesign --force --sign - "$taskBuild/QQ群友开关.app"
ditto --norsrc --noextattr "$taskBuild/QQ群友开关.app" "$taskApp"
codesign --verify --strict "$taskApp"
if [[ ! -e "$taskDesktop" && ! -L "$taskDesktop" ]]; then
  ln -s "$taskApp" "$taskDesktop"
fi
echo "已安装：$taskDesktop"
