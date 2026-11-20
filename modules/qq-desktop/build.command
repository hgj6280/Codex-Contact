#!/bin/zsh
set -euo pipefail
DESKTOP_MODULE="${0:A:h}"
PROJECT_ROOT="${DESKTOP_MODULE:h:h}"
LAUNCH_ROOT="$PROJECT_ROOT"
if [[ -f "$HOME/Library/Application Support/CodexRemoteContact/service-code/src/server.js" ]]; then
  LAUNCH_ROOT="$HOME/Library/Application Support/CodexRemoteContact/service-code"
fi
TARGET_APP="${1:-$HOME/Applications/狐宫静 QQ.app}"
NODE_BINARY="$(command -v node)"
mkdir -p "$TARGET_APP/Contents/MacOS" "$TARGET_APP/Contents/Resources"
SWIFT_BUILD="$(mktemp -d)"
trap 'rm -rf "$SWIFT_BUILD"' EXIT
cp "$DESKTOP_MODULE/QQFriendDesktop.swift" "$SWIFT_BUILD/main.swift"
xcrun swiftc -O -whole-module-optimization -target arm64-apple-macos14.0 -framework AppKit -framework WebKit -framework AVFoundation \
  "$DESKTOP_MODULE/HubCredential.swift" "$SWIFT_BUILD/main.swift" -o "$TARGET_APP/Contents/MacOS/QQFriendDesktop"
cp "$DESKTOP_MODULE/Info.plist" "$TARGET_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :QQFriendProjectRoot string $LAUNCH_ROOT" "$TARGET_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :QQFriendNode string $NODE_BINARY" "$TARGET_APP/Contents/Info.plist"
cp "$DESKTOP_MODULE/offline.html" "$TARGET_APP/Contents/Resources/offline.html"
cp "$PROJECT_ROOT/scripts/qq-admin-fetch.mjs" "$TARGET_APP/Contents/Resources/"
cp "$PROJECT_ROOT/scripts/qq-desktop-start.mjs" "$TARGET_APP/Contents/Resources/qq-desktop-start.mjs"
cp "$PROJECT_ROOT/scripts/qq-remote-clipboard.mjs" "$TARGET_APP/Contents/Resources/qq-remote-clipboard.mjs"
ICON_WORK="$(mktemp -d /tmp/qq-desktop-icon.XXXXXX)"
xcrun swift "$DESKTOP_MODULE/MakeIcon.swift" "$ICON_WORK/QQFriend.iconset"
iconutil -c icns "$ICON_WORK/QQFriend.iconset" -o "$TARGET_APP/Contents/Resources/QQFriend.icns"
codesign --force --sign - "$TARGET_APP"
codesign --verify --strict "$TARGET_APP"
du -sh "$TARGET_APP"
