/* chess-app.js — UI, game state, engine driver, Trystero P2P. Depends on chess-engine.js globals + window.CHESS_I18N. */
(() => {
  const $ = (id) => document.getElementById(id);
  const T = Object.assign({
    win_white: 'White wins', win_black: 'Black wins', draw: 'Draw',
    by_checkmate: 'by checkmate', by_stalemate: 'by stalemate', by_resignation: 'by resignation',
    draw_50move: 'by 50-move rule', draw_insufficient: 'by insufficient material', draw_threefold: 'by threefold repetition',
    eyebrow_checkmate: 'checkmate', eyebrow_stalemate: 'stalemate', eyebrow_draw: 'draw', eyebrow_resigned: 'resigned',
    no_moves_yet: 'no moves yet — make your move',
    confirm_resign: 'Resign the game?', confirm_new_color: 'Start a new game as {color}?',
    color_white: 'white', color_black: 'black',
    chat_you: 'you', chat_peer: 'peer',
    peer_offline: 'offline', peer_waiting: 'waiting for opponent', peer_connecting: 'connecting…',
    peer_connected: 'connected', peer_disconnected: 'opponent left', peer_error: 'connection error',
    room_invalid: 'invalid room code', copied: 'copied',
    play_black: 'play black', play_white: 'play white',
    board_label: 'chess board', a11y_empty: 'empty', a11y_target: 'legal move',
    a11y_check: 'check', a11y_turn: '{color} to move', promo_label: 'promote pawn',
    piece_king: 'king', piece_queen: 'queen', piece_rook: 'rook',
    piece_bishop: 'bishop', piece_knight: 'knight', piece_pawn: 'pawn'
  }, window.CHESS_I18N || {});
  const PIECE_NAMES = { K: T.piece_king, Q: T.piece_queen, R: T.piece_rook, B: T.piece_bishop, N: T.piece_knight, P: T.piece_pawn };
  function squareLabel(idx, pos, opts){
    opts = opts || {};
    const p = pos.b[idx];
    let label = sqName(idx) + ', ';
    if (p === ' ') label += T.a11y_empty;
    else label += (isW(p) ? T.color_white : T.color_black) + ' ' + PIECE_NAMES[p.toUpperCase()];
    if (opts.target) label += ', ' + T.a11y_target;
    return label;
  }
  const liveEl = () => document.getElementById('chess-live');
  function announce(msg){ const el = liveEl(); if (el){ el.textContent = ''; el.textContent = msg; } }

  const State = {
    pos: startPos(), history: [], cursor: -1, flipped: false,
    mode: 'hotseat', humanColor: 'w', skill: 1,
    pendingPromo: null, selected: -1, legalForSel: [], ghostMove: null, over: null,
    focusSq: 60,
  };
  let cellEls = [];
  const SKILL_CFG = [
    { depth: 1, label: 'Beginner', random: 0.3 },
    { depth: 2, label: 'Casual', random: 0 },
    { depth: 3, label: 'Strong', random: 0 },
    { depth: 5, label: 'Brutal', random: 0 },
  ];

  /* ===== persistence (MentriaStore) ===== */
  function save(){
    if (State.mode === 'online') return;
    const data = { pos: State.pos, history: State.history.map(h=>({move:h.move,san:h.san,key:h.key,prePos:h.prePos})), mode: State.mode, humanColor: State.humanColor, flipped: State.flipped, skill: State.skill };
    try {
      if (window.MentriaStore) window.MentriaStore.set('games', 'chess', data);
      else localStorage.setItem('mentria_chess_v1', JSON.stringify(data));
    } catch(e){}
  }
  function load(){
    try {
      let d = window.MentriaStore ? window.MentriaStore.get('games', 'chess') : null;
      if (!d){ const raw = localStorage.getItem('mentria_chess_v1'); if (raw) d = JSON.parse(raw); }
      if (!d || !d.pos) return false;
      State.pos = d.pos; State.history = d.history || [];
      State.mode = d.mode === 'online' ? 'hotseat' : (d.mode || 'hotseat');
      State.humanColor = d.humanColor || 'w'; State.flipped = !!d.flipped; State.skill = d.skill ?? 1;
      return true;
    } catch(e){ return false; }
  }

  /* ===== engine worker ===== */
  let worker = null;
  function bootWorker(){
    if (worker) worker.terminate();
    const blob = new Blob([workerSource], { type:'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = onWorkerMessage;
  }
  let pendingEngineCallback = null, pendingHint = false, pendingAnalyze = false;
  let engineTimer = null;
  function onWorkerMessage(e){
    const d = e.data;
    if (d.type !== 'best') return;
    $('stat-depth').textContent = d.depth ?? '—';
    $('stat-nodes').textContent = (d.nodes||0).toLocaleString();
    $('stat-time').textContent = (d.time||0) + 'ms';
    const nps = d.time ? Math.round((d.nodes||0)/(d.time/1000)) : 0;
    $('stat-nps').textContent = nps.toLocaleString();
    const ev = d.eval || 0;
    setEval(State.pos.turn === 'w' ? ev : -ev);
    renderLines(d.lines || [], State.pos.turn);
    if (pendingHint && d.move){ drawHintArrow(d.move.from, d.move.to); pendingHint = false; }
    if (pendingEngineCallback){ const cb = pendingEngineCallback; pendingEngineCallback = null; cb(d.move); }
    pendingAnalyze = false;
  }
  function askEngine(opts = {}){
    if (!worker) bootWorker();
    const cfg = SKILL_CFG[State.skill];
    worker.postMessage({ type:'go', pos: State.pos, depth: opts.depth ?? cfg.depth, skill: State.skill });
  }
  function cancelPendingEngine(){
    pendingEngineCallback = null;
    if (engineTimer){ clearTimeout(engineTimer); engineTimer = null; }
  }
  function engineMove(){
    if (State.over) return;
    pendingEngineCallback = (m) => { if (!m || State.over) return; if (State.mode === 'engine' && State.pos.turn === State.humanColor) return; doMove(m); };
    engineTimer = setTimeout(() => askEngine(), 250 + Math.random()*350);
  }
  function analyze(){ if (pendingAnalyze) return; pendingAnalyze = true; askEngine(); }

  /* ===== eval bar ===== */
  function setEval(cp){
    const clamped = Math.max(-1000, Math.min(1000, cp));
    const pct = 50 + (clamped/2000)*100;
    $('evalWhite').style.height = Math.max(2, Math.min(98, pct)) + '%';
    let label;
    if (Math.abs(cp) > 28000){ const mateInt = Math.max(1, Math.round((29000 - Math.abs(cp)))); label = (cp>0?'+M':'-M') + Math.max(1, Math.ceil(mateInt)); }
    else label = (cp>=0?'+':'') + (cp/100).toFixed(2);
    $('evalLabel').textContent = label;
  }
  function renderLines(lines, turn){
    const c = $('cand-lines'); c.innerHTML = '';
    lines.forEach((ln, i) => {
      const btn = document.createElement('button'); btn.className = 'line';
      const cp = ln.score; const orient = turn === 'w' ? cp : -cp;
      let evStr;
      if (Math.abs(cp) > 28000) evStr = (orient>0?'+M':'-M') + Math.max(1, Math.ceil((29000-Math.abs(cp))/2));
      else evStr = (orient>=0?'+':'') + (orient/100).toFixed(2);
      btn.innerHTML = `<span class="rank">${i+1}.</span><span class="ev">${evStr}</span><span class="pv">${ln.pv}</span>`;
      btn.onmouseenter = () => { State.ghostMove = ln.move; render(); };
      btn.onmouseleave = () => { State.ghostMove = null; render(); };
      btn.onclick = () => { State.ghostMove = ln.move; render(); };
      c.appendChild(btn);
    });
  }

  /* ===== move execution ===== */
  function doMove(m){
    const prePos = clonePos(State.pos);
    const allMoves = genMoves(State.pos);
    const san = moveToSAN(State.pos, m, allMoves);
    State.pos = applyMove(State.pos, m);
    State.history.push({ move: m, san, key: posKey(State.pos), prePos });
    State.cursor = -1; State.selected = -1; State.legalForSel = []; State.ghostMove = null;
    hideHintArrow(); render(); save();
    const status = gameStatus(State.pos, State.history);
    if (status){ State.over = status; showEnd(status); }
    announceMove(san, status);
    if (State.mode === 'online' && P2P.action && !m.fromPeer){ P2P.send({ kind:'move', move: m }); }
    if (status) return;
    if (State.mode === 'engine' && State.pos.turn !== State.humanColor) engineMove();
    else analyze();
  }

  /* ===== render ===== */
  function buildBoardCells(){
    const board = $('board'); board.innerHTML = '';
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', T.board_label);
    cellEls = [];
    for (let r=0;r<8;r++){
      const rowEl = document.createElement('div');
      rowEl.className = 'sq-row'; rowEl.setAttribute('role', 'row');
      for (let c=0;c<8;c++){
        const sq = document.createElement('div');
        sq.className = 'sq ' + (((r+c)%2===0)?'light':'dark');
        sq.dataset.sq = State.flipped ? rcSq(7-r, 7-c) : rcSq(r,c);
        sq.setAttribute('role', 'gridcell');
        sq.tabIndex = -1;
        sq.addEventListener('pointerdown', onSqDown);
        rowEl.appendChild(sq);
        cellEls.push(sq);
      }
      board.appendChild(rowEl);
    }
    const ranks = $('coords-ranks'); ranks.innerHTML = '';
    const files = $('coords-files'); files.innerHTML = '';
    for (let i=0;i<8;i++){
      const rk = document.createElement('div'); rk.textContent = State.flipped ? (i+1) : (8-i); ranks.appendChild(rk);
      const fl = document.createElement('div'); fl.textContent = State.flipped ? FILES[7-i] : FILES[i]; files.appendChild(fl);
    }
  }
  function render(){
    const cells = cellEls;
    const viewPos = State.cursor >= 0 ? State.history[State.cursor].prePos : State.pos;
    const last = (State.cursor < 0 ? State.history[State.history.length-1] : State.history[State.cursor-1])?.move;
    const checkColor = inCheck(viewPos, viewPos.turn) ? viewPos.turn : null;
    const kingSq = checkColor ? findKing(viewPos, checkColor) : -1;
    for (let i=0;i<64;i++){
      const cell = cells[i]; const idx = +cell.dataset.sq;
      cell.classList.remove('sel','last','dot','ring','check'); cell.innerHTML = '';
      const p = viewPos.b[idx];
      if (p !== ' '){ const sp = document.createElement('span'); sp.className = 'pc ' + (isW(p)?'w':'b'); sp.textContent = PIECE_GLYPH[p]; cell.appendChild(sp); }
      if (last && (last.from === idx || last.to === idx)) cell.classList.add('last');
      if (idx === kingSq) cell.classList.add('check');
    }
    if (State.selected >= 0 && State.cursor < 0){
      for (let i=0;i<64;i++){ if (+cells[i].dataset.sq === State.selected) cells[i].classList.add('sel'); }
      for (const m of State.legalForSel){
        for (let i=0;i<64;i++){ if (+cells[i].dataset.sq === m.to) cells[i].classList.add(m.capture || m.ep ? 'ring' : 'dot'); }
      }
    }
    if (State.ghostMove){
      const g = State.ghostMove;
      for (let i=0;i<64;i++){
        if (+cells[i].dataset.sq === g.to){
          const piece = State.pos.b[g.from];
          if (piece && piece !== ' '){ const sp = document.createElement('span'); sp.className = 'pc ghost ' + (isW(piece)?'w':'b'); sp.textContent = PIECE_GLYPH[piece]; cells[i].innerHTML = ''; cells[i].appendChild(sp); }
        }
      }
    }
    const targets = (State.selected >= 0 && State.cursor < 0) ? new Set(State.legalForSel.map(m=>m.to)) : null;
    for (let i=0;i<64;i++){
      const cell = cells[i]; const idx = +cell.dataset.sq;
      cell.setAttribute('aria-label', squareLabel(idx, viewPos, { target: targets ? targets.has(idx) : false }));
      cell.setAttribute('aria-selected', (State.selected === idx && State.cursor < 0) ? 'true' : 'false');
      cell.tabIndex = (idx === State.focusSq) ? 0 : -1;
    }
    renderCaptured(viewPos);
    renderMoves();
    $('scrub-back').classList.toggle('show', State.cursor >= 0);
    $('btn-undo').disabled = State.history.length === 0 || State.mode === 'online';
  }
  function updateTabindex(){
    for (const cell of cellEls) cell.tabIndex = (+cell.dataset.sq === State.focusSq) ? 0 : -1;
  }
  function focusSquare(idx){
    const cell = cellEls.find(c => +c.dataset.sq === idx);
    if (cell){ State.focusSq = idx; updateTabindex(); cell.focus(); }
  }
  function renderCaptured(viewPos){
    const startCounts = { P:8, N:2, B:2, R:2, Q:1, p:8, n:2, b:2, r:2, q:1 };
    const VAL = { P:1, N:3, B:3, R:5, Q:9 };
    const upto = State.cursor >= 0 ? State.cursor : State.history.length;
    let promoMat = 0;
    for (let i=0;i<upto;i++){
      const mv = State.history[i] && State.history[i].move;
      if (mv && mv.promo){
        const t = mv.promo.toUpperCase();
        if (i % 2 === 0){ startCounts.P -= 1; startCounts[t] += 1; promoMat += VAL[t] - VAL.P; }
        else { startCounts.p -= 1; startCounts[t.toLowerCase()] += 1; promoMat -= VAL[t] - VAL.P; }
      }
    }
    const cur = {};
    for (const p of viewPos.b) if (p !== ' ' && p.toUpperCase() !== 'K') cur[p] = (cur[p]||0)+1;
    const capByWhite = [], capByBlack = []; let mat = promoMat;
    for (const k of Object.keys(startCounts)){
      const missing = startCounts[k] - (cur[k]||0);
      for (let i=0;i<missing;i++){ if (isW(k)) capByBlack.push(k); else capByWhite.push(k); mat += isW(k) ? -VAL[k.toUpperCase()] : VAL[k.toUpperCase()]; }
    }
    capByWhite.sort((a,b)=>VAL[b.toUpperCase()]-VAL[a.toUpperCase()]);
    capByBlack.sort((a,b)=>VAL[b.toUpperCase()]-VAL[a.toUpperCase()]);
    const topPile = State.flipped ? capByBlack : capByWhite;
    const botPile = State.flipped ? capByWhite : capByBlack;
    $('cap-top').className = 'captured ' + (State.flipped ? 'white' : 'black');
    $('cap-bot').className = 'captured ' + (State.flipped ? 'black' : 'white');
    $('cap-top').innerHTML = topPile.map(p => `<span>${PIECE_GLYPH[p]}</span>`).join('');
    $('cap-bot').innerHTML = botPile.map(p => `<span>${PIECE_GLYPH[p]}</span>`).join('');
    const advTop = State.flipped ? -mat : mat; const advBot = -advTop;
    if (advTop > 0) $('cap-top').innerHTML += `<span class="adv">+${advTop}</span>`;
    if (advBot > 0) $('cap-bot').innerHTML += `<span class="adv">+${advBot}</span>`;
  }
  function renderMoves(){
    const t = $('moves-table'); t.innerHTML = '';
    if (State.history.length === 0){ t.innerHTML = `<div class="empty">${T.no_moves_yet}</div>`; return; }
    for (let i=0;i<State.history.length;i+=2){
      const row = document.createElement('div'); row.className = 'row';
      const w = State.history[i], b = State.history[i+1];
      const wActive = State.cursor === i+1 || (State.cursor < 0 && i+1 === State.history.length);
      const bActive = b && (State.cursor === i+2 || (State.cursor < 0 && i+2 === State.history.length));
      row.innerHTML = `<span class="n">${(i/2)+1}.</span>
        <span class="m ${wActive?'cur':''}" data-step="${i+1}">${w.san}</span>
        ${b ? `<span class="m ${bActive?'cur':''}" data-step="${i+2}">${b.san}</span>` : '<span></span>'}`;
      t.appendChild(row);
    }
    t.querySelectorAll('.m[data-step]').forEach(el => { el.onclick = () => scrubTo(+el.dataset.step); });
    t.scrollTop = t.scrollHeight;
  }

  /* ===== interaction ===== */
  let dragInfo = null;
  function onSqDown(e){
    if (State.over || State.cursor >= 0) return;
    if (State.mode === 'engine' && State.pos.turn !== State.humanColor) return;
    if (State.mode === 'online' && P2P.color && P2P.color !== State.pos.turn) return;
    const idx = +e.currentTarget.dataset.sq;
    const piece = State.pos.b[idx];
    if (State.selected >= 0){
      const move = State.legalForSel.find(m => m.to === idx);
      if (move){
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const onTapUp = (up) => {
          target.removeEventListener('pointerup', onTapUp);
          target.removeEventListener('pointercancel', onTapCancel);
          const overEl = document.elementFromPoint(up.clientX, up.clientY);
          const cell = overEl && overEl.closest('.sq');
          if (!cell || +cell.dataset.sq !== idx) return;
          if (move.promo){ openPromo(move, target); return; }
          doMove(move);
        };
        const onTapCancel = () => {
          target.removeEventListener('pointerup', onTapUp);
          target.removeEventListener('pointercancel', onTapCancel);
        };
        target.addEventListener('pointerup', onTapUp);
        target.addEventListener('pointercancel', onTapCancel);
        return;
      }
      if (piece !== ' ' && colorOf(piece) === State.pos.turn){ selectSq(idx); return; }
      State.selected = -1; State.legalForSel = []; render(); return;
    }
    if (piece !== ' ' && colorOf(piece) === State.pos.turn){
      selectSq(idx);
      dragInfo = { from: idx, startX: e.clientX, startY: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.addEventListener('pointermove', onPointerMove);
      e.currentTarget.addEventListener('pointerup', onPointerUp);
      e.currentTarget.addEventListener('pointercancel', onPointerUp);
    }
  }
  function onPointerMove(e){
    if (!dragInfo) return;
    if (!dragInfo.dragging && (Math.abs(e.clientX - dragInfo.startX)>4 || Math.abs(e.clientY - dragInfo.startY)>4)) dragInfo.dragging = true;
  }
  function onPointerUp(e){
    if (!dragInfo) return;
    const wasDragging = dragInfo.dragging, fromIdx = dragInfo.from;
    e.currentTarget.removeEventListener('pointermove', onPointerMove);
    e.currentTarget.removeEventListener('pointerup', onPointerUp);
    e.currentTarget.removeEventListener('pointercancel', onPointerUp);
    dragInfo = null;
    if (!wasDragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY); if (!el) return;
    const cell = el.closest('.sq'); if (!cell) return;
    const toIdx = +cell.dataset.sq; if (fromIdx === toIdx) return;
    const move = State.legalForSel.find(m => m.to === toIdx);
    if (!move){ State.selected = -1; State.legalForSel = []; render(); return; }
    if (move.promo){ openPromo(move, cell); return; }
    doMove(move);
  }
  function selectSq(idx){ State.selected = idx; State.legalForSel = genMoves(State.pos).filter(m => m.from === idx); render(); }
  function activateSquare(idx){
    if (State.over || State.cursor >= 0) return;
    if (State.mode === 'engine' && State.pos.turn !== State.humanColor) return;
    if (State.mode === 'online' && P2P.color && P2P.color !== State.pos.turn) return;
    const piece = State.pos.b[idx];
    if (State.selected >= 0){
      const move = State.legalForSel.find(m => m.to === idx);
      if (move){
        if (move.promo){ openPromo(move, cellEls.find(c => +c.dataset.sq === idx), true); return; }
        doMove(move); focusSquare(idx); return;
      }
      if (piece !== ' ' && colorOf(piece) === State.pos.turn){ selectSq(idx); return; }
      State.selected = -1; State.legalForSel = []; render(); return;
    }
    if (piece !== ' ' && colorOf(piece) === State.pos.turn) selectSq(idx);
  }
  function onBoardKey(e){
    const cell = e.target.closest && e.target.closest('.sq');
    if (!cell) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'){
      e.preventDefault(); e.stopPropagation(); activateSquare(+cell.dataset.sq); return;
    }
    const v = cellEls.indexOf(cell);
    if (v < 0) return;
    let r = Math.floor(v/8), c = v%8, handled = true;
    switch (e.key){
      case 'ArrowUp': r = Math.max(0, r-1); break;
      case 'ArrowDown': r = Math.min(7, r+1); break;
      case 'ArrowLeft': c = Math.max(0, c-1); break;
      case 'ArrowRight': c = Math.min(7, c+1); break;
      case 'Home': c = 0; break;
      case 'End': c = 7; break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault(); e.stopPropagation();
    const target = cellEls[r*8+c];
    State.focusSq = +target.dataset.sq; updateTabindex(); target.focus();
  }

  /* ===== promotion ===== */
  function closePromo(){ const pop = $('promo'); pop.style.display = 'none'; pop.onkeydown = null; State.pendingPromo = null; }
  function openPromo(m, cell, viaKeyboard){
    const pop = $('promo');
    pop.style.display = 'flex';
    pop.className = 'promo-popover ' + (State.pos.turn === 'b' ? 'b' : '');
    pop.setAttribute('role', 'group');
    pop.setAttribute('aria-label', T.promo_label);
    pop.innerHTML = '';
    State.pendingPromo = { move: m, viaKeyboard: !!viaKeyboard };
    const colorWord = State.pos.turn === 'w' ? T.color_white : T.color_black;
    const pieces = State.pos.turn === 'w' ? ['Q','R','B','N'] : ['q','r','b','n'];
    pieces.forEach((p) => {
      const btn = document.createElement('button'); btn.textContent = PIECE_GLYPH[p];
      btn.setAttribute('aria-label', colorWord + ' ' + PIECE_NAMES[p.toUpperCase()]);
      btn.onclick = () => { closePromo(); doMove({ ...m, promo: p.toUpperCase() }); if (viaKeyboard) focusSquare(m.to); };
      pop.appendChild(btn);
    });
    const shell = $('board-shell');
    const r = cell.getBoundingClientRect(), sr = shell.getBoundingClientRect();
    pop.style.left = Math.min(sr.width - 180, Math.max(4, r.left - sr.left)) + 'px';
    pop.style.top = Math.min(sr.height - 60, r.bottom - sr.top + 4) + 'px';
    pop.onkeydown = (e) => {
      const btns = Array.from(pop.querySelectorAll('button'));
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); const from = State.selected; closePromo(); if (viaKeyboard) focusSquare(from >= 0 ? from : m.from); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown'){ e.preventDefault(); e.stopPropagation(); btns[(i+1+btns.length)%btns.length].focus(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp'){ e.preventDefault(); e.stopPropagation(); btns[(i-1+btns.length)%btns.length].focus(); }
    };
    if (viaKeyboard){ const first = pop.querySelector('button'); if (first) first.focus(); }
  }

  /* ===== hint arrow ===== */
  function drawHintArrow(from, to){
    const svg = $('hint-arrow'); svg.style.display = 'block'; svg.setAttribute('viewBox', '0 0 8 8');
    const fr = State.flipped ? 7 - Math.floor(from/8) : Math.floor(from/8);
    const fc = State.flipped ? 7 - (from%8) : from%8;
    const tr = State.flipped ? 7 - Math.floor(to/8) : Math.floor(to/8);
    const tc = State.flipped ? 7 - (to%8) : to%8;
    const x1 = fc + 0.5, y1 = fr + 0.5, x2 = tc + 0.5, y2 = tr + 0.5;
    svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#22D3EE"/></marker></defs>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#22D3EE" stroke-width="0.16" stroke-linecap="round" marker-end="url(#ah)" opacity="0.8" />`;
    setTimeout(hideHintArrow, 3000);
  }
  function hideHintArrow(){ $('hint-arrow').style.display = 'none'; }

  /* ===== scrubbing ===== */
  function scrubTo(step){
    if (step < 0 || step > State.history.length) return;
    State.cursor = (step === State.history.length) ? -1 : step;
    State.selected = -1; State.legalForSel = []; render();
  }
  function backToLive(){ State.cursor = -1; render(); }
  function undo(){
    if (State.history.length === 0 || State.mode === 'online') return;
    cancelPendingEngine();
    const posAt = () => State.history.length ? applyMove(State.history[State.history.length-1].prePos, State.history[State.history.length-1].move) : startPos();
    State.history.pop();
    if (State.mode === 'engine'){
      while (State.history.length && posAt().turn !== State.humanColor) State.history.pop();
    }
    State.pos = posAt();
    State.cursor = -1; State.selected = -1; State.legalForSel = []; State.over = null;
    closeEndDialog();
    render(); save();
    if (State.mode === 'engine' && State.pos.turn !== State.humanColor) engineMove(); else analyze();
  }

  /* ===== game flow ===== */
  function newGame(keepMode = true){
    cancelPendingEngine();
    State.pos = startPos(); State.history = []; State.cursor = -1;
    State.selected = -1; State.legalForSel = []; State.over = null; State.ghostMove = null;
    if (!keepMode){ State.mode = 'hotseat'; State.humanColor = 'w'; State.flipped = false; }
    closeEndDialog(); hideHintArrow();
    render(); save();
    if (State.mode === 'online' && P2P.action && P2P.role === 'host'){ P2P.send({ kind:'sync', pos: State.pos, history: [] }); }
    if (State.mode === 'engine' && State.humanColor === 'b') engineMove(); else analyze();
  }
  async function resign(){
    if (State.over || State.history.length === 0) return;
    const ok = window.mentriaConfirm ? await window.mentriaConfirm(T.confirm_resign) : confirm(T.confirm_resign);
    if (!ok) return;
    const loser = State.mode === 'online' ? P2P.color : (State.mode === 'engine' ? State.humanColor : State.pos.turn);
    const winner = loser === 'w' ? 'b' : 'w';
    State.over = { type:'resigned', winner };
    if (State.mode === 'online' && P2P.action) P2P.send({ kind:'resign', winner });
    showEnd(State.over);
  }
  function endStrings(s){
    let eyebrow = '', title = '', reason = '';
    if (s.type === 'checkmate'){ eyebrow = T.eyebrow_checkmate; title = s.winner==='w'?T.win_white:T.win_black; reason = T.by_checkmate; }
    else if (s.type === 'stalemate'){ eyebrow = T.eyebrow_stalemate; title = T.draw; reason = T.by_stalemate; }
    else if (s.type === 'draw'){ eyebrow = T.eyebrow_draw; title = T.draw; reason = T['draw_'+s.reason] || T.draw; }
    else if (s.type === 'resigned'){ eyebrow = T.eyebrow_resigned; title = s.winner==='w'?T.win_white:T.win_black; reason = T.by_resignation; }
    return { eyebrow, title, reason };
  }
  function showEnd(s){
    const { eyebrow, title, reason } = endStrings(s);
    $('end-eyebrow').textContent = eyebrow; $('end-title').textContent = title; $('end-reason').textContent = reason;
    openEndDialog();
  }
  let endReturnFocus = null;
  function openEndDialog(){
    const bg = $('end-modal');
    if (!bg.classList.contains('show')) endReturnFocus = document.activeElement;
    bg.classList.add('show');
    const btn = $('btn-rematch');
    setTimeout(() => { try { btn.focus(); } catch(e){} }, 0);
  }
  function closeEndDialog(){
    const bg = $('end-modal');
    if (!bg.classList.contains('show')) return;
    bg.classList.remove('show');
    const ret = endReturnFocus; endReturnFocus = null;
    if (ret && document.contains(ret) && ret !== document.body){ try { ret.focus(); } catch(e){} }
    else focusSquare(State.focusSq);
  }
  function announceMove(san, status){
    let msg = san;
    if (status){
      const s = endStrings(status);
      msg += '. ' + s.title + ' ' + s.reason;
    } else {
      if (inCheck(State.pos, State.pos.turn)) msg += ', ' + T.a11y_check;
      msg += '. ' + T.a11y_turn.replace('{color}', State.pos.turn === 'w' ? T.color_white : T.color_black);
    }
    announce(msg);
  }

  /* ===== modes ===== */
  function setMode(m){
    State.mode = m;
    document.querySelectorAll('.modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    $('btn-swap').style.display = m === 'engine' ? '' : 'none';
    if (m === 'online'){ document.querySelectorAll('.mobile-tabs button').forEach(b => { if (b.dataset.tab==='connect') b.click(); }); }
    if (m !== 'online'){ if (P2P.room) P2P.cleanup(); const hp = $('host-panel'), gp = $('guest-panel'); if (hp) hp.style.display = 'none'; if (gp) gp.style.display = 'none'; }
    save();
  }
  function flip(){ State.flipped = !State.flipped; buildBoardCells(); render(); save(); }
  async function swapHumanColor(){
    const target = State.humanColor==='w' ? T.color_black : T.color_white;
    if (State.history.length > 0){
      const msg = T.confirm_new_color.replace('{color}', target);
      const ok = window.mentriaConfirm ? await window.mentriaConfirm(msg) : confirm(msg);
      if (!ok) return;
    }
    State.humanColor = State.humanColor === 'w' ? 'b' : 'w';
    State.flipped = State.humanColor === 'b';
    $('btn-swap').textContent = State.humanColor === 'w' ? T.play_black : T.play_white;
    newGame(true);
  }

  /* ===== P2P (Trystero) ===== */
  let iceCache = null, iceExp = 0;
  async function getIce(){
    const now = Date.now()/1000;
    if (iceCache && now < iceExp - 60) return iceCache;
    try { const r = await fetch('https://relay.mentria.ai/turn-cred', { cache:'no-store' }); const d = await r.json(); iceExp = now + (d.ttl||3600); iceCache = d.iceServers || [{ urls:'stun:turn.mentria.ai:3478' }]; }
    catch(_){ iceCache = [{ urls:'stun:turn.mentria.ai:3478' }]; }
    return iceCache;
  }
  function randCode(){
    const b = crypto.getRandomValues(new Uint8Array(5)); const alpha='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s=''; let bits=0,val=0; for (const x of b){ val=(val<<8)|x; bits+=8; while(bits>=5){ s+=alpha[(val>>>(bits-5))&31]; bits-=5; } } return s.slice(0,8);
  }
  const P2P = {
    room: null, action: null, role: null, color: null, peers: new Set(),
    setLed(state, label){ $('peer-led').className = 'dot-led ' + (state||''); $('peer-status').textContent = label; },
    cleanup(){
      if (this.room){ try { this.room.leave(); } catch(e){} }
      this.room = null; this.action = null; this.role = null; this.color = null; this.peers = new Set();
      this.setLed('', T.peer_offline);
    },
    async start(role, code){
      this.cleanup();
      const { joinRoom } = await import('/assets/vendor/trystero-nostr.js');
      const ice = await getIce();
      this.role = role; this.color = role === 'host' ? 'w' : 'b';
      this.room = joinRoom({ appId:'mentria-chess', relayConfig:{ urls:['wss://relay.mentria.ai'] }, rtcConfig:{ iceServers: ice } }, 'chess-' + code);
      this.action = this.room.makeAction('mv');
      this.action.onMessage = (data) => this.onMsg(data);
      this.room.onPeerJoin = (id) => {
        this.peers.add(id); this.setLed('on', T.peer_connected);
        if (this.role === 'host'){ this.send({ kind:'sync', pos: State.pos, history: State.history.map(h=>({move:h.move,san:h.san,key:h.key,prePos:h.prePos})) }); }
      };
      this.room.onPeerLeave = (id) => { this.peers.delete(id); this.setLed('warn', T.peer_disconnected); };
      State.mode = 'online';
      document.querySelectorAll('.modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'online'));
      $('btn-swap').style.display = 'none';
      if (role === 'guest'){ State.flipped = true; buildBoardCells(); }
      else { State.flipped = false; buildBoardCells(); }
      render();
      this.setLed('warn', role === 'host' ? T.peer_waiting : T.peer_connecting);
    },
    send(obj){ if (this.action) this.action.send(obj); },
    onMsg(m){
      if (!m || typeof m !== 'object') return;
      if (m.kind === 'move'){ doMove({ ...m.move, fromPeer: true }); }
      else if (m.kind === 'chat'){ appendChat('peer', m.text); }
      else if (m.kind === 'resign'){ State.over = { type:'resigned', winner: m.winner || P2P.color }; showEnd(State.over); }
      else if (m.kind === 'sync'){ State.pos = m.pos; State.history = m.history || []; State.over = null; closeEndDialog(); render(); }
    }
  };
  function appendChat(who, text){
    const list = $('chat-list');
    const div = document.createElement('div'); div.className = 'msg ' + (who === 'peer' ? 'peer' : '');
    div.innerHTML = `<span class="who">${who === 'peer' ? T.chat_peer : T.chat_you}:</span> ${escapeHtml(text)}`;
    list.appendChild(div); list.scrollTop = list.scrollHeight;
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function sendChat(){
    const inp = $('chat-input'); const v = inp.value.trim(); if (!v) return;
    inp.value = ''; appendChat('you', v);
    if (P2P.action) P2P.send({ kind:'chat', text: v.slice(0,200) });
  }

  /* ===== wire UI ===== */
  function wire(){
    $('btn-newgame').onclick = () => newGame(true);
    $('btn-flip').onclick = flip;
    $('btn-undo').onclick = undo;
    $('btn-resign').onclick = resign;
    $('btn-swap').onclick = swapHumanColor;
    $('btn-rematch').onclick = () => newGame(true);
    $('btn-hint').onclick = () => { pendingHint = true; askEngine(); };
    $('scrub-back').onclick = backToLive;

    document.querySelectorAll('.modes button').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
    document.querySelectorAll('#skill-pills button').forEach(b => {
      b.onclick = () => { State.skill = +b.dataset.skill; document.querySelectorAll('#skill-pills button').forEach(x => x.classList.toggle('active', x === b)); save(); };
    });

    $('btn-host').onclick = async () => {
      const code = randCode();
      $('room-code').value = code; $('host-panel').style.display = 'flex'; $('guest-panel').style.display = 'none';
      try { await P2P.start('host', code); } catch(e){ P2P.setLed('warn', T.peer_error); }
    };
    $('btn-guest').onclick = () => { $('guest-panel').style.display = 'flex'; $('host-panel').style.display = 'none'; setTimeout(()=>$('join-code').focus(), 50); };
    $('btn-join').onclick = async () => {
      const code = ($('join-code').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
      if (code.length < 6){ P2P.setLed('warn', T.room_invalid); return; }
      try { await P2P.start('guest', code); } catch(e){ P2P.setLed('warn', T.peer_error); }
    };
    $('btn-copy-code').onclick = () => { navigator.clipboard.writeText($('room-code').value).catch(()=>{}); $('btn-copy-code').textContent = T.copied; setTimeout(()=>$('btn-copy-code').textContent = T.copy, 1200); };
    $('btn-share-link').onclick = async () => {
      const code = $('room-code').value; if (!code) return;
      const url = location.origin + location.pathname + '?room=' + code;
      if (navigator.share){ try { await navigator.share({ title: document.title, url }); return; } catch (e){ if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); } catch (e){}
      const b = $('btn-share-link'); b.textContent = T.link_copied; setTimeout(() => b.textContent = T.share_link, 1400);
    };

    $('btn-send').onclick = sendChat;
    $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

    document.querySelectorAll('#mobile-tabs button').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('#mobile-tabs button').forEach(x => x.classList.toggle('active', x === b));
        const tab = b.dataset.tab;
        document.querySelectorAll('.right-col .panel').forEach(p => p.classList.toggle('show-tab', p.dataset.tab === tab));
        document.querySelector('.left-col').classList.toggle('show-tab', tab === 'engine');
      };
    });
    if (window.matchMedia('(max-width: 1024px)').matches){ document.querySelector('.right-col [data-tab="moves"]').classList.add('show-tab'); }

    const boardEl = $('board');
    boardEl.addEventListener('keydown', onBoardKey);
    boardEl.addEventListener('focusin', (e) => {
      const cell = e.target.closest && e.target.closest('.sq');
      if (!cell) return;
      State.focusSq = +cell.dataset.sq; updateTabindex();
    });
    $('end-modal').addEventListener('keydown', (e) => {
      if (!$('end-modal').classList.contains('show')) return;
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeEndDialog(); }
      else if (e.key === 'Tab'){ e.preventDefault(); $('btn-rematch').focus(); }
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft'){ const cur = State.cursor < 0 ? State.history.length : State.cursor; if (cur > 0) scrubTo(cur - 1); }
      else if (e.key === 'ArrowRight'){ const cur = State.cursor < 0 ? State.history.length : State.cursor; if (cur < State.history.length) scrubTo(cur + 1); }
      else if (e.key === 'Escape'){ if (State.pendingPromo) closePromo(); State.selected = -1; State.legalForSel = []; render(); }
      else if (e.key === 'r' || e.key === 'R'){ resign(); }
    });
  }

  /* ===== boot ===== */
  function boot(){
    if (!load()) State.pos = startPos();
    document.querySelectorAll('#skill-pills button').forEach(b => b.classList.toggle('active', +b.dataset.skill === State.skill));
    document.querySelectorAll('.modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === State.mode));
    $('btn-swap').style.display = State.mode === 'engine' ? '' : 'none';
    buildBoardCells(); bootWorker(); render(); wire();
    const status = gameStatus(State.pos, State.history);
    if (status){ State.over = status; showEnd(status); }
    else if (State.mode === 'engine' && State.pos.turn !== State.humanColor) engineMove();
    else analyze();

    const roomParam = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (roomParam.length >= 6){
      history.replaceState(null, '', location.pathname);
      $('join-code').value = roomParam;
      setMode('online');
      P2P.start('guest', roomParam).catch(() => P2P.setLed('warn', T.peer_error));
    }
  }
  boot();
})();
