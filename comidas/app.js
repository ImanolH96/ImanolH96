'use strict';

const STORE_KEY = 'comidas-libres:v1';
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'];
// A full free meal = the three parts; each part counts as 1/3.
const PARTS = [
  ['comida', 'Comida fuera del plan', '🍔'],
  ['alcohol', 'Alcohol', '🍷'],
  ['postre', 'Postre', '🍰'],
];
// Start time of each auto-detected meal; before breakfast counts as dinner (late night).
const DEFAULT_RANGES = { Desayuno: '05:00', Almuerzo: '11:00', Merienda: '15:30', Cena: '19:00' };
// Excel column headers <-> entry fields
const COLUMNS = [
  ['fecha', 'Fecha'],
  ['hora', 'Hora'],
  ['momento', 'Momento'],
  ['descripcion', 'Descripción'],
  ['lugar', 'Dónde / con quién'],
  ['comida', 'Comida fuera del plan'],
  ['alcohol', 'Alcohol'],
  ['postre', 'Postre'],
  ['valor', 'Valor (comidas libres)'],
  ['disfrute', 'Disfrute (1-5)'],
  ['notas', 'Notas'],
  ['id', 'ID'],
];

const $ = (id) => document.getElementById(id);

// ---------- storage ----------

function load() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { /* fall through to defaults */ }
  data = data || { settings: { quota: 2, weekStart: 1 }, entries: [] };
  data.settings.ranges = { ...DEFAULT_RANGES, ...data.settings.ranges };
  // Entries from before partial counting were full free meals.
  for (const e of data.entries) {
    if (!e.partes) e.partes = { comida: true, alcohol: true, postre: true };
  }
  return data;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('No se pudo guardar en el dispositivo');
  }
}

let state = load();
let dayOffset = 0;        // 0 = hoy, 1 = ayer, null = otro día (see pickedDate)
let pickedDate = null;    // "YYYY-MM-DD" when dayOffset is null
let pickedMeal = null;    // null = auto-detect from the clock
let editingId = null;
let editParts = {};
let weekOffset = 0;       // 0 = this week, 1 = last week, ...
let monthRef = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let freshWedges = 0;      // wedges to animate on next punch render

// Ask iOS not to evict our storage (best effort).
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function weekBounds(ref = new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const diff = (start.getDay() - state.settings.weekStart + 7) % 7;
  start.setDate(start.getDate() - diff);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return [isoDate(start), isoDate(end)];
}

// ---------- partial counting (in thirds, to avoid float rounding) ----------

const thirdsOf = (e) => PARTS.filter(([k]) => e.partes && e.partes[k]).length;

function fmtThirds(n) {
  const whole = Math.floor(n / 3);
  const frac = ['', '⅓', '⅔'][n % 3];
  if (!whole) return frac || '0';
  return whole + frac;
}

const fmtDay = (s) => parseDate(s).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });


// ---------- when: day + meal context for the keypad ----------

// time is "HH:MM"; zero-padded strings compare correctly.
function guessMeal(time) {
  const r = state.settings.ranges;
  if (time < r.Desayuno) return 'Cena';
  if (time < r.Almuerzo) return 'Desayuno';
  if (time < r.Merienda) return 'Almuerzo';
  if (time < r.Cena) return 'Merienda';
  return 'Cena';
}

function currentDate() {
  if (dayOffset === null) return pickedDate;
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  return isoDate(d);
}

function currentMeal() {
  return pickedMeal || guessMeal(isoTime(new Date()));
}

// Time stored for a tap: now when logging today, otherwise the start of the meal's range.
function currentTime(meal) {
  if (dayOffset === 0) return isoTime(new Date());
  return state.settings.ranges[meal] || '12:00';
}

