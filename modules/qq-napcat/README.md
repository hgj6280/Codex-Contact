# Local QQ bridge

## Native macOS backend (2026-10-15)

This Mac now selects `{"kind":"native"}` in local `state/backend.json`.
`bootstrap.mjs` starts `local.codexremotecontact.qq-native`, never Colima or
Docker. A missing backend file retains the legacy Docker setup on other hosts.
`native-pending` fails closed while migration awaits approval; it never starts
the VM. The desktop start/restore shortcut uses the same backend selection.

The dedicated engine is in local Application Support at
`CodexRemoteContact/native-qq/QQ.app`; the App Store `/Applications/QQ.app`
is unchanged. It is locally signed with App Sandbox enabled and a separate
bundle identity `local.codexremotecontact.qq-engine`. The only Mach IPC sandbox
exception matches that engine's own `MachPortRendezvousServer.<pid>` namespace.
Gatekeeper and SIP remain enabled. Native state and platform-specific login
data are in `~/Library/Containers/local.codexremotecontact.qq-engine/Data/`.
WebUI and OneBot servers bind to `127.0.0.1`, not all interfaces. Credentials and
the bridge access/loop guards are retained. A new QR login is required; Linux
QQ databases are not imported into macOS QQ.

The old Colima VM and container are stopped, not deleted. Migration backup:
`~/Library/Application Support/CodexRemoteContact/native-migration-20261015.jdxk0g/backup/`.
The local `snapshot.py` supports native mode without Docker and captures the
native container Data directory as `native-qq-profile`; restore it to the above
native Data path with the native agent, bridge and hub stopped. Native engine
binaries can be recreated separately; do not overwrite the daily-use QQ.

The following sections describe the retained legacy Docker backend.

NapCat runs Linux QQ inside the existing Colima ARM64 VM. `bridge.mjs` connects
to its authenticated OneBot WebSocket and exposes the HTTP API expected by Hub.
No LLBot Auth Token is used.

## Local endpoints

- `http://127.0.0.1:6099/webui`: NapCat login and administration.
- `http://127.0.0.1:3000/health`: bridge connection status and counters.
- `http://127.0.0.1:3789`: existing Hub console.

The container publishes ports only to loopback. The local WebUI credential is
stored in `state/config/webui.json`; the OneBot credential is in
`state/bridge.json`. Do not commit or share `state/`.

## Access controls

`state/bridge.json` contains `allowedUsers` (private-message senders) and
`allowedGroups`. Both inbound events and outgoing replies are checked against
these lists. Settings are reloaded per request. Group IDs must also be present
in Hub's group whitelist. Groups are disabled initially. The login account and
the person sending commands normally need to be different QQ accounts.

Only the explicitly allowed events are forwarded to Hub, whose configured
Codex CLI generates replies. The bridge ignores self messages, deduplicates
message IDs, reconnects automatically, and does not retry failed message sends.
The initial acceptance test is text messages; images and forwarded messages
require separate live tests. Host-local media paths are not mounted into QQ.

## Service

LaunchAgent: `~/Library/LaunchAgents/local.codexremotecontact.qq-napcat.plist`.
It starts Colima, starts the existing `codex-contact-napcat` container, then
runs the bridge. Logs are in `state/bridge.log` and `state/bridge.err.log`.
The container persists QQ login in `state/qq` and NapCat configuration in
`state/config`.

`init.mjs` creates missing configuration without overwriting existing files.
`compose.yaml` documents the container configuration for installations with
Docker Compose; this Mac uses an equivalent `docker run` because Compose is
not installed. `download-image.mjs` is the fallback downloader for the official
Docker Hub image; it verifies each SHA-256 blob before importing an archive.

## Local storage on this Mac (2026-09-16)

Runtime files are stored outside iCloud in
`~/Library/Application Support/CodexRemoteContact/`. The module `state`,
project `data`, and project `runtime` paths are compatibility symlinks.
Docker binds `napcat-state/config` and `napcat-state/qq` directly from that
local directory. Keep these runtime directories out of cloud sync.

The existing OpenClaw backup script invokes the local `snapshot.py` helper.
It briefly pauses the hub, bridge, and container, clones all runtime files
(including SQLite WAL files), then resumes them before archive creation.
Snapshots provide crash-consistent disk state; restore with services stopped.
