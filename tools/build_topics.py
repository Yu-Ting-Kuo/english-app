"""檢查主題詞彙表並產生 dict/topics.json。

用法：python tools/build_topics.py
（需要先用 build_dict.py 產生 dict/w/）

檢查項目：
- 每個主題都屬於一個大分類，大分類裡列的主題都存在
- 同一個主題裡沒有重複的字
- 每個字都在詞典裡（或是某個詞條的變化形）；找不到的會列出來，並在 App 裡標示
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'topics.json'
OUT = ROOT / 'dict' / 'topics.json'


def norm(s):
    return re.sub(r'\s+', ' ', s.replace('’', "'")).strip().lower()


def shard_of(key):
    s = re.sub(r'[^a-z]', '', key)[:2]
    return (s + '_')[:2] if s else '__'


_shards = {}


def shard(key):
    s = shard_of(key)
    if s not in _shards:
        p = ROOT / 'dict' / 'w' / f'{s}.json'
        _shards[s] = json.loads(p.read_text(encoding='utf-8')) if p.exists() else {'e': {}, 'f': {}}
    return _shards[s]


def resolve(word):
    """回傳 (詞典 key, 詞條) 或 (None, None)"""
    k = norm(word)
    for cand in (k, k.replace('-', ' '), k.replace(' ', '-'), k.replace('-', '')):
        e = shard(cand)['e'].get(cand)
        if e:
            return cand, e
    lemmas = shard(k)['f'].get(k)
    if lemmas:
        lemma = next(iter(lemmas))
        return lemma, shard(lemma)['e'].get(lemma)
    return None, None


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    src = json.loads(SRC.read_text(encoding='utf-8'))
    errors, missing = [], []
    owner = {}
    for c in src['categories']:
        for t in c['topics']:
            if t not in src['topics']:
                errors.append(f'大分類 {c["id"]} 裡的主題 {t} 不存在')
            if t in owner:
                errors.append(f'主題 {t} 同時屬於 {owner[t]} 和 {c["id"]}')
            owner[t] = c['id']
    for t in src['topics']:
        if t not in owner:
            errors.append(f'主題 {t} 沒有放進任何大分類')

    topics = {}
    by_word = defaultdict(list)
    for tid, t in src['topics'].items():
        seen = {}
        sections = []
        for zh, en, items in t['sections']:
            words = []
            for word, gloss in items:
                key, entry = resolve(word)
                ident = key or norm(word)
                if ident in seen:
                    errors.append(f'{tid}：「{word}」在「{seen[ident]}」和「{zh}」重複出現')
                    continue
                seen[ident] = zh
                item = {'w': word, 'g': gloss}
                if key:
                    item['k'] = key
                    if entry.get('f'):
                        item['r'] = entry['f']
                    if key != norm(word):
                        item['via'] = key  # 例如 dishes → dish
                else:
                    missing.append(f'{tid}：{word}')
                if tid not in by_word[ident]:
                    by_word[ident].append(tid)
                words.append(item)
            sections.append({'zh': zh, 'en': en, 'words': words})
        topics[tid] = {'zh': t['zh'], 'en': t['en'], 'level': t['level'], 'intro': t['intro'],
                       'cat': owner.get(tid), 'count': len(seen), 'sections': sections}

    cats = [{**c, 'count': len({w for t in c['topics'] for s in topics[t]['sections'] for w in
                                [x.get('k') or norm(x['w']) for x in s['words']]})} for c in src['categories']]
    if errors:
        print('❌ 發現錯誤：')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    OUT.write_text(json.dumps({'categories': cats, 'topics': topics, 'byWord': by_word},
                              ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    total = len(by_word)
    links = sum(len(v) for v in by_word.values())
    print(f'✅ {len(cats)} 大分類、{len(topics)} 個主題、{total} 個不重複的字（{links} 個主題關聯）')
    if missing:
        print(f'⚠️ 詞典裡找不到 {len(missing)} 個（App 會標示「詞典暫無完整條目」）：')
        for m in missing:
            print('  -', m)


if __name__ == '__main__':
    main()
