#!/usr/bin/env python3
"""生成首页/目录标题用的 ZCOOL XiaoWei 精确子集，并守住它的体积。

## 为什么要有这个脚本

`zcool-xiaowei-subset.woff2` 历史上是「把全站出现过的中文字符一把梭」做出来的
保守子集：928 个码位（其中 823 个汉字）、201,752 B，而真正用这个字体的只有
站名、书封、分组名、小传/设定小标题、人物首字占位这些短文本。
在 15 KB/s 的链路上，光这一个字体就要 13.5 秒才到 —— 首页站名会长时间
停在兜底 serif 上。它是首屏最大的单点（占含字体首屏的 79%）。

现在按「实际会用到 ZCOOL 的文字」重新裁一遍，约 10 KB，省下 191 KB。

## 字符集怎么来（不写死，自动跟站点走）

1. 扫 `css/style.css`，找出所有 `font-family` 含 `"ZCOOL XiaoWei"` 的规则，
   把选择器里的 class 名收集起来；
2. 扫仓库内所有 `.html`，收集这些 class 元素（含其后代）的可见文本 ——
   多收一点是安全的，少收才会掉字形；
3. 扫 `js/characters-data.js` 的 `name` / `initial`、`js/chapters.js` 的
   `title` / `seal` / `volume` —— 这些是以后新增人物/章节时会进入标题的字，
   提前收进来当缓冲，代价不到 1 KB；
4. 补上 ASCII 可打印字符与常用中文标点。

第 1 步是自动的：以后给某个新元素加了 ZCOOL，重跑本脚本就会把它的字收进来。

## ⚠ 上游母版已经不在仓库里

ZCOOL XiaoWei 的原始 TTF 从未入库，仓库里只有历代裁剪后的子集。所以本脚本
是「从当前 woff2 再裁一刀」，**每次运行都会缩小可用字形库**。
现在这份产物只含约 140 个码位。生成器保证「当前字体里有、且站点需要」的字
一个不少地留下；对连 928 字母版都没有的字（部分人物名用字，现状本来就回落
系统 serif），只打印清单、不中止 —— 那不是本次引入的回归。
以后新增标题若用到被裁掉的字，`--check` 会提示重跑；若上游母版也没有那个字，
才需要按下面的办法取回上游字形。

那时需要拿回上游字形，两条路：

    # 优先：本次裁剪前的 928 字母版（也备份在仓库外
    # E:/novel-site/_design/fonts/zcool-xiaowei-master-928.woff2）
    git show 7e4be38:assets/fonts/zcool-xiaowei-subset.woff2 > /tmp/zcool-master.woff2
    python tools/make-zcool-subset.py --source /tmp/zcool-master.woff2

    # 或者：从 Google Fonts 下载 ZCOOL XiaoWei Regular（OFL），转成 woff2 后同上

**不要**把 `--source` 指向仓库里当前这份产物：它已经被裁过，取不回被删掉的字形。

## 缓存约定（改字体时必读）

这个字体在 `sw.js` 的 `PRECACHE` 里，URL **不带** `?f=` 内容键（与 favicon 同机制）。
所以改完字节必须把 `CACHE` 名 +1 强制重下，否则老读者永远拿旧字体。
CSS 里的 `url()` 也别加 `?f=`：`check-precache.mjs` 按文件原路径解析 PRECACHE 条目，
带查询串会被判成文件不存在。

用法：

    python tools/make-zcool-subset.py              # 重新生成字体 + 字符清单
    python tools/make-zcool-subset.py --check     # 只读校验，不装 fontTools 也能跑
    python tools/make-zcool-subset.py --source X  # 指定上游母版
"""
import argparse
import io
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'assets/fonts/zcool-xiaowei-subset.woff2'
CHARS_FILE = ROOT / 'assets/fonts/zcool-xiaowei-subset.chars.txt'
CSS = ROOT / 'css/style.css'
DATA_SOURCES = [
    ROOT / 'js/characters-data.js',
    ROOT / 'js/chapters.js',
]

# 性能护栏：超出这个字节数就说明有人把全字库放回来了，pre-push 直接拦。
MAX_BYTES = 32 * 1024
ASCII = {chr(c) for c in range(0x20, 0x7f)}
PUNCT = set('，。！？：；、（）【】…—·《》「」“”‘’％%~＋－')
VOID_TAGS = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
             'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


def zcool_classes(css_text: str) -> set:
    """取所有 font-family 含 ZCOOL XiaoWei 的规则选择器里的 class 名。"""
    # 头部目录注释里写着 css/style.css、js/reader.ui.js 之类路径，
    # 不剥注释会把 .css / .js / .ui 误当成 class，进而把无关文本收进字符集。
    css_text = re.sub(r'/\*[\s\S]*?\*/', '', css_text)
    classes = set()
    # 规则块：选择器 { ... }，只保留声明里有 ZCOOL 的
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css_text):
        if 'ZCOOL XiaoWei' not in m.group(2):
            continue
        selector = m.group(1).strip()
        # 去掉 @font-face 自身（它的 font-family 只是定义，不是选择器）
        if selector.startswith('@'):
            continue
        for part in selector.split(','):
            classes.update(re.findall(r'\.([A-Za-z][\w-]*)', part))
    return classes


