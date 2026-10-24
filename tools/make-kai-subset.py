#!/usr/bin/env python3
"""生成阅读页「楷体」用的字体子集，并保证它覆盖当前正文用字。

为什么需要这一步：安卓基本不带中文楷体，所以字体必须自带。整份霞鹜文楷 7MB；
子集只收「GB2312 一级常用字（3755）+ 当前正文已用字 + ASCII + 常用标点」，
产物约 850KB；该字体不预缓存，只有用户主动选楷体时才懒加载，所以体积只影响
楷体用户的首次下载，不影响默认阅读路径。

为什么不是「只收已用字」：那样每发一章都可能因为个别新出现的常用字而缺字
（显示成豆腐块），CI 的覆盖检查会拦下 push。把 GB2312 一级字整体收进来之后，
新章节只要是常用字就都不会再缺字。

缺字怎么防：生成时会同时写一份字符清单
（assets/fonts/linyuan-kai-subset.chars.txt），清单内容 = 字体 cmap 的实际覆盖。
--check 只读这份清单做比对，不需要 fontTools，所以 pre-push 钩子在没装字库工具的
机器上也能跑。新增章节后若用到 GB2312 一级字以外的生僻字，push 仍会被拦下并提示。

字体来源：LXGW WenKai（霞鹜文楷）Regular，OFL 1.1，允许子集化后作为 Web 字体分发。
授权原文见 assets/fonts/OFL-lxgw-wenkai.txt。

用法：
    python tools/make-kai-subset.py            # 生成（需要 fontTools + brotli）
    python tools/make-kai-subset.py --minimal  # 瘦身版：只收正文已用字（约 200KB）
    python tools/make-kai-subset.py --check    # 只检查覆盖率（纯标准库）

什么时候该用 --minimal：
    站点已有大量章节、体积敏感，且你能接受「每次加章先重跑一次生成脚本」的流程时。
    默认（不加参数）的大集合适合「章节持续增长、不想每章都被 CI 拦一次」的场景。
    注意：两种产物写的是同一个文件名，改用另一种方式后必须提交新的 woff2，
    并把 css/style.css 里的 ?f=N 缓存键 +1。
"""
import argparse
import os
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
    """GB2312 一级汉字（3755 个常用字），只依赖 Python 内置 gb2312 编解码器。

    逐字节解 0xB0A1-0xD7FE；解不出来的区位（GB2312 里留空的位）直接跳过，
    最后只保留 U+4E00-U+9FFF 汉字区内的字，避免混进全角符号。
    """
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


def full_charset(minimal: bool = False) -> set:
    """要收进子集的全部字符。minimal=True 退回「只收正文已用字」的瘦身行为。"""
    base = chapter_chars()
    if minimal:
        return base | {chr(c) for c in range(0x20, 0x7F)} | set(PUNCT)
    return base | common_chars() | {chr(c) for c in range(0x20, 0x7F)} | set(PUNCT)


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

    # 顺带报一下常用字覆盖情况（仅提示，不作为失败条件：
    # 源字体本身若缺某个 GB2312 字，重跑生成也补不上，不该每次都拦 push）
    common = common_chars()
    common_missing = len(common - included)
    note = ""
    if common_missing:
        note = f"，GB2312 一级字覆盖 {len(common) - common_missing}/{len(common)}"
    print(f"✓ 楷体字体覆盖全部正文用字（清单 {len(included)} 个字{note}）")
    return 0


def build(minimal: bool = False) -> int:
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

    chars = full_charset(minimal)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = OUT.with_name(OUT.name + ".tmp")
    try:
        subset.main([
            str(src),
            f"--text={''.join(sorted(chars))}",
            "--flavor=woff2",
            "--no-hinting",
            "--layout-features=",
            "--drop-tables+=FFTM,feat,morx",
            f"--output-file={tmp_out}",
        ])
        _replace_file(tmp_out, OUT)
    finally:
        if tmp_out.exists():
            tmp_out.unlink()

    # 用实际生成的字体回读，保证清单与字体完全一致（而不是"我们以为包含了什么"）
    font = TTFont(OUT, lazy=True)
    cmap = set(font.getBestCmap())
    font.close()
    actual = {chr(cp) for cp in cmap if cp >= 0x20}

    tmp_manifest = MANIFEST.with_name(MANIFEST.name + ".tmp")
    tmp_manifest.write_text("".join(sorted(actual)), encoding="utf-8")
    _replace_file(tmp_manifest, MANIFEST)

    size = OUT.stat().st_size
    mode = "minimal（仅正文已用字）" if minimal else "default（GB2312 一级字 + 已用字）"
    print(f"✓ 生成 {OUT.relative_to(ROOT)}：{len(actual)} 字 / {size / 1024:.1f} KB")
    print(f"  模式：{mode}；平均 {size / max(len(actual), 1):.0f} 字节/字")

    missing = sorted(c for c in chapter_chars() if c not in actual)
    print("  正文覆盖：" + ("全部命中" if not missing else "缺 " + "".join(missing[:20])))

    if minimal:
        print("  GB2312 一级字：未收录（--minimal 模式）")
    else:
        common = common_chars()
        common_missing = sorted(common - actual)
        if common_missing:
            print(f"  GB2312 一级字覆盖 {len(common) - len(common_missing)}/{len(common)}，"
                  f"源字体缺 {len(common_missing)} 个：{''.join(common_missing[:20])}")
        else:
            print(f"  GB2312 一级字覆盖 {len(common)}/{len(common)}，全部命中")
    return 0 if not missing else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查覆盖率，不重新生成")
    ap.add_argument("--minimal", action="store_true",
                    help="瘦身模式：只收正文已用字（默认收 GB2312 一级字 + 已用字）")
    args = ap.parse_args()
    sys.exit(check() if args.check else build(minimal=args.minimal))
