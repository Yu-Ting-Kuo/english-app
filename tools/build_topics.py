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


LEVELS = ('B', 'I', 'A')  # 情境主題：初階／中階／進階；不顯示分數
CORE_LEVELS = ('B', 'I', 'A')  # 原多益核心單元保留原難度分級
LEVEL_NAMES = {'B': '初階', 'I': '中階', 'A': '進階'}


def level_of(rank):
    if rank and rank <= 2500:
        return 'B'
    if rank and rank <= 8000:
        return 'I'
    return 'A'


def topic_level(rank):
    """情境主題依詞頻分為初階、中階、進階；前兩級對應原詞頻級距。"""
    if rank and rank <= 4000:
        return 'B'
    if rank and rank <= 10000:
        return 'I'
    return 'A'


def rank_of(word, entry):
    """詞頻排名（BNC／COCA 取較常見者）。片語沒有排名時，用組成單字裡最少見的那個。"""
    if entry and entry.get('f'):
        return entry['f']
    parts = [p for p in re.split(r'[\s-]+', norm(word)) if p]
    if len(parts) > 1:
        ranks = []
        for p in parts:
            _, e = resolve(p)
            ranks.append(e.get('f') if e and e.get('f') else None)
        if all(ranks):
            return max(ranks)
    return None


# 單字列表用的英文詞性標示：名詞 noun[C]／noun[U]、動詞 vt.／vi.，其他 adj.、adv.…
POS_ABBR = {'adj': 'adj.', 'adv': 'adv.', 'prep': 'prep.', 'conj': 'conj.', 'pron': 'pron.', 'phr': 'phr.',
            'int': 'int.', 'num': 'num.', 'aux': 'aux.', 'art': 'art.', 'abbr': 'abbr.'}
GRAM = {'C': 'noun[C]', 'U': 'noun[U]', 'CU': 'noun[C/U]', 'vt': 'vt.', 'vi': 'vi.', 'vit': 'vi./vt.'}


def load_senses():
    """{字（小寫）: [詞義]}，詞義含 p、zh、g（文法標記，來自 tools/grammar）"""
    from grammar_tasks import load_labels
    labels = load_labels()
    out = {}
    for p in sorted((ROOT / 'tools' / 'senses').glob('*.json')):
        for w, senses in json.loads(p.read_text(encoding='utf-8')).items():
            out.setdefault(norm(w), [dict(s, g=labels.get((w, s.get('p'), s.get('zh')))) for s in senses])
    return out


def pos_of(word, key, gloss, entry, senses):
    """找出主題中文意思對應的詞義，回傳英文詞性標示"""
    ss = senses.get(norm(word)) or senses.get(key or '') or []
    if ss:
        chars = set(re.sub(r'[^一-鿿]', '', gloss))
        best = max(ss, key=lambda s: len(chars & set(s.get('zh', ''))) / (len(chars) or 1))
        if not chars & set(best.get('zh', '')):
            best = ss[0]
        p, g = best.get('p'), best.get('g')
        if p in ('n', 'v'):
            return GRAM.get(g) or ('noun' if p == 'n' else 'vi./vt.')
        return POS_ABBR.get(p, '')
    for m in (entry or {}).get('m', []):
        if m.get('d') or m['p'] == 'other':
            continue
        if m['p'] == 'n':
            return 'noun'
        if m['p'] == 'v':
            return m['l'] if m['l'] in ('vt.', 'vi.') else 'vi./vt.'
        return POS_ABBR.get(m['p'], '')
    return ''


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    src = json.loads(SRC.read_text(encoding='utf-8'))
    senses = load_senses()
    # 多益核心字彙單元（tools/build_core_units.py 產生）
    core_units = ROOT / 'tools' / 'core_units.json'
    if core_units.exists():
        extra = json.loads(core_units.read_text(encoding='utf-8'))
        src['categories'] += extra['categories']
        src['topics'].update(extra['topics'])
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
                ps = pos_of(word, key, gloss, entry, senses)
                if ps:
                    item['ps'] = ps
                r = rank_of(word, entry)
                if r:
                    item['r'] = r
                override = t.get('levelOverrides', {}).get(norm(word))
                if override and override not in LEVELS:
                    errors.append(f'{tid}：「{word}」的難度標示 {override} 無效')
                item['lv'] = override or (level_of(r) if t.get('auto') else topic_level(r))
                if key:
                    item['k'] = key
                    if key != norm(word):
                        item['via'] = key  # 例如 dishes → dish
                else:
                    missing.append(f'{tid}：{word}')
                if tid not in by_word[ident]:
                    by_word[ident].append(tid)
                words.append(item)
            sections.append({'zh': zh, 'en': en, 'words': words})
        topic_levels = CORE_LEVELS if t.get('auto') else LEVELS
        levels = {lv: sum(w['lv'] == lv for s in sections for w in s['words']) for lv in topic_levels}
        # 情境主題要求三種難度都有；核心字彙單元是依詞頻切的、功能詞幾乎都是初階（fewLevels），不檢查
        for lv in topic_levels:
            if not t.get('auto') and not t.get('fewLevels') and levels[lv] < 3:
                errors.append(f'{tid}：{LEVEL_NAMES[lv]}只有 {levels[lv]} 個字，每個主題每種難度至少要 3 個')
        topics[tid] = {'zh': t['zh'], 'en': t['en'], 'level': t['level'], 'intro': t['intro'],
                       'cat': owner.get(tid), 'count': len(seen), 'levels': levels, 'sections': sections}
        if t.get('source'):
            topics[tid]['source'] = t['source']
        for k in ('group', 'auto'):
            if k in t:
                topics[tid][k] = t[k]

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
