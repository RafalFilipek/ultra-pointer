// Global mouse-click listener for "poke on click". Electron can't see clicks
// outside its own windows, so this uses uiohook-napi (a native input hook).
// On macOS the hook needs Accessibility access; until the user grants it the
// status is 'needs-permission' and we check again every couple of seconds.
//
// status: 'off' | 'running' | 'needs-permission' | 'unavailable'

const PERMISSION_POLL_MS = 2000;

class ClickHook {
  constructor({
    onClick,
    onStatus = () => {},
    platform = process.platform,
    isTrusted = () => true,            // (prompt: boolean) => boolean, macOS Accessibility check
    loadHook = () => require('uiohook-napi').uIOhook,
    timers = { setInterval, clearInterval },
  }) {
    Object.assign(this, { onClick, onStatus, platform, isTrusted, loadHook, timers });
    this.status = 'off';
    this.error = null;
    this.hook = null;
    this.poll = null;
    this._listener = (e) => this.onClick(e);
  }

  // prompt: on macOS, let the system ask for Accessibility access if it is missing.
  setEnabled(on, { prompt = true } = {}) {
    if (on) this._start(prompt);
    else this._stop('off');
  }

  info() { return { status: this.status, error: this.error }; }

  _set(status, error = null) {
    if (status === this.status && error === this.error) return;
    this.status = status;
    this.error = error;
    this.onStatus(this.info());
  }

  _start(prompt) {
    if (this.status === 'running') return;
    if (this.platform === 'darwin' && !this.isTrusted(prompt)) {
      if (!this.poll) this.poll = this.timers.setInterval(() => this._start(false), PERMISSION_POLL_MS);
      this._set('needs-permission');
      return;
    }
    this._clearPoll();
    try {
      if (!this.hook) {
        this.hook = this.loadHook();
        this.hook.on('mousedown', this._listener);
      }
      this.hook.start();
      this._set('running');
    } catch (err) {
      this._set('unavailable', String((err && err.message) || err));
    }
  }

  _stop(status) {
    this._clearPoll();
    if (this.status === 'running' && this.hook) {
      try { this.hook.stop(); } catch { /* already stopped */ }
    }
    this._set(status);
  }

  _clearPoll() {
    if (this.poll) { this.timers.clearInterval(this.poll); this.poll = null; }
  }

  dispose() { this._stop('off'); }
}

module.exports = { ClickHook, PERMISSION_POLL_MS };
