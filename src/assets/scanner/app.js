import { setCopy, setFull, host } from './ui.js';

setCopy(window.SCAN_COPY || {});
const root = document.getElementById('scan');
const ROUTES = {
  library: () => import('./views/library.js')
};
let unmount = null;
let token = 0;

export async function go(name, params) {
  const load = ROUTES[name];
  if (!load) return false;
  const my = ++token;
  const mod = await load();
  if (my !== token) return false;
  if (unmount) {
    try { unmount(); } catch (_) {}
    unmount = null;
  }
  setFull(false);
  root.textContent = '';
  unmount = mod.mount(root, { go }, params || {}) || null;
  return true;
}

const args = host && host.args;
go(args && args.cmd === 'scan' && ROUTES.capture ? 'capture' : 'library');
window.addEventListener('mentria:command', (e) => {
  const d = (e && e.detail) || {};
  if (d.cmd === 'scan' && ROUTES.capture) {
    e.preventDefault();
    go('capture');
  }
});
