import * as X from '/assets/js/mentria-extensions.js';

const DEFAULT_COPY = {
  trust: 'Install "{name}" v{version}? It runs with full access to this site. Permissions: {perms}.',
  update: 'Update "{name}" from v{old} to v{new}?',
  from: 'From {from} — ',
  large: ' ({kb} KB — large for local storage)'
};

function fmt(tpl, vars) { return tpl.replace(/\{(\w+)\}/g, (s, k) => (vars[k] != null ? vars[k] : s)); }

export async function confirmInstall(html, opts) {
  opts = opts || {};
  const copy = Object.assign({}, DEFAULT_COPY, opts.copy || {});
  const ins = X.inspect(html);
  const m = ins.manifest;
  let msg = ins.existing
    ? fmt(copy.update, { name: m.name, old: ins.existing.manifest.version, new: m.version })
    : fmt(copy.trust, { name: m.name, version: m.version, perms: (m.permissions || []).join(', ') || '—' });
  if (opts.from) msg = fmt(copy.from, { from: opts.from }) + msg;
  if (ins.warnLarge) msg += fmt(copy.large, { kb: Math.round(ins.size / 1024) });
  const ok = await (typeof window !== 'undefined' && window.mentriaConfirm ? window.mentriaConfirm(msg) : Promise.resolve(confirm(msg)));
  if (!ok) return null;
  return X.install(html, m);
}
