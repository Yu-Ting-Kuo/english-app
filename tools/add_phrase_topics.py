"""把常用片語名單（tools/phrase_list.json）建成 tools/phrase_topics.json（「常用片語」大分類，build_topics.py 會合併在多益核心字彙之後）。
名單每項：[類型, 片語, 中文意思, 難度, 分組]；類型 phrasal／fixed／coll／idiom。可重複執行。
用法：python tools/add_phrase_topics.py，之後再跑 python tools/build_topics.py
"""
import json
import sys
from collections import OrderedDict

from build_topics import ROOT

LIST = ROOT / 'tools' / 'phrase_list.json'
OUT = ROOT / 'tools' / 'phrase_topics.json'
TOPICS = OrderedDict([
    ('phrasal', ('片語動詞', 'Phrasal Verbs', '動詞加副詞或介系詞組成的片語，意思常和單字本身不同，如 give up、look after、come up with。')),
    ('fixed', ('介系詞與連接片語', 'Prepositional & Linking Phrases', '表達時間、原因、對比、程度的固定片語，如 in advance、according to、as well as。')),
    ('coll', ('動詞搭配', 'Verb Collocations', '常用動詞搭配名詞或形容詞的固定說法，如 make a decision、take place、get used to。')),
    ('idiom', ('慣用語與口語', 'Idioms & Everyday Expressions', '母語人士日常真的會說的慣用語與口語表達，如 piece of cake、break the ice、no big deal。')),
])
GROUP_EN = {'時間與順序': 'Time & Sequence', '原因與結果': 'Cause & Result', '對比與讓步': 'Contrast & Concession',
            '數量與程度': 'Quantity & Degree', '地點與方式': 'Place & Manner', '介系詞搭配': 'Preposition Phrases',
            '連接與口語副詞': 'Linking & Spoken Adverbs', '日常口語': 'Everyday Speech', '情緒與態度': 'Feelings & Attitude',
            '金錢與工作': 'Money & Work', '人際與生活': 'People & Life', '動物與自然': 'Animals & Nature',
            '其他慣用語': 'Other Idioms'}
IDS = {'phrasal': 'phrasal-verbs', 'fixed': 'linking-phrases', 'coll': 'collocations', 'idiom': 'idioms'}  # 主題 id（頁面標題會顯示）


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    rows = json.loads(LIST.read_text(encoding='utf-8'))
    topics = {}
    for tid, (zh, en, intro) in TOPICS.items():
        items = [r for r in rows if r[0] == tid]
        groups = OrderedDict()
        for r in items:
            groups.setdefault(r[4], []).append(r)
        if tid in ('phrasal', 'coll'):
            # 以動詞分組；片語數量多的動詞排前面，其他放最後
            # 片語少於 5 個的動詞併入「其他動詞」，避免出現一堆只有一兩個片語的小分組
            small = [k for k in groups if k != 'other' and len(groups[k]) < 5]
            if small:
                groups.setdefault('other', [])
                for k in small:
                    groups['other'].extend(groups.pop(k))
            if tid == 'phrasal' and len(groups.get('other', [])) > 60:
                # 其他動詞太多，依動詞開頭字母分成幾段
                rest = groups.pop('other')
                for lo, hi in (('a', 'c'), ('d', 'g'), ('h', 'l'), ('m', 'r'), ('s', 'z')):
                    part = [r for r in rest if lo <= r[1][0] <= hi]
                    if part:
                        groups[f'其他動詞 {lo.upper()}–{hi.upper()}'] = part
            keys = sorted(groups, key=lambda k: (k.startswith('其他') or k == 'other', k))
            sections = [[(k + ' 系列') if k.isascii() and k != 'other' else (k if k != 'other' else '其他動詞'), k.replace('其他動詞', 'Other Verbs') if k != 'other' else 'Other Verbs',
                         [[r[1], r[2]] for r in groups[k]]] for k in keys]
        else:
            sections = [[k, GROUP_EN.get(k, k), [[r[1], r[2]] for r in groups[k]]] for k in groups]
        overrides = {r[1].lower(): r[3] for r in items}
        topics[IDS[tid]] = {'zh': zh, 'en': en, 'level': '初階・中階・進階', 'intro': intro, 'fewLevels': True,
                       'levelOverrides': overrides, 'sections': sections}
    cat = {'id': 'phrases', 'zh': '常用片語', 'en': 'Common Phrases',
           'desc': '片語動詞、固定搭配與慣用語。這些說法的意思不能逐字翻譯，必須整組記。', 'topics': [IDS[t] for t in TOPICS]}
    OUT.write_text(json.dumps({'categories': [cat], 'topics': topics}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'✅ {len(rows)} 個片語、{len(topics)} 個主題')


if __name__ == '__main__':
    main()
