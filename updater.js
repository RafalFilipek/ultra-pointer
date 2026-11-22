// Update checks against GitHub Releases, built on electron-updater.
//
// mode 'install' (Windows): new versions download in the background and install
//   when the app quits, or straight away via restart().
// mode 'notify' (macOS): the app is only ad-hoc signed and Squirrel.Mac refuses
//   updates that aren't signed with a Developer ID, so we only check, tell the
//   user, and open the release page for a manual download.
// mode 'off': development builds, other platforms, and whenever UPDATES_ENABLED is false.
//
// status: 'off' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15 * 1000;
const RELEASES_URL = 'https://github.com/RafalFilipek/ultra-pointer/releases';

// Master switch for update checks. They read the public GitHub releases feed, so
// they only work while the repository's releases are publicly reachable.
const UPDATES_ENABLED = true;

function updateMode(platform, isPackaged, enabled = UPDATES_ENABLED) {
  if (!enabled || !isPackaged) return 'off';
  if (platform === 'win32') return 'install';
  if (platform === 'darwin') return 'notify';
  return 'off';
}

class Updater {
  constructor({
    mode,
    loadUpdater = () => require('electron-updater').autoUpdater,
    onChange = () => {},
    notify = () => {},                 // (title, body, onClick) => void
    openUrl = () => {},
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    releasesUrl = RELEASES_URL,
  }) {
    Object.assign(this, { mode, onChange, notify, openUrl, timers, releasesUrl });
    this.status = mode === 'off' ? 'off' : 'idle';
    this.version = null;   // the newer version, once one is found
    this.percent = 0;
    this.error = null;
    this.notified = null;  // version we already showed a notification for
    this.first = null;
    this.interval = null;
    this.au = null;
    if (mode !== 'off') this._init(loadUpdater());
  }

  _init(au) {
    this.au = au;
    au.autoDownload = this.mode === 'install';
    au.autoInstallOnAppQuit = this.mode === 'install';
    au.allowPrerelease = false;
    au.logger = null;
    au.on('checking-for-update', () => this._set('checking'));
    au.on('update-not-available', () => this._set('up-to-date'));
    au.on('update-available', (info) => {
      this.version = info.version;
      if (this.mode === 'install') { this.percent = 0; this._set('downloading'); return; }
      this._set('available');
      this._notifyOnce(`Ultra Pointer ${info.version} is available`, 'Click to open the download page.', () => this.primaryAction());
    });
    au.on('download-progress', (p) => { this.percent = Math.round(p.percent || 0); this._set('downloading'); });
    au.on('update-downloaded', (info) => {
      this.version = info.version;
      this._set('ready');
      this._notifyOnce(`Ultra Pointer ${info.version} is ready`, 'It installs when you quit. Click to restart now.', () => this.restart());
    });
    // A failed background check is not worth bothering anyone; the settings window still shows it.
    au.on('error', (err) => this._fail(err));
  }

  _fail(err) {
    if (this.status === 'error') return; // electron-updater reports the same failure twice
    this.error = (err && err.message ? err.message : String(err)).split('\n')[0];
    this._set('error');
  }

  info() {
    return { mode: this.mode, status: this.status, version: this.version, percent: this.percent, error: this.error };
  }

  _set(status) {
    if (status !== 'error') this.error = null;  // _fail sets the message before calling this
    this.status = status;
    this.onChange(this.info());
  }

  _notifyOnce(title, body, onClick) {
    if (this.notified === this.version) return;
    this.notified = this.version;
    this.notify(title, body, onClick);
  }

  // Periodic background checks (the "check automatically" setting).
  setAutoCheck(on) {
    this.timers.clearTimeout(this.first);
    this.timers.clearInterval(this.interval);
    this.first = this.interval = null;
    if (!on || this.mode === 'off') return;
    this.first = this.timers.setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS);
    this.interval = this.timers.setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  check() {
    if (this.mode === 'off') return false;
    // Nothing to gain from checking again while an update is on its way or waiting.
    if (['checking', 'downloading', 'ready'].includes(this.status)) return false;
    Promise.resolve()
      .then(() => this.au.checkForUpdates())
      .catch((err) => this._fail(err));
    return true;
  }

  releaseUrl() {
    return this.version ? `${this.releasesUrl}/tag/v${this.version}` : `${this.releasesUrl}/latest`;
  }

  restart() {
    if (this.status !== 'ready') return false;
    // isSilent: the NSIS installer is one-click anyway; isForceRunAfter: start the new version.
    this.au.quitAndInstall(true, true);
    return true;
  }

  // What the tray / settings button does in the current state.
  primaryAction() {
    if (this.status === 'ready') return this.restart();
    if (this.status === 'available') { this.openUrl(this.releaseUrl()); return true; }
    return this.check();
  }

  dispose() { this.setAutoCheck(false); }
}

module.exports = { Updater, updateMode, UPDATES_ENABLED, CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS };
