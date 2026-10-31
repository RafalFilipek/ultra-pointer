// Ultra Pointer: transparent, click-through, always-on-top overlay on every
// display. A global shortcut toggles a hand on a stick that points at the cursor.
const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, nativeImage, ipcMain, shell, systemPreferences, Notification } = require('electron');
const path = require('path');
const { Settings, DEFAULTS } = require('./settings');
const { ClickHook } = require('./click-hook');
const { Updater, updateMode } = require('./updater');

const TICK_MS = 1000 / 60;
const HANDS = require('./assets/sprites/hands.json');

let settings;
let overlays = [];        // { win, display }
let settingsWin = null;
let active = false;       // toggled by the shortcut
let tray = null;
let timer = null;
let registered = null;    // currently registered accelerator
let lastPoint = { x: 0, y: 0 };
let lastMove = Date.now();
let clickHook = null;
let updater = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => openSettings());

// ---------- overlays ----------

function createOverlay(display) {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.setBounds({ x, y, width, height });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('settings', settings.get());
    win.showInactive();
  });
  return { win, display };
}

function rebuildOverlays() {
  overlays.forEach(({ win }) => !win.isDestroyed() && win.destroy());
  overlays = screen.getAllDisplays().map(createOverlay);
}

function tick() {
  const p = screen.getCursorScreenPoint();
  const now = Date.now();
  if (p.x !== lastPoint.x || p.y !== lastPoint.y) { lastMove = now; lastPoint = p; }
  const idleLimit = settings.data.autoHideSeconds * 1000;
  const idle = idleLimit > 0 && now - lastMove > idleLimit;
  for (const { win, display } of overlays) {
    if (win.isDestroyed()) continue;
    const b = display.bounds;
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    win.webContents.send('state', { x: p.x - b.x, y: p.y - b.y, active: active && inside && !idle });
  }
}

// ---------- poke on click ----------

const ACCESSIBILITY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

// Send the poke only to the display the cursor is on; the renderer ignores it while the hand is hidden.
function poke() {
  if (!active) return;
  const p = screen.getCursorScreenPoint();
  lastMove = Date.now(); // a click counts as activity for auto-hide
  for (const { win, display } of overlays) {
    if (win.isDestroyed()) continue;
    const b = display.bounds;
    if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) {
      win.webContents.send('state', { x: p.x - b.x, y: p.y - b.y, active: true });
      win.webContents.send('poke');
    }
  }
}

function sendPokeStatus(info) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('poke-status', info);
}

// ---------- updates ----------

function onUpdateChange(info) {
  updateTrayMenu();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('update-status', info);
}

function showNotification(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  n.on('click', onClick);
  n.show();
}

// ---------- shortcut ----------

function toggle() {
  active = !active;
  lastMove = Date.now();
  updateTrayMenu();
}

function registerShortcut(accel) {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  try {
    if (accel && globalShortcut.register(accel, toggle)) { registered = accel; return true; }
  } catch { /* invalid accelerator */ }
  return false;
}

// ---------- settings ----------

function broadcastSettings() {
  const s = settings.get();
  overlays.forEach(({ win }) => !win.isDestroyed() && win.webContents.send('settings', s));
}

function applyLoginItem() {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: settings.data.launchAtLogin });
  }
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 560,
    minHeight: 520,
    title: 'Ultra Pointer Settings',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    registerShortcut(settings.data.shortcut); // in case the window closed mid-recording
  });
}

ipcMain.handle('settings:get', () => ({
  settings: settings.get(),
  defaults: DEFAULTS,
  hands: HANDS,
  platform: process.platform,
  version: app.getVersion(),
  shortcutOk: registered === settings.data.shortcut,
}));

