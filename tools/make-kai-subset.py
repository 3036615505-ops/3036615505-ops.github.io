#!/usr/bin/env python3
"""生成阅读页「楷体」用的字体子集，并保证它覆盖当前正文用字。

为什么需要这一步：安卓基本不带中文楷体，所以字体必须自带。整份霞鹜文楷 7MB；
就算只取 GB2312 常用 3755 字也要 850KB；这里只收录「当前已发布的字符」，
体积约 170KB，首次选择时下载很快。

缺字怎么防：生成时会同时写一份字符清单
（assets/fonts/linyuan-kai-subset.chars.txt）。--check 只读这份清单做比对，
不需要 fontTools，所以 pre-push 钩子在没装字库工具的机器上也能跑。
新增章节后若忘记重跑本脚本，push 会被拦下并提示。

字体来源：LXGW WenKai（霞鹜文楷）Regular，OFL 1.1，允许子集化后作为 Web 字体分发。
授权原文见 assets/fonts/OFL-lxgw-wenkai.txt。

用法：
    python tools/make-kai-subset.py            # 生成（需要 fontTools + brotli）
    python tools/make-kai-subset.py --check    # 只检查覆盖率（纯标准库）
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts" / "linyuan-kai-subset.woff2"
MANIFEST = ROOT / "assets" / "fonts" / "linyuan-kai-subset.chars.txt"
SRC_CANDIDATES = [
    ROOT.parent / "_perf" / "fontsrc" / "package" / "files" / "lxgw-wenkai-latin-500-normal.woff2",
    ROOT.parent / "_perf" / "fontsrc" / "LXGWWenKaiLite-Regular.ttf",
]
PUNCT = "，。！？：；、“”‘’（）《》【】…—·～「」『』〈〉"


def chapter_chars() -> set:
    """章节页里所有会显示出来的字（正文、标题、题注都算）。"""
    chars = set()
    for f in sorted(ROOT.glob("novel/chapter-*.html")):
        s = f.read_text(encoding="utf-8")
        s = re.sub(r"<script[\s\S]*?</script>", "", s)
        s = re.sub(r"<style[\s\S]*?</style>", "", s)
        chars |= set(re.sub(r"<[^>]+>", "", s))
    # 换行/制表等控制字符不需要字形（HTML 会折叠成空格），排除掉免得误报缺字
    return {c for c in chars if not c.isspace()}


def full_charset() -> set:
    return chapter_chars() | {chr(c) for c in range(0x20, 0x7F)} | set(PUNCT)


def check() -> int:
    if not MANIFEST.exists():
        print(f"⚠  找不到字符清单 {MANIFEST.name}，跳过楷体覆盖检查")
        print("   修复：python tools/make-kai-subset.py")
        return 0

    included = set(MANIFEST.read_text(encoding="utf-8"))
    missing = sorted(c for c in chapter_chars() if c not in included)
    if missing:
        print(f"✗ 楷体字体缺少 {len(missing)} 个正文字符：{''.join(missing[:40])}")
        return 1
    print(f"✓ 楷体字体覆盖全部正文用字（清单 {len(included)} 个字）")
    return 0


def build() -> int:
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        print("✗ 缺少 fontTools，无法生成子集")
        print("   安装：pip install fonttools brotli")
        return 1

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

    # 用实际生成的字体回读，保证清单与字体完全一致（而不是"我们以为包含了什么"）
    font = TTFont(OUT, lazy=True)
    cmap = set(font.getBestCmap())
    font.close()
    actual = {chr(cp) for cp in cmap if cp >= 0x20}
    MANIFEST.write_text("".join(sorted(actual)), encoding="utf-8")

    print(f"✓ 生成 {OUT.relative_to(ROOT)}：{len(actual)} 字 / {OUT.stat().st_size / 1024:.1f} KB")
    missing = sorted(c for c in chapter_chars() if c not in actual)
    print("  正文覆盖：" + ("全部命中" if not missing else "缺 " + "".join(missing[:20])))
    return 0 if not missing else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查覆盖率，不重新生成")
    args = ap.parse_args()
    sys.exit(check() if args.check else build())
