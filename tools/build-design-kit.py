import os, re, json, shutil, html

W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(W, "docs", "design-refresh", "ds")
K = os.path.join(DS, "ui_kits", "mentria")
SPRITE = os.path.join(W, "src", "assets", "img", "tool-icons.svg")
DOC = os.path.join(W, "docs", "design-refresh", "mentria-design-system.md")


def main():
    for d in ("assets/fonts", "ui_kits/mentria/brand", "ui_kits/mentria/type", "ui_kits/mentria/colors", "ui_kits/mentria/spacing", "ui_kits/mentria/motion", "ui_kits/mentria/components"):
        os.makedirs(os.path.join(DS, d), exist_ok=True)
    css = open(os.path.join(W, "src/assets/css/style.css")).read().replace("url('/assets/fonts/", "url('./fonts/").replace('url("/assets/fonts/', 'url("./fonts/')
    open(os.path.join(DS, "assets/style.css"), "w").write(css)
    for f in ("terminal.css", "mentria-ui.css", "mentria-palette.css"):
        shutil.copy(os.path.join(W, "src/assets/css", f), os.path.join(DS, "assets", f))
    for f in os.listdir(os.path.join(W, "src/assets/fonts")):
        if f.endswith(".woff2"):
            shutil.copy(os.path.join(W, "src/assets/fonts", f), os.path.join(DS, "assets/fonts", f))
    sprite = open(SPRITE).read().replace('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">', '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">') if os.path.exists(SPRITE) else ""
    sprite_inline = ('<div style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">' + sprite + '</div>') if sprite else ""
    guide = open(DOC).read() if os.path.exists(DOC) else ""
    open(os.path.join(DS, "guide.md"), "w").write("# mentria design system — kit guide\n\nThe cards under `ui_kits/mentria/` render the site's real components with the site's own stylesheets (`assets/style.css`, `terminal.css`, `mentria-ui.css`) and self-hosted fonts. Use their markup and classes as-is; the tokens live in `assets/style.css` (`:root`). The document below describes the system.\n\n---\n\n" + guide)
    en = json.load(open(os.path.join(W, "src/_data/i18n/en.json")))

    def t(k, d=""):
        cur = en
        for p in k.split("."):
            if not isinstance(cur, dict) or p not in cur:
                return d
            cur = cur[p]
        return cur if isinstance(cur, str) else d

    ac_style = ""
    m = re.search(r"<style>(.*?)</style>", open(os.path.join(W, "src/tools/ai-chat.njk")).read(), re.S)
    if m:
        ac_style = "\n".join(l for l in m.group(1).splitlines() if "{{" not in l and "{%" not in l)
    head = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<link rel="stylesheet" href="../../../assets/style.css">
