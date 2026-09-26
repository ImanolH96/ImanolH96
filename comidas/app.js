'use strict';

const STORE_KEY = 'comidas-libres:v1';
const APP_VERSION = '66';
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'];
// A full free meal = the three parts; each part counts as 1/3.
const PARTS = [
  ['comida', 'Comida fuera del plan', '🍔'],
  ['alcohol', 'Alcohol', '🍷'],
  ['postre', 'Dulce', '🍰'],   // key stays 'postre' so saved data keeps working
];
// "¿Valió la pena?": three faces stored on the Excel's 1-5 enjoyment scale (0 = not rated)
const JOY = [[1, '😐', 'No tanto'], [3, '🙂', 'Estuvo bien'], [5, '😍', 'Valió la pena']];
const joyOf = (v) => (v ? JOY.reduce((a, b) => (Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a)) : null);
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
  ['completa', 'Completa (1 comida libre)'],
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
  data.alloc = data.alloc || {}; // playground: thirds assigned per week { 'YYYY-MM-DD' (week start): thirds }
  data.plans = data.plans || []; // planned free meals: birthdays, events… { id, fecha, momento, nombre, valor (thirds) }
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
let editCompleta = false;
let weekOffset = 0;       // 0 = this week, 1 = last week, ...
let monthRef = null; // key of the month/cycle shown in Mes (set on first render)
let freshWedges = 0;      // thirds to stamp on the next week-card render

// Ask iOS not to evict our storage (best effort).
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// With a plan start date (the nutritionist visit), weeks start on that weekday.
function weekStartDay() {
  return state.settings.cycleStart ? parseDate(state.settings.cycleStart).getDay() : state.settings.weekStart;
}

function weekBounds(ref = new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const diff = (start.getDay() - weekStartDay() + 7) % 7;
  start.setDate(start.getDate() - diff);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return [isoDate(start), isoDate(end)];
}

// ---------- partial counting (in thirds, to avoid float rounding) ----------

// A "completa" entry is a whole free meal on its own (e.g. a big off-plan meal), whatever parts it has.
const partsOf = (e) => PARTS.filter(([k]) => e.partes && e.partes[k]).length;
const thirdsOf = (e) => (e.completa ? 3 : partsOf(e));

// Units (Ajustes → "Contar en"): by default amounts are free meals in thirds (⅓, ⅔, 1⅓…).
// With settings.units = 'porciones' they're whole porciones instead: comida, alcohol or dulce = 1,
// a whole free meal = 3. Only the display changes; everything is stored and computed in thirds.
const inPorciones = () => state.settings.units === 'porciones';
const porciones = (n) => `${n} ${n === 1 ? 'porción' : 'porciones'}`;
// the weekly quota as a number in the current unit (thirds in): 2 comidas libres, or 6 porciones
const quotaN = (q) => (inPorciones() ? q : q / 3);
// "2 comidas libres" / "6 porciones" for an allowance in thirds
const allowanceWord = (a) => (inPorciones() ? porciones(a) : `${fmtThirds(a)} comidas libres`);
function fmtThirds(n) {
  if (inPorciones()) return String(n);
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

// thirds logged per meal on a day: { Cena: 2, Almuerzo: 3 }
function thirdsByMeal(fecha) {
  const out = {};
  for (const e of state.entries) if (e.fecha === fecha) out[e.momento] = (out[e.momento] || 0) + thirdsOf(e);
  return out;
}

// On opening (and when switching days) land on a meal that already has something logged:
// the clock's meal if it has entries, otherwise the latest meal logged that day; else the clock decides.
function landingMeal(fecha) {
  const guess = guessMeal(isoTime(new Date()));
  const day = state.entries.filter((e) => e.fecha === fecha);
  if (!day.length) return undefined;                 // nothing logged: leave the meal as it is
  if (day.some((e) => e.momento === guess)) return null; // the clock's meal (automatic)
  return day.reduce((a, b) => (b.hora > a.hora ? b : a)).momento;
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
  renderStrip();

  const seg = $('segMeal');
  seg.innerHTML = '';
  const logged = thirdsByMeal(fecha);
  for (const m of MEALS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m;
    b.setAttribute('aria-pressed', String(m === meal));
    if (logged[m]) {
      // meals that already have something logged get a dot, so they're easy to spot
      b.classList.add('has');
      b.append(Object.assign(document.createElement('span'), { className: 'dot', ariaHidden: 'true' }));
      b.setAttribute('aria-label', `${m}, con registros`);
    }
    b.onclick = () => {
      // tapping the auto-detected meal again goes back to automatic
      pickedMeal = m === guessMeal(isoTime(new Date())) ? null : m;
      renderWhen();
      renderPad();
    };
    seg.appendChild(b);
  }
}

// ---------- week strip: pick the day to log ----------

let stripOffset = 0; // weeks back from this week shown in the strip

// Logging is limited to the current month (or cycle).
function firstOfMonth() {
  if (state.settings.cycleStart) { const k = currentMonthKey(); return monthSpan(k.getFullYear(), k.getMonth()).from; }
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function renderStrip() {
  const ref = new Date();
  ref.setDate(ref.getDate() - 7 * stripOffset);
  const [from] = weekBounds(ref);
  const today = isoDate(new Date());
  const selected = currentDate();
  const start = parseDate(from);
  const first = firstOfMonth();
  const month = MONTH(new Date());
  const ck = currentMonthKey();
  $('stripMonth').textContent = state.settings.cycleStart ? `Ciclo ${periodTitle(ck.getFullYear(), ck.getMonth())}` : month.charAt(0).toUpperCase() + month.slice(1);
  $('dayNext').disabled = stripOffset === 0;
  $('dayPrev').disabled = stripOffset >= weekOffsetOf(first);
  $('dayToday').hidden = selected === today && stripOffset === 0;

  const box = $('stripDays');
  box.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = isoDate(d);
    const list = state.entries.filter((e) => e.fecha === iso);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sday' + (iso === today ? ' today' : '');
    b.disabled = iso > today || iso < first;
    b.setAttribute('aria-pressed', String(iso === selected));
    const wd = d.toLocaleDateString('es', { weekday: 'short' }).replace('.', '');
    b.append(Object.assign(document.createElement('small'), { textContent: iso === today ? 'Hoy' : wd.charAt(0).toUpperCase() }),
      Object.assign(document.createElement('b'), { textContent: d.getDate() }));
    // a dot under days that have something logged
    b.append(Object.assign(document.createElement('i'), { className: list.length ? 'mark on' : 'mark', ariaHidden: 'true' }));
    const long = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
    const n = list.reduce((t, e) => t + thirdsOf(e), 0);
    b.setAttribute('aria-label', `${iso === today ? 'Hoy, ' : ''}${long}${n ? `, ${fmtThirds(n)} registrado` : ''}`);
    b.onclick = () => useDay(iso);
    box.appendChild(b);
  }
}

function useDay(v) {
  if (!v) return;
  const today = isoDate(new Date());
  if (v > today || v < firstOfMonth()) return;
  if (v === today) { dayOffset = 0; pickedDate = null; } else { dayOffset = null; pickedDate = v; }
  const landing = landingMeal(v);
  if (landing !== undefined) pickedMeal = landing; else if (v === today) pickedMeal = null;
  stripOffset = weekOffsetOf(v);
  renderWhen();
  renderPad();
}

// ‹ › browse the month's weeks in the strip; "Hoy" jumps back
$('dayPrev').onclick = () => { stripOffset = Math.min(weekOffsetOf(firstOfMonth()), stripOffset + 1); renderStrip(); };
$('dayNext').onclick = () => { stripOffset = Math.max(0, stripOffset - 1); renderStrip(); };
$('dayToday').onclick = () => useDay(isoDate(new Date()));

// ---------- keypad ----------

// The entry the keypad acts on for a day and meal. A whole free meal is its own entry,
// separate from the one holding the ⅓ parts, so the two always add up.
function occasion(fecha, momento, completa = false) {
  return state.entries.find((e) => e.fecha === fecha && e.momento === momento && !!e.completa === completa);
}

function renderPad() {
  if ($('dayList')) renderToday();
  const occ = occasion(currentDate(), currentMeal());
  const whole = occasion(currentDate(), currentMeal(), true);
  for (const key of $('pad').querySelectorAll('.key')) {
    const part = key.dataset.part;
    const on = part === 'completa' ? !!whole : !!(occ && occ.partes[part]);
    key.classList.toggle('on', on);
    const label = SERIES.find(([k]) => k === part)[1];
    key.setAttribute('aria-pressed', String(on));
    key.setAttribute('aria-label', on ? `${label}: sumado. Tocá para sacarlo` : `Sumar ${part === 'completa' ? 'comida libre completa' : label.toLowerCase()}`);
  }
}

function snapshot() {
  return JSON.stringify(state.entries);
}

function tap(part) {
  const fecha = currentDate();
  const momento = currentMeal();
  const whole = part === 'completa';
  const noun = { comida: 'Comida fuera del plan', alcohol: 'Alcohol', postre: 'Dulce', completa: 'Comida libre completa' }[part];
  const where = `${withArticle(momento)} ${dayLabel(fecha)}`;
  const fem = whole || part === 'comida'; // "comida … sumada", "alcohol … sumado"
  const occ = occasion(fecha, momento, whole);
  const before = snapshot();
  const undo = () => {
    state.entries = JSON.parse(before);
    persist();
    render();
    toast('Deshecho');
  };
  // keys toggle: tapping what's already in this meal takes it out
  if (occ && (whole || occ.partes[part])) {
    if (!whole) occ.partes[part] = false;
    const empty = whole || !thirdsOf(occ);
    if (empty) state.entries = state.entries.filter((e) => e !== occ);
    persist();
    render();
    toast((empty && !whole ? `Registro de ${where} borrado` : `${noun} ${fem ? 'sacada' : 'sacado'} de ${where}`).replace(' de el ', ' del '), undo);
    return;
  }
  let target = occ;
  if (occ) {
    occ.partes[part] = true;
  } else {
    target = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      fecha,
      hora: currentTime(momento),
      momento,
      partes: { comida: false, alcohol: false, postre: false, ...(whole ? {} : { [part]: true }) },
      completa: whole,
      descripcion: '',
      lugar: '',
      disfrute: 0,
      notas: '',
    };
    state.entries.push(target);
  }
  persist();
  const added = whole ? 3 : 1;
  freshWedges = added;
  hurt(added, document.querySelector(`.key[data-part="${part}"]`), whole);
  if (weekOffsetOf(fecha) !== weekOffset) goWeek(weekOffsetOf(fecha)); else render();
  toast(`${noun} ${fem ? 'sumada' : 'sumado'} a ${where}`.replace(' a el ', ' al '), undo, target.id);
}

// a haptic tick: Android has vibrate(); iOS Safari (18+) has no API, but toggling a native
// <input switch> through its label plays the system tick, so a hidden one does the job
const haptic = (() => {
  if (navigator.vibrate) return () => navigator.vibrate(12);
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9px;top:0';
  const sw = document.createElement('input');
  sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.tabIndex = -1;
  label.append(sw); document.body.append(label);
  return () => label.click();
})();

// the dial's soft shadows, faked without SVG filters (they lag on iOS): many thin copies of the key's
// shape, each a touch wider and nearly transparent, stack into a smooth falloff instead of visible bands
for (const key of $('pad').querySelectorAll('.key')) {
  const shape = key.querySelector('.face');
  const stack = (group, maxWidth, alpha) => {
    for (let w = maxWidth; w >= 2; w -= 2) {
      const layer = shape.cloneNode();
      layer.removeAttribute('class');
      layer.setAttribute('stroke-width', w);
      layer.setAttribute('opacity', alpha);
      group.append(layer);
    }
  };
  // the side wall: one copy per pixel of depth, darkening downwards, so it reads as a single solid
  // extruded body instead of a second slab behind the cap
  const side = key.querySelector('.side');
  const deep = `var(--${key.dataset.part}-deep)`;
  for (let y = 9; y >= 1; y--) {
    const layer = shape.cloneNode();
    layer.removeAttribute('class');
    layer.setAttribute('transform', `translate(0 ${y})`);
    layer.style.fill = `color-mix(in srgb, ${deep}, #000 ${Math.round(y * 2.5)}%)`;
    side.append(layer);
  }
  // a pillowed rim: the light rolls over the top edge and the bottom edge turns into the wall
  stack(key.querySelector('.edge .hi'), 14, 0.14);
  stack(key.querySelector('.edge .lo'), 14, 0.12);
  stack(key.querySelector('.soft'), 24, 0.022);        // contact shadow under the resting cap
  stack(key.querySelector('.hole .blur'), 10, 0.07);   // the hole's inner walls
  stack(key.querySelector('.inset .blur'), 12, 0.05);  // inner shadow on a latched cap
}

