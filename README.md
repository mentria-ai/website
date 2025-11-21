# Mentria (mentria.ai)

Static-first blog + tool stack powered by [Eleventy](https://www.11ty.dev/), Nunjucks templates, HTMX-friendly markup, and a lightweight PWA shell. The goal is to make publishing long-form posts, single-page utility apps, or playful media experiments as simple as dropping files into `src/` and running one command.

---

## What’s inside

- **Eleventy 3** with Nunjucks layouts and computed front‑matter.
- **Reusable chrome** via `_includes/base.njk`, `_includes/header.njk`, `_includes/footer.njk`.
- **Content buckets**
  - `src/feed` – Markdown posts (`tags: ["post"]` show up on the feed index + homepage cards).
  - `src/tools` – Each `.njk` file or folder becomes `/tools/<slug>/`.
  - `src/assets` – Images and datasets (copied verbatim during the build).
- **Global data** in `src/_data`
  - `site.json` drives titles, descriptions, and social tags.
  - `tools.json` feeds the homepage + `/tools` directory cards.
- **PWA plumbing** – `src/manifest.json` + `src/sw.js` register automatically from the base layout.

Legacy static output (`build/`) is no longer tracked. The raw content that mattered (Mahabharata translations, audio, etc.) now lives under `src/assets/**` so it stays versioned while the final HTML is generated on demand.

---

## Quick start

```bash
git clone https://github.com/<you>/website.git
cd website
npm install
npm run start   # hot-reload dev server on http://localhost:8080
npm run build   # writes production files to ./build
```

Node 20+ works, Node 22 LTS is what the CI uses (`actions/setup-node@v4`).

---

## Adding content

### Feed entries

1. Create `src/feed/my-entry.md`.
2. Front matter **must** include `tags: ["post"]`.
3. Optionally set `description`, `date`, and `permalink`.

Eleventy will add it to `collections.post`, which feeds `/feed/` and the homepage “Latest feed entries” list.

### Tools / micro apps

1. Create a template (HTML/Nunjucks or Markdown) under `src/tools/<slug>.njk`.
2. Add an entry to `src/_data/tools.json` so it appears in cards:

```json
{
  "slug": "starter-tool",
  "title": "Starter Tool",
  "summary": "Duplicate me to launch the next utility.",
  "category": "Utility"
}
```

3. Use inline `<script>` blocks, import HTMX, or reference files under `src/assets/js/`.

### Assets & datasets

- Drop general static files into `src/assets/**`.
- Large reference corpora (e.g., `src/assets/data/reference/…`) are copied via passthrough.

---

## PWA + HTMX approach

- `base.njk` injects `<link rel="manifest">`, an HTMX CDN import, and registers `/sw.js`.
- Update `src/sw.js` if you add more offline-critical routes; it currently caches the shell + CSS.
- Feel free to swap HTMX for vanilla JS on a per-tool basis—there’s no front-end framework lock-in.

---

## Deployment (GitHub Pages)

`.github/workflows/static.yml` handles the pipeline:

1. Checkout repo.
2. `actions/setup-node@v4` (Node 22, npm cache).
3. `npm ci && npm run build`.
4. Upload the `build/` artifact.
5. Deploy with `actions/deploy-pages@v4`.

Pushes to `main` automatically publish; you can also trigger it manually via the “Run workflow” button.

---

## License

[MIT](LICENSE) – go build your own lab if you like this shape. Contributions welcome once the new structure settles in.
