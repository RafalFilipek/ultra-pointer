// Ultra Pointer: transparent, click-through, always-on-top overlay on every
// display. A global shortcut toggles a hand on a stick that points at the cursor.
const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const SHORTCUT = process.env.ULTRA_POINTER_SHORTCUT || 'Alt+Shift+P';
const TICK_MS = 1000 / 60;

let overlays = [];   // { win, display }
let active = process.env.ULTRA_POINTER_AUTOSTART === '1';
let tray = null;
let timer = null;

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
  win.showInactive();
  return { win, display };
}

function rebuildOverlays() {
  overlays.forEach(({ win }) => !win.isDestroyed() && win.destroy());
  overlays = screen.getAllDisplays().map(createOverlay);
}

function tick() {
  const p = screen.getCursorScreenPoint();
  for (const { win, display } of overlays) {
    if (win.isDestroyed()) continue;
    const b = display.bounds;
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    win.webContents.send('state', { x: p.x - b.x, y: p.y - b.y, active: active && inside });
  }
}

function toggle() {
  active = !active;
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: active ? 'Schowaj rękę' : 'Pokaż rękę', accelerator: SHORTCUT, click: toggle },
    { type: 'separator' },
    { label: 'Zakończ', role: 'quit' },
  ]));
  tray.setToolTip(`Ultra Pointer (${SHORTCUT})`);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  rebuildOverlays();
  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  screen.on('display-metrics-changed', rebuildOverlays);

  if (!globalShortcut.register(SHORTCUT, toggle)) {
    console.error(`Nie udało się zarejestrować skrótu ${SHORTCUT} (zajęty?)`);
  }

  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(false);
  tray = new Tray(icon);
  tray.on('click', toggle);
  updateTrayMenu();

  timer = setInterval(tick, TICK_MS);
});

app.on('will-quit', () => {
  clearInterval(timer);
  globalShortcut.unregisterAll();
});

// Keep running with no focused windows (we live in the tray).
app.on('window-all-closed', (e) => e.preventDefault());
