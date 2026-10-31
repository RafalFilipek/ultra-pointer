// Settings window. Every change is saved straight away and pushed to the overlays.
const api = window.ultraPointer;
const $ = (id) => document.getElementById(id);
let state = null;   // { settings, defaults, hands, platform, version, shortcutOk }
let isMac = false;

// ---------- shortcut formatting & recording ----------

const MAC_SYMBOLS = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
const CODE_KEYS = {
  Space: 'Space', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};

function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] || null;
}

function accelFromEvent(e) {
  const mods = [];
  if (isMac) {
    if (e.metaKey) mods.push('Command');
    if (e.ctrlKey) mods.push('Control');
  } else {
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.metaKey) mods.push('Super');
  }
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = keyFromCode(e.code);
  if (!key) return { partial: mods };
  const isFKey = /^F\d+$/.test(key);
  if (!mods.length && !isFKey) return { error: 'Add a modifier key (⌘, Ctrl, Alt or Shift).' };
  if (mods.length === 1 && mods[0] === 'Shift' && !isFKey) return { error: 'Shift alone would block typing. Add ⌘, Ctrl or Alt.' };
  return { accel: [...mods, key].join('+') };
}

function renderKeys(el, accel) {
  el.textContent = '';
  if (!accel) { el.textContent = 'No shortcut'; return; }
  const parts = accel.split('+');
  for (const p of parts) {
    const k = document.createElement('kbd');
    k.textContent = isMac ? (MAC_SYMBOLS[p] || p) : (p === 'CommandOrControl' ? 'Ctrl' : p);
    if (isMac && p === 'CommandOrControl') k.textContent = '⌘';
    el.appendChild(k);
  }
}

let recording = false;
async function startRecording() {
  recording = true;
  $('shortcut-error').hidden = true;
  $('shortcut').classList.add('recording');
  $('shortcut').textContent = 'Press the new shortcut…';
  $('record').textContent = 'Cancel';
  await api.suspendShortcut();
}
async function stopRecording() {
  recording = false;
  $('shortcut').classList.remove('recording');
  $('record').textContent = 'Change…';
  renderKeys($('shortcut'), state.settings.shortcut);
  await api.resumeShortcut();
}
$('record').addEventListener('click', () => (recording ? stopRecording() : startRecording()));
window.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { stopRecording(); return; }
  const r = accelFromEvent(e);
  if (r.partial) { $('shortcut').textContent = ''; renderKeys($('shortcut'), r.partial.join('+') || null); return; }
  if (r.error) { $('shortcut-error').textContent = r.error; $('shortcut-error').hidden = false; return; }
  recording = false;
  $('shortcut').classList.remove('recording');
  $('record').textContent = 'Change…';
  const res = await api.updateSettings({ shortcut: r.accel });
  state.settings = res.settings;
  renderKeys($('shortcut'), state.settings.shortcut);
  if (!res.ok) { $('shortcut-error').textContent = res.error; $('shortcut-error').hidden = false; }
  else updateTrayHints();
}, true);

function updateTrayHints() {
  $('shortcut-error').hidden = true;
}

// ---------- sliders & checkboxes ----------

const FORMAT = {
  handSize: (v) => `${v} px`,
  speed: (v) => `${Number(v).toFixed(1)}×`,
  switchMargin: (v) => (v == 0 ? 'instant' : `${v} px`),
  autoHideSeconds: (v) => (v == 0 ? 'never' : `${v} s`),
};

function bindSlider(id) {
  const input = $(id), out = $(id + '-out');
  input.value = state.settings[id];
  out.textContent = FORMAT[id](input.value);
  input.addEventListener('input', () => {
    out.textContent = FORMAT[id](input.value);
    applyPreview({ [id]: Number(input.value) });
  });
  input.addEventListener('change', () => save({ [id]: Number(input.value) }));
}

function bindCheck(id) {
  const input = $(id);
  input.checked = !!state.settings[id];
  input.addEventListener('change', () => save({ [id]: input.checked }));
}

async function save(patch) {
  const res = await api.updateSettings(patch);
  state.settings = res.settings;
  applyPreview(state.settings);
}

// ---------- hands ----------

function enabledSet() {
  return new Set(state.settings.hands || state.hands.map((h) => h.file));
}

