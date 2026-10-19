"""把 tools/emotions_words.txt（459 字）加進 tools/topics.json 的「情緒與感覺」主題。可重複執行。
用法：python tools/add_emotions_topic.py，之後再跑 python tools/build_topics.py
"""
import json
import re
import sys

from build_topics import ROOT

SRC = ROOT / 'tools' / 'topics.json'
WORDS = ROOT / 'tools' / 'emotions_words.txt'
FIX = {'vigor/vigour': ('vigor', '精力（英式拼法 vigour）'), 'appal': ('appal', '使驚駭（= appall）')}
GROUPS = [('adj', '形容詞與感嘆詞', 'Adjectives & Interjections'), ('n', '名詞', 'Nouns'),
          ('v', '動詞', 'Verbs'), ('adv', '副詞', 'Adverbs')]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    rows = []
    for line in WORDS.read_text(encoding='utf-8').splitlines():
        m = re.match(r'(\d+)\.\s+(\S+)\s+\(([^)]*)\)\s*(.*)', line)
        if not m:
            sys.exit(f'無法解析：{line}')
        word, pos, gloss = m.group(2), m.group(3).split('/')[0].strip().rstrip('.'), m.group(4)
        if word in FIX:
            word, gloss = FIX[word][0], FIX[word][1] if word == 'vigor/vigour' else re.sub(r'^\(=appall\)', '', gloss) + '（= appall）'
        rows.append((word, pos, gloss))
    sections = []
    for key, zh, en in GROUPS:
        items = [[w, g] for w, p, g in rows if (p == key or (key == 'adj' and p == 'interj'))]
        sections.append([zh, en, items])
    assert sum(len(s[2]) for s in sections) == len(rows) == 459
    d = json.loads(SRC.read_text(encoding='utf-8'))
    d['topics']['emotions'] = {'zh': '情緒與感覺', 'en': 'Emotions & Feelings', 'level': '初階・中階・進階',
                               'intro': '喜怒哀樂、性格與感受的形容詞、名詞、動詞和副詞，從 happy、angry 到 melancholy、indignant。',
                               'sections': sections}
    d['categories'] = [c for c in d['categories'] if c['id'] != 'emotion']
    d['categories'].append({'id': 'emotion', 'zh': '情緒與感覺', 'en': 'Emotions & Feelings',
                            'desc': '表達心情、感受與個性的常用詞彙。', 'topics': ['emotions']})
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('OK', [len(s[2]) for s in sections])


if __name__ == '__main__':
    main()