function dayLabel(fecha) {
  const today = isoDate(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (fecha === today) return 'de hoy';
  if (fecha === isoDate(y)) return 'de ayer';
  return 'del ' + fmtDay(fecha);
}

// "la cena", "el almuerzo" — Spanish article for the meal name
const withArticle = (m) => (['Merienda', 'Cena'].includes(m) ? 'la ' : 'el ') + m.toLowerCase();

function renderWhen() {
  const meal = currentMeal();
  const fecha = currentDate();
  $('whenLine').innerHTML = '';
  $('whenLine').append(meal + ' ', Object.assign(document.createElement('span'), { textContent: dayLabel(fecha) }));

  const seg = $('segMeal');
  seg.innerHTML = '';
  for (const m of MEALS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m;
    b.setAttribute('aria-pressed', String(m === meal));
    b.onclick = () => {
      // tapping the auto-detected meal again goes back to automatic
      pickedMeal = m === guessMeal(isoTime(new Date())) ? null : m;
      renderWhen();
      renderPad();
    };
    seg.appendChild(b);
  }
  for (const b of $('segDay').querySelectorAll('button[data-day]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.day) === dayOffset));
  }
  $('dayOtherBtn').setAttribute('aria-pressed', String(dayOffset === null));
  $('dayOtherBtn').textContent = dayOffset === null ? fmtDay(pickedDate) : 'Otro día';
}

for (const b of $('segDay').querySelectorAll('button[data-day]')) {
  b.onclick = () => {
    dayOffset = Number(b.dataset.day);
    pickedDate = null;
    if (dayOffset === 0) pickedMeal = null; // back to today: meal follows the clock again
    renderWhen();
    renderPad();
  };
}
function useDay(v) {
  if (!v) return;
  const today = isoDate(new Date());
  if (v > today) { toast('Elegí hoy o un día anterior'); return; }
  if (v === today) { dayOffset = 0; pickedDate = null; pickedMeal = null; } else { dayOffset = null; pickedDate = v; }
  closeSheet('daySheet');
  renderWhen();
  renderPad();
}

// "Otro día": a sheet with the last days as buttons plus a visible date field
// (an invisible date input over a button doesn't open the picker on iOS).
$('dayOtherBtn').onclick = () => {
  const grid = $('dayGrid');
  grid.innerHTML = '';
  const current = currentDate();
  for (let i = 2; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = isoDate(d);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(iso === current));
    const wd = d.toLocaleDateString('es', { weekday: 'long' });
    b.append(wd.charAt(0).toUpperCase() + wd.slice(1),
      Object.assign(document.createElement('small'), { textContent: d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) }));
    b.onclick = () => useDay(iso);
    grid.appendChild(b);
  }
  $('dayPick').max = isoDate(new Date());
  $('dayPick').value = current;
  openSheet('daySheet');
};
$('dayUse').onclick = () => useDay($('dayPick').value);

// ---------- keypad ----------

function occasion(fecha, momento) {
  return state.entries.find((e) => e.fecha === fecha && e.momento === momento);
}

function renderPad() {
  const occ = occasion(currentDate(), currentMeal());
  for (const key of $('pad').querySelectorAll('.key')) {
    const part = key.dataset.part;
    let badge = key.querySelector('.done');
    const on = !!(occ && occ.partes[part]);
    if (on && !badge) {
      badge = document.createElement('span');
      badge.className = 'done';
      badge.textContent = '✓';
      key.appendChild(badge);
    } else if (!on && badge) {
      badge.remove();
    }
    const label = PARTS.find(([k]) => k === part)[1];
    key.setAttribute('aria-label', on ? `${label}: ya sumado en esta comida` : `Sumar ${label.toLowerCase()}`);
  }
}

function snapshot() {
  return JSON.stringify(state.entries);
}

function tap(part) {
  const fecha = currentDate();
  const momento = currentMeal();
  const noun = { comida: 'Comida fuera del plan', alcohol: 'Alcohol', postre: 'Postre' }[part];
  const where = `${withArticle(momento)} ${dayLabel(fecha)}`;
  const occ = occasion(fecha, momento);
  if (occ && occ.partes[part]) {
    toast(`${noun} ya estaba sumado en ${where}. Tocá el registro para editarlo.`);
    return;
  }
  const before = snapshot();
  if (occ) {
    occ.partes[part] = true;
  } else {
    state.entries.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      fecha,
      hora: currentTime(momento),
      momento,
      partes: { comida: false, alcohol: false, postre: false, [part]: true },
      descripcion: '',
      lugar: '',
      disfrute: 0,
      notas: '',
    });
  }
  persist();
  freshWedges = 1;
  if (weekOffsetOf(fecha) !== weekOffset) goWeek(weekOffsetOf(fecha)); else render();
  toast(`${noun} sumado a ${where}`.replace(' a el ', ' al '), () => {
    state.entries = JSON.parse(before);
    persist();
    render();
    toast('Deshecho');
  });
}

