import * as X from '/assets/js/mentria-extensions.js';

const DEFAULT_COPY = {
  trust: 'Install "{name}" v{version}? It runs with full access to this site. Permissions: {perms}.',
  update: 'Update "{name}" from v{old} to v{new}?',
  reinstall: 'Reinstall "{name}" v{new}?',
  downgrade: 'Replace "{name}" v{old} with older v{new}?',
  replace: 'Replace "{oldName}" v{old} with "{name}" v{new}? It uses the same ID, so it takes over the saved data and runs with full access to this site.',
  permsAdded: 'New permissions: {perms}.',
  permsRemoved: 'No longer uses: {perms}.',
  from: 'From {from} — ',
  large: '({kb} KB — large for local storage)'
};

function fmt(tpl, vars) { return tpl.replace(/\{(\w+)\}/g, (s, k) => (vars[k] != null ? vars[k] : s)); }

function permNames(list, names) {
  return list.map((p) => (names && Object.prototype.hasOwnProperty.call(names, p) ? names[p] : p)).join(', ');
}

export async function confirmInstall(html, opts) {
  opts = opts || {};
  const copy = Object.assign({}, DEFAULT_COPY, opts.copy || {});
  const ins = X.inspect(html);
  const m = ins.manifest;
  let msg;
  if (ins.existing) {
    const prev = ins.existing.manifest;
    const renamed = !!(prev.name && m.name && prev.name !== m.name);
    const order = X.compareVersions(m.version, prev.version);
    const tpl = renamed ? copy.replace : (order < 0 ? copy.downgrade : (order === 0 ? copy.reinstall : copy.update));
    msg = fmt(tpl, { name: m.name, oldName: prev.name, old: prev.version, new: m.version });
    const prevPerms = prev.permissions || [];
    const nextPerms = m.permissions || [];
    const added = nextPerms.filter((p) => !prevPerms.includes(p));
    const removed = prevPerms.filter((p) => !nextPerms.includes(p));
    if (added.length) msg += ' ' + fmt(copy.permsAdded, { perms: permNames(added, opts.perms) });
    if (removed.length) msg += ' ' + fmt(copy.permsRemoved, { perms: permNames(removed, opts.perms) });
  } else {
    msg = fmt(copy.trust, { name: m.name, version: m.version, perms: permNames(m.permissions || [], opts.perms) || '—' });
  }
  if (opts.from) msg = fmt(copy.from, { from: opts.from }) + msg;
  if (ins.warnLarge) msg += ' ' + fmt(copy.large, { kb: Math.round(ins.size / 1024) });
  const ok = await (typeof window !== 'undefined' && window.mentriaConfirm ? window.mentriaConfirm(msg) : Promise.resolve(false));
  if (!ok) return null;
  return X.install(html, m);
}
