---
layout: base.njk
title: Rebooting Mentria
description: Why I swapped Jekyll for Eleventy, introduced templates, and drew a new roadmap that keeps content in focus.
date: 2025-11-21
permalink: /feed/rebooting-mentria/
tags:
  - post
---
The site was drifting toward a folder-of-randomness: a radio stream here, a JSON helper there, and a bunch of forgotten experiments tucked into the `build/` directory. Shipping anything new meant hunting through duplicated HTML snippets and inlining meta tags by hand.

This rebuild resets the foundation:

- **Eleventy + Nunjucks** for tiny, composable templates.
- **HTMX-first enhancements** so utilities stay lightweight.
- **A single `src/` directory** where every blog post, tool, and asset lives side-by-side.

From this point on, "adding content" means writing Markdown, dropping a tool folder, or tweaking a JSON data file. Build once, deploy via GitHub Pages, then get back to the fun part—making things.
