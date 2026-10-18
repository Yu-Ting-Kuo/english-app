"""從 Tatoeba 匯出檔建立「英文例句 ↔ 中文翻譯」配對表。

用法：
    pip install opencc
    python tools/tatoeba_pairs.py <Tatoeba 資料夾> <輸出 pairs.tsv>

<Tatoeba 資料夾> 需要（https://downloads.tatoeba.org/exports/per_language/）：
    eng_sentences_detailed.tsv.bz2、cmn_sentences_detailed.tsv.bz2、eng-cmn_links.tsv.bz2

Tatoeba 例句以 CC BY 2.0 FR 授權，使用時要標示來源與作者（每句保留 id 與使用者名稱）。
中文翻譯先轉簡體再轉台灣繁體（s2twp），讓港陸用語也換成台灣用語，例如 軟件 → 軟體。
輸出欄位：eng_id, eng_text, eng_user, cmn_id, zh_tw, cmn_user
"""
import bz2
import csv
import sys
from pathlib import Path

import opencc

t2s = opencc.OpenCC('t2s')
s2twp = opencc.OpenCC('s2twp')


def read_sentences(path):
    out = {}
    with bz2.open(path, 'rt', encoding='utf-8') as f:
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 4:
                out[parts[0]] = (parts[2], parts[3] if parts[3] != '\\N' else '')
    return out


def main(src, dst):
    src = Path(src)
    eng = read_sentences(src / 'eng_sentences_detailed.tsv.bz2')
    cmn = read_sentences(src / 'cmn_sentences_detailed.tsv.bz2')
    n = 0
    with bz2.open(src / 'eng-cmn_links.tsv.bz2', 'rt', encoding='utf-8') as f, \
            open(dst, 'w', encoding='utf-8', newline='') as out:
        w = csv.writer(out, delimiter='\t')
        seen = set()
        for line in f:
            a, b = line.split('\t')[:2]
            b = b.strip()
            if a not in eng or b not in cmn or (a, b) in seen:
                continue
            seen.add((a, b))
            en_text, en_user = eng[a]
            zh_text, zh_user = cmn[b]
            words = len(en_text.split())
            if not (3 <= words <= 18) or not zh_text.strip():
                continue
            zh = s2twp.convert(t2s.convert(zh_text.strip()))
            w.writerow([a, en_text.strip(), en_user, b, zh, zh_user])
            n += 1
    print(f'英文 {len(eng)} 句、中文 {len(cmn)} 句，配對 {n} 組')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main(sys.argv[1], sys.argv[2])