for (const key of $('pad').querySelectorAll('.key')) {
  key.addEventListener('click', () => tap(key.dataset.part));
}

// ---------- week punch card ----------

const PART_COLOR = { comida: 'var(--comida)', alcohol: 'var(--alcohol)', postre: 'var(--postre)' };

function wedgePath(i) {
  // third i of a circle centred at 24,24 with r=20, starting at 12 o'clock
  const r = 20, c = 24;
  const a0 = (-90 + i * 120) * Math.PI / 180;
  const a1 = (-90 + (i + 1) * 120) * Math.PI / 180;
  const p = (a) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  return `M${c} ${c} L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`;
}

const DAY_MS = 864e5;
const MONTH = (d) => d.toLocaleDateString('es', { month: 'long' });

function viewedWeek() {
  const d = new Date();
  d.setDate(d.getDate() - 7 * weekOffset);
  return weekBounds(d);
}

// How many weeks back from this week is the week containing `fecha`.
function weekOffsetOf(fecha) {
  const [now] = weekBounds();
  const [then] = weekBounds(parseDate(fecha));
  return Math.max(0, Math.round((parseDate(now) - parseDate(then)) / (7 * DAY_MS)));
}

function weekRangeLabel(from, to, short) {
  const f = parseDate(from), t = parseDate(to);
  const m = (d) => (short ? d.toLocaleDateString('es', { month: 'short' }).replace('.', '') : MONTH(d));
  return f.getMonth() === t.getMonth()
    ? `${f.getDate()} al ${t.getDate()} de ${m(t)}`
    : `${f.getDate()} de ${m(f)} al ${t.getDate()} de ${m(t)}`;
}

function thirdsBetween(from, to) {
  return state.entries.filter((e) => e.fecha >= from && e.fecha <= to).reduce((n, e) => n + thirdsOf(e), 0);
}

function renderWeek() {
  const [from, to] = viewedWeek();
  const week = state.entries
    .filter((e) => e.fecha >= from && e.fecha <= to)
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const wedges = [];
  for (const e of week) for (const [k] of PARTS) if (e.partes[k]) wedges.push(k);
  const used = wedges.length;
  const quota = (Number(state.settings.quota) || 0) * 3;
  const left = quota - used;

  const current = weekOffset === 0;
  const range = weekRangeLabel(from, to, true);
  $('weekTitle').textContent = current ? `Esta semana, ${range}`
    : weekOffset === 1 ? `Semana pasada, ${range}`
    : `Semana del ${range}`;
  $('wkNext').disabled = current;
  $('wkToday').hidden = current;
  const big = $('weekLeft');
  big.classList.toggle('over', left < 0);
  big.innerHTML = '';
  if (!current) {
    big.append(fmtThirds(used), Object.assign(document.createElement('small'), {
      textContent: left < 0 ? `de ${quota / 3} permitidas, te pasaste por ${fmtThirds(-left)}` : `de ${quota / 3} comidas libres usadas`,
    }));
  } else if (left >= 0) {
    big.append(fmtThirds(left), Object.assign(document.createElement('small'), {
      textContent: left === 3 ? 'comida libre disponible' : left > 0 && left < 3 ? 'de comida libre disponible' : 'comidas libres disponibles',
    }));
  } else {
    big.append('+' + fmtThirds(-left), Object.assign(document.createElement('small'), {
      textContent: 'por encima de lo permitido',
    }));
  }

  const circles = Math.max(quota / 3, Math.ceil(used / 3), 1);
  const ns = 'http://www.w3.org/2000/svg';
  const punch = $('punch');
  punch.innerHTML = '';
  for (let c = 0; c < circles; c++) {
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    const slot = document.createElementNS(ns, 'circle');
    slot.setAttribute('cx', 24); slot.setAttribute('cy', 24); slot.setAttribute('r', 21);
    slot.setAttribute('class', 'slot' + (c >= quota / 3 ? ' extra' : ''));
    svg.appendChild(slot);
    for (let i = 0; i < 3; i++) {
      const idx = c * 3 + i;
      if (idx >= used) break;
      const w = document.createElementNS(ns, 'path');
      w.setAttribute('d', wedgePath(i));
      w.setAttribute('fill', PART_COLOR[wedges[idx]]);
      w.setAttribute('class', 'wedge' + (idx >= used - freshWedges ? ' fresh' : ''));
      svg.appendChild(w);
    }
    for (let i = 0; i < 3; i++) {
      const a = (-90 + i * 120) * Math.PI / 180;
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', 24); l.setAttribute('y1', 24);
      l.setAttribute('x2', (24 + 21 * Math.cos(a)).toFixed(2)); l.setAttribute('y2', (24 + 21 * Math.sin(a)).toFixed(2));
      l.setAttribute('class', 'divider');
      svg.appendChild(l);
    }
    punch.appendChild(svg);
  }
  freshWedges = 0;
}

