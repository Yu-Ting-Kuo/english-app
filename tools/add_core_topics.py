"""把只出現在多益核心字彙的字分進主題（tools/core_topics.tsv：字<TAB>主題 id）。可重複執行。
- 分到既有主題的字，放進該主題最後的「多益核心補充」分組
- 分到 daily／quantity／actions／concepts／function 的字，建成「日常與基礎字彙」分類下的新主題，依詞性分組
- 這些字仍保留在「多益核心字彙」A–Z 單字本裡
中文意思沿用核心字彙單元（tools/core_units.json）整理好的主要詞義。
用法：python tools/build_core_units.py && python tools/add_core_topics.py，之後再跑 python tools/build_topics.py
"""
import json
import sys

from build_topics import ROOT, load_senses, norm, resolve

SRC = ROOT / 'tools' / 'topics.json'
CLASSES = ROOT / 'tools' / 'core_topics.tsv'
EXTRA = ('多益核心補充', 'TOEIC Core Additions')
# 人工複核後的修正
FIXES = {'lover': 'social', 'pet': 'daily', 'pig': 'environment', 'rose': 'environment', 'pesticide': 'environment',
         'fellow': 'social', 'accent': 'education', 'transport': 'transport', 'damn': 'emotions'}
NEW = {
    'daily': ('日常生活與家居', 'Daily Life & Home', '家裡的東西、衣物、顏色與日常場所等生活中最常用到的具體名詞。'),
    'quantity': ('時間、數量與程度', 'Time, Quantity & Degree', '時間、日期、數字、多寡、大小、頻率與程度的說法。'),
    'actions': ('常用動作與狀態', 'Common Actions & States', '不限場合都常用的動詞與狀態，例如 keep、become、happen。'),
    'concepts': ('抽象概念與描述', 'Abstract Ideas & Description', '抽象名詞與一般描述用的形容詞、副詞，例如 aspect、reason、clear。'),
    'function': ('基礎功能詞', 'Function Words', '冠詞、代名詞、介系詞、連接詞、助動詞等組句子用的基本字。'),
}
POS = [('n', '名詞', 'Nouns'), ('v', '動詞', 'Verbs'), ('adj', '形容詞', 'Adjectives'), ('adv', '副詞', 'Adverbs'),
       ('other', '其他詞類', 'Other Word Classes')]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    core = json.loads((ROOT / 'tools' / 'core_units.json').read_text(encoding='utf-8'))
    gloss = {w: g for t in core['topics'].values() for s in t['sections'] for w, g in s[2]}
    senses = load_senses()
    d = json.loads(SRC.read_text(encoding='utf-8'))
    for t in d['topics'].values():
        t['sections'] = [s for s in t['sections'] if s[0] != EXTRA[0]]
    for tid in NEW:
        d['topics'].pop(tid, None)
    d['categories'] = [c for c in d['categories'] if c['id'] != 'basic']
    have = {resolve(w)[0] or norm(w) for t in d['topics'].values() for s in t['sections'] for w, _ in s[2]}
    themed, new = {}, {tid: {k: [] for k, *_ in POS} for tid in NEW}
    for line in CLASSES.read_text(encoding='utf-8').splitlines():
        word, tid = line.split('\t')
        tid = FIXES.get(word, tid)
        if (resolve(word)[0] or norm(word)) in have:
            continue
        item = [word, gloss[word]]
        if tid in NEW:
            ss = senses.get(norm(word)) or senses.get(resolve(word)[0] or '') or []
            p = ss[0]['p'] if ss else 'other'
            new[tid][p if p in new[tid] else 'other'].append(item)
        elif tid in d['topics']:
            themed.setdefault(tid, []).append(item)
        else:
            sys.exit(f'{word}：主題 {tid} 不存在')
    for tid, items in themed.items():
        d['topics'][tid]['sections'].append([*EXTRA, sorted(items, key=lambda x: x[0].lower())])
    for tid, (zh, en, intro) in NEW.items():
        d['topics'][tid] = {'zh': zh, 'en': en, 'level': '初階・中階・進階', 'intro': intro,
                            'sections': [[pz, pe, sorted(new[tid][k], key=lambda x: x[0].lower())]
                                         for k, pz, pe in POS if new[tid][k]]}
        if tid == 'function':
            d['topics'][tid]['fewLevels'] = True
    d['categories'].append({'id': 'basic', 'zh': '日常與基礎字彙', 'en': 'Everyday & Basic Words',
                            'desc': '日常生活、時間數量、常用動作、抽象概念與功能詞等不限場合都會用到的字。',
                            'topics': list(NEW)})
    # 多益核心字彙固定排在最後
    d['categories'].sort(key=lambda c: c['id'] == 'core')
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('既有主題補充', {k: len(v) for k, v in themed.items()})
    print('新主題', {k: sum(map(len, v.values())) for k, v in new.items()})


if __name__ == '__main__':
    main()