<link rel="stylesheet" href="../../../assets/terminal.css">
<link rel="stylesheet" href="../../../assets/mentria-ui.css">
<style>body{margin:0;background:var(--term-bg);color:var(--term-fg);font-family:var(--font-body);padding:24px}.ds-note{font-family:var(--font-mono);font-size:var(--text-xs);color:var(--term-muted);margin:0 0 14px;letter-spacing:.08em;text-transform:uppercase}.ds-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.ds-col{display:flex;flex-direction:column;gap:12px}%s</style>
</head>
<body>
'''

    def card(path, group, title, body, extra_css="", width=None):
        first = '<!-- @dsCard group="%s" title="%s"%s -->\n' % (group, title, (' width="%d"' % width) if width else "")
        open(os.path.join(K, path), "w").write(first + head % (title, extra_css) + body + "\n</body>\n</html>\n")

    nav = [("Feed", "M3.5 4.5h17v6h-17zM3.5 13.5h17v6h-17z"), ("Tools", "M14.8 3.6a5.2 5.2 0 0 0-5.8 7l-5.4 5.4a1.6 1.6 0 0 0 0 2.3l1.1 1.1a1.6 1.6 0 0 0 2.3 0l5.4-5.4a5.2 5.2 0 0 0 7-5.8l-3 3-2.8-.7-.7-2.8z"), ("Comms", "M4.6 4.8h14.8a1.4 1.4 0 0 1 1.4 1.4v8.6a1.4 1.4 0 0 1-1.4 1.4H9.4l-5.2 3.8V6.2a1.4 1.4 0 0 1 1.4-1.4z"), ("About", "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 11v5.2M12 8h.01")]
    navhtml = "".join('<a href="#" class="nav-link%s"><svg class="nav-link__i" viewBox="0 0 24 24" aria-hidden="true"><path d="%s" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="nav-link__t">%s</span></a>' % (" active" if n == "Tools" else "", p, n) for n, p in nav)
    brand = '<a class="brand" href="#" aria-label="Mentria home"%s>MENTRIA<span class="brand__ai" aria-hidden="true"><span class="brand__ai-text"><span class="brand__ai-a">A</span><span class="brand__ai-i">I</span></span></span></a>'
    langs = "".join('<li><a class="lang-switcher__item%s" href="#"><span class="lang-switcher__name">%s</span><span class="lang-switcher__code">%s</span></a></li>' % (" is-active" if c == "en" else "", n, c) for c, n in (("en", "English"), ("es", "Español"), ("fr", "Français"), ("ja", "日本語"), ("pt-BR", "Português")))
    card("brand/header.html", "Brand", "Header and wordmark", '<p class="ds-note">site header · wordmark MENTRIA + AI · nav · ⌘K · language switcher</p><header class="site-header"><div class="site-header__inner">' + brand % "" + '<nav class="site-nav">' + navhtml + '<button type="button" class="nav-cmdk" aria-label="Open command palette">⌘K</button><details class="lang-switcher"><summary><span aria-hidden="true">🌐</span><span class="lang-switcher__current">English</span><span class="lang-switcher__chevron" aria-hidden="true">▾</span></summary><ul class="lang-switcher__menu">' + langs + '</ul></details></nav></div></header><p class="ds-note" style="margin-top:28px">wordmark alone</p>' + brand % ' style="font-size:2.2rem"', width=1200)

    sizes = ["--text-2xs", "--text-xs", "--text-sm", "--text-base", "--text-md", "--text-lg", "--text-xl", "--text-2xl", "--text-hero"]
    rows = "".join('<div class="ds-row" style="gap:20px"><code style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--term-muted);width:120px">%s</code><span style="font-family:var(--font-mono);font-size:var(%s);font-weight:600">Loading model… ready</span><span style="font-family:var(--font-body);font-size:var(%s)">Runs on your device, nothing leaves it.</span></div>' % (n, n, n) for n in sizes)
    card("type/type-scale.html", "Type", "Type scale and faces", '<p class="ds-note">JetBrains Mono for identity (labels, buttons, status, headings) · Inter for reading · weights 400 / 500 / 600 / 700</p><div class="ds-col" style="gap:14px">%s</div><p class="ds-note" style="margin-top:24px">uppercase label · 0.1–0.15em tracking</p><span class="eyebrow">&gt; on-device ai</span>' % rows, width=1100)

    tv = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", "\n".join(re.findall(r":root\s*\{[^}]*\}", css))))
    groups = [("Surfaces", ["--term-bg", "--term-bg-raised", "--term-surface-2", "--term-surface-3", "--term-border", "--term-border-strong", "--term-divider", "--field-border"]), ("Text", ["--term-fg", "--term-fg-strong", "--term-muted", "--term-subtle"]), ("Accents", ["--accent", "--syn-cyan", "--syn-cyan-soft", "--syn-purple", "--syn-pink", "--syn-green", "--syn-amber", "--syn-orange"]), ("Tints", ["--cyan-8", "--cyan-15", "--cyan-30", "--purple-8", "--purple-20", "--pink-10", "--pink-15", "--pink-30", "--green-8", "--green-15", "--green-30", "--amber-8", "--amber-15", "--amber-30", "--orange-8", "--orange-15", "--orange-30"])]
    sw = ""
    for g, names in groups:
        sw += '<p class="ds-note" style="margin-top:22px">%s</p><div class="ds-row" style="gap:10px">' % g
        for n in names:
            if n in tv:
                sw += '<div style="width:138px"><div style="height:56px;border-radius:var(--radius-md);border:1px solid var(--term-border-strong);background:var(%s)"></div><div style="font-family:var(--font-mono);font-size:10px;color:var(--term-muted);margin-top:6px">%s<br>%s</div></div>' % (n, n, html.escape(tv[n][:34]))
        sw += '</div>'
    sw += '<p class="ds-note" style="margin-top:22px">gradients</p><div class="ds-row"><div style="width:280px;height:40px;border-radius:var(--radius-md);background:var(--gradient-action)"></div><div style="width:280px;height:80px;border-radius:var(--radius-md);background:var(--term-bg-raised) var(--gradient-aura)"></div><div style="width:280px;height:40px;border-radius:var(--radius-md);background:var(--gradient-titlebar);border:1px solid var(--term-border)"></div></div>'
    card("colors/palette.html", "Colors", "Palette", '<p class="ds-note">cyan is action · mint is brand · purple metadata · pink prompts and errors · green success · amber loading · orange warm categories</p>' + sw, width=1200)

    sp = "".join('<div class="ds-row" style="gap:16px"><code style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--term-muted);width:90px">--space-%d</code><div style="height:14px;width:var(--space-%d);background:var(--syn-cyan);border-radius:2px"></div></div>' % (i, i) for i in range(1, 10))
    rad = "".join('<div style="width:96px;height:64px;border:1px solid var(--term-border-strong);background:var(--term-bg-raised);border-radius:var(--radius-%s);display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;color:var(--term-muted)">%s</div>' % (r, r) for r in ("sm", "md", "lg", "xl", "pill"))
    el = "".join('<div style="width:150px;height:72px;border-radius:var(--radius-lg);background:var(--term-bg-raised);border:1px solid var(--term-border);box-shadow:var(--%s);display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;color:var(--term-muted)">%s</div>' % (e, e) for e in ("elev-1", "elev-2", "elev-3", "glow-cyan", "glow-cyan-soft", "glow-purple", "glow-pink", "glow-amber", "glow-green"))
    card("spacing/spacing-radius-elevation.html", "Spacing", "Spacing, radius, elevation", '<p class="ds-note">4 px grid</p><div class="ds-col" style="gap:8px">%s</div><p class="ds-note" style="margin-top:24px">radius</p><div class="ds-row">%s</div><p class="ds-note" style="margin-top:24px">elevation and glows</p><div class="ds-row" style="gap:18px">%s</div><p class="ds-note" style="margin-top:24px">layout widths · content 960 · --wide clamp(960px, 96vw, 1100px) · games 1180 · launcher and CLI 680</p>' % (sp, rad, el), width=1200)

    mo = "".join('<div class="ds-row" style="gap:16px"><code style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--term-muted);width:120px">%s</code><span style="font-family:var(--font-mono);font-size:var(--text-sm)">%s</span></div>' % (n, html.escape(tv.get(n, ""))) for n in ("--dur-1", "--dur-2", "--dur-3", "--dur-4", "--dur-5", "--ease-out", "--ease-in-out", "--ease-snap", "--ease-exit", "--spring-settle", "--stag-step", "--stag-cap", "--duration-fast", "--duration-base", "--duration-slow"))
    card("motion/motion.html", "Motion", "Motion tokens", '<p class="ds-note">durations, easings, the spring settle, stagger · everything off under prefers-reduced-motion</p><div class="ds-col" style="gap:8px">%s</div><p class="ds-note" style="margin-top:24px">press the tile: spring settle · hover: lift 2px + glow</p><div class="ds-row"><a class="launch-tile" href="#" style="--cat:var(--syn-cyan)"><span class="launch-tile__icon" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" stroke-width="2.5"/></svg></span><span class="launch-tile__label">AI Chat</span></a><div class="card" style="width:220px"><h3 style="margin:0 0 6px;font-family:var(--font-mono);font-size:var(--text-base)">Card hover</h3><p style="margin:0;color:var(--term-muted);font-size:var(--text-sm)">translateY(-2px), strong border, soft cyan glow</p></div></div>' % mo, width=1000)

    card("components/buttons-inputs.html", "Components", "Buttons, inputs, segmented control", '<p class="ds-note">mentria-ui.css · .m-btn .m-btn--primary .m-btn--ghost .m-btn--danger · .m-input .m-field .m-seg</p><div class="ds-row"><button class="m-btn m-btn--primary" type="button">Load model</button><button class="m-btn" type="button">Secondary</button><button class="m-btn m-btn--ghost" type="button">Ghost</button><button class="m-btn m-btn--danger" type="button">Delete model</button><button class="m-btn m-btn--primary" type="button" disabled>Disabled</button></div><div class="ds-row" style="margin-top:24px;align-items:flex-start"><label class="m-field" style="width:320px"><span>Room key</span><input class="m-input" type="text" value="S_929z…" placeholder="paste a key"></label><label class="m-field" style="width:320px"><span>Message</span><input class="m-input" type="text" placeholder="Message…"></label></div><div class="m-seg" style="margin-top:24px" role="group"><button class="m-seg__btn is-active" type="button">0.8B</button><button class="m-seg__btn" type="button">2B</button><button class="m-seg__btn" type="button">4B</button><button class="m-seg__btn" type="button">27B</button></div><p class="ds-note" style="margin-top:24px">focus: 2px cyan outline + soft cyan glow, offset 2px</p>', width=1000)

    states = [("idle", "Idle"), ("loading", "Loading model… 42%"), ("ready", "Ready"), ("generating", "Generating…"), ("error", "Failed to load: device lost")]
    st = "".join('<div class="m-status m-status--%s"><span class="m-status__dot"></span><span class="m-status__text">%s</span></div>' % (s, txt) for s, txt in states)
    card("components/status-progress.html", "Components", "Status bar, counter, progress", '<p class="ds-note">.m-status states: idle · loading (amber, pulse) · ready (green) · generating (cyan, pulse) · error (pink)</p><div class="ds-col">%s</div><p class="ds-note" style="margin-top:24px">ai-chat status bar with the live counter</p><div class="ac"><div class="ac__status"><span class="ac__status-dot ac__status-dot--ready"></span><span class="ac__status-text">Ready</span><span class="ac__counter">133 tokens · 30.2 tok/s</span></div></div><p class="ds-note" style="margin-top:24px">progress: 4 px track, gradient-action fill, label row above</p><div style="width:420px"><div class="ds-row" style="justify-content:space-between;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--term-muted)"><span>bonsai-27b-q1g128 · shard 2 of 2</span><span>63%%</span></div><div class="widget__bar" style="margin-top:6px"><div class="widget__bar-fill" style="width:63%%"></div></div><div style="text-align:right;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--term-subtle);margin-top:4px">2.4 GB of 3.8 GB</div></div>' % st, extra_css=ac_style, width=1000)

    card("components/terminal-frame.html", "Components", "Terminal frame", '<p class="ds-note">terminal.css · the container of every tool: dots, filename, help, expand, body</p><div class="terminal-frame" style="max-width:860px"><div class="terminal-frame__titlebar"><div class="terminal-frame__dots"><span class="terminal-frame__dot terminal-frame__dot--red"></span><span class="terminal-frame__dot terminal-frame__dot--yellow"></span><button type="button" class="terminal-frame__dot terminal-frame__dot--green" aria-label="Toggle fullscreen"></button></div><span class="terminal-frame__filename">ai-chat.js</span><button type="button" class="terminal-frame__help" aria-label="Controls">?</button><button type="button" class="terminal-frame__expand" aria-label="Toggle fullscreen">⤢</button></div><div class="terminal-frame__body"><div class="ac"><div class="ac__status"><span class="ac__status-dot ac__status-dot--ready"></span><span class="ac__status-text">Ready</span><span class="ac__counter">133 tokens · 30.2 tok/s</span></div></div><p style="font-family:var(--font-mono);font-size:var(--text-sm);color:var(--term-muted);margin:18px 0 0">&gt; Chat with a local model. Nothing uploaded.</p></div></div>', extra_css=ac_style + "\n.terminal-frame__body{min-height:0}", width=1000)

    cards = "".join('<a class="card" href="#"><h3 style="margin:0 0 8px;font-family:var(--font-mono);font-size:var(--text-base);color:var(--syn-cyan)">%s</h3><p style="margin:0;color:var(--term-muted);font-size:var(--text-sm)">%s</p></a>' % (t("tools.%s.title" % s, s), t("tools.%s.lede" % s, "")) for s in ("ai-chat", "radio", "chess"))
    card("components/cards.html", "Components", "Cards, eyebrow, section heading", '<span class="eyebrow">&gt; tools</span><h2 class="section-heading" style="margin-top:8px">Latest tools</h2><div class="card-grid">%s</div>' % cards, width=1100)

    def icon(slug):
        return ('<use href="#tool-%s"></use>' % slug) if sprite else '<rect x="10" y="10" width="28" height="28" rx="7" fill="none" stroke="currentColor" stroke-width="2.5"/>'

    tiles = [("ai-chat", "AI Chat", "--syn-purple"), ("radio", "Radio", "--syn-cyan"), ("chess", "Chess", "--syn-orange"), ("qr-scanner", "QR Scanner", "--syn-cyan")]
    tl = "".join('<a class="launch-tile" href="#" data-slug="%s" style="--cat:var(%s)"><span class="launch-tile__icon" aria-hidden="true"><svg viewBox="0 0 48 48">%s</svg></span><span class="launch-tile__label">%s</span></a>' % (s, c, icon(s), n) for s, n, c in tiles)
    card("components/launcher.html", "Components", "Launcher tiles and widgets", sprite_inline + '<p class="ds-note">homepage launcher for returning visitors · tiles 84 px, category colour through --cat · widgets 168 px with live state</p><section class="launcher" style="margin:0"><div class="launcher__widgets" style="display:flex;gap:12px;flex-wrap:wrap"><a class="widget widget--steps" href="#" style="--cat:var(--syn-green)"><div class="widget__top"><span class="widget__name">Step counter</span></div><span class="widget__value">6,412</span><span class="widget__sub">today</span><div class="widget__bar"><div class="widget__bar-fill" style="width:64%%"></div></div></a><a class="widget widget--notes" href="#" style="--cat:var(--syn-amber)"><div class="widget__top"><span class="widget__name">Quick notes</span></div><span class="widget__value widget__value--sm">3 notes</span><span class="widget__sub">last edited 2 h ago</span></a></div><section class="launcher__cat launcher__cat--ai" data-group="AI" style="margin-top:22px"><h2 class="launcher__label">AI</h2><div class="launcher__grid">%s</div></section></section>' % tl, width=1000)

    rows = "".join('<div class="tools-listing__row"><span class="tools-listing__category">%s</span><span class="tools-listing__name"><svg class="tools-listing__icon" viewBox="0 0 48 48" aria-hidden="true">%s</svg><a href="#">%s</a></span><span class="tools-listing__summary">%s</span></div>' % (t("category.%s" % c, c), icon(s), t("tools.%s.title" % s, s), t("tools.%s.lede" % s, "")) for s, c in (("ai-chat", "AI"), ("radio", "Utility"), ("chess", "Game"), ("qr-scanner", "Utility"), ("bubble-level", "Utility")))
    card("components/tools-listing.html", "Components", "Tools listing", sprite_inline + '<p class="ds-note">/tools/ · ls-style rows: icon · category · name · summary</p><div class="tools-listing"><div class="tools-listing__header"><span>category</span><span>name</span><span>summary</span></div>%s</div>' % rows, width=1100)

    card("components/dialog.html", "Components", "Dialog", '<p class="ds-note">#m-dialog · the site\'s confirm / alert / prompt · never native dialogs</p><div class="m-dialog" role="alertdialog" style="position:static;display:block;max-width:420px"><p class="m-dialog__msg">This site\'s AI runs best on the 27B on-device model: about 3.8 GB, downloaded once and kept on this device. Load it now?</p><div class="m-dialog__actions"><button type="button" class="m-dialog__btn m-dialog__btn--ghost">Cancel</button><button type="button" class="m-dialog__btn m-dialog__btn--primary">OK</button></div></div>', width=800)

    card("components/chat.html", "Components", "Chat messages", '<p class="ds-note">ai-chat · user bubble on cyan-8, assistant on purple-8, uppercase label row, actions under the answer</p><div class="ac" style="max-width:760px"><div class="ac__messages"><div class="ac__msg ac__msg--user"><span class="ac__msg-label">you</span><div class="ac__msg-body">In about ten short lines, explain why running a language model inside the browser matters for privacy.</div></div><div class="ac__msg ac__msg--assistant"><span class="ac__msg-label">bonsai-27b</span><div class="ac__msg-body">Running a language model locally means your data never leaves your device.<br>Every thought, query, and message stays on your own hardware.<br>No cloud servers, no accounts, and no telemetry are required.</div><div class="ac__msg-actions"><button type="button" class="ac__msg-action">Copy</button><button type="button" class="ac__msg-action ac__msg-regen">Regenerate</button></div></div></div></div>', extra_css=ac_style, width=900)

    chips = "".join('<li><a class="related-tools__chip" href="#"><span class="related-tools__name">%s</span><span class="related-tools__cat">%s</span></a></li>' % (t("tools.%s.title" % s, s), t("category.%s" % c, c)) for s, c in (("annotate-image", "AI"), ("quote", "AI"), ("console", "Developer")))
    card("components/tldr-related.html", "Components", "TL;DR and related tools", '<p class="ds-note">.tldr above a tool frame · .related-tools rail below it</p><details class="tldr" open style="max-width:860px"><summary class="tldr__summary"><span class="tldr__cta-more">Read more</span><span class="tldr__cta-less">Read less</span><span class="tldr__caret" aria-hidden="true">▾</span></summary><div class="tldr__panel"><h2 class="tldr__heading">What is AI Chat?</h2><p class="tldr__body">%s</p></div></details><nav class="related-tools" style="margin-top:24px;max-width:860px"><span class="related-tools__label">Related tools</span><ul class="related-tools__list">%s<li><a class="related-tools__chip related-tools__chip--all" href="#">All tools →</a></li></ul></nav>' % (html.escape(t("tools.ai-chat.tldr", "Chat with a local model. Nothing uploaded.")[:300]), chips), width=1000)

    n = sum(len(f) for _, _, f in os.walk(K))
    print("design kit:", n, "cards in", K)


main()