// ---------- sound: a synthesized "FAAAH" (prank-video style) when something is added ----------
// Built with Web Audio, no audio file: a breathy "F" (filtered noise), then a shouted "AAAH" (two
// sawtooth voices through vowel formants, soft-clipped, pitch leaping up and sagging with vibrato),
// all in a big room reverb. A custom clip picked in Ajustes replaces it.
const SOUND_KEY = 'comidas-libres:sound';
const sound = (() => {
  let room = null;
  // decodeAudioData: callbacks for older Safari, a promise elsewhere (whose rejection must be caught too)
  const decode = (c, bytes) => new Promise((ok, ko) => {
    const p = c.decodeAudioData(bytes, ok, ko);
    if (p && p.catch) p.catch(ko);
  });
  const reverb = (c) => {
    if (room && room.sampleRate === c.sampleRate) return room;
    const len = Math.round(c.sampleRate * 1.6);
    room = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = room.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return room;
  };
  function faaa(c, big) {
    const t = c.currentTime + 0.02;
    const end = t + (big ? 1.75 : 1.2);
    const out = c.createGain();
    out.gain.value = big ? 0.9 : 0.75;
    const wet = c.createGain();
    wet.gain.value = 0.5;
    const verb = c.createConvolver();
    verb.buffer = reverb(c);
    out.connect(c.destination);
    out.connect(verb).connect(wet).connect(c.destination);

    // "F": a short burst of bright noise
    const nb = c.createBuffer(1, Math.round(c.sampleRate * 0.3), c.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource();
    noise.buffer = nb;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1800;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.4, t + 0.04);
    ng.gain.linearRampToValueAtTime(0, t + 0.17);
    noise.connect(hp).connect(ng).connect(out);
    noise.start(t); noise.stop(t + 0.3);

    // "AAAH": shouted vowel
    const v = t + 0.11;
    const voice = c.createGain();
    voice.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    const vib = c.createGain();
    vib.gain.setValueAtTime(0, v);
    vib.gain.linearRampToValueAtTime(10, v + 0.5);
    lfo.connect(vib);
    const oscs = [-6, 6].map((detune) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.setValueAtTime(220, v);
      o.frequency.exponentialRampToValueAtTime(big ? 360 : 330, v + 0.16);
      o.frequency.exponentialRampToValueAtTime(big ? 190 : 240, end);
      vib.connect(o.frequency);
      o.connect(voice);
      return o;
    });
    const shout = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(2.6 * (i / 511.5 - 1));
    shout.curve = curve;
    voice.connect(shout);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, v);
    env.gain.exponentialRampToValueAtTime(1, v + 0.07);
    env.gain.setValueAtTime(1, end - 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const [f, q, g] of [[820, 5, 1], [1220, 7, 0.55], [2650, 9, 0.28], [3500, 10, 0.12]]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const fg = c.createGain();
      fg.gain.value = g;
      shout.connect(bp).connect(fg).connect(env);
    }
    env.connect(out);
    for (const o of [...oscs, lfo]) { o.start(v); o.stop(end + 0.05); }
  }
  // Playback goes through an <audio> element, not the live Web Audio graph: iOS mutes Web Audio with
  // the silent switch (and keeps a context made outside a tap suspended), while media elements play
  // like a video would. The Faaa is rendered once, offline, into WAV files the element can play.
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const rendered = {};
  function wav(buf) {
    const d = buf.getChannelData(0), n = d.length, sr = buf.sampleRate;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    const g = peak ? 0.9 / peak : 1;
    const ab = new ArrayBuffer(44 + n * 2), dv = new DataView(ab);
    const tag = (o, t) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    tag(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    tag(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] * g)) * 32767, true);
    return URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
  }
  async function prerender() {
    if (!Offline) return;
    for (const big of [false, true]) {
      const c = new Offline(1, Math.round(32000 * (big ? 2.9 : 2.4)), 32000);
      faaa(c, big);
      const buf = await new Promise((ok, ko) => {
        c.oncomplete = (ev) => ok(ev.renderedBuffer);
        const p = c.startRendering();
        if (p && p.catch) p.catch(ko);
      });
      rendered[big] = wav(buf);
    }
  }
  const ready = prerender().catch(() => {});
  const el = new Audio();
  el.preload = 'auto';
  el.setAttribute('playsinline', '');
  function source(big) {
    let custom = null;
    try { custom = localStorage.getItem(SOUND_KEY); } catch (e) { /* storage blocked */ }
    return custom || rendered[big] || null;
  }
  return {
    faaa, // (context, big): also renders offline
    ready,
    async canPlay(src) {
      if (!Offline) return true;
      try {
        const bytes = await (await fetch(src)).arrayBuffer();
        await decode(new Offline(1, 1, 44100), bytes);
        return true;
      } catch (e) { return false; }
    },
    // call from the tap itself: iOS only lets media start inside a user gesture
    play(big = false) {
      if (state.settings.sound === false) return;
      const src = source(big);
      if (!src) return;
      if (el.src !== src) el.src = src;
      try { el.currentTime = 0; } catch (e) { /* not loaded yet */ }
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    },
  };
})();

// the dial's value pills and the hints under it follow the unit
function renderUnitLabels() {
  const p = inPorciones();
  for (const key of $('pad').querySelectorAll('.key')) {
    key.querySelector('.pill text').textContent = key.dataset.part === 'completa' ? (p ? '3' : '1') : (p ? '1' : '⅓');
  }
  $('padHint').textContent = p
    ? 'Cada parte del anillo suma 1 porción; el centro, una comida libre completa, suma 3. Otro toque la saca.'
    : 'El centro suma una comida libre completa; cada parte del anillo suma ⅓. Otro toque la saca.';
  $('icsHint').textContent = p
    ? 'Marcá los eventos que vas a reservar. Tocá el número para cambiar cuántas porciones vale (1, 2 o 3 = completa).'
    : 'Marcá los eventos que vas a reservar. Tocá el número para cambiar cuánto vale (⅓, ⅔ o 1).';
}
renderUnitLabels();

// the dial's parts are SVG groups: press feedback by hand, keyboard like a button
for (const key of $('pad').querySelectorAll('.key')) {
  const press = (on) => key.classList.toggle('pressed', on);
  key.addEventListener('pointerdown', () => press(true));
  key.addEventListener('pointerup', () => press(false));
  key.addEventListener('pointerleave', () => press(false));
  key.addEventListener('pointercancel', () => press(false));
  key.addEventListener('click', () => {
    // show the new state in the same frame as the tap; logging, toast and redraws follow right after
    key.classList.toggle('on');
    key.classList.remove('pressed');
    haptic();
    if (key.classList.contains('on')) sound.play(key.dataset.part === 'completa');
    requestAnimationFrame(() => setTimeout(() => tap(key.dataset.part), 0));
  });
  key.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); key.dispatchEvent(new MouseEvent('click')); }
  });
}

// ---------- week card ----------

const PART_COLOR = { comida: 'var(--comida)', alcohol: 'var(--alcohol)', postre: 'var(--postre)', completa: 'var(--completa)' };
// chart series: the three parts plus the extra thirds a "completa" entry adds
const SERIES = [...PARTS, ['completa', 'Completa', '🍽️']];

// third i of a 48×48 token (centre 24,24, r 20), starting at 12 o'clock
const wedgePath = (i) => plateWedge(24, 24, 20, i);

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
// Over the weekly quota, show the quota plus the extra: "1+2" (thirds in, text out).
const fmtUsed = (used, quota) => (used > quota ? `${fmtThirds(quota)}+${fmtThirds(used - quota)}` : fmtThirds(used));
// A month is made of whole weeks: each week belongs to the month holding most of its days
// (its 4th day). September 2026 = 31 ago–27 sept, 4 weeks; the week of 28 sept goes to October.
// "Months" are addressed by (y, m) keys. Without a plan start they are calendar months; with one
// (settings.cycleStart) each key is a 4-week cycle counted from the visit: the cycle's key is the
// visit's month plus the cycle number.
const CYCLE_DAYS = 28;
function cycleIndex(y, m) {
  const c = parseDate(state.settings.cycleStart);
  return (y * 12 + m) - (c.getFullYear() * 12 + c.getMonth());
}
function monthKeyOf(iso) {
  if (state.settings.cycleStart) {
    const c = parseDate(state.settings.cycleStart);
    const k = Math.floor((parseDate(iso) - c) / 864e5 / CYCLE_DAYS);
    return new Date(c.getFullYear(), c.getMonth() + k, 1);
  }
  const d = parseDate(weekBounds(parseDate(iso))[0]);
  d.setDate(d.getDate() + 3); // a week belongs to the month holding its middle day
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
const currentMonthKey = () => monthKeyOf(isoDate(new Date()));

function periodTitle(y, m) {
  if (state.settings.cycleStart) return spanLabel(monthSpan(y, m));
  const t = MONTH(new Date(y, m, 1));
  return t.charAt(0).toUpperCase() + t.slice(1) + (y !== new Date().getFullYear() ? ` ${y}` : '');
}
// "en septiembre" / "en el ciclo"
const periodIn = (y, m) => (state.settings.cycleStart ? 'en el ciclo' : `en ${MONTH(new Date(y, m, 1))}`);

function monthSpan(y, m) {
  if (state.settings.cycleStart) {
    const start = parseDate(state.settings.cycleStart);
    start.setDate(start.getDate() + CYCLE_DAYS * cycleIndex(y, m));
    const weeks = [];
    for (let i = 0; i < CYCLE_DAYS / 7; i++) {
      const f = new Date(start); f.setDate(f.getDate() + 7 * i);
      const t = new Date(f); t.setDate(t.getDate() + 6);
      weeks.push([isoDate(f), isoDate(t)]);
    }
    return { from: weeks[0][0], to: weeks[weeks.length - 1][1], weeks, days: CYCLE_DAYS };
  }
  const weeks = [];
  let [from, to] = weekBounds(new Date(y, m, 1));
  for (;;) {
    const mid = parseDate(from); mid.setDate(mid.getDate() + 3);
    if (mid.getFullYear() > y || (mid.getFullYear() === y && mid.getMonth() > m)) break;
    if (mid.getMonth() === m) weeks.push([from, to]);
    const n = parseDate(from); n.setDate(n.getDate() + 7); from = isoDate(n);
    const t = new Date(n); t.setDate(t.getDate() + 6); to = isoDate(t);
  }
  const f = weeks[0][0], t = weeks[weeks.length - 1][1];
  return { from: f, to: t, weeks, days: Math.round((parseDate(t) - parseDate(f)) / 864e5) + 1 };
}

// Monthly allowance in thirds: weekly quota × the month's weeks (2 × 4 = 8).
function monthAllowance(y, m) {
  return (Number(state.settings.quota) || 0) * 3 * monthSpan(y, m).weeks.length;
}

const spanLabel = (sp) => weekRangeLabel(sp.from, sp.to, true);

const mealsWord = (n) => `${n} ${n === 1 ? 'comida libre' : 'comidas libres'}`;

// Progress bar in thirds: a tick at every whole free meal, a marker at the quota,
// and the part above the quota drawn in the "over" color.
function progressBar(used, quota, reserved = 0) {
  const max = Math.max(quota, used + reserved, 3);
  const bar = document.createElement('span');
  bar.className = 'pbar';
  const pct = (v) => `${(v / max) * 100}%`;
  const within = Math.min(used, quota);
  bar.appendChild(Object.assign(document.createElement('i'), { className: 'fill', style: `width:${pct(within)}` }));
  if (used > quota) {
    bar.appendChild(Object.assign(document.createElement('i'), { className: 'fill extra', style: `left:${pct(quota)};width:${pct(used - quota)}` }));
  }
  if (reserved) {
    bar.appendChild(Object.assign(document.createElement('i'), { className: 'fill reserved', style: `left:${pct(used)};width:${pct(reserved)}` }));
  }
  for (let v = 3; v < max; v += 3) {
    bar.appendChild(Object.assign(document.createElement('i'), { className: v === quota && used + reserved > quota ? 'tick cupo' : 'tick', style: `left:${pct(v)}` }));
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
  const slices = weekSlices(from, to);
  const used = slices.length;
  const quota = (Number(state.settings.quota) || 0) * 3;
  const current = weekOffset === 0;
  const range = weekRangeLabel(from, to, true);
  $('weekTitle').textContent = current ? `Esta semana, ${range}`
    : weekOffset === 1 ? `Semana pasada, ${range}`
    : `Semana del ${range}`;
  $('wkNext').disabled = current;
  $('wkToday').hidden = current;
  const st = weekStatus(used, quota, !current);
  $('weekStatus').innerHTML = '';
  $('weekStatus').appendChild(statusPill(st));
  const daysLeft = Math.round((parseDate(to) - parseDate(isoDate(new Date()))) / 864e5) + 1;
  const box = $('weekLeft');
  box.className = `week-card s-${st.key}`;
  box.innerHTML = '';
  // the thirds just added get a little stamp when you land here from the keypad
  const fresh = freshWedges ? [used - freshWedges, used] : 0;
  box.append(weekHero({ used, quota, slices, current, daysLeft, fresh }));
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
    const c = e.partes[k] ? PART_COLOR[k] : e.completa ? PART_COLOR.completa : '';
    if (c) { d.style.background = c; d.style.borderColor = c; }
    dots.appendChild(d);
  }
  const what = document.createElement('span');
  what.className = 'what';
  const t = document.createElement('b');
  t.textContent = title;
  const sub = document.createElement('span');
  const parts = [e.completa ? 'comida libre completa' : '', ...PARTS.filter(([k]) => e.partes[k]).map(([, l]) => l.toLowerCase())]
    .filter(Boolean).join(', ');
  sub.textContent = e.descripcion || e.notas || parts.charAt(0).toUpperCase() + parts.slice(1);
  what.append(t, sub);
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = fmtThirds(thirdsOf(e));
  const j = joyOf(e.disfrute);
  if (j) val.prepend(Object.assign(document.createElement('span'), { className: 'joy', textContent: j[1], title: j[2] }));
  b.append(dots, what, val);
  b.setAttribute('aria-label', `${title}: ${parts}. Editar`);
  li.appendChild(b);
  return li;
}

// ---------- Hoy tab: this week at a glance + the selected day's entries ----------

// Week-at-a-glance plates: one plate per free meal of the quota, each cut in three like the dial.
// Used thirds are painted in the part's color (in the order they were logged), events already
// reserved are hatched, and anything above the quota spills onto extra plates ringed in red.
const SVGNS = 'http://www.w3.org/2000/svg';
function plateWedge(cx, cy, r, i) {
  const a0 = (-90 + i * 120) * Math.PI / 180, a1 = (-90 + (i + 1) * 120) * Math.PI / 180;
  const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${cx} ${cy} L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`;
}
let platesSeq = 0;
function weekPlates(slices, quota, fresh = 0) {
  const hatch = `hatch${++platesSeq}`;
  const plates = Math.max(quota / 3, Math.ceil(slices.length / 3));
  const size = 44, gap = 10, pad = 3;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'plates');
  svg.setAttribute('viewBox', `0 0 ${plates * size + (plates - 1) * gap + pad * 2} ${size + pad * 2}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><pattern id="${hatch}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<rect width="5" height="5" class="h-bg"/><rect width="2" height="5" class="h-ln"/></pattern></defs>`;
  for (let k = 0; k < plates; k++) {
    const cx = pad + k * (size + gap) + size / 2, cy = pad + size / 2;
    const extra = k * 3 >= quota;
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', extra ? 'plate extra' : 'plate');
    for (let i = 0; i < 3; i++) {
      const idx = k * 3 + i;
      const kind = slices[idx] || 'empty';
      const w = document.createElementNS(SVGNS, 'path');
      w.setAttribute('d', plateWedge(cx, cy, size / 2, i));
      w.setAttribute('class', `w w-${kind}`);
      if (kind === 'reserved') w.setAttribute('fill', `url(#${hatch})`);
      if (fresh && kind !== 'empty' && kind !== 'reserved' && idx >= fresh[0] && idx < fresh[1]) {
        w.classList.add('fresh');
        w.style.transformOrigin = `${cx}px ${cy}px`;
      }
      g.append(w);
    }
    if (extra) {
      const ring = document.createElementNS(SVGNS, 'circle');
      Object.entries({ cx, cy, r: size / 2 + 1.5, class: 'ring' }).forEach(([n, v]) => ring.setAttribute(n, v));
      g.append(ring);
    }
    svg.append(g);
  }
  return svg;
}

// the week's thirds in the order they were logged, each tagged with its part
function weekSlices(from, to) {
  const out = [];
  const week = state.entries.filter((e) => e.fecha >= from && e.fecha <= to)
    .sort((x, y) => (x.fecha + x.hora).localeCompare(y.fecha + y.hora));
  for (const e of week) {
    if (e.completa) out.push('completa', 'completa', 'completa');
    else for (const [k] of PARTS) if (e.partes[k]) out.push(k);
  }
  return out;
}

// Headline + plates for a week, shared by Registrar and Semana. The current week leads with what's
// left; a finished week with what was used; over the quota, with how far above it.
function weekHero({ used, quota, slices, current, daysLeft, fresh }) {
  const left = quota - used;
  let cap, num, sub;
  if (left < 0) {
    cap = 'Te pasaste'; num = `+${fmtThirds(-left)}`; sub = `sobre tu cupo de ${quotaN(quota)}`;
  } else if (current) {
    const days = daysLeft === 1 ? 'último día' : `quedan ${daysLeft} días`;
    cap = left === 1 || (left === 3 && !inPorciones()) ? 'Te queda' : 'Te quedan';
    num = fmtThirds(left);
    sub = left === 0 ? `Cupo completo · ${days}` : `de ${inPorciones() ? porciones(quota) : mealsWord(quota / 3)} · ${days}`;
  } else {
    cap = 'Usaste'; num = fmtThirds(used); sub = `de ${inPorciones() ? porciones(quota) : mealsWord(quota / 3)}`;
  }
  const hero = document.createElement('span');
  hero.className = 'hero' + (left < 0 ? ' over' : '');
  const text = document.createElement('span');
  text.className = 'hero-text';
  text.append(Object.assign(document.createElement('span'), { className: 'cap', textContent: cap }),
    Object.assign(document.createElement('b'), { className: 'num', textContent: num }),
    Object.assign(document.createElement('small'), { className: 'sub', textContent: sub }));
  hero.append(text, weekPlates(slices, quota, fresh));
  hero.dataset.said = `${cap.toLowerCase()} ${num.replace('+', '')} ${sub}`;
  return hero;
}

function renderToday() {
  const [from, to] = weekBounds();
  const todayIso = isoDate(new Date());
  const slices = weekSlices(from, to);
  const used = slices.length;
  const quota = (Number(state.settings.quota) || 0) * 3;
  const left = quota - used;
  const reserved = Math.min(plannedBetween(todayIso, to), Math.max(left, 0));
  for (let i = 0; i < reserved; i++) slices.push('reserved');
  const st = weekStatus(used, quota, false);
  const daysLeft = Math.round((parseDate(to) - parseDate(todayIso)) / 864e5) + 1;

  const box = $('todaySummary');
  box.innerHTML = '';
  box.className = `today-sum s-${st.key}`;
  const head = document.createElement('span');
  head.className = 'head';
  head.append(Object.assign(document.createElement('small'), { textContent: 'Esta semana' }), statusPill(st));
  const hero = weekHero({ used, quota, slices, current: true, daysLeft });

  const notes = [];
  if (reserved) notes.push(inPorciones() ? `${porciones(reserved)} reservadas para eventos` : `${fmtThirds(reserved)} reservado para eventos`);
  const planned = state.alloc[from];
  if (planned) notes.push(`tu plan: ${fmtThirds(planned)} más`);
  box.append(head, hero);
  if (notes.length) {
    const note = Object.assign(document.createElement('small'), { className: 'note' });
    if (reserved) note.append(Object.assign(document.createElement('i'), { className: 'key-hatch', ariaHidden: 'true' }));
    note.append(notes.join(' · ').replace(/^./, (c) => c.toUpperCase()));
    box.append(note);
  }
  const said = hero.dataset.said;
  box.setAttribute('aria-label', `Esta semana: ${said}, usaste ${fmtThirds(used)}. ${notes.join('. ')} ${st.label}. Ver semana`);

  renderTodayPlans();
  renderBackup();
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

// ---------- summary for the nutritionist: one cycle (or month) at a glance, shareable as text ----------

function periodSummary(y, m) {
  const span = monthSpan(y, m);
  const today = isoDate(new Date());
  const quota = (Number(state.settings.quota) || 0) * 3;
  const entries = state.entries.filter((e) => e.fecha >= span.from && e.fecha <= span.to);
  const total = entries.reduce((n, e) => n + thirdsOf(e), 0);
  const weeks = span.weeks.filter(([f]) => f <= today).map(([from, to]) => {
    const used = thirdsBetween(from, to);
    return { from, to, used, slices: weekSlices(from, to), done: to < today, st: weekStatus(used, quota, to < today) };
  });
  const count = (fn) => entries.filter(fn).length;
  const kinds = [...PARTS.map(([k, label, icon]) => ({ icon, label, n: count((e) => e.partes[k]) })),
    { icon: '🍽️', label: 'Completa', n: count((e) => e.completa) }].filter((k) => k.n);
  const tally = (key) => {
    const t = {};
    for (const e of entries) { const k = key(e); t[k] = (t[k] || 0) + thirdsOf(e); }
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  };
  const byMeal = tally((e) => e.momento);
  const byDay = tally((e) => parseDate(e.fecha).toLocaleDateString('es', { weekday: 'long' }));
  const joy = JOY.map(([v, face, label]) => ({ face, label, list: entries.filter((e) => joyOf(e.disfrute)?.[0] === v) }));
  const inCourse = today >= span.from && today <= span.to;
  return { span, quota, total, allowed: monthAllowance(y, m), weeks, kinds, byMeal, byDay, joy, inCourse, title: periodTitle(y, m) };
}

// "sobre todo en la cena (4 de 6)" — only when one meal or day clearly stands out
function standout(list, total, fmt) {
  if (!list.length || total < 3) return '';
  const [name, n] = list[0];
  if (list[1] && list[1][1] === n) return '';
  return n / total >= 0.4 ? fmt(name, n) : '';
}

function summaryLines(S) {
  const where = state.settings.cycleStart ? 'Ciclo' : 'Mes';
  const inPlan = S.weeks.filter((w) => w.done && w.used <= S.quota).length;
  const doneWeeks = S.weeks.filter((w) => w.done).length;
  const meal = standout(S.byMeal, S.total, (k, n) => `sobre todo en ${withArticle(k)} (${fmtThirds(n)} de ${fmtThirds(S.total)})`);
  const day = standout(S.byDay, S.total, (k) => `el día con más, ${k}`);
  return {
    head: `${where} ${S.title}`,
    total: `${fmtThirds(S.total)} de ${allowanceWord(S.allowed)}`,
    course: S.inCourse ? `En curso: semana ${S.weeks.length} de ${S.span.weeks.length}` : doneWeeks ? `${inPlan} de ${doneWeeks} semanas dentro del cupo` : '',
    when: [meal, day].filter(Boolean).join('; '),
  };
}

function summaryText(S) {
  const L = summaryLines(S);
  const out = [`🍽️ Comidas libres · ${L.head}`, `Total: ${L.total}${L.course ? ` (${L.course.charAt(0).toLowerCase() + L.course.slice(1)})` : ''}`, '', 'Semanas:'];
  for (const w of S.weeks) out.push(`${w.st.icon} ${weekRangeLabel(w.from, w.to, true)}: ${fmtThirds(w.used)} de ${quotaN(S.quota)}`);
  if (S.kinds.length) out.push('', `Qué fue: ${S.kinds.map((k) => `${k.icon} ${k.label.split(' ')[0].toLowerCase()} ${k.n}`).join(' · ')}`);
  if (L.when) out.push(`Cuándo: ${L.when}`);
  const rated = S.joy.filter((j) => j.list.length);
  if (rated.length) {
    out.push(`¿Valió la pena?: ${rated.map((j) => `${j.face} ${j.list.length}`).join(' · ')}`);
    const meh = S.joy[0].list.map((e) => e.descripcion).filter(Boolean);
    if (meh.length) out.push(`No valieron tanto: ${meh.join(', ')}`);
  }
  return out.join('\n');
}

let summaryRef = null;
function openSummary() {
  summaryRef = monthRef;
  const S = periodSummary(monthRef.getFullYear(), monthRef.getMonth());
  const L = summaryLines(S);
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
  const box = $('summaryBody');
  box.innerHTML = '';
  $('summaryTitle').textContent = L.head;
  const top = el('div', 'sum-top');
  top.append(el('b', 'sum-total', fmtThirds(S.total)), el('span', '', ` de ${allowanceWord(S.allowed)}`));
  box.append(top);
  if (L.course) box.append(el('p', 'sum-note', L.course));

  box.append(el('h4', '', 'Semanas'));
  const wl = el('ul', 'sum-weeks');
  for (const w of S.weeks) {
    const li = el('li', `s-${w.st.key}`);
    li.append(el('i', 'st', w.st.icon), el('span', 'sum-range', weekRangeLabel(w.from, w.to, true)),
      weekPlates(w.slices, S.quota), el('span', 'sum-val', `${fmtThirds(w.used)} / ${quotaN(S.quota)}`));
    wl.append(li);
  }
  box.append(wl);

  if (S.kinds.length) {
    box.append(el('h4', '', 'Qué fue'));
    const kl = el('div', 'sum-kinds');
    for (const k of S.kinds) {
      const c = el('span', 'sum-kind');
      c.append(el('span', 'ico', k.icon), el('b', '', k.n), el('small', '', k.label.split(' ')[0]));
      c.setAttribute('aria-label', `${k.label}: ${k.n}`);
      kl.append(c);
    }
    box.append(kl);
  }
  if (S.byMeal.length) {
    box.append(el('h4', '', 'Cuándo'));
    box.append(el('p', 'sum-note', S.byMeal.map(([k, n]) => `${k} ${fmtThirds(n)}`).join(' · ')));
    if (L.when) box.append(el('p', 'sum-insight', L.when.charAt(0).toUpperCase() + L.when.slice(1)));
  }
  const rated = S.joy.filter((j) => j.list.length);
  box.append(el('h4', '', '¿Valió la pena?'));
  if (rated.length) {
    const jl = el('div', 'sum-kinds');
    for (const j of S.joy) {
      const c = el('span', 'sum-kind');
      c.append(el('span', 'ico', j.face), el('b', '', j.list.length), el('small', '', j.label));
      jl.append(c);
    }
    box.append(jl);
    const meh = S.joy[0].list.map((e) => e.descripcion).filter(Boolean);
    if (meh.length) box.append(el('p', 'sum-insight', `No valieron tanto: ${meh.join(', ')}`));
  } else {
    box.append(el('p', 'sum-note', 'Todavía no calificaste ninguna. Podés hacerlo al sumar o desde el detalle de cada registro.'));
  }
  openSheet('summarySheet');
}

$('btnSummary').onclick = openSummary;
$('summaryShare').onclick = async () => {
  const text = summaryText(periodSummary(summaryRef.getFullYear(), summaryRef.getMonth()));
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Resumen copiado'); } catch { toast('No se pudo compartir'); }
};

// ---------- tabs ----------

const TAB_TITLES = { hoy: 'Registrar', semana: 'Semana', mes: 'Mes', plan: 'Planificar' };
function showTab(t) {
  for (const k of Object.keys(TAB_TITLES)) {
    $(`tab-${k}`).hidden = k !== t;
    $(`tb-${k}`).setAttribute('aria-selected', String(k === t));
  }
  $('tabTitle').textContent = TAB_TITLES[t];
  currentTab = t;
  closeMenu();
  renderTab(t);
  hideTip();
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll('.tabbar button')) b.onclick = () => showTab(b.dataset.tab);
$('todaySummary').onclick = () => { goWeek(0); showTab('semana'); };

// ---------- month ----------

function renderMonth() {
  if (!monthRef) monthRef = currentMonthKey();
  const y = monthRef.getFullYear(), m = monthRef.getMonth();
  const span = monthSpan(y, m);
  const first = span.from;
  const last = span.to;
  $('monthTitle').textContent = periodTitle(y, m);
  const now = new Date();
  const todayIso = isoDate(now);
  $('moNext').disabled = monthSpan(m === 11 ? y + 1 : y, (m + 1) % 12).from > todayIso;

  const inMonth = state.entries.filter((e) => e.fecha >= first && e.fecha <= last);
  const total = inMonth.reduce((n, e) => n + thirdsOf(e), 0);
  const nCompletas = inMonth.filter((e) => e.completa).length;
  const counts = PARTS.map(([k, , icon]) => `${icon} ${inMonth.filter((e) => e.partes[k]).length}`).join('   ')
    + (nCompletas ? `   🍽️ ${nCompletas}` : '');
  $('monthTotal').innerHTML = '';
  const allowed = monthAllowance(y, m);
  // compare against what the month allows up to today (whole month once it's over)
  const isCur = todayIso >= first && todayIso <= last;
  const daysSoFar = isCur ? Math.round((parseDate(todayIso) - parseDate(first)) / 864e5) + 1 : span.days;
  const allowedSoFar = Math.round((allowed * daysSoFar) / span.days);
  let mst;
  if (!total) mst = { key: 'clean', icon: '★', label: 'Mes limpio' };
  else if (total > allowed) mst = { key: 'over', icon: '!', label: 'Por encima del límite' };
  else if (total > allowedSoFar) mst = { key: 'limit', icon: '=', label: 'Por encima del ritmo' };
  else mst = { key: 'good', icon: '✓', label: isCur ? 'Vas bien' : 'Dentro del plan' };
  $('monthTotal').append(
    Object.assign(document.createElement('b'), { textContent: fmtThirds(total) }),
    ` de ${allowanceWord(allowed)} ${state.settings.cycleStart ? 'en el ciclo' : 'en el mes'}`,
    Object.assign(document.createElement('span'), { textContent: `${span.weeks.length} semanas, del ${spanLabel(span)}` }),
    Object.assign(document.createElement('span'), { textContent: counts }),
  );
  $('monthStatus').innerHTML = '';
  $('monthStatus').appendChild(statusPill(mst));
  const reservedMonth = isCur ? plannedBetween(isoDate(now), last) : 0;
  // what's left counts the events already planned for the rest of the month
  $('monthAdvice').textContent = isCur
    ? monthAdvice(total + reservedMonth, allowed, span.days - daysSoFar + 1, parseDate(last))
      + (reservedMonth ? ` Ya descuenta ${inPorciones() ? `${porciones(reservedMonth)} reservadas` : `${fmtThirds(reservedMonth)} reservado`} para eventos.` : '')
    : '';

  renderChart(y, m, inMonth);

  // the month's weeks
  const quota = (Number(state.settings.quota) || 0) * 3;
  const ul = $('monthWeeks');
  ul.innerHTML = '';
  const today = todayIso;
  for (const [from, to] of span.weeks) {
    if (from > today) break;
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
      textContent: used > quota ? fmtUsed(used, quota) : `${fmtThirds(used)} / ${quotaN(quota)}`,
    });
    b.append(icon, label, bar, val);
    b.setAttribute('aria-label', `Semana del ${weekRangeLabel(from, to)}: ${fmtThirds(used)} de ${quotaN(quota)}, ${st.label}. Ver semana`);
    li.appendChild(b);
    ul.appendChild(li);
  }
}

