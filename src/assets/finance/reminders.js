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

const LEAD = 60000;

function fireTime(iso, daysBefore) {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(y, m - 1, d - daysBefore, 9, 0, 0, 0);
  return at.getTime();
}

export function reminderSlot(iso, days, now, prevAt) {
  const planned = fireTime(iso, days);
  if (planned >= now + LEAD) return { at: planned, days };
  if (prevAt != null && prevAt < now + LEAD) return null;
  for (let d = days - 1; d >= 0; d--) {
    const at = fireTime(iso, d);
    if (at >= now + LEAD) return { at, days: d };
  }
  return null;
}

export async function armReminders(ctx) {
  const P = push();
  const prev = (await db.getMeta('push_ids')) || [];
  if (P && P.cancel) for (const id of prev) { try { await P.cancel(id); } catch (_) {} }
  if (!ctx.local.reminders || !P || !remindersAllowed()) { if (prev.length) await db.setMeta({ push_ids: [] }); return 0; }
  const prevAt = (await db.getMeta('push_at')) || {};
  const L = ctx.ledger;
  const s = L.settings();
  const showNames = !!ctx.local.reminder_names;
  const showAmounts = !!ctx.local.reminder_amounts;
  const ids = [];
  const at = {};
  const now = Date.now();
  for (const u of L.upcoming(35)) {
    const sc = u.schedule;
    if (u.amount > 0) continue;
    const days = sc.notify_days == null || sc.notify_days < 0 ? (s.default_notify_days == null ? 1 : s.default_notify_days) : sc.notify_days;
    const id = 'fin-' + sc.id.slice(0, 18) + '-' + u.date;
    const was = prevAt[id] != null ? prevAt[id] : prev.includes(id) ? 0 : null;
    const slot = reminderSlot(u.date, days, now, was);
    if (!slot) { if (was != null) at[id] = was; continue; }
    const when = slot.days === 0 ? t('reminders.today') : slot.days === 1 ? t('reminders.tomorrow') : t('reminders.on', { date: fmtDate(u.date, 'dayMonth') });
    const title = showNames ? t('reminders.title_named', { name: sc.name, when }) : t('reminders.title', { when });
    const body = showAmounts ? money(Math.abs(u.amount), u.currency) + (sc.auto_post && !L.scheduleOrphaned(sc) ? ' · ' + t('reminders.auto') : '') : t('reminders.body');
    try {
      const ok = await P.schedule({ id, fireAt: slot.at, title, body, url: runUrl(), tag: 'finance-' + sc.id.slice(0, 18) });
      if (ok) { ids.push(id); at[id] = slot.at; }
    } catch (_) {}
    if (ids.length >= 20) break;
  }
  await db.setMeta({ push_ids: ids, push_at: at });
  return ids.length;
}
