# Ultra Pointer

A hand on a stick that slides in from the screen edge nearest to your cursor and points at it.
Move the mouse and, when another edge gets clearly closer, the hand ducks away and a different
one pops out from there. 14 hand styles: realistic, robot, zombie, fur, skeleton, pixel art,
tentacle, cyber, crimson, wood, ice, lava, line art and goo.

Runs on **macOS** and **Windows**. The overlay is transparent, always on top and click-through,
with one overlay per display. The app lives in the menu bar / system tray.

## Install

Download the latest installer from [Releases](https://github.com/RafalFilipek/ultra-pointer/releases):

- **macOS**: `Ultra-Pointer-<version>-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel).
  The app is not notarized yet, so the first time right-click the app → **Open**, or run
  `xattr -cr "/Applications/Ultra Pointer.app"`.
- **Windows**: `Ultra-Pointer-<version>-windows-x64-setup.exe`. SmartScreen may warn about an
  unknown publisher: **More info → Run anyway**.

## Use

Press **Alt+Shift+P** (⌥⇧P on a Mac) to show or hide the hand. Open **Settings…** from the tray
icon to change:

- the shortcut (click **Change…** and press the new combination),
- which hands are in the random mix,
- hand size, animation speed and how eagerly the hand switches edges (with a live preview),
- keep the same hand when switching edges, idle wobble, drop shadow,
- auto-hide when the mouse stops for a while, and open at login.

Settings are saved to `settings.json` in the app's user-data folder.

## Develop

```bash
npm install
npm start          # run the app
npm test           # unit tests + syntax check
npm run dist       # build installers locally into dist/
```

`demo/index.html` is a browser-only demo of the hand engine (serve the repo root and open it).

### Project layout

- `main.js`: overlay windows, global shortcut, tray, settings window, cursor polling (60 fps).
- `settings.js`: settings defaults, validation and storage.
- `renderer/hand-engine.js`: the hand itself (edge choice, slide in/out, aiming, style swaps).
- `renderer/settings.html`, `settings-ui.js`, `settings.css`: the settings window.
- `assets/sprites/`: hand sprites plus `hands.json` with each sprite's stick end and fingertip.
- `tools/cut_hands_ai.py`: cuts the hands out of `assets/hands-sheet.jpg` with BiRefNet (rembg)
  and regenerates `hands.json` and `renderer/sprites.js`. Usage is at the top of the file.

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a version tag is pushed:

```bash
npm version minor            # bumps package.json and creates the tag, e.g. v0.3.0
git push --follow-tags
```

Or, without a local checkout: **Actions → Release → Run workflow**, tick **publish**. That releases
the version currently in `package.json` (bump it first) and tags the commit.

The workflow creates a draft release, builds the macOS (arm64 + x64) and Windows (x64 + arm64)
installers into it, then publishes it. Pull requests run the same build without publishing.
