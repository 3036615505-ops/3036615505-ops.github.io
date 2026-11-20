#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「设计说明」型长注释从发布文件里搬到 _design/notes/，代码里只留短注释。

## 为什么需要它

这个站点的 CSS/JS 里躺着大量中文设计说明（为什么这么写、踩过什么坑）。
它们是这个仓库最值钱的东西之一 —— 但也是**传输体积的一半**：
`css/style.css` gzip 48,677 B，去掉注释只剩 18,782 B；`js/reader.ui.js`
52,185 B → 28,848 B。中文注释几乎不重复，gzip 压不动。

## 做法

只搬**独占整行、且跨 3 行以上**的块注释（`/* ... */`）。理由：
- 行首 `/*` 一定是注释 —— 本仓库的 JS 没有模板字符串（反引号只出现在注释里），
  不存在「多行字符串里恰好有个 /*」的情况。因此不需要写 JS 词法器，
  也就不会把字符串/正则当注释切掉。
- 1–2 行的短注释留在原处 —— 贴着代码的「这一行在干嘛」比搬走更有用，字节也少。

搬走的内容按行号范围写进 `_design/notes/<文件>.md`，逐段带原文锚点，
要看完整推理就去那里。

## 用法

    python tools/compact-comments.py --dry-run        # 只统计能省多少
    python tools/compact-comments.py --write          # 落盘 + 写 notes

⚠ 落盘后必须：`npm run bump --write`（`?v=` +1）→ `CACHE` +1 → 全量回归。
⚠ 别对 `js/transition.js` 跑：模块已停用、不再被任何页面引用，改它没有收益。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTES_DIR = os.path.join(os.path.dirname(ROOT), '_design', 'notes')

TARGETS = [
    'css/style.css',
    'js/reader.ui.js',
    'js/reader.engine.js',
    'js/reader.store.js',
    'js/reader.flags.js',
    'js/reader.dom.js',
    'js/lightbox.js',
    'js/announce.js',
    'js/native-bridge.js',
    'js/chapters.js',
]

# 跨这么多行以上的独占块注释才搬走（3 = 至少 3 行正文）
MIN_LINES = 3
# 独占一行但特别长的也搬走（字符数），避免「一行写了一千字」
MAX_INLINE_CHARS = 160


def split_blocks(lines):
    """返回 [(start, end, kind)] —— end 为闭区间下标。

    kind: 'header' 文件头（第一个非空行就是 /*），'block' 普通独占块注释。
    """
    spans = []
    i = 0
    n = len(lines)
    while i < n:
        if re.match(r'^\s*/\*', lines[i]):
            start = i
            # 单行注释：本行就有 */
            if '*/' in lines[i]:
                end = i
            else:
                end = i
                while end + 1 < n and '*/' not in lines[end]:
                    end += 1
                # 若到文件尾都没闭合，说明不是注释（防御性：不动它）
                if '*/' not in lines[end]:
                    i += 1
                    continue
            kind = 'header' if not any(l.strip() for l in lines[:start]) else 'block'
            spans.append((start, end, kind))
            i = end + 1
            continue
        i += 1
    return spans


def should_move(lines, start, end, kind):
    if kind == 'header':
        return True
    body_lines = end - start + 1
    if body_lines >= MIN_LINES:
        return True
    text = '\n'.join(lines[start:end + 1])
    return len(text) > MAX_INLINE_CHARS


def compact(path, dry_run):
    rel = os.path.relpath(path, ROOT).replace('\\', '/')
    src = open(path, encoding='utf-8').read()
    lines = src.split('\n')
    spans = split_blocks(lines)

    notes = []
    out = []
    cursor = 0
    saved = 0
    moved = 0
    header_done = False

    for start, end, kind in spans:
        out.extend(lines[cursor:start])
        block = lines[start:end + 1]
        if should_move(lines, start, end, kind):
            text = '\n'.join(block)
            # 文件头保留「第一行标题 + 指针」，其余搬走
            if kind == 'header' and not header_done:
                header_done = True
                first = ''
                for ln in block:
                    candidate = ln.replace('/*', '').replace('*/', '').strip().lstrip('*').strip()
                    if candidate:
                        first = candidate
                        break
                pointer = ('/* %s\n'
                           '   设计说明、历史与踩坑记录见 _design/notes/%s.md（原文按行号归档）。 */'
                           % (first, os.path.basename(path)))
                out.extend(pointer.split('\n'))
                notes.append('## L%d–L%d（文件头）\n\n```\n%s\n```\n'
                             % (start + 1, end + 1, text))
            else:
                notes.append('## L%d–L%d\n\n```\n%s\n```\n'
                             % (start + 1, end + 1, text))
            saved += len(text.encode('utf-8'))
            moved += 1
        else:
            out.extend(block)
        cursor = end + 1
    out.extend(lines[cursor:])

    # 清掉搬走后留下的连续空行（最多留一行）
    cleaned = []
    blank = 0
    for ln in out:
        if not ln.strip():
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        cleaned.append(ln)
    result = '\n'.join(cleaned)
    newbytes = len(result.encode('utf-8'))
    oldbytes = len(src.encode('utf-8'))

    print(f'{rel:24s} {oldbytes:>8,d} → {newbytes:>8,d} B  省 {saved:>7,d} B（搬走 {moved} 段）')

    if not dry_run:
        open(path, 'w', encoding='utf-8', newline='').write(result)
        if notes:
            os.makedirs(NOTES_DIR, exist_ok=True)
            note_path = os.path.join(NOTES_DIR, os.path.basename(path) + '.md')
            header = ('# %s —— 从发布文件搬出的设计注释\n\n'
                      '> 这些注释原本写在 `%s` 里，2026-11-20 为提高传输效率搬到此处：\n'
                      '> 中文长注释几乎不重复，gzip 压不动，占了发布字节的一半。\n'
                      '> 代码里只保留贴着逻辑的短注释。行号对应搬走时的原文位置。\n\n'
                      % (rel, rel))
            open(note_path, 'w', encoding='utf-8', newline='').write(header + '\n'.join(notes))
            print(f'    → 注释归档 {os.path.relpath(note_path, os.path.dirname(ROOT))}')
    return oldbytes, newbytes


def main():
    dry = '--write' not in sys.argv
    print(('[dry-run] ' if dry else '[write] ') + '只搬独占整行、跨 %d 行以上的块注释' % MIN_LINES)
    tot_old = tot_new = 0
    for rel in TARGETS:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            print(f'  ! 缺少 {rel}')
            continue
        a, b = compact(p, dry)
        tot_old += a
        tot_new += b
    print(f'\n合计 {tot_old:,d} → {tot_new:,d} B，省 {tot_old - tot_new:,d} B'
          f'（{(1 - tot_new / tot_old) * 100:.1f}%）')
    if dry:
        print('（未写盘；加 --write 落盘）')


if __name__ == '__main__':
    main()
