"""產生主題選詞用的候選字表（給編輯或批次作業參考）。

用法：python tools/make_word_pool.py <輸出.tsv>

每行：字<TAB>詞頻排名<TAB>所屬詞彙表<TAB>詞性<TAB>第一個詞義
- 收錄所有已經有逐義例句（tools/senses）的字，依詞頻排名排序
- 詞頻排名是 BNC／COCA 取較常見者，數字越小越常見；沒有排名的放最後
"""
import json
import sys
from pathlib import Path

from build_topics import ROOT, load_senses, norm, rank_of, resolve, POS_ABBR, GRAM


def main(out):
    sys.stdout.reconfigure(encoding='utf-8')
    senses = load_senses()
    core = json.loads((ROOT / 'tools' / 'core_lists.json').read_text(encoding='utf-8'))
    rows = []
    for w, ss in senses.items():
        key, entry = resolve(w)
        r = rank_of(w, entry) or 99999
        s = ss[0]
        pos = GRAM.get(s.get('g')) or POS_ABBR.get(s['p'], s['p'])
        lists = ','.join(core.get(key or w, {}).get('lists', []))
        rows.append((r, w, lists, pos, s['zh']))
    rows.sort()
    Path(out).write_text('\n'.join(f'{w}\t{r}\t{l}\t{p}\t{z}' for r, w, l, p, z in rows) + '\n', encoding='utf-8')
    print(f'{len(rows)} 個字')


if __name__ == '__main__':
    main(sys.argv[1])
