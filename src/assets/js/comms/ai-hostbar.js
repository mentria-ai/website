export const showHostBar = ({ text, stopLabel, onStop } = {}) => {
  const old = document.getElementById('ai-hostbar');
  if (old) old.remove();
  const bar = document.createElement('div');
  bar.id = 'ai-hostbar';
  bar.className = 'm-update m-ubar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  const msg = document.createElement('span');
  msg.className = 'm-update__text';
  msg.textContent = text || '';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'm-update__btn';
  stop.dataset.act = 'stop';
  stop.textContent = stopLabel || '';
  stop.addEventListener('click', () => { if (onStop) onStop(); });
  bar.append(msg, stop);
  document.body.append(bar);
  return {
    update(t) { msg.textContent = t || ''; },
    hide() { bar.remove(); }
  };
};
