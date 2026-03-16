# Mentria Full Rebrand — Design Spec

## Overview

Full visual and architectural rebrand of mentria.ai from a generic static blog+tools site into a terminal-aesthetic creative studio brand. Keeps Eleventy 3 + Nunjucks (no framework migration). Restructures CSS into a design system, adds a shared JS module for the interactive CLI and animations, converts the blog feed into a TikTok/Reels-style vertical video scroll, and fixes all 22 identified bugs/issues.

## Identity & Audience

- **Brand identity:** Creative studio — Mentria is a brand, not a person. Polished, opinionated, distinct aesthetic.
- **Target audience:** Mix of casual web users and design-conscious creatives. Accessible enough for anyone, polished enough to impress. No developer jargon on public-facing pages.

## Visual System

### Color Palette

CSS custom properties on `:root`:

| Token | Value | Usage |
|---|---|---|
| `--term-bg` | `#0a0a0a` | Page background |
| `--term-bg-raised` | `#111111` | Cards, panels, terminal frames |
| `--term-border` | `rgba(255,255,255,0.06)` | Dividers, subtle borders |
| `--term-fg` | `#e2e8f0` | Primary text |
| `--term-muted` | `#64748b` | Secondary text, dimmed content |
| `--syn-cyan` | `#22d3ee` | Commands, links, interactive elements |
| `--syn-purple` | `#a78bfa` | Arguments, tags, metadata |
| `--syn-pink` | `#f472b6` | Prompts, brand accents |
| `--syn-green` | `#4ade80` | Success states, online indicators |
| `--syn-amber` | `#fbbf24` | Warnings, dates, highlights |

### Typography

- **Headings + UI:** `'JetBrains Mono', 'Fira Code', 'Courier New', monospace`
- **Body text (long reads):** `'Inter', system-ui, sans-serif`
- **Base size:** `16px` with `clamp()` for fluid scaling
- **Line-height:** `1.6` body, `1.3` headings

### Font Loading

Load JetBrains Mono (400, 700) and Inter (400, 600) via Google Fonts CDN. Use `<link rel="preconnect">` to `fonts.googleapis.com` and `fonts.gstatic.com`, then a single `<link>` tag with both families. Set `font-display: swap` via the Google Fonts `&display=swap` parameter to prevent FOIT.

### Shared UI Elements

- **Terminal window frames:** Title bar with colored dots (red/yellow/green), optional filename display
- **Scanline overlay:** Very subtle, CSS-only, `pointer-events: none` — atmosphere without interference
- **Grid background:** Faint graph-paper lines on `--term-bg`
- **Blinking cursor:** Reusable `.cursor-blink` CSS class (`_` character with step animation)

### Animation Level

Moderate — noticeable but not distracting:
- Typing effects on headings and CLI output
- Scroll-triggered reveals (fade/slide)
- Hover state transitions on cards and links
- Blinking cursor on interactive elements
- All animations respect `prefers-reduced-motion: reduce`:
  - Typing animations → instant render (text appears immediately)
  - Scroll reveals → no transition, elements visible immediately
  - Cursor blink → static `_` character, no animation
  - Scanline overlay → hidden
  - Video autoplay → unchanged (not a CSS animation)

## Interactive CLI Hero

### Behavior

Homepage hero is a terminal emulator. On page load, typing animation renders:

```
$ welcome --to mentria
> creative studio. tools & transmissions.
> type 'help' for commands.
$ _
```

### Commands

| Command | Action |
|---|---|
| `help` | Lists all commands with descriptions |
| `tools` | On homepage: smooth-scrolls to tools preview section. On any other page: navigates to /tools/ |
| `feed` | Navigates to /feed/ |
| `about` | Renders inline: `> mentria — a creative studio for tools, experiments & visual transmissions. est. 2025.` |
| `clear` | Clears terminal output |
| `<unknown>` | `command not found: <input>. type 'help' for available commands.` |

### Implementation

- Shared `src/assets/js/mentria-cli.js` module
- Terminal input is a styled `<input type="text">` (not `contenteditable`) — ensures reliable mobile keyboard triggering, native paste sanitization, and built-in accessibility semantics
- The input is styled to look like a terminal prompt: monospace font, no border, transparent background, cyan caret color, preceded by a `$ ` prompt span
- `aria-label="Command input"` on the input element
- Enter key submits command; input clears after execution
- Command history via up/down arrow keys (stores last 20 commands in-memory array)
- Output styled with syntax palette (commands echo in cyan, results in fg, errors in pink)
- Output area is a `<div role="log" aria-live="polite">` so screen readers announce new output

### Fallback Navigation

- Minimal header: `MENTRIA_` logo (left) + compact text nav (right)
- `Feed` and `Tools` as small monospace text links, always visible — no hidden menu. With only 2 nav items, hiding them behind a `?` icon hurts discoverability for casual users without saving meaningful space
- On mobile, CLI input gets a larger touch target (min 44px height)

## Video Feed (/feed/)

