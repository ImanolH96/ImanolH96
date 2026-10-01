import { h } from '../core/dom.js';
import { imgEl } from '../data/images.js';

let toastTimer;
export function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2400);
}

export function overlay(content, cls) {
  const el = h('div', { class: 'overlay ' + (cls || '') }, content);
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  document.body.append(el);
  return close;
}

export function sheet(title, buttons) {
  let close;
  const body = h('div', { class: 'sheet' },
    title && h('h3', {}, title),
    buttons.filter(Boolean).map(([label, fn, cls]) =>
      h('button', { class: 'btn ' + (cls || ''), onclick: () => { close(); fn(); } }, label)),
    h('button', { class: 'btn', onclick: () => close() }, 'Cancelar'));
  close = overlay(body);
}

export function lightbox(id) {
  const close = overlay(h('div', { onclick: () => close() }, imgEl(id)), 'lightbox');
}