// One sentence that turns the month's deviation into what's left to do.
// used/allowed in thirds; daysLeft counts today.
function monthAdvice(used, allowed, daysLeft, lastDate) {
  const quota = (Number(state.settings.quota) || 0) * 3;
  const mes = state.settings.cycleStart ? 'ciclo' : 'mes';
  const left = allowed - used;
  const dias = daysLeft === 1 ? 'hoy' : `los ${daysLeft} días que faltan`;
  const next = new Date(lastDate); next.setDate(next.getDate() + 1);
  const restart = `El ${next.toLocaleDateString('es', { weekday: 'long', day: 'numeric' })} arranca un ${mes} nuevo.`;
  if (left < 0) return `Este ${mes} ya estás ${fmtThirds(-left)} por encima del límite. ${restart}`;
  if (left === 0) return `Llegaste justo al límite del ${mes}. ${restart}`;
  if (daysLeft < 7) return `Te quedan ${fmtThirds(left)} para ${dias} del ${mes}.`;
  const perWeek = Math.floor((left * 7) / daysLeft); // thirds per week, rounded down
  if (perWeek >= quota) return `Te quedan ${fmtThirds(left)} para ${dias}. Podés seguir con tu cupo normal.`;
  return `Te quedan ${fmtThirds(left)} para ${dias}: unas ${fmtThirds(perWeek)} por semana para cerrar el ${mes} en el plan.`;
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
  const span = monthSpan(y, m);
  const days = span.days;
  const start = parseDate(span.from);
  const dateAt = (i) => { const d = new Date(start); d.setDate(d.getDate() + i - 1); return d; };
  const idx = (iso) => Math.round((parseDate(iso) - start) / 864e5) + 1;
  const today = isoDate(new Date());
  const isCurrent = today >= span.from && today <= span.to;
  const lastDay = isCurrent ? idx(today) : days; // don't draw the future

  const perDay = new Array(days + 1).fill(0); // thirds logged on each day of the span
  for (const e of inMonth) perDay[idx(e.fecha)] += thirdsOf(e);
  const cum = [0];
  for (let d = 1; d <= days; d++) cum[d] = cum[d - 1] + perDay[d];
  const quota = Number(state.settings.quota) || 0;
  const pace = (d) => (monthAllowance(y, m) / 3) * (d / days); // allowed free meals by the end of day d

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
    el('text', { x: L - 8, y: yv(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = inPorciones() ? v * 3 : v;
  }
  // x ticks: weekly-ish plus the last day
  for (let d = 1; d <= days; d += 7) {
    el('text', { x: x(d), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = dateAt(d).getDate();
  }
  el('text', { x: x(days), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = dateAt(days).getDate();

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
  chartData = { y, m, days, lastDay, perDay, cum, pace, x, yv, W, L, R, cross, dot, dateAt };

  // table view for screen readers
  const rows = [];
  for (let i = 1; i <= lastDay; i++) if (perDay[i]) rows.push(`<tr><td>${dateAt(i).getDate()}</td><td>${fmtThirds(perDay[i])}</td><td>${fmtThirds(cum[i])}</td></tr>`);
  $('chartTable').innerHTML = `<caption>Comidas libres por día ${periodIn(y, m)}</caption>`
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
  const date = c.dateAt(day).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
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
  else renderCalendar(y, m, state.entries); // the heatmap is a calendar grid, so it shows calendar days
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
  const anyCompleta = state.entries.some((e) => e.completa);
  for (const [k, label] of anyCompleta ? SERIES : PARTS) {
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

// counts in thirds per series; `completa` holds the thirds a completa entry adds on top of its parts
const partCounts = (list) => {
  const c = { comida: 0, alcohol: 0, postre: 0, completa: 0, nCompletas: 0 };
  for (const e of list) {
    for (const [k] of PARTS) if (e.partes[k]) c[k]++;
    if (e.completa) { c.completa += 3 - partsOf(e); c.nCompletas++; }
  }
  return c;
};
const totalOf = (c) => c.comida + c.alcohol + c.postre + c.completa;
const tipLines = (title, c) => [title,
  ...PARTS.filter(([k]) => c[k]).map(([k, l]) => `${k === 'comida' ? 'Comida' : l}: ${c[k]}`),
  ...(c.nCompletas ? [`Completa: ${c.nCompletas}`] : []),
  `Total: ${fmtThirds(totalOf(c))}`].join('\n');

function renderWeekly(y, m) {
  const today = isoDate(new Date());
  const weeks = [];
  for (const [from, to] of monthSpan(y, m).weeks) {
    if (from > today) break;
    const list = state.entries.filter((e) => e.fecha >= from && e.fecha <= to);
    weeks.push({ from, to, c: partCounts(list) });
  }
  const quota = Number(state.settings.quota) || 0;
  const W = 340, H = 210, L = 26, R = 42, T = 44, B = 26;
  const maxY = Math.max(1, Math.ceil(Math.max(quota, ...weeks.map((w) => totalOf(w.c) / 3))));
  const yv = (v) => T + (1 - v / maxY) * (H - T - B);
  const svg = $('chart');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (let v = 0; v <= maxY; v += maxY <= 5 ? 1 : 2) {
    el('line', { x1: L, x2: W - R + 6, y1: yv(v), y2: yv(v), class: v === 0 ? 'axis' : 'grid' }, svg);
    el('text', { x: L - 8, y: yv(v) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = inPorciones() ? v * 3 : v;
  }
  const band = (W - L - R) / Math.max(weeks.length, 1);
  const bw = Math.min(24, band * 0.5);
  weeks.forEach((w, i) => {
    const cx = L + band * (i + 0.5);
    let acc = 0;
    const segs = SERIES.filter(([k]) => w.c[k]);
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
    const total = totalOf(w.c);
    el('text', { x: cx, y: yv(acc) - 6, class: 'endlabel', 'text-anchor': 'middle' }, svg).textContent = fmtUsed(total, quota * 3);
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
    weeks.map((w) => [weekRangeLabel(w.from, w.to, true), w.c.comida, w.c.alcohol, w.c.postre, fmtThirds(totalOf(w.c))]), 'Comidas libres por semana');
}

function renderMoments(y, m, inMonth) {
  const rows = MEALS.map((meal) => ({ meal, c: partCounts(inMonth.filter((e) => e.momento === meal)) }));
  const W = 340, rowH = 32, L = 78, R = 36, T = 6;
  const H = T + rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map((r) => totalOf(r.c) / 3));
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
    const segs = SERIES.filter(([k]) => r.c[k]);
    segs.forEach(([k], j) => {
      const v = r.c[k] / 3;
      const x0 = xv(acc) + (j ? 2 : 0), w = Math.max(0, xv(acc + v) - xv(acc) - (j ? 2 : 0));
      if (j === segs.length - 1) el('path', { d: rightRounded(x0, cy - 9, w, 18, 4), fill: PART_COLOR[k] }, g);
      else el('rect', { x: x0, y: cy - 9, width: w, height: 18, fill: PART_COLOR[k] }, g);
      acc += v;
    });
    el('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, class: 'hit' }, g);
    const total = totalOf(r.c);
    el('text', { x: xv(acc) + 8, y: cy + 4, class: total ? 'endlabel' : 'tick' }, svg).textContent = total ? fmtThirds(total) : '0';
  });
  tableFrom(['Momento', 'Comida', 'Alcohol', 'Dulce', 'Total'],
    rows.map((r) => [r.meal, r.c.comida, r.c.alcohol, r.c.postre, fmtThirds(totalOf(r.c))]), 'Comidas libres por momento del día');
}

function renderCalendar(y, m, entries) {
  const span = monthSpan(y, m);
  const ws = weekStartDay();
  const rowsN = span.weeks.length;
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
  for (const e of entries) (byDay[e.fecha] = byDay[e.fecha] || []).push(e);
  const rows = [];
  const start = parseDate(span.from);
  for (let i = 0; i < rowsN * 7; i++) {
    const dt = new Date(start); dt.setDate(dt.getDate() + i);
    const iso = isoDate(dt);
    const list = byDay[iso] || [];
    const c = partCounts(list);
    const t = totalOf(c);
    const cx = (i % 7) * (cell + gap), cy = top + Math.floor(i / 7) * (cellH + gap);
    const future = iso > today;
    const date = dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
    const g = el('g', future ? {} : { 'data-tip': t ? tipLines(date.charAt(0).toUpperCase() + date.slice(1), c) : `${date.charAt(0).toUpperCase() + date.slice(1)}\nSin comidas libres` }, svg);
    el('rect', { x: cx, y: cy, width: cell, height: cellH, rx: 8, class: `heat h${Math.min(3, t)}${future ? ' future' : ''}${iso === today ? ' today' : ''}` }, g);
    const label = dt.getDate() === 1 || i === 0 ? `${dt.getDate()} ${dt.toLocaleDateString('es', { month: 'short' }).replace('.', '')}` : String(dt.getDate());
    el('text', { x: cx + 6, y: cy + 14, class: t >= 2 ? 'daynum dark' : 'daynum' }, g).textContent = label;
    // secondary encoding: one tiny dot per part logged that day
    SERIES.filter(([k]) => c[k]).forEach(([k], j) => {
      el('circle', { cx: cx + cell - 8 - j * 7, cy: cy + cellH - 8, r: 2.5, fill: t >= 2 ? 'var(--ink-deep)' : PART_COLOR[k] }, g);
    });
    if (t) rows.push([dt.getDate(), c.comida, c.alcohol, c.postre, fmtThirds(t)]);
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
  monthRef = monthKeyOf(from);
  if (monthRef > currentMonthKey()) monthRef = currentMonthKey();
  render();
}
$('wkPrev').onclick = () => goWeek(weekOffset + 1);
$('wkNext').onclick = () => goWeek(weekOffset - 1);
$('wkToday').onclick = () => goWeek(0);

// Only the visible tab is redrawn; the others redraw when they're opened (see showTab).
let currentTab = 'hoy';
function renderTab(t) {
  if (t === 'semana') { renderWeek(); renderList(); }
  else if (t === 'mes') renderMonth();
  else if (t === 'plan') renderPlan();
}
function render() {
  renderWhen();
  renderPad(); // also redraws the Registrar summary and day list
  renderTab(currentTab);
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
  const full = document.createElement('button');
  full.type = 'button';
  full.className = 'wide';
  full.setAttribute('aria-pressed', String(editCompleta));
  full.append(Object.assign(document.createElement('span'), { textContent: '🍽️' }), 'Contar como comida libre completa');
  full.onclick = () => { editCompleta = !editCompleta; renderEditParts(); };
  box.appendChild(full);
}

function openEdit(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  editParts = { ...e.partes };
  editCompleta = !!e.completa;
  $('editTitle').textContent = `${e.momento} ${dayLabel(e.fecha)}`;
  $('eDate').value = e.fecha;
  $('eTime').value = e.hora;
  $('eMeal').innerHTML = MEALS.map((m) => `<option${m === e.momento ? ' selected' : ''}>${m}</option>`).join('');
  $('eDesc').value = e.descripcion || '';
  $('eNotes').value = [e.lugar, e.notas].filter(Boolean).join(' — ');
  editJoy = joyOf(e.disfrute)?.[0] || 0;
  renderEditJoy();
  renderEditParts();
  openSheet('editSheet');
}

let editJoy = 0;
function renderEditJoy() {
  const box = $('eJoy');
  box.innerHTML = '';
  for (const [v, face, label] of JOY) {
    const b = Object.assign(document.createElement('button'), { type: 'button' });
    b.append(Object.assign(document.createElement('span'), { className: 'face', textContent: face, ariaHidden: 'true' }), label);
    b.setAttribute('aria-pressed', String(editJoy === v));
    b.onclick = () => { editJoy = editJoy === v ? 0 : v; renderEditJoy(); }; // tap again to clear
    box.append(b);
  }
}

$('editForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!thirdsOf({ partes: editParts, completa: editCompleta })) { toast('Marcá comida, alcohol, dulce o comida libre completa'); return; }
  const e = state.entries.find((x) => x.id === editingId);
  if (!e) return;
  Object.assign(e, {
    fecha: $('eDate').value,
    hora: $('eTime').value,
    momento: $('eMeal').value,
    partes: { ...editParts },
    completa: editCompleta,
    descripcion: $('eDesc').value.trim(),
    lugar: '',
    notas: $('eNotes').value.trim(),
    disfrute: editJoy,
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

function renderSoundSettings() {
  let custom = null;
  try { custom = localStorage.getItem(SOUND_KEY); } catch (e) { /* storage blocked */ }
  $('sSound').checked = state.settings.sound !== false;
  $('sSoundReset').hidden = !custom;
  $('sSoundNote').textContent = custom
    ? 'Suena tu audio, también con el iPhone en silencio (usa el volumen multimedia).'
    : 'Suena el "Faaa" de la app (más largo en la comida completa), también con el iPhone en silencio.';
}
$('sSound').onchange = () => { state.settings.sound = $('sSound').checked; persist(); renderSoundSettings(); };
$('sSoundTest').onclick = () => { const was = state.settings.sound; state.settings.sound = true; sound.play(); state.settings.sound = was; };
$('sSoundPick').onclick = () => $('soundInput').click();
$('soundInput').onchange = () => {
  const f = $('soundInput').files[0];
  $('soundInput').value = '';
  if (!f) return;
  if (f.size > 1024 * 1024) { toast('El audio tiene que pesar menos de 1 MB'); return; }
  const r = new FileReader();
  r.onload = async () => {
    // no file-type filter on the picker (iOS greys out downloaded mp3s), so check it really plays
    if (!(await sound.canPlay(r.result))) { toast('Ese archivo no es un audio que se pueda reproducir'); return; }
    try { localStorage.setItem(SOUND_KEY, r.result); } catch (e) { toast('No se pudo guardar el audio'); return; }
    renderSoundSettings();
    sound.play();
    toast('Listo, ahora suena tu audio');
  };
  r.readAsDataURL(f);
};
$('sSoundReset').onclick = () => {
  try { localStorage.removeItem(SOUND_KEY); } catch (e) { /* storage blocked */ }
  renderSoundSettings();
  toast('Volviste al Faaa');
};

// ---------- the gear's menu ----------
function lastExportLabel() {
  const d = state.settings.lastExport;
  if (!d) return 'Todavía no guardaste ninguna copia';
  const days = Math.round((parseDate(isoDate(new Date())) - parseDate(d)) / 864e5);
  return `Última copia: ${days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`}`;
}
function closeMenu() {
  $('appMenu').hidden = true;
  $('btnMenu').setAttribute('aria-expanded', 'false');
}
function openMenu() {
  $('menuLastExport').textContent = lastExportLabel();
  renderSoundToggle();
  $('appMenu').hidden = false;
  $('btnMenu').setAttribute('aria-expanded', 'true');
  $('appMenu').querySelector('button').focus({ preventScroll: true });
}
$('btnMenu').onclick = () => ($('appMenu').hidden ? openMenu() : closeMenu());
// any item closes it; a tap outside or Escape too
$('appMenu').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b && !('keep' in b.dataset)) closeMenu(); });
// quick sound switch, right in the menu (it stays open so you see it flip)
function renderSoundToggle() {
  const on = state.settings.sound !== false;
  $('btnSoundToggle').setAttribute('aria-checked', String(on));
  $('menuSoundState').textContent = on ? 'Activado' : 'Apagado';
}
$('btnSoundToggle').onclick = () => {
  state.settings.sound = state.settings.sound === false;
  persist();
  renderSoundToggle();
  if (state.settings.sound) sound.play();
};
document.addEventListener('pointerdown', (ev) => {
  if (!$('appMenu').hidden && !ev.target.closest('#appMenu, #btnMenu')) closeMenu();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('appMenu').hidden) { closeMenu(); $('btnMenu').focus(); }
});

$('btnSettings').onclick = () => {
  renderSoundSettings();
  $('sUnits').value = inPorciones() ? 'porciones' : 'tercios';
  $('appVersion').textContent = `Versión ${APP_VERSION}`;
  $('sQuota').value = state.settings.quota;
  $('sWeekStart').value = String(state.settings.weekStart);
  $('sCycle').value = state.settings.cycleStart || '';
  $('sWeekStart').disabled = !!state.settings.cycleStart;
  for (const m of Object.keys(DEFAULT_RANGES)) $(`sRange${m}`).value = state.settings.ranges[m];
  $('sGcal').value = state.settings.gcalClientId || '';
  const hasId = !!(state.settings.gcalClientId || '').trim();
  $('gcalSet').hidden = !hasId;
  $('gcalField').hidden = hasId;
  openSheet('settingsSheet');
};

$('gcalChange').onclick = () => { $('gcalSet').hidden = true; $('gcalField').hidden = false; $('sGcal').focus(); };

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
  const cyc = $('sCycle').value;
  if (cyc !== (state.settings.cycleStart || '')) { monthRef = null; planMonth = null; stripOffset = 0; weekOffset = 0; }
  if (cyc) state.settings.cycleStart = cyc; else delete state.settings.cycleStart;
  state.settings.ranges = ranges;
  state.settings.gcalClientId = $('sGcal').value.trim();
  if ($('sUnits').value === 'porciones') state.settings.units = 'porciones'; else delete state.settings.units;
  persist();
  closeSheet('settingsSheet');
  renderUnitLabels();
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
      flat.completa = e.completa ? 'Sí' : 'No';
      return Object.fromEntries(COLUMNS.map(([k, h]) => [h, flat[k] ?? '']));
    });
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(([, h]) => h) });
  ws['!cols'] = [12, 7, 11, 20, 9, 9, 22, 20, 40, 22, 12, 40, 12].map((wch) => ({ wch }));

  // Weekly summary sheet
  const weeks = {};
  for (const e of state.entries) {
    const [from] = weekBounds(parseDate(e.fecha));
    const w = weeks[from] || (weeks[from] = { thirds: 0, comida: 0, alcohol: 0, postre: 0 });
    w.thirds += thirdsOf(e);
    for (const [k] of PARTS) if (e.partes[k]) w[k]++;
    if (e.completa) w.completas = (w.completas || 0) + 1;
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  const quota = Number(state.settings.quota);
  const summary = Object.keys(weeks).sort().map((w) => ({
    'Semana desde': w,
    'Comidas fuera del plan': weeks[w].comida,
    'Alcohol': weeks[w].alcohol,
    'Dulce': weeks[w].postre,
    'Completas': weeks[w].completas || 0,
    'Comidas libres': round2(weeks[w].thirds / 3),
    'Permitidas': quota,
    'Diferencia': round2(quota - weeks[w].thirds / 3),
  }));
  const ws2 = XLSX.utils.json_to_sheet(summary, {
    header: ['Semana desde', 'Comidas fuera del plan', 'Alcohol', 'Dulce', 'Completas', 'Comidas libres', 'Permitidas', 'Diferencia'],
  });

  const months = {};
  for (const e of state.entries) {
    const k = e.fecha.slice(0, 7);
    const mo = months[k] || (months[k] = { thirds: 0, comida: 0, alcohol: 0, postre: 0 });
    mo.thirds += thirdsOf(e);
    for (const [p] of PARTS) if (e.partes[p]) mo[p]++;
    if (e.completa) mo.completas = (mo.completas || 0) + 1;
  }
  const ws3 = XLSX.utils.json_to_sheet(Object.keys(months).sort().map((k) => ({
    'Mes': k,
    'Comidas fuera del plan': months[k].comida,
    'Alcohol': months[k].alcohol,
    'Dulce': months[k].postre,
    'Completas': months[k].completas || 0,
    'Comidas libres': round2(months[k].thirds / 3),
  })), { header: ['Mes', 'Comidas fuera del plan', 'Alcohol', 'Dulce', 'Completas', 'Comidas libres'] });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comidas');
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen semanal');
  XLSX.utils.book_append_sheet(wb, ws3, 'Resumen mensual');
  const ws4 = XLSX.utils.json_to_sheet([...state.plans].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((p) => ({
    'Fecha': p.fecha, 'Momento': p.momento, 'Evento': p.nombre, 'Valor (comidas libres)': Math.round((p.valor / 3) * 100) / 100,
  })), { header: ['Fecha', 'Momento', 'Evento', 'Valor (comidas libres)'] });
  XLSX.utils.book_append_sheet(wb, ws4, 'Planificados');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const name = `comidas-libres-${isoDate(new Date())}.xlsx`;
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = new File([buf], name, { type });

  // iOS: the share sheet lets you "Guardar en Archivos", AirDrop, WhatsApp, etc.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      markExported();
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
  markExported();
}

// ---------- backup nudge: the data only lives on this phone, so ask for a copy every 4 weeks ----------

const BACKUP_DAYS = 28;
function markExported() {
  state.settings.lastExport = isoDate(new Date());
  persist();
  renderBackup();
}
function renderBackup() {
  const box = $('backupNudge');
  const today = isoDate(new Date());
  const first = state.entries.reduce((m, e) => (e.fecha < m ? e.fecha : m), today);
  const since = state.settings.lastExport || first;
  const days = Math.round((parseDate(today) - parseDate(since)) / 864e5);
  const snoozed = state.settings.backupSnooze && state.settings.backupSnooze > today;
  box.hidden = !state.entries.length || days < BACKUP_DAYS || snoozed;
  if (box.hidden) return;
  const weeks = Math.floor(days / 7);
  box.querySelector('b').textContent = state.settings.lastExport
    ? `Tu última copia es de hace ${weeks} semanas`
    : 'Tus registros solo están en este iPhone';
}
$('backupExport').onclick = () => exportXlsx().catch(() => toast('No se pudo exportar'));
$('backupLater').onclick = () => {
  const d = new Date(); d.setDate(d.getDate() + 7);
  state.settings.backupSnooze = isoDate(d);
  persist();
  renderBackup();
};

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

function cellsToParts(row, completa) {
  // "Postre" was the column name before it was renamed to "Dulce"
  if (!('Dulce' in row) && 'Postre' in row) row = { ...row, Dulce: row.Postre };
  const cols = PARTS.map(([k]) => COLUMNS.find(([c]) => c === k)[1]);
  // Spreadsheets without part columns (older exports) are full free meals.
  if (!cols.some((h) => h in row)) return { comida: true, alcohol: true, postre: true };
  const partes = {};
  PARTS.forEach(([k], i) => { partes[k] = yes(row[cols[i]]); });
  if (!completa && !partsOf({ partes })) partes.comida = true;
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
      completa: yes(r['Completa (1 comida libre)']),
      partes: cellsToParts(r, yes(r['Completa (1 comida libre)'])),
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



// ---------- Planificar: free meals you already know are coming (birthdays, events) ----------

const PRESETS = [
  ['🎂', 'Cumpleaños', 3, 'Cena'],
  ['🎉', 'Evento', 3, 'Cena'],
  ['🍽️', 'Salida a comer', 3, 'Cena'],
  ['🍻', 'After', 1, 'Merienda'],
];
let planMonth = null; // key of the month/cycle shown in Planificar (set on first render)
let editingPlan = null;
let planValor = 3;

// planned thirds between two ISO dates (inclusive)
function plannedBetween(from, to) {
  return state.plans.filter((p) => p.fecha >= from && p.fecha <= to).reduce((n, p) => n + p.valor, 0);
}

function planIcon(p) {
  const hit = PRESETS.find(([, name]) => p.nombre.toLowerCase().startsWith(name.toLowerCase().slice(0, 5)));
  return hit ? hit[0] : '📌';
}

function renderPlan() {
  if (!$('planMonthTitle')) return;
  if (!planMonth) planMonth = currentMonthKey();
  const y = planMonth.getFullYear(), m = planMonth.getMonth();
  const now = new Date();
  const today = isoDate(now);
  const isCur = +planMonth === +currentMonthKey();
  const span = monthSpan(y, m);
  const first = span.from;
  const last = span.to;
  $('planMonthTitle').textContent = periodTitle(y, m);
  const curKey = currentMonthKey();
  $('planPrev').disabled = planMonth <= curKey;
  const limit = new Date(curKey.getFullYear(), curKey.getMonth() + 6, 1);
  $('planNext').disabled = planMonth >= limit;

  // month budget: allowed vs used (logged) vs reserved (planned, not logged yet)
  const quota = Number(state.settings.quota) || 0;
  const allowed = monthAllowance(y, m);
  const used = state.entries.filter((e) => e.fecha >= first && e.fecha <= last).reduce((n, e) => n + thirdsOf(e), 0);
  const reserved = plannedBetween(first, last);
  const free = allowed - used - reserved;
  const monthName = state.settings.cycleStart ? 'el ciclo' : MONTH(planMonth);
  const card = $('planBudget');
  card.innerHTML = '';
  card.className = 'plan-budget ' + (free < 0 ? 's-over' : free === 0 ? 's-limit' : 's-good');
  const big = document.createElement('div');
  big.className = 'plan-free';
  big.append(Object.assign(document.createElement('small'), { textContent: free >= 0 ? 'Te quedan' : 'Con lo reservado quedás' }),
    Object.assign(document.createElement('b'), { textContent: free >= 0 ? fmtThirds(free) : `+${fmtThirds(-free)}` }),
    Object.assign(document.createElement('span'), {
      textContent: free < 0 ? `por encima del límite de ${monthName}`
        : inPorciones() ? `${free === 1 ? 'porción' : 'porciones'} en ${monthName}`
        : `${free === 3 ? 'comida libre' : free > 0 && free < 3 ? 'de comida libre' : 'comidas libres'} en ${monthName}`,
    }));
  card.append(big, mealTokens(allowed, used, reserved));
  const math = document.createElement('p');
  math.className = 'plan-math';
  math.textContent = `${fmtThirds(allowed)} ${state.settings.cycleStart ? 'del ciclo' : 'del mes'} − ${fmtThirds(used)} usadas − ${fmtThirds(reserved)} reservadas = ${free < 0 ? '−' + fmtThirds(-free) : fmtThirds(free)}`;
  const note = Object.assign(document.createElement('p'), { className: 'plan-span', textContent: `${span.weeks.length} semanas × ${quotaN(quota * 3)}, del ${spanLabel(span)}` });
  card.append(math, note);

  renderPlayground(span, today, free);

  const synced = state.settings.gcalLastSync;
  $('gcalNote').textContent = synced
    ? `Última búsqueda en Google Calendar: ${new Date(synced).toLocaleDateString('es', { day: 'numeric', month: 'short' })}, ${new Date(synced).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
    : '';

  // the events themselves
  const list = $('planList');
  list.innerHTML = '';
  const mine = state.plans.filter((p) => p.fecha >= first && p.fecha <= last).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!mine.length) {
    list.appendChild(Object.assign(document.createElement('li'), { className: 'empty', textContent: `Nada planificado ${state.settings.cycleStart ? 'en este ciclo' : 'este mes'}. Sumá cumpleaños, eventos o salidas que ya sabés que vienen.` }));
  }
  for (const p of mine) list.appendChild(planRow(p));
  // past events not registered yet, from any month
  const pending = state.plans.filter((p) => p.fecha < today && (p.fecha < first || p.fecha > last));
  $('planPendingWrap').hidden = !pending.length || !isCur;
  const pl = $('planPending');
  pl.innerHTML = '';
  for (const p of pending) pl.appendChild(planRow(p));
}

function planRow(p) {
  const today = isoDate(new Date());
  const li = document.createElement('li');
  li.className = 'prow';
  const d = parseDate(p.fecha);
  const date = document.createElement('span');
  date.className = 'pdate' + (p.fecha === today ? ' today' : '');
  date.append(Object.assign(document.createElement('small'), { textContent: d.toLocaleDateString('es', { weekday: 'short' }).replace('.', '') }),
    Object.assign(document.createElement('b'), { textContent: d.getDate() }));
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'pmain';
  main.onclick = () => openPlan(p.id);
  main.append(Object.assign(document.createElement('b'), { textContent: `${planIcon(p)} ${p.nombre}` }),
    Object.assign(document.createElement('span'), { textContent: `${p.momento}, ${inPorciones() ? porciones(p.valor) : p.valor === 3 ? '1 comida libre' : `${fmtThirds(p.valor)} de comida libre`}` }));
  li.append(date, main);
  if (p.fecha <= today) {
    const reg = Object.assign(document.createElement('button'), { type: 'button', className: 'preg', textContent: 'Registrar' });
    reg.onclick = () => registerPlan(p.id);
    li.appendChild(reg);
  } else {
    li.appendChild(Object.assign(document.createElement('span'), { className: 'pval', textContent: fmtThirds(p.valor) }));
  }
  return li;
}


// One token per whole free meal of the month, split in thirds: used, reserved, free (and red extra).
function mealTokens(allowed, used, reserved) {
  const box = document.createElement('div');
  box.className = 'tokens';
  box.setAttribute('aria-hidden', 'true');
  const total = Math.max(allowed, used + reserved);
  const kinds = [];
  for (let i = 0; i < used; i++) kinds.push('used');
  for (let i = 0; i < reserved; i++) kinds.push('res');
  while (kinds.length < total) kinds.push('free');
  const ns = 'http://www.w3.org/2000/svg';
  for (let c = 0; c < Math.ceil(total / 3); c++) {
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    const extra = c * 3 >= allowed;
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', 24); ring.setAttribute('cy', 24); ring.setAttribute('r', 21);
    ring.setAttribute('class', 'tk-ring' + (extra ? ' extra' : ''));
    svg.appendChild(ring);
    for (let i = 0; i < 3; i++) {
      const k = kinds[c * 3 + i];
      if (!k || k === 'free') continue;
      const w = document.createElementNS(ns, 'path');
      w.setAttribute('d', wedgePath(i));
      w.setAttribute('class', `tk-${k}` + (c * 3 + i >= allowed ? ' over' : ''));
      svg.appendChild(w);
    }
    for (let i = 0; i < 3; i++) {
      const a = (-90 + i * 120) * Math.PI / 180;
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', 24); l.setAttribute('y1', 24);
      l.setAttribute('x2', (24 + 21 * Math.cos(a)).toFixed(2)); l.setAttribute('y2', (24 + 21 * Math.sin(a)).toFixed(2));
      l.setAttribute('class', 'tk-div');
      svg.appendChild(l);
    }
    box.appendChild(svg);
  }
  const lg = document.createElement('div');
  lg.className = 'tk-legend';
  lg.innerHTML = '<span><i class="lg-used"></i>Usadas</span><span><i class="lg-res"></i>Reservadas</span><span><i class="lg-free"></i>Libres</span>';
  const wrap = document.createElement('div');
  wrap.append(box, lg);
  return wrap;
}

// ---- playground: hand out the month's free meals to the weeks that are left ----
function renderPlayground(span, today, free) {
  const box = $('playWeeks');
  box.innerHTML = '';
  const q = (Number(state.settings.quota) || 0) * 3;
  const weeks = span.weeks.filter(([, to]) => to >= today);
  const assigned = weeks.reduce((n, [from]) => n + (state.alloc[from] || 0), 0);
  const pool = free - assigned;
  $('playPool').textContent = pool >= 0 ? `Sin repartir: ${fmtThirds(pool)}` : `Repartiste ${fmtThirds(-pool)} de más`;
  $('playPool').className = 'status ' + (pool < 0 ? 's-over' : pool === 0 ? 's-limit' : 's-good');
  $('playBlock').hidden = !weeks.length;
  for (const [from, to] of weeks) {
    const u = thirdsBetween(from, to);
    const r = plannedBetween(from > today ? from : today, to);
    const a = state.alloc[from] || 0;
    const tot = u + r + a;
    const li = document.createElement('li');
    li.className = 'pg' + (tot > q ? ' over' : '');
    const head = document.createElement('div');
    head.className = 'pg-head';
    const cur = from <= today && today <= to;
    head.append(Object.assign(document.createElement('b'), { textContent: (cur ? 'Esta semana, ' : '') + weekRangeLabel(from, to, true) }),
      Object.assign(document.createElement('span'), {
        className: 'pg-total',
        textContent: `${fmtThirds(tot)} de ${quotaN(q)}` + (tot > q ? ` (+${fmtThirds(tot - q)})` : ''),
      }));
    // bar: used + reserved + assigned against the weekly quota
    const max = Math.max(q, tot, 3);
    const bar = document.createElement('span');
    bar.className = 'pbar pg-bar';
    const pct = (v) => `${(v / max) * 100}%`;
    let x = 0;
    for (const [cls, v] of [['fill used', u], ['fill reserved', r], ['fill alloc', a]]) {
      if (!v) continue;
      bar.appendChild(Object.assign(document.createElement('i'), { className: cls, style: `left:${pct(x)};width:${pct(v)}` }));
      x += v;
    }
    for (let v = 3; v < max; v += 3) bar.appendChild(Object.assign(document.createElement('i'), { className: v === q ? 'tick cupo' : 'tick', style: `left:${pct(v)}` }));
    const step = document.createElement('div');
    step.className = 'pg-step';
    const minus = Object.assign(document.createElement('button'), { type: 'button', textContent: '−', disabled: !a });
    minus.setAttribute('aria-label', `Sacar ⅓ de la semana del ${weekRangeLabel(from, to)}`);
    minus.onclick = () => { setAlloc(from, a - 1); };
    const val = Object.assign(document.createElement('span'), { className: 'pg-val', textContent: a ? fmtThirds(a) : '0' });
    const plus = Object.assign(document.createElement('button'), { type: 'button', textContent: '+', disabled: pool <= 0 });
    plus.setAttribute('aria-label', `Asignar ⅓ a la semana del ${weekRangeLabel(from, to)}`);
    plus.onclick = () => { setAlloc(from, a + 1); };
    const lbl = Object.assign(document.createElement('small'), { textContent: (u || r) ? `${u ? `usadas ${fmtThirds(u)}` : ''}${u && r ? ', ' : ''}${r ? `reservadas ${fmtThirds(r)}` : ''}` : 'sin nada todavía' });
    step.append(lbl, minus, val, plus);
    li.append(head, bar, step);
    box.appendChild(li);
  }
}

function setAlloc(from, v) {
  if (v > 0) state.alloc[from] = v; else delete state.alloc[from];
  persist();
  renderPlan();
  renderToday();
}

$('playEven').onclick = () => {
  const y = planMonth.getFullYear(), m = planMonth.getMonth();
  const span = monthSpan(y, m);
  const today = isoDate(new Date());
  const q = (Number(state.settings.quota) || 0) * 3;
  const weeks = span.weeks.filter(([, to]) => to >= today).map(([from, to]) => from);
  if (!weeks.length) return;
  for (const w of weeks) delete state.alloc[w];
  const used = state.entries.filter((e) => e.fecha >= span.from && e.fecha <= span.to).reduce((n, e) => n + thirdsOf(e), 0);
  let pool = monthAllowance(y, m) - used - plannedBetween(span.from, span.to);
  // one third at a time to the week with the most room, never past a week's quota
  const end = (w) => { const d = parseDate(w); d.setDate(d.getDate() + 6); return isoDate(d); };
  const room = (w) => q - (thirdsBetween(w, end(w)) + plannedBetween(w > today ? w : today, end(w)) + (state.alloc[w] || 0));
  while (pool > 0) {
    const w = weeks.reduce((best, x) => (room(x) > room(best) ? x : best), weeks[0]);
    if (room(w) <= 0) break;
    state.alloc[w] = (state.alloc[w] || 0) + 1;
    pool--;
  }
  persist();
  renderPlan();
  renderToday();
  toast(pool > 0 ? `Repartido hasta el cupo de cada semana; quedan ${fmtThirds(pool)} sin repartir` : 'Repartido entre las semanas que quedan');
};
$('playClear').onclick = () => {
  const span = monthSpan(planMonth.getFullYear(), planMonth.getMonth());
  const before = JSON.stringify(state.alloc);
  for (const [from] of span.weeks) delete state.alloc[from];
  persist();
  renderPlan();
  renderToday();
  toast('Reparto borrado', () => { state.alloc = JSON.parse(before); persist(); renderPlan(); renderToday(); toast('Deshecho'); });
};

// Turn a planned event into a logged free meal (1 → a whole meal, ⅓/⅔ → parts).
function registerPlan(id) {
  const p = state.plans.find((x) => x.id === id);
  if (!p) return;
  const before = JSON.stringify({ entries: state.entries, plans: state.plans });
  state.entries.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fecha: p.fecha,
    hora: state.settings.ranges[p.momento] || '21:00',
    momento: p.momento,
    partes: { comida: p.valor >= 1 && p.valor < 3, alcohol: p.valor === 2, postre: false },
    completa: p.valor === 3,
    descripcion: p.nombre,
    lugar: '',
    disfrute: 0,
    notas: '',
  });
  state.plans = state.plans.filter((x) => x !== p);
  persist();
  hurt(p.valor, null, p.valor >= 3);
  render();
  toast(`${p.nombre} registrado`, () => {
    const b = JSON.parse(before);
    state.entries = b.entries;
    state.plans = b.plans;
    persist();
    render();
    toast('Deshecho');
  });
}

// Registrar tab: a nudge when today has a planned event
function renderTodayPlans() {
  const box = $('todayPlans');
  if (!box) return;
  const today = isoDate(new Date());
  const mine = state.plans.filter((p) => p.fecha === today);
  box.hidden = !mine.length;
  box.innerHTML = '';
  for (const p of mine) {
    const row = document.createElement('div');
    row.className = 'tplan';
    row.append(Object.assign(document.createElement('span'), { textContent: `Hoy: ${planIcon(p)} ${p.nombre} (${fmtThirds(p.valor)})` }));
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Registrar' });
    b.onclick = () => registerPlan(p.id);
    row.appendChild(b);
    box.appendChild(row);
  }
}

// ---- plan sheet ----
function renderPlanSheet() {
  const pre = $('planPresets');
  pre.innerHTML = '';
  for (const [icon, name, valor, momento] of PRESETS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: `${icon} ${name}` });
    b.onclick = () => {
      $('pName').value = name;
      planValor = valor;
      $('pMeal').value = momento;
      renderPlanValor();
      $('pName').focus();
    };
    pre.appendChild(b);
  }
  renderPlanValor();
}
function renderPlanValor() {
  const box = $('planValor');
  box.innerHTML = '';
  for (const [v, label] of inPorciones() ? [[1, '1'], [2, '2'], [3, '3 · completa']] : [[1, '⅓'], [2, '⅔'], [3, '1 completa']]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    b.setAttribute('aria-pressed', String(planValor === v));
    b.onclick = () => { planValor = v; renderPlanValor(); };
    box.appendChild(b);
  }
}
function openPlan(id) {
  const p = id ? state.plans.find((x) => x.id === id) : null;
  editingPlan = p ? p.id : null;
  $('planSheetTitle').textContent = p ? 'Editar evento' : 'Nuevo evento';
  $('pName').value = p ? p.nombre : '';
  const now = new Date();
  const pf = monthSpan(planMonth.getFullYear(), planMonth.getMonth()).from;
  const def = p ? p.fecha : (pf > isoDate(now) ? pf : isoDate(now));
  $('pDate').min = isoDate(now);
  $('pDate').value = def;
  $('pMeal').innerHTML = MEALS.map((m) => `<option${m === (p ? p.momento : 'Cena') ? ' selected' : ''}>${m}</option>`).join('');
  planValor = p ? p.valor : 3;
  $('pDelete').hidden = !p;
  renderPlanSheet();
  openSheet('planSheet');
}
$('planAdd').onclick = () => openPlan(null);
$('planForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const nombre = $('pName').value.trim() || 'Evento';
  const fecha = $('pDate').value;
  if (!fecha) { toast('Elegí la fecha del evento'); return; }
  const data = { fecha, momento: $('pMeal').value, nombre, valor: planValor };
  if (editingPlan) Object.assign(state.plans.find((x) => x.id === editingPlan), data);
  else state.plans.push({ id: 'p' + Date.now().toString(36), ...data });
  planMonth = monthKeyOf(fecha);
  persist();
  closeSheet('planSheet');
  render();
  toast(editingPlan ? 'Evento actualizado' : `${nombre} reservado`);
});
$('pDelete').onclick = () => {
  const before = JSON.stringify(state.plans);
  state.plans = state.plans.filter((x) => x.id !== editingPlan);
  persist();
  closeSheet('planSheet');
  render();
  toast('Evento borrado', () => { state.plans = JSON.parse(before); persist(); render(); toast('Deshecho'); });
};
$('planPrev').onclick = () => { planMonth = new Date(planMonth.getFullYear(), planMonth.getMonth() - 1, 1); renderPlan(); };
$('planNext').onclick = () => { planMonth = new Date(planMonth.getFullYear(), planMonth.getMonth() + 1, 1); renderPlan(); };


// ---- import events from Google Calendar (.ics export) ----

// Words that usually mean a free meal; those events come pre-selected.
const FOOD_WORDS = /cumple|birthday|asado|cena|almuerzo|brunch|casamiento|boda|fiesta|after|brindis|aniversario|despedida|salida|restaurante|parrilla|pizza|sushi|evento/i;
let icsCandidates = [];

// Minimal iCalendar parser: SUMMARY + DTSTART of each VEVENT, yearly recurrences expanded.
function parseICS(text, from, to) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n'); // unfold
  const out = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev && ev.start) out.push(...expandEvent(ev, from, to)); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).toUpperCase(), val = line.slice(i + 1);
    const name = key.split(';')[0];
    if (name === 'SUMMARY') ev.summary = val.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim();
    else if (name === 'DTSTART') ev.start = parseICSDate(val, key);
    else if (name === 'RRULE') ev.rrule = val;
    else if (name === 'STATUS') ev.status = val;
  }
  return out;
}

function parseICSDate(val, key) {
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  if (!hh || /VALUE=DATE(?!-)/.test(key)) return { date: `${y}-${mo}-${d}`, time: null };
  const dt = z ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm)) : new Date(+y, +mo - 1, +d, +hh, +mm);
  return { date: isoDate(dt), time: isoTime(dt) };
}

function expandEvent(ev, from, to) {
  if (ev.status === 'CANCELLED' || !ev.summary) return [];
  const one = (date) => ({ fecha: date, time: ev.start.time, nombre: ev.summary });
  if (!ev.rrule) return ev.start.date >= from && ev.start.date <= to ? [one(ev.start.date)] : [];
  if (!/FREQ=YEARLY/.test(ev.rrule)) return []; // weekly/daily repeats (meetings, gym…) aren't events to plan
  const res = [];
  const md = ev.start.date.slice(5);
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
    const date = `${y}-${md}`;
    if (date >= ev.start.date && date >= from && date <= to) res.push(one(date));
  }
  return res;
}

