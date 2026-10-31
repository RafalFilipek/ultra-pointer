const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Updater, updateMode, UPDATES_ENABLED, FIRST_CHECK_DELAY_MS, CHECK_EVERY_MS } = require('../updater');
const { sanitize } = require('../settings');

function fakeAutoUpdater({ fail = false } = {}) {
  const au = new EventEmitter();
  au.checks = 0;
  au.installs = [];
  au.checkForUpdates = async () => { au.checks++; if (fail) throw new Error('offline'); };
  au.quitAndInstall = (...args) => au.installs.push(args);
  return au;
}

function fakeTimers() {
  const t = { timeouts: new Map(), intervals: new Map(), next: 1 };
  t.setTimeout = (fn, ms) => { const id = t.next++; t.timeouts.set(id, { fn, ms }); return id; };
  t.clearTimeout = (id) => t.timeouts.delete(id);
  t.setInterval = (fn, ms) => { const id = t.next++; t.intervals.set(id, { fn, ms }); return id; };
  t.clearInterval = (id) => t.intervals.delete(id);
  return t;
}

const tick = () => new Promise((r) => setImmediate(r));

test('update mode: install on Windows, notify on macOS, off in development', () => {
  assert.equal(updateMode('win32', true, true), 'install');
  assert.equal(updateMode('darwin', true, true), 'notify');
  assert.equal(updateMode('linux', true, true), 'off');
  assert.equal(updateMode('win32', false, true), 'off');
});

test('update checks stay off while the releases feed is private', () => {
  assert.equal(UPDATES_ENABLED, false);
  assert.equal(updateMode('win32', true), 'off');
  assert.equal(updateMode('darwin', true), 'off');
});

test('autoUpdate is on by default', () => {
  assert.equal(sanitize({}).autoUpdate, true);
  assert.equal(sanitize({ autoUpdate: false }).autoUpdate, false);
});

test('off mode never loads electron-updater', () => {
  const u = new Updater({ mode: 'off', loadUpdater: () => { throw new Error('loaded'); } });
  assert.equal(u.check(), false);
  assert.equal(u.info().status, 'off');
});

test('windows: downloads automatically, notifies once and restarts to install', async () => {
  const au = fakeAutoUpdater();
  const notes = [], changes = [];
  const u = new Updater({ mode: 'install', loadUpdater: () => au, notify: (t, b, click) => notes.push({ t, click }), onChange: (i) => changes.push(i.status) });
  assert.equal(au.autoDownload, true);
  assert.equal(au.autoInstallOnAppQuit, true);
  assert.equal(u.restart(), false); // nothing downloaded yet
  u.check();
  await tick();
  assert.equal(au.checks, 1);
  au.emit('checking-for-update');
  au.emit('update-available', { version: '0.4.0' });
  au.emit('download-progress', { percent: 41.6 });
  assert.deepEqual(u.info().percent, 42);
  assert.equal(u.check(), false); // no new check while downloading
  au.emit('update-downloaded', { version: '0.4.0' });
  au.emit('update-downloaded', { version: '0.4.0' });
  assert.equal(notes.length, 1);
  assert.deepEqual(changes, ['checking', 'downloading', 'downloading', 'ready', 'ready']);
  notes[0].click();
  assert.deepEqual(au.installs, [[true, true]]);
});

test('macOS: only notifies and opens the release page', () => {
  const au = fakeAutoUpdater();
  const urls = [], notes = [];
  const u = new Updater({ mode: 'notify', loadUpdater: () => au, openUrl: (x) => urls.push(x), notify: (t, b, c) => notes.push(c) });
  assert.equal(au.autoDownload, false);
  assert.equal(au.autoInstallOnAppQuit, false);
  au.emit('update-available', { version: '0.4.0' });
  assert.equal(u.info().status, 'available');
  assert.equal(notes.length, 1);
  u.primaryAction();
  assert.deepEqual(urls, ['https://github.com/RafalFilipek/ultra-pointer/releases/tag/v0.4.0']);
  assert.equal(au.installs.length, 0);
});

test('errors are reported and a later check clears them', async () => {
  const au = fakeAutoUpdater({ fail: true });
  const u = new Updater({ mode: 'install', loadUpdater: () => au });
  u.check();
  await tick();
  assert.equal(u.info().status, 'error');
  assert.equal(u.info().error, 'offline');
  au.emit('update-not-available');
  assert.deepEqual([u.info().status, u.info().error], ['up-to-date', null]);
});

test('auto check schedules a first check and a periodic one, and can be turned off', () => {
  const au = fakeAutoUpdater();
  const timers = fakeTimers();
  const u = new Updater({ mode: 'install', loadUpdater: () => au, timers });
  u.setAutoCheck(true);
  assert.deepEqual([...timers.timeouts.values()].map((x) => x.ms), [FIRST_CHECK_DELAY_MS]);
  assert.deepEqual([...timers.intervals.values()].map((x) => x.ms), [CHECK_EVERY_MS]);
  u.setAutoCheck(true); // no duplicates
  assert.equal(timers.intervals.size, 1);
  u.setAutoCheck(false);
  assert.equal(timers.timeouts.size + timers.intervals.size, 0);
});