ipcMain.handle('settings:update', (_e, patch) => {
  if ('shortcut' in patch) {
    if (!registerShortcut(patch.shortcut)) {
      registerShortcut(settings.data.shortcut);
      return { ok: false, error: `“${patch.shortcut}” can't be used. Another app may already own it.`, settings: settings.get() };
    }
  }
  const s = settings.update(patch);
  if ('launchAtLogin' in patch) applyLoginItem();
  if ('pokeOnClick' in patch) clickHook.setEnabled(s.pokeOnClick);
  if ('autoUpdate' in patch) updater.setAutoCheck(s.autoUpdate);
  broadcastSettings();
  updateTrayMenu();
  return { ok: true, settings: s };
});

ipcMain.handle('settings:reset', () => {
  const s = settings.reset();
  registerShortcut(s.shortcut);
  applyLoginItem();
  clickHook.setEnabled(s.pokeOnClick);
  updater.setAutoCheck(s.autoUpdate);
  broadcastSettings();
  updateTrayMenu();
  return { ok: true, settings: s };
});

// While the user records a new shortcut, the old one must not fire.
ipcMain.handle('shortcut:suspend', () => { if (registered) globalShortcut.unregister(registered); registered = null; });
ipcMain.handle('shortcut:resume', () => registerShortcut(settings.data.shortcut));

ipcMain.handle('preview', () => { if (!active) toggle(); });

ipcMain.handle('poke:status', () => clickHook.info());
ipcMain.handle('poke:open-permissions', () => {
  if (process.platform === 'darwin') shell.openExternal(ACCESSIBILITY_PANE);
});

ipcMain.handle('update:status', () => updater.info());
ipcMain.handle('update:action', () => { updater.primaryAction(); return updater.info(); });

// ---------- tray ----------

function updateMenuItems() {
  if (!updater || updater.mode === 'off') return [];
  const { status, version, percent } = updater.info();
  const act = () => updater.primaryAction();
  if (status === 'ready') return [{ label: `Restart to update to ${version}`, click: act }];
  if (status === 'available') return [{ label: `Download Ultra Pointer ${version}…`, click: act }];
  if (status === 'downloading') return [{ label: `Downloading update… ${percent}%`, enabled: false }];
  if (status === 'checking') return [{ label: 'Checking for updates…', enabled: false }];
  return [{ label: 'Check for updates', click: act }];
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: active ? 'Hide hand' : 'Show hand', accelerator: registered || undefined, click: toggle },
    { label: 'Settings…', click: openSettings },
    ...updateMenuItems(),
    { type: 'separator' },
    { label: 'Quit Ultra Pointer', role: 'quit' },
  ]));
  tray.setToolTip(`Ultra Pointer (${registered || 'no shortcut'})`);
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  if (process.env.ULTRA_POINTER_AUTOSTART === '1') active = true;

  clickHook = new ClickHook({
    onClick: poke,
    onStatus: sendPokeStatus,
    isTrusted: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
  });
  // Don't pop the macOS permission prompt on launch; only when the user turns the option on.
  clickHook.setEnabled(settings.data.pokeOnClick, { prompt: false });

  updater = new Updater({
    mode: updateMode(process.platform, app.isPackaged),
    onChange: onUpdateChange,
    notify: showNotification,
    openUrl: (url) => shell.openExternal(url),
  });
  updater.setAutoCheck(settings.data.autoUpdate);

  rebuildOverlays();
  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  screen.on('display-metrics-changed', rebuildOverlays);

  if (!registerShortcut(settings.data.shortcut)) {
    console.error(`Could not register shortcut ${settings.data.shortcut}`);
  }

  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  if (process.platform === 'win32') tray.on('click', toggle);
  updateTrayMenu();

  timer = setInterval(tick, TICK_MS);

  // A tray-only app is easy to miss: show settings on the first launch,
  // or right away when the shortcut could not be registered.
  if (settings.isFirstRun || !registered) openSettings();
});

app.on('will-quit', () => {
  clearInterval(timer);
  globalShortcut.unregisterAll();
  if (clickHook) clickHook.dispose();
  if (updater) updater.dispose();
});

// Keep running when the settings window closes (we live in the tray).
app.on('window-all-closed', (e) => e.preventDefault());
