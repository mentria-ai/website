# Mentria Full Rebrand Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand mentria.ai from a generic static site into a terminal-aesthetic creative studio with interactive CLI hero, syntax-highlighting color system, and TikTok-style vertical video feed.

**Architecture:** Keep Eleventy 3 + Nunjucks. Restructure CSS into a two-file design system (`style.css` tokens + `terminal.css` components). Add shared `mentria-cli.js` for the interactive terminal. Convert feed from markdown blog to data-driven video scroll. All existing tool logic preserved, restyled.

**Tech Stack:** Eleventy 3, Nunjucks, vanilla JS, CSS custom properties, Google Fonts (JetBrains Mono, Inter)

**Spec:** `docs/superpowers/specs/2026-03-16-mentria-rebrand-design.md`

**Note:** This is a static site with no test runner. Verification is done via `npm run build` (must exit 0) and visual inspection with `npm run start`.

---

## File Map

### Files to Create
| File | Responsibility |
|---|---|
| `src/assets/css/terminal.css` | Terminal frame, CLI, grid pattern, scanline, cursor blink |
| `src/assets/js/mentria-cli.js` | Interactive CLI: command parsing, typing animation, history |
| `src/_includes/feed-layout.njk` | Full-bleed layout for feed page (extends base, no footer, fixed header) |
| `src/_includes/terminal-frame-open.njk` | Opening terminal window chrome (title bar + container div) |
| `src/_includes/terminal-frame-close.njk` | Closing terminal window chrome |
| `src/_includes/post-layout.njk` | Blog post layout (extends base, renders title + date + content) |
| `src/_data/feed.json` | Video feed entries (test data with gradient placeholders) |

### Files to Rewrite
| File | What Changes |
|---|---|
| `src/assets/css/style.css` | Complete rewrite: new design tokens, typography, layout primitives |
| `src/_includes/base.njk` | New head (fonts, both CSS files, no HTMX), fixed meta tags, updated schema.org |
| `src/_includes/header.njk` | MENTRIA_ logo + skip-nav + compact text nav with aria-label |
| `src/_includes/footer.njk` | CSS class instead of inline styles, dynamic year |
| `src/index.njk` | CLI hero + tools preview section (no dev-facing content) |
| `src/feed/index.njk` | Vertical snap-scroll video feed with Intersection Observer |
| `src/tools/index.njk` | Terminal-styled `ls -la` directory listing |
| `src/404.njk` | Terminal error style: `$ 404: page not found_` |
| `src/sw.js` | Updated cache list (v3, new routes + assets) |
| `src/manifest.json` | Updated theme colors to match rebrand |

### Files to Modify
| File | What Changes |
|---|---|
| `src/_data/site.json` | Updated brand metadata (title, descriptions, keywords) |
| `src/tools/decision-wheel.njk` | Restyle with terminal aesthetic, update CSS vars, add terminal frame |
| `src/tools/countdown-timer.njk` | Restyle with terminal aesthetic, update CSS vars, add terminal frame |
| `src/feed/welcome.md` | Update layout to `post-layout.njk` |
| `.eleventy.js` | Add passthrough for `src/assets/js` |

---

## Chunk 1: Design System Foundation

### Task 1: Rewrite style.css with design system tokens

**Files:**
- Rewrite: `src/assets/css/style.css`

- [ ] **Step 1: Write the new style.css**

Replace the entire file with the design system. This is the foundation everything else builds on.

