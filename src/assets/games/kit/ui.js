import { formatRaceTime, formatSplitDelta } from './race.js';

const UI_STYLE_ID = 'gk-ui-style';

const UI_COPY_DEFAULTS = {
  back: 'Back',
  select: 'Select',
  move: 'Move',
  confirm: 'OK',
  cancel: 'Cancel',
  go: 'GO',
  loading: 'Loading',
  best: 'Best',
  noTime: '--:--.---',
  locked: 'Locked',
  newBest: 'New record',
  medalGold: 'Gold',
  medalSilver: 'Silver',
  medalBronze: 'Bronze',
  medalNone: 'Finished',
  on: 'On',
  off: 'Off',
  pause: 'Pause',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  position: 'Position',
  time: 'Time',
  rotate: 'Turn your phone sideways to play',
  rotateDismiss: 'Tap to dismiss'
};

const UI_STYLE = [
  '.gk-stage{--gk-mint:#6ef3c5;--gk-mint-rgb:110,243,197;--gk-ink:#03130d;--gk-fg:#eaf3f0;--gk-muted:#8fa5a1;--gk-dim:#5f736f;',
  '--gk-gold:#f2c94c;--gk-silver:#cfd6e0;--gk-bronze:#d9925a;',
  '--gk-display:var(--font-body,Inter,system-ui,sans-serif);--gk-mono:var(--font-mono,ui-monospace,monospace);',
  '--gk-safe-t:env(safe-area-inset-top,0px);--gk-safe-r:env(safe-area-inset-right,0px);--gk-safe-b:env(safe-area-inset-bottom,0px);--gk-safe-l:env(safe-area-inset-left,0px)}',
  '.gk-stage:fullscreen{width:100vw;height:100vh;height:100svh;max-height:none;aspect-ratio:auto;border:0;border-radius:0}',
  '.gk-stage:-webkit-full-screen{width:100vw;height:100vh;max-height:none;aspect-ratio:auto;border:0;border-radius:0}',
  '.gk-ui,.gk-hud{position:absolute;inset:0;pointer-events:none;container-type:size;font-family:var(--gk-display);color:var(--gk-fg);',
  '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}',
  '.gk-ui{z-index:30}.gk-hud{z-index:10;transition:opacity .2s ease}',
  '.gk-ui *,.gk-hud *{box-sizing:border-box}',
  '[data-gk-menu="full"]>.gk-hud{opacity:0}',
  '.gk-hud[hidden]{display:none}',
  '.gk-hud__slot{position:absolute;display:flex;gap:clamp(8px,2cqw,18px);align-items:flex-start}',
  '.gk-hud__slot--tl{top:calc(var(--gk-safe-t) + 12px);left:calc(var(--gk-safe-l) + 14px)}',
  '.gk-hud__slot--tc{top:calc(var(--gk-safe-t) + 12px);left:50%;transform:translateX(-50%);justify-content:center}',
  '.gk-hud__slot--tr{top:calc(var(--gk-safe-t) + 12px);right:calc(var(--gk-safe-r) + 14px + var(--gk-chrome-w,0px));justify-content:flex-end}',
  '.gk-hud__slot--cl{top:50%;left:calc(var(--gk-safe-l) + 14px);transform:translateY(-50%)}',
  '.gk-hud__slot--cr{top:50%;right:calc(var(--gk-safe-r) + 14px);transform:translateY(-50%)}',
  '.gk-hud__slot--center{top:50%;left:50%;transform:translate(-50%,-50%);flex-direction:column;align-items:center}',
  '.gk-hud__slot--bl{bottom:calc(var(--gk-safe-b) + 12px);left:calc(var(--gk-safe-l) + 14px);align-items:flex-end}',
  '.gk-hud__slot--bc{bottom:calc(var(--gk-safe-b) + 12px);left:50%;transform:translateX(-50%);align-items:flex-end;justify-content:center}',
  '.gk-hud__slot--br{bottom:calc(var(--gk-safe-b) + 12px);right:calc(var(--gk-safe-r) + 14px);align-items:flex-end;justify-content:flex-end}',
  '.gk-stat{display:flex;flex-direction:column;gap:3px;min-width:0;text-shadow:0 1px 6px rgba(0,0,0,.75)}',
  '.gk-stat__k{font:600 clamp(8px,2.2cqh,10.5px)/1 var(--gk-mono);letter-spacing:.2em;text-transform:uppercase;color:rgba(234,243,240,.66)}',
  '.gk-stat__v{font:700 clamp(15px,4.8cqh,24px)/1 var(--gk-mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em;color:#f2fbf8}',
  '.gk-stat--accent .gk-stat__v{color:var(--gk-mint);text-shadow:0 0 14px rgba(var(--gk-mint-rgb),.4),0 1px 6px rgba(0,0,0,.7)}',
  '.gk-stat--big .gk-stat__v{font-size:clamp(26px,9cqh,52px);font-style:italic;font-family:var(--gk-display);font-weight:900;letter-spacing:-.02em}',
  '.gk-stat--small .gk-stat__v{font-size:clamp(11px,3.2cqh,14px);color:rgba(234,243,240,.8)}',
  '.gk-stat--right{align-items:flex-end;text-align:right}',
  '.gk-stat__unit{font:600 .42em/1 var(--gk-mono);letter-spacing:.14em;margin-left:.3em;color:rgba(234,243,240,.6);font-style:normal}',
  '.gk-chrome{position:absolute;top:calc(var(--gk-safe-t) + 10px);right:calc(var(--gk-safe-r) + 12px);z-index:42;display:flex;gap:8px;pointer-events:none}',
  '.gk-chrome__btn{pointer-events:auto;width:40px;height:40px;display:grid;place-items:center;padding:0;margin:0;cursor:pointer;border-radius:12px;',
  'background:rgba(4,8,10,.55);border:1px solid rgba(255,255,255,.14);color:var(--gk-fg);box-shadow:0 4px 14px rgba(0,0,0,.35);',
  'transition:border-color .14s ease,background .14s ease,transform .1s ease;-webkit-appearance:none;appearance:none;touch-action:manipulation}',
  '.gk-chrome__btn:hover,.gk-chrome__btn:focus-visible{border-color:rgba(var(--gk-mint-rgb),.8);outline:none}',
  '.gk-chrome__btn:active{transform:scale(.94)}',
  '.gk-chrome__btn[hidden]{display:none}',
  '.gk-chrome__btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-screen{position:absolute;inset:0;pointer-events:auto;opacity:0;visibility:hidden;transition:opacity .16s ease,visibility 0s linear .16s;overflow:hidden}',
  '.gk-screen.is-on{opacity:1;visibility:visible;transition:opacity .2s ease}',
  '.gk-bg{position:absolute;inset:0;pointer-events:none;',
  'background:linear-gradient(90deg,rgba(3,6,8,.94) 0%,rgba(3,6,8,.8) 30%,rgba(3,6,8,.3) 58%,rgba(3,6,8,.06) 78%),',
  'linear-gradient(0deg,rgba(3,6,8,.7) 0%,rgba(3,6,8,0) 34%),linear-gradient(180deg,rgba(3,6,8,.55) 0%,rgba(3,6,8,0) 26%)}',
  '.gk-bg--dim{background:radial-gradient(ellipse at 50% 50%,rgba(3,6,8,.62) 0%,rgba(3,6,8,.86) 100%)}',
  '.gk-bg--solid{background:radial-gradient(ellipse at 70% 30%,#0d1a1c 0%,#05090c 60%)}',
  '.gk-art{position:absolute;top:0;right:0;bottom:0;width:66%;background-size:cover;background-position:center;opacity:0;transition:opacity .5s ease;',
  '-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 34%);mask-image:linear-gradient(90deg,transparent 0%,#000 34%)}',
  '.gk-art.is-loaded{opacity:.95}',
  '.gk-speed{position:absolute;inset:0;pointer-events:none;opacity:.5;',
  'background:repeating-linear-gradient(104deg,transparent 0 46px,rgba(var(--gk-mint-rgb),.035) 46px 47px,transparent 47px 140px);',
  '-webkit-mask-image:linear-gradient(90deg,#000 0%,transparent 55%);mask-image:linear-gradient(90deg,#000 0%,transparent 55%)}',
  '.gk-pane{position:absolute;inset:0;display:flex;flex-direction:column;',
  'padding:calc(var(--gk-safe-t) + clamp(12px,4.2cqh,34px)) calc(var(--gk-safe-r) + clamp(16px,4cqw,48px)) calc(var(--gk-safe-b) + clamp(10px,3.6cqh,30px)) calc(var(--gk-safe-l) + clamp(16px,4.4cqw,56px))}',
  '.gk-kicker{display:flex;align-items:center;gap:10px;margin:0 0 clamp(4px,1.2cqh,10px);font:600 clamp(9px,2.5cqh,12px)/1 var(--gk-mono);',
  'letter-spacing:.24em;text-transform:uppercase;color:var(--gk-mint)}',
  '.gk-kicker::before{content:"";width:22px;height:3px;background:var(--gk-mint);transform:skewX(-30deg);box-shadow:0 0 10px rgba(var(--gk-mint-rgb),.6)}',
  '.gk-title{margin:0;font-family:var(--gk-display);font-weight:900;font-style:italic;text-transform:uppercase;line-height:.9;letter-spacing:-.015em;',
  'font-size:clamp(30px,min(12.5cqh,9cqw),92px);color:#f5fbf9;text-shadow:0 4px 34px rgba(0,0,0,.55)}',
  '.gk-title em{font-style:inherit;color:var(--gk-mint)}',
  '.gk-title--md{font-size:clamp(24px,min(8.6cqh,6.2cqw),60px)}',
  '.gk-title::after{content:"";display:block;width:1.9em;height:max(3px,.07em);margin-top:.14em;transform:skewX(-30deg);transform-origin:left;',
  'background:linear-gradient(90deg,var(--gk-mint),rgba(var(--gk-mint-rgb),0))}',
  '.gk-sub{margin:clamp(6px,1.6cqh,12px) 0 0;font:500 clamp(10px,2.7cqh,13px)/1.4 var(--gk-mono);letter-spacing:.2em;text-transform:uppercase;color:var(--gk-muted)}',
  '.gk-logo{display:block;height:clamp(28px,12cqh,90px);width:auto;max-width:60cqw;margin:0 0 clamp(4px,1cqh,10px);object-fit:contain;object-position:left center}',
  '.gk-logo[hidden]{display:none}',
  '.gk-list{display:flex;flex-direction:column;gap:clamp(5px,1.5cqh,11px);margin-top:clamp(12px,5cqh,40px);padding-left:4px}',
  '.gk-slab{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;column-gap:.75em;',
  'width:clamp(230px,36cqw,400px);height:clamp(38px,10.4cqh,58px);padding:0 1.05em 0 .95em;margin:0;border:0;background:none;',
  'color:var(--gk-fg);font:inherit;font-size:clamp(15px,4.7cqh,25px);font-weight:800;font-style:italic;letter-spacing:.005em;text-transform:uppercase;',
  'text-align:left;cursor:pointer;outline:none;isolation:isolate;-webkit-appearance:none;appearance:none;touch-action:manipulation;',
  'transition:color .14s ease,transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease}',
  '.gk-slab::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:3px;background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(255,255,255,.02));',
  'border:1px solid rgba(255,255,255,.08);transform:skewX(-14deg);transition:background .14s ease,border-color .14s ease,box-shadow .2s ease}',
  '.gk-slab::after{content:"";position:absolute;left:-10px;top:22%;bottom:22%;width:4px;background:var(--gk-mint);transform:skewX(-14deg) scaleY(0);',
  'transition:transform .18s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 12px rgba(var(--gk-mint-rgb),.8)}',
  '.gk-slab.is-focus{color:var(--gk-ink);transform:translateX(12px)}',
  '.gk-slab.is-focus::before{background:linear-gradient(90deg,#8af7d2,var(--gk-mint));border-color:var(--gk-mint);',
  'box-shadow:0 0 0 1px rgba(var(--gk-mint-rgb),.35),0 10px 30px rgba(var(--gk-mint-rgb),.22)}',
  '.gk-slab.is-focus::after{transform:skewX(-14deg) scaleY(1)}',
  '.gk-slab:active{transform:translateX(12px) scale(.985)}',
  '.gk-slab[disabled]{opacity:.38;cursor:default}',
  '.gk-slab__n{font:600 .46em/1 var(--gk-mono);font-style:normal;letter-spacing:.12em;color:var(--gk-dim);transition:color .14s ease}',
  '.gk-slab__label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:.1em}',
  '.gk-slab__hint{font:500 .44em/1 var(--gk-mono);font-style:normal;letter-spacing:.14em;color:var(--gk-muted);white-space:nowrap;transition:color .14s ease}',
  '.gk-slab__chev{width:.9em;height:.9em;opacity:0;transform:translateX(-6px);transition:opacity .14s ease,transform .18s ease}',
  '.gk-slab__chev svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-slab.is-focus .gk-slab__n{color:rgba(3,19,13,.55)}',
  '.gk-slab.is-focus .gk-slab__hint{color:rgba(3,19,13,.72)}',
  '.gk-slab.is-focus .gk-slab__chev{opacity:1;transform:none}',
  '.gk-slab__badge{position:absolute;right:-6px;top:-8px;font:700 9px/1 var(--gk-mono);font-style:normal;letter-spacing:.12em;padding:4px 6px;border-radius:4px;',
  'background:var(--gk-gold);color:#2a1d00;transform:skewX(-10deg)}',
  '.gk-row-actions{display:flex;flex-wrap:wrap;gap:clamp(8px,2cqw,16px);margin-top:auto;padding-top:clamp(8px,2.5cqh,18px)}',
  '.gk-row-actions .gk-slab{width:auto;min-width:clamp(120px,19cqw,210px);font-size:clamp(14px,4.2cqh,22px)}',
  '.gk-row-actions .gk-slab.is-focus{transform:translateY(-3px)}',
  '.gk-row-actions .gk-slab::after{display:none}',
  '.gk-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}',
  '.gk-backbtn{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px 0 10px;margin:0;cursor:pointer;',
  'font:600 11px/1 var(--gk-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--gk-muted);background:rgba(255,255,255,.04);',
  'border:1px solid rgba(255,255,255,.1);border-radius:999px;transition:color .14s ease,border-color .14s ease;-webkit-appearance:none;appearance:none}',
  '.gk-backbtn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-backbtn:hover,.gk-backbtn.is-focus{color:var(--gk-mint);border-color:rgba(var(--gk-mint-rgb),.7);outline:none}',
  '.gk-cards{display:flex;gap:clamp(10px,2.2cqw,22px);margin:clamp(8px,2.6cqh,22px) calc(-1 * clamp(16px,4cqw,48px)) 0;',
  'padding:clamp(10px,2.6cqh,18px) clamp(16px,4cqw,48px) clamp(14px,3.4cqh,24px);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;',
  'scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;flex:1 1 auto;align-items:stretch;min-height:0}',
  '.gk-cards::-webkit-scrollbar{display:none}',
  '.gk-cards{-webkit-mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 7cqw),transparent);mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 7cqw),transparent)}',
  '.gk-card{position:relative;flex:0 0 auto;width:clamp(168px,25.5cqw,290px);min-height:0;max-height:clamp(160px,58cqh,360px);padding:0;margin:0;border:0;',
  'border-radius:16px;overflow:hidden;cursor:pointer;color:var(--gk-fg);text-align:left;font:inherit;background:#0a1013;scroll-snap-align:center;',
  'box-shadow:0 0 0 1px rgba(255,255,255,.09),0 14px 34px rgba(0,0,0,.5);outline:none;-webkit-appearance:none;appearance:none;',
  'transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .2s ease,opacity .2s ease;touch-action:manipulation}',
  '.gk-card__art{position:absolute;inset:0;background-size:cover;background-position:center;transform:scale(1.02);transition:transform .5s cubic-bezier(.2,.8,.2,1)}',
  '.gk-card__lines{position:absolute;inset:0;opacity:.55;background:repeating-linear-gradient(115deg,transparent 0 22px,rgba(255,255,255,.05) 22px 23px)}',
  '.gk-card__big{position:absolute;right:-.06em;top:-.16em;font-size:clamp(70px,26cqh,170px);font-weight:900;font-style:italic;line-height:1;',
  'color:rgba(255,255,255,.07);letter-spacing:-.04em}',
  '.gk-card__shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,6,8,.1) 0%,rgba(3,6,8,.15) 38%,rgba(3,6,8,.9) 74%,rgba(3,6,8,.97) 100%)}',
  '.gk-card__tag{position:absolute;top:12px;left:12px;font:700 10px/1 var(--gk-mono);letter-spacing:.16em;padding:5px 8px;border-radius:4px;',
  'background:rgba(3,6,8,.6);border:1px solid rgba(255,255,255,.14);color:var(--gk-fg)}',
  '.gk-card__body{position:absolute;left:clamp(10px,1.8cqw,16px);right:clamp(10px,1.8cqw,16px);bottom:clamp(10px,2.4cqh,16px);display:flex;flex-direction:column;gap:clamp(3px,1cqh,7px)}',
  '.gk-card__name{font-size:clamp(16px,5.2cqh,28px);font-weight:900;font-style:italic;text-transform:uppercase;line-height:.98;letter-spacing:-.005em;text-shadow:0 2px 14px rgba(0,0,0,.6)}',
  '.gk-card__meta{font:500 clamp(8.5px,2.3cqh,11px)/1.3 var(--gk-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--gk-muted)}',
  '.gk-card__best{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:clamp(2px,.8cqh,6px);padding-top:clamp(5px,1.4cqh,9px);',
  'border-top:1px solid rgba(255,255,255,.12);font:600 clamp(10px,2.8cqh,13px)/1 var(--gk-mono);font-variant-numeric:tabular-nums}',
  '.gk-card__best span:first-child{color:var(--gk-muted);font-weight:500;letter-spacing:.14em;font-size:.82em;text-transform:uppercase}',
  '.gk-card__best b{display:inline-flex;align-items:center;gap:7px;font-weight:600;color:var(--gk-fg)}',
  '.gk-card.is-focus{transform:translateY(-6px);box-shadow:0 0 0 2px var(--gk-mint),0 0 34px rgba(var(--gk-mint-rgb),.32),0 20px 44px rgba(0,0,0,.55)}',
  '.gk-card.is-focus .gk-card__art{transform:scale(1.08)}',
  '.gk-card.is-locked{opacity:.55}',
  '.gk-card__lock{position:absolute;top:12px;right:12px;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(3,6,8,.66);border:1px solid rgba(255,255,255,.16)}',
  '.gk-card__lock svg{width:14px;height:14px;fill:none;stroke:var(--gk-fg);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-card.is-shake{animation:gk-shake .32s ease}',
  '@keyframes gk-shake{20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}',
  '.gk-pip{flex:0 0 auto;width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.25)}',
  '.gk-pip--gold{background:radial-gradient(circle at 35% 30%,#fff7cf 0%,#f2c94c 40%,#9b7413 100%);box-shadow:0 0 10px rgba(242,201,76,.55)}',
  '.gk-pip--silver{background:radial-gradient(circle at 35% 30%,#ffffff 0%,#cfd6e0 42%,#7c8594 100%);box-shadow:0 0 10px rgba(207,214,224,.4)}',
  '.gk-pip--bronze{background:radial-gradient(circle at 35% 30%,#ffe0c2 0%,#d9925a 42%,#7d4519 100%);box-shadow:0 0 10px rgba(217,146,90,.4)}',
  '.gk-pip--none{background:none;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.22)}',
  '.gk-tiles{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:clamp(10px,2.2cqw,22px);margin-top:clamp(10px,4cqh,32px);flex:1 1 auto;max-height:clamp(150px,56cqh,360px)}',
  '.gk-tile{position:relative;display:flex;flex-direction:column;justify-content:flex-end;gap:clamp(4px,1.2cqh,10px);padding:clamp(12px,3cqh,24px) clamp(12px,2cqw,22px);',
  'margin:0;border:0;border-radius:16px;overflow:hidden;cursor:pointer;text-align:left;color:var(--gk-fg);font:inherit;outline:none;-webkit-appearance:none;appearance:none;',
  'background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.015) 60%),rgba(6,11,14,.78);box-shadow:0 0 0 1px rgba(255,255,255,.08),0 14px 34px rgba(0,0,0,.45);',
  'transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .2s ease;touch-action:manipulation}',
  '.gk-tile__glyph{position:absolute;top:clamp(10px,3cqh,22px);right:clamp(10px,2cqw,20px);width:clamp(34px,13cqh,74px);height:clamp(34px,13cqh,74px);color:rgba(var(--gk-mint-rgb),.85)}',
  '.gk-tile__glyph svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-tile__n{position:absolute;top:clamp(10px,3cqh,22px);left:clamp(12px,2cqw,22px);font:600 11px/1 var(--gk-mono);letter-spacing:.16em;color:var(--gk-dim)}',
  '.gk-tile__label{font-size:clamp(18px,6.2cqh,34px);font-weight:900;font-style:italic;text-transform:uppercase;line-height:.95}',
  '.gk-tile__desc{font:500 clamp(9.5px,2.6cqh,12.5px)/1.45 var(--gk-mono);letter-spacing:.04em;color:var(--gk-muted);max-width:34ch}',
  '.gk-tile.is-focus{transform:translateY(-6px);box-shadow:0 0 0 2px var(--gk-mint),0 0 34px rgba(var(--gk-mint-rgb),.3),0 20px 44px rgba(0,0,0,.55)}',
  '.gk-tile.is-focus .gk-tile__label{color:var(--gk-mint)}',
  '.gk-settings{display:grid;grid-template-columns:minmax(0,1fr);width:min(100%,clamp(420px,62cqw,780px));align-content:start;',
  'gap:clamp(5px,1.4cqh,10px) clamp(10px,2.4cqw,22px);margin-top:clamp(10px,3cqh,24px);overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;',
  'padding:4px 6px 18px 4px;scrollbar-width:thin;scrollbar-color:rgba(var(--gk-mint-rgb),.35) transparent;',
  '-webkit-mask-image:linear-gradient(180deg,#000 0,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(180deg,#000 0,#000 calc(100% - 22px),transparent)}',
  '.gk-srow{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;min-height:clamp(40px,10.6cqh,54px);padding:0 clamp(10px,1.6cqw,16px);',
  'margin:0;border-radius:10px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);color:var(--gk-fg);font:inherit;text-align:left;cursor:pointer;',
  'outline:none;transition:background .14s ease,border-color .14s ease,box-shadow .14s ease;-webkit-appearance:none;appearance:none;touch-action:manipulation}',
  '.gk-srow.is-focus{background:rgba(var(--gk-mint-rgb),.09);border-color:rgba(var(--gk-mint-rgb),.7);box-shadow:inset 3px 0 0 var(--gk-mint)}',
  '.gk-srow__label{font-size:clamp(12px,3.5cqh,16px);font-weight:700;letter-spacing:.01em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.gk-srow__label small{display:block;margin-top:2px;font:500 .68em/1.2 var(--gk-mono);letter-spacing:.06em;text-transform:none;color:var(--gk-muted);white-space:normal}',
  '.gk-shead{grid-column:1/-1;margin:clamp(4px,1.4cqh,10px) 0 0;font:600 clamp(9px,2.4cqh,11px)/1 var(--gk-mono);letter-spacing:.22em;text-transform:uppercase;color:var(--gk-mint)}',
  '.gk-slider{position:relative;width:clamp(96px,17cqw,190px);height:28px;display:flex;align-items:center;gap:10px;touch-action:none}',
  '.gk-slider__track{position:relative;flex:1 1 auto;height:6px;border-radius:3px;background:rgba(255,255,255,.1)}',
  '.gk-slider__fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,rgba(var(--gk-mint-rgb),.55),var(--gk-mint))}',
  '.gk-slider__thumb{position:absolute;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#eafff8;box-shadow:0 0 0 3px rgba(var(--gk-mint-rgb),.35),0 2px 6px rgba(0,0,0,.5)}',
  '.gk-slider__val{min-width:3.4em;text-align:right;font:600 12px/1 var(--gk-mono);font-variant-numeric:tabular-nums;color:var(--gk-mint)}',
  '.gk-toggle{position:relative;width:48px;height:26px;border-radius:13px;background:rgba(255,255,255,.12);transition:background .16s ease;flex:0 0 auto}',
  '.gk-toggle::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#cfdcd8;transition:transform .18s cubic-bezier(.2,.8,.2,1),background .16s ease}',
  '.gk-toggle.is-on{background:rgba(var(--gk-mint-rgb),.85)}',
  '.gk-toggle.is-on::after{transform:translateX(22px);background:#03130d}',
  '.gk-choice{display:flex;align-items:center;gap:6px;font:700 clamp(11px,3.1cqh,14px)/1 var(--gk-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--gk-mint)}',
  '.gk-choice__arrow{width:24px;height:24px;display:grid;place-items:center;border-radius:6px;color:var(--gk-muted);transition:color .12s ease,background .12s ease}',
  '.gk-choice__arrow svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-srow.is-focus .gk-choice__arrow{color:var(--gk-fg);background:rgba(255,255,255,.06)}',
  '.gk-choice__val{min-width:6.5em;text-align:center;white-space:nowrap}',
  '.gk-actionmark{font:600 11px/1 var(--gk-mono);letter-spacing:.14em;color:var(--gk-mint)}',
  '.gk-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;text-align:center;',
  'gap:clamp(6px,1.6cqh,12px);padding:clamp(16px,5cqh,40px) clamp(20px,5cqw,56px);border-radius:20px;min-width:min(86cqw,360px);max-width:92cqw;max-height:92cqh;',
  'background:linear-gradient(180deg,rgba(14,22,26,.94),rgba(6,10,13,.95));box-shadow:0 0 0 1px rgba(255,255,255,.09),0 30px 80px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06)}',
  '.gk-panel .gk-kicker{justify-content:center}',
  '.gk-panel .gk-title::after{margin-left:auto;margin-right:auto}',
  '.gk-panel .gk-list{align-items:center;margin-top:clamp(8px,3cqh,22px);padding-left:0}',
  '.gk-panel .gk-slab{width:clamp(200px,30cqw,320px)}',
  '.gk-panel .gk-slab.is-focus{transform:scale(1.02)}',
  '.gk-panel .gk-slab::after{display:none}',
  '.gk-panel__text{margin:0;max-width:44ch;font:500 clamp(11px,3cqh,14px)/1.55 var(--gk-mono);color:var(--gk-muted)}',
  '.gk-res{position:relative;flex:1 1 auto;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);align-items:center;gap:clamp(10px,3cqw,40px);min-height:0}',
  '.gk-res__left{display:flex;flex-direction:column;min-width:0}',
  '.gk-res__course{margin:clamp(4px,1.2cqh,10px) 0 0;font:600 clamp(10px,2.8cqh,13px)/1.2 var(--gk-mono);letter-spacing:.2em;text-transform:uppercase;color:var(--gk-muted)}',
  '.gk-res__time{margin:clamp(6px,2.2cqh,18px) 0 0;font:700 clamp(36px,15cqh,108px)/.9 var(--gk-mono);font-variant-numeric:tabular-nums;letter-spacing:-.04em;color:#fff;',
  'text-shadow:0 0 30px rgba(var(--gk-mint-rgb),.25),0 4px 30px rgba(0,0,0,.5)}',
  '.gk-res__time.is-final{animation:gk-flash .5s ease}',
  '@keyframes gk-flash{0%{color:var(--gk-mint);text-shadow:0 0 40px rgba(var(--gk-mint-rgb),.9)}100%{color:#fff}}',
  '.gk-res__meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin-top:clamp(6px,2cqh,14px);font:600 clamp(11px,3.1cqh,15px)/1 var(--gk-mono);font-variant-numeric:tabular-nums}',
  '.gk-delta--good{color:var(--gk-mint)}.gk-delta--bad{color:#ffb86b}',
  '.gk-pos{display:inline-flex;align-items:baseline;gap:6px;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}',
  '.gk-pos b{font-size:1.25em;color:#fff;font-style:italic}',
  '.gk-flair{display:inline-block;padding:6px 10px;border-radius:4px;background:var(--gk-mint);color:var(--gk-ink);font:800 clamp(10px,2.8cqh,13px)/1 var(--gk-display);',
  'font-style:italic;letter-spacing:.06em;text-transform:uppercase;transform:skewX(-10deg) scale(0);opacity:0}',
  '.gk-res.is-revealed .gk-flair{animation:gk-stamp .42s cubic-bezier(.2,1.6,.4,1) .25s both}',
  '@keyframes gk-stamp{0%{transform:skewX(-10deg) scale(1.8) rotate(-6deg);opacity:0}100%{transform:skewX(-10deg) scale(1) rotate(-3deg);opacity:1}}',
  '.gk-splits{display:grid;grid-template-columns:auto auto;justify-content:start;gap:3px 22px;margin-top:clamp(8px,2.6cqh,18px);font:500 clamp(9.5px,2.6cqh,12px)/1.3 var(--gk-mono);font-variant-numeric:tabular-nums}',
  '.gk-splits span:nth-child(odd){color:var(--gk-muted);letter-spacing:.12em;text-transform:uppercase}',
  '.gk-medal{position:relative;justify-self:center;display:flex;flex-direction:column;align-items:center;gap:clamp(6px,2cqh,14px)}',
  '.gk-medal__rays{position:absolute;left:50%;top:calc(var(--gk-md) / 2);width:calc(var(--gk-md) * 2.6);height:calc(var(--gk-md) * 2.6);margin:calc(var(--gk-md) * -1.3) 0 0 calc(var(--gk-md) * -1.3);',
  'border-radius:50%;opacity:0;background:repeating-conic-gradient(from 0deg,rgba(var(--gk-medal-rgb),.22) 0deg 7deg,transparent 7deg 22deg);',
  '-webkit-mask-image:radial-gradient(circle,#000 18%,transparent 68%);mask-image:radial-gradient(circle,#000 18%,transparent 68%)}',
  '.gk-medal__disc{position:relative;width:var(--gk-md);height:var(--gk-md);border-radius:50%;overflow:hidden;opacity:0;transform:scale(2.2) rotate(-24deg);',
  'background:radial-gradient(circle at 34% 28%,var(--gk-m1) 0%,var(--gk-m2) 38%,var(--gk-m3) 78%,var(--gk-m4) 100%);',
  'box-shadow:0 0 0 calc(var(--gk-md) * .045) rgba(255,255,255,.18),inset 0 0 0 calc(var(--gk-md) * .07) rgba(0,0,0,.18),inset 0 calc(var(--gk-md) * -.04) calc(var(--gk-md) * .12) rgba(0,0,0,.3),0 14px 40px rgba(0,0,0,.55)}',
  '.gk-medal__disc svg{position:absolute;inset:22%;width:56%;height:56%;fill:rgba(255,255,255,.28);stroke:rgba(0,0,0,.22);stroke-width:.8}',
  '.gk-medal__disc::after{content:"";position:absolute;top:-20%;bottom:-20%;left:-60%;width:40%;transform:rotate(18deg) translateX(-120%);',
  'background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent)}',
  '.gk-medal__ring{position:absolute;left:50%;top:calc(var(--gk-md) / 2);width:var(--gk-md);height:var(--gk-md);margin:calc(var(--gk-md) / -2) 0 0 calc(var(--gk-md) / -2);',
  'border-radius:50%;border:3px solid rgba(var(--gk-medal-rgb),.9);opacity:0;pointer-events:none}',
  '.gk-medal__label{font:900 clamp(16px,5.4cqh,30px)/1 var(--gk-display);font-style:italic;letter-spacing:.06em;text-transform:uppercase;color:rgb(var(--gk-medal-rgb));',
  'opacity:0;transform:translateY(10px);text-shadow:0 0 22px rgba(var(--gk-medal-rgb),.45)}',
  '.gk-medal{--gk-md:clamp(84px,32cqh,200px);--gk-medal-rgb:150,165,160;--gk-m1:#e6eeec;--gk-m2:#9aa9a6;--gk-m3:#56625f;--gk-m4:#2c3432}',
  '.gk-medal--gold{--gk-medal-rgb:242,201,76;--gk-m1:#fff8d6;--gk-m2:#f4cd52;--gk-m3:#c08f1c;--gk-m4:#6e4f08}',
  '.gk-medal--silver{--gk-medal-rgb:214,222,232;--gk-m1:#ffffff;--gk-m2:#d5dce6;--gk-m3:#8e98a8;--gk-m4:#4b5260}',
  '.gk-medal--bronze{--gk-medal-rgb:224,150,92;--gk-m1:#ffe3c8;--gk-m2:#e0965c;--gk-m3:#9a5420;--gk-m4:#4e2909}',
  '.gk-res.is-revealed .gk-medal__disc{animation:gk-medal-in .62s cubic-bezier(.18,1.35,.4,1) both}',
  '.gk-res.is-revealed .gk-medal__disc::after{animation:gk-shine 1.1s ease .5s both}',
  '.gk-res.is-revealed .gk-medal__ring{animation:gk-ring .9s ease-out .22s both}',
  '.gk-res.is-revealed .gk-medal__rays{animation:gk-rays-in .8s ease .3s both,gk-spin 26s linear infinite}',
  '.gk-res.is-revealed .gk-medal__label{animation:gk-up .4s cubic-bezier(.2,.8,.2,1) .4s both}',
  '.gk-medal--none .gk-medal__rays,.gk-medal--none .gk-medal__ring{display:none}',
  '@keyframes gk-medal-in{0%{opacity:0;transform:scale(2.2) rotate(-24deg)}60%{opacity:1;transform:scale(.94) rotate(4deg)}100%{opacity:1;transform:scale(1) rotate(0)}}',
  '@keyframes gk-shine{0%{transform:rotate(18deg) translateX(-120%)}100%{transform:rotate(18deg) translateX(520%)}}',
  '@keyframes gk-ring{0%{opacity:.9;transform:scale(.9)}100%{opacity:0;transform:scale(2.1)}}',
  '@keyframes gk-rays-in{0%{opacity:0}100%{opacity:1}}',
  '@keyframes gk-spin{to{rotate:360deg}}',
  '@keyframes gk-up{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}',
  '.gk-foot{position:absolute;left:calc(var(--gk-safe-l) + clamp(16px,4.4cqw,56px));bottom:calc(var(--gk-safe-b) + clamp(8px,2.6cqh,20px));display:flex;gap:16px;',
  'font:600 10px/1 var(--gk-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--gk-dim);pointer-events:none}',
  '.gk-foot[hidden]{display:none}',
  '.gk-foot span{display:inline-flex;align-items:center;gap:6px}',
  '.gk-kbd svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-screen.has-foot .gk-pane{padding-bottom:calc(var(--gk-safe-b) + clamp(10px,3.6cqh,30px) + 26px)}',
  '.gk-kbd{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:5px;border:1px solid rgba(255,255,255,.18);',
  'background:rgba(255,255,255,.05);color:var(--gk-fg);font:600 10px/1 var(--gk-mono);letter-spacing:0}',
  '.gk-kbd--round{border-radius:50%;width:20px;padding:0}',
  '.gk-enter{animation:gk-enter .34s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--gk-i,0) * 40ms)}',
  '@keyframes gk-enter{0%{opacity:0;transform:translateX(-18px)}100%{opacity:1;transform:none}}',
  '.gk-enter-up{animation:gk-enter-up .36s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--gk-i,0) * 45ms)}',
  '@keyframes gk-enter-up{0%{opacity:0;transform:translateY(16px)}100%{opacity:1;transform:none}}',
  '.gk-count{position:absolute;inset:0;z-index:36;display:grid;place-items:center;pointer-events:none;container-type:size}',
  '.gk-count[hidden]{display:none}',
  '.gk-count__n{font:900 clamp(70px,36cqh,250px)/1 var(--gk-display);font-style:italic;color:#fff;letter-spacing:-.04em;',
  'text-shadow:0 0 50px rgba(var(--gk-mint-rgb),.55),0 8px 40px rgba(0,0,0,.6);animation:gk-count .95s cubic-bezier(.2,.9,.25,1) both}',
  '.gk-count__n.is-go{color:var(--gk-mint);font-size:clamp(80px,40cqh,280px);text-shadow:0 0 60px rgba(var(--gk-mint-rgb),.8),0 8px 40px rgba(0,0,0,.6);animation:gk-go 1s cubic-bezier(.2,.9,.25,1) both}',
  '@keyframes gk-count{0%{opacity:0;transform:scale(1.9)}16%{opacity:1;transform:scale(1)}72%{opacity:1;transform:scale(.94)}100%{opacity:0;transform:scale(.82)}}',
  '@keyframes gk-go{0%{opacity:0;transform:scale(.5)}18%{opacity:1;transform:scale(1.08)}30%{transform:scale(1)}75%{opacity:1}100%{opacity:0;transform:scale(1.35)}}',
  '.gk-toast{position:absolute;left:50%;top:calc(var(--gk-safe-t) + 16px);z-index:44;max-width:min(80%,520px);padding:10px 16px 10px 14px;border-radius:12px;',
  'display:flex;align-items:center;gap:10px;font:600 12px/1.35 var(--gk-mono);letter-spacing:.06em;color:var(--gk-fg);',
  'background:rgba(6,11,14,.92);border:1px solid rgba(var(--gk-mint-rgb),.35);box-shadow:0 10px 30px rgba(0,0,0,.45);',
  'opacity:0;transform:translate(-50%,-14px);transition:opacity .2s ease,transform .26s cubic-bezier(.2,.8,.2,1);pointer-events:none}',
  '.gk-toast::before{content:"";flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--gk-mint);box-shadow:0 0 10px rgba(var(--gk-mint-rgb),.8)}',
  '.gk-toast--warn{border-color:rgba(255,184,107,.5)}.gk-toast--warn::before{background:#ffb86b;box-shadow:0 0 10px rgba(255,184,107,.8)}',
  '.gk-toast.is-on{opacity:1;transform:translate(-50%,0)}',
  '.gk-splash{position:absolute;left:50%;top:calc(var(--gk-safe-t) + 21%);z-index:34;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0;',
  'pointer-events:none;text-align:center;white-space:nowrap}',
  '.gk-splash__t{font:900 clamp(22px,8cqh,46px)/1 var(--gk-display);font-style:italic;letter-spacing:-.01em;text-transform:uppercase;color:#fff;',
  'text-shadow:0 0 24px rgba(255,255,255,.25),0 3px 18px rgba(0,0,0,.7);font-variant-numeric:tabular-nums}',
  '.gk-splash__s{font:600 clamp(9px,2.6cqh,12px)/1 var(--gk-mono);letter-spacing:.2em;text-transform:uppercase;color:rgba(234,243,240,.75);text-shadow:0 1px 6px rgba(0,0,0,.8)}',
  '.gk-splash--good .gk-splash__t{color:var(--gk-mint);text-shadow:0 0 26px rgba(var(--gk-mint-rgb),.55),0 3px 18px rgba(0,0,0,.7)}',
  '.gk-splash--bad .gk-splash__t{color:#ffb86b;text-shadow:0 0 26px rgba(255,184,107,.45),0 3px 18px rgba(0,0,0,.7)}',
  '.gk-splash.is-on{animation:gk-splash var(--gk-splash-ms,1400ms) cubic-bezier(.2,.9,.25,1) both}',
  '@keyframes gk-splash{0%{opacity:0;transform:translateX(-50%) scale(1.35)}10%{opacity:1;transform:translateX(-50%) scale(1)}80%{opacity:1;transform:translateX(-50%) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-10px) scale(.96)}}',
  '.gk-loading{position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(10px,3cqh,20px);',
  'background:radial-gradient(ellipse at 50% 40%,#0c171a 0%,#04070a 70%);transition:opacity .3s ease;pointer-events:auto;container-type:size}',
  '.gk-loading.is-out{opacity:0;pointer-events:none}',
  '.gk-loading__art{position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;transition:opacity .6s ease}',
  '.gk-loading__art.is-loaded{opacity:.42}',
  '.gk-loading__art::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,rgba(4,7,10,.35) 0%,rgba(4,7,10,.92) 75%)}',
  '.gk-loading__inner{position:relative;display:flex;flex-direction:column;align-items:center;gap:clamp(8px,2.4cqh,16px)}',
  '.gk-loading .gk-kicker{margin:0}',
  '.gk-loading__title{font:900 clamp(26px,11cqh,72px)/.95 var(--gk-display);font-style:italic;text-transform:uppercase;letter-spacing:-.015em;color:#f5fbf9;text-align:center;text-shadow:0 4px 30px rgba(0,0,0,.6)}',
  '.gk-loading__title:empty{display:none}',
  '.gk-loading__tip{max-width:min(46ch,80cqw);margin:clamp(4px,2cqh,14px) 0 0;text-align:center;font:500 clamp(10px,2.8cqh,12.5px)/1.5 var(--gk-mono);color:var(--gk-muted)}',
  '.gk-loading__tip:empty{display:none}',
  '.gk-loading__bar i::after{content:"";position:absolute;top:0;bottom:0;width:60px;right:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent);animation:gk-shimmer 1.1s ease-in-out infinite}',
  '@keyframes gk-shimmer{0%{opacity:0;transform:translateX(-80px)}50%{opacity:1}100%{opacity:0;transform:translateX(0)}}',
  '.gk-loading__bar{position:relative;width:clamp(180px,34cqw,360px);height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}',
  '.gk-loading__bar i{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:2px;background:linear-gradient(90deg,rgba(var(--gk-mint-rgb),.4),var(--gk-mint));',
  'box-shadow:0 0 12px rgba(var(--gk-mint-rgb),.7);transition:width .25s ease}',
  '.gk-loading__meta{display:flex;justify-content:space-between;width:clamp(180px,34cqw,360px);font:600 10px/1 var(--gk-mono);letter-spacing:.18em;text-transform:uppercase;color:var(--gk-muted)}',
  '.gk-loading__meta b{color:var(--gk-mint);font-variant-numeric:tabular-nums}',
  '.gk-ask{position:absolute;inset:0;z-index:46;pointer-events:auto;container-type:size}',
  '.gk-rotate{position:absolute;inset:0;z-index:48;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto;',
  'background:radial-gradient(ellipse at 50% 45%,rgba(8,16,18,.9) 0%,rgba(3,6,8,.96) 70%);font-family:var(--gk-display);color:var(--gk-fg);text-align:center}',
  '.gk-rotate[hidden]{display:none}',
  '.gk-rotate__card{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:280px}',
  '.gk-rotate__icon{width:72px;height:72px;color:var(--gk-mint);animation:gk-rot 2.6s cubic-bezier(.6,0,.3,1) infinite}',
  '.gk-rotate__icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
  '@keyframes gk-rot{0%,18%{transform:rotate(0)}48%,78%{transform:rotate(-90deg)}100%{transform:rotate(0)}}',
  '.gk-rotate__text{margin:0;font-size:20px;font-weight:800;font-style:italic;text-transform:uppercase;line-height:1.1;letter-spacing:.01em}',
  '.gk-rotate__sub{margin:0;font:500 11px/1.4 var(--gk-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--gk-muted)}',
  '@media (prefers-reduced-motion: reduce){.gk-rotate__icon{animation:none;transform:rotate(-90deg)}}',
  '.gk-ask .gk-bg{background:rgba(3,6,8,.82)}',
  '.gk-ask .gk-panel{background:linear-gradient(180deg,#0e171b,#070c0f);box-shadow:0 0 0 1px rgba(var(--gk-mint-rgb),.22),0 30px 80px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.06)}',
  '.gk-ask .gk-title::after{margin-left:auto;margin-right:auto}',
  '.gk-ask .gk-row-actions{justify-content:center;margin-top:clamp(8px,3cqh,20px)}',
  '@container (orientation: portrait){',
  '.gk-slab{width:min(100%,88cqw);height:clamp(42px,6.4cqh,56px);font-size:clamp(16px,5.4cqw,24px)}',
  '.gk-slab__hint{display:none}',
  '.gk-title{font-size:clamp(28px,12.5cqw,64px)}',
  '.gk-title--md{font-size:clamp(24px,9.5cqw,48px)}',
  '.gk-art{width:100%;opacity:.5}',
  '.gk-tiles{grid-auto-flow:row;grid-auto-rows:minmax(0,1fr);max-height:none}',
  '.gk-card{width:72cqw;max-height:62cqh}',
  '.gk-res{grid-template-columns:1fr;align-content:start}',
  '.gk-res__time{font-size:clamp(32px,16cqw,96px)}',
  '.gk-loading__title{font-size:clamp(24px,11cqw,56px)}',
  '.gk-medal{--gk-md:clamp(84px,30cqw,160px);grid-row:1}',
  '.gk-row-actions{flex-direction:column;align-items:stretch}',
  '.gk-row-actions .gk-slab{width:100%}',
  '.gk-head{flex-direction:column-reverse;align-items:flex-start}',
  '}',
  '@media (prefers-reduced-motion: reduce){.gk-enter,.gk-enter-up{animation:none}.gk-slab,.gk-card,.gk-tile{transition:none}',
  '.gk-res.is-revealed .gk-medal__disc,.gk-res.is-revealed .gk-medal__label,.gk-res.is-revealed .gk-flair{animation:none;opacity:1;transform:none}',
  '.gk-res.is-revealed .gk-medal__rays{animation:none;opacity:1}.gk-count__n{animation-duration:.01s}}'
].join('');

