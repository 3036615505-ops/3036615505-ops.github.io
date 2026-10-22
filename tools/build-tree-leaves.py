# 梧桐叶精灵提取（构建脚本，可重复运行）
# 依赖: pip install pillow numpy scipy scikit-image
# 输入: assets/tree-lush.jpg（茂盛原图，与 tree-bare.jpg 同构图）
# 输出: assets/tree/atlas.png + assets/tree/leaves.json
# 原理: 分水岭分割叶片簇 -> 只保留树冠内叶簇 -> 按 y 自下而上排序（生长顺序）-> 打包图集
from PIL import Image
import numpy as np
from scipy import ndimage
from skimage.segmentation import watershed
from skimage.feature import peak_local_max
import os, json

A = 'E:/novel-site/3036615505-ops.github.io/assets'
OUT = os.path.join(A, 'tree')
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))

CANOPY_MAX_Y = 0.72   # 只保留树冠内叶簇（排除树干旁的地面落叶）
MIN_AREA = 35
MIN_DIST = 10
ATLAS_W = 512

lush = Image.open(os.path.join(A, 'tree-lush.jpg')).convert('RGB')
bare = Image.open(os.path.join(A, 'tree-bare.jpg')).convert('RGB')
rgb = np.asarray(lush).astype(float)
H, W = rgb.shape[:2]
bg = np.array([241.0, 221.0, 192.0])

dist_bg = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
not_bg = dist_bg > 20
hsv = np.asarray(lush.convert('HSV')).astype(float)
hue = hsv[:, :, 0] / 255.0 * 360.0
sat = hsv[:, :, 1] / 255.0
val = hsv[:, :, 2] / 255.0
green = (hue >= 55) & (hue <= 175) & (sat > 0.20)
gold = (hue >= 22) & (hue < 55) & (sat > 0.38) & (val > 0.35)
leaf_mask = not_bg & (green | gold)

distance = ndimage.distance_transform_edt(leaf_mask)
coords = peak_local_max(distance, min_distance=MIN_DIST, labels=leaf_mask)
markers = np.zeros(distance.shape, dtype=int)
for i, (r, c) in enumerate(coords, 1):
    markers[r, c] = i
markers = ndimage.label(markers > 0)[0]
labels = watershed(-distance, markers, mask=leaf_mask)

n = int(labels.max())
sizes = ndimage.sum(leaf_mask, labels, range(1, n + 1))
sprites = []
for i in range(1, n + 1):
    if sizes[i - 1] < MIN_AREA:
        continue
    ys, xs = np.where(labels == i)
    cy = (ys.min() + ys.max()) / 2
    if cy > CANOPY_MAX_Y * H:
        continue
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    pad = 3
    y0, y1 = max(0, y0 - pad), min(H - 1, y1 + pad)
    x0, x1 = max(0, x0 - pad), min(W - 1, x1 + pad)
    sprites.append({'x': int(x0), 'y': int(y0), 'w': int(x1 - x0 + 1), 'h': int(y1 - y0 + 1)})

sprites.sort(key=lambda s: -s['y'])
print('canopy leaf clusters:', len(sprites))

# ---- 图集打包（行排列） ----
ax, ay, row_h = 0, 0, 0
for s in sprites:
    if ax + s['w'] > ATLAS_W:
        ax = 0
        ay += row_h
        row_h = 0
    s['ax'], s['ay'] = ax, ay
    ax += s['w']
    row_h = max(row_h, s['h'])
atlas_h = ay + row_h

atlas = Image.new('RGBA', (ATLAS_W, atlas_h), (0, 0, 0, 0))
for s in sprites:
    y0, x0 = s['y'], s['x']
    region = (labels[y0:y0 + s['h'], x0:x0 + s['w']] > 0) & leaf_mask[y0:y0 + s['h'], x0:x0 + s['w']]
    alpha = ndimage.gaussian_filter(region.astype(float), sigma=1.0)
    rgba = np.dstack([rgb[y0:y0 + s['h'], x0:x0 + s['w']], alpha * 255]).astype(np.uint8)
    sprite = Image.fromarray(rgba, 'RGBA')
    atlas.paste(sprite, (s['ax'], s['ay']), sprite)
atlas.save(os.path.join(OUT, 'atlas.png'), optimize=True)

with open(os.path.join(OUT, 'leaves.json'), 'w') as f:
    json.dump({'width': W, 'height': H, 'count': len(sprites),
               'atlas': {'width': ATLAS_W, 'height': atlas_h}, 'leaves': sprites}, f)

# ---- 阶段预览 QA ----
def composite(pct):
    n_show = round(pct / 100 * len(sprites))
    canvas = np.asarray(bare).convert('RGB') if hasattr(np.asarray(bare), 'convert') else np.asarray(bare).astype(float)
    canvas = np.asarray(bare).astype(float)
    for idx in range(n_show):
        s = sprites[idx]
        y0, x0 = s['y'], s['x']
        region = (labels[y0:y0 + s['h'], x0:x0 + s['w']] > 0) & leaf_mask[y0:y0 + s['h'], x0:x0 + s['w']]
        alpha = ndimage.gaussian_filter(region.astype(float), sigma=1.0)[:, :, None]
        region_px = canvas[y0:y0 + s['h'], x0:x0 + s['w']]
        region_px[:] = region_px * (1 - alpha) + rgb[y0:y0 + s['h'], x0:x0 + s['w']] * alpha
    return Image.fromarray(canvas.astype(np.uint8)), n_show

for pct in [1, 15, 40, 70, 100]:
    img, n_show = composite(pct)
    img.save(os.path.join(A, f'_stage_{pct}.jpg'), quality=88)
    print(f'progress {pct}% -> {n_show}/{len(sprites)} leaves')

print('atlas:', ATLAS_W, 'x', atlas_h, '| atlas size:', os.path.getsize(os.path.join(OUT, 'atlas.png')) // 1024, 'KB')