```css
/* ── Design System Tokens ─────────────────────────── */
:root {
  color-scheme: dark;

  /* Terminal palette */
  --term-bg: #0a0a0a;
  --term-bg-raised: #111111;
  --term-border: rgba(255, 255, 255, 0.06);
  --term-fg: #e2e8f0;
  --term-muted: #64748b;

  /* Syntax highlighting palette */
  --syn-cyan: #22d3ee;
  --syn-purple: #a78bfa;
  --syn-pink: #f472b6;
  --syn-green: #4ade80;
  --syn-amber: #fbbf24;

  /* Typography */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  --font-body: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

/* ── Reset ────────────────────────────────────────── */
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.6;
  background: var(--term-bg);
  color: var(--term-fg);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* ── Typography ───────────────────────────────────── */
h1, h2, h3, h4 {
  font-family: var(--font-mono);
  line-height: 1.3;
  margin: 0;
}

h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); }
h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); }
h3 { font-size: 1.15rem; }

a {
  color: var(--syn-cyan);
  text-decoration: none;
  transition: color 0.2s ease;
}
a:hover { color: #67e8f9; }

/* ── Focus ────────────────────────────────────────── */
:focus-visible {
  outline: 2px solid var(--syn-cyan);
  outline-offset: 2px;
}

/* ── Skip Link ────────────────────────────────────── */
.skip-link {
  position: absolute;
  top: -100%;
  left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--syn-cyan);
  color: var(--term-bg);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.85rem;
  z-index: 1000;
  border-radius: 0 0 6px 6px;
}
.skip-link:focus {
  top: 0;
}

/* ── Layout ───────────────────────────────────────── */
main {
  padding: 2.5rem 1.5rem 3rem;
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
}

/* ── Header ───────────────────────────────────────── */
.site-header {
  background: var(--term-bg-raised);
  border-bottom: 1px solid var(--term-border);
}

.site-header__inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  gap: 1rem;
}

.brand {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.05em;
  color: var(--term-fg);
}
.brand .brand__cursor {
  color: var(--syn-cyan);
}

.site-nav {
  display: flex;
  gap: 1.25rem;
}

.nav-link {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--term-muted);
  font-weight: 500;
  padding-bottom: 0.15rem;
  border-bottom: 2px solid transparent;
}

.nav-link:hover {
  color: var(--term-fg);
}

.nav-link.active {
  color: var(--syn-cyan);
  border-color: var(--syn-cyan);
}

/* ── Footer ───────────────────────────────────────── */
.site-footer {
  text-align: center;
  padding: 2rem 1rem;
  background: var(--term-bg-raised);
  color: var(--term-muted);
  border-top: 1px solid var(--term-border);
  margin-top: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

/* ── Section Heading ──────────────────────────────── */
.section-heading {
  margin: 3rem 0 1rem;
  font-size: 1.5rem;
  color: var(--syn-cyan);
}
.section-heading::before {
  content: '> ';
  color: var(--syn-pink);
}

/* ── Eyebrow ──────────────────────────────────────── */
.eyebrow {
  text-transform: uppercase;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  letter-spacing: 0.15em;
  color: var(--term-muted);
  margin-bottom: 0.5rem;
  display: block;
}

/* ── Cards ────────────────────────────────────────── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1.25rem;
  margin-top: 1.5rem;
}

.card {
  position: relative;
  padding: 1.5rem;
  border: 1px solid var(--term-border);
  border-radius: 8px;
  background: var(--term-bg-raised);
  transition: border-color 0.2s ease, transform 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.card:hover {
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

.card h3 { margin: 0; }
.card h3 a { color: var(--term-fg); }
.card h3 a:hover { color: var(--syn-cyan); }

.card p {
  margin: 0;
  color: var(--term-muted);
  line-height: 1.5;
  font-size: 0.9rem;
}

.card .card-link {
  margin-top: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--syn-cyan);
}

/* Stretched link: make entire card clickable */
.card h3 a::after {
  content: '';
  position: absolute;
  inset: 0;
}

/* ── Hero ─────────────────────────────────────────── */
.hero {
  text-align: center;
  padding: 3rem 0 2rem;
}

.hero p {
  color: var(--term-muted);
  margin: 0.75rem auto 0;
  max-width: 640px;
}

/* ── Tool Shell ───────────────────────────────────── */
.tool-shell {
  background: var(--term-bg-raised);
  border: 1px solid var(--term-border);
  border-radius: 8px;
  padding: 1.5rem;
  margin-top: 2rem;
}

/* ── Reduced Motion ───────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0 (the old templates still reference old vars so some visual breakage is expected — that gets fixed in later tasks)

- [ ] **Step 3: Commit**

```bash
git add src/assets/css/style.css
git commit -m "feat: rewrite style.css with terminal design system tokens"
```

---

### Task 2: Create terminal.css

**Files:**
- Create: `src/assets/css/terminal.css`

- [ ] **Step 1: Write terminal.css**

```css
/* ── Grid Background ──────────────────────────────── */
.grid-bg {
  position: relative;
}
.grid-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(
      0deg, transparent, transparent 39px,
      rgba(255, 255, 255, 0.02) 39px, rgba(255, 255, 255, 0.02) 40px
    ),
    repeating-linear-gradient(
      90deg, transparent, transparent 39px,
      rgba(255, 255, 255, 0.02) 39px, rgba(255, 255, 255, 0.02) 40px
    );
  pointer-events: none;
  z-index: 0;
}

/* ── Scanline Overlay ─────────────────────────────── */
.scanlines::after {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );
  pointer-events: none;
  z-index: 9999;
}

@media (prefers-reduced-motion: reduce) {
  .scanlines::after { display: none; }
}

/* ── Cursor Blink ─────────────────────────────────── */
.cursor-blink {
  display: inline-block;
}
.cursor-blink::after {
  content: '_';
  color: var(--syn-cyan);
  animation: blink-cursor 1s steps(1) infinite;
}

@keyframes blink-cursor {
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .cursor-blink::after { animation: none; }
}

/* ── Terminal Frame ───────────────────────────────── */
.terminal-frame {
  background: var(--term-bg-raised);
  border: 1px solid var(--term-border);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 2rem;
}

.terminal-frame__titlebar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid var(--term-border);
}

.terminal-frame__dots {
  display: flex;
  gap: 6px;
}

.terminal-frame__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.terminal-frame__dot--red { background: #ff5f57; }
.terminal-frame__dot--yellow { background: #febc2e; }
.terminal-frame__dot--green { background: #28c840; }

.terminal-frame__filename {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--term-muted);
  margin-left: auto;
}

.terminal-frame__body {
  padding: 1.5rem;
  position: relative;
}

/* ── CLI ──────────────────────────────────────────── */
.cli {
  font-family: var(--font-mono);
  max-width: 680px;
  margin: 0 auto;
  padding: 2rem 0;
}

.cli__output {
  min-height: 120px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  line-height: 1.7;
}

.cli__line {
  margin: 0;
  padding: 0;
}

.cli__line--command { color: var(--syn-cyan); }
.cli__line--result { color: var(--term-fg); }
.cli__line--error { color: var(--syn-pink); }
.cli__line--muted { color: var(--term-muted); }

.cli__prompt-line {
  display: flex;
  align-items: center;
  gap: 0;
}

.cli__prompt {
  color: var(--syn-pink);
  font-size: 0.9rem;
  user-select: none;
  flex-shrink: 0;
}

.cli__input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--term-fg);
  font-family: var(--font-mono);
  font-size: 0.9rem;
  caret-color: var(--syn-cyan);
  outline: none;
  padding: 0.25rem 0;
  min-height: 44px;
}

.cli__input::placeholder {
  color: var(--term-muted);
  opacity: 0.5;
}

/* ── Typing Animation ─────────────────────────────── */
.typing-text {
  display: inline;
  border-right: 2px solid var(--syn-cyan);
  animation: typing-cursor 0.7s steps(1) infinite;
}

@keyframes typing-cursor {
  50% { border-color: transparent; }
}

@media (prefers-reduced-motion: reduce) {
  .typing-text {
    border-right: none;
    animation: none;
  }
}

/* ── Scroll Reveal ────────────────────────────────── */
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}

/* ── Feed Layout ──────────────────────────────────── */
.feed-layout .site-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: rgba(10, 10, 10, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.feed-layout main {
  padding: 0;
  max-width: none;
}

.feed-layout .site-footer {
  display: none;
}

.feed-scroll {
  overflow-y: scroll;
  height: 100vh;
  height: 100dvh;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
}

.feed-card {
  scroll-snap-align: start;
  height: 100vh;
  height: 100dvh;
  position: relative;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.feed-card__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.feed-card__gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.85) 0%,
    rgba(0, 0, 0, 0.3) 40%,
    transparent 70%
  );
  pointer-events: none;
}

