const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Settings, DEFAULTS, sanitize } = require('../settings');

test('sanitize fills defaults and drops unknown keys', () => {
  const s = sanitize({ foo: 1, handSize: 300 });
  assert.equal(s.handSize, 300);
  assert.equal(s.shortcut, DEFAULTS.shortcut);
  assert.ok(!('foo' in s));
});

test('sanitize clamps numbers and rejects wrong types', () => {
  const s = sanitize({ handSize: 5000, speed: -1, shadow: 'yes', hands: 'all' });
  assert.equal(s.handSize, 480);
  assert.equal(s.speed, 0.4);
  assert.equal(s.shadow, DEFAULTS.shadow);
  assert.equal(s.hands, null);
});

test('settings persist to disk and survive a broken file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));
  const a = new Settings(dir);
  assert.equal(a.isFirstRun, true);
  a.update({ handSize: 260, hands: ['01-realistic.png'] });
  const b = new Settings(dir);
  assert.equal(b.isFirstRun, false);
  assert.equal(b.data.handSize, 260);
  assert.deepEqual(b.data.hands, ['01-realistic.png']);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{oops');
  assert.equal(new Settings(dir).data.handSize, DEFAULTS.handSize);
});

test('every sprite listed in hands.json exists and matches renderer/sprites.js', () => {
  const root = path.join(__dirname, '..');
  const hands = require('../assets/sprites/hands.json');
  for (const h of hands) assert.ok(fs.existsSync(path.join(root, 'assets/sprites', h.file)), h.file);
  const js = fs.readFileSync(path.join(root, 'renderer/sprites.js'), 'utf8');
  const fromJs = JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1));
  assert.deepEqual(fromJs.map((h) => h.file), hands.map((h) => h.file));
});

test('all JavaScript files parse', () => {
  const { execFileSync } = require('child_process');
  const root = path.join(__dirname, '..');
  for (const f of ['main.js', 'preload.js', 'settings.js', 'renderer/hand-engine.js', 'renderer/overlay.js', 'renderer/settings-ui.js', 'renderer/sprites.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, f)]);
  }
});
