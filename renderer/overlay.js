// Overlay window renderer: the window ignores the mouse, so the cursor
// position, the on/off state and the settings all come from the main process.
const engine = new HandEngine(document.getElementById('c'), { spriteBase: '../assets/sprites/' });

window.ultraPointer.onState(({ x, y, active }) => {
  engine.setCursor(x, y);
  engine.setActive(active);
});

window.ultraPointer.onSettings((s) => {
  engine.setOptions({
    handHeight: s.handSize,
    speed: s.speed,
    switchMargin: s.switchMargin,
    keepStyle: s.keepStyle,
    wobble: s.wobble ? 0.035 : 0,
    shadow: s.shadow,
    enabled: s.hands,
  });
});