.feed-card__color-bg {
  position: absolute;
  inset: 0;
}

.feed-card__info {
  position: relative;
  z-index: 2;
  padding: 2rem 1.5rem;
  width: 100%;
}

.feed-card__title {
  font-family: var(--font-mono);
  font-size: 1.3rem;
  font-weight: 700;
  color: #fff;
  margin: 0 0 0.5rem;
}

.feed-card__caption {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 0.75rem;
  max-width: 400px;
}

.feed-card__date {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--syn-amber);
}

.feed-card__tags {
  position: absolute;
  top: 5rem;
  right: 1.5rem;
  z-index: 2;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.feed-card__tag {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: rgba(167, 139, 250, 0.2);
  color: var(--syn-purple);
  border: 1px solid rgba(167, 139, 250, 0.3);
}

.feed-card__mute-btn {
  position: absolute;
  bottom: 2rem;
  right: 1.5rem;
  z-index: 3;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 1.1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.feed-card__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: var(--syn-cyan);
  transition: width 0.3s linear;
  z-index: 3;
}

.feed-card__scroll-hint {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  color: rgba(255, 255, 255, 0.5);
  font-size: 1.5rem;
  animation: scroll-bounce 2s ease-in-out infinite;
}

@keyframes scroll-bounce {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(8px); }
}

/* Feed empty state */
.feed-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  height: 100dvh;
  font-family: var(--font-mono);
  text-align: center;
  color: var(--term-muted);
}

.feed-empty__command { color: var(--syn-cyan); margin-bottom: 0.5rem; }
.feed-empty__message { color: var(--term-fg); }

/* ── Tools Directory (ls -la style) ───────────────── */
.tools-listing {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  width: 100%;
  margin-top: 2rem;
}

.tools-listing__header {
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: 1.5rem;
  padding: 0.5rem 1rem;
  color: var(--term-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border-bottom: 1px solid var(--term-border);
}

.tools-listing__row {
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: 1.5rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--term-border);
  align-items: center;
  transition: background 0.2s ease;
  position: relative;
}

.tools-listing__row:hover {
  background: rgba(255, 255, 255, 0.02);
}

.tools-listing__category {
  color: var(--syn-purple);
  font-size: 0.8rem;
}

.tools-listing__name a {
  color: var(--syn-cyan);
  font-weight: 600;
}

/* Stretched link for full-row click */
.tools-listing__name a::after {
  content: '';
  position: absolute;
  inset: 0;
}

.tools-listing__summary {
  color: var(--term-muted);
  font-size: 0.8rem;
  text-align: right;
}

@media (max-width: 600px) {
  .tools-listing__header { display: none; }
  .tools-listing__row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
  .tools-listing__summary { text-align: left; }
}
```

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0 (file created but not yet linked in base.njk)

- [ ] **Step 3: Commit**

```bash
git add src/assets/css/terminal.css
git commit -m "feat: add terminal.css with CLI, frames, feed, and tools listing styles"
```

---

### Task 3: Update site.json metadata

**Files:**
- Modify: `src/_data/site.json`

- [ ] **Step 1: Update site.json**

Replace the entire contents with brand-aligned metadata:

```json
{
  "title": "Mentria",
  "tagline": "creative studio. tools & transmissions.",
  "description": "A creative studio for tools, experiments, and visual transmissions.",
  "author": "Mentria",
  "baseUrl": "/",
  "siteUrl": "https://mentria.ai",
  "metaTitle": "Mentria — Creative Studio",
  "metaDescription": "A creative studio for tools, experiments, and visual transmissions. Built with craft.",
  "keywords": "creative studio, web tools, experiments, mentria",
  "revisitAfter": "7 days",
  "socialImage": "/assets/img/mentria-ai.gif",
  "robots": "index, follow",
  "language": "en"
}
```

- [ ] **Step 2: Commit**

```bash
git add src/_data/site.json
git commit -m "feat: update site.json with studio brand metadata"
```

---

### Task 4: Update manifest.json

**Files:**
- Modify: `src/manifest.json`

- [ ] **Step 1: Update manifest.json**

```json
{
  "name": "Mentria",
  "short_name": "Mentria",
  "description": "A creative studio for tools, experiments, and visual transmissions.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/assets/img/favicon-96x96.png", "sizes": "96x96", "type": "image/png" },
    { "src": "/assets/img/icon-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/img/icon-512x512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/assets/img/icon-maskable-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/assets/img/icon-maskable-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/manifest.json
git commit -m "feat: update manifest.json theme colors"
```

---

### Task 5: Update .eleventy.js for new asset paths

**Files:**
- Modify: `.eleventy.js`

- [ ] **Step 1: Add passthrough for js directory**

Add this line after the existing `addPassthroughCopy("src/assets")` line (line 29):

The existing `addPassthroughCopy("src/assets")` already covers `src/assets/js/` and `src/assets/css/terminal.css` since it copies the entire `src/assets` tree. No change needed here.

However, verify the existing passthrough is sufficient by checking the build output includes the new files in a later task.

- [ ] **Step 2: Commit** (skip if no changes needed)

---

## Chunk 2: Layouts & Navigation

### Task 6: Rebuild base.njk

**Files:**
- Rewrite: `src/_includes/base.njk`

- [ ] **Step 1: Write the new base.njk**

```html
<!DOCTYPE html>
<html lang="{{ site.language | default('en') | lower }}"{% if feedLayout %} class="feed-layout"{% endif %}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    {% set baseUrl = site.siteUrl | default('/') %}
    {% set pageUrl = baseUrl ~ page.url %}
    {% set defaultTitle = site.metaTitle | default(site.title) %}
    {% set metaTitle = (title and (title ~ " | " ~ site.title)) or defaultTitle %}
    {% set metaDescription = description | default(site.metaDescription) | default(site.description) %}
    {% set socialImage = site.siteUrl ~ (site.socialImage | default('/assets/img/icon-512x512.png')) %}
    <title>{{ metaTitle }}</title>
    <meta name="description" content="{{ metaDescription }}">
    <meta name="keywords" content="{{ site.keywords }}">
    <meta name="robots" content="{{ site.robots | default('index, follow') }}">
    <meta name="author" content="{{ site.author }}">
    <meta name="theme-color" content="#0a0a0a">

    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="{{ pageUrl }}">
    <meta property="og:title" content="{{ metaTitle }}">
    <meta property="og:description" content="{{ metaDescription }}">
    <meta property="og:image" content="{{ socialImage }}">

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="{{ pageUrl }}">
    <meta name="twitter:title" content="{{ metaTitle }}">
    <meta name="twitter:description" content="{{ metaDescription }}">
    <meta name="twitter:image" content="{{ socialImage }}">

    <!-- Canonical -->
    <link rel="canonical" href="{{ pageUrl }}">
    <link rel="icon" href="/assets/img/favicon-96x96.png" type="image/png">
    <link rel="apple-touch-icon" href="/assets/img/icon-192x192.png">
    <link rel="alternate" hreflang="x-default" href="{{ site.siteUrl }}">
    <link rel="alternate" hreflang="en" href="{{ site.siteUrl }}">

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">

    <!-- Styles -->
    <link rel="stylesheet" href="/assets/css/style.css">
    <link rel="stylesheet" href="/assets/css/terminal.css">
    <link rel="manifest" href="/manifest.json">

    <!-- Schema.org -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "{{ site.title }}",
      "description": "{{ metaDescription }}",
      "url": "{{ site.siteUrl }}"
    }
    </script>