const SVG = {
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5L15.5 12 8 19.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13"/></svg>',
  fs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  fsExit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
  phone: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="5" width="18" height="38" rx="3.5"/><path d="M21 9h6M22.5 38h3"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>',
  updown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9l5-5 5 5M7 15l5 5 5-5"/></svg>',
  leftright: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 6.1 6.65.75-4.95 4.55 1.35 6.6L12 17.3l-5.9 3.3 1.35-6.6L2.5 9.45l6.65-.75z"/></svg>',
  flag: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 44V6"/><path d="M10 7h26l-5 8 5 8H10"/><path d="M17 7v16M24 7v16M31 7v16" opacity=".5"/></svg>',
  orbit: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="6"/><ellipse cx="24" cy="24" rx="19" ry="8" transform="rotate(-24 24 24)"/><circle cx="40" cy="15" r="2.2"/></svg>',
  clock: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="26" r="16"/><path d="M24 26V16M24 26l7 5M19 5h10M24 5v5"/></svg>',
  bolt: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M27 4L11 27h12l-3 17 17-24H25z"/></svg>',
  ghost: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 42V22a14 14 0 0 1 28 0v20l-5-4-5 4-4-4-4 4-5-4z"/><circle cx="19" cy="22" r="2"/><circle cx="29" cy="22" r="2"/></svg>',
  trophy: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 6h18v12a9 9 0 0 1-18 0z"/><path d="M15 10H8a7 7 0 0 0 7 9M33 10h7a7 7 0 0 1-7 9M24 27v8M16 42h16M18 35h12v7H18z"/></svg>',
  gear: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="6"/><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.2 4.2M33.2 33.2l4.2 4.2M10.6 37.4l4.2-4.2M33.2 14.8l4.2-4.2"/></svg>'
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
  });
}

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

function coarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
}

function isIPhoneUA() {
  try { return /iPhone|iPod/.test(navigator.userAgent || ''); } catch (_) { return false; }
}

function fullscreenSupported(el) {
  if (isIPhoneUA()) return false;
  try {
    const enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    return !!enabled && !!(el.requestFullscreen || el.webkitRequestFullscreen);
  } catch (_) {
    return false;
  }
}

function fullscreenElement() {
  try { return document.fullscreenElement || document.webkitFullscreenElement || null; } catch (_) { return null; }
}

function hashHue(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

const KIT_I18N_MAP = {
  input: {
    gas: 'input_gas', brake: 'input_brake', drift: 'input_drift', nitro: 'input_nitro', camera: 'input_camera', mode: 'input_mode',
    reset: 'input_reset', lookBack: 'input_look_back', steerLeft: 'input_steer_left', steerRight: 'input_steer_right',
    wheel: 'input_wheel', steer: 'input_steer', throttleYaw: 'input_throttle_yaw', pitchRoll: 'input_pitch_roll'
  },
  ui: {
    back: 'ui_back', select: 'ui_select', move: 'ui_move', confirm: 'ui_confirm', cancel: 'ui_cancel', go: 'ui_go',
    loading: 'ui_loading', best: 'ui_best', locked: 'ui_locked', newBest: 'ui_new_best', on: 'ui_on', off: 'ui_off',
    pause: 'ui_pause', fullscreen: 'ui_fullscreen', exitFullscreen: 'ui_exit_fullscreen', position: 'ui_position', time: 'ui_time',
    rotate: 'ui_rotate', rotateDismiss: 'ui_rotate_dismiss', medalGold: 'medal_gold', medalSilver: 'medal_silver',
    medalBronze: 'medal_bronze', medalNone: 'medal_none'
  },
  tilt: { enable: 'tilt_enable', unavailable: 'tilt_unavailable', centered: 'tilt_centered' }
};

export const KIT_I18N_KEYS = (function () {
  const out = [];
  for (const g in KIT_I18N_MAP) for (const k in KIT_I18N_MAP[g]) out.push('games.kit.' + KIT_I18N_MAP[g][k]);
  return out;
})();

export function kitCopy(translate) {
  const out = { input: {}, ui: {}, tilt: {} };
  if (typeof translate !== 'function') return out;
  for (const g in KIT_I18N_MAP) {
    for (const k in KIT_I18N_MAP[g]) {
      const key = 'games.kit.' + KIT_I18N_MAP[g][k];
      let v = null;
      try { v = translate(key); } catch (_) { v = null; }
      if (typeof v === 'string' && v && v !== key) out[g][k] = v;
    }
  }
  return out;
}

export function createUI(stage, copyIn, opts = {}) {
  if (!stage) throw new Error('createUI: stage required');
  let copy = Object.assign({}, UI_COPY_DEFAULTS, copyIn || null);
  const sound = typeof opts.sound === 'function' ? opts.sound : null;
  let pauseHandler = typeof opts.onPause === 'function' ? opts.onPause : null;

  ensureStyle();
  stage.classList.add('gk-stage');
  try {
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  } catch (_) {}

  const hud = document.createElement('div');
  hud.className = 'gk-hud';
  const root = document.createElement('div');
  root.className = 'gk-ui';
  const chrome = document.createElement('div');
  chrome.className = 'gk-chrome';
  const countEl = document.createElement('div');
  countEl.className = 'gk-count';
  countEl.hidden = true;
  stage.appendChild(hud);
  stage.appendChild(root);
  stage.appendChild(countEl);
  stage.appendChild(chrome);

  const rotateEl = document.createElement('div');
  rotateEl.className = 'gk-rotate';
  rotateEl.hidden = true;
  rotateEl.innerHTML = '<div class="gk-rotate__card"><span class="gk-rotate__icon">' + SVG.phone + '</span><p class="gk-rotate__text"></p><p class="gk-rotate__sub"></p></div>';
  stage.appendChild(rotateEl);
  let rotateDismissed = false;
  let rotatePortrait = false;
  const rotateEnabled = opts.rotateHint !== false;
  function syncRotateText() {
    rotateEl.querySelector('.gk-rotate__text').textContent = copy.rotate;
    rotateEl.querySelector('.gk-rotate__sub').textContent = copy.rotateDismiss;
  }
  function syncRotate() {
    if (!rotateEnabled || disposed) {
      rotateEl.hidden = true;
      return;
    }
    const r = stage.getBoundingClientRect();
    const portrait = r.height > r.width * 1.05 && coarsePointer();
    if (!portrait) rotateDismissed = false;
    rotatePortrait = portrait;
    const wasHidden = rotateEl.hidden;
    rotateEl.hidden = !portrait || rotateDismissed;
    if (wasHidden && !rotateEl.hidden) requestPause();
  }
  syncRotateText();
  rotateEl.addEventListener('click', function () {
    rotateDismissed = true;
    rotateEl.hidden = true;
  });
  let rotateRO = null;
  try {
    rotateRO = new ResizeObserver(function () { syncRotate(); });
    rotateRO.observe(stage);
  } catch (_) {}

  const fsBtn = chromeButton('fs', copy.fullscreen);
  const pauseBtn = chromeButton('pause', copy.pause);
  chrome.appendChild(fsBtn);
  chrome.appendChild(pauseBtn);
  fsBtn.hidden = !fullscreenSupported(stage);
  pauseBtn.hidden = true;
  fsBtn.addEventListener('click', toggleFullscreen);
  pauseBtn.addEventListener('click', function () { requestPause(); });

  const specs = Object.create(null);
  const lastFocus = Object.create(null);
  const slots = Object.create(null);
  let currentName = null;
  let currentEl = null;
  let focusEl = null;
  let focusIndex = 0;
  let toastEl = null;
  let toastTimer = 0;
  let loadingEl = null;
  let loadingArt = '';
  const loadingInfo = {};
  let loadingTimer = 0;
  let countValue = null;
  let countTimer = 0;
  let askEl = null;
  let askResolve = null;
  let lastMethod = coarsePointer() ? 'touch' : 'keyboard';
  let engaged = window.self !== window.top;
  let disposed = false;
  let revealTimers = [];
  let padPollRaf = 0;
  const padPrev = [];
  const padDirPrev = { up: 0, down: 0, left: 0, right: 0 };
  let chromePause = false;
  const lastPointer = { x: -9999, y: -9999 };
  let pointerAtShow = null;

  const prevPadCapture = window.mentriaPadCapture;
  try { window.mentriaPadCapture = true; } catch (_) {}

  function chromeButton(kind, text) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gk-chrome__btn gk-chrome__btn--' + kind;
    b.setAttribute('aria-label', text);
    b.title = text;
    b.innerHTML = SVG[kind] || '';
    return b;
  }

  function play(kind, index) {
    if (!sound) return;
    try { sound(kind, index || 0); } catch (_) {}
  }

  function updateChromeWidth() {
    let w = 0;
    if (!fsBtn.hidden) w += 48;
    if (!pauseBtn.hidden) w += 48;
    stage.style.setProperty('--gk-chrome-w', w + 'px');
  }

  function setChrome(o) {
    if (!o) return;
    if (o.pause != null) {
      chromePause = !!o.pause;
      pauseBtn.hidden = !chromePause || !!currentName;
    }
    if (o.fullscreen != null) fsBtn.hidden = !o.fullscreen || !fullscreenSupported(stage);
    updateChromeWidth();
  }

  function syncFsIcon() {
    const on = fullscreenElement() === stage;
    fsBtn.innerHTML = on ? SVG.fsExit : SVG.fs;
    const t = on ? copy.exitFullscreen : copy.fullscreen;
    fsBtn.setAttribute('aria-label', t);
    fsBtn.title = t;
  }

  function toggleFullscreen() {
    try {
      if (fullscreenElement()) {
        if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
      const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (!req) return;
      const p = req.call(stage, { navigationUI: 'hide' });
      const lock = function () {
        try {
          const so = window.screen && window.screen.orientation;
          if (so && so.lock) so.lock('landscape').catch(function () {});
        } catch (_) {}
      };
      if (p && typeof p.then === 'function') p.then(lock).catch(function () {});
      else lock();
    } catch (_) {}
  }

  let wasFullscreen = false;

  function onFsChange() {
    syncFsIcon();
    const now = fullscreenElement() === stage;
    if (wasFullscreen && !now && !currentName && !askEl) requestPause();
    wasFullscreen = now;
  }

  function requestPause() {
    if (currentName || !pauseHandler) return;
    try { pauseHandler(); } catch (_) {}
  }

  function hudSlot(name) {
    const key = String(name || 'tl');
    if (slots[key]) return slots[key];
    const el = document.createElement('div');
    el.className = 'gk-hud__slot gk-hud__slot--' + key;
    hud.appendChild(el);
    slots[key] = el;
    return el;
  }

  function hudStat(slotName, labelText, o) {
    const cfg = o || {};
    const el = document.createElement('div');
    el.className = 'gk-stat' + (cfg.variant ? ' gk-stat--' + String(cfg.variant).split(' ').join(' gk-stat--') : '');
    el.innerHTML = '<span class="gk-stat__k"></span><span class="gk-stat__v"><span></span><span class="gk-stat__unit"></span></span>';
    const k = el.querySelector('.gk-stat__k');
    const v = el.querySelector('.gk-stat__v > span');
    const u = el.querySelector('.gk-stat__unit');
    k.textContent = labelText || '';
    u.textContent = cfg.unit || '';
    if (!labelText) k.hidden = true;
    hudSlot(slotName).appendChild(el);
    let last = null;
    return {
      el,
      set: function (text) {
        const t = String(text == null ? '' : text);
        if (t !== last) {
          last = t;
          v.textContent = t;
        }
      },
      setLabel: function (text) {
        k.textContent = text || '';
        k.hidden = !text;
      },
      setUnit: function (text) { u.textContent = text || ''; },
      remove: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  function showHud(on) {
    hud.hidden = !on;
  }

  function setStageMenu(kind) {
    if (kind) stage.setAttribute('data-gk-menu', kind);
    else stage.removeAttribute('data-gk-menu');
    pauseBtn.hidden = !chromePause || !!kind;
    updateChromeWidth();
  }

  function navEls() {
    const scope = askEl || currentEl;
    if (!scope) return [];
    const list = scope.querySelectorAll('[data-nav]');
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el.disabled && el.getAttribute('data-nav-skip') === '1') continue;
      out.push(el);
    }
    return out;
  }

  function setFocus(el, silent) {
    if (!el) return;
    if (focusEl && focusEl !== el) focusEl.classList.remove('is-focus');
    const changed = focusEl !== el;
    focusEl = el;
    el.classList.add('is-focus');
    try { el.focus({ preventScroll: true }); } catch (_) {}
    const list = navEls();
    focusIndex = Math.max(0, list.indexOf(el));
    if (!askEl && currentName) lastFocus[currentName] = el.getAttribute('data-id') || '';
    const row = el.closest('.gk-cards');
    if (row) {
      const target = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
      try { row.scrollTo({ left: target, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) { row.scrollLeft = target; }
    }
    const scroller = el.closest('.gk-settings');
    if (scroller) {
      const top = el.offsetTop - scroller.offsetTop;
      if (top < scroller.scrollTop) scroller.scrollTop = top - 8;
      else if (top + el.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + el.offsetHeight - scroller.clientHeight + 8;
    }
    if (changed && !silent) play('move', focusIndex);
    const spec = currentName ? specs[currentName] : null;
    if (changed && spec && typeof spec.onFocus === 'function' && !askEl) {
      try { spec.onFocus(el.getAttribute('data-id'), el.__gkItem || null); } catch (_) {}
    }
  }

  function navigate(dir) {
    const list = navEls();
    if (!list.length) return;
    if (!focusEl || list.indexOf(focusEl) < 0) {
      setFocus(list[0]);
      return;
    }
    if (focusEl.getAttribute('data-kind') && (dir === 'left' || dir === 'right')) {
      if (adjustRow(focusEl, dir === 'left' ? -1 : 1)) return;
    }
    const r0 = focusEl.getBoundingClientRect();
    const cx = r0.left + r0.width / 2;
    const cy = r0.top + r0.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el === focusEl) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      let primary, secondary;
      if (dir === 'up') { primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'down') { primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'left') { primary = -dx; secondary = Math.abs(dy); }
      else { primary = dx; secondary = Math.abs(dy); }
      if (primary <= 4) continue;
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) {
      const spec = currentName ? specs[currentName] : null;
      const vertical = dir === 'up' || dir === 'down';
      const wrap = askEl ? false : spec && (spec.type === 'menu' ? vertical : spec.type === 'cards' ? !vertical : false);
      if (wrap) {
        const idx = list.indexOf(focusEl);
        const step = dir === 'up' || dir === 'left' ? -1 : 1;
        best = list[(idx + step + list.length) % list.length];
      }
    }
    if (best) setFocus(best);
  }

  function activate(el) {
    const target = el || focusEl;
    if (!target) return;
    engaged = true;
    if (askEl) {
      const v = target.getAttribute('data-id') === 'yes';
      closeAsk(v);
      return;
    }
    const spec = currentName ? specs[currentName] : null;
    if (!spec) return;
    const id = target.getAttribute('data-id');
    const item = target.__gkItem || null;
    if (target.classList.contains('gk-backbtn')) {
      back();
      return;
    }
    if (target.getAttribute('data-kind')) {
      activateRow(target);
      return;
    }
    if (target.disabled || (item && (item.locked || item.disabled))) {
      play('error');
      target.classList.remove('is-shake');
      void target.offsetWidth;
      target.classList.add('is-shake');
      return;
    }
    play('select');
    if (typeof spec.onSelect === 'function') {
      try { spec.onSelect(id, item); } catch (err) { setTimeout(function () { throw err; }); }
    }
  }

  function back() {
    if (askEl) {
      closeAsk(false);
      return;
    }
    const spec = currentName ? specs[currentName] : null;
    if (!spec || typeof spec.onBack !== 'function') return;
    play('back');
    try { spec.onBack(); } catch (err) { setTimeout(function () { throw err; }); }
  }

  function rowSpec(el) {
    const spec = currentName ? specs[currentName] : null;
    if (!spec || !spec.rows) return null;
    const id = el.getAttribute('data-id');
    for (let i = 0; i < spec.rows.length; i++) if (spec.rows[i].id === id) return spec.rows[i];
    return null;
  }

  function emitChange(row) {
    const spec = specs[currentName];
    if (spec && typeof spec.onChange === 'function') {
      try { spec.onChange(row.id, row.value, row); } catch (err) { setTimeout(function () { throw err; }); }
    }
  }

  function adjustRow(el, dir) {
    const row = rowSpec(el);
    if (!row) return false;
    if (row.kind === 'slider') {
      const step = isNum(row.step) ? row.step : 0.05;
      const min = isNum(row.min) ? row.min : 0;
      const max = isNum(row.max) ? row.max : 1;
      const v = Math.min(max, Math.max(min, Math.round(((isNum(row.value) ? row.value : min) + dir * step) / step) * step));
      if (v === row.value) return true;
      row.value = +v.toFixed(6);
      renderRowControl(el, row);
      play('move', Math.round((row.value - min) / step));
      emitChange(row);
      return true;
    }
    if (row.kind === 'choice') {
      cycleChoice(el, row, dir);
      return true;
    }
    if (row.kind === 'toggle') {
      const want = dir > 0;
      if (!!row.value !== want) {
        row.value = want;
        renderRowControl(el, row);
        play('toggle', want ? 1 : 0);
        emitChange(row);
      }
      return true;
    }
    return false;
  }

  function cycleChoice(el, row, dir) {
    const optsList = row.options || [];
    if (!optsList.length) return;
    let i = 0;
    for (let k = 0; k < optsList.length; k++) if (optsList[k].value === row.value) i = k;
    i = (i + dir + optsList.length) % optsList.length;
    row.value = optsList[i].value;
    renderRowControl(el, row);
    play('toggle', i);
    emitChange(row);
  }

  function activateRow(el) {
    const row = rowSpec(el);
    if (!row) return;
    if (row.kind === 'toggle') {
      row.value = !row.value;
      renderRowControl(el, row);
      play('toggle', row.value ? 1 : 0);
      emitChange(row);
    } else if (row.kind === 'choice') {
      cycleChoice(el, row, 1);
    } else if (row.kind === 'button') {
      play('select');
      const spec = specs[currentName];
      if (spec && typeof spec.onAction === 'function') {
        try { spec.onAction(row.id, row); } catch (err) { setTimeout(function () { throw err; }); }
      }
    }
  }

  function renderRowControl(el, row) {
    const ctl = el.querySelector('.gk-srow__ctl');
    if (!ctl) return;
    if (row.kind === 'slider') {
      const min = isNum(row.min) ? row.min : 0;
      const max = isNum(row.max) ? row.max : 1;
      const v = isNum(row.value) ? row.value : min;
      const f = max > min ? (v - min) / (max - min) : 0;
      let text;
      if (typeof row.format === 'function') text = row.format(v);
      else text = max <= 1 && min >= 0 ? Math.round(f * 100) + '%' : String(Math.round(v * 100) / 100);
      let fill = ctl.querySelector('.gk-slider__fill');
      if (!fill) {
        ctl.innerHTML = '<div class="gk-slider"><div class="gk-slider__track"><div class="gk-slider__fill"></div><div class="gk-slider__thumb"></div></div><span class="gk-slider__val"></span></div>';
        fill = ctl.querySelector('.gk-slider__fill');
        bindSlider(ctl.querySelector('.gk-slider__track'), el, row);
      }
      fill.style.width = (f * 100).toFixed(2) + '%';
      ctl.querySelector('.gk-slider__thumb').style.left = (f * 100).toFixed(2) + '%';
      ctl.querySelector('.gk-slider__val').textContent = text;
    } else if (row.kind === 'toggle') {
      ctl.innerHTML = '<span class="gk-choice"><span class="gk-choice__val" style="min-width:0"></span><span class="gk-toggle"></span></span>';
      ctl.querySelector('.gk-choice__val').textContent = row.value ? copy.on : copy.off;
      ctl.querySelector('.gk-toggle').classList.toggle('is-on', !!row.value);
      el.setAttribute('aria-pressed', row.value ? 'true' : 'false');
    } else if (row.kind === 'choice') {
      let labelText = '';
      const optsList = row.options || [];
      for (let k = 0; k < optsList.length; k++) if (optsList[k].value === row.value) labelText = optsList[k].label;
      ctl.innerHTML = '<span class="gk-choice"><span class="gk-choice__arrow" data-step="-1">' + SVG.left + '</span><span class="gk-choice__val"></span><span class="gk-choice__arrow" data-step="1">' + SVG.right + '</span></span>';
      ctl.querySelector('.gk-choice__val').textContent = labelText;
    } else if (row.kind === 'button') {
      ctl.innerHTML = '<span class="gk-actionmark"></span>';
      ctl.querySelector('.gk-actionmark').textContent = row.action || '›';
    }
  }

  function bindSlider(track, rowEl, row) {
    function setFromX(clientX) {
      const r = track.getBoundingClientRect();
      const min = isNum(row.min) ? row.min : 0;
      const max = isNum(row.max) ? row.max : 1;
      const step = isNum(row.step) ? row.step : 0.05;
      const f = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
      const v = Math.round((min + f * (max - min)) / step) * step;
      const nv = +Math.min(max, Math.max(min, v)).toFixed(6);
      if (nv !== row.value) {
        row.value = nv;
        renderRowControl(rowEl, row);
        emitChange(row);
      }
    }
    track.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setFocus(rowEl, true);
      try { track.setPointerCapture(e.pointerId); } catch (_) {}
      setFromX(e.clientX);
      const move = function (ev) { setFromX(ev.clientX); };
      const up = function () {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
        track.removeEventListener('pointercancel', up);
        play('toggle', 1);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    });
  }

  function footHtml(spec) {
    const pad = lastMethod === 'gamepad';
    const horizontal = spec.type === 'cards' || spec.type === 'tiles' || spec.type === 'results';
    let html = '<span><kbd class="gk-kbd">' + (horizontal ? SVG.leftright : SVG.updown) + '</kbd>' + esc(copy.move) + '</span>';
    html += '<span><kbd class="gk-kbd' + (pad ? ' gk-kbd--round' : '') + '">' + (pad ? 'A' : 'Enter') + '</kbd>' + esc(copy.select) + '</span>';
    if (typeof spec.onBack === 'function') html += '<span><kbd class="gk-kbd' + (pad ? ' gk-kbd--round' : '') + '">' + (pad ? 'B' : 'Esc') + '</kbd>' + esc(copy.back) + '</span>';
    return html;
  }

  function headHtml(spec, compact) {
    let h = '';
    if (spec.logo) h += '<img class="gk-logo gk-enter" alt="" src="' + esc(spec.logo) + '">';
    if (spec.kicker) h += '<p class="gk-kicker gk-enter">' + esc(spec.kicker) + '</p>';
    if (spec.title) {
      const words = String(spec.title).split(' ');
      let t = esc(words[0]);
      if (words.length > 1) t += ' <em>' + esc(words.slice(1).join(' ')) + '</em>';
      h += '<h2 class="gk-title' + (compact ? ' gk-title--md' : '') + ' gk-enter" style="--gk-i:1">' + t + '</h2>';
    }
    if (spec.subtitle) h += '<p class="gk-sub gk-enter" style="--gk-i:2">' + esc(spec.subtitle) + '</p>';
    return h;
  }

  function backBtnHtml(spec) {
    if (typeof spec.onBack !== 'function' || spec.hideBack) return '';
    return '<button type="button" class="gk-backbtn" data-nav data-id="__back">' + SVG.back + '<span>' + esc(copy.back) + '</span></button>';
  }

  function slabHtml(item, i, inRow) {
    const n = pad2(i + 1);
    return '<button type="button" class="gk-slab gk-enter' + (item.primary ? ' is-primary' : '') + '" data-nav data-id="' + esc(item.id) + '"' +
      (item.disabled ? ' disabled aria-disabled="true"' : '') + ' style="--gk-i:' + (i + 3) + '">' +
      (inRow ? '<span></span>' : '<span class="gk-slab__n">' + n + '</span>') +
      '<span class="gk-slab__label">' + esc(item.label) + '</span>' +
      '<span class="gk-slab__hint">' + esc(item.hint || '') + '</span>' +
      '<span class="gk-slab__chev">' + SVG.chev + '</span>' +
      (item.badge ? '<span class="gk-slab__badge">' + esc(item.badge) + '</span>' : '') +
      '</button>';
  }

  function medalName(m) {
    if (m === 'gold') return copy.medalGold;
    if (m === 'silver') return copy.medalSilver;
    if (m === 'bronze') return copy.medalBronze;
    return copy.medalNone;
  }

  function cardArt(card, i) {
    if (card.image) return 'background-image:url(' + JSON.stringify(String(card.image)) + ')';
    const h = isNum(card.hue) ? card.hue : hashHue(card.id || i);
    return 'background-image:radial-gradient(ellipse at 80% 0%,hsla(' + ((h + 40) % 360) + ',70%,55%,.35),transparent 60%),' +
      'linear-gradient(150deg,hsl(' + h + ',38%,24%) 0%,hsl(' + ((h + 30) % 360) + ',45%,12%) 55%,#05080a 100%)';
  }

  function buildScreen(name, spec) {
    const el = document.createElement('div');
    el.className = 'gk-screen gk-screen--' + (spec.type || 'menu') + (spec.variant ? ' gk-screen--' + spec.variant : '');
    el.setAttribute('data-screen', name);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', String(spec.title || name));
    const type = spec.type || 'menu';
    let html = '';
    if (type === 'menu' && spec.variant === 'pause') {
      html += '<div class="gk-bg gk-bg--dim"></div><div class="gk-panel">' + headHtml(spec, true) + '<div class="gk-list">';
      const items = spec.items || [];
      for (let i = 0; i < items.length; i++) html += slabHtml(items[i], i, true);
      html += '</div></div>';
    } else if (type === 'menu') {
      html += (spec.solid ? '<div class="gk-bg gk-bg--solid"></div>' : '') + (spec.art ? '<div class="gk-art"></div>' : '') + '<div class="gk-bg"></div><div class="gk-speed"></div>';
      html += '<div class="gk-pane">' + headHtml(spec, false) + '<div class="gk-list">';
      const items = spec.items || [];
      for (let i = 0; i < items.length; i++) html += slabHtml(items[i], i, false);
      html += '</div></div>';
    } else if (type === 'cards') {
      html += (spec.solid ? '<div class="gk-bg gk-bg--solid"></div>' : '') + '<div class="gk-bg"></div>';
      html += '<div class="gk-pane"><div class="gk-head"><div>' + headHtml(spec, true) + '</div>' + backBtnHtml(spec) + '</div><div class="gk-cards">';
      const cards = spec.cards || [];
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const best = isNum(c.best) ? formatRaceTime(c.best) : copy.noTime;
        const medal = c.medal === 'gold' || c.medal === 'silver' || c.medal === 'bronze' ? c.medal : 'none';
        html += '<button type="button" class="gk-card gk-enter-up' + (c.locked ? ' is-locked' : '') + '" data-nav data-id="' + esc(c.id) + '" style="--gk-i:' + (i + 2) + '">' +
          '<span class="gk-card__art" style="' + esc(cardArt(c, i)) + '"></span>' +
          (c.image ? '' : '<span class="gk-card__lines"></span><span class="gk-card__big">' + pad2(i + 1) + '</span>') +
          '<span class="gk-card__shade"></span>' +
          (c.tag ? '<span class="gk-card__tag">' + esc(c.tag) + '</span>' : '') +
          (c.locked ? '<span class="gk-card__lock">' + SVG.lock + '</span>' : '') +
          '<span class="gk-card__body">' +
          '<span class="gk-card__name">' + esc(c.name) + '</span>' +
          (c.meta ? '<span class="gk-card__meta">' + esc(c.meta) + '</span>' : '') +
          '<span class="gk-card__best"><span>' + esc(c.locked ? copy.locked : copy.best) + '</span><b>' + esc(c.locked ? '' : best) + '<i class="gk-pip gk-pip--' + medal + '" title="' + esc(medalName(c.medal)) + '"></i></b></span>' +
          '</span></button>';
      }
      html += '</div></div>';
    } else if (type === 'tiles') {
      html += (spec.solid ? '<div class="gk-bg gk-bg--solid"></div>' : '') + '<div class="gk-bg"></div>';
      html += '<div class="gk-pane"><div class="gk-head"><div>' + headHtml(spec, true) + '</div>' + backBtnHtml(spec) + '</div><div class="gk-tiles">';
      const tiles = spec.tiles || [];
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        html += '<button type="button" class="gk-tile gk-enter-up" data-nav data-id="' + esc(t.id) + '" style="--gk-i:' + (i + 2) + '"' + (t.disabled ? ' disabled' : '') + '>' +
          '<span class="gk-tile__n">' + pad2(i + 1) + '</span>' +
          (t.glyph && SVG[t.glyph] ? '<span class="gk-tile__glyph">' + SVG[t.glyph] + '</span>' : '') +
          '<span class="gk-tile__label">' + esc(t.label) + '</span>' +
          (t.desc ? '<span class="gk-tile__desc">' + esc(t.desc) + '</span>' : '') +
          '</button>';
      }
      html += '</div></div>';
    } else if (type === 'settings') {
      html += '<div class="gk-bg' + (spec.overlay ? ' gk-bg--dim' : '') + '"></div>' + (spec.solid ? '<div class="gk-bg gk-bg--solid"></div>' : '');
      html += '<div class="gk-pane"><div class="gk-head"><div>' + headHtml(spec, true) + '</div>' + backBtnHtml(spec) + '</div><div class="gk-settings">';
      const rows = spec.rows || [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.kind === 'header') {
          html += '<p class="gk-shead">' + esc(r.label) + '</p>';
          continue;
        }
        html += '<button type="button" class="gk-srow" data-nav data-kind="' + esc(r.kind) + '" data-id="' + esc(r.id) + '">' +
          '<span class="gk-srow__label">' + esc(r.label) + (r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</span>' +
          '<span class="gk-srow__ctl"></span></button>';
      }
      html += '</div></div>';
    } else if (type === 'results') {
      const medal = spec.medal === 'gold' || spec.medal === 'silver' || spec.medal === 'bronze' ? spec.medal : 'none';
      html += '<div class="gk-bg"></div><div class="gk-bg gk-bg--dim" style="opacity:.55"></div>';
      html += '<div class="gk-pane"><div class="gk-res gk-medal-' + medal + '"><div class="gk-res__left">';
      if (spec.kicker) html += '<p class="gk-kicker gk-enter">' + esc(spec.kicker) + '</p>';
      if (spec.title) html += '<h2 class="gk-title gk-title--md gk-enter" style="--gk-i:1">' + esc(spec.title) + '</h2>';
      if (spec.subtitle) html += '<p class="gk-res__course gk-enter" style="--gk-i:2">' + esc(spec.subtitle) + '</p>';
      html += '<p class="gk-res__time gk-enter" style="--gk-i:2">' + esc(isNum(spec.time) ? formatRaceTime(0) : copy.noTime) + '</p>';
      html += '<div class="gk-res__meta gk-enter" style="--gk-i:3">';
      if (spec.position && isNum(spec.position.place)) html += '<span class="gk-pos"><span>' + esc(copy.position) + '</span><b>P' + spec.position.place + '</b><span>/' + (spec.position.of || '') + '</span></span>';
      if (isNum(spec.delta)) html += '<span class="gk-delta gk-delta--' + (spec.delta <= 0 ? 'good' : 'bad') + '">' + esc(formatSplitDelta(spec.delta)) + '</span>';
      else if (isNum(spec.best) && isNum(spec.time)) html += '<span class="gk-delta gk-delta--' + (spec.time <= spec.best ? 'good' : 'bad') + '">' + esc(formatSplitDelta(spec.time - spec.best)) + '</span>';
      if (spec.isNewBest) html += '<span class="gk-flair">' + esc(copy.newBest) + '</span>';
      html += '</div>';
      const rows = spec.rows || [];
      if (rows.length) {
        html += '<div class="gk-splits gk-enter" style="--gk-i:4">';
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const cls = r.good === true ? ' class="gk-delta--good"' : r.good === false ? ' class="gk-delta--bad"' : '';
          html += '<span>' + esc(r.label) + '</span><span' + cls + '>' + esc(r.value) + '</span>';
        }
        html += '</div>';
      }
      html += '</div><div class="gk-medal gk-medal--' + medal + '"><span class="gk-medal__rays"></span><span class="gk-medal__ring"></span>' +
        '<span class="gk-medal__disc">' + SVG.star + '</span><span class="gk-medal__label">' + esc(medalName(spec.medal)) + '</span></div></div>';
      html += '<div class="gk-row-actions">';
      const items = spec.items || [];
      for (let i = 0; i < items.length; i++) html += slabHtml(items[i], i, true);
      html += '</div></div>';
    }
    const footHidden = spec.variant === 'pause' || lastMethod === 'touch' || !!spec.hideFoot;
    html += '<div class="gk-foot"' + (footHidden ? ' hidden' : '') + '>' + footHtml(spec) + '</div>';
    el.innerHTML = html;
    el.classList.toggle('has-foot', !footHidden);
    const navs = el.querySelectorAll('[data-nav]');
    const pool = [].concat(spec.items || [], spec.cards || [], spec.tiles || [], spec.rows || []);
    for (let i = 0; i < navs.length; i++) {
      const id = navs[i].getAttribute('data-id');
      for (let k = 0; k < pool.length; k++) if (pool[k] && pool[k].id === id) navs[i].__gkItem = pool[k];
    }
    if (type === 'settings') {
      const rowsEl = el.querySelectorAll('.gk-srow');
      for (let i = 0; i < rowsEl.length; i++) {
        const r = rowSpec2(spec, rowsEl[i].getAttribute('data-id'));
        if (r) renderRowControl(rowsEl[i], r);
      }
    }
    if (spec.art) {
      const art = el.querySelector('.gk-art');
      const img = new Image();
      img.onload = function () {
        art.style.backgroundImage = 'url(' + JSON.stringify(String(spec.art)) + ')';
        art.classList.add('is-loaded');
      };
      img.src = spec.art;
    }
    const logo = el.querySelector('.gk-logo');
    if (logo) logo.addEventListener('error', function () { logo.hidden = true; });
    return el;
  }

  function rowSpec2(spec, id) {
    const rows = spec.rows || [];
    for (let i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }

  function onScreenClick(e) {
    const arrow = e.target.closest ? e.target.closest('.gk-choice__arrow') : null;
    const navEl = e.target.closest ? e.target.closest('[data-nav]') : null;
    if (!navEl) return;
    if (arrow && navEl.getAttribute('data-kind') === 'choice') {
      setFocus(navEl, true);
      const row = rowSpec(navEl);
      if (row) cycleChoice(navEl, row, Number(arrow.getAttribute('data-step')) || 1);
      return;
    }
    if (navEl.getAttribute('data-kind') === 'slider') {
      setFocus(navEl, true);
      return;
    }
    setFocus(navEl, true);
    activate(navEl);
  }

  function onScreenPointerMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (pointerAtShow) {
      if (Math.abs(e.clientX - pointerAtShow.x) < 3 && Math.abs(e.clientY - pointerAtShow.y) < 3) return;
      pointerAtShow = null;
    }
    const navEl = e.target.closest ? e.target.closest('[data-nav]') : null;
    if (navEl && navEl !== focusEl && !navEl.disabled) setFocus(navEl);
  }

  function onDocPointerMove(e) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  }

  function clearReveal() {
    for (let i = 0; i < revealTimers.length; i++) clearTimeout(revealTimers[i]);
    revealTimers = [];
  }

  function runResults(el, spec) {
    clearReveal();
    const res = el.querySelector('.gk-res');
    const timeEl = el.querySelector('.gk-res__time');
    if (!isNum(spec.time)) {
      revealTimers.push(setTimeout(function () { res.classList.add('is-revealed'); }, 200));
      return;
    }
    const finalText = formatRaceTime(spec.time);
    if (reducedMotion()) {
      timeEl.textContent = finalText;
      res.classList.add('is-revealed');
      if (typeof spec.onReveal === 'function') spec.onReveal(spec.medal || null);
      return;
    }
    const t0 = performance.now() + 180;
    const dur = 720;
    let raf = 0;
    const tick = function (t) {
      if (!el.isConnected) return;
      const k = Math.min(1, Math.max(0, (t - t0) / dur));
      const e = 1 - Math.pow(1 - k, 3);
      timeEl.textContent = formatRaceTime(spec.time * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        timeEl.textContent = finalText;
        timeEl.classList.add('is-final');
      }
    };
    raf = requestAnimationFrame(tick);
    revealTimers.push(setTimeout(function () {
      if (!el.isConnected) return;
      res.classList.add('is-revealed');
      if (typeof spec.onReveal === 'function') {
        try { spec.onReveal(spec.medal || null); } catch (_) {}
      }
    }, 180 + dur + 80));
    revealTimers.push(setTimeout(function () { cancelAnimationFrame(raf); }, 4000));
  }

  function screen(name, spec) {
    specs[name] = Object.assign({}, specs[name] || null, spec || null);
    if (currentName === name) show(name);
    return api;
  }

  function update(name, patch) {
    if (!specs[name]) specs[name] = {};
    Object.assign(specs[name], patch || null);
    if (currentName === name) show(name);
    return api;
  }

  function show(name, patch) {
    const spec = specs[name];
    if (!spec) return api;
    if (patch) Object.assign(spec, patch);
    closeAskSilently();
    const prev = currentEl;
    const prevName = currentName;
    const el = buildScreen(name, spec);
    el.addEventListener('click', onScreenClick);
    el.addEventListener('pointermove', onScreenPointerMove);
    pointerAtShow = { x: lastPointer.x, y: lastPointer.y };
    root.appendChild(el);
    currentEl = el;
    currentName = name;
    focusEl = null;
    const full = spec.keepHud || spec.variant === 'pause' ? 'overlay' : 'full';
    setStageMenu(full);
    countdown(null);
    void el.offsetWidth;
    el.classList.add('is-on');
    if (prev && prev !== el) {
      prev.classList.remove('is-on');
      setTimeout(function () { if (prev.parentNode) prev.parentNode.removeChild(prev); }, 220);
    }
    const list = navEls();
    let target = null;
    const wantId = spec.focus != null && (prevName !== name || !lastFocus[name]) ? spec.focus : lastFocus[name];
    if (wantId != null) for (let i = 0; i < list.length; i++) if (list[i].getAttribute('data-id') === wantId) target = list[i];
    if (!target) for (let i = 0; i < list.length; i++) if (list[i].classList.contains('is-primary') && !list[i].disabled) { target = list[i]; break; }
    if (!target) for (let i = 0; i < list.length; i++) if (!list[i].disabled && list[i].getAttribute('data-id') !== '__back') { target = list[i]; break; }
    if (target) setFocus(target, true);
    if (spec.type === 'results') runResults(el, spec);
    else clearReveal();
    return api;
  }

  function hide() {
    clearReveal();
    closeAskSilently();
    const prev = currentEl;
    currentEl = null;
    currentName = null;
    focusEl = null;
    setStageMenu(null);
    if (prev) {
      prev.classList.remove('is-on');
      setTimeout(function () { if (prev.parentNode) prev.parentNode.removeChild(prev); }, 220);
    }
    try {
      const a = document.activeElement;
      if (a && stage.contains(a)) a.blur();
    } catch (_) {}
    return api;
  }

  function current() {
    return currentName;
  }

  function toast(text, o) {
    const ms = o && isNum(o.ms) ? o.ms : 2200;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'gk-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      stage.appendChild(toastEl);
    }
    toastEl.className = 'gk-toast' + (o && o.tone === 'warn' ? ' gk-toast--warn' : '');
    toastEl.textContent = String(text == null ? '' : text);
    void toastEl.offsetWidth;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) toastEl.classList.remove('is-on'); }, ms);
  }

  let splashEl = null;
  let splashTimer = 0;

  function splash(text, o) {
    const cfg = o || {};
    const ms = isNum(cfg.ms) ? Math.max(400, cfg.ms) : 1400;
    if (!splashEl) {
      splashEl = document.createElement('div');
      splashEl.setAttribute('aria-live', 'polite');
      hud.appendChild(splashEl);
    }
    splashEl.className = 'gk-splash' + (cfg.tone === 'good' ? ' gk-splash--good' : cfg.tone === 'bad' ? ' gk-splash--bad' : '');
    splashEl.style.setProperty('--gk-splash-ms', ms + 'ms');
    splashEl.innerHTML = '<span class="gk-splash__t"></span>' + (cfg.sub ? '<span class="gk-splash__s"></span>' : '');
    splashEl.querySelector('.gk-splash__t').textContent = String(text == null ? '' : text);
    if (cfg.sub) splashEl.querySelector('.gk-splash__s').textContent = String(cfg.sub);
    void splashEl.offsetWidth;
    splashEl.classList.add('is-on');
    clearTimeout(splashTimer);
    splashTimer = setTimeout(function () {
      if (!splashEl) return;
      splashEl.classList.remove('is-on');
      splashEl.innerHTML = '';
    }, ms + 30);
  }

  function countdown(n) {
    const v = isNum(n) ? Math.round(n) : null;
    if (v === null || v < 0) {
      countSeq++;
      countValue = null;
      countEl.hidden = true;
      countEl.innerHTML = '';
      clearTimeout(countTimer);
      return;
    }
    if (v === countValue) return;
    countValue = v;
    countEl.hidden = false;
    const span = document.createElement('span');
    span.className = 'gk-count__n' + (v === 0 ? ' is-go' : '');
    span.textContent = v === 0 ? copy.go : String(v);
    countEl.innerHTML = '';
    countEl.appendChild(span);
    clearTimeout(countTimer);
    countTimer = setTimeout(function () {
      if (countValue === v) {
        countEl.hidden = true;
        countEl.innerHTML = '';
        countValue = null;
      }
    }, v === 0 ? 1050 : 1000);
  }

  let countSeq = 0;

  function countdownSequence(n, onTick) {
    const total = isNum(n) ? Math.max(0, Math.round(n)) : 3;
    const token = ++countSeq;
    return new Promise(function (resolve) {
      let k = total;
      const step = function () {
        if (disposed || token !== countSeq) { resolve(false); return; }
        countdown(k);
        if (typeof onTick === 'function') {
          try { onTick(k); } catch (_) {}
        }
        if (k === 0) { resolve(true); return; }
        k--;
        setTimeout(step, 1000);
      };
      step();
    });
  }

  function loading(p, text, info) {
    if (p == null || !(p < 1)) {
      if (!loadingEl) return;
      const el = loadingEl;
      if (isNum(p)) {
        const bar = el.querySelector('.gk-loading__bar i');
        if (bar) bar.style.width = '100%';
        const pct = el.querySelector('.gk-loading__meta b');
        if (pct) pct.textContent = '100%';
      }
      loadingEl = null;
      clearTimeout(loadingTimer);
      loadingTimer = setTimeout(function () {
        el.classList.add('is-out');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
      }, 160);
      return;
    }
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.className = 'gk-loading';
      loadingEl.innerHTML = '<div class="gk-loading__art"></div><div class="gk-loading__inner"><p class="gk-kicker"></p><div class="gk-loading__title"></div>' +
        '<div class="gk-loading__bar"><i></i></div><div class="gk-loading__meta"><span></span><b>0%</b></div><p class="gk-loading__tip"></p></div>';
      stage.appendChild(loadingEl);
      loadingArt = '';
    }
    if (info && typeof info === 'object') Object.assign(loadingInfo, info);
    const pv = Math.max(0, Math.min(1, isNum(p) ? p : 0));
    const kick = loadingEl.querySelector('.gk-kicker');
    kick.textContent = loadingInfo.kicker || '';
    kick.hidden = !loadingInfo.kicker;
    loadingEl.querySelector('.gk-loading__title').textContent = loadingInfo.title || opts.title || '';
    loadingEl.querySelector('.gk-loading__tip').textContent = loadingInfo.tip || '';
    if (loadingInfo.image && loadingInfo.image !== loadingArt) {
      loadingArt = loadingInfo.image;
      const artEl = loadingEl.querySelector('.gk-loading__art');
      const img = new Image();
      img.onload = function () {
        artEl.style.backgroundImage = 'url(' + JSON.stringify(String(loadingArt)) + ')';
        artEl.classList.add('is-loaded');
      };
      img.src = loadingInfo.image;
    }
    loadingEl.querySelector('.gk-loading__bar i').style.width = (pv * 100).toFixed(1) + '%';
    loadingEl.querySelector('.gk-loading__meta span').textContent = text != null ? String(text) : copy.loading;
    loadingEl.querySelector('.gk-loading__meta b').textContent = Math.round(pv * 100) + '%';
  }

  function ask(o) {
    const cfg = o || {};
    closeAskSilently();
    return new Promise(function (resolve) {
      askResolve = resolve;
      askEl = document.createElement('div');
      askEl.className = 'gk-ask';
      askEl.innerHTML = '<div class="gk-bg"></div><div class="gk-panel">' +
        (cfg.title ? '<h2 class="gk-title gk-title--md">' + esc(cfg.title) + '</h2>' : '') +
        (cfg.text ? '<p class="gk-panel__text">' + esc(cfg.text) + '</p>' : '') +
        '<div class="gk-row-actions">' +
        slabHtml({ id: 'yes', label: cfg.yes || copy.confirm, primary: true }, 0, true) +
        slabHtml({ id: 'no', label: cfg.no || copy.cancel }, 1, true) +
        '</div></div>';
      askEl.addEventListener('click', function (e) {
        const navEl = e.target.closest ? e.target.closest('[data-nav]') : null;
        if (navEl) closeAsk(navEl.getAttribute('data-id') === 'yes');
      });
      askEl.addEventListener('pointermove', onScreenPointerMove);
      pointerAtShow = { x: lastPointer.x, y: lastPointer.y };
      stage.appendChild(askEl);
      if (!currentName) setStageMenu('overlay');
      const yes = askEl.querySelector('[data-id="yes"]');
      setFocus(cfg.defaultNo ? askEl.querySelector('[data-id="no"]') : yes, true);
    });
  }

  function closeAsk(v) {
    if (!askEl) return;
    const el = askEl;
    const r = askResolve;
    askEl = null;
    askResolve = null;
    if (el.parentNode) el.parentNode.removeChild(el);
    play(v ? 'select' : 'back');
    if (!currentName) setStageMenu(null);
    else {
      const list = navEls();
      const wantId = lastFocus[currentName];
      let target = list[0] || null;
      for (let i = 0; i < list.length; i++) if (list[i].getAttribute('data-id') === wantId) target = list[i];
      focusEl = null;
      if (target) setFocus(target, true);
    }
    if (r) r(!!v);
  }

  function closeAskSilently() {
    if (!askEl) return;
    const el = askEl;
    const r = askResolve;
    askEl = null;
    askResolve = null;
    if (el.parentNode) el.parentNode.removeChild(el);
    if (r) r(false);
  }

  function stageEngaged() {
    try {
      const fs = fullscreenElement();
      if (fs && (fs === stage || fs.contains(stage))) return true;
      const a = document.activeElement;
      if (a && a !== document.body && stage.contains(a)) return true;
      if (a && a !== document.body && a !== document.documentElement) return false;
    } catch (_) {}
    return engaged;
  }

  function isEditableTarget(t) {
    if (!t || t.nodeType !== 1) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }

  function setMethod(m) {
    if (m === lastMethod) return;
    lastMethod = m;
    if (currentEl && currentName) {
      const foot = currentEl.querySelector('.gk-foot');
      const spec = specs[currentName];
      if (foot && spec) {
        foot.hidden = spec.variant === 'pause' || m === 'touch' || !!spec.hideFoot;
        foot.innerHTML = footHtml(spec);
        currentEl.classList.toggle('has-foot', !foot.hidden);
      }
    }
  }

  function onKeyDown(e) {
    if (disposed || !e || e.defaultPrevented && !currentName) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;
    const k = e.key;
    const menuOpen = !!currentName || !!askEl;
    if (!menuOpen) {
      if ((k === 'Escape' || k === 'p' || k === 'P') && stageEngaged() && pauseHandler) {
        e.preventDefault();
        requestPause();
      }
      return;
    }
    if (!stageEngaged()) return;
    setMethod('keyboard');
    let handled = true;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') navigate('up');
    else if (k === 'ArrowDown' || k === 's' || k === 'S') navigate('down');
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') navigate('left');
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') navigate('right');
    else if (k === 'Tab') navigateLinear(e.shiftKey ? -1 : 1);
    else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      if (!e.repeat) activate();
    } else if (k === 'Escape' || k === 'Backspace') {
      if (!e.repeat) back();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function navigateLinear(step) {
    const list = navEls();
    if (!list.length) return;
    const i = focusEl ? list.indexOf(focusEl) : -1;
    setFocus(list[(i + step + list.length) % list.length]);
  }

  function onDocPointerDown(e) {
    try { engaged = stage.contains(e.target); } catch (_) {}
    if (e.pointerType === 'touch') setMethod('touch');
    else if (e.pointerType === 'mouse' && lastMethod === 'touch') setMethod('keyboard');
  }

  function stageVisible() {
    try {
      if (document.visibilityState === 'hidden') return false;
      const r = stage.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
    } catch (_) {
      return true;
    }
  }

  function onPadDirection(e) {
    const d = e && e.detail;
    if (!d || !stageVisible()) return;
    setMethod('gamepad');
    if (!currentName && !askEl) return;
    navigate(d.direction);
  }

  function onPadButton(e) {
    const d = e && e.detail;
    if (!d || !d.pressed || !stageVisible()) return;
    handlePadButton(d.name);
  }

  function handlePadButton(name) {
    setMethod('gamepad');
    const menuOpen = !!currentName || !!askEl;
    if (name === 'start') {
      if (askEl) closeAsk(false);
      else if (!menuOpen) requestPause();
      else if (specs[currentName] && specs[currentName].variant === 'pause') back();
      return;
    }
    if (!menuOpen) return;
    if (name === 'a') activate();
    else if (name === 'b') back();
    else if (name === 'lb' || name === 'rb') {
      if (focusEl && focusEl.getAttribute('data-kind')) adjustRow(focusEl, name === 'lb' ? -1 : 1);
    }
  }

  const PAD_NAMES = { 0: 'a', 1: 'b', 4: 'lb', 5: 'rb', 9: 'start' };

  function padPoll() {
    padPollRaf = 0;
    if (disposed || window.MentriaGamepad) return;
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (_) {}
    let p = null;
    for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { p = pads[i]; break; }
    if (p) {
      for (const idx in PAD_NAMES) {
        const i = Number(idx);
        const b = p.buttons[i];
        const down = !!(b && (b.pressed || b.value > 0.5));
        if (down && !padPrev[i]) handlePadButton(PAD_NAMES[i]);
        padPrev[i] = down;
      }
      const ax = p.axes || [];
      const dirs = {
        up: (p.buttons[12] && p.buttons[12].pressed) || (ax[1] || 0) < -0.5,
        down: (p.buttons[13] && p.buttons[13].pressed) || (ax[1] || 0) > 0.5,
        left: (p.buttons[14] && p.buttons[14].pressed) || (ax[0] || 0) < -0.5,
        right: (p.buttons[15] && p.buttons[15].pressed) || (ax[0] || 0) > 0.5
      };
      const t = performance.now();
      for (const d in dirs) {
        if (dirs[d]) {
          if (!padDirPrev[d]) {
            padDirPrev[d] = t + 350;
            onPadDirection({ detail: { direction: d } });
          } else if (t >= padDirPrev[d]) {
            padDirPrev[d] = t + 110;
            onPadDirection({ detail: { direction: d } });
          }
        } else padDirPrev[d] = 0;
      }
    }
    padPollRaf = requestAnimationFrame(padPoll);
  }

  function onPadConnected() {
    if (!window.MentriaGamepad && !padPollRaf) padPollRaf = requestAnimationFrame(padPoll);
  }

  function onPause(fn) {
    pauseHandler = typeof fn === 'function' ? fn : null;
  }

  function setCopy(next) {
    copy = Object.assign({}, UI_COPY_DEFAULTS, next || null);
    syncFsIcon();
    syncRotateText();
    pauseBtn.setAttribute('aria-label', copy.pause);
    pauseBtn.title = copy.pause;
    if (currentName) show(currentName);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    closeAskSilently();
    clearReveal();
    clearTimeout(toastTimer);
    clearTimeout(splashTimer);
    clearTimeout(countTimer);
    clearTimeout(loadingTimer);
    if (padPollRaf) cancelAnimationFrame(padPollRaf);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('mentria:gamepad:direction', onPadDirection);
    window.removeEventListener('mentria:gamepad:button', onPadButton);
    window.removeEventListener('gamepadconnected', onPadConnected);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('pointermove', onDocPointerMove, true);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    try { if (rotateRO) rotateRO.disconnect(); } catch (_) {}
    const nodes = [hud, root, countEl, chrome, toastEl, loadingEl, askEl, rotateEl];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
    stage.removeAttribute('data-gk-menu');
    try { window.mentriaPadCapture = prevPadCapture; } catch (_) {}
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('mentria:gamepad:direction', onPadDirection);
  window.addEventListener('mentria:gamepad:button', onPadButton);
  window.addEventListener('gamepadconnected', onPadConnected);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('pointermove', onDocPointerMove, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  onPadConnected();
  updateChromeWidth();

  const api = {
    root,
    hud,
    screen,
    show,
    hide,
    update,
    back,
    current,
    toast,
    splash,
    countdown,
    countdownSequence,
    loading,
    hudSlot,
    hudStat,
    showHud,
    setChrome,
    onPause,
    ask,
    setCopy,
    navigate,
    activate,
    toggleFullscreen,
    get method() { return lastMethod; },
    get portrait() { return rotatePortrait; },
    dispose
  };
  return api;
}

function ensureStyle() {
  try {
    if (document.getElementById(UI_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = UI_STYLE_ID;
    s.textContent = UI_STYLE;
    (document.head || document.documentElement).appendChild(s);
  } catch (_) {}
}
