# Mentria

[mentria.ai](https://mentria.ai) — a creative studio shipping browser-native AI tools and serialized writing. The headline experiment is a **custom WebGPU inference engine** that runs **Qwen3.5-0.8B** locally in your browser, with **dynamic LoRA hot-swapping** for task-specific behavior. No server, no API key, no account, no data leaving your device.

## What's novel here

**A from-scratch browser LLM stack.** Most "run an LLM in your browser" projects wrap [transformers.js](https://github.com/huggingface/transformers.js) or [WebLLM](https://github.com/mlc-ai/web-llm). Mentria's engine is its own runtime — written from scratch against raw WebGPU, with WGSL compute shaders for matmul, the Gated DeltaNet recurrent state update (Qwen3.5's hybrid Mamba-style linear-attention layers), grouped-query attention with partial RoPE, and a fused base + LoRA matmul that lets adapters swap in under a second.

**Why bother building it.** Off-the-shelf browser LLM runtimes don't expose the internals you'd need to attach/detach LoRA adapters at runtime. Mentria does. A 2–8 MB adapter at rank 8 is trivially downloadable, so a single 660 MB base model can become a quote generator, a chat assistant, or anything else by hot-swapping spice racks at the matmul boundary.

**What it integrates with.** Two production tools rely on the engine today:

- **[AI Chat](https://mentria.ai/tools/ai-chat/)** — text + vision chat with the base Qwen3.5-0.8B model. Image inputs go through a 12-layer ViT vision tower (also running on WebGPU). Conversation history stays in memory; nothing reaches a server.
- **[Motivational Quote](https://mentria.ai/tools/quote/)** — same base model, with a curated quote-corpus LoRA loaded on demand. First visit downloads weights once, cached locally; subsequent visits start instantly.

Both pages gate the 660 MB model fetch behind user intent so the LCP element on first paint is a static CTA, not a long progress bar.

## SEO-relevant terms

If you found this from a search, the relevant keywords are: **browser llm**, **webgpu llm**, **on-device llm**, **qwen in browser**, **qwen3 webgpu**, **lora in browser**, **client-side llm**, **private ai chat**, **webgpu inference engine**, **dynamic lora swap browser**.

## The rest of the site

Beyond the AI tools, Mentria publishes ~15 small browser-native utilities and games — markdown→PDF, base64 codec, color picker, decision wheel, countdown timer, infinite AI-generated radio, plus terminal-aesthetic takes on tetris/pong/flappy/minesweeper. Everything works offline (PWA), in 5 languages (en/es/pt-BR/fr/ja), with zero third-party scripts and self-hosted fonts.

## Stack

Static-first: **Eleventy 3** + Nunjucks templates, vanilla JS, single runtime dependency. The whole thing builds to a flat directory and ships from GitHub Pages.

```bash
npm install
npm run start    # http://localhost:8080
npm run build    # → ./build
```


## License

MIT — see [LICENSE](LICENSE).
