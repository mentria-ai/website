# WebMCP on mentria.ai

mentria.ai is a privacy-first toolbox: 34 tools, 8 games and an AI-concept feed
that run entirely in the browser, including a ladder of on-device language
models (0.8B–27B) on WebGPU. This document describes its WebMCP integration.

## What agents can do here

Every page registers tools with `document.modelContext` when the browser
provides it. Two site-wide tools work everywhere:

| tool | kind | what it does |
|---|---|---|
| `site__search` | read-only | search tools, games and feed posts; returns titles + URLs |
| `site__open` | action | navigate the tab to a site path (`/tools/qr-scanner/`) |

Tool pages add their own capabilities:

| page | tools |
|---|---|
| /tools/countdown-timer/ | `timer__start`, `timer__status` (read-only) |
| /tools/quick-notes/ | `notes__create`, `notes__list` (read-only), `notes__count` (read-only) |
| /tools/base64-codec/ | `base64__encode`, `base64__decode` |
| /tools/decision-wheel/ | `wheel__spin` (optionally replaces the options, returns the winner) |
| /tools/color-picker/ | `color__set` (hex in, RGB/HSL out) |
| /tools/qr-scanner/ | `qr__generate` (renders a scannable QR in the tool) |

User-installed **extensions** join the same surface: a single-file HTML
extension that registers a capability on the in-page bus (about 15 lines) is
automatically announced across contexts and exposed to agents — the bundled
Unit Converter and Dice Roller extensions ship with `unit__convert` and
`dice__roll` as working examples. Anyone can author an agent tool without
touching this repo.

Every call operates the real UI — the person watches the agent work in their
tab, and can take over at any point. The same capabilities also power the
site's own on-device agent at /tools/console/, where a 27B model running on
the visitor's GPU drives these tools locally.

## The privacy membrane: local AI as a tool

On WebGPU-capable devices three more tools appear:

| tool | what it does |
|---|---|
| `local_ai__status` | is the on-device model available / downloaded (read-only) |
| `local_ai__ask` | run a prompt on a 0.8B model executing on this device's GPU |
| `notes__summarize_private` | summarize the visitor's saved notes **without exposing them** |

`notes__summarize_private` is the point: the raw note contents are readable
only by an internal capability that is never registered with WebMCP. A cloud
agent calls the tool, the on-device model reads and summarizes the notes
locally, and only the summary crosses back. The agent uses private data it
can never see. On devices without WebGPU these tools simply don't register.

## Measured: a LoRA that teaches "call the tool"

The on-device 27B agent at /tools/console/ ships with a tool-call LoRA
(trained in ~15 minutes on our own pipeline, hot-swappable at runtime — the ◈
button toggles it live). Same task, same session, adapter hot-swapped:

| arm | "Set a 5 minute countdown timer and start it" |
|---|---|
| base 27B | taps the "5 min" preset, taps "Start" — never uses the declared capability |
| + toolcall LoRA | emits `{"do":"call","name":"timer__start","args":{"minutes":5}}` |

On the 150-row held-out suite: composite 0.709 → 0.998, exact tool-name
0.303 → 1.000, argument accuracy 0.242 → 0.990, IFEval unchanged, and it
generalizes to unseen tool schemas (0.353 → 0.971). Adapters:
huggingface.co/mentriaai — `loras/toolcall-console` (27B) and
`loras/toolcall-web` (0.8B).

## Multi-source model delivery

Every model tier ships from three possible sources. The default is **private**:
a single fast stream from our own mirror (measured ~100× faster than the
throttled upstream), chosen by a cache-stable base picker with the official
host as automatic fallback — no peers, no tracker, IP exposure identical to
any normal download. Flip **Peer boost** on /tools/model-mirror/ and downloads
also join a WebRTC swarm: other visitors' mirror tabs serve verified pieces
alongside two HTTP webseeds. Measured: a fresh browser pulled a shard 3.6×
faster with three peers than webseed-only, and a mirror tab served 33 MB of
real blocks while downloading nothing — it seeds any already-downloaded model
**directly from the engine's cache storage** with near-zero memory cost.

Security: torrent files are served same-origin over HTTPS and contain **no
tracker** — the client only announces when the person opted into sharing;
every 4 MB piece is hash-verified before acceptance, and the assembled file
must match a pinned SHA-256 before the engine may touch it — a mismatch
discards the download and falls back to direct HTTPS. With Peer boost on,
peers see each other's IP addresses (disclosed inline, in five languages);
the tracker only ever sees swarm ids, never file contents.

## How it works

`src/assets/js/mentria-bus.js` is the site's capability registry: tool pages
call `provide(name, handler, descriptor)` with a JSON-schema descriptor and an
`ai: true` flag. `src/assets/js/mentria-webmcp.js` bridges that registry to
WebMCP: it feature-detects `document.modelContext`, registers every AI-safe
capability via `registerTool` (mapping our `readonly` flag to
`annotations.readOnlyHint`), and live-syncs tools registered after page load.
Browsers without WebMCP never load the bridge.

## Try it

1. Chrome 149+: enable `chrome://flags/#enable-webmcp-testing` and relaunch
   (or rely on the origin-trial token served by the site).
2. Open https://mentria.ai/tools/decision-wheel/ with a WebMCP-capable agent
   and ask it to "spin the wheel between chai and coffee".
3. Or ask the on-device agent the same thing at https://mentria.ai/tools/console/
   — no cloud involved.

## Challenge provenance

The site predates the WebMCP Challenge; all WebMCP work landed during the
submission window. See commits from 2026-09-01 onward: the bridge
(`mentria-webmcp.js`), the base-page loader, the `readonly`/event additions to
the bus, and the wheel/color/qr/notes capabilities.
