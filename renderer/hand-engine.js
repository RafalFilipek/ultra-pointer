/*
 * HandEngine: draws a "hand on a stick" that slides in from the screen edge
 * nearest to the cursor and points its finger at it. When another edge gets
 * clearly closer, the hand retracts and a different, random hand pops out
 * from the new edge.
 *
 * Usage:
 *   const engine = new HandEngine(canvas, { spriteBase: '../assets/sprites/' });
 *   engine.setCursor(x, y);      // CSS pixels, relative to the canvas
 *   engine.setActive(true|false) // show / hide (hide = retract)
 *   engine.poke()                // jab at the cursor (e.g. on a mouse click)
 */
(function () {
  const EDGES = ['top', 'right', 'bottom', 'left'];

  const DEFAULTS = {
    spriteBase: 'assets/sprites/',
    sprites: window.HAND_SPRITES || [],
    handHeight: 210,      // on-screen height of the hand sprite (px)
    gap: 6,               // how far the fingertip stops from the cursor (px)
    switchMargin: 90,     // another edge must be this much closer to trigger a swap (px)
    enterTime: 0.45,      // seconds to slide in
    leaveTime: 0.22,      // seconds to retract
    followRate: 5,        // how quickly the stick base slides along the edge (1/s)
    aimRate: 14,          // how quickly the hand turns to the cursor (1/s)
    wobble: 0.035,        // idle wobble in radians
    maxReach: 0.92,       // max reach as a fraction of the screen's shorter side
    speed: 1,             // animation speed multiplier
    shadow: true,         // drop shadow under the hand and stick
    enabled: null,        // sprite file names to pick from (null = all)
    keepStyle: false,     // true = keep the same hand when switching edges
    pokeDepth: 28,        // how far past the cursor the finger jabs on poke() (px at 210 px hand height)
    pokeTime: 0.32,       // seconds for a whole poke (jab + return)
    pokeRing: true,       // flash a small ring where the finger lands
  };

  const POKE_HIT = 0.3;   // fraction of the poke spent on the jab; the rest is the return

  // Poke offset as a fraction of pokeDepth: fast jab out, softer return. 0 at t=0 and t=1.
  function pokeCurve(t) {
    if (t <= 0 || t >= 1) return 0;
    if (t < POKE_HIT) { const k = t / POKE_HIT; return 1 - Math.pow(1 - k, 3); }
    const k = (t - POKE_HIT) / (1 - POKE_HIT);
    return 1 - (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  }

  function easeOutBack(t) {
    const c1 = 1.5, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function easeInCubic(t) { return t * t * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function angleLerp(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * k;
  }

  class HandEngine {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.o = Object.assign({}, DEFAULTS, opts);
      this.images = this.o.sprites.map((s) => {
        const img = new Image();
        img.src = this.o.spriteBase + s.file;
        return img;
      });
      this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
      this.active = false;
      this.phase = 'hidden';   // hidden | entering | tracking | leaving
      this.t = 0;              // progress of the current enter/leave animation
      this.ext = 0;            // how far out the hand is (0 = hidden, 1 = fully out)
      this.edge = null;
      this.style = -1;
      this.along = 0;          // stick base position along the edge
      this.angle = 0;
      this.time = 0;
      this.onStyleChange = null;
      this.pokeT = null;       // progress of the current poke (null = not poking)
      this.rings = [];         // { x, y, age } flashes where pokes landed
      this._resize();
      addEventListener('resize', () => this._resize());
      this._last = performance.now();
      requestAnimationFrame((ts) => this._frame(ts));
    }

    setCursor(x, y) { this.cursor.x = x; this.cursor.y = y; }
    setActive(on) { this.active = !!on; }
    setOptions(opts) {
      Object.assign(this.o, opts);
      // a disabled hand that is currently out gets swapped at the next edge change
    }
    toggle() { this.active = !this.active; return this.active; }
    // Jab at the cursor. Ignored unless the hand is out; a new poke restarts a running one.
    poke() {
      if (!this.active || !(this.phase === 'tracking' || (this.phase === 'entering' && this.t > 0.6))) return false;
      this.pokeT = 0;
      this._ringPending = true;
      return true;
    }

    _resize() {
      const dpr = window.devicePixelRatio || 1;
      this.w = this.canvas.clientWidth || innerWidth;
      this.h = this.canvas.clientHeight || innerHeight;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    _edgeDist(edge) {
      const { x, y } = this.cursor;
      switch (edge) {
        case 'top': return y;
        case 'bottom': return this.h - y;
        case 'left': return x;
        case 'right': return this.w - x;
      }
    }
    _nearestEdge() {
      let best = EDGES[0], bd = Infinity;
      for (const e of EDGES) {
        const d = this._edgeDist(e);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }
    _alongTarget(edge) {
      return edge === 'top' || edge === 'bottom' ? this.cursor.x : this.cursor.y;
    }
    _anchor() {
      const off = 4; // just outside the screen, so the stick end is never visible
      switch (this.edge) {
        case 'top': return { x: this.along, y: -off };
        case 'bottom': return { x: this.along, y: this.h + off };
        case 'left': return { x: -off, y: this.along };
        case 'right': return { x: this.w + off, y: this.along };
      }
    }
    _inward() {
      switch (this.edge) {
        case 'top': return Math.PI / 2;
        case 'bottom': return -Math.PI / 2;
        case 'left': return 0;
        case 'right': return Math.PI;
      }
    }
    _pool() {
      const all = this.o.sprites.map((_, i) => i);
      if (!this.o.enabled) return all;
      const on = new Set(this.o.enabled);
      const pool = all.filter((i) => on.has(this.o.sprites[i].file));
      return pool.length ? pool : all;
    }
    _pickStyle() {
      const pool = this._pool();
      if (this.o.keepStyle && pool.includes(this.style)) return this.style;
      if (pool.length < 2) return pool[0];
      const others = pool.filter((i) => i !== this.style);
      return others[Math.floor(Math.random() * others.length)];
    }
    _spawn(edge) {
      this.edge = edge;
      this.style = this._pickStyle();
      this.along = this._alongTarget(edge);
      this.angle = this._aimAngle();
      this.phase = 'entering';
      this.t = 0;
      if (this.onStyleChange) this.onStyleChange(this.o.sprites[this.style]);
    }
    _aimAngle() {
      const a = this._anchor();
      return Math.atan2(this.cursor.y - a.y, this.cursor.x - a.x);
    }

    _update(dt) {
      this.time += dt;
      for (const r of this.rings) r.age += dt * this.o.speed;
      this.rings = this.rings.filter((r) => r.age < 0.45);
      if (this.pokeT !== null) {
        this.pokeT += dt * this.o.speed / this.o.pokeTime;
        if (this._ringPending && this.pokeT >= POKE_HIT) {
          this._ringPending = false;
          if (this.o.pokeRing) this.rings.push({ x: this.cursor.x, y: this.cursor.y, age: 0 });
        }
        if (this.pokeT >= 1 || this.phase === 'leaving' || this.phase === 'hidden') { this.pokeT = null; this._ringPending = false; }
      }
      const target = this._nearestEdge();

      if (this.phase === 'hidden') {
        if (this.active) this._spawn(target);
        else return;
      }

      if (!this.active && this.phase !== 'leaving') {
        this.phase = 'leaving'; this.t = 0; this._leaveFrom = this.ext; this._next = null;
      } else if (this.active && (this.phase === 'tracking' || this.phase === 'entering') && target !== this.edge &&
                 this._edgeDist(target) + this.o.switchMargin < this._edgeDist(this.edge)) {
        this.phase = 'leaving'; this.t = 0; this._leaveFrom = this.ext; this._next = target;
      }

      if (this.phase === 'entering') {
        this.t = Math.min(1, this.t + dt * this.o.speed / this.o.enterTime);
        this.ext = easeOutBack(this.t);
        if (this.t >= 1) { this.phase = 'tracking'; this.ext = 1; }
      } else if (this.phase === 'leaving') {
        this.t = Math.min(1, this.t + dt * this.o.speed / this.o.leaveTime);
        this.ext = this._leaveFrom * (1 - easeInCubic(this.t));
        if (this.t >= 1) {
          this.ext = 0;
          if (this.active) this._spawn(this._next || target);
          else { this.phase = 'hidden'; this.edge = null; }
        }
      }

      if (!this.edge) return;
      // Base slides along the edge after the cursor (with lag, so the hand tilts nicely).
      const span = this.edge === 'top' || this.edge === 'bottom' ? this.w : this.h;
      const kf = 1 - Math.exp(-dt * this.o.followRate);
      this.along += (clamp(this._alongTarget(this.edge), 0, span) - this.along) * kf;
      // Aim, but never point backwards out of the screen.
      let aim = this._aimAngle();
      const inward = this._inward();
      let rel = angleLerp(0, aim - inward, 1);
      rel = clamp(rel, -1.35, 1.35);
      aim = inward + rel;
      const ka = 1 - Math.exp(-dt * this.o.aimRate);
      this.angle = angleLerp(this.angle, aim, ka);
    }

    _draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      this._drawRings();
      if (!this.edge || this.ext <= 0.001) return;
      const spr = this.o.sprites[this.style];
      const img = this.images[this.style];
      if (!img.complete || !img.naturalWidth) return;

      const scale = this.o.handHeight / spr.h;
      const bx = spr.base[0], by = spr.base[1], tx = spr.tip[0], ty = spr.tip[1];
      const handLen = Math.hypot(tx - bx, ty - by) * scale;   // stick end -> fingertip
      const spriteAngle = Math.atan2(ty - by, tx - bx);       // ≈ -90° (pointing up)

      const a = this._anchor();
      const ang = this.angle + Math.sin(this.time * 2.3) * this.o.wobble * (this.phase === 'tracking' ? 1 : 0.3);
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const maxReach = Math.min(this.w, this.h) * this.o.maxReach;
      const poke = this.pokeT === null ? 0 : pokeCurve(this.pokeT) * (this.o.gap + this.o.pokeDepth * this.o.handHeight / 210);
      const want = clamp(Math.hypot(this.cursor.x - a.x, this.cursor.y - a.y) - this.o.gap, handLen * 0.55, maxReach) + poke;

      // Fingertip distance from the anchor along the stick; at ext=0 the whole hand is off-screen.
      const tipDist = -8 + (want + 8) * this.ext;
      const baseDist = tipDist - handLen;
      const base = { x: a.x + dir.x * baseDist, y: a.y + dir.y * baseDist };

      // Telescoping stick: from well off-screen to the sprite's own short stick.
      const stickW = 13 * (this.o.handHeight / 210);
      const sx = a.x - dir.x * 60, sy = a.y - dir.y * 60;
      const tuck = 40 * scale; // run the stick under the sprite's own stick so there is no seam
      const ex = base.x + dir.x * tuck, ey = base.y + dir.y * tuck;
      if ((ex - sx) * dir.x + (ey - sy) * dir.y > 0) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(ang);
        const len = Math.hypot(ex - sx, ey - sy);
        const g = ctx.createLinearGradient(0, -stickW / 2, 0, stickW / 2);
        g.addColorStop(0, '#e2bd92');
        g.addColorStop(0.45, '#c99a68');
        g.addColorStop(1, '#93673f');
        ctx.fillStyle = g;
        ctx.shadowColor = this.o.shadow ? 'rgba(0,0,0,0.25)' : 'transparent';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillRect(0, -stickW / 2, len, stickW);
        ctx.restore();
      }

      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.rotate(ang - spriteAngle);
      ctx.shadowColor = this.o.shadow ? 'rgba(0,0,0,0.28)' : 'transparent';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.drawImage(img, -bx * scale, -by * scale, spr.w * scale, spr.h * scale);
      ctx.restore();
    }

    _drawRings() {
      if (!this.rings.length) return;
      const ctx = this.ctx;
      const size = this.o.handHeight / 210;
      ctx.save();
      for (const r of this.rings) {
        const k = r.age / 0.45;
        const radius = (6 + 22 * (1 - Math.pow(1 - k, 2))) * size;
        const alpha = 1 - k;
        ctx.lineWidth = 3 * size;
        ctx.strokeStyle = `rgba(0,0,0,${0.35 * alpha})`;
        ctx.beginPath(); ctx.arc(r.x, r.y, radius + 1.5 * size, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 2 * size;
        ctx.strokeStyle = `rgba(255,255,255,${0.95 * alpha})`;
        ctx.beginPath(); ctx.arc(r.x, r.y, radius, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    _frame(ts) {
      const dt = Math.min(0.05, (ts - this._last) / 1000);
      this._last = ts;
      this._update(dt);
      this._draw();
      requestAnimationFrame((t) => this._frame(t));
    }
  }

  HandEngine.pokeCurve = pokeCurve;
  window.HandEngine = HandEngine;
})();
