import { t, money, date as fmtDate } from './ui.js';
import * as db from './db.js';

function push() {
  try { return window.parent && window.parent !== window ? window.parent.MentriaPush || null : null; } catch (_) { return null; }
}

export function remindersSupported() {
  const P = push();
  return !!(P && P.isSupported && P.isSupported());
}

export function remindersAllowed() {
  const P = push();
  return !!(P && P.permission && P.permission() === 'granted');
}

export async function enableReminders() {
  const P = push();
  if (!P || !P.requestPermission) return false;
  return P.requestPermission();
}

function runUrl() {
  let prefix = '';
  try { const m = window.parent.location.pathname.match(/^\/(es|fr|ja|pt-br)\//); if (m) prefix = '/' + m[1]; } catch (_) {}
  return prefix + '/tools/extensions/run/?id=finance#/subs';
}

function fireTime(iso, daysBefore) {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(y, m - 1, d - daysBefore, 9, 0, 0, 0);
  return at.getTime();
}

export async function armReminders(ctx) {
  const P = push();
  const prev = (await db.getMeta('push_ids')) || [];
  if (P && P.cancel) for (const id of prev) { try { await P.cancel(id); } catch (_) {} }
  if (!ctx.local.reminders || !P || !remindersAllowed()) { if (prev.length) await db.setMeta({ push_ids: [] }); return 0; }
  const L = ctx.ledger;
  const s = L.settings();
  const showNames = !!ctx.local.reminder_names;
  const showAmounts = !!ctx.local.reminder_amounts;
  const ids = [];
  const now = Date.now();
  for (const u of L.upcoming(35)) {
    const sc = u.schedule;
    if (u.amount > 0) continue;
    const days = sc.notify_days == null || sc.notify_days < 0 ? (s.default_notify_days == null ? 1 : s.default_notify_days) : sc.notify_days;
    const fireAt = fireTime(u.date, days);
    if (fireAt < now + 60000) continue;
    const id = 'fin-' + sc.id.slice(0, 18) + '-' + u.date;
    const when = days === 0 ? t('reminders.today') : days === 1 ? t('reminders.tomorrow') : t('reminders.on', { date: fmtDate(u.date, 'dayMonth') });
    const title = showNames ? t('reminders.title_named', { name: sc.name, when }) : t('reminders.title', { when });
    const body = showAmounts ? money(Math.abs(u.amount), u.currency) + (sc.auto_post ? ' · ' + t('reminders.auto') : '') : t('reminders.body');
    try {
      const ok = await P.schedule({ id, fireAt, title, body, url: runUrl(), tag: 'finance-' + sc.id.slice(0, 18) });
      if (ok) ids.push(id);
    } catch (_) {}
    if (ids.length >= 20) break;
  }
  await db.setMeta({ push_ids: ids });
  return ids.length;
}
