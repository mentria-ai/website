---
layout: base.njk
permalink: /learn/format/
englishOnly: true
title: Pack format
description: How to write a learning pack for mentria.ai. One JSON file, nine card types, any tool that writes JSON can make one.
---

<section class="hero" style="padding-top:1rem;">
  <p class="eyebrow eyebrow--crumbs"><a class="eyebrow__link" href="/" aria-label="Home">~</a><span class="eyebrow__sep">/</span><a class="eyebrow__link" href="/learn/">learn</a><span class="eyebrow__sep">/</span><span class="eyebrow__current">format</span></p>
  <h1>Pack format</h1>
  <p>A pack is one JSON file. mentria plays it as cards you read, answer and come back to. Anything that writes JSON can make one, including an AI assistant working from a book or your notes.</p>
</section>

<link rel="stylesheet" href="/assets/css/learn.css">

<div class="prose learn-format">

## The file

Save it as `something.mentria.json` and import it on the [Learn page](/learn/), drop it there, or open `https://mentria.ai/learn/?pack=<url>` where the URL points at a file served over HTTPS. Packs stay on the device that imported them. Nothing is uploaded.

```json
{
  "id": "attention-basics",
  "version": 1,
  "title": "Attention in five cards",
  "subtitle": "How a token decides what to look at.",
  "cover": "https://example.com/cover.webp",
  "author": { "name": "you" },
  "language": "en",
  "tags": ["ai"],
  "minutes": 5,
  "sections": [
    { "id": "s1", "title": "The idea", "cards": ["c1", "c2"] },
    { "id": "s2", "title": "Check yourself", "cards": ["c3", "c4"] }
  ],
  "cards": [
    { "id": "c1", "type": "slide", "caption": "Every word gets to look at every other word.", "body": "One move, called **attention**, is under almost everything a model does." },
    { "id": "c2", "type": "image", "image": "https://example.com/parts.webp", "caption": "Tap the three parts.",
      "hotspots": [ { "x": 8, "y": 20, "w": 26, "h": 22, "label": "Query", "body": "What this token is looking for." } ] },
    { "id": "c3", "type": "mcq", "question": "What does the **query** represent?",
      "choices": [
        { "text": "What the current word is looking for", "correct": true, "why": "The query is the question a word asks of the others." },
        { "text": "The final answer the model prints", "why": "That comes much later." }
      ] },
    { "id": "c4", "type": "checkpoint", "summary": "Query asks, key answers, value carries." }
  ]
}
```

## Top level

| field | required | notes |
|---|---|---|
| `id` | yes | letters, digits, dots, dashes. Stable across versions. Importing the same id again replaces the pack. |
| `version` | no | integer, default 1. Bump it when you edit. |
| `title` | yes | text |
| `subtitle`, `cover`, `author`, `language`, `tags`, `minutes` | no | `cover` is a URL or data URI. `minutes` is an estimate; it is computed from the card count when missing. |
| `modes` | no | subset of `read`, `quiz`, `review`, `budget`. Default is all four. |
| `sections` | no | ordered groups of card ids. Every card should be in exactly one section. Without sections the pack is one section in card order. |
| `cards` | yes | at least one card, at most 2000 |

Any text field can be a string or a map of language codes to strings, for example `{ "en": "Hello", "fr": "Bonjour" }`. Text fields accept Markdown.

## Cards

Every card has `id` (unique in the pack) and `type`. Every card may also have `title`, `image`, `after` (ids of cards that should come first) and `guess` (see below).

