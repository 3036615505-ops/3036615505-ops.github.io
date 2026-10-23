#!/usr/bin/env python3
"""生成阅读页「楷体」用的字体子集。

为什么需要这一步：安卓基本不带中文楷体，所以要自带字体。整份霞鹜文楷有 7MB，
直接上线太重；这里只保留「章节实际用字 + GB2312 一级常用字 + ASCII + 中文标点」，
体积约 850KB，常见新章节不会缺字。

用法（改了章节后重跑一次即可）：
    python tools/make-kai-subset.py            # 生成并报告覆盖率
    python tools/make-kai-subset.py --check    # 只检查现有字体是否覆盖全部正文用字

字体来源：LXGW WenKai（霞鹜文楷）Regular，OFL 1.1，允许子集化后作为 Web 字体分发。
授权原文见 assets/fonts/OFL-lxgw-wenkai.txt。
"""
import argparse
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts" / "linyuan-kai-subset.woff2"
SRC_CANDIDATES = [
    ROOT.parent / "_perf" / "fontsrc" / "package" / "files" / "lxgw-wenkai-latin-500-normal.woff2",
    ROOT.parent / "_perf" / "fontsrc" / "LXGWWenKaiLite-Regular.ttf",
]
PUNCT = "，。！？：；、“”‘’（）《》【】…—·～「」『』〈〉"


def chapter_chars() -> set:
    chars = set()
    for f in sorted(ROOT.glob("novel/chapter-*.html")):
        s = f.read_text(encoding="utf-8")
        m = re.search(r"<article[^>]*chapter-content[^>]*>(.*?)</article>", s, re.S)
        if m:
            chars |= set(re.sub(r"<[^>]+>", "", m.group(1)))
    # 换行/制表等控制字符不需要字形（HTML 会折叠成空格），排除掉免得误报缺字
    return {c for c in chars if not c.isspace()}


def gb2312_level1() -> set:
    out = set()
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return out


def full_charset() -> set:
    return chapter_chars() | {chr(c) for c in range(0x20, 0x7F)} | set(PUNCT) | gb2312_level1()


def check() -> int:
    if not OUT.exists():
        print(f"✗ 字体不存在：{OUT}")
        return 1
    font = TTFont(OUT, lazy=True)
    cmap = set(font.getBestCmap())          # 码点集合
    font.close()
    missing = sorted(c for c in chapter_chars() if ord(c) not in cmap)
    if missing:
        print(f"✗ 缺少 {len(missing)} 个正文字符：{''.join(missing[:40])}")
        return 1
    print(f"✓ 现有字体覆盖全部正文用字（{len(cmap)} 个字）")
    return 0


def build() -> int:
    src = next((p for p in SRC_CANDIDATES if p.exists()), None)
    if src is None:
        print("✗ 找不到字体源文件，请先下载霞鹜文楷 Regular 到 _perf/fontsrc/")
        return 1

    chars = full_charset()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subset.main([
        str(src),
        f"--text={''.join(sorted(chars))}",
        "--flavor=woff2",
        "--no-hinting",
        "--layout-features=",
        "--drop-tables+=FFTM,feat,morx",
        f"--output-file={OUT}",
    ])
    size = OUT.stat().st_size
    print(f"✓ 生成 {OUT.relative_to(ROOT)}：{len(chars)} 字 / {size / 1024:.1f} KB")

    font = TTFont(OUT, lazy=True)
    cmap = set(font.getBestCmap())          # 码点集合
    font.close()
    missing = sorted(c for c in chapter_chars() if ord(c) not in cmap)
    print("  正文覆盖：" + ("全部命中" if not missing else "缺 " + "".join(missing[:20])))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查覆盖率，不重新生成")
    args = ap.parse_args()
    sys.exit(check() if args.check else build())
