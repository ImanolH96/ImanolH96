'use strict';

const STORE_KEY = 'comidas-libres:v1';
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'];
// A full free meal = the three parts; each part counts as 1/3.
const PARTS = [
  ['comida', 'Comida fuera del plan', '🍔'],
  ['alcohol', 'Alcohol', '🍷'],
  ['postre', 'Dulce', '🍰'],   // key stays 'postre' so saved data keeps working
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
  ['postre', 'Dulce'],
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
  $('whenMeal').textContent = meal;
  const away = fecha !== isoDate(new Date());
  const btn = $('dayBtn');
  const today = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
  const short = fecha === isoDate(today) ? 'Hoy' : fecha === isoDate(y) ? 'Ayer'
    : parseDate(fecha).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/^\w/, (c) => c.toUpperCase());
  $('dayBtnText').textContent = short;
  $('dayNext').disabled = !away;
  $('dayToday').disabled = !away;
  $('dayPill').classList.toggle('away', away);
  btn.setAttribute('aria-label', `Día: ${dayLabel(fecha).replace(/^de(l)? /, '')}. Cambiar día`);

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

// The day in "Cena de hoy ▾" opens a sheet with recent days as buttons plus a visible
// date field (an invisible date input over a button doesn't open the picker on iOS).
$('dayBtn').onclick = () => {
  const grid = $('dayGrid');
  grid.innerHTML = '';
  const current = currentDate();
  for (let i = 0; i <= 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = isoDate(d);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(iso === current));
    const wd = i === 0 ? 'hoy' : i === 1 ? 'ayer' : d.toLocaleDateString('es', { weekday: 'long' });
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

// ‹ › step one day at a time (never past today); » jumps to today
function stepDay(delta) {
  const d = parseDate(currentDate());
  d.setDate(d.getDate() + delta);
  useDay(isoDate(d));
}
$('dayPrev').onclick = () => stepDay(-1);
$('dayToday').onclick = () => useDay(isoDate(new Date()));
$('dayNext').onclick = () => stepDay(1);

// ---------- keypad ----------

function occasion(fecha, momento) {
  return state.entries.find((e) => e.fecha === fecha && e.momento === momento);
}

function renderPad() {
  if ($('dayList')) renderToday();
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
  const noun = { comida: 'Comida fuera del plan', alcohol: 'Alcohol', postre: 'Dulce' }[part];
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

// ---------- status: how a week / month is going ----------

// used and quota in thirds. Always shown with an icon and a label, never color alone.
function weekStatus(used, quota, finished) {
  if (!used) return { key: 'clean', icon: '★', label: 'Semana limpia' };
  if (used < quota) return { key: 'good', icon: '✓', label: finished ? 'Dentro del plan' : 'Vas bien' };
  if (used === quota) return { key: 'limit', icon: '=', label: 'Al límite' };
  return { key: 'over', icon: '!', label: 'Por encima del cupo' };
}

// "1 comida libre", "2 comidas libres"
const mealsWord = (n) => `${n} ${n === 1 ? 'comida libre' : 'comidas libres'}`;

// Progress bar in thirds: a tick at every whole free meal, a marker at the quota,
// and the part above the quota drawn in the "over" color.
function progressBar(used, quota) {
  const max = Math.max(quota, used, 3);
  const bar = document.createElement('span');
  bar.className = 'pbar';
  const pct = (v) => `${(v / max) * 100}%`;
  const within = Math.min(used, quota);
  bar.appendChild(Object.assign(document.createElement('i'), { className: 'fill', style: `width:${pct(within)}` }));
  if (used > quota) {
    bar.appendChild(Object.assign(document.createElement('i'), { className: 'fill extra', style: `left:${pct(quota)};width:${pct(used - quota)}` }));
  }
  for (let v = 3; v < max; v += 3) {
    bar.appendChild(Object.assign(document.createElement('i'), { className: v === quota && used > quota ? 'tick cupo' : 'tick', style: `left:${pct(v)}` }));
  }
  return bar;
}

function statusPill(st) {
  const p = document.createElement('span');
  p.className = `status s-${st.key}`;
  p.append(Object.assign(document.createElement('i'), { textContent: st.icon, ariaHidden: 'true' }), st.label);
  return p;
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
  const st = weekStatus(used, quota, !current);
  const big = $('weekLeft');
  big.className = `week-left s-${st.key}`;
  big.innerHTML = '';
  $('weekStatus').innerHTML = '';
  $('weekStatus').appendChild(statusPill(st));
  $('punch').className = `punch s-${st.key}`;
  if (!current) {
    big.append(fmtThirds(used), Object.assign(document.createElement('small'), {
      textContent: left < 0 ? `de ${mealsWord(quota / 3)} de la semana` : `de ${mealsWord(quota / 3)} usadas`,
    }));
  } else if (left >= 0) {
    big.append(fmtThirds(left), Object.assign(document.createElement('small'), {
      textContent: left === 3 ? 'comida libre disponible' : left > 0 && left < 3 ? 'de comida libre disponible' : 'comidas libres disponibles',
    }));
  } else {
    big.append(fmtThirds(used), Object.assign(document.createElement('small'), {
      textContent: `de ${mealsWord(quota / 3)} de la semana`,
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
  for (const e of sorted) list.appendChild(entryRow(e, `${e.momento} ${dayLabel(e.fecha)}`));
}

function entryRow(e, title) {
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
  t.textContent = title;
  const sub = document.createElement('span');
  const parts = PARTS.filter(([k]) => e.partes[k]).map(([, l]) => l.toLowerCase()).join(', ');
  sub.textContent = e.descripcion || e.notas || parts.charAt(0).toUpperCase() + parts.slice(1);
  what.append(t, sub);
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = fmtThirds(thirdsOf(e));
  b.append(dots, what, val);
  b.setAttribute('aria-label', `${title}: ${parts}. Editar`);
  li.appendChild(b);
  return li;
}

// ---------- Hoy tab: this week at a glance + the selected day's entries ----------

function renderToday() {
  const [from, to] = weekBounds();
  const used = thirdsBetween(from, to);
  const quota = (Number(state.settings.quota) || 0) * 3;
  const left = quota - used;
  const st = weekStatus(used, quota, false);
  const box = $('todaySummary');
  box.innerHTML = '';
  box.className = `today-sum s-${st.key}`;
  const head = document.createElement('span');
  head.className = 'head';
  head.append(Object.assign(document.createElement('small'), { textContent: 'Esta semana' }), statusPill(st));
  const text = `Usaste ${fmtThirds(used)} de ${mealsWord(quota / 3)}`;
  const note = left > 0 ? `Te quedan ${fmtThirds(left)}` : left === 0 ? 'Cupo completo' : `${fmtThirds(-left)} por encima del cupo`;
  box.append(head, Object.assign(document.createElement('b'), { textContent: text }), progressBar(used, quota),
    Object.assign(document.createElement('small'), { className: 'note', textContent: note }));
  box.setAttribute('aria-label', `Esta semana: ${text}. ${note}. ${st.label}. Ver semana`);

  const fecha = currentDate();
  const list = $('dayList');
  list.innerHTML = '';
  $('dayTitle').textContent = `Registros ${dayLabel(fecha)}`;
  const day = state.entries.filter((e) => e.fecha === fecha).sort((a, b) => a.hora.localeCompare(b.hora));
  if (!day.length) {
    list.appendChild(Object.assign(document.createElement('li'), {
      className: 'empty',
      textContent: fecha === isoDate(new Date()) ? 'Nada registrado hoy.' : 'Nada registrado ese día.',
    }));
  }
  for (const e of day) list.appendChild(entryRow(e, `${e.momento}, ${e.hora}`));
}

// ---------- tabs ----------

const TAB_TITLES = { hoy: 'Registrar', semana: 'Semana', mes: 'Mes' };
function showTab(t) {
  for (const k of Object.keys(TAB_TITLES)) {
    $(`tab-${k}`).hidden = k !== t;
    $(`tb-${k}`).setAttribute('aria-selected', String(k === t));
  }
  $('tabTitle').textContent = TAB_TITLES[t];
  hideTip();
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll('.tabbar button')) b.onclick = () => showTab(b.dataset.tab);
$('todaySummary').onclick = () => { goWeek(0); showTab('semana'); };

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
  const allowed = Math.round(((Number(state.settings.quota) || 0) * new Date(y, m + 1, 0).getDate() / 7) * 3);
  // compare against what the month allows up to today (whole month once it's over)
  const isCur = y === now.getFullYear() && m === now.getMonth();
  const daysSoFar = isCur ? now.getDate() : new Date(y, m + 1, 0).getDate();
  const allowedSoFar = Math.round(((Number(state.settings.quota) || 0) * daysSoFar / 7) * 3);
  let mst;
  if (!total) mst = { key: 'clean', icon: '★', label: 'Mes limpio' };
  else if (total > allowed) mst = { key: 'over', icon: '!', label: 'Por encima del límite' };
  else if (total > allowedSoFar) mst = { key: 'limit', icon: '=', label: 'Por encima del ritmo' };
  else mst = { key: 'good', icon: '✓', label: isCur ? 'Vas bien' : 'Dentro del plan' };
  $('monthTotal').append(
    Object.assign(document.createElement('b'), { textContent: fmtThirds(total) }),
    ` de ${fmtThirds(allowed)} comidas libres en el mes`,
    Object.assign(document.createElement('span'), { textContent: counts }),
  );
  $('monthStatus').innerHTML = '';
  $('monthStatus').appendChild(statusPill(mst));
  $('monthAdvice').textContent = isCur ? monthAdvice(total, allowed, new Date(y, m + 1, 0).getDate() - now.getDate() + 1, new Date(y, m + 1, 0)) : '';

  renderChart(y, m, inMonth);

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
    const st = weekStatus(used, quota, to < today);
    b.className = `wk s-${st.key}` + (offset === weekOffset ? ' on' : '');
    b.onclick = () => { weekOffset = offset; render(); showTab('semana'); };
    const icon = Object.assign(document.createElement('i'), { className: 'st', textContent: st.icon, ariaHidden: 'true' });
    const label = Object.assign(document.createElement('span'), { textContent: weekRangeLabel(from, to, true) });
    const bar = document.createElement('span');
    bar.className = 'wkbar';
    const fill = document.createElement('i');
    fill.style.width = `${quota ? Math.min(100, (used / quota) * 100) : used ? 100 : 0}%`;
    bar.appendChild(fill);
    const val = Object.assign(document.createElement('span'), {
      className: 'wkval',
      textContent: `${fmtThirds(used)} / ${quota / 3}`,
    });
    b.append(icon, label, bar, val);
    b.setAttribute('aria-label', `Semana del ${weekRangeLabel(from, to)}: ${fmtThirds(used)} de ${quota / 3}, ${st.label}. Ver semana`);
    li.appendChild(b);
    ul.appendChild(li);
    const next = parseDate(from); next.setDate(next.getDate() + 7);
    from = isoDate(next);
    const end = new Date(next); end.setDate(end.getDate() + 6);
    to = isoDate(end);
  }
}

// One sentence that turns the month's deviation into what's left to do.
// used/allowed in thirds; daysLeft counts today.
function monthAdvice(used, allowed, daysLeft, lastDate) {
  const quota = (Number(state.settings.quota) || 0) * 3;
  const left = allowed - used;
  const dias = daysLeft === 1 ? 'hoy' : `los ${daysLeft} días que faltan`;
  const next = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 1);
  const restart = `El 1 de ${MONTH(next)} arranca un mes nuevo.`;
  if (left < 0) return `Este mes ya estás ${fmtThirds(-left)} por encima del límite. ${restart}`;
  if (left === 0) return `Llegaste justo al límite del mes. ${restart}`;
  if (daysLeft < 7) return `Te quedan ${fmtThirds(left)} para ${dias} del mes.`;
  const perWeek = Math.floor((left * 7) / daysLeft); // thirds per week, rounded down
  if (perWeek >= quota) return `Te quedan ${fmtThirds(left)} para ${dias}. Podés seguir con tu cupo normal.`;
  return `Te quedan ${fmtThirds(left)} para ${dias}: unas ${fmtThirds(perWeek)} por semana para cerrar el mes en el plan.`;
}

// ---------- month chart: cumulative free meals vs. allowed pace ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const n = document.createElementNS(SVG_NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

let chartData = null; // what the hover layer reads

function renderCumulative(y, m, inMonth) {
  const days = new Date(y, m + 1, 0).getDate();
  const now = new Date();
  const isCurrent = y === now.getFullYear() && m === now.getMonth();
  const lastDay = isCurrent ? now.getDate() : days; // don't draw the future

  const perDay = new Array(days + 1).fill(0); // thirds logged on each day
  for (const e of inMonth) perDay[Number(e.fecha.slice(8, 10))] += thirdsOf(e);
  const cum = [0];
  for (let d = 1; d <= days; d++) cum[d] = cum[d - 1] + perDay[d];
  const quota = Number(state.settings.quota) || 0;
  const pace = (d) => (quota * d) / 7; // allowed free meals by the end of day d

  const W = 340, H = 180, L = 26, R = 40, T = 12, B = 24;
  const maxY = Math.max(1, Math.ceil(Math.max(cum[lastDay] / 3, pace(days))));
  const x = (d) => L + ((d - 0.5) / days) * (W - L - R);
  const yv = (v) => T + (1 - v / maxY) * (H - T - B);

  const svg = $('chart');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // grid + y ticks (clean integers)
  const step = maxY <= 5 ? 1 : maxY <= 10 ? 2 : 5;
  for (let v = 0; v <= maxY; v += step) {
    el('line', { x1: L, x2: W - R + 8, y1: yv(v), y2: yv(v), class: v === 0 ? 'axis' : 'grid' }, svg);
    el('text', { x: L - 8, y: yv(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = v;
  }
  // x ticks: weekly-ish plus the last day
  for (const d of [1, 8, 15, 22, days]) {
    el('text', { x: x(d), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = d;
  }

  // allowed pace
  el('line', { x1: x(0.5), y1: yv(pace(0)), x2: x(days + 0.5), y2: yv(pace(days)), class: 'pace' }, svg);
  el('text', { x: W - R + 4, y: yv(pace(days)) + 4, class: 'tick' }, svg).textContent = 'límite';

  // the way back to plan: from today's total to the month's allowance
  const allowedEnd = Math.round(pace(days) * 3) / 3;
  const showPath = isCurrent && lastDay < days && cum[lastDay] / 3 < allowedEnd;
  if (showPath) {
    el('line', { x1: x(lastDay + 0.5), y1: yv(cum[lastDay] / 3), x2: x(days + 0.5), y2: yv(allowedEnd), class: 'path' }, svg);
  }
  $('chartCaption').textContent = CAPTIONS.acum + (showPath ? ' La punteada es el margen que te queda hasta fin de mes.' : '');

  // cumulative step line (steps at the end of each day) + wash
  let d = `M${x(0.5)} ${yv(0)}`;
  for (let i = 1; i <= lastDay; i++) d += ` H${x(i - 0.5)} V${yv(cum[i] / 3)}`;
  d += ` H${x(lastDay + 0.5)}`;
  el('path', { d: `${d} V${yv(0)} H${x(0.5)} Z`, class: 'wash' }, svg);
  el('path', { d, class: 'series' }, svg);

  // end marker + direct label
  const endV = cum[lastDay] / 3;
  el('circle', { cx: x(lastDay + 0.5), cy: yv(endV), r: 5, class: 'end' + (endV > pace(lastDay) ? ' over' : '') }, svg);
  el('text', { x: Math.min(x(lastDay + 0.5) + 9, W - 4), y: yv(endV) - 8, class: 'endlabel', 'text-anchor': x(lastDay + 0.5) > W - R - 10 ? 'end' : 'start' }, svg)
    .textContent = fmtThirds(cum[lastDay]);

  // hover layer
  const cross = el('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }, svg);
  const dot = el('circle', { r: 5, class: 'end', visibility: 'hidden' }, svg);
  el('rect', { x: L, y: 0, width: W - L - R, height: H, class: 'hit' }, svg);
  chartData = { y, m, days, lastDay, perDay, cum, pace, x, yv, W, L, R, cross, dot };

  // table view for screen readers
  const rows = [];
  for (let i = 1; i <= lastDay; i++) if (perDay[i]) rows.push(`<tr><td>${i}</td><td>${fmtThirds(perDay[i])}</td><td>${fmtThirds(cum[i])}</td></tr>`);
  $('chartTable').innerHTML = `<caption>Comidas libres por día en ${MONTH(new Date(y, m, 1))}</caption>`
    + '<tr><th>Día</th><th>Ese día</th><th>Acumulado</th></tr>' + rows.join('');
  hideTip();
}

function hideTip() {
  $('chartTip').hidden = true;
  if (chartData) { chartData.cross.setAttribute('visibility', 'hidden'); chartData.dot.setAttribute('visibility', 'hidden'); }
}

function showTip(ev) {
  const c = chartData;
  if (!c) return;
  const svg = $('chart');
  const box = svg.getBoundingClientRect();
  const sx = ((ev.clientX - box.left) / box.width) * c.W;
  const day = Math.max(1, Math.min(c.lastDay, Math.round(((sx - c.L) / (c.W - c.L - c.R)) * c.days + 0.5)));
  const cx = c.x(day);
  c.cross.setAttribute('x1', cx); c.cross.setAttribute('x2', cx); c.cross.setAttribute('visibility', 'visible');
  c.dot.setAttribute('cx', cx); c.dot.setAttribute('cy', c.yv(c.cum[day] / 3)); c.dot.setAttribute('visibility', 'visible');
  const date = new Date(c.y, c.m, day).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const tip = $('chartTip');
  tip.innerHTML = '';
  tip.append(
    Object.assign(document.createElement('b'), { textContent: date }),
    Object.assign(document.createElement('span'), { textContent: `Acumulado: ${fmtThirds(c.cum[day])}` }),
    Object.assign(document.createElement('span'), { textContent: c.perDay[day] ? `Ese día: ${fmtThirds(c.perDay[day])}` : 'Ese día: nada' }),
    Object.assign(document.createElement('span'), { textContent: `Límite a la fecha: ${fmtThirds(Math.round(c.pace(day) * 3))}` }),
  );
  tip.hidden = false;
  tip.style.top = '0px';
  // sit beside the crosshair, on whichever side has room
  const px = (cx / c.W) * box.width;
  const w = tip.offsetWidth;
  tip.style.left = `${px + 12 + w <= box.width ? px + 12 : Math.max(0, px - 12 - w)}px`;
}

// ---------- other chart views ----------

const VIEWS = [
  ['acum', 'Acumulado'],
  ['semanas', 'Por semana'],
  ['momentos', 'Momentos'],
  ['calendario', 'Calendario'],
];
const CAPTIONS = {
  acum: 'Acumulado del mes. La línea fina es el límite según tus comidas libres por semana.',
  semanas: 'Cada columna es una semana entera, dividida en comida, alcohol y dulce. La línea es tu cupo semanal.',
  momentos: 'En qué momento del día caen las comidas libres del mes.',
  calendario: 'Cada día del mes; más intenso es más comida libre ese día.',
};
const chartView = () => (VIEWS.some(([k]) => k === state.settings.chartView) ? state.settings.chartView : 'acum');

function renderViewSwitch() {
  const box = $('chartSwitch');
  box.innerHTML = '';
  for (const [k, label] of VIEWS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(k === chartView()));
    b.onclick = () => { state.settings.chartView = k; persist(); renderMonth(); };
    box.appendChild(b);
  }
}

function renderChart(y, m, inMonth) {
  renderViewSwitch();
  const view = chartView();
  $('chartCaption').textContent = CAPTIONS[view];
  chartData = null;
  hideTip();
  if (view === 'acum') renderCumulative(y, m, inMonth);
  else if (view === 'semanas') renderWeekly(y, m);
  else if (view === 'momentos') renderMoments(y, m, inMonth);
  else renderCalendar(y, m, inMonth);
  renderLegend(view);
}

function renderLegend(view) {
  const lg = $('chartLegend');
  lg.innerHTML = '';
  if (view === 'acum') return; // one series: the caption names it
  if (view === 'calendario') {
    const sp = document.createElement('span');
    sp.style.gap = '4px';
    sp.append('Menos ');
    for (const o of [0, 1, 2, 3]) sp.append(Object.assign(document.createElement('i'), { className: `heat h${o}` }));
    sp.append(' Más');
    lg.appendChild(sp);
    return;
  }
  for (const [k, label] of PARTS) {
    const it = document.createElement('span');
    it.append(Object.assign(document.createElement('i'), { className: 'sw', style: `background:${PART_COLOR[k]}` }), k === 'comida' ? 'Comida' : label);
    lg.appendChild(it);
  }
}

// rect with only the top corners rounded (data-end), square at the baseline
function topRounded(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x} ${y + h} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h} Z`;
}
function rightRounded(x, y, w, h, r) {
  r = Math.min(r, w, h / 2);
  return `M${x} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x} Z`;
}

const partCounts = (list) => {
  const c = { comida: 0, alcohol: 0, postre: 0 };
  for (const e of list) for (const [k] of PARTS) if (e.partes[k]) c[k]++;
  return c;
};
const tipLines = (title, c) => [title,
  ...PARTS.filter(([k]) => c[k]).map(([k, l]) => `${k === 'comida' ? 'Comida' : l}: ${c[k]}`),
  `Total: ${fmtThirds(c.comida + c.alcohol + c.postre)}`].join('\n');

function renderWeekly(y, m) {
  const first = isoDate(new Date(y, m, 1));
  const last = isoDate(new Date(y, m + 1, 0));
  const today = isoDate(new Date());
  const weeks = [];
  let [from, to] = weekBounds(parseDate(first));
  while (from <= last && from <= today) {
    const list = state.entries.filter((e) => e.fecha >= from && e.fecha <= to);
    weeks.push({ from, to, c: partCounts(list) });
    const n = parseDate(from); n.setDate(n.getDate() + 7); from = isoDate(n);
    const t = new Date(n); t.setDate(t.getDate() + 6); to = isoDate(t);
  }
  const quota = Number(state.settings.quota) || 0;
  const W = 340, H = 210, L = 26, R = 42, T = 44, B = 26;
  const maxY = Math.max(1, Math.ceil(Math.max(quota, ...weeks.map((w) => (w.c.comida + w.c.alcohol + w.c.postre) / 3))));
  const yv = (v) => T + (1 - v / maxY) * (H - T - B);
  const svg = $('chart');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (let v = 0; v <= maxY; v += maxY <= 5 ? 1 : 2) {
    el('line', { x1: L, x2: W - R + 6, y1: yv(v), y2: yv(v), class: v === 0 ? 'axis' : 'grid' }, svg);
    el('text', { x: L - 8, y: yv(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = v;
  }
  const band = (W - L - R) / Math.max(weeks.length, 1);
  const bw = Math.min(24, band * 0.5);
  weeks.forEach((w, i) => {
    const cx = L + band * (i + 0.5);
    let acc = 0;
    const segs = PARTS.filter(([k]) => w.c[k]);
    const g = el('g', { 'data-tip': tipLines(`Semana del ${weekRangeLabel(w.from, w.to, true)}`, w.c) }, svg);
    segs.forEach(([k], j) => {
      const v = w.c[k] / 3;
      const y0 = yv(acc + v), h = yv(acc) - yv(acc + v);
      const gap = j ? 2 : 0; // surface gap between stacked segments
      const hh = Math.max(0, h - gap);
      if (j === segs.length - 1) el('path', { d: topRounded(cx - bw / 2, y0, bw, hh, 4), fill: PART_COLOR[k] }, g);
      else el('rect', { x: cx - bw / 2, y: y0, width: bw, height: hh, fill: PART_COLOR[k] }, g);
      acc += v;
    });
    el('rect', { x: cx - band / 2, y: T, width: band, height: H - T - B, class: 'hit' }, g);
    const total = w.c.comida + w.c.alcohol + w.c.postre;
    el('text', { x: cx, y: yv(acc) - 6, class: 'endlabel', 'text-anchor': 'middle' }, svg).textContent = fmtThirds(total);
    const st = weekStatus(total, quota * 3, w.to < today);
    const by = yv(acc) - 30;
    el('circle', { cx, cy: by, r: 8, class: `stdot s-${st.key}` }, svg);
    el('text', { x: cx, y: by + 4, class: 'sticon', 'text-anchor': 'middle' }, svg).textContent = st.icon;
    g.setAttribute('data-tip', g.getAttribute('data-tip') + '\n' + st.label);
    const f = parseDate(w.from), t = parseDate(w.to);
    el('text', { x: cx, y: H - 8, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = `${f.getDate()}–${t.getDate()}`;
  });
  el('line', { x1: L, x2: W - R + 6, y1: yv(quota), y2: yv(quota), class: 'pace' }, svg);
  el('text', { x: W - R + 8, y: yv(quota) + 4, class: 'tick' }, svg).textContent = 'cupo';
  tableFrom(['Semana', 'Comida', 'Alcohol', 'Dulce', 'Total'],
    weeks.map((w) => [weekRangeLabel(w.from, w.to, true), w.c.comida, w.c.alcohol, w.c.postre, fmtThirds(w.c.comida + w.c.alcohol + w.c.postre)]), 'Comidas libres por semana');
}

function renderMoments(y, m, inMonth) {
  const rows = MEALS.map((meal) => ({ meal, c: partCounts(inMonth.filter((e) => e.momento === meal)) }));
  const W = 340, rowH = 32, L = 78, R = 36, T = 6;
  const H = T + rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map((r) => (r.c.comida + r.c.alcohol + r.c.postre) / 3));
  const xv = (v) => L + (v / Math.ceil(max)) * (W - L - R);
  const svg = $('chart');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el('line', { x1: L, x2: L, y1: T, y2: H - 4, class: 'axis' }, svg);
  rows.forEach((r, i) => {
    const cy = T + rowH * (i + 0.5);
    el('text', { x: L - 10, y: cy + 4, class: 'cat', 'text-anchor': 'end' }, svg).textContent = r.meal;
    const g = el('g', { 'data-tip': tipLines(r.meal, r.c) }, svg);
    let acc = 0;
    const segs = PARTS.filter(([k]) => r.c[k]);
    segs.forEach(([k], j) => {
      const v = r.c[k] / 3;
      const x0 = xv(acc) + (j ? 2 : 0), w = Math.max(0, xv(acc + v) - xv(acc) - (j ? 2 : 0));
      if (j === segs.length - 1) el('path', { d: rightRounded(x0, cy - 9, w, 18, 4), fill: PART_COLOR[k] }, g);
      else el('rect', { x: x0, y: cy - 9, width: w, height: 18, fill: PART_COLOR[k] }, g);
      acc += v;
    });
    el('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, class: 'hit' }, g);
    const total = r.c.comida + r.c.alcohol + r.c.postre;
    el('text', { x: xv(acc) + 8, y: cy + 4, class: total ? 'endlabel' : 'tick' }, svg).textContent = total ? fmtThirds(total) : '0';
  });
  tableFrom(['Momento', 'Comida', 'Alcohol', 'Dulce', 'Total'],
    rows.map((r) => [r.meal, r.c.comida, r.c.alcohol, r.c.postre, fmtThirds(r.c.comida + r.c.alcohol + r.c.postre)]), 'Comidas libres por momento del día');
}

function renderCalendar(y, m, inMonth) {
  const days = new Date(y, m + 1, 0).getDate();
  const ws = state.settings.weekStart;
  const lead = (new Date(y, m, 1).getDay() - ws + 7) % 7;
  const rowsN = Math.ceil((lead + days) / 7);
  const W = 340, gap = 5, top = 20;
  const cell = (W - gap * 6) / 7;
  const cellH = Math.min(cell, 40);
  const H = top + rowsN * (cellH + gap);
  const today = isoDate(new Date());
  const svg = $('chart');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const names = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  for (let i = 0; i < 7; i++) {
    el('text', { x: i * (cell + gap) + cell / 2, y: 12, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = names[(i + ws) % 7];
  }
  const byDay = {};
  for (const e of inMonth) (byDay[e.fecha] = byDay[e.fecha] || []).push(e);
  const rows = [];
  for (let d = 1; d <= days; d++) {
    const iso = isoDate(new Date(y, m, d));
    const list = byDay[iso] || [];
    const c = partCounts(list);
    const t = c.comida + c.alcohol + c.postre;
    const i = lead + d - 1;
    const cx = (i % 7) * (cell + gap), cy = top + Math.floor(i / 7) * (cellH + gap);
    const future = iso > today;
    const date = new Date(y, m, d).toLocaleDateString('es', { weekday: 'long', day: 'numeric' });
    const g = el('g', future ? {} : { 'data-tip': t ? tipLines(date.charAt(0).toUpperCase() + date.slice(1), c) : `${date.charAt(0).toUpperCase() + date.slice(1)}\nSin comidas libres` }, svg);
    el('rect', { x: cx, y: cy, width: cell, height: cellH, rx: 8, class: `heat h${Math.min(3, t)}${future ? ' future' : ''}${iso === today ? ' today' : ''}` }, g);
    el('text', { x: cx + 6, y: cy + 14, class: t >= 2 ? 'daynum dark' : 'daynum' }, g).textContent = d;
    // secondary encoding: one tiny dot per part logged that day
    PARTS.filter(([k]) => c[k]).forEach(([k], j) => {
      el('circle', { cx: cx + cell - 8 - j * 7, cy: cy + cellH - 8, r: 2.5, fill: t >= 2 ? 'var(--ink-deep)' : PART_COLOR[k] }, g);
    });
    if (t) rows.push([d, c.comida, c.alcohol, c.postre, fmtThirds(t)]);
  }
  tableFrom(['Día', 'Comida', 'Alcohol', 'Dulce', 'Total'], rows, 'Comidas libres por día');
}

function tableFrom(head, rows, caption) {
  const esc = (v) => String(v).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  $('chartTable').innerHTML = `<caption>${esc(caption)}</caption><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`
    + rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
}

function showMarkTip(ev) {
  const g = ev.target.closest && ev.target.closest('[data-tip]');
  if (!g) { hideTip(); return; }
  const tip = $('chartTip');
  const [title, ...lines] = g.getAttribute('data-tip').split('\n');
  tip.innerHTML = '';
  tip.append(Object.assign(document.createElement('b'), { textContent: title }),
    ...lines.map((l) => Object.assign(document.createElement('span'), { textContent: l })));
  tip.hidden = false;
  // follow the finger: beside it horizontally, just above it vertically
  const wrap = $('chart').getBoundingClientRect();
  const px = ev.clientX - wrap.left, py = ev.clientY - wrap.top;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${px + 16 + w <= wrap.width ? px + 16 : Math.max(0, px - 16 - w)}px`;
  tip.style.top = `${Math.max(-h - 4, py - h - 12)}px`;
}

function onChartPointer(ev) {
  if (chartView() === 'acum') showTip(ev); else showMarkTip(ev);
}
$('chart').addEventListener('pointermove', onChartPointer);
$('chart').addEventListener('pointerdown', onChartPointer);
$('chart').addEventListener('pointerleave', hideTip);

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
  renderToday();
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
  if (!thirdsOf({ partes: editParts })) { toast('Marcá al menos comida, alcohol o dulce'); return; }
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
    'Dulce': weeks[w].postre,
    'Comidas libres': round2(weeks[w].thirds / 3),
    'Permitidas': quota,
    'Diferencia': round2(quota - weeks[w].thirds / 3),
  }));
  const ws2 = XLSX.utils.json_to_sheet(summary, {
    header: ['Semana desde', 'Comidas fuera del plan', 'Alcohol', 'Dulce', 'Comidas libres', 'Permitidas', 'Diferencia'],
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
    'Dulce': months[k].postre,
    'Comidas libres': round2(months[k].thirds / 3),
  })), { header: ['Mes', 'Comidas fuera del plan', 'Alcohol', 'Dulce', 'Comidas libres'] });

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
  // "Postre" was the column name before it was renamed to "Dulce"
  if (!('Dulce' in row) && 'Postre' in row) row = { ...row, Dulce: row.Postre };
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
  closeSheet('settingsSheet');
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
// Coming back after a while (30 min) resets Registrar to today, so a leftover "Ayer" isn't used by mistake.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 30 * 60 * 1000) { dayOffset = 0; pickedDate = null; pickedMeal = null; }
  render();
});
setInterval(render, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
