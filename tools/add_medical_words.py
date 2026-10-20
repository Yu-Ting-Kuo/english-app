"""把 tools/medical_words.txt（288 字）補進 tools/topics.json 的「醫療與保險」主題。可重複執行。
已在主題裡的字保留原本的中文意思，只補缺的字，依第一個詞性放進新增的分組。
用法：python tools/add_medical_words.py，之後再跑 python tools/build_topics.py
"""
import json
import re
import sys

from build_topics import ROOT, norm, resolve

SRC = ROOT / 'tools' / 'topics.json'
WORDS = ROOT / 'tools' / 'medical_words.txt'
GROUPS = [('n', '醫療名詞補充', 'More Medical Nouns'), ('v', '醫療動詞補充', 'More Medical Verbs'),
          ('adj', '形容詞與副詞補充', 'More Adjectives & Adverbs')]


def ident(w):
    return resolve(w)[0] or norm(w)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    d = json.loads(SRC.read_text(encoding='utf-8'))
    t = d['topics']['medical']
    t['sections'] = [s for s in t['sections'] if s[0] not in {g[1] for g in GROUPS}]
    have = {ident(w) for s in t['sections'] for w, _ in s[2]}
    before = len(have)
    new = {k: [] for k, _, _ in GROUPS}
    for line in WORDS.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\d+\.\s+(.+?)\s+\(([^)]*)\)\s+—\s+(.*)', line)
        if not m:
            sys.exit(f'無法解析：{line}')
        word, pos, gloss = m.group(1), m.group(2).split(',')[0].strip().rstrip('.'), m.group(3)
        if ident(word) in have:
            continue
        have.add(ident(word))
        new['v' if pos in ('vt', 'vi') else 'adj' if pos in ('adj', 'adv') else 'n'].append([word, gloss])
    for key, zh, en in GROUPS:
        if new[key]:
            t['sections'].append([zh, en, new[key]])
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'原有 {before} 字；補上', {k: len(v) for k, v in new.items()}, '共', sum(len(s[2]) for s in t['sections']))


if __name__ == '__main__':
    main()