async function importICS(file) {
  const text = await file.text();
  const now = new Date();
  const from = isoDate(now);
  const end = new Date(now.getFullYear(), now.getMonth() + 7, 0);
  showCandidates(parseICS(text, from, isoDate(end)));
}

// Shared by the .ics import and the Google Calendar sync: pick which events become plans.
function showCandidates(events) {
  const seen = new Set();
  const found = events
    .filter((c) => !state.plans.some((p) => p.fecha === c.fecha && p.nombre === c.nombre))
    .filter((c) => { const k = c.fecha + '|' + c.nombre; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!found.length) { toast('No encontré eventos nuevos en los próximos 6 meses'); return; }
  icsCandidates = found.map((c) => ({
    ...c,
    on: FOOD_WORDS.test(c.nombre),
    momento: c.time ? guessMeal(c.time) : 'Cena',
    valor: /after|brindis/i.test(c.nombre) ? 1 : 3,
  }));
  renderICS();
  openSheet('icsSheet');
}

function renderICS() {
  const list = $('icsList');
  list.innerHTML = '';
  icsCandidates.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'ics' + (c.on ? ' on' : '');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'ics-pick';
    pick.setAttribute('aria-pressed', String(c.on));
    const d = parseDate(c.fecha);
    pick.append(Object.assign(document.createElement('span'), { className: 'ics-check', textContent: c.on ? '✓' : '' }),
      Object.assign(document.createElement('span'), { className: 'ics-date', textContent: d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/^\w/, (x) => x.toUpperCase()) }),
      Object.assign(document.createElement('b'), { textContent: c.nombre }));
    pick.onclick = () => { c.on = !c.on; renderICS(); };
    const val = Object.assign(document.createElement('button'), { type: 'button', className: 'ics-val', textContent: c.valor === 3 && !inPorciones() ? '1' : fmtThirds(c.valor) });
    val.setAttribute('aria-label', `Valor ${val.textContent}. Cambiar`);
    val.onclick = () => { c.valor = c.valor === 3 ? 1 : c.valor + 1; c.on = true; renderICS(); };
    li.append(pick, val);
    list.appendChild(li);
  });
  const n = icsCandidates.filter((c) => c.on).length;
  $('icsSave').textContent = n ? `Reservar ${n} ${n === 1 ? 'evento' : 'eventos'}` : 'Elegí al menos uno';
  $('icsSave').disabled = !n;
}