</head>
<body class="scanlines">
    {% include "header.njk" %}

    <main id="main-content">
        {{ content | safe }}
    </main>

    {% if not feedLayout %}
    {% include "footer.njk" %}
    {% endif %}

    <script>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
      }
    </script>
</body>
</html>
```

Key changes from the old version:
- Twitter meta tags: `property=` → `name=`
- `og:image` uses absolute URL (`socialImage` now prepends `site.siteUrl`)
- Added `<link rel="canonical">`
- Added `<link rel="apple-touch-icon">`
- Removed HTMX CDN import
- Added Google Fonts preconnect + stylesheet
- Added `terminal.css` link
- Schema.org: `WebApplication` + `SocialNetworking` → `WebSite`
- Added `id="main-content"` to `<main>` for skip-link
- Added `class="scanlines"` on body
- Added `feedLayout` conditional for hiding footer and adding feed class

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/_includes/base.njk
git commit -m "feat: rebuild base.njk with fonts, fixed meta tags, no HTMX"
```

---

### Task 7: Rebuild header.njk

**Files:**
- Rewrite: `src/_includes/header.njk`

- [ ] **Step 1: Write the new header.njk**

```html
<a class="skip-link" href="#main-content">Skip to content</a>
<header class="site-header">
    <div class="site-header__inner">
        <a class="brand" href="/" aria-label="Mentria home">MENTRIA<span class="brand__cursor">_</span></a>
        <nav class="site-nav">
            <a href="/feed/" class="nav-link{% if page.url | startsWith('/feed/') %} active{% endif %}">Feed</a>
            <a href="/tools/" class="nav-link{% if page.url | startsWith('/tools/') %} active{% endif %}">Tools</a>
        </nav>
    </div>
</header>
```

- [ ] **Step 2: Commit**

```bash
git add src/_includes/header.njk
git commit -m "feat: rebuild header with MENTRIA_ brand, skip-link, aria-label"
```

---

### Task 8: Rebuild footer.njk

**Files:**
- Rewrite: `src/_includes/footer.njk`

- [ ] **Step 1: Add year filter to .eleventy.js**

Add this line after the existing `date` filter (after line 26 in `.eleventy.js`):

```javascript
  eleventyConfig.addFilter("year", function() {
    return new Date().getFullYear();
  });
```

- [ ] **Step 2: Write the new footer.njk**

```html
<footer class="site-footer">
    <p>&copy; {{ "" | year }} Mentria. All rights reserved.</p>
</footer>
```

The `year` filter ignores its input and returns the current year. The empty string is just a Nunjucks requirement for calling a filter.

- [ ] **Step 3: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0, footer shows current year

- [ ] **Step 4: Commit**

```bash
git add src/_includes/footer.njk .eleventy.js
git commit -m "feat: rebuild footer with CSS class and dynamic year"
```

---

### Task 9: Create feed-layout.njk

**Files:**
- Create: `src/_includes/feed-layout.njk`

- [ ] **Step 1: Write feed-layout.njk**

This layout wraps content in `base.njk` but sets a flag to trigger feed-specific behavior (fixed header, no footer, full-bleed).

```html
---
layout: base.njk
feedLayout: true
---
{{ content | safe }}
```

- [ ] **Step 2: Commit**

```bash
git add src/_includes/feed-layout.njk
git commit -m "feat: add feed-layout.njk for full-bleed feed pages"
```

---

### Task 10: Create terminal frame partials

**Files:**
- Create: `src/_includes/terminal-frame-open.njk`
- Create: `src/_includes/terminal-frame-close.njk`

- [ ] **Step 1: Write terminal-frame-open.njk**

```html
<div class="terminal-frame">
    <div class="terminal-frame__titlebar">
        <div class="terminal-frame__dots">
            <span class="terminal-frame__dot terminal-frame__dot--red"></span>
            <span class="terminal-frame__dot terminal-frame__dot--yellow"></span>
            <span class="terminal-frame__dot terminal-frame__dot--green"></span>
        </div>
        {% if terminalTitle %}
        <span class="terminal-frame__filename">{{ terminalTitle }}</span>
        {% endif %}
    </div>
    <div class="terminal-frame__body">
```

- [ ] **Step 2: Write terminal-frame-close.njk**

```html
    </div>
</div>
```

- [ ] **Step 3: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0

- [ ] **Step 4: Commit**

```bash
git add src/_includes/terminal-frame-open.njk src/_includes/terminal-frame-close.njk
git commit -m "feat: add terminal frame open/close partials"
```