// ---------- log ----------

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  const [from, to] = viewedWeek();
  const sorted = state.entries
    .filter((e) => e.fecha >= from && e.fecha <= to)
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  $('logTitle').textContent = weekOffset === 0 ? 'Registros de esta semana' : `Registros del ${weekRangeLabel(from, to, true)}`;
  if (!sorted.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = weekOffset === 0
      ? 'Sin registros esta semana. Tocá una tecla cuando te des un gusto.'
      : 'Sin registros esa semana.';
    list.appendChild(li);
  }
  for (const e of sorted) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'entry';
    b.onclick = () => openEdit(e.id);

    const dots = document.createElement('span');
    dots.className = 'dots';
    for (const [k] of PARTS) {
      const d = document.createElement('span');
      d.className = 'dot';
      if (e.partes[k]) { d.style.background = PART_COLOR[k]; d.style.borderColor = PART_COLOR[k]; }
      dots.appendChild(d);
    }
    const what = document.createElement('span');
    what.className = 'what';
    const t = document.createElement('b');
    t.textContent = `${e.momento} ${dayLabel(e.fecha)}`;
    const sub = document.createElement('span');
    const parts = PARTS.filter(([k]) => e.partes[k]).map(([, l]) => l.toLowerCase()).join(', ');
    sub.textContent = e.descripcion || e.notas || parts.charAt(0).toUpperCase() + parts.slice(1);
    what.append(t, sub);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = fmtThirds(thirdsOf(e));
    b.append(dots, what, val);
    b.setAttribute('aria-label', `${e.momento} ${dayLabel(e.fecha)}: ${parts}. Editar`);
    li.appendChild(b);
    list.appendChild(li);
  }
}

// ---------- month ----------

