import { h } from '../core/dom.js';
import { back } from '../core/router.js';

export function appbar(title, left, right) {
  return h('header', { class: 'appbar' }, left, h('h2', {}, title), right || h('span', { style: 'min-width:44px' }));
}

export const backBtn = () => h('button', { class: 'icon-btn text', onclick: back, 'aria-label': 'Volver' }, '‹ Volver');
