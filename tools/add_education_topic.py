"""把 tools/education_words.txt（262 字）補進 tools/topics.json 的「教育與校園」主題。可重複執行。
已在主題裡的字保留原本的中文意思，只補缺的字，依詞性放進新增的分組。
用法：python tools/add_education_topic.py，之後再跑 python tools/build_topics.py
"""
import json
import re
import sys

from build_topics import ROOT, norm, resolve

SRC = ROOT / 'tools' / 'topics.json'
WORDS = ROOT / 'tools' / 'education_words.txt'
FIX = {'examination/exam': ('examination', '考試（縮寫 exam）')}
GROUPS = [('n', '教育名詞', 'Education Nouns'), ('v', '教育動詞', 'Education Verbs'),
          ('adj', '形容詞與副詞', 'Adjectives & Adverbs')]


def ident(w):
    return resolve(w)[0] or norm(w)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    d = json.loads(SRC.read_text(encoding='utf-8'))
    t = d['topics']['education']
    t['sections'] = [s for s in t['sections'] if s[0] not in {g[1] for g in GROUPS}]
    have = {ident(w) for s in t['sections'] for w, _ in s[2]}
    new = {k: [] for k, _, _ in GROUPS}
    for line in WORDS.read_text(encoding='utf-8').splitlines():
        m = re.match(r'(\d+)\.\s+(\S+)\s+\(([^)]*)\)\s*(.*)', line)
        if not m:
            sys.exit(f'無法解析：{line}')
        word, pos, gloss = m.group(2), re.split(r'\s*/\s*', m.group(3))[0].rstrip('.'), m.group(4)
        if word in FIX:
            word, gloss = FIX[word]
        if ident(word) in have:
            continue
        have.add(ident(word))
        new['adj' if pos in ('adv', 'adj') else pos].append([word, gloss])
    for key, zh, en in GROUPS:
        if new[key]:
            t['sections'].append([zh, en, new[key]])
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('OK', {k: len(v) for k, v in new.items()}, '共', sum(len(s[2]) for s in t['sections']))


if __name__ == '__main__':
    main()
