// Hash router: '#/' list, '#/n/<id>' detail, '#/e/<id>' edit, '#/nuevo/<tipo>', '#/ia', '#/ajustes'.
// Routes are registered by main.js so this module knows nothing about the views.

let outlet;
let routes = {};
let currentName = '';
let leaveHook = null;
let listScroll = 0;

export function go(hash, replace) {
  if (replace) location.replace(hash); else location.hash = hash;
}

export function back() {
  if (history.length > 1) history.back(); else go('#/', true);
}

// A view calls this to release resources (e.g. a wake lock) when the user navigates away.
export function onLeave(fn) {
  leaveHook = fn;
}

function render() {
  if (leaveHook) { leaveHook(); leaveHook = null; }
  const [, name = '', arg] = (location.hash || '#/').split('/');
  const view = (routes[name] && routes[name](arg)) || routes[''](); // unknown route or missing note -> list
  currentName = routes[name] && view ? name : '';
  outlet.replaceChildren(view);
  window.scrollTo(0, currentName === '' ? listScroll : 0);
}

// routes: { name: (arg) => Node | null }. The '' route is the home/fallback.
export function startRouter(el, table) {
  outlet = el;
  routes = table;
  window.addEventListener('hashchange', () => {
    if (currentName === '') listScroll = window.scrollY; // come back to the same spot in the list
    render();
  });
  render();
}