---

### Task 10b: Create post-layout.njk and update welcome.md

**Files:**
- Create: `src/_includes/post-layout.njk`
- Modify: `src/feed/welcome.md`

This fixes spec bug #3: blog posts currently render without a visible title or date in the page body.

- [ ] **Step 1: Write post-layout.njk**

```html
---
layout: base.njk
---
<article style="max-width: 700px; margin: 0 auto;">
    <header class="hero" style="padding-top: 1rem; text-align: left;">
        <p class="eyebrow">~/feed</p>
        <h1>{{ title }}</h1>
        {% if date %}
        <time datetime="{{ date | date }}" style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--syn-amber);">{{ date | date }}</time>
        {% endif %}
    </header>
    <div style="margin-top: 2rem; line-height: 1.8; color: var(--term-fg);">
        {{ content | safe }}
    </div>
</article>
```

- [ ] **Step 2: Update welcome.md frontmatter**

Change line 2 of `src/feed/welcome.md` from:

```
layout: base.njk
```

to:

```
layout: post-layout.njk
```

- [ ] **Step 3: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0, `/feed/rebooting-mentria/` shows title "Rebooting Mentria" and date

- [ ] **Step 4: Commit**

```bash
git add src/_includes/post-layout.njk src/feed/welcome.md
git commit -m "feat: add post layout with title/date rendering, fix blog post display"
```

---

## Chunk 3: Interactive CLI & Homepage

### Task 11: Create mentria-cli.js

**Files:**
- Create: `src/assets/js/mentria-cli.js`

- [ ] **Step 1: Write mentria-cli.js**

```javascript
/**
 * Mentria CLI — Interactive terminal hero
 * Handles command parsing, typing animation, and command history.
 */
(function () {
  'use strict';

  const COMMANDS = {
    help: {
      description: 'list available commands',
      run: function () {
        var lines = ['Available commands:', ''];
        var keys = Object.keys(COMMANDS);
        for (var i = 0; i < keys.length; i++) {
          lines.push('  ' + keys[i].padEnd(10) + ' — ' + COMMANDS[keys[i]].description);
        }
        return { lines: lines, type: 'result' };
      }
    },
    tools: {
      description: 'browse utility tools',
      run: function () {
        var toolsSection = document.getElementById('tools-preview');
        if (toolsSection) {
          toolsSection.scrollIntoView({ behavior: 'smooth' });
          return { lines: ['> scrolling to tools...'], type: 'result' };
        }
        window.location.href = '/tools/';
        return { lines: ['> navigating to /tools/...'], type: 'result' };
      }
    },
    feed: {
      description: 'view the feed',
      run: function () {
        window.location.href = '/feed/';
        return { lines: ['> navigating to /feed/...'], type: 'result' };
      }
    },
    about: {
      description: 'about mentria',
      run: function () {
        return {
          lines: ['> mentria — a creative studio for tools, experiments & visual transmissions. est. 2025.'],
          type: 'result'
        };
      }
    },
    clear: {
      description: 'clear the terminal',
      run: function () {
        return { lines: [], type: 'clear' };
      }
    }
  };

  var MAX_HISTORY = 20;
  var history = [];
  var historyIndex = -1;

  function initCLI(containerEl) {
    if (!containerEl) return;

    var outputEl = containerEl.querySelector('.cli__output');
    var inputEl = containerEl.querySelector('.cli__input');
    if (!outputEl || !inputEl) return;

    // Typing animation for welcome message
    var welcomeLines = [
      { text: '$ welcome --to mentria', type: 'command' },
      { text: '> creative studio. tools & transmissions.', type: 'result' },
      { text: "> type 'help' for commands.", type: 'muted' }
    ];

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      // Instant render
      for (var i = 0; i < welcomeLines.length; i++) {
        appendLine(outputEl, welcomeLines[i].text, welcomeLines[i].type);
      }
      inputEl.focus();
    } else {
      typeLines(outputEl, welcomeLines, 0, function () {
        inputEl.focus();
      });
    }

    // Input handling
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var cmd = inputEl.value.trim().toLowerCase();
        inputEl.value = '';
        if (!cmd) return;

        // Add to history
        history.unshift(cmd);
        if (history.length > MAX_HISTORY) history.pop();
        historyIndex = -1;

        // Echo command
        appendLine(outputEl, '$ ' + cmd, 'command');

        // Execute
        if (COMMANDS[cmd]) {
          var result = COMMANDS[cmd].run();
          if (result.type === 'clear') {
            outputEl.innerHTML = '';
          } else {
            for (var i = 0; i < result.lines.length; i++) {
              appendLine(outputEl, result.lines[i], result.type);
            }
          }
        } else {
          appendLine(outputEl, 'command not found: ' + cmd + ". type 'help' for available commands.", 'error');
        }

        // Scroll output into view
        outputEl.scrollTop = outputEl.scrollHeight;
      }

      // History navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
          historyIndex++;
          inputEl.value = history[historyIndex];
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
          historyIndex--;
          inputEl.value = history[historyIndex];
        } else {
          historyIndex = -1;
          inputEl.value = '';
        }
      }
    });

    // Click anywhere in CLI area to focus input
    containerEl.addEventListener('click', function () {
      inputEl.focus();
    });
  }

  function appendLine(outputEl, text, type) {
    var p = document.createElement('p');
    p.className = 'cli__line cli__line--' + (type || 'result');
    p.textContent = text;
    outputEl.appendChild(p);
  }

  function typeLines(outputEl, lines, index, callback) {
    if (index >= lines.length) {
      if (callback) callback();
      return;
    }

    var line = lines[index];
    var p = document.createElement('p');
    p.className = 'cli__line cli__line--' + (line.type || 'result');
    outputEl.appendChild(p);

    typeText(p, line.text, 0, function () {
      setTimeout(function () {
        typeLines(outputEl, lines, index + 1, callback);
      }, 200);
    });
  }

  function typeText(el, text, charIndex, callback) {
    if (charIndex >= text.length) {
      if (callback) callback();
      return;
    }
    el.textContent = text.substring(0, charIndex + 1);
    setTimeout(function () {
      typeText(el, text, charIndex + 1, callback);
    }, 30);
  }

  // Scroll reveal observer
  function initReveal() {
    var elements = document.querySelectorAll('.reveal');
    if (!elements.length) return;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      for (var i = 0; i < elements.length; i++) {
        elements[i].classList.add('revealed');
      }
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('revealed');
          observer.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.1 });

    for (var i = 0; i < elements.length; i++) {
      observer.observe(elements[i]);
    }
  }

  // Auto-init
  document.addEventListener('DOMContentLoaded', function () {
    var cli = document.querySelector('.cli');
    if (cli) initCLI(cli);
    initReveal();
  });
})();
```

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0, `build/assets/js/mentria-cli.js` exists