| type | fields | what the learner does |
|---|---|---|
| `slide` | `caption`, `body`, `image` | reads |
| `image` | `image`, `caption`, `hotspots[]` of `{x, y, w, h, label, body}` in percent | taps the spots; tapping all of them counts as done |
| `mcq` | `question`, `choices[]` of `{text, correct, why}`, `multi`, `shuffle` | picks one, or every correct one when `multi` is true. `why` shows after answering. |
| `cloze` | `text` with `{% raw %}{{blank}}{% endraw %}` markers, `answers[]` (one per blank; an array lists accepted alternatives), `chips[]` extra distractors | fills the blanks with chips when `chips` is given, otherwise by typing |
| `order` | `prompt`, `items[]` in the correct order | puts the shuffled items back in order |
| `match` | `prompt`, `pairs[]` of `[left, right]` | pairs each left item with its right item |
| `canvas` | `html` (one self-contained HTML document, up to 512 KB) | uses your interactive; see below |
| `ask` | `prompt`, `model_answer`, `rubric` | writes an answer. The on-device model grades it when one is already set up, otherwise the learner compares and grades themselves. |
| `checkpoint` | `summary` | reads a recap; the card shows the section's score |

### Guess before reveal

Add `guess` to any card to ask for a prediction first:

```json
"guess": { "prompt": "How many tokens can the window hold?", "kind": "number", "answer": 16384, "unit": "tokens" }
```

`kind` is `number`, `range` (add `min`, `max`, optional `step`) or `choice` (add `choices[]` and `answer` as the index of the right one). Number guesses within 10% count as right.

### Canvas cards

The HTML runs in a sandboxed frame with no access to the site or its storage. It gets a small `window.mentria` object:

```js
window.mentria.theme        // { accent, bg, fg, muted, fontMono, fontBody }
window.mentria.lang         // the page language, e.g. "en"
window.mentria.done(right)  // record the card as answered; pass false for a wrong answer
window.mentria.next()       // move to the next card
window.mentria.notify(text) // show a short line under the frame
```

The frame inherits the site's content security policy, so external stylesheets, scripts and fonts never load; a Google Fonts link fails silently. The site's own faces are already available by name inside the frame: `Inter` for reading and `JetBrains Mono` for code and labels, and `body` starts with the theme's background, colour and body font. Images may be data URIs or hosted on cdn.mentria.ai. The page is dark only and the frame is set to `color-scheme: dark`; `prefers-color-scheme` inside the frame follows the visitor's operating system, not the site, so do not branch on it. Read colours from `window.mentria.theme` or write the dark values directly. Keep everything else inline.

## Modes

The learner chooses how to play, and the same pack serves all four modes. **Read** shows every answer. **Quiz** grades. **Review** replays only the cards they missed. **Today** mixes due reviews with new cards up to a daily budget. Cards answered wrong come back after 1, 3, 7, 16 and 35 days.

## Courses

A syllabus is a course: one JSON file that carries several packs in order. Import it once and the library shows the packs grouped under the course name; the home stream serves the first unfinished pack, then the next, so the order you wrote is the order they learn in.

```json
{
  "kind": "course",
  "id": "signals-101",
  "version": 1,
  "title": "Signals and systems",
  "subtitle": "Twelve weeks, one pack per lecture.",
  "cover": "https://example.com/cover.webp",
  "packs": [
    { "id": "signals-101-w01", "title": "Week 1: what a signal is", "cards": [ ... ] },
    { "id": "signals-101-w02", "title": "Week 2: sampling", "cards": [ ... ] },
    "https://example.com/signals-101-w03.mentria.json"
  ]
}
```

Each entry in `packs` is a full pack or an HTTPS URL to one. A course may hold up to 200 packs. Re-importing a course with the same id updates its packs in place and keeps your progress on cards whose ids did not change.

To assemble a course from a folder of pack files:

```
node scripts/pack-course.mjs ./my-course --id signals-101 --title "Signals and systems"
```

It validates every pack, orders them by filename (or by an `order` field inside each pack), and writes `signals-101.mentria-course.json`.

## Checking a pack

The repository ships a validator:

```
node scripts/pack-check.mjs my-pack.mentria.json
```

It prints the outline and every problem it finds, for a single pack or a whole course. The same rules run in the browser on import.

## Limits

A pack may be at most 25 MB as JSON. Images should be small WebP files or hosted URLs. Card ids and pack ids must match `[a-z0-9][a-z0-9._-]*`.

## Sharing

From the Learn page a pack can be shared as a file, and in Comms it can be sent straight to a contact, who imports it with one tap.

</div>
