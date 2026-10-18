"""把 ECDICT（MIT 授權）轉成 App 用的繁體中文分片詞典。

用法：
    pip install opencc
    python tools/build_dict.py <ECDICT 資料夾>

<ECDICT 資料夾> 需要有 ecdict.csv、lemma.en.txt、resemble.txt
（來源：https://github.com/skywind3000/ECDICT）。
輸出到 dict/：
    dict/w/<shard>.json   詞條與詞形對照，<shard> 是單字前兩個字母
    dict/i/<letter>.json  搜尋建議用的字表（依常見程度排序）
    dict/resemble.json    易混淆單字辨析
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import opencc

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dict'
cc = opencc.OpenCC('s2twp')  # 簡體 → 台灣繁體與用語

# ECDICT 詞性縮寫 → (統一代號, 顯示名稱)
POS = {
    'n': ('n', '名詞'), 'v': ('v', '動詞'), 'vt': ('v', '動詞'), 'vi': ('v', '動詞'),
    'a': ('adj', '形容詞'), 'adj': ('adj', '形容詞'), 'ad': ('adv', '副詞'), 'adv': ('adv', '副詞'),
    'prep': ('prep', '介系詞'), 'conj': ('conj', '連接詞'), 'pron': ('pron', '代名詞'),
    'int': ('int', '感嘆詞'), 'interj': ('int', '感嘆詞'), 'art': ('art', '冠詞'),
    'num': ('num', '數詞'), 'aux': ('aux', '助動詞'), 'abbr': ('abbr', '縮寫'),
    'pl': ('n', '名詞'), 'phr': ('phr', '片語'),
}
POS_RE = re.compile(r'^(n|vt|vi|v|adj|a|adv|ad|prep|conj|pron|interj|int|art|num|aux|abbr|pl|phr)\.\s*', re.I)
DOMAIN_RE = re.compile(r'^\[([^\]]+)\]\s*')
KEEP_TAGS = {'toefl': 'TOEFL', 'ielts': 'IELTS', 'gre': 'GRE'}
# ECDICT 專業領域縮寫（轉成繁體後）→ 完整名稱
DOMAINS = {
    '計': '電腦', '醫': '醫學', '法': '法律', '經': '經濟', '化': '化學', '電': '電學', '機': '機械',
    '建': '建築', '礦': '礦業', '植': '植物', '動': '動物', '生': '生物', '地': '地理', '地質': '地質',
    '天': '天文', '數': '數學', '物': '物理', '農': '農業', '軍': '軍事', '宗': '宗教', '心': '心理',
    '語': '語言學', '律': '法律', '商': '商業', '海': '航海', '船': '船舶', '航': '航空', '交': '交通',
}


def key_of(word):
    return word.strip().lower()


def shard_of(key):
    s = re.sub(r'[^a-z]', '', key)[:2]
    return (s + '_')[:2] if s else '__'


def parse_translation(raw, is_phrase=False):
    """回傳 [{p: 詞性代號, l: 顯示名稱, m: 意思, d: 專業領域}]，同詞性合併。"""
    groups = {}
    order = []
    for line in raw.replace('\\n', '\n').split('\n'):
        line = line.strip()
        if not line:
            continue
        domain = None
        m = DOMAIN_RE.match(line)
        if m:
            domain = cc.convert(m.group(1))
            domain = DOMAINS.get(domain, domain)
            line = line[m.end():]
            if domain == '網路':  # 網路蒐集的譯名品質不穩，另外標示
                domain = '網路用法'
        pos, label = ('phr', '片語') if is_phrase else ('other', '其他')
        m = POS_RE.match(line)
        if m:
            pos, label = POS[m.group(1).lower()]
            line = line[m.end():]
        text = cc.convert(line.strip(' ;；,，'))
        if not text:
            continue
        gk = (pos, domain)
        if gk not in groups:
            groups[gk] = {'p': pos, 'l': label, 'm': []}
            if domain:
                groups[gk]['d'] = domain
            order.append(gk)
        groups[gk]['m'].append(text)
    out = []
    for gk in order:
        g = groups[gk]
        g['m'] = '；'.join(g['m'])
        out.append(g)
    # 一般詞義排前面，專業領域和網路用法排後面
    out.sort(key=lambda g: ('d' in g, g.get('d') == '網路用法'))
    return out


def parse_exchange(raw):
    x = {}
    for part in (raw or '').split('/'):
        if ':' in part:
            k, v = part.split(':', 1)
            if k in 'pdi3srt01' and v:
                x[k] = v
    return x


def rank_of(r):
    ranks = [int(r[k]) for k in ('frq', 'bnc') if (r[k] or '0').isdigit() and int(r[k]) > 0]
    return min(ranks) if ranks else 0


def main(src):
    src = Path(src)
    rows = {}
    with open(src / 'ecdict.csv', encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f):
            if r['translation'].strip():
                rows[key_of(r['word'])] = r

    common = {}
    for k, r in rows.items():
        rank = rank_of(r)
        if (0 < rank <= 60000) or r['oxford'] == '1' or r['tag'] or int(r['collins'] or 0) > 0:
            common[k] = r
    # 常用字組成的短片語（例如 figure out、look forward to）
    top = {k for k, r in common.items() if ' ' not in k and 0 < rank_of(r) <= 5000}
    for k, r in rows.items():
        if k in common or ' ' not in k:
            continue
        parts = k.split(' ')
        if 2 <= len(parts) <= 3 and all(p.isalpha() and p in top for p in parts):
            common[k] = r

    # 主題詞彙表用到的字一定收錄（例如 boarding pass、social media）
    topics_src = ROOT / 'tools' / 'topics.json'
    if topics_src.exists():
        for t in json.loads(topics_src.read_text(encoding='utf-8'))['topics'].values():
            for _, _, items in t['sections']:
                for word, _ in items:
                    k = key_of(word)
                    for cand in (k, k.replace('-', ' '), k.replace(' ', '-'), k.replace('-', '')):
                        if cand in rows:
                            common.setdefault(cand, rows[cand])
                            break

    # 詞形 → 原形
    forms = defaultdict(dict)
    labels = {'p': '過去式', 'd': '過去分詞', 'i': '現在分詞', '3': '第三人稱單數', 's': '複數', 'r': '比較級', 't': '最高級'}
    for k, r in common.items():
        for t, v in parse_exchange(r['exchange']).items():
            if t in labels:
                for form in v.split(','):
                    fk = key_of(form)
                    if fk and fk != k:
                        forms[fk].setdefault(k, [])
                        if labels[t] not in forms[fk][k]:
                            forms[fk][k].append(labels[t])
    with open(src / 'lemma.en.txt', encoding='utf-8') as f:
        for line in f:
            if '->' not in line or line.startswith(';'):
                continue
            head, rest = line.split('->', 1)
            lemma = key_of(head.split('/')[0])
            if lemma not in common:
                continue
            for form in rest.split(','):
                fk = key_of(form)
                if fk and fk != lemma and fk.isalpha():
                    forms[fk].setdefault(lemma, [])

    # 易混淆單字辨析
    groups = []
    member_of = defaultdict(list)
    block = None
    for line in open(src / 'resemble.txt', encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith('%'):
            block = {'w': [w.strip() for w in line[1:].split(',') if w.strip()], 'intro': '', 'items': []}
            groups.append(block)
        elif block is not None and line.startswith('- ') and ':' in line:
            w, text = line[2:].split(':', 1)
            block['items'].append([w.strip(), cc.convert(text.strip())])
        elif block is not None and line.strip():
            block['intro'] = cc.convert(line.strip())
    for gi, g in enumerate(groups):
        for w in g['w']:
            member_of[key_of(w)].append(gi)

    shards = defaultdict(lambda: {'e': {}, 'f': {}})
    index = defaultdict(list)
    for k, r in common.items():
        e = {'w': r['word'].strip(), 'm': parse_translation(r['translation'], ' ' in k)}
        if not e['m']:
            continue
        if r['phonetic'].strip():
            e['ph'] = r['phonetic'].strip()
        x = parse_exchange(r['exchange'])
        if x:
            e['x'] = x
        rank = rank_of(r)
        if rank:
            e['f'] = rank
        if int(r['collins'] or 0):
            e['c'] = int(r['collins'])
        if r['oxford'] == '1':
            e['o'] = 1
        tags = [KEEP_TAGS[t] for t in r['tag'].split() if t in KEEP_TAGS]
        if tags:
            e['t'] = tags
        if k in member_of:
            e['rs'] = member_of[k]
        shards[shard_of(k)]['e'][k] = e
        index[k[0] if k[0].isalpha() else '_'].append((rank or 10**6, k))
    for fk, lemmas in forms.items():
        shards[shard_of(fk)]['f'][fk] = lemmas

    (OUT / 'w').mkdir(parents=True, exist_ok=True)
    (OUT / 'i').mkdir(parents=True, exist_ok=True)
    for old in list((OUT / 'w').glob('*.json')) + list((OUT / 'i').glob('*.json')):
        old.unlink()
    for s, data in shards.items():
        with open(OUT / 'w' / f'{s}.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    for letter, items in index.items():
        items.sort()
        with open(OUT / 'i' / f'{letter}.json', 'w', encoding='utf-8') as f:
            json.dump([k for _, k in items], f, ensure_ascii=False, separators=(',', ':'))
    with open(OUT / 'resemble.json', 'w', encoding='utf-8') as f:
        json.dump(groups, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(p.stat().st_size for p in OUT.rglob('*.json'))
    print(f'詞條 {sum(len(s["e"]) for s in shards.values())}，詞形 {len(forms)}，'
          f'辨析 {len(groups)} 組，分片 {len(shards)} 個，共 {total / 1e6:.1f} MB')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main(sys.argv[1])