### Layout

The feed page uses a dedicated `feed-layout.njk` layout (extends `base.njk`) that:
- Overrides `<main>` styles: `padding: 0; max-width: none;` to allow full-bleed cards
- Hides the footer entirely (the feed is immersive — no footer interruption)
- Sets the header to `position: fixed; z-index: 100;` so it overlays the first card (semi-transparent background with backdrop-filter blur)

The snap-scroll container is a `<div class="feed-scroll">` wrapping all cards inside `<main>`:
- `overflow-y: scroll; height: 100vh; height: 100dvh;` (`dvh` for mobile Safari address bar, `vh` as fallback)
- `scroll-snap-type: y mandatory;`
- Each card `<section>` gets `scroll-snap-align: start; height: 100vh; height: 100dvh;`
- One card per screen, vertical scroll-snap through all feed entries (finite — renders all items from `feed.json`)

### Card Anatomy

- Video/image fills card (`object-fit: cover`)
- Bottom overlay gradient (transparent → black) for text legibility
- Text overlay (bottom-left): title, caption, date
- Tag pills (top-right): category/tags
- Scroll indicator: subtle down-arrow pulse on first card only

### Data Model

New file `src/_data/feed.json`:

```json
[
  {
    "type": "video",
    "src": "/assets/media/test-001.mp4",
    "poster": "/assets/media/test-001-thumb.jpg",
    "title": "First Transmission",
    "caption": "Testing the feed system.",
    "tags": ["test"],
    "date": "2026-03-16"
  }
]
```

- Entries displayed in reverse chronological order by `date` field. `feed.json` must be maintained in reverse chronological order (newest entry first) — no custom sort filter needed; the template renders entries in array order
- `type`: `video` or `image` for v1. `embed` reserved for future use.
- `src`: local paths or CDN URLs only for v1. YouTube/external embed support is out of scope (requires iframe + YouTube Player API for autoplay control, which is a separate feature). All `src` values render as `<video>` or `<img>` elements.
- `poster`: thumbnail before video playback
- **Empty state:** If `feed.json` is empty or missing, render a single full-height card with terminal-styled message: `$ feed --list` / `> no transmissions yet. check back soon._`

### Video Behavior

- Autoplay when card enters viewport (Intersection Observer API)
- Pause when scrolled out of viewport
- Muted by default (browser autoplay policy), tap-to-unmute toggle
- Loop playback
- Custom minimal controls layout:
  - Tap anywhere on the video card toggles play/pause
  - Mute/unmute button: small icon button fixed at bottom-right of each card
  - Progress bar: display-only thin bar at bottom of card (not seekable) — shows playback position
  - No native browser controls (`controls` attribute omitted)
- Keyboard accessibility for custom controls:
  - Space/Enter on a focused card toggles play/pause
  - Mute button is a `<button>` element (natively focusable and keyboard-operable)
  - Progress bar has `role="progressbar"` with `aria-valuenow` and `aria-valuemax` attributes
  - Each card is focusable via `tabindex="0"` with a visible `:focus-visible` outline

### Test Content

4-5 placeholder cards using solid-color gradient backgrounds (no actual video files) with text overlays demonstrating the scroll snap and overlay system. Each test card uses a `<div>` with a CSS gradient background instead of a `<video>` element — this avoids committing video files to the repo for testing. The data model example showing `test-001.mp4` is illustrative of the production format; test content uses `"type": "image"` with inline CSS backgrounds via a `"color"` field fallback.

### Navigation

- `/feed/` route renders full-screen feed
- CLI `feed` command navigates here
- Back to homepage: tap `MENTRIA_` logo (fixed position, top-left)

## Tool Pages

### Tool Shell Redesign

- Terminal window frame wrapping each tool: title bar with colored dots, tool name as filename (e.g., `countdown-timer.js`)
- Dark card background (`--term-bg-raised`) with faint grid pattern
- Tool-specific accent colors kept but mapped through syntax palette

### Tool Index Page (/tools/)

- Terminal-styled directory listing — tools displayed like `ls -la` output
- Each row: permissions-style category tag, tool name (link), one-line summary
- Note: `tools.json` does not currently have a `date` field — do not display dates in the listing. If date display is desired later, add a `dateAdded` field to `tools.json`
- Hover reveals description expand
- Replace developer-facing copy with user-facing text

### Existing Tool Updates

Both Decision Wheel and Countdown Timer:
- Keep all existing logic intact
- Restyle with terminal aesthetic and design system variables
- Wrap in terminal window frame using the open/close partial pair: `{% include "terminal-frame-open.njk" %}` (accepts `terminalTitle` variable set before include, e.g., `{% set terminalTitle = "countdown-timer.js" %}`) then tool content, then `{% include "terminal-frame-close.njk" %}`
- All CSS variable references in tool scoped styles must be updated from old names (`--bg`, `--fg`, `--muted`, `--accent`, `--border`) to new design system names (`--term-bg`, `--term-fg`, `--term-muted`, `--syn-cyan`, `--term-border`, etc.)
- Fix schema.org markup (remove `SocialNetworking`)

