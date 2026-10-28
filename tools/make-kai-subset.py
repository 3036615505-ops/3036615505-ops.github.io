#!/usr/bin/env python3
"""生成阅读页「楷体」的两份字体子集：主片（正文已用字）+ 兜底片（GB2312 余字）。

## 为什么要拆成两份

安卓基本不带中文楷体，所以字体必须自带。整份霞鹜文楷 13.9MB，必须子集化。

曾经的做法是把「GB2312 一级常用字 3755 + 正文已用字」一次性收进一个 853KB 的文件，
好处是加新章不会再缺字，坏处是**每个选楷体的读者都要下 853KB**，而 6 章正文
其实只用到 1157 个不同的字。

实测（2026-10，6 章正文）：
    单文件 853KB（3900 字）     每章必下 853KB
    只收已用字 253KB（1157 字）  每章必下 253KB   ← 降到 30%
    再把 1157 字切成 4–16 片    每章 274–298KB   ← 反而更差

分片反而更差的原因：子集瘦到 1157 字之后，每章用的 446–594 个字散布在所有分片里，
**每一片都含有该章需要的字**，于是片片都得下；分片只多出每份 woff2 自带的
name/head 等表开销。所以「按 unicode-range 切块」这套（cn-font-split 之类）适合的是
未瘦身的全字库，不适合已经瘦过一轮的子集 —— 别再往这个方向走。

## 现在的做法

    （以下体积/字数为 2026-10-28 实测，7 章正文；跑 `--check` 或 build 会打印当前值）

    主片 linyuan-kai-subset.woff2   正文已用字（1316 字）   273.1KB   选楷体必下
    兜底片 linyuan-kai-rest.woff2   GB2312 余下（2590 字）  618.4KB   缺字时才下

    （两片合计 3906 字 = 字符清单；上面「实测（2026-10，6 章正文）」那节是
     2026-10 只有 6 章时的 A/B 实验记录，数字不同是正常的，不要拿它当现状。）

CSS 里两个不同 family，正文用 `"LinyuanKai","LinyuanKaiRest",...` 的栈。
**浏览器只在主片没有该字形时才去取兜底片**，所以正常阅读永远只付 273.1KB。
兜底片保证「新章用了新的常用字」不会显示成豆腐块，也就不必每加一章都重跑本脚本。

## 缺字怎么防

生成时写一份字符清单（linyuan-kai-subset.chars.txt），内容是**两片 cmap 的并集**，
即这个字体系统实际能覆盖的全部字符。--check 只读清单做比对，不需要 fontTools，
所以 pre-push 钩子与 CI 在没装字库工具的机器上也能跑。

只有「既不在正文已用字、也不在 GB2312 一级字」的生僻字才会让 check 失败 ——
那种字确实会显示成豆腐块，应当拦下。

## 何时需要重跑

- 新增章节用到了 GB2312 一级字以外的生僻字（check 会提示）
- 想瘦掉已经用不上的字（例如删改章节后）——不是必须，只是省体积

## 字体来源

LXGW WenKai（霞鹜文楷）Regular，OFL 1.1，允许子集化后作为 Web 字体分发。
授权原文见 assets/fonts/OFL-lxgw-wenkai.txt。

用法：
    python tools/make-kai-subset.py            # 生成主片 + 兜底片（需要 fontTools + brotli）
    python tools/make-kai-subset.py --text-only  # 只打印每章用字统计，不生成
    python tools/make-kai-subset.py --check    # 只检查覆盖率（纯标准库）

依赖安装：pip install fonttools brotli
"""
import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "assets" / "fonts"
MAIN = FONT_DIR / "linyuan-kai-subset.woff2"
REST = FONT_DIR / "linyuan-kai-rest.woff2"
MANIFEST = FONT_DIR / "linyuan-kai-subset.chars.txt"
SRC_CANDIDATES = [
    ROOT.parent / "_perf" / "fontsrc" / "LXGWWenKaiLite-Regular.ttf",
    ROOT.parent / "_perf" / "fontsrc" / "package" / "files" / "lxgw-wenkai-latin-500-normal.woff2",
    MAIN,  # 源文件不在时，用现有的主片当源——只能保住已收的字，聊胜于无
]
PUNCT = "，。！？：；、“”‘’（）《》【】…—·～「」『』〈〉"

# GB2312 一级汉字（常用字）的区位范围：区 16-55（高位 0xB0-0xD7），
# 位 1-94（低位 0xA1-0xFE）。这一段收的是按拼音排序的 3755 个常用汉字。
GB1_HI_RANGE = range(0xB0, 0xD8)
GB1_LO_RANGE = range(0xA1, 0xFF)


def _replace_file(tmp: Path, dst: Path) -> None:
    """把临时文件原子地挪到目标路径。

    生成过程先写 .tmp 再改名：万一中途失败，仓库里的 woff2 / 清单还是上一版可用的，
    不会留下半截文件。Windows 上某些安全软件会拒绝「覆盖式重命名」，
    所以 os.replace 失败时退一步先删旧文件再改名。
    """
    try:
        os.replace(tmp, dst)
    except OSError:
        if dst.exists():
            dst.unlink()
        os.rename(tmp, dst)


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


