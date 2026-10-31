// Persistent user settings, stored as JSON in the app's user-data folder.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  shortcut: 'Alt+Shift+P',
  hands: null,            // enabled sprite files; null = all hands
  handSize: 210,          // on-screen hand height in px
  speed: 1,               // animation speed multiplier
  switchMargin: 90,       // px another edge must be closer by before the hand swaps
  keepStyle: false,       // keep the same hand when switching edges
  wobble: true,           // gentle idle wobble
  shadow: true,           // drop shadow
  autoHideSeconds: 0,     // hide when the mouse is still this long (0 = never)
  pokeOnClick: false,     // the hand jabs at the cursor on every mouse click (needs a global input hook)
  launchAtLogin: false,
};

const LIMITS = {
  handSize: [100, 480],
  speed: [0.4, 2.5],
  switchMargin: [0, 400],
  autoHideSeconds: [0, 120],
};

function sanitize(input) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in input)) continue;
    const v = input[key];
    const d = DEFAULTS[key];
    if (key === 'hands') {
      out.hands = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
    } else if (typeof d === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = LIMITS[key];
      out[key] = Math.min(hi, Math.max(lo, v));
    } else if (typeof d === typeof v) {
      out[key] = v;
    }
  }
  return out;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.isFirstRun = !fs.existsSync(this.file);
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run or broken file */ }
    this.data = sanitize(raw);
  }
  get() { return { ...this.data }; }
  update(patch) {
    this.data = sanitize({ ...this.data, ...patch });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
  reset() { return this.update(DEFAULTS); }
}

module.exports = { Settings, DEFAULTS, sanitize };