function renderMonth() {
  const y = monthRef.getFullYear(), m = monthRef.getMonth();
  const first = isoDate(new Date(y, m, 1));
  const last = isoDate(new Date(y, m + 1, 0));
  const title = MONTH(monthRef);
  $('monthTitle').textContent = title.charAt(0).toUpperCase() + title.slice(1) + (y !== new Date().getFullYear() ? ` ${y}` : '');
  const now = new Date();
  $('moNext').disabled = y === now.getFullYear() && m === now.getMonth();

  const inMonth = state.entries.filter((e) => e.fecha >= first && e.fecha <= last);
  const total = inMonth.reduce((n, e) => n + thirdsOf(e), 0);
  const counts = PARTS.map(([k, , icon]) => `${icon} ${inMonth.filter((e) => e.partes[k]).length}`).join('   ');
  $('monthTotal').innerHTML = '';
  $('monthTotal').append(
    Object.assign(document.createElement('b'), { textContent: fmtThirds(total) }),
    total === 3 ? ' comida libre en el mes' : total > 0 && total < 3 ? ' de comida libre en el mes' : ' comidas libres en el mes',
    Object.assign(document.createElement('span'), { textContent: counts }),
  );

  // every week that touches the month, counted whole
  const quota = (Number(state.settings.quota) || 0) * 3;
  const ul = $('monthWeeks');
  ul.innerHTML = '';
  let [from, to] = weekBounds(parseDate(first));
  const today = isoDate(now);
  while (from <= last && from <= today) {
    const used = thirdsBetween(from, to);
    const offset = weekOffsetOf(from);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wk' + (offset === weekOffset ? ' on' : '');
    b.onclick = () => { weekOffset = offset; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const label = Object.assign(document.createElement('span'), { textContent: weekRangeLabel(from, to, true) });
    const bar = document.createElement('span');
    bar.className = 'wkbar';
    const fill = document.createElement('i');
    fill.style.width = `${quota ? Math.min(100, (used / quota) * 100) : used ? 100 : 0}%`;
    if (used > quota) fill.className = 'over';
    bar.appendChild(fill);
    const val = Object.assign(document.createElement('span'), {
      className: 'wkval' + (used > quota ? ' over' : ''),
      textContent: `${fmtThirds(used)} / ${quota / 3}`,
    });
    b.append(label, bar, val);
    b.setAttribute('aria-label', `Semana del ${weekRangeLabel(from, to)}: ${fmtThirds(used)} de ${quota / 3}. Ver semana`);
    li.appendChild(b);
    ul.appendChild(li);
    const next = parseDate(from); next.setDate(next.getDate() + 7);
    from = isoDate(next);
    const end = new Date(next); end.setDate(end.getDate() + 6);
    to = isoDate(end);
  }
}

$('moPrev').onclick = () => { monthRef = new Date(monthRef.getFullYear(), monthRef.getMonth() - 1, 1); renderMonth(); };
$('moNext').onclick = () => { monthRef = new Date(monthRef.getFullYear(), monthRef.getMonth() + 1, 1); renderMonth(); };

// week navigation (the month card follows the viewed week)
function goWeek(offset) {
  weekOffset = Math.max(0, offset);
  const [from] = viewedWeek();
  const d = parseDate(from);
  d.setDate(d.getDate() + 3); // the month a week "belongs" to: the one holding its middle day
  monthRef = new Date(d.getFullYear(), d.getMonth(), 1);
  const now = new Date();
  if (monthRef > now) monthRef = new Date(now.getFullYear(), now.getMonth(), 1);
  render();
}
$('wkPrev').onclick = () => goWeek(weekOffset + 1);
$('wkNext').onclick = () => goWeek(weekOffset - 1);
$('wkToday').onclick = () => goWeek(0);

function render() {
  renderWeek();
  renderWhen();
  renderPad();
  renderList();
  renderMonth();
}

// ---------- sheets ----------

function openSheet(id) { $(id).hidden = false; }
function closeSheet(id) { $(id).hidden = true; }
for (const scrim of document.querySelectorAll('.scrim')) {
  scrim.addEventListener('click', (ev) => {
    if (ev.target === scrim && scrim.id !== 'dialog') closeSheet(scrim.id);
    if (ev.target.closest('[data-close]')) closeSheet(scrim.id);
  });
}

function renderEditParts() {
  const box = $('editParts');
  box.innerHTML = '';
  for (const [k, label, icon] of PARTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!editParts[k]));
    b.append(Object.assign(document.createElement('span'), { textContent: icon }), k === 'comida' ? 'Comida' : label);
    b.onclick = () => { editParts[k] = !editParts[k]; renderEditParts(); };
    box.appendChild(b);
  }
}

function openEdit(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  editParts = { ...e.partes };
  $('editTitle').textContent = `${e.momento} ${dayLabel(e.fecha)}`;
  $('eDate').value = e.fecha;
  $('eTime').value = e.hora;
  $('eMeal').innerHTML = MEALS.map((m) => `<option${m === e.momento ? ' selected' : ''}>${m}</option>`).join('');
  $('eDesc').value = e.descripcion || '';
  $('eNotes').value = [e.lugar, e.notas].filter(Boolean).join(' — ');
  renderEditParts();
  openSheet('editSheet');
}

$('editForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!thirdsOf({ partes: editParts })) { toast('Marcá al menos comida, alcohol o postre'); return; }
  const e = state.entries.find((x) => x.id === editingId);
  if (!e) return;
  Object.assign(e, {
    fecha: $('eDate').value,
    hora: $('eTime').value,
    momento: $('eMeal').value,
    partes: { ...editParts },
    descripcion: $('eDesc').value.trim(),
    lugar: '',
    notas: $('eNotes').value.trim(),
  });
  persist();
  closeSheet('editSheet');
  render();
  toast('Cambios guardados');
});

