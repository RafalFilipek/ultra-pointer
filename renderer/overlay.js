// Overlay window renderer: the window ignores the mouse, so the cursor
// position and the on/off state come from the main process.
const engine = new HandEngine(document.getElementById('c'), { spriteBase: '../assets/sprites/' });
window.ultraPointer.onState(({ x, y, active }) => {
  engine.setCursor(x, y);
  engine.setActive(active);
});
