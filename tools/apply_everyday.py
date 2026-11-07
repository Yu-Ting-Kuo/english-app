"""把日常用法修正（tools/everyday/*.tsv）套進 dict/w/ 的詞條。可重複執行；重新跑 build_dict.py 後要再跑一次。

用法：python tools/apply_everyday.py，之後再跑 python tools/build_zh_index.py

tools/everyday/*.tsv 每行：字<TAB>詞性<TAB>繁體中文<TAB>英文解釋（可空）
- 有修正的字：修正的詞義取代原本全部詞義。ECDICT 的專業領域標籤對日常字常常標錯（pick on［法律］、newbie［電腦］），
  審過的字不再保留這些領域詞義
- 沒有修正、又只有專業領域詞義的變化形（例如 crawling 只有化學術語）：自動補上原形的意思
"""
import json
import re
import sys

from build_topics import ROOT

LABEL = {'n': 'noun', 'v': 'v.', 'adj': '形容詞', 'adv': '副詞', 'prep': '介系詞', 'conj': '連接詞',
         'pron': '代名詞', 'int': '感嘆詞', 'phr': '片語'}
HAN = re.compile(r'[一-鿿]')


def load_fixes(entries):
    fixes, errors = {}, []
    for p in sorted((ROOT / 'tools' / 'everyday').glob('*.tsv')):
        for n, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
            if not line.strip():
                continue
            parts = line.split('\t')
            where = f'{p.name}:{n}'
            if len(parts) not in (3, 4):
                errors.append(f'{where} 欄位數不對：{line}')
                continue
            key, pos, zh = parts[:3]
            en = parts[3].strip() if len(parts) == 4 else ''
            if key not in entries:
                errors.append(f'{where} 詞典沒有這個字：{key}')
            elif pos not in LABEL:
                errors.append(f'{where} 詞性不對：{pos}')
            elif not HAN.search(zh):
                errors.append(f'{where} 沒有中文：{line}')
            elif HAN.search(en):
                errors.append(f'{where} 英文解釋有中文：{line}')
            else:
                sense = {'p': pos, 'l': LABEL[pos], 'm': zh.strip(), 'v': 1}
                if en:
                    sense['en'] = en
                fixes.setdefault(key, []).append(sense)
    return fixes, errors


def lemma_gloss(entry):
    g = next((x for x in entry['m'] if not x.get('d')), None)
    if not g:
        return None, None
    first = re.split(r'[；;]', g['m'])[0]
    return g, '、'.join(s.strip() for s in re.split(r'[,，]', first)[:3] if s.strip())


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    shards = {p: json.loads(p.read_text(encoding='utf-8')) for p in sorted((ROOT / 'dict' / 'w').glob('*.json'))}
    entries = {k: e for d in shards.values() for k, e in d['e'].items()}
    forms = {k: v for d in shards.values() for k, v in d.get('f', {}).items()}
    fixes, errors = load_fixes(entries)
    if errors:
        print('\n'.join(errors[:40]))
        sys.exit(f'❌ {len(errors)} 個錯誤')
    for e in entries.values():  # 先拿掉上次套用的結果，修正內容改了也能重跑
        e['m'] = [g for g in e['m'] if not g.get('v')]
    for key, senses in fixes.items():
        e = entries[key]
        e['m'] = senses
    auto = 0
    for key, lemmas in forms.items():
        e = entries.get(key)
        if not e or key in fixes or not e['m'] or not all(g.get('d') for g in e['m']):
            continue
        lemma, labels = next(iter(lemmas.items()))
        base = entries.get(lemma)
        if not base:
            continue
        g, gloss = lemma_gloss(base)
        if not gloss:
            continue
        e['m'].insert(0, {'p': g['p'], 'l': g['l'], 'm': f'{gloss}（{lemma} 的{"、".join(labels)}）', 'v': 1})
        auto += 1
    for p, d in shards.items():
        p.write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'✅ 修正 {len(fixes)} 個字（{sum(map(len, fixes.values()))} 個詞義）、變化形自動補原形意思 {auto} 個、'
          f'有英文解釋 {sum(1 for s in fixes.values() for x in s if x.get("en"))} 個詞義')


if __name__ == '__main__':
    main()
