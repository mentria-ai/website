/* chess-engine.js — rules + search worker source. Classic script: globals shared with chess-app.js. */
// Board: 0..63, a8=0, h1=63. Pieces: lowercase=black, uppercase=white. " "=empty.

const FILES = "abcdefgh";
const PIECE_GLYPH = { K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙', k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' };

function startPos() {
  const b = Array(64).fill(' ');
  const back = "rnbqkbnr";
  for (let i=0;i<8;i++){ b[i]=back[i]; b[8+i]='p'; b[48+i]='P'; b[56+i]=back[i].toUpperCase(); }
  return { b, turn:'w', cas:'KQkq', ep:-1, half:0, full:1 };
}
function clonePos(p){ return { b: p.b.slice(), turn: p.turn, cas: p.cas, ep: p.ep, half: p.half, full: p.full }; }
function isW(c){ return c >= 'A' && c <= 'Z'; }
function isB(c){ return c >= 'a' && c <= 'z'; }
function colorOf(c){ if (c===' ') return null; return isW(c)?'w':'b'; }
function sqRC(s){ return [Math.floor(s/8), s%8]; }
function rcSq(r,c){ return r*8+c; }
function inB(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
function sqName(s){ const [r,c]=sqRC(s); return FILES[c] + (8-r); }
function nameSq(n){ return rcSq(8 - parseInt(n[1]), FILES.indexOf(n[0])); }

const N_DIRS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const K_DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const B_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const R_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

function attackedBy(pos, sq, byColor){
  const [r,c] = sqRC(sq);
  const pawnDir = byColor === 'w' ? 1 : -1;
  for (const dc of [-1,1]){
    const rr = r + pawnDir, cc = c + dc;
    if (inB(rr,cc)){
      const p = pos.b[rcSq(rr,cc)];
      if (p !== ' ' && colorOf(p) === byColor && p.toUpperCase() === 'P') return true;
    }
  }
  for (const [dr,dc] of N_DIRS){
    const rr=r+dr,cc=c+dc;
    if (inB(rr,cc)){ const p = pos.b[rcSq(rr,cc)]; if (p!==' ' && colorOf(p)===byColor && p.toUpperCase()==='N') return true; }
  }
  for (const [dr,dc] of K_DIRS){
    const rr=r+dr,cc=c+dc;
    if (inB(rr,cc)){ const p = pos.b[rcSq(rr,cc)]; if (p!==' ' && colorOf(p)===byColor && p.toUpperCase()==='K') return true; }
  }
  for (const [dr,dc] of B_DIRS){
    let rr=r+dr,cc=c+dc;
    while (inB(rr,cc)){
      const p = pos.b[rcSq(rr,cc)];
      if (p!==' '){ if (colorOf(p)===byColor && (p.toUpperCase()==='B' || p.toUpperCase()==='Q')) return true; break; }
      rr+=dr; cc+=dc;
    }
  }
  for (const [dr,dc] of R_DIRS){
    let rr=r+dr,cc=c+dc;
    while (inB(rr,cc)){
      const p = pos.b[rcSq(rr,cc)];
      if (p!==' '){ if (colorOf(p)===byColor && (p.toUpperCase()==='R' || p.toUpperCase()==='Q')) return true; break; }
      rr+=dr; cc+=dc;
    }
  }
  return false;
}

function findKing(pos, color){
  const target = color==='w' ? 'K' : 'k';
  for (let i=0;i<64;i++) if (pos.b[i]===target) return i;
  return -1;
}
function inCheck(pos, color){
  const k = findKing(pos, color);
  if (k === -1) return false;
  return attackedBy(pos, k, color==='w'?'b':'w');
}

function genMoves(pos){
  const moves = [];
  const us = pos.turn, them = us==='w'?'b':'w';
  for (let i=0;i<64;i++){
    const p = pos.b[i];
    if (p===' ' || colorOf(p)!==us) continue;
    const [r,c] = sqRC(i);
    const u = p.toUpperCase();
    if (u==='P'){
      const dir = us==='w' ? -1 : 1;
      const startRow = us==='w' ? 6 : 1;
      const promoRow = us==='w' ? 0 : 7;
      const fr = r+dir;
      if (inB(fr,c) && pos.b[rcSq(fr,c)]===' '){
        if (fr===promoRow){ for (const pr of ['Q','R','B','N']) moves.push({from:i,to:rcSq(fr,c),promo:pr}); }
        else {
          moves.push({from:i,to:rcSq(fr,c)});
          if (r===startRow && pos.b[rcSq(fr+dir,c)]===' ') moves.push({from:i,to:rcSq(fr+dir,c),double:true});
        }
      }
      for (const dc of [-1,1]){
        const nr=r+dir, nc=c+dc;
        if (!inB(nr,nc)) continue;
        const t = rcSq(nr,nc);
        const tp = pos.b[t];
        if (tp!==' ' && colorOf(tp)===them){
          if (nr===promoRow){ for (const pr of ['Q','R','B','N']) moves.push({from:i,to:t,promo:pr,capture:tp}); }
          else moves.push({from:i,to:t,capture:tp});
        } else if (t === pos.ep){ moves.push({from:i,to:t,ep:true,capture: us==='w'?'p':'P'}); }
      }
    } else if (u==='N'){
      for (const [dr,dc] of N_DIRS){
        const nr=r+dr, nc=c+dc;
        if (!inB(nr,nc)) continue;
        const t = rcSq(nr,nc); const tp = pos.b[t];
        if (tp===' ' || colorOf(tp)===them) moves.push({from:i,to:t,capture:tp===' '?undefined:tp});
      }
    } else if (u==='K'){
      for (const [dr,dc] of K_DIRS){
        const nr=r+dr, nc=c+dc;
        if (!inB(nr,nc)) continue;
        const t = rcSq(nr,nc); const tp = pos.b[t];
        if (tp===' ' || colorOf(tp)===them) moves.push({from:i,to:t,capture:tp===' '?undefined:tp});
      }
      if (us==='w' && i===60){
        if (pos.cas.includes('K') && pos.b[61]===' ' && pos.b[62]===' ' && pos.b[63]==='R'
            && !attackedBy(pos,60,'b') && !attackedBy(pos,61,'b') && !attackedBy(pos,62,'b')) moves.push({from:60,to:62,castle:'K'});
        if (pos.cas.includes('Q') && pos.b[59]===' ' && pos.b[58]===' ' && pos.b[57]===' ' && pos.b[56]==='R'
            && !attackedBy(pos,60,'b') && !attackedBy(pos,59,'b') && !attackedBy(pos,58,'b')) moves.push({from:60,to:58,castle:'Q'});
      } else if (us==='b' && i===4){
        if (pos.cas.includes('k') && pos.b[5]===' ' && pos.b[6]===' ' && pos.b[7]==='r'
            && !attackedBy(pos,4,'w') && !attackedBy(pos,5,'w') && !attackedBy(pos,6,'w')) moves.push({from:4,to:6,castle:'k'});
        if (pos.cas.includes('q') && pos.b[3]===' ' && pos.b[2]===' ' && pos.b[1]===' ' && pos.b[0]==='r'
            && !attackedBy(pos,4,'w') && !attackedBy(pos,3,'w') && !attackedBy(pos,2,'w')) moves.push({from:4,to:2,castle:'q'});
      }
    } else {
      const dirs = u==='B' ? B_DIRS : u==='R' ? R_DIRS : K_DIRS;
      for (const [dr,dc] of dirs){
        let nr=r+dr, nc=c+dc;
        while (inB(nr,nc)){
          const t = rcSq(nr,nc); const tp = pos.b[t];
          if (tp===' ') moves.push({from:i,to:t});
          else { if (colorOf(tp)===them) moves.push({from:i,to:t,capture:tp}); break; }
          nr+=dr; nc+=dc;
        }
      }
    }
  }
  const legal = [];
  for (const m of moves){ const np = applyMove(pos, m); if (!inCheck(np, us)) legal.push(m); }
  return legal;
}

function applyMove(pos, m){
  const np = clonePos(pos);
  const piece = np.b[m.from];
  np.b[m.from] = ' ';
  np.b[m.to] = m.promo ? (np.turn==='w' ? m.promo : m.promo.toLowerCase()) : piece;
  if (m.ep){ const epRow = np.turn==='w' ? Math.floor(m.to/8)+1 : Math.floor(m.to/8)-1; np.b[rcSq(epRow, m.to%8)] = ' '; }
  if (m.castle === 'K'){ np.b[63]=' '; np.b[61]='R'; }
  else if (m.castle === 'Q'){ np.b[56]=' '; np.b[59]='R'; }
  else if (m.castle === 'k'){ np.b[7]=' '; np.b[5]='r'; }
  else if (m.castle === 'q'){ np.b[0]=' '; np.b[3]='r'; }
  if (piece==='K') np.cas = np.cas.replace('K','').replace('Q','');
  if (piece==='k') np.cas = np.cas.replace('k','').replace('q','');
  if (m.from===63 || m.to===63) np.cas = np.cas.replace('K','');
  if (m.from===56 || m.to===56) np.cas = np.cas.replace('Q','');
  if (m.from===7  || m.to===7)  np.cas = np.cas.replace('k','');
  if (m.from===0  || m.to===0)  np.cas = np.cas.replace('q','');
  if (np.cas === '') np.cas = '-';
  np.ep = m.double ? (np.turn==='w' ? m.to+8 : m.to-8) : -1;
  if (piece.toUpperCase()==='P' || m.capture) np.half = 0; else np.half = pos.half + 1;
  if (np.turn==='b') np.full++;
  np.turn = np.turn==='w' ? 'b' : 'w';
  return np;
}

function moveToSAN(pos, m, allMoves){
  if (m.castle === 'K' || m.castle === 'k') return appendCheck(pos, m, 'O-O');
  if (m.castle === 'Q' || m.castle === 'q') return appendCheck(pos, m, 'O-O-O');
  const piece = pos.b[m.from];
  const u = piece.toUpperCase();
  let san = '';
  if (u === 'P'){
    if (m.capture || m.ep) san = FILES[m.from%8] + 'x' + sqName(m.to);
    else san = sqName(m.to);
    if (m.promo) san += '=' + m.promo;
  } else {
    san = u;
    const sameType = allMoves.filter(o => o.from !== m.from && o.to===m.to && pos.b[o.from] === piece);
    if (sameType.length){
      const fromName = sqName(m.from);
      const sameFile = sameType.some(o => sqName(o.from)[0] === fromName[0]);
      const sameRank = sameType.some(o => sqName(o.from)[1] === fromName[1]);
      if (!sameFile) san += fromName[0];
      else if (!sameRank) san += fromName[1];
      else san += fromName;
    }
    if (m.capture) san += 'x';
    san += sqName(m.to);
  }
  return appendCheck(pos, m, san);
}
function appendCheck(pos, m, san){
  const np = applyMove(pos, m);
  const opp = np.turn;
  if (inCheck(np, opp)){ const next = genMoves(np); san += next.length === 0 ? '#' : '+'; }
  return san;
}

function gameStatus(pos, history){
  const moves = genMoves(pos);
  if (moves.length === 0){ return inCheck(pos, pos.turn) ? { type:'checkmate', winner: pos.turn==='w'?'b':'w' } : { type:'stalemate' }; }
  if (pos.half >= 100) return { type:'draw', reason: '50-move' };
  const pcs = pos.b.filter(p => p!==' ' && p.toUpperCase()!=='K');
  if (pcs.length === 0) return { type:'draw', reason: 'insufficient' };
  if (pcs.length === 1 && (pcs[0].toUpperCase()==='B' || pcs[0].toUpperCase()==='N')) return { type:'draw', reason: 'insufficient' };
  const key = pos.b.join('') + pos.turn + pos.cas + pos.ep;
  let count = 1;
  for (const h of history){ if (h.key === key) count++; if (count >= 3) return { type:'draw', reason: 'threefold' }; }
  return null;
}
function posKey(pos){ return pos.b.join('') + pos.turn + pos.cas + pos.ep; }

const workerSource = `
const FILES="${FILES}";
${startPos.toString()}
${clonePos.toString()}
${isW.toString()}
${isB.toString()}
${colorOf.toString()}
${sqRC.toString()}
${rcSq.toString()}
${inB.toString()}
${sqName.toString()}
const N_DIRS=${JSON.stringify(N_DIRS)};
const K_DIRS=${JSON.stringify(K_DIRS)};
const B_DIRS=${JSON.stringify(B_DIRS)};
const R_DIRS=${JSON.stringify(R_DIRS)};
${attackedBy.toString()}
${findKing.toString()}
${inCheck.toString()}
${genMoves.toString()}
${applyMove.toString()}

const VAL = { P:100, N:320, B:330, R:500, Q:900, K:20000 };
const PST = {
  P: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  R: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  K: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
};
function evalPos(pos){
  let score = 0;
  for (let i=0;i<64;i++){
    const p = pos.b[i]; if (p===' ') continue;
    const u = p.toUpperCase(); const v = VAL[u];
    const idx = isW(p) ? i : (63 - i);
    score += isW(p) ? (v + PST[u][idx]) : -(v + PST[u][idx]);
  }
  return pos.turn === 'w' ? score : -score;
}
let nodes = 0; let stopAt = 0;
function search(pos, depth, alpha, beta){
  nodes++;
  if (Date.now() > stopAt) throw 'timeout';
  if (depth === 0) return evalPos(pos);
  const moves = genMoves(pos);
  if (moves.length === 0){ if (inCheck(pos, pos.turn)) return -29000 - depth; return 0; }
  moves.sort((a,b) => (b.capture?1:0) - (a.capture?1:0));
  let best = -Infinity;
  for (const m of moves){
    const np = applyMove(pos, m);
    const score = -search(np, depth-1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function pickMove(pos, maxDepth, timeMs, skill){
  const moves = genMoves(pos);
  if (moves.length === 0) return { move: null, eval: 0, depth: 0, lines: [] };
  nodes = 0; stopAt = Date.now() + timeMs;
  let best = moves[0]; let bestScore = -Infinity;
  let scored = moves.map(m => ({m, s:0}));
  let reachedDepth = 0;
  try {
    for (let d = 1; d <= maxDepth; d++){
      const localScored = [];
      for (const m of moves){ const np = applyMove(pos, m); const sc = -search(np, d-1, -Infinity, Infinity); localScored.push({m, s: sc}); }
      localScored.sort((a,b)=>b.s-a.s);
      scored = localScored; best = scored[0].m; bestScore = scored[0].s; reachedDepth = d;
      moves.sort((a,b)=>{ const ai = scored.findIndex(x=>x.m===a); const bi = scored.findIndex(x=>x.m===b); return ai - bi; });
    }
  } catch(e){}
  if (skill === 0 && scored.length > 1 && Math.random() < 0.3){ best = scored[1].m; bestScore = scored[1].s; }
  const lines = scored.slice(0, 3).map(x => ({ move: x.m, score: x.s, pv: pvFrom(pos, x.m, 4) }));
  return { move: best, eval: bestScore, depth: reachedDepth, nodes, lines };
}
function pvFrom(pos, firstMove, depth){
  const out = []; let cur = pos; let m = firstMove;
  for (let i=0;i<depth;i++){
    if (!m) break;
    const all = genMoves(cur);
    out.push(sanQuick(cur, m, all));
    cur = applyMove(cur, m);
    if (i < depth-1){
      const nm = genMoves(cur); if (nm.length === 0) break;
      let bestM = nm[0], bestS = -Infinity;
      for (const mm of nm){ const np = applyMove(cur, mm); const s = -evalPos(np); if (s > bestS){ bestS = s; bestM = mm; } }
      m = bestM;
    }
  }
  return out.join(' ');
}
function sanQuick(pos, m, allMoves){
  if (m.castle==='K' || m.castle==='k') return 'O-O';
  if (m.castle==='Q' || m.castle==='q') return 'O-O-O';
  const piece = pos.b[m.from]; const u = piece.toUpperCase();
  if (u==='P'){ let s = (m.capture||m.ep) ? FILES[m.from%8]+'x'+sqName(m.to) : sqName(m.to); if (m.promo) s += '='+m.promo; return s; }
  return u + (m.capture?'x':'') + sqName(m.to);
}
self.onmessage = (e) => {
  const { type, pos, depth, skill } = e.data;
  if (type === 'go'){
    const t0 = Date.now();
    const r = pickMove(pos, depth, 8000, skill);
    const t1 = Date.now();
    self.postMessage({ type: 'best', ...r, time: t1-t0 });
  }
};
`;
