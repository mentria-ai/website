import * as U from '../ui.js';

const { h, t, icon } = U;

const ITEMS = [
  ['plan', 'plan'], ['budgets', 'budget'], ['subs', 'subs'], ['invest', 'invest'], ['accounts', 'accounts'],
  ['taxes', 'tax'], ['reports', 'reports'], ['import', 'import'], ['devices', 'devices'], ['settings', 'settings']
];

export function render(ctx) {
  const grid = h('div', { class: 'fmore' });
  for (const [route, ic] of ITEMS) {
    grid.append(h('button', { type: 'button', onclick: () => ctx.go(route) }, icon(ic), h('span', null, t('nav.' + route)), h('small', null, t('more.' + route))));
  }
  return { title: t('nav.more'), node: grid };
}
