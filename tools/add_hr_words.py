"""把 tools/hr_words.txt（131 字）補進 tools/topics.json 的「人事管理」主題。可重複執行。
已在主題裡的字保留原本的中文意思，只補缺的字，依詞性放進新增的分組；
清單沒附中文的字，取逐義例句（tools/senses/*.json）的前兩個詞義。
用法：python tools/add_hr_words.py，之後再跑 python tools/build_topics.py
"""
import json
import re
import sys

from build_topics import ROOT, load_senses, norm, resolve

SRC = ROOT / 'tools' / 'topics.json'
WORDS = ROOT / 'tools' / 'hr_words.txt'
GROUPS = [('n', '人事名詞補充', 'More HR Nouns'), ('v', '人事動詞補充', 'More HR Verbs'),
          ('adj', '形容詞與副詞補充', 'More Adjectives & Adverbs')]


def ident(w):
    return resolve(w)[0] or norm(w)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    senses = load_senses()
    d = json.loads(SRC.read_text(encoding='utf-8'))
    t = d['topics']['hr']
    t['sections'] = [s for s in t['sections'] if s[0] not in {g[1] for g in GROUPS}]
    have = {ident(w) for s in t['sections'] for w, _ in s[2]}
    before = len(have)
    new = {k: [] for k, _, _ in GROUPS}
    for line in WORDS.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\d+\.\s+(.+?)(?:\s+\(([^)]*)\)\s*(.*))?$', line.strip())
        word, pos, gloss = m.group(1), m.group(2), m.group(3)
        if ident(word) in have:
            continue
        have.add(ident(word))
        if pos:
            pos = pos.split('/')[0].strip().rstrip('.')
        else:
            ss = senses.get(norm(word)) or senses.get(ident(word)) or []
            if not ss:
                sys.exit(f'{word} 沒有中文意思，也還沒有詞義資料')
            gloss, pos = '；'.join(s['zh'] for s in ss[:2]), ss[0]['p']
        new['v' if pos in ('v', 'vt', 'vi') else 'adj' if pos in ('adj', 'adv') else 'n'].append([word, gloss])
    for key, zh, en in GROUPS:
        if new[key]:
            t['sections'].append([zh, en, new[key]])
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'原有 {before} 字；補上', {k: len(v) for k, v in new.items()}, '共', sum(len(s[2]) for s in t['sections']))


if __name__ == '__main__':
    main()