class TextCollector(HTMLParser):
    """收集目标 class 元素（含后代）的文本；栈式匹配，void 标签不压栈。"""

    def __init__(self, targets: set):
        super().__init__(convert_charrefs=True)
        self.targets = targets
        self.stack = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            return
        cls = set((dict(attrs).get('class') or '').split())
        active = bool(self.targets & cls) or any(self.stack)
        self.stack.append(active)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            # 栈里只存 bool，靠长度回退到最近的开标签
            del self.stack[i:]
            return

    def handle_data(self, data):
        if any(self.stack):
            self.parts.append(data)


def html_chars(targets: set) -> set:
    chars = set()
    for path in sorted(ROOT.rglob('*.html')):
        if 'node_modules' in path.parts:
            continue
        p = TextCollector(targets)
        try:
            p.feed(path.read_text(encoding='utf-8', errors='replace'))
        except Exception as exc:  # 单个页面解析失败不该静默少收字
            print(f'警告：解析 {path.relative_to(ROOT)} 失败：{exc}', file=sys.stderr)
        chars.update(' '.join(''.join(p.parts).split()))
    return chars


def data_source_chars() -> set:
    """只收会进标题的字段，绝不收正文/小传（那走系统 serif）。"""
    chars = set()
    patterns = [r"\bname:\s*'([^']*)'", r"\binitial:\s*'([^']*)'",
                r"\btitle:\s*'([^']*)'", r"\bseal:\s*'([^']*)'",
                r"\bvolume:\s*'([^']*)'"]
    for path in DATA_SOURCES:
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        for pattern in patterns:
            for value in re.findall(pattern, text):
                chars.update(value)
    return chars


def needed_chars() -> set:
    targets = zcool_classes(CSS.read_text(encoding='utf-8'))
    if not targets:
        raise SystemExit('css/style.css 里没找到 ZCOOL 选择器，字符集无法计算')
    chars = html_chars(targets) | data_source_chars() | ASCII | PUNCT
    # 空白不进字体，也不进字符清单；两边口径必须一致，否则 --check 会误报。
    return {c for c in chars if not c.isspace()}


def check() -> int:
    need = needed_chars()
    if not CHARS_FILE.exists():
        print('✗ 缺少字符清单 assets/fonts/zcool-xiaowei-subset.chars.txt')
        return 1
    have = {c for c in CHARS_FILE.read_text(encoding='utf-8') if not c.isspace()}
    missing = need - have
    size = FONT.stat().st_size if FONT.exists() else 0
    print(f'ZCOOL 子集：{size:,} B / 字符清单 {len(have)} 字 / 上限 {MAX_BYTES:,} B')
    bad = 0
    if missing:
        bad = 1
        print('✗ 字符清单落后于站点，缺：' + ''.join(sorted(missing)))
        print('  → 跑 python tools/make-zcool-subset.py 重新生成')
    extra = have - need
    if extra:
        print(f'ℹ 清单里另有 {len(extra)} 个站点已不用的字，重跑生成器可再瘦一点')
    if size > MAX_BYTES:
        bad = 1
        print(f'✗ 字体 {size:,} B 超过 {MAX_BYTES:,} B 护栏 —— '
              '首屏会被它拖慢，请重新子集化。')
    if not bad:
        print('✓ 字符覆盖完整，字体体积在护栏内')
    return bad


def build(source: Path) -> int:
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        print('✗ 生成需要 fontTools：pip install fonttools brotli', file=sys.stderr)
        return 1

    need = needed_chars()
    master = TTFont(str(source))
    available = set(master.getBestCmap())
    codes = {ord(c) for c in need} & available
    absent = {c for c in need if ord(c) not in available}
    if absent:
        print('⚠ 上游母版本来就缺 %d 字（现状同样回落系统 serif，不是本次回归）：%s'
              % (len(absent), ''.join(sorted(absent))))
        print('  若这些字以后必须显示为 ZCOOL，按脚本头部说明用 --source 取回上游字形。')

    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []      # 静态标题字，不需要 GSUB/GPOS
    opts.hinting = False           # 去掉 hinting 表
    opts.notdef_outline = True
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=sorted(codes))
    sub.subset(master)

    buf = io.BytesIO()
    master.flavor = 'woff2'
    master.save(buf)
    payload = buf.getvalue()

    # 字符清单 = 站点所需全集（不是 woff2 的 cmap）：那些上游母版也没有的字
    # 目前靠系统 serif 回落，仍要记在清单里，否则 --check 会一直误报缺字。
    CHARS_FILE.write_text(''.join(sorted(need)), encoding='utf-8')
    FONT.write_bytes(payload)
    original = source.stat().st_size
    print(f'✓ 写入 {FONT.relative_to(ROOT)}：{len(payload):,} B / {len(codes)} 个字形')
    print(f'✓ 写入 {CHARS_FILE.relative_to(ROOT)}：{len(need)} 字')
    print(f'  相对母版 {original:,} B 省下 {original - len(payload):,} B '
          f'({(1 - len(payload) / original) * 100:.1f}%)')
    print('⚠ 下一步：sw.js 的 CACHE 名 +1（此字体在 PRECACHE 里且 URL 无内容键）')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true', help='只读校验，不改文件')
    ap.add_argument('--source', type=Path, default=FONT,
                    help='上游母版 woff2（默认当前字体，见脚本头部警告）')
    args = ap.parse_args()
    if args.check:
        return check()
    if args.source == FONT:
        print('注意：以当前字体为母版再裁一刀（字库只会变小）。'
              '需要补字请按脚本头部说明用 --source 指定上游母版。')
    return build(args.source)


if __name__ == '__main__':
    sys.exit(main())
