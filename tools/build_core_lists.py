"""合併多益核心詞彙表，產生 tools/core_lists.json。

用法：python tools/build_core_lists.py <詞彙表資料夾>

<詞彙表資料夾> 需要（https://www.newgeneralservicelist.com/，CC BY-SA 4.0）：
    NGSL_12_stats.csv、TSL_12_stats.csv、BSL_120_stats.csv、NAWL_12_lemmatized_for_teaching.csv

輸出：{word: {"lists": ["TSL", ...], "rank": {"TSL": 12, ...}}}
- 排除虛詞（冠詞、代名詞、介系詞、連接詞、助動詞、數詞），它們不適合逐義例句學習
- 只收 ECDICT 裡有中文詞義的字（找不到的會列出來）
"""
import csv
import json
import sys
import unicodedata
from pathlib import Path

from build_topics import ROOT, norm, resolve

FUNCTION_POS = {'art', 'pron', 'prep', 'conj', 'aux', 'num', 'int'}
# 詞彙表的寫法和一般寫法不同時，改用一般寫法
ALIASES = {'stockmarket': 'stock market'}
# 詞彙表裡的殘缺字形（字首、錯誤變化形），不是獨立的字
EXCLUDE = {'founds', 'trans', 'tran'}


def read_text(path):
    raw = Path(path).read_bytes()
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        return raw.decode('cp1252')  # 部分檔案是 Windows 西歐編碼（例如 café）


def read_ranked(path, col_rank):
    out = {}
    if True:
        for row in csv.DictReader(read_text(path).splitlines()):
            w = norm(row[next(iter(row))])  # 第一欄是字
            try:
                out.setdefault(w, int(float(row[col_rank])))
            except (ValueError, TypeError):
                continue
    return out


def main(src):
    sys.stdout.reconfigure(encoding='utf-8')
    src = Path(src)
    lists = {
        'NGSL': read_ranked(src / 'NGSL_12_stats.csv', 'SFI Rank'),
        'TSL': read_ranked(src / 'TSL_12_stats.csv', 'TSL Rank'),
        'BSL': read_ranked(src / 'BSL_120_stats.csv', 'BSL Rank'),
    }
    nawl = {}
    if True:
        for i, row in enumerate(csv.reader(read_text(src / 'NAWL_12_lemmatized_for_teaching.csv').splitlines()), 1):
            if row and row[0].strip():
                nawl.setdefault(norm(row[0]), i)
    lists['NAWL'] = nawl

    # 給 build_dict.py 用：詞彙表裡的字一定要收錄進詞典
    raw = sorted({w for ranked in lists.values() for w in ranked})
    (ROOT / 'tools' / 'core_words.txt').write_text('\n'.join(raw) + '\n', encoding='utf-8')

    words, missing, skipped = {}, [], []
    for name, ranked in lists.items():
        for w, r in ranked.items():
            if not w.replace('-', '').replace("'", '').isalpha():
                continue
            w = ALIASES.get(w, w)
            if w in EXCLUDE:
                continue
            key, entry = resolve(w)
            if not entry:  # café → cafe、résumé → resume
                plain = unicodedata.normalize('NFKD', w).encode('ascii', 'ignore').decode()
                key, entry = resolve(plain) if plain else (None, None)
            if not entry:
                missing.append(f'{name}:{w}')
                continue
            pos = {g['p'] for g in entry['m'] if not g.get('d')}
            if pos and pos <= FUNCTION_POS:
                skipped.append(w)
                continue
            item = words.setdefault(key, {'lists': [], 'rank': {}})
            if name not in item['lists']:
                item['lists'].append(name)
                item['rank'][name] = r
    (ROOT / 'tools' / 'core_lists.json').write_text(json.dumps(words, ensure_ascii=False, indent=0), encoding='utf-8')
    by = {n: sum(n in v['lists'] for v in words.values()) for n in lists}
    print(f'核心詞彙 {len(words)} 個（{by}）；排除虛詞 {len(skipped)} 個；ECDICT 找不到 {len(missing)} 個')
    if missing:
        print('找不到：', ', '.join(missing[:80]))


if __name__ == '__main__':
    main(sys.argv[1])
