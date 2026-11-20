# SurfCore mechanism review (2026-10-29, expanded adaptation)

Reference reviewed: https://github.com/Mieksido/surfcore at commit
`1ad2042233c960df5bca47a3255ab4e31315ff5e` (package version 0.7.0);
compared with release 0.7.3 at `ddc0d81438958ad071937d19eae2b91576d2a0a3`.
The video page was unavailable; findings are based on the actual repository.

Relevant sources:

- `docs/guides/MEMORY_CARD.md` and `src/memory-card.js`: active, fading memories separated from archival records; protected memories; recall budgets.
- `docs/guides/PURPOSE_OUTREACH.md` and `src/purpose-engine.js`: quiet windows, focus and budget gates before proactive outreach.
- `docs/guides/CONVERSATION_CLOSURE.md`: closing a topic suppresses soft wakeups while explicit human requests can reopen it.

The Mac hub independently implements these mechanisms in its existing native
AppKit/WebKit and SQLite stack. It does not install DSH, SnowLuma, Electron,
a virtual machine or embedding models. The optional MLX voice runtime is isolated and loaded only for an explicitly configured synthesis request. This is not a complete Windows runtime port.

This iteration adds editable Shanghai-time quiet windows, a focus switch shared
by group participation and idle private/group outreach, and a fading-memory
switch with clear/fading/fuzzy/archived states in the memory viewer. Quiet/focus
are rechecked after generation and between outgoing bubbles. Explicit requests
and ongoing direct conversations retain their existing path.

Incidental events fade according to age, importance and independent evidence.
Stable identity, preferences, commitments and explicit/manual memories remain
protected. Fading never deletes the SQLite facts or QQ history; explicit recall
can retrieve archived events within the original conversation/author scope and
labels them as historical information requiring current confirmation. Explicit
forget/correction keeps its original deletion/invalidation semantics.

## Implemented in the expanded iteration

| Feature | Native adaptation | Acceptance boundary |
| --- | --- | --- |
| Persistent memory | Archive original evidence before the 120-turn rolling prune; scoped FTS search; old corrected versions marked obsolete; pins prevent fading | Starts with already-retained bot exchanges/facts, not a retrospective crawl of the complete QQ history |
| Purpose outreach | Source-bound share/curiosity/invite/care/create/follow candidates extracted in the existing diary call; closed/dismissed topics stop | A candidate is not an executed action or an invented experience; existing quotas and per-chat switches still apply |
| Conversation closure | Summary and next opening saved only after a delivery acknowledgement, scoped to author, cleared by /new | Model summaries remain labelled as summaries |
| Desktop presence | Small native window with a standard draggable title bar, OC portrait, text, image previews, shared owner-private context and local system voice | Uses normal macOS keyboard/IME focus; a local Live2D renderer with parameter actions runs on compatible official Core 5.2; voice cloning is configured with a source-labelled project sample and is optional; no microphone |
| Private outreach carrier | Select QQ or desktop; desktop must acknowledge actual display; offline fallback optional | An uncertain desktop result never triggers a duplicate QQ send; groups remain in their own group |
| Public experiences | Read Bilibili title/description and available subtitles; grounded impression/score; share public experiences across QQ and desktop prompts | Reading text is explicitly distinguished from watching frames; no false claim of audiovisual viewing |
| Bilibili login | Official login window in the native App, actual /nav UID verification, local-only protected cookies | Requires the human to log in; no account selected or bound on the human's behalf |
| Public writing | Editable immutable comment/dynamic drafts, account check, explicit publish click, real receipt required, unknown outcomes never auto-retry | Mock transport tested; actual posting remains unverified until account binding and a human-authorized post |
| Browsing routine | Explicit BV queue plus real recommendation discovery, daily cap, quiet/focus/foreground gates, half-hour error backoff, optional draft only | Disabled by default; reuses the existing minute scheduler, never auto-publishes |

## Resource and privacy controls

The memory/purpose changes add no model calls or timers. Explicit desktop chats,
video reflection and draft generation use model calls only when invoked; optional
Bilibili analysis defaults to at most six calls/day. No Bilibili browser is kept
running in the background. The pet page exists only while its panel is open;
heartbeat is eight seconds, active-job polling 1.5 seconds. Its SQLite page cache
is capped at 512 KiB, with indexed bounded reads. Closing the panel releases its
web view. Voice is off by default and uses installed macOS voices.

Pet input can opt out of long-term memory; acknowledgements precede learning.
/new and explicit forgetting prevent old pet context from being reintroduced.
Bilibili prompts receive public materials and persona style, never QQ private
recall. Per-chat AI switches, image response quotas, OC references and direct
image delivery without validation remain unchanged.

## Added 2026-10-30

- Imported the supplied Q-version MOC3, physics and normalized manifest into the durable local web assets. Two copied 4096 textures were reduced to 2048; the source ZIP was preserved. Idle blink/breathing, head nod/shake and happy/shy/angry parameters use existing model IDs. A single 15 FPS ticker drives both animation and rendering and pauses when hidden. Core SDK license was explicitly accepted; official Core 5.2 is installed. Core 5.3 broke the older renderer drawable-order API and was replaced. The actual Q-version model rendered in the native App, with action controls exercised. The settings page links the official terms and installs the official pinned Core only after explicit acceptance.
- Installed an isolated MLX Audio 0.6.3 environment (469 MiB), with official Qwen3 voice weights cached locally (about 1.6 GiB). Reference WAV must be 3–30 seconds, with accurate transcript and owner authorization. Qwen3-TTS 0.6B 4-bit synthesis starts one process per utterance, bounds output/request size, aborts on disable/shutdown and retains at most 20 generated audio files. System voice remains the default. The human authorized the video project's free sample package. Only its 2.55 MB reference archive was downloaded (GitHub asset SHA256 verified), with no Windows runtime. The reference is explicitly labelled age12; system speech remains the default. A harmless greeting was genuinely synthesized through the HTTP API in 15.9 seconds; WAV parsing and nonzero waveform were verified. First synthesis downloads about 1.6 GiB of weights and temporarily uses model memory.
- Added independently switchable Bilibili new-message DM polling and trigger-based live WebSocket interaction. First DM activation creates a baseline and never bulk-replies to history. Account, room and activation epoch bind pending rows. New text DM replies are supported; media DMs are not interpreted. The bounded latest-message-per-session API does not promise a complete DM history crawl. Live events use WBI authentication, bounded compressed frame decoding, heartbeat/reconnect and event-driven reply wakeups. API acceptance is distinct from live feed echo delivery. Unknown sends never retry. Both remain disabled until scope/room is supplied.
- Added real recommendation selection, candidate whitelist validation, existing seen-video deduplication, source-labelled metadata/subtitles and grounded impressions. Discovery is enabled with the existing 20:00–23:00 window and daily two-video limit; focus/quiet and QQ-busy controls are retained. It does not auto-publish comments or dynamics.

## Remaining acceptance inputs

Live2D rendering/actions and one local cloned greeting have now been exercised. The human requested DM/live controls only and explicitly left automatic responses disabled. Actual recipient-visible Bilibili DM/live delivery remains untested and will require the human to enable the respective control and select a room. Unrestricted automatic public posting and actual video-frame watching are not implemented. No claim of subjective consciousness is made.

Current acceptance evidence is recorded separately in the local runtime's
`verification/surfcore-full-adaptation-20261029/` directory. Unit tests alone
are not evidence of a recipient-visible QQ message or an actual Bilibili post.