$('eDelete').onclick = async () => {
  const before = snapshot();
  closeSheet('editSheet');
  state.entries = state.entries.filter((e) => e.id !== editingId);
  persist();
  render();
  toast('Registro borrado', () => { state.entries = JSON.parse(before); persist(); render(); toast('Deshecho'); });
};

// ---------- settings ----------

$('btnSettings').onclick = () => {
  $('sQuota').value = state.settings.quota;
  $('sWeekStart').value = String(state.settings.weekStart);
  for (const m of Object.keys(DEFAULT_RANGES)) $(`sRange${m}`).value = state.settings.ranges[m];
  openSheet('settingsSheet');
};

$('btnSaveSettings').onclick = () => {
  const ranges = {};
  for (const m of Object.keys(DEFAULT_RANGES)) ranges[m] = $(`sRange${m}`).value || DEFAULT_RANGES[m];
  const order = Object.values(ranges);
  if (order.some((t, i) => i && t <= order[i - 1])) {
    toast('Los horarios tienen que ir de desayuno a cena, en orden');
    return;
  }
  state.settings.quota = Math.max(0, parseInt($('sQuota').value, 10) || 0);
  state.settings.weekStart = Number($('sWeekStart').value);
  state.settings.ranges = ranges;
  persist();
  closeSheet('settingsSheet');
  render();
  toast('Ajustes guardados');
};

$('btnWipe').onclick = async () => {
  closeSheet('settingsSheet');
  const msg = '¿Borrar todos los registros? Si querés conservarlos, exportá el Excel antes.';
  if (await ask(msg, [['Borrar todo', 'ok', 'danger']]) !== 'ok') return;
  state.entries = [];
  persist();
  render();
  toast('Registros borrados');
};

// ---------- Excel ----------