- [ ] **Step 3: Commit**

```bash
git add src/assets/js/mentria-cli.js
git commit -m "feat: add mentria-cli.js with commands, typing animation, history"
```

---

### Task 12: Rebuild index.njk (homepage)

**Files:**
- Rewrite: `src/index.njk`

- [ ] **Step 1: Write the new index.njk**

```html
---
layout: base.njk
title: Home
eleventyComputed:
  description: "{{ site.description }}"
---
<section class="cli grid-bg">
    <div class="cli__output" role="log" aria-live="polite"></div>
    <div class="cli__prompt-line">
        <span class="cli__prompt">$&nbsp;</span>
        <input type="text" class="cli__input" aria-label="Command input" placeholder="type a command..." autocomplete="off" spellcheck="false">
    </div>
</section>

<section id="tools-preview" class="reveal">
    <h2 class="section-heading">Tools</h2>
    {% set toolCards = tools | default([]) %}
    {% if toolCards.length %}
    <div class="card-grid">
        {% for tool in toolCards %}
        <article class="card">
            <p class="eyebrow">{{ tool.category }}</p>
            <h3><a href="/tools/{{ tool.slug }}/">{{ tool.title }}</a></h3>
            <p>{{ tool.summary }}</p>
            <span class="card-link">Launch tool →</span>
        </article>
        {% endfor %}
    </div>
    {% endif %}
</section>

<script src="/assets/js/mentria-cli.js"></script>
```

Key changes:
- Removed old hero with dev-facing copy
- Removed "Latest feed entries" section (feed is now a separate full-page experience)
- Removed "What makes this stack simple" dev-facing section
- Added CLI terminal as hero
- Tools section uses `reveal` class for scroll animation
- Cards use stretched link pattern (from style.css) — the `<span>` is decorative, the `<a>` in `h3` covers the whole card
- CLI script loaded at end of page

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0

- [ ] **Step 3: Start dev server and visually verify**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run start`
Check: http://localhost:8080 — CLI hero should render with typing animation, tools cards below

- [ ] **Step 4: Commit**

```bash
git add src/index.njk
git commit -m "feat: rebuild homepage with CLI hero and tools preview"
```

---

## Chunk 4: Feed System

### Task 13: Create feed.json test data

**Files:**
- Create: `src/_data/feed.json`

- [ ] **Step 1: Write feed.json with test entries**

```json
[
  {
    "type": "image",
    "color": "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    "title": "Welcome to Mentria",
    "caption": "A creative studio for tools and transmissions.",
    "tags": ["announcement"],
    "date": "2026-03-16"
  },
  {
    "type": "image",
    "color": "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    "title": "Tools, Reimagined",
    "caption": "Simple utilities designed with craft and care.",
    "tags": ["tools", "design"],
    "date": "2026-03-15"
  },
  {
    "type": "image",
    "color": "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
    "title": "The Terminal Aesthetic",
    "caption": "When code meets design. A visual language for the curious.",
    "tags": ["design"],
    "date": "2026-03-14"
  },
  {
    "type": "image",
    "color": "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
    "title": "Building in Public",
    "caption": "Every experiment starts somewhere. This is ours.",
    "tags": ["studio"],
    "date": "2026-03-13"
  },
  {
    "type": "image",
    "color": "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
    "title": "Stay Tuned",
    "caption": "More transmissions incoming. Follow the signal.",
    "tags": ["update"],
    "date": "2026-03-12"
  }
]
```

- [ ] **Step 2: Commit**

```bash
git add src/_data/feed.json
git commit -m "feat: add feed.json with test placeholder entries"
```

---

### Task 14: Rebuild feed/index.njk

**Files:**
- Rewrite: `src/feed/index.njk`

- [ ] **Step 1: Write the new feed/index.njk**

```html
---
layout: feed-layout.njk
title: Feed
description: Visual transmissions from the Mentria studio.
---
{% set entries = feed | default([]) %}
{% if entries.length %}
<div class="feed-scroll" id="feed-scroll">
    {% for item in entries %}
    <section class="feed-card" tabindex="0" data-index="{{ loop.index0 }}">
        {% if item.type == "video" and item.src %}
        <video class="feed-card__media" src="{{ item.src }}" {% if item.poster %}poster="{{ item.poster }}"{% endif %} muted loop playsinline preload="metadata"></video>
        {% elif item.type == "image" and item.src %}
        <img class="feed-card__media" src="{{ item.src }}" alt="{{ item.title }}" loading="lazy">
        {% elif item.color %}
        <div class="feed-card__color-bg" style="background: {{ item.color }};"></div>
        {% endif %}

        <div class="feed-card__gradient"></div>

        {% if item.tags %}
        <div class="feed-card__tags">
            {% for tag in item.tags %}
            <span class="feed-card__tag">{{ tag }}</span>
            {% endfor %}
        </div>
        {% endif %}

        <div class="feed-card__info">
            <h2 class="feed-card__title">{{ item.title }}</h2>
            {% if item.caption %}
            <p class="feed-card__caption">{{ item.caption }}</p>
            {% endif %}
            {% if item.date %}
            <time class="feed-card__date" datetime="{{ item.date }}">{{ item.date | date }}</time>
            {% endif %}
        </div>

        {% if item.type == "video" and item.src %}
        <button class="feed-card__mute-btn" aria-label="Toggle mute">🔇</button>
        <div class="feed-card__progress" role="progressbar" aria-valuenow="0" aria-valuemax="100" style="width: 0%;"></div>
        {% endif %}

        {% if loop.first %}
        <div class="feed-card__scroll-hint" aria-hidden="true">↓</div>
        {% endif %}
    </section>
    {% endfor %}
