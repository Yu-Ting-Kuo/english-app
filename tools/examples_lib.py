"""例句工具共用函式：讀取 Tatoeba 配對表、產生詞形、在句子中找出目標字的位置。"""
import csv
import re

from build_topics import norm, resolve

csv.field_size_limit(10**7)


def load_pairs(path):
    """回傳 {eng_id: {id, en, by, zid, zh, zby}}；同一句英文有多個中文翻譯時保留第一個。"""
    pairs = {}
    with open(path, encoding='utf-8', newline='') as f:
        for row in csv.reader(f, delimiter='\t'):
            if len(row) < 6 or row[0] in pairs:
                continue
            pairs[row[0]] = {'id': int(row[0]), 'en': row[1], 'by': row[2], 'zid': int(row[3]), 'zh': row[4], 'zby': row[5]}
    return pairs


def word_forms(word):
    """目標字的所有形式（原形與詞形變化）。片語只變化第一個字，例如 check in → checked in。"""
    parts = norm(word).split(' ')
    head = parts[0]
    _, entry = resolve(head)
    heads = {head}
    if entry:
        for k, v in (entry.get('x') or {}).items():
            if k in 'pdi3srt':
                heads.update(norm(f) for f in v.split(','))
    # 規則變化補強（詞典沒有列出時）
    if len(parts) == 1 and not entry:
        heads.update({head + 's', head + 'es', head + 'ed', head + 'ing'})
    rest = ' '.join(parts[1:])
    forms = {f'{h} {rest}'.strip() for h in heads if h}
    # 有連字號的字也接受空格或連在一起的寫法：carry-on / carry on
    for f in list(forms):
        if '-' in f:
            forms.update({f.replace('-', ' '), f.replace('-', '')})
    return sorted(forms, key=len, reverse=True)


def form_regex(forms):
    alts = '|'.join(r'\s+'.join(re.escape(p) for p in re.split(r'\s+', f)) for f in forms)
    return re.compile(rf"(?<![A-Za-z'’-])({alts})(?![A-Za-z-])", re.I)


def find_span(text, forms):
    m = form_regex(forms).search(text)
    return [m.start(), m.end()] if m else None
