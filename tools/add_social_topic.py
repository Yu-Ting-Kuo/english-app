"""把 tools/social_words.txt（468 字）建成 tools/topics.json 的「社交與人際」主題。可重複執行。
中文意思取自逐義例句（tools/senses/*.json）的前兩個詞義，分組依第一個詞義的詞性。
原「學術與社會議題」裡的「社會與文化」主題併入這裡（分組原樣保留，存在 tools/society_sections.json）。
用法：python tools/add_social_topic.py，之後再跑 python tools/build_topics.py
"""
import json
import sys

from build_topics import ROOT, load_senses, norm, resolve

SRC = ROOT / 'tools' / 'topics.json'
WORDS = ROOT / 'tools' / 'social_words.txt'
SOCIETY = ROOT / 'tools' / 'society_sections.json'
PROPER = {'Christianity': '基督教', 'Buddhism': '佛教'}
GROUPS = [('n', '人物與社交名詞', 'People & Social Nouns'), ('v', '社交動詞', 'Social Verbs'),
          ('adj', '形容詞', 'Adjectives'), ('adv', '副詞與其他', 'Adverbs & Others')]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    senses = load_senses()
    groups = {k: [] for k, _, _ in GROUPS}
    missing = []
    for line in WORDS.read_text(encoding='utf-8').splitlines():
        word, *alts = line.strip().split('/')
        if word in PROPER:
            groups['n'].append([word, PROPER[word]])
            continue
        ss = senses.get(norm(word)) or senses.get(resolve(word)[0] or '') or []
        if not ss:
            missing.append(word)
            continue
        gloss = '；'.join(s['zh'] for s in ss[:2])
        if alts:
            gloss += f'（也作 {alts[0]}）'
        p = ss[0]['p']
        groups['v' if p == 'phr' else p if p in groups else 'adv'].append([word, gloss])
    if missing:
        sys.exit(f'這些字還沒有詞義資料：{missing}')
    d = json.loads(SRC.read_text(encoding='utf-8'))
    old = d['topics'].pop('society', None)
    if old:
        SOCIETY.write_text(json.dumps({'source': old.get('source'), 'levelOverrides': old.get('levelOverrides', {}), 'sections': old['sections']},
                                      ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    for c in d['categories']:
        if 'society' in c['topics']:
            c['topics'].remove('society')
            c['desc'] = '校園學習、研究方法與環境議題等常見學術情境。'
    society = json.loads(SOCIETY.read_text(encoding='utf-8'))
    have = {resolve(w)[0] or norm(w) for g in groups.values() for w, _ in g}
    extra = [[zh, en, [x for x in items if (resolve(x[0])[0] or norm(x[0])) not in have]]
             for zh, en, items in society['sections']]
    d['topics']['social'] = {'zh': '社交與人際', 'en': 'Social Life & Relationships', 'level': '初階・中階・進階',
                             'intro': '家人朋友、聚會禮儀、人際互動與社會議題的常用詞彙，從 friend、wedding 到 etiquette、hypocrisy。',
                             'source': society['source'], 'levelOverrides': society['levelOverrides'],
                             'sections': [[zh, en, groups[k]] for k, zh, en in GROUPS if groups[k]] + extra}
    d['categories'] = [c for c in d['categories'] if c['id'] != 'social']
    d['categories'].append({'id': 'social', 'zh': '社交與人際', 'en': 'Social Life & Relationships',
                            'desc': '家庭、朋友、聚會禮儀與人際互動的常用詞彙。', 'topics': ['social']})
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('OK', {k: len(v) for k, v in groups.items()}, '原社會與文化', [len(x[2]) for x in extra])


if __name__ == '__main__':
    main()