</div>
{% else %}
<div class="feed-empty">
    <p class="feed-empty__command">$ feed --list</p>
    <p class="feed-empty__message">> no transmissions yet. check back soon.<span class="cursor-blink"></span></p>
</div>
{% endif %}

<script>
(function () {
  'use strict';

  var feedScroll = document.getElementById('feed-scroll');
  if (!feedScroll) return;

  var cards = feedScroll.querySelectorAll('.feed-card');
  if (!cards.length) return;

  // Video autoplay/pause with Intersection Observer
  var videos = feedScroll.querySelectorAll('video');
  if (videos.length) {
    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var video = entries[i].target;
        if (entries[i].isIntersecting) {
          video.play().catch(function () {});
        } else {
          video.pause();
        }
      }
    }, { threshold: 0.5 });

    for (var i = 0; i < videos.length; i++) {
      observer.observe(videos[i]);
    }
  }

  // Mute toggle
  feedScroll.addEventListener('click', function (e) {
    var muteBtn = e.target.closest('.feed-card__mute-btn');
    if (muteBtn) {
      var card = muteBtn.closest('.feed-card');
      var video = card ? card.querySelector('video') : null;
      if (video) {
        video.muted = !video.muted;
        muteBtn.textContent = video.muted ? '🔇' : '🔊';
        muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
      }
      return;
    }

    // Tap card to play/pause video
    var card = e.target.closest('.feed-card');
    if (card) {
      var video = card.querySelector('video');
      if (video) {
        if (video.paused) {
          video.play().catch(function () {});
        } else {
          video.pause();
        }
      }
    }
  });

  // Keyboard play/pause
  feedScroll.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') {
      var card = e.target.closest('.feed-card');
      if (card) {
        e.preventDefault();
        var video = card.querySelector('video');
        if (video) {
          if (video.paused) {
            video.play().catch(function () {});
          } else {
            video.pause();
          }
        }
      }
    }
  });

  // Video progress bar
  for (var i = 0; i < videos.length; i++) {
    (function (video) {
      var card = video.closest('.feed-card');
      var progressBar = card ? card.querySelector('.feed-card__progress') : null;
      if (!progressBar) return;

      video.addEventListener('timeupdate', function () {
        if (video.duration) {
          var pct = (video.currentTime / video.duration) * 100;
          progressBar.style.width = pct + '%';
          progressBar.setAttribute('aria-valuenow', Math.round(pct));
        }
      });
    })(videos[i]);
  }

  // Hide scroll hint after first scroll
  var scrollHint = feedScroll.querySelector('.feed-card__scroll-hint');
  if (scrollHint) {
    feedScroll.addEventListener('scroll', function () {
      if (feedScroll.scrollTop > 50) {
        scrollHint.style.opacity = '0';
        scrollHint.style.transition = 'opacity 0.3s';
      }
    }, { once: true });
  }
})();
</script>
```

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0

- [ ] **Step 3: Visually verify feed**

Run: `npm run start`
Check: http://localhost:8080/feed/ — should show 5 full-screen gradient cards with snap scrolling

- [ ] **Step 4: Commit**

```bash
git add src/feed/index.njk
git commit -m "feat: rebuild feed as vertical snap-scroll video feed"
```

---

## Chunk 5: Tools, 404, Service Worker & Cleanup

### Task 15: Rebuild tools/index.njk

**Files:**
- Rewrite: `src/tools/index.njk`

- [ ] **Step 1: Write the new tools/index.njk**

```html
---
layout: base.njk
title: Tools
description: Utility tools built with craft. Spin up a timer, make a decision, or explore what's available.
---
<section class="hero" style="padding-top:1rem;">
    <p class="eyebrow">~/tools</p>
    <h1>Utility Tools</h1>
    <p>
        Simple, focused utilities that work offline. Each one does one thing well.
    </p>
</section>

{% set toolList = tools | default([]) %}
{% if toolList.length %}
<div class="tools-listing">
    <div class="tools-listing__header">
        <span>category</span>
        <span>name</span>
        <span>summary</span>
    </div>
    {% for tool in toolList %}
    <div class="tools-listing__row">
        <span class="tools-listing__category">{{ tool.category }}</span>
        <span class="tools-listing__name"><a href="/tools/{{ tool.slug }}/">{{ tool.title }}</a></span>
        <span class="tools-listing__summary">{{ tool.summary }}</span>
    </div>
    {% endfor %}
</div>
{% else %}
<div style="margin-top: 2rem; font-family: var(--font-mono); color: var(--term-muted);">
    <p>$ ls -la tools/</p>
    <p>> no tools found.<span class="cursor-blink"></span></p>
</div>
{% endif %}
```

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0, tools page now lists both tools

- [ ] **Step 3: Commit**

```bash
git add src/tools/index.njk
git commit -m "feat: rebuild tools index as terminal ls -la listing"
```

---

### Task 16: Restyle decision-wheel.njk

**Files:**
- Modify: `src/tools/decision-wheel.njk`

Changes needed:
1. Add terminal frame wrapping
2. Update CSS variable references (`--muted` → `--term-muted`, `--fg` → `--term-fg`)
3. Fix schema.org (remove `SocialNetworking` — already correct in this file, uses `ProductivityApplication`)
4. Update hero text to be user-facing

- [ ] **Step 1: Update the template**

Replace the hero section (lines 7-14) with:

```html
<section class="hero" style="padding-top:1rem;">
  <p class="eyebrow">~/tools/decision-wheel</p>
  <h1>Decision Wheel</h1>
  <p>
    Can't decide? Spin the wheel and let fate choose. Works offline.
  </p>