function renderHands() {
  const wrap = $('hands');
  wrap.textContent = '';
  const on = enabledSet();
  for (const h of state.hands) {
    const label = document.createElement('label');
    label.className = 'hand';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'hand-' + h.name;
    input.checked = on.has(h.file);
    input.addEventListener('change', () => toggleHand(h.file, input.checked, input));
    const img = document.createElement('img');
    img.src = '../assets/sprites/' + h.file;
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = h.name;
    label.append(input, img, name);
    wrap.appendChild(label);
  }
  updateHandsCount();
}

function updateHandsCount() {
  const n = enabledSet().size, total = state.hands.length;
  $('hands-count').textContent = n === total
    ? `All ${total} hands are in the mix. Click a hand to leave it out.`
    : `${n} of ${total} hands in the mix.`;
}

async function toggleHand(file, checked, input) {
  const on = enabledSet();
  if (checked) on.add(file); else on.delete(file);
  if (!on.size) { input.checked = true; return; } // keep at least one
  const all = on.size === state.hands.length;
  await save({ hands: all ? null : state.hands.map((h) => h.file).filter((f) => on.has(f)) });
  updateHandsCount();
}

$('hands-all').addEventListener('click', async () => { await save({ hands: null }); renderHands(); });
$('hands-one').addEventListener('click', async () => { await save({ hands: [state.hands[0].file] }); renderHands(); });

// ---------- live preview ----------

let preview;
function applyPreview(s) {
  if (!preview) return;
  const o = {};
  if ('handSize' in s) o.handHeight = Math.min(s.handSize, 200); // the preview box is small
  if ('speed' in s) o.speed = s.speed;
  if ('switchMargin' in s) o.switchMargin = s.switchMargin;
  if ('keepStyle' in s) o.keepStyle = s.keepStyle;
  if ('wobble' in s) o.wobble = s.wobble ? 0.035 : 0;
  if ('shadow' in s) o.shadow = s.shadow;
  if ('hands' in s) o.enabled = s.hands;
  preview.setOptions(o);
}

function setupPreview() {
  const box = $('preview');
  preview = new HandEngine($('preview-canvas'), { spriteBase: '../assets/sprites/' });
  // the engine sizes itself from the window; keep it to the box instead
  const fit = () => {
    const r = box.getBoundingClientRect();
    preview.w = r.width; preview.h = r.height;
    const dpr = window.devicePixelRatio || 1;
    preview.canvas.width = Math.round(r.width * dpr);
    preview.canvas.height = Math.round(r.height * dpr);
    preview.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  preview._resize = fit;
  fit();
  new ResizeObserver(fit).observe(box);
  box.addEventListener('pointermove', (e) => {
    const r = box.getBoundingClientRect();
    preview.setCursor(e.clientX - r.left, e.clientY - r.top);
    preview.setActive(true);
  });
  box.addEventListener('pointerleave', () => preview.setActive(false));
  applyPreview(state.settings);
}

// ---------- boot ----------

(async function init() {
  state = await api.getSettings();
  isMac = state.platform === 'darwin';
  $('version').textContent = 'v' + state.version;
  renderKeys($('shortcut'), state.settings.shortcut);
  if (!state.shortcutOk) {
    $('shortcut-error').textContent = `“${state.settings.shortcut}” is taken by another app. Pick a different shortcut.`;
    $('shortcut-error').hidden = false;
  }
  ['handSize', 'speed', 'switchMargin', 'autoHideSeconds'].forEach(bindSlider);
  ['keepStyle', 'wobble', 'shadow', 'launchAtLogin'].forEach(bindCheck);
  if (state.platform === 'linux') $('launchAtLogin').closest('label').hidden = true;
  renderHands();
  setupPreview();

  $('show').addEventListener('click', () => api.preview());
  $('reset').addEventListener('click', async () => {
    const res = await api.resetSettings();
    state.settings = res.settings;
    ['handSize', 'speed', 'switchMargin', 'autoHideSeconds'].forEach((id) => {
      $(id).value = state.settings[id];
      $(id + '-out').textContent = FORMAT[id]($(id).value);
    });
    ['keepStyle', 'wobble', 'shadow', 'launchAtLogin'].forEach((id) => { $(id).checked = !!state.settings[id]; });
    renderKeys($('shortcut'), state.settings.shortcut);
    renderHands();
    applyPreview(state.settings);
  });
})();
