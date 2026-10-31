"""Cut hands out of the sheet with an AI background-removal model (BiRefNet via rembg).

    pip install "rembg[cpu]" scipy pillow numpy
    python3 tools/cut_hands_ai.py [assets/hands-sheet.jpg]

Each hand runs in its own process (BiRefNet is memory hungry), results are cached in
.cut-cache/ so a re-run only redoes what is missing. Writes assets/sprites/*.png,
assets/sprites/hands.json and renderer/sprites.js.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

SHEET = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'assets/hands-sheet.jpg'
MODEL = 'birefnet-general'
CACHE = '.cut-cache'
OUT = 'assets/sprites'
NAMES = ["realistic", "robot", "zombie", "fur", "skeleton", "pixel", "tentacle",
         "cyber", "crimson", "wood", "ice", "lava", "lineart", "goo"]
PAD = 24


def find_boxes(rgb):
    a = rgb.astype(int)
    bg = np.median(np.concatenate([a[:10].reshape(-1, 3), a[-10:].reshape(-1, 3)]), axis=0)
    fg = nd.binary_opening(np.abs(a - bg).max(axis=2) > 22)
    lab, n = nd.label(nd.binary_dilation(fg, iterations=3))
    objs = nd.find_objects(lab)
    areas = nd.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = [objs[i] for i in range(n) if areas[i] > 15000]
    rows = a.shape[0] / 4
    big.sort(key=lambda s: (min(3, int(((s[0].start + s[0].stop) / 2) / rows)), s[1].start))
    boxes = []
    for sl in big:
        boxes.append((max(0, sl[1].start - PAD), max(0, sl[0].start - PAD),
                      min(a.shape[1], sl[1].stop + PAD), min(a.shape[0], sl[0].stop + PAD)))
    return boxes, bg


def run_model(k, box):
    """Child process: cut one crop."""
    from rembg import remove, new_session
    im = Image.open(SHEET).convert('RGB').crop(box)
    remove(im, session=new_session(MODEL), post_process_mask=False).save(f'{CACHE}/{k:02d}.png')


def finish(k, box, bg, rgb):
    cut = np.asarray(Image.open(f'{CACHE}/{k:02d}.png')).astype(float)
    alpha = cut[..., 3] / 255.0
    src = rgb[box[1]:box[3], box[0]:box[2]].astype(float)
    # keep the main object plus anything close to it (drips, splashes); drop bits of neighbours
    solid = alpha > 0.35
    lab, n = nd.label(nd.binary_dilation(solid, iterations=2))
    if n > 1:
        # drop bits of neighbouring hands: pieces that sit only in the padding band of the crop
        sizes = nd.sum(solid, lab, range(1, n + 1))
        main_id = 1 + int(np.argmax(sizes))
        H, W = alpha.shape
        band = PAD + 6
        keep = np.zeros_like(solid)
        for i, sl in enumerate(nd.find_objects(lab)):
            in_band = sl[0].stop <= band or sl[0].start >= H - band or sl[1].stop <= band or sl[1].start >= W - band
            if i + 1 == main_id or not in_band:
                keep |= lab == i + 1
        alpha = alpha * keep
    alpha[alpha < 0.03] = 0
    if NAMES[k] == 'lineart':
        # outline drawing: paint the inside white so it stays visible on dark desktops
        inside = nd.binary_fill_holes(nd.binary_closing(alpha > 0.3, iterations=4))
        alpha = np.maximum(alpha, inside.astype(float))
    # solid interior keeps the original pixels (translucent styles like ice look as on the sheet)
    interior = nd.binary_erosion(alpha > 0.5, iterations=4)
    alpha = np.where(interior, 1.0, alpha)
    # remove the light background colour that bleeds into soft edges
    a3 = np.maximum(alpha, 1e-3)[..., None]
    dec = np.clip((src - (1 - a3) * bg) / a3, 0, 255)
    color = np.where((alpha < 0.98)[..., None] & ~interior[..., None], dec, src)
    ys, xs = np.nonzero(alpha > 0.03)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    alpha, color = alpha[y0:y1, x0:x1], color[y0:y1, x0:x1]
    rgba = np.dstack([color, alpha * 255]).round().astype(np.uint8)
    m = alpha > 0.5
    by = np.nonzero(m.any(axis=1))[0].max()
    bx = np.nonzero(m[by - 5:by + 1].any(axis=0))[0].mean()
    ty = np.nonzero(m.any(axis=1))[0].min()
    tx = np.nonzero(m[ty:ty + 6].any(axis=0))[0].mean()
    name = NAMES[k] if k < len(NAMES) else f'hand{k + 1}'
    fn = f'{k + 1:02d}-{name}.png'
    Image.fromarray(rgba).save(f'{OUT}/{fn}', optimize=True)
    h, w = m.shape
    return dict(file=fn, name=name, w=int(w), h=int(h),
                base=[round(float(bx), 1), int(by)], tip=[round(float(tx), 1), int(ty)])


def main():
    rgb = np.asarray(Image.open(SHEET).convert('RGB'))
    boxes, bg = find_boxes(rgb)
    if '--one' in sys.argv:
        k = int(sys.argv[sys.argv.index('--one') + 1])
        return run_model(k, boxes[k])
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    for k in range(len(boxes)):
        if not os.path.exists(f'{CACHE}/{k:02d}.png'):
            print('cutting', k + 1, '/', len(boxes), flush=True)
            subprocess.run([sys.executable, __file__, SHEET, '--one', str(k)], check=True)
    for f in os.listdir(OUT):
        if f.endswith('.png'):
            os.remove(f'{OUT}/{f}')
    meta = [finish(k, b, bg, rgb) for k, b in enumerate(boxes)]
    json.dump(meta, open(f'{OUT}/hands.json', 'w'), indent=1)
    with open('renderer/sprites.js', 'w') as f:
        f.write('// generated by tools/cut_hands_ai.py\nwindow.HAND_SPRITES = ' + json.dumps(meta) + ';\n')
    print('done:', len(meta), 'hands')


if __name__ == '__main__':
    main()
