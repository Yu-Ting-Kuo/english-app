"""把 tools/topics_v2/<id>.json（各個多益情境主題）組合成 tools/topics.json。

用法：python tools/assemble_topics.py
之後再跑 python tools/build_topics.py 產生 App 用的 dict/topics.json。
（多益核心字彙單元另外由 build_core_units.py 產生，build_topics.py 會一起合併）
"""
import json
import sys

from build_topics import ROOT

CATEGORIES = [
    ('office', '職場與辦公', 'Workplace & Office', '辦公室日常、商業書信、會議與人事，多益 Part 3、4、7 最常出現的職場情境。',
     ['workplace', 'mailing', 'meeting', 'hr']),
    ('commerce', '商業與財經', 'Business & Finance', '業務拓展、生產銷售、國際貿易與財務報表的專業詞彙。',
     ['business', 'sale', 'trade', 'financial']),
    ('tech', '科技與工程', 'Technology & Engineering', '資訊科技、電腦工程與營建工地的常用術語。',
     ['technology', 'engineering', 'building']),
    ('services', '生活與服務', 'Services & Daily Business', '交通運輸、醫療保險、租屋置產、購物與餐飲娛樂等服務業情境。',
     ['transport', 'medical', 'housing', 'shopping', 'restaurant']),
]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    topics, cats = {}, []
    for cid, zh, en, desc, ids in CATEGORIES:
        have = []
        for tid in ids:
            p = ROOT / 'tools' / 'topics_v2' / f'{tid}.json'
            if not p.exists():
                print(f'⚠️ 缺少主題檔 {p.name}，略過')
                continue
            t = json.loads(p.read_text(encoding='utf-8'))
            topics[tid] = {'zh': t['zh'], 'en': t['en'], 'level': '初階・中階・進階', 'intro': t['intro'], 'sections': t['sections']}
            have.append(tid)
        cats.append({'id': cid, 'zh': zh, 'en': en, 'desc': desc, 'topics': have})
    out = {'categories': cats, 'topics': topics}
    (ROOT / 'tools' / 'topics.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    n = sum(len(s[2]) for t in topics.values() for s in t['sections'])
    print(f'{len(cats)} 大分類、{len(topics)} 個主題、{n} 個主題單字')


if __name__ == '__main__':
    main()
