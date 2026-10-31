const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ClickHook, PERMISSION_POLL_MS } = require('../click-hook');
const { sanitize } = require('../settings');

function fakeHook({ failStart = false } = {}) {
  const h = { listeners: {}, started: 0, stopped: 0 };
  h.on = (ev, fn) => { h.listeners[ev] = fn; };
  h.start = () => { if (failStart) throw new Error('no display'); h.started++; };
  h.stop = () => { h.stopped++; };
  return h;
}

function fakeTimers() {
  const t = { fns: new Map(), next: 1 };
  t.setInterval = (fn) => { const id = t.next++; t.fns.set(id, fn); return id; };
  t.clearInterval = (id) => { t.fns.delete(id); };
  t.tick = () => [...t.fns.values()].forEach((fn) => fn());
  return t;
}

test('pokeOnClick is off by default and must be a boolean', () => {
  assert.equal(sanitize({}).pokeOnClick, false);
  assert.equal(sanitize({ pokeOnClick: 'yes' }).pokeOnClick, false);
  assert.equal(sanitize({ pokeOnClick: true }).pokeOnClick, true);
});

test('click hook starts, forwards mouse presses and stops', () => {
  const hook = fakeHook();
  const clicks = [], statuses = [];
  const ch = new ClickHook({ onClick: (e) => clicks.push(e), onStatus: (s) => statuses.push(s.status), platform: 'win32', loadHook: () => hook });
  ch.setEnabled(true);
  assert.equal(ch.status, 'running');
  hook.listeners.mousedown({ button: 1 });
  assert.equal(clicks.length, 1);
  ch.setEnabled(true); // no double start
  assert.equal(hook.started, 1);
  ch.setEnabled(false);
  assert.equal(hook.stopped, 1);
  ch.setEnabled(true); // restart reuses the same hook and listener
  assert.equal(hook.started, 2);
  assert.deepEqual(statuses, ['running', 'off', 'running']);
});

test('never loads the native hook while the option is off', () => {
  let loaded = false;
  const ch = new ClickHook({ onClick() {}, platform: 'darwin', loadHook: () => { loaded = true; return fakeHook(); } });
  ch.setEnabled(false, { prompt: false });
  assert.equal(loaded, false);
  assert.equal(ch.status, 'off');
});

test('macOS waits for Accessibility access, then starts by itself', () => {
  const hook = fakeHook(), timers = fakeTimers();
  let trusted = false; const prompts = [];
  const ch = new ClickHook({
    onClick() {}, platform: 'darwin', loadHook: () => hook, timers,
    isTrusted: (prompt) => { prompts.push(prompt); return trusted; },
  });
  ch.setEnabled(true);
  assert.equal(ch.status, 'needs-permission');
  assert.equal(hook.started, 0);
  assert.deepEqual(prompts, [true]);
  timers.tick();
  assert.deepEqual(prompts, [true, false], 'polling never re-prompts');
  assert.equal(timers.fns.size, 1, 'only one poll timer');
  trusted = true;
  timers.tick();
  assert.equal(ch.status, 'running');
  assert.equal(timers.fns.size, 0, 'polling stops once running');
  assert.ok(PERMISSION_POLL_MS >= 500);
});

test('turning the option off while waiting for access stops polling', () => {
  const timers = fakeTimers();
  const ch = new ClickHook({ onClick() {}, platform: 'darwin', loadHook: fakeHook, timers, isTrusted: () => false });
  ch.setEnabled(true, { prompt: false });
  ch.setEnabled(false);
  assert.equal(ch.status, 'off');
  assert.equal(timers.fns.size, 0);
});

test('a hook that fails to start reports unavailable instead of crashing', () => {
  const ch = new ClickHook({ onClick() {}, platform: 'win32', loadHook: () => fakeHook({ failStart: true }) });
  ch.setEnabled(true);
  assert.equal(ch.status, 'unavailable');
  assert.match(ch.error, /no display/);
  const missing = new ClickHook({ onClick() {}, platform: 'win32', loadHook: () => { throw new Error('module not found'); } });
  missing.setEnabled(true);
  assert.equal(missing.status, 'unavailable');
});

test('the native hook module ships prebuilt binaries for every release target', () => {
  const dir = path.join(path.dirname(require.resolve('uiohook-napi/package.json')), 'prebuilds');
  for (const t of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64']) {
    assert.ok(fs.existsSync(path.join(dir, t)), t);
  }
});

test('poke curve jabs out and comes back to rest', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/hand-engine.js'), 'utf8'), sandbox);
  const curve = sandbox.window.HandEngine.pokeCurve;
  assert.equal(curve(0), 0);
  assert.equal(curve(1), 0);
  assert.ok(Math.abs(curve(0.3) - 1) < 1e-9, 'full reach at the hit');
  let prev = 0;
  for (let t = 0.02; t <= 0.3; t += 0.02) { assert.ok(curve(t) >= prev); prev = curve(t); }
  for (let t = 0.32; t < 1; t += 0.02) { assert.ok(curve(t) <= prev + 1e-9); prev = curve(t); }
});