$('icsBtn').onclick = () => $('icsInput').click();
$('icsInput').onchange = (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (f) importICS(f).catch(() => toast('No pude leer ese archivo. Tiene que ser un .ics exportado del calendario.'));
};
$('icsSave').onclick = () => {
  const chosen = icsCandidates.filter((c) => c.on);
  for (const c of chosen) {
    state.plans.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), fecha: c.fecha, momento: c.momento, nombre: c.nombre, valor: c.valor });
  }
  persist();
  closeSheet('icsSheet');
  render();
  toast(`${chosen.length} ${chosen.length === 1 ? 'evento reservado' : 'eventos reservados'} desde el calendario`);
};


// ---- Google Calendar: read events with the user's Google account (OAuth, read-only) ----
// Needs a Google Cloud OAuth "Web" client ID whose authorized JavaScript origin is where the app
// is published (e.g. https://imanolh96.github.io). Uses the redirect flow: it works in Safari and
// in the home-screen app, where OAuth popups don't come back.

const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const GCAL_TOKEN_KEY = 'comidas-libres:gcal-token';

// Always the same address (…/comidas/), however the app was opened (…/index.html, query, etc.):
// it has to match the "Authorized redirect URI" in Google Cloud exactly.
function gcalRedirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function gcalToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(GCAL_TOKEN_KEY) || 'null');
    return t && t.exp > Date.now() + 60000 ? t.token : null;
  } catch (e) { return null; }
}

