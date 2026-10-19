"""把多益核心詞彙表（tools/core_lists.json）切成學習單元，產生 tools/core_units.json。

用法：python tools/build_core_units.py
（build_topics.py 會把 core_units.json 一起合併進 dict/topics.json）

- 每個字只放在一個單元：優先順序 TSL（多益專用）> BSL（商務）> NGSL（一般核心）> NAWL（學術）
- 單元內依詞頻排序後每 60 字一個單元，單元內再依詞性分組
- 中文意思優先取 tools/senses 已整理好的第一個詞義；還沒整理的字才用 ECDICT 的主要釋義
  （ECDICT 偶爾把罕見古義排在最前面，例如 teen 的「憤怒、悲哀」）
"""
import json
import re
import sys

from build_topics import ROOT, norm, resolve


def load_first_senses():
    first = {}
    for p in sorted((ROOT / 'tools' / 'senses').glob('*.json')):
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
        except ValueError:
            print(f'⚠️ {p.name} 不是合法 JSON，略過')
            continue
        for w, senses in data.items():
            if senses:
                first.setdefault(norm(w), senses[0])
    return first

UNIT = 60
LISTS = [
    ('TSL', 'tsl', '多益必考字', 'TOEIC Service List', '多益試題中特別常見、一般英文較少見的字（TSL）'),
    ('BSL', 'bsl', '商務英文字', 'Business Service List', '商業書信、報告、新聞常見的字（BSL）'),
    ('NGSL', 'ngsl', '核心英文字', 'New General Service List', '涵蓋日常英文約九成的核心字（NGSL）'),
    ('NAWL', 'nawl', '學術英文字', 'New Academic Word List', '報告、研究、正式文件常見的字（NAWL）'),
]
POS_GROUP = [('n', 'noun', ''), ('v', 'vi./vt.', ''), ('adj', '形容詞與副詞', 'Adjectives & Adverbs'), ('other', '其他', 'Others')]


def short_meaning(entry):
    g = next((x for x in entry['m'] if not x.get('d')), entry['m'][0])
    first = re.split(r'[；;]', g['m'])[0]
    return '、'.join(s.strip() for s in re.split(r'[,，]', first)[:3] if s.strip())


def pos_group(entry):
    p = next((x['p'] for x in entry['m'] if not x.get('d')), 'other')
    return {'n': 'n', 'v': 'v', 'adj': 'adj', 'adv': 'adj'}.get(p, 'other')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    core = json.loads((ROOT / 'tools' / 'core_lists.json').read_text(encoding='utf-8'))
    senses = load_first_senses()
    order = [l[0] for l in LISTS]
    primary = {}
    for w, v in core.items():
        first = min(v['lists'], key=order.index)
        primary.setdefault(first, []).append((v['rank'][first], w))

    topics, cat_topics = {}, []
    for code, slug, zh, en, desc in LISTS:
        words = [w for _, w in sorted(primary.get(code, []))]
        for i in range(0, len(words), UNIT):
            chunk = words[i:i + UNIT]
            n = i // UNIT + 1
            groups = {g[0]: [] for g in POS_GROUP}
            for w in chunk:
                key, entry = resolve(w)
                if not entry:
                    continue
                s = senses.get(key) or senses.get(norm(w))
                if s:
                    gloss = re.split(r'[；;]', s['zh'])[0].strip()
                    group = {'n': 'n', 'v': 'v', 'adj': 'adj', 'adv': 'adj'}.get(s['p'], 'other')
                else:
                    gloss, group = short_meaning(entry), pos_group(entry)
                groups[group].append([entry['w'], gloss])
            sections = [[gzh, gen, groups[gk]] for gk, gzh, gen in POS_GROUP if groups[gk]]
            tid = f'{slug}-{n:02d}'
            topics[tid] = {
                'zh': f'{zh} 第 {n} 單元', 'en': f'{en} · Unit {n}', 'level': '依詞頻',
                'intro': f'{desc}，依常見程度排第 {i + 1}～{i + len(chunk)} 個。',
                'group': f'{zh}（{code}）', 'auto': True, 'sections': sections,
            }
            cat_topics.append(tid)
    out = {'categories': [{
        'id': 'core', 'zh': '多益核心字彙', 'en': 'TOEIC Core Vocabulary',
        'desc': '依 TSL、BSL、NGSL、NAWL 開放詞彙表（CC BY-SA 4.0）整理，涵蓋多益 850～990 分所需的字彙；依常見程度分成學習單元。',
        'topics': cat_topics,
    }], 'topics': topics}
    (ROOT / 'tools' / 'core_units.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(cat_topics)} 個單元，{sum(len(s[2]) for t in topics.values() for s in t["sections"])} 個字')


if __name__ == '__main__':
    main()
