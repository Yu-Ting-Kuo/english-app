"""把多益核心詞彙表（tools/core_lists.json）整理成一個 A–Z 單元，產生 tools/core_units.json。

用法：python tools/build_core_units.py
（build_topics.py 會把 core_units.json 一起合併進 dict/topics.json）

- 四份詞彙表合併成一個單元，同一個字只出現一次，依字母排序並以開頭字母分組（App 以單字本 A–Z 呈現）
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

LISTS = [
    ('TSL', 'tsl', '多益必考字', 'TOEIC Service List', '多益試題中特別常見、一般英文較少見的字（TSL）'),
    ('BSL', 'bsl', '商務英文字', 'Business Service List', '商業書信、報告、新聞常見的字（BSL）'),
    ('NGSL', 'ngsl', '核心英文字', 'New General Service List', '涵蓋日常英文約九成的核心字（NGSL）'),
    ('NAWL', 'nawl', '學術英文字', 'New Academic Word List', '報告、研究、正式文件常見的字（NAWL）'),
]


def short_meaning(entry):
    g = next((x for x in entry['m'] if not x.get('d')), entry['m'][0])
    first = re.split(r'[；;]', g['m'])[0]
    return '、'.join(s.strip() for s in re.split(r'[,，]', first)[:3] if s.strip())


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    core = json.loads((ROOT / 'tools' / 'core_lists.json').read_text(encoding='utf-8'))
    senses = load_first_senses()
    order = [l[0] for l in LISTS]
    primary = {}
    for w, v in core.items():
        first = min(v['lists'], key=order.index)
        primary.setdefault(first, []).append((v['rank'][first], w))

    letters = {}
    for code, *_ in LISTS:
        for _, w in sorted(primary.get(code, [])):
            key, entry = resolve(w)
            if not entry:
                continue
            s = senses.get(key) or senses.get(norm(w))
            gloss = re.split(r'[；;]', s['zh'])[0].strip() if s else short_meaning(entry)
            letter = (re.search(r'[a-z]', entry['w'].lower()) or re.search('.', '#')).group(0).upper()
            letters.setdefault(letter, []).append([entry['w'], gloss])
    sections = [[l, l, sorted(ws, key=lambda x: (re.sub(r'[^a-z0-9]', '', x[0].lower()), x[0]))] for l, ws in sorted(letters.items())]
    topics = {'core': {
        'zh': '多益核心字彙 A–Z', 'en': 'TOEIC Core Vocabulary A–Z', 'level': '依詞頻',
        'intro': 'TSL、BSL、NGSL、NAWL 四份詞彙表合併成一本單字本，依字母 A–Z 排列。',
        'auto': True, 'sections': sections,
    }}
    cat_topics = ['core']
    out = {'categories': [{
        'id': 'core', 'zh': '多益核心字彙', 'en': 'TOEIC Core Vocabulary',
        'desc': '依 TSL、BSL、NGSL、NAWL 開放詞彙表（CC BY-SA 4.0）整理，涵蓋多益 850～990 分所需的字彙；以單字本 A–Z 排列。',
        'topics': cat_topics,
    }], 'topics': topics}
    (ROOT / 'tools' / 'core_units.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(sections)} 個字母，{sum(len(s[2]) for t in topics.values() for s in t["sections"])} 個字')


if __name__ == '__main__':
    main()