## Bug Fixes (from audit)

### Critical

1. `/tools/` index — the `groupby` filter does not exist in Nunjucks or the Eleventy config. Since the new design uses a flat `ls -la` style listing, remove `groupby` entirely and loop over `tools` array directly
2. "Read post →" / "Launch tool →" spans → real `<a>` links (or make entire cards clickable)
3. Blog post template — add title, date, heading hierarchy rendering
4. Footer copyright year — make dynamic (or update to current year)

### High Priority

5. Replace developer-facing copy on /tools/ and homepage with user-facing content
6. Fix Twitter meta tags: `property=` → `name=`
7. Add custom `:focus-visible` styles (cyan outline matching brand)
8. Fix schema.org: remove `SocialNetworking`, use `WebSite` / `WebApplication` accurately
9. Add skip-to-content link in header

### Medium

10. Eyebrow text size — increase from 12px to at least 14px
11. Make cards fully clickable (stretched link or wrapping anchor)
12. Footer — remove inline styles, use CSS class
13. Thin-content pages — address empty space (content-aware layout)
14. Add global `line-height: 1.6` on body
15. Remove "What makes this stack simple" developer-facing homepage section

### Polish

16. Remove HTMX CDN import (unused)
17. Add `<link rel="canonical">` on all pages
18. Add `<link rel="apple-touch-icon">`
19. Make `og:image` absolute URL: `content="{{ site.siteUrl }}{{ site.socialImage }}"`
20. Add semantic `<time datetime="">` elements
21. Add `aria-label` on brand logo link
22. Clean up orphaned tools in build directory

## CSS Architecture

Restructured from single file to modular system:

| File | Purpose |
|---|---|
| `style.css` | Design system tokens (custom properties), global reset, layout primitives, typography |
| `terminal.css` | Terminal frame, CLI styling, grid pattern, scanline overlay, cursor blink animation |
| Tool `.njk` files | Scoped styles remain per-tool but reference `--term-*` and `--syn-*` variables |

Both CSS files load on every page via `base.njk` (`terminal.css` is small enough that conditional loading adds complexity without meaningful performance benefit). Load order: `style.css` first (tokens), then `terminal.css` (components that reference tokens).

## New File Structure

```
src/
├── assets/
│   ├── css/
│   │   ├── style.css          # Design system + global layout
│   │   └── terminal.css       # Terminal components
│   ├── js/
│   │   └── mentria-cli.js     # Shared CLI module
│   ├── media/                 # Video/image feed content
│   │   ├── test-001.mp4
│   │   ├── test-001-thumb.jpg
│   │   └── ...
│   └── img/                   # Existing icons, logos
├── _data/
│   ├── site.json              # Updated brand metadata
│   ├── tools.json             # Unchanged
│   └── feed.json              # New: video feed entries
├── _includes/
│   ├── base.njk               # Rebuilt: new head, no HTMX, both CSS files
│   ├── feed-layout.njk        # New: extends base, full-bleed layout for feed page
│   ├── header.njk             # Rebuilt: MENTRIA_ logo + compact text nav
│   ├── footer.njk             # Rebuilt: CSS class, dynamic year
│   ├── terminal-frame-open.njk # New: opening terminal window chrome (title bar + open container div)
│   └── terminal-frame-close.njk # New: closing terminal window chrome (close container div)
├── feed/
│   ├── index.njk              # Rebuilt: vertical video scroll feed
│   └── welcome.md             # Kept (renders with proper post template)
├── tools/
│   ├── index.njk              # Rebuilt: ls -la style listing
│   ├── countdown-timer.njk    # Restyled with terminal aesthetic
│   └── decision-wheel.njk    # Restyled with terminal aesthetic
├── index.njk                  # Rebuilt: CLI hero + tools preview
├── 404.njk                    # Rebuilt: terminal error style
├── sw.js                      # Updated cache list
└── manifest.json              # Updated theme colors
```

## Service Worker Updates

- Update `CACHE_NAME` to `mentria-cache-v3`
- Add `/feed/` to cached routes
- Add `mentria-cli.js` and `terminal.css` to cache list
- Update theme colors in cache references

## Implementation Notes

- **Eleventy config format:** The current `.eleventy.js` uses CommonJS (`module.exports`). Eleventy 3 supports both CJS and ESM. Keep CJS — it works and avoids unnecessary migration.
- **Media files:** For v1 test content, no actual video/image files are committed to the repo. When real media content is added later, consider Git LFS or an external CDN to avoid repo bloat (GitHub Pages has a 1GB soft limit).

## Out of Scope

- No new tools (platform-first, catalog later)
- No framework migration (stays Eleventy + vanilla JS)
- No analytics/tracking setup
- No dark/light theme toggle (dark only)
- No RSS feed generation
- No search functionality
- No YouTube/external embed support in feed (future enhancement — requires YouTube Player API)