function gcalConnect() {
  const clientId = (state.settings.gcalClientId || '').trim();
  if (window.top !== window || location.protocol !== 'https:') {
    toast('Google Calendar funciona en la app publicada (GitHub Pages), no en esta vista.');
    return;
  }
  if (!clientId) {
    toast('Primero pegá tu Google Client ID en Ajustes.');
    $('btnSettings').click();
    return;
  }
  const t = gcalToken();
  if (t) { gcalSync(t); return; }
  const stateTok = Math.random().toString(36).slice(2);
  try { sessionStorage.setItem('comidas-libres:gcal-state', stateTok); } catch (e) { /* ignore */ }
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gcalRedirectUri(),
    response_type: 'token',
    scope: GCAL_SCOPE,
    include_granted_scopes: 'true',
    state: stateTok,
    prompt: state.settings.gcalConnected ? '' : 'consent',
  });
  if (!q.get('prompt')) q.delete('prompt');
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
}

// Back from Google: the token arrives in the URL fragment.
function gcalHandleRedirect() {
  if (!location.hash.includes('access_token=') && !location.hash.includes('error=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let expected = null;
  try { expected = sessionStorage.getItem('comidas-libres:gcal-state'); } catch (e) { /* ignore */ }
  if (p.get('error')) {
    const code = p.get('error');
    const hint = code === 'access_denied'
      ? 'Se canceló el permiso, o tu mail no está en "Usuarios de prueba" de Google Cloud.'
      : 'Google rechazó la conexión.';
    gcalError(hint, `Paso: volver de Google\nerror: ${code}${p.get('error_description') ? `\n${p.get('error_description')}` : ''}`);
    return;
  }
  if (expected && p.get('state') !== expected) {
    gcalError('La conexión con Google no se pudo verificar. Probá de nuevo.', 'Paso: volver de Google\nerror: state no coincide');
    return;
  }
  const token = p.get('access_token');
  const exp = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
  try { sessionStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify({ token, exp })); } catch (e) { /* ignore */ }
  state.settings.gcalConnected = true;
  persist();
  showTab('plan');
  gcalSync(token);
}

async function gcalGet(token, path, params = {}) {
  const url = 'https://www.googleapis.com/calendar/v3/' + path + '?' + new URLSearchParams(params);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401) {
    try { sessionStorage.removeItem(GCAL_TOKEN_KEY); } catch (e) { /* ignore */ }
    throw new Error('auth');
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) { /* not JSON */ }
    const err = new Error('http');
    err.detail = `Paso: leer ${path.split('?')[0]}\nHTTP ${res.status}${detail ? `\n${detail}` : ''}`;
    throw err;
  }
  return res.json();
}