async function exportXlsx() {
  const rows = [...state.entries]
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
    .map((e) => {
      const flat = { ...e, valor: Math.round((thirdsOf(e) / 3) * 100) / 100 };
      for (const [k] of PARTS) flat[k] = e.partes[k] ? 'Sí' : 'No';
      return Object.fromEntries(COLUMNS.map(([k, h]) => [h, flat[k] ?? '']));
    });
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(([, h]) => h) });
  ws['!cols'] = [12, 7, 11, 20, 9, 9, 20, 40, 22, 12, 40, 12].map((wch) => ({ wch }));

  // Weekly summary sheet
  const weeks = {};
  for (const e of state.entries) {
    const [from] = weekBounds(parseDate(e.fecha));
    const w = weeks[from] || (weeks[from] = { thirds: 0, comida: 0, alcohol: 0, postre: 0 });
    w.thirds += thirdsOf(e);
    for (const [k] of PARTS) if (e.partes[k]) w[k]++;
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  const quota = Number(state.settings.quota);
  const summary = Object.keys(weeks).sort().map((w) => ({
    'Semana desde': w,
    'Comidas fuera del plan': weeks[w].comida,
    'Alcohol': weeks[w].alcohol,
    'Postre': weeks[w].postre,
    'Comidas libres': round2(weeks[w].thirds / 3),
    'Permitidas': quota,
    'Diferencia': round2(quota - weeks[w].thirds / 3),
  }));
  const ws2 = XLSX.utils.json_to_sheet(summary, {
    header: ['Semana desde', 'Comidas fuera del plan', 'Alcohol', 'Postre', 'Comidas libres', 'Permitidas', 'Diferencia'],
  });

  const months = {};
  for (const e of state.entries) {
    const k = e.fecha.slice(0, 7);
    const mo = months[k] || (months[k] = { thirds: 0, comida: 0, alcohol: 0, postre: 0 });
    mo.thirds += thirdsOf(e);
    for (const [p] of PARTS) if (e.partes[p]) mo[p]++;
  }
  const ws3 = XLSX.utils.json_to_sheet(Object.keys(months).sort().map((k) => ({
    'Mes': k,
    'Comidas fuera del plan': months[k].comida,
    'Alcohol': months[k].alcohol,
    'Postre': months[k].postre,
    'Comidas libres': round2(months[k].thirds / 3),
  })), { header: ['Mes', 'Comidas fuera del plan', 'Alcohol', 'Postre', 'Comidas libres'] });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comidas');
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen semanal');
  XLSX.utils.book_append_sheet(wb, ws3, 'Resumen mensual');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const name = `comidas-libres-${isoDate(new Date())}.xlsx`;
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = new File([buf], name, { type });

  // iOS: the share sheet lets you "Guardar en Archivos", AirDrop, WhatsApp, etc.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cellToDate(v) {
  if (v instanceof Date) return isoDate(v);
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${pad(d.m)}-${pad(d.d)}`; }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : s.slice(0, 10);
}

function cellToTime(v) {
  if (typeof v === 'number') { const mins = Math.round((v % 1) * 1440); return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }
  return String(v || '00:00').trim().slice(0, 5);
}

const yes = (v) => /^(s[ií]|si|x|1|true|verdadero)$/i.test(String(v).trim());

function cellsToParts(row) {
  const cols = PARTS.map(([k]) => COLUMNS.find(([c]) => c === k)[1]);
  // Spreadsheets without part columns (older exports) are full free meals.
  if (!cols.some((h) => h in row)) return { comida: true, alcohol: true, postre: true };
  const partes = {};
  PARTS.forEach(([k], i) => { partes[k] = yes(row[cols[i]]); });
  if (!thirdsOf({ partes })) partes.comida = true;
  return partes;
}

async function importXlsx(file) {
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const ws = wb.Sheets['Comidas'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const imported = [];
  for (const r of rows) {
    const e = Object.fromEntries(COLUMNS.map(([k, h]) => [k, r[h]]));
    if (!e.fecha) continue;
    imported.push({
      id: String(e.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
      fecha: cellToDate(e.fecha),
      hora: cellToTime(e.hora),
      momento: MEALS.includes(e.momento) ? e.momento : 'Snack',
      partes: cellsToParts(r),
      descripcion: String(e.descripcion || ''),
      lugar: String(e.lugar || ''),
      disfrute: Math.max(0, Math.min(5, parseInt(e.disfrute, 10) || 0)),
      notas: String(e.notas || ''),
    });
  }
  if (!imported.length) { toast('No encontré filas válidas en el archivo'); return; }
  const choice = await ask(`Encontré ${imported.length} registros en el Excel.`, [
    ['Combinar con lo actual', 'merge'],
    ['Reemplazar todo', 'replace', 'danger'],
  ]);
  if (!choice) return;
  if (choice === 'replace') {
    state.entries = imported;
  } else {
    const byId = new Map(state.entries.map((e) => [e.id, e]));
    for (const e of imported) byId.set(e.id, e);
    state.entries = [...byId.values()];
  }
  persist();
  render();
  toast(`Importados ${imported.length} registros`);
}

$('btnExport').onclick = () => exportXlsx().catch(() => toast('No se pudo exportar'));
$('btnImport').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (f) importXlsx(f).catch(() => toast('No se pudo leer el archivo'));
};


// ---------- misc ----------

// In-page confirmation (native confirm() is unreliable in embedded views).
// actions: [label, value, variant?]; resolves to the chosen value, or null on cancel.
function ask(message, actions) {
  return new Promise((resolve) => {
    $('dialogMsg').textContent = message;
    const box = $('dialogActions');
    box.innerHTML = '';
    const close = (v) => { closeSheet('dialog'); resolve(v); };
    for (const [label, value, variant] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'solid' + (variant === 'danger' ? ' danger' : '');
      b.textContent = label;
      b.onclick = () => close(value);
      box.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'link';
    cancel.textContent = 'Cancelar';
    cancel.onclick = () => close(null);
    box.appendChild(cancel);
    openSheet('dialog');
  });
}

let toastTimer;
let toastUndo = null;
function toast(msg, undo) {
  $('toastMsg').textContent = msg;
  toastUndo = undo || null;
  $('toastUndo').hidden = !undo;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').classList.remove('show'); toastUndo = null; }, undo ? 5000 : 2600);
}
$('toastUndo').onclick = () => { const fn = toastUndo; toastUndo = null; if (fn) fn(); };

// Keep "today" and the auto-detected meal fresh when the app comes back to the foreground.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
setInterval(render, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