</section>
```

Replace the opening `<section class="tool-shell decision-tool">` (line 16) with:

```html
{% set terminalTitle = "decision-wheel.js" %}
{% include "terminal-frame-open.njk" %}
<section class="decision-tool">
```

Replace the closing `</section>` after the legend (line 43) with:

```html
</section>
{% include "terminal-frame-close.njk" %}
```

In the `<style>` block, replace all `var(--muted)` with `var(--term-muted)` and `var(--fg)` with `var(--term-fg)`.

Specifically change:
- Line 190: `color: var(--muted);` → `color: var(--term-muted);`
- Line 184: `color: var(--fg);` → `color: var(--term-fg);`

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/tools/decision-wheel.njk
git commit -m "feat: restyle decision wheel with terminal frame and design system vars"
```

---

### Task 17: Restyle countdown-timer.njk

**Files:**
- Modify: `src/tools/countdown-timer.njk`

Changes needed:
1. Add terminal frame wrapping
2. Update CSS variable references
3. Update hero text

- [ ] **Step 1: Update the template**

Replace the hero section (lines 7-13) with:

```html
<section class="hero" style="padding-top:1rem;">
  <p class="eyebrow">~/tools/countdown-timer</p>
  <h1>Countdown Timer</h1>
  <p>
    Set a duration or pick a target time. Up to 4 independent timers with alarm sound.
  </p>
</section>
```

Replace `<section class="tool-shell countdown-tool">` (line 16) with:

```html
{% set terminalTitle = "countdown-timer.js" %}
{% include "terminal-frame-open.njk" %}
<section class="countdown-tool">
```

Replace the closing `</section>` after the add button (line 24) with:

```html
</section>
{% include "terminal-frame-close.njk" %}
```

In the `<style>` block, replace CSS variable references:
- All `var(--muted)` → `var(--term-muted)` (lines 681, 730)
- All `var(--fg)` → `var(--term-fg)` (line 787)

- [ ] **Step 2: Verify build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/tools/countdown-timer.njk
git commit -m "feat: restyle countdown timer with terminal frame and design system vars"
```

---

### Task 18: Rebuild 404.njk

**Files:**
- Rewrite: `src/404.njk`

- [ ] **Step 1: Write the new 404.njk**

```html
---
layout: base.njk
title: 404
permalink: 404.html
eleventyExcludeFromCollections: true
---
<section class="hero" style="padding-top:3rem;">
    <div style="font-family: var(--font-mono); text-align: center;">
        <p style="color: var(--syn-pink); font-size: 0.9rem;">$ navigate {{ page.url | default('/unknown') }}</p>
        <h1 style="font-size: clamp(3rem, 8vw, 5rem); margin: 1rem 0;">404</h1>
        <p style="color: var(--syn-amber);">page not found<span class="cursor-blink"></span></p>
        <div style="margin-top: 2rem; font-size: 0.9rem; color: var(--term-muted);">
            <p>> try one of these:</p>
            <p style="margin-top: 0.5rem;">
                <a href="/" style="margin-right: 1.5rem;">~/home</a>
                <a href="/feed/" style="margin-right: 1.5rem;">~/feed</a>
                <a href="/tools/">~/tools</a>
            </p>
        </div>
    </div>
</section>
```

- [ ] **Step 2: Commit**

```bash
git add src/404.njk
git commit -m "feat: rebuild 404 page with terminal error style"
```

---

### Task 19: Update service worker

**Files:**
- Rewrite: `src/sw.js`

- [ ] **Step 1: Write the new sw.js**

```javascript
const CACHE_NAME = 'mentria-cache-v3';
const ASSETS = [
  '/',
  '/assets/css/style.css',
  '/assets/css/terminal.css',
  '/assets/js/mentria-cli.js',
  '/manifest.json',
  '/feed/',
  '/tools/',
  '/tools/decision-wheel/',
  '/tools/countdown-timer/'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    )
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/sw.js
git commit -m "feat: update service worker to v3 with new routes and assets"
```

---

### Task 20: Final verification and cleanup

**Files:**
- Various cleanup

- [ ] **Step 1: Run full build**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0 with no warnings

- [ ] **Step 2: Start dev server and verify all pages**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run start`

Check each page:
- `http://localhost:8080/` — CLI hero types welcome, tools cards below
- `http://localhost:8080/feed/` — Full-screen snap-scroll gradient cards
- `http://localhost:8080/tools/` — Terminal-style ls -la listing
- `http://localhost:8080/tools/decision-wheel/` — Wheel in terminal frame
- `http://localhost:8080/tools/countdown-timer/` — Timer in terminal frame
- `http://localhost:8080/feed/rebooting-mentria/` — Blog post with title and date

- [ ] **Step 3: Clean up orphaned build tools (if any exist)**

Run: `ls "/Volumes/Mac ext storage/Documents/website/build/tools/" 2>/dev/null`

If orphaned directories exist (e.g., `adaptive-elo`, `elo-chooser`, `json-notebook`, `starter-tool`, `webllm-chat`), they will be removed on next clean build since they have no source files. The `build/` directory is gitignored, so no action needed.

- [ ] **Step 4: Final commit for any remaining changes**

```bash
git add -A
git status
# Only commit if there are meaningful changes
git commit -m "chore: final rebrand cleanup"
```

- [ ] **Step 5: Verify build one more time**

Run: `cd "/Volumes/Mac ext storage/Documents/website" && npm run build`
Expected: Exit 0, clean build

---

## Summary

| Chunk | Tasks | What it delivers |
|---|---|---|
| 1: Design System | Tasks 1-5 | New CSS tokens, terminal.css, updated metadata |
| 2: Layouts | Tasks 6-10b | New base/header/footer/feed-layout, terminal frames, post layout |
| 3: CLI & Homepage | Tasks 11-12 | Interactive CLI hero, rebuilt homepage |
| 4: Feed | Tasks 13-14 | feed.json data, vertical snap-scroll feed page |
| 5: Tools & Cleanup | Tasks 15-20 | Restyled tools, 404, service worker, final verification |

Each chunk produces a working (buildable) site. Visual polish improves progressively — the site looks broken after chunk 1 alone but is fully branded after chunk 5.