def common_chars() -> set:
    """GB2312 一级汉字（3755 个常用字），只依赖 Python 内置 gb2312 编解码器。"""
    chars = set()
    for hi in GB1_HI_RANGE:
        for lo in GB1_LO_RANGE:
            try:
                c = bytes([hi, lo]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            if "\u4e00" <= c <= "\u9fff":
                chars.add(c)
    return chars


def charset() -> set:
    """主片要收的全部字符：正文已用字 + ASCII + 常用标点。"""
    return chapter_chars() | {chr(c) for c in range(0x20, 0x7F)} | set(PUNCT)


def check() -> int:
    if not MANIFEST.exists():
        print(f"⚠  找不到字符清单 {MANIFEST.name}，跳过楷体覆盖检查")
        print("   修复：python tools/make-kai-subset.py")
        return 0

    included = set(MANIFEST.read_text(encoding="utf-8"))
    missing = sorted(c for c in chapter_chars() if c not in included)
    if missing:
        print(f"✗ 楷体缺少 {len(missing)} 个正文字符：{''.join(missing[:40])}")
        print("   这些字会显示成豆腐块，且不在 GB2312 一级字范围内（否则兜底片已覆盖）")
        print("   修复：pip install fonttools brotli && python tools/make-kai-subset.py")
        return 1

    # 顺带报一下常用字覆盖情况（仅提示，不作为失败条件：
    # 源字体本身若缺某个 GB2312 字，重跑生成也补不上，不该每次都拦 push）
    common = common_chars()
    common_missing = len(common - included)
    note = f"，GB2312 一级字覆盖 {len(common) - common_missing}/{len(common)}" if common_missing else ""
    print(f"✓ 楷体覆盖全部正文用字（清单 {len(included)} 个字{note}）")
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
    if src == MAIN:
        print("⚠  源文件缺失，退回用现有主片当源：只能保住已收的字，无法补入新字")

    used = charset()
    rest_chars = common_chars() - used

    def make(chars: set, dst: Path) -> int:
        tmp = dst.with_name(dst.name + ".tmp")
        try:
            subset.main([
                str(src),
                f"--text={''.join(sorted(chars))}",
                "--flavor=woff2",
                "--no-hinting",
                "--layout-features=",
                "--drop-tables+=FFTM,feat,morx",
                f"--output-file={tmp}",
            ])
            _replace_file(tmp, dst)
        finally:
            if tmp.exists():
                tmp.unlink()
        return dst.stat().st_size

    FONT_DIR.mkdir(parents=True, exist_ok=True)
    main_size = make(used, MAIN)
    rest_size = make(rest_chars, REST) if rest_chars else 0

    # 用实际生成的字体回读，保证清单与字体完全一致（而不是「我们以为包含了什么」）
    actual = set()
    for path in (MAIN, REST):
        if not path.exists():
            continue
        font = TTFont(path, lazy=True)
        actual |= {chr(cp) for cp in font.getBestCmap() if cp >= 0x20}
        font.close()

    tmp_manifest = MANIFEST.with_name(MANIFEST.name + ".tmp")
    tmp_manifest.write_text("".join(sorted(actual)), encoding="utf-8")
    _replace_file(tmp_manifest, MANIFEST)

    print(f"✓ 主片   {MAIN.name}：{len(used)} 字 / {main_size / 1024:.1f} KB（选楷体必下）")
    print(f"✓ 兜底片 {REST.name}：{len(rest_chars)} 字 / {rest_size / 1024:.1f} KB（缺字时才下）")
    print(f"  清单合计 {len(actual)} 字；正常阅读只付 {main_size / 1024:.0f} KB")

    missing = sorted(c for c in chapter_chars() if c not in actual)
    if missing:
        print(f"  ✗ 正文仍有 {len(missing)} 字未覆盖：{''.join(missing[:20])}")
    else:
        print("  正文覆盖：全部命中")
    common = common_chars()
    common_missing = sorted(common - actual)
    if common_missing:
        print(f"  GB2312 一级字覆盖 {len(common) - len(common_missing)}/{len(common)}，"
              f"源字体缺 {len(common_missing)} 个：{''.join(common_missing[:20])}")
    else:
        print(f"  GB2312 一级字覆盖 {len(common)}/{len(common)}，全部命中")
    return 0 if not missing else 1


def report() -> int:
    """打印每章用字统计，用于判断主片该有多大。"""
    pages = {p.stem: chapter_chars() for p in sorted(ROOT.glob("novel/chapter-*.html"))}
    union = set()
    print("章节            用字   新增累计")
    for name in sorted(pages):
        cur = pages[name]
        new = len(cur - union)
        union |= cur
        print(f"{name:<16}{len(cur):>4}   {new:>4}")
    print(f"\n合计不重复用字：{len(union)}")
    print(f"GB2312 一级字：{len(common_chars())}，其中正文已覆盖 {len(common_chars() & union)}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查覆盖率，不重新生成")
    ap.add_argument("--text-only", action="store_true", help="只打印用字统计")
    args = ap.parse_args()
    if args.text_only:
        sys.exit(report())
    sys.exit(check() if args.check else build())
