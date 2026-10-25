#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/make-portrait-thumbs.py — 为同学录列表页生成立绘缩略图（Pillow）

背景：列表页 .char-photo 是 48×56 的固定小方块，img 走
  object-fit: cover; object-position: 50% 28%
而 PRECACHE 里躺着的却是 17 张 1024×960 母版（合计约 2276KB，占预缓存 71%），
首访为一个 48px 的格子付出 2.2MB。本工具按**浏览器渲染时的实际裁切**产出缩略图，
把列表页的图片负担压到十分之一量级（母版 81~199KB → 缩略图目标 ≤12KB）。

裁切语义（与 CSS 逐像素对齐，不是随手居中裁）：
  object-fit: cover    → scale = max(盒宽/图宽, 盒高/图高)，等比放大到完全盖住盒子；
  object-position 50% 28% → 溢出的部分按「图上 p% 的点对齐盒上 p% 的点」收，
                          即裁切起点 = 溢出量 × p%（50% = 水平居中；28% = 垂直 28% 处）。
  对 1024×960 的母版：scale=56/960，水平溢出 11.73px、垂直溢出 0 —— 所以 28%
  这一项当前是恒等式（没有垂直溢出可裁），实现仍按通用公式写，换任何比例的
  母版都不会漂。

产物：assets/portrait-<slug>-thumb.webp（128×150，正好是 48×56 的 2 倍，
      DPR=2 的手机上也清晰；webp quality≈78, method=6）。

幂等：已存在且不比母版旧（mtime 比较）就跳过；--force 强制全量重画。
      母版更新后重跑一次即可，不用先删旧缩略图。

用法：
  python3 tools/make-portrait-thumbs.py          # 只画缺的/过期的
  python  tools/make-portrait-thumbs.py --force  # 全量重画
本机（Windows）Pillow 装在站点仓库外：
  PYTHONPATH=E:/novel-site/_perf/pylibs python tools/make-portrait-thumbs.py
退出码：0 成功；2 缺 Pillow（带安装提示）；1 其它错误。
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # Pillow 没装/没在 PYTHONPATH 里：说清楚怎么办，别静默失败
    sys.stderr.write(
        '✗ 导入 Pillow 失败。请先安装：\n'
        '    pip install Pillow\n'
        '  或使用本机已有的副本：\n'
        '    PYTHONPATH=E:/novel-site/_perf/pylibs python tools/make-portrait-thumbs.py\n'
    )
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'

# ---- 与 css/style.css 的 .char-photo 保持一致（改展示尺寸时这里要跟着改）----
BOX_W, BOX_H = 48, 56        # 列表页卡片上的固定展示盒（CSS px）
POS_X, POS_Y = 0.50, 0.28    # object-position: 50% 28%
# ---- 缩略图规格 ----
THUMB_W, THUMB_H = 128, 150  # 2× DPR 锐利；比例 48:56，与展示盒一致
QUALITY, METHOD = 78, 6      # webp quality≈78、method=6（压缩最慢，同质量最小）
MAX_KB = 12                  # 单张目标上限（母版 81~199KB）


def cover_crop_box(img_w, img_h, box_w, box_h, pos_x, pos_y):
    """按 object-fit: cover + object-position 的语义算裁切框（源图像素坐标）。

    CSS 规范语义：cover 先等比缩放至「完全盖住盒子」（scale 取两轴最大值），
    多出来的部分按 object-position 收拢 —— 图上 pos% 的点对齐盒上 pos% 的点，
    等价于裁切起点 = 该轴溢出量 × pos%。

    Returns:
        (left, top, right, bottom)：int 元组。四条边各自四舍五入，但右下边由
        「左上边 + 宽高」算出，保证裁出来仍是目标比例（不会某一轴多漂 1px）。
    """
    scale = max(box_w / img_w, box_h / img_h)
    overflow_x = img_w * scale - box_w   # ≥0：盖住盒子后水平多出的像素
    overflow_y = img_h * scale - box_h   # ≥0：垂直多出的像素（当前母版下恒为 0）
    left = overflow_x * pos_x / scale
    top = overflow_y * pos_y / scale
    width = box_w / scale
    height = box_h / scale
    # 右下角从左上角推算，保持四边自洽；之后再交给 resize 归一到精确 128×150
    return (
        int(round(left)),
        int(round(top)),
        int(round(left)) + int(round(width)),
        int(round(top)) + int(round(height)),
    )


def make_thumb(master_path, thumb_path, force=False):
    """生成单张缩略图。返回 (动作, 字节数)：动作 ∈ {'生成', '跳过'}。"""
    if thumb_path.exists() and not force:
        # 幂等：缩略图不比母版旧就复用（母版换了画，重跑一次自会刷新）
        if thumb_path.stat().st_mtime >= master_path.stat().st_mtime:
            return '跳过', thumb_path.stat().st_size
    with Image.open(master_path) as im:
        im = im.convert('RGB')  # 立绘是不透明照片；统一掉 alpha 避免 webp 带透明通道
        box = cover_crop_box(im.width, im.height, BOX_W, BOX_H, POS_X, POS_Y)
        cropped = im.crop(box)
    thumb = cropped.resize((THUMB_W, THUMB_H), Image.LANCZOS)
    thumb.save(thumb_path, 'WEBP', quality=QUALITY, method=METHOD)
    return '生成', thumb_path.stat().st_size


def main():
    parser = argparse.ArgumentParser(description='生成立绘缩略图（128×150 webp）')
    parser.add_argument('--force', action='store_true', help='忽略 mtime，全量重画')
    args = parser.parse_args()

    if not ASSETS.is_dir():
        sys.stderr.write('✗ 找不到 assets/ 目录：%s\n' % ASSETS)
        sys.exit(1)

    masters = sorted(ASSETS.glob('portrait-*-1024.webp'))
    if not masters:
        sys.stderr.write('✗ assets/ 下没有 portrait-*-1024.webp 母版\n')
        sys.exit(1)

    made = skipped = 0
    master_total = thumb_total = 0
    over = []
    print('裁切规则：cover(%dx%d) + object-position(%d%% %d%%) → %dx%d webp q%d m%d%s'
          % (BOX_W, BOX_H, POS_X * 100, POS_Y * 100, THUMB_W, THUMB_H,
             QUALITY, METHOD, '，--force 全量重画' if args.force else ''))
    for master in masters:
        thumb = master.with_name(master.name.replace('-1024.webp', '-thumb.webp'))
        action, size = make_thumb(master, thumb, force=args.force)
        if action == '生成':
            made += 1
        else:
            skipped += 1
        master_total += master.stat().st_size
        thumb_total += size
        flag = ''
        if size > MAX_KB * 1024:
            over.append('%s=%.1fKB' % (thumb.name, size / 1024))
            flag = '  ⚠ 超过 %dKB 目标' % MAX_KB
        print('  %-34s 母版 %6.1fKB → %5.1fKB  (%s)%s'
              % (thumb.name, master.stat().st_size / 1024, size / 1024, action, flag))

    print('\n共 %d 张：生成 %d、跳过 %d' % (len(masters), made, skipped))
    print('母版合计 %.1fKB → 缩略图合计 %.1fKB（列表页预缓存省 %.1fKB，%.0f%%）'
          % (master_total / 1024, thumb_total / 1024,
             (master_total - thumb_total) / 1024,
             (1 - thumb_total / master_total) * 100))
    if over:
        sys.stderr.write('⚠ 有 %d 张超过 %dKB 目标：%s\n' % (len(over), MAX_KB, '、'.join(over)))


if __name__ == '__main__':
    main()
