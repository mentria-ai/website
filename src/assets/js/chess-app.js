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
    play_black: 'play black', play_white: 'play white'
  }, window.CHESS_I18N || {});

  const State = {
    pos: startPos(), history: [], cursor: -1, flipped: false,
    mode: 'hotseat', humanColor: 'w', skill: 1,
    pendingPromo: null, selected: -1, legalForSel: [], ghostMove: null, over: null,
  };
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
  function engineMove(){
    if (State.over) return;
    pendingEngineCallback = (m) => { if (!m || State.over) return; doMove(m); };
    setTimeout(() => askEngine(), 250 + Math.random()*350);
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
    if (State.mode === 'online' && P2P.action && !m.fromPeer){ P2P.send({ kind:'move', move: m }); }
    if (status) return;
    if (State.mode === 'engine' && State.pos.turn !== State.humanColor) engineMove();
    else analyze();
  }

  /* ===== render ===== */
  function buildBoardCells(){
    const board = $('board'); board.innerHTML = '';
    for (let r=0;r<8;r++){
      for (let c=0;c<8;c++){
        const sq = document.createElement('div');
        sq.className = 'sq ' + (((r+c)%2===0)?'light':'dark');
        sq.dataset.sq = State.flipped ? rcSq(7-r, 7-c) : rcSq(r,c);
        sq.addEventListener('pointerdown', onSqDown);
        board.appendChild(sq);
      }
    }
    const ranks = $('coords-ranks'); ranks.innerHTML = '';
    const files = $('coords-files'); files.innerHTML = '';
    for (let i=0;i<8;i++){
      const rk = document.createElement('div'); rk.textContent = State.flipped ? (i+1) : (8-i); ranks.appendChild(rk);
      const fl = document.createElement('div'); fl.textContent = State.flipped ? FILES[7-i] : FILES[i]; files.appendChild(fl);
    }
  }
  function render(){
    const cells = $('board').children;
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
    renderCaptured(viewPos);
    renderMoves();
    $('scrub-back').classList.toggle('show', State.cursor >= 0);
    $('btn-undo').disabled = State.history.length === 0 || State.mode === 'online';
  }
  function renderCaptured(viewPos){
    const startCounts = { P:8, N:2, B:2, R:2, Q:1, p:8, n:2, b:2, r:2, q:1 };
    const cur = {};
    for (const p of viewPos.b) if (p !== ' ' && p.toUpperCase() !== 'K') cur[p] = (cur[p]||0)+1;
    const capByWhite = [], capByBlack = []; let mat = 0;
    const VAL = { P:1, N:3, B:3, R:5, Q:9 };
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
      if (move){ if (move.promo){ openPromo(move, e.currentTarget); return; } doMove(move); return; }
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

  /* ===== promotion ===== */
  function openPromo(m, cell){
    const pop = $('promo');
    pop.style.display = 'flex';
    pop.className = 'promo-popover ' + (State.pos.turn === 'b' ? 'b' : '');
    pop.innerHTML = '';
    const pieces = State.pos.turn === 'w' ? ['Q','R','B','N'] : ['q','r','b','n'];
    pieces.forEach((p) => {
      const btn = document.createElement('button'); btn.textContent = PIECE_GLYPH[p];
      btn.onclick = () => { pop.style.display = 'none'; doMove({ ...m, promo: p.toUpperCase() }); };
      pop.appendChild(btn);
    });
    const shell = $('board-shell');
    const r = cell.getBoundingClientRect(), sr = shell.getBoundingClientRect();
    pop.style.left = Math.min(sr.width - 180, Math.max(4, r.left - sr.left)) + 'px';
    pop.style.top = Math.min(sr.height - 60, r.bottom - sr.top + 4) + 'px';
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
    const posAt = () => State.history.length ? applyMove(State.history[State.history.length-1].prePos, State.history[State.history.length-1].move) : startPos();
    State.history.pop();
    if (State.mode === 'engine'){
      while (State.history.length && posAt().turn !== State.humanColor) State.history.pop();
    }
    State.pos = posAt();
    State.cursor = -1; State.selected = -1; State.legalForSel = []; State.over = null;
    $('end-modal').classList.remove('show');
    render(); save();
    if (State.mode === 'engine' && State.pos.turn !== State.humanColor) engineMove(); else analyze();
  }

  /* ===== game flow ===== */
  function newGame(keepMode = true){
    State.pos = startPos(); State.history = []; State.cursor = -1;
    State.selected = -1; State.legalForSel = []; State.over = null; State.ghostMove = null;
    if (!keepMode){ State.mode = 'hotseat'; State.humanColor = 'w'; State.flipped = false; }
    $('end-modal').classList.remove('show'); hideHintArrow();
    render(); save();
    if (State.mode === 'online' && P2P.action && P2P.role === 'host'){ P2P.send({ kind:'sync', pos: State.pos, history: [] }); }
    if (State.mode === 'engine' && State.humanColor === 'b') engineMove(); else analyze();
  }
  async function resign(){
    if (State.over || State.history.length === 0) return;
    const ok = window.mentriaConfirm ? await window.mentriaConfirm(T.confirm_resign) : confirm(T.confirm_resign);
    if (!ok) return;
    State.over = { type:'resigned', winner: State.pos.turn === 'w' ? 'b' : 'w' };
    if (State.mode === 'online' && P2P.action) P2P.send({ kind:'resign' });
    showEnd(State.over);
  }
  function showEnd(s){
    let eyebrow = '', title = '', reason = '';
    if (s.type === 'checkmate'){ eyebrow = T.eyebrow_checkmate; title = s.winner==='w'?T.win_white:T.win_black; reason = T.by_checkmate; }
    else if (s.type === 'stalemate'){ eyebrow = T.eyebrow_stalemate; title = T.draw; reason = T.by_stalemate; }
    else if (s.type === 'draw'){ eyebrow = T.eyebrow_draw; title = T.draw; reason = T['draw_'+s.reason] || T.draw; }
    else if (s.type === 'resigned'){ eyebrow = T.eyebrow_resigned; title = s.winner==='w'?T.win_white:T.win_black; reason = T.by_resignation; }
    $('end-eyebrow').textContent = eyebrow; $('end-title').textContent = title; $('end-reason').textContent = reason;
    $('end-modal').classList.add('show');
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
      else if (m.kind === 'resign'){ State.over = { type:'resigned', winner: State.pos.turn }; showEnd(State.over); }
      else if (m.kind === 'sync'){ State.pos = m.pos; State.history = m.history || []; State.over = null; $('end-modal').classList.remove('show'); render(); }
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

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft'){ const cur = State.cursor < 0 ? State.history.length : State.cursor; if (cur > 0) scrubTo(cur - 1); }
      else if (e.key === 'ArrowRight'){ const cur = State.cursor < 0 ? State.history.length : State.cursor; if (cur < State.history.length) scrubTo(cur + 1); }
      else if (e.key === 'Escape'){ State.selected = -1; State.legalForSel = []; render(); }
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
