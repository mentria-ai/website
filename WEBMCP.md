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
