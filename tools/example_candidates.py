"""列出主題單字的候選例句，給人工（或審核流程）分配到各個詞義。

用法：python tools/example_candidates.py <pairs.tsv> <輸出.txt> <主題 id 或 all> [每字最多幾句]

輸出格式（方便閱讀）：
## 單字 | 詞典詞義（依詞性）
  t:<id> 英文 ⟶ 中文
"""
import json
import re
import sys
from pathlib import Path

from build_topics import ROOT, norm, resolve
from examples_lib import find_span, load_pairs, word_forms


def topic_words(which):
    if which.startswith('@'):  # @檔案：一行一個字
        return [w.strip() for w in Path(which[1:]).read_text(encoding='utf-8').split('\n') if w.strip()]
    src = json.loads((ROOT / 'tools' / 'topics.json').read_text(encoding='utf-8'))
    ids = [t for c in src['categories'] for t in c['topics']] if which == 'all' else which.split(',')
    out = []
    for tid in ids:
        for _, _, items in src['topics'][tid]['sections']:
            for w, g in items:
                if w not in out:
                    out.append(w)
    return out


def main(pairs_path, out_path, which, per_word=12):
    pairs = load_pairs(pairs_path)
    # 單字 → 含有這個字的句子，避免每個字都掃過全部 7 萬句
    index = {}
    for pr in pairs.values():
        for tok in set(re.findall(r"[a-z]+", pr['en'].lower())):
            index.setdefault(tok, []).append(pr)
    words = topic_words(which)
    done = set()
    senses_dir = ROOT / 'tools' / 'senses'
    for p in senses_dir.glob('*.json'):
        done.update(json.loads(p.read_text(encoding='utf-8')).keys())
    lines = []
    for w in words:
        key, entry = resolve(w)
        k = key or norm(w)
        if k in done:
            continue
        forms = word_forms(w)
        pool = {}
        for f in forms:
            first = re.findall(r'[a-z]+', f)
            for pr in index.get(first[0] if first else '', []):
                pool[pr['id']] = pr
        cands = []
        for pr in pool.values():
            sp = find_span(pr['en'], forms)
            if sp:
                cands.append((pr, pr['en'][sp[0]:sp[1]].lower()))
        # 長度適中（6～12 個字）的句子優先，其次依 id 讓結果固定
        cands.sort(key=lambda c: (abs(len(c[0]['en'].split()) - 9), c[0]['id']))
        # 依實際出現的詞形分組輪流挑（booked 多半是「預訂」、books 多半是「書」），讓不同詞義都有候選句
        buckets = {}
        for pr, form in cands:
            buckets.setdefault(form, []).append(pr)
        seen, picked = set(), []
        while len(picked) < per_word and any(buckets.values()):
            for form in list(buckets):
                if not buckets[form]:
                    continue
                c = buckets[form].pop(0)
                if c['en'].lower() in seen:
                    continue
                seen.add(c['en'].lower())
                picked.append(c)
                if len(picked) >= per_word:
                    break
        meaning = ' / '.join(f"{g['l']}:{g['m'][:60]}" for g in (entry or {}).get('m', []) if 'd' not in g)
        lines.append(f'## {k} | {meaning or "（詞典無條目）"} | 共 {len(cands)} 句')
        for c in picked:
            lines.append(f"  t:{c['id']} {c['en']} ⟶ {c['zh']}")
    Path(out_path).write_text('\n'.join(lines), encoding='utf-8')
    print(f'{len(lines)} 行，{sum(1 for l in lines if l.startswith("##"))} 個字')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 12)