async function gcalSync(token) {
  toast('Buscando eventos en Google Calendar…');
  try {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth() + 7, 0, 23, 59);
    const cals = (await gcalGet(token, 'users/me/calendarList', { minAccessRole: 'reader' })).items || [];
    // calendars shown in the user's Google Calendar, minus holiday calendars
    const use = cals.filter((c) => c.selected !== false && !/#holiday@/.test(c.id));
    const out = [];
    const masters = new Map(); // recurringEventId -> recurrence rules
    for (const cal of use) {
      let pageToken;
      do {
        const r = await gcalGet(token, `calendars/${encodeURIComponent(cal.id)}/events`, {
          timeMin: now.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
          ...(pageToken ? { pageToken } : {}),
        });
        for (const e of r.items || []) {
          if (e.status === 'cancelled' || !e.summary) continue;
          const allDay = !!(e.start && e.start.date);
          const dt = allDay ? null : new Date(e.start.dateTime);
          out.push({ fecha: allDay ? e.start.date : isoDate(dt), time: allDay ? null : isoTime(dt), nombre: e.summary.trim(),
            rec: e.recurringEventId ? { cal: cal.id, id: e.recurringEventId } : null, birthday: e.eventType === 'birthday' });
        }
        pageToken = r.nextPageToken;
      } while (pageToken);
    }
    // keep yearly repeats (birthdays, anniversaries), drop weekly/daily ones (meetings, gym…)
    for (const ev of out) {
      if (!ev.rec || ev.birthday || masters.has(ev.rec.id)) continue;
      try {
        const m = await gcalGet(token, `calendars/${encodeURIComponent(ev.rec.cal)}/events/${encodeURIComponent(ev.rec.id)}`);
        masters.set(ev.rec.id, (m.recurrence || []).join(';'));
      } catch (e) { masters.set(ev.rec.id, ''); }
    }
    const events = out.filter((ev) => !ev.rec || ev.birthday || /FREQ=YEARLY/.test(masters.get(ev.rec.id)));
    state.settings.gcalLastSync = new Date().toISOString();
    persist();
    renderPlan();
    showCandidates(events);
  } catch (e) {
    if (e.message === 'auth') { toast('La sesión de Google venció. Tocá de nuevo para reconectar.'); return; }
    gcalError('No pude leer Google Calendar.', e.detail || `Paso: leer eventos\n${e.name}: ${e.message}`);
  }
}

// Errors stay on screen with the exact detail, so it can be copied and reported.
function gcalError(msg, detail) {
  $('dialogMsg').textContent = msg;
  const box = $('dialogActions');
  box.innerHTML = '';
  box.appendChild(Object.assign(document.createElement('pre'), { className: 'err-detail', textContent: detail }));
  const copy = Object.assign(document.createElement('button'), { type: 'button', className: 'solid', textContent: 'Copiar detalle' });
  copy.onclick = () => {
    navigator.clipboard?.writeText(detail).then(() => { copy.textContent = 'Copiado'; }, () => { copy.textContent = 'Seleccioná el texto para copiarlo'; });
  };
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: 'Cerrar' });
  close.onclick = () => closeSheet('dialog');
  box.append(copy, close);
  openSheet('dialog');
}

$('gcalBtn').onclick = gcalConnect;

// ---------- "damage" feedback when a free meal is added ----------

// Red vignette + a short shake + a floating "−⅓ 💔" from the key. A whole free meal hits harder.
function hurt(thirds, from, heavy = thirds >= 3) {
  if (!thirds) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // a fresh overlay per hit, removed when done: nothing to "restart", so it fires every time
  const fx = Object.assign(document.createElement('div'), { className: 'hurt' + (heavy ? ' big' : '') });
  fx.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fx);
  const dur = still ? 400 : heavy ? 1100 : 700;
  const flash = fx.animate(heavy
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 0.5, offset: 0.3 }, { opacity: 1, offset: 0.42 }, { opacity: 0 }]
    : [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }],
  { duration: dur, easing: 'ease-out', fill: 'forwards' });
  flash.onfinish = () => fx.remove();
  setTimeout(() => fx.remove(), dur + 200); // in case onfinish never fires

  if (!still) {
    const main = document.querySelector('main');
    const d = heavy ? 9 : 5;
    main.animate([
      { transform: 'none' }, { transform: `translateX(${-d}px)` }, { transform: `translateX(${d}px)` },
      { transform: `translateX(${-d}px)` }, { transform: `translateX(${d / 2}px)` }, { transform: 'none' },
    ], { duration: heavy ? 550 : 320, easing: 'cubic-bezier(.36,.07,.19,.97)' });
  }
  if (from && !still) {
    const r = from.getBoundingClientRect();
    const f = Object.assign(document.createElement('div'), { className: 'dmg' + (heavy ? ' big' : ''), textContent: `−${fmtThirds(thirds)} 💔` });
    f.style.left = `${r.left + r.width / 2}px`;
    f.style.top = `${r.top + r.height * 0.4}px`;
    document.body.appendChild(f);
    f.animate([
      { opacity: 0, transform: 'translate(-50%, -30%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, -60%) scale(1.15)', offset: 0.15 },
      { opacity: 0, transform: 'translate(-50%, -190%) scale(1)' },
    ], { duration: 1050, easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => f.remove(), 1150);
  }
  if (navigator.vibrate) navigator.vibrate(heavy ? [40, 60, 80] : 35);
}

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
function toast(msg, undo, rateId) {
  $('toastMsg').textContent = msg;
  toastUndo = undo || null;
  $('toastUndo').hidden = !undo;
  const e = rateId && state.entries.find((x) => x.id === rateId);
  const joy = $('toastJoy');
  joy.hidden = !e;
  if (e) {
    const box = joy.querySelector('.faces');
    box.innerHTML = '';
    for (const [v, face, label] of JOY) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: face });
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', String(joyOf(e.disfrute)?.[0] === v));
      b.onclick = () => {
        e.disfrute = v;
        persist();
        render();
        toast(`Anotado: ${label.toLowerCase()} ${face}`);
      };
      box.append(b);
    }
  }
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').classList.remove('show'); toastUndo = null; }, e ? 7000 : undo ? 5000 : 2600);
}
$('toastUndo').onclick = () => { const fn = toastUndo; toastUndo = null; if (fn) fn(); };

// Keep "today" and the auto-detected meal fresh when the app comes back to the foreground.
// Coming back after a while (30 min) resets Registrar to today, so a leftover "Ayer" isn't used by mistake.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 30 * 60 * 1000) { dayOffset = 0; pickedDate = null; stripOffset = 0; pickedMeal = landingMeal(isoDate(new Date())) || null; }
  render();
});
setInterval(render, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // when a new version takes over, reload once so it shows right away
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      reg.update();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
    })
    .catch(() => {});
}

pickedMeal = landingMeal(isoDate(new Date())) || null;
render();
gcalHandleRedirect();
