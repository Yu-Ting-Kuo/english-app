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
    # 詞典列的變化形常不完整，一律再依規則補上（只用來比對例句，例句本身仍經人工確認）
    if head.replace('-', '').isalpha():  # 也包含 binge-watch 這類連字號的字
        heads.update({head + 's', head + 'es', head + 'ed', head + 'd', head + 'ing'})
        if head.endswith('e'):
            heads.add(head[:-1] + 'ing')
        if head.endswith('y') and len(head) > 2 and head[-2] not in 'aeiou':
            heads.update({head[:-1] + 'ies', head[:-1] + 'ied'})
        if len(head) > 2 and head[-1] not in 'aeiouwxy' and head[-2] in 'aeiou' and head[-3] not in 'aeiou':
            heads.update({head + head[-1] + 'ed', head + head[-1] + 'ing'})
    rest = ' '.join(parts[1:])
    forms = {f'{h} {rest}'.strip() for h in heads if h}
    # 名詞片語的最後一個字也可能是複數：guided tours、boarding passes
    if len(parts) > 1 and parts[-1].isalpha():
        base = ' '.join(parts[:-1])
        forms.update({f'{base} {parts[-1]}s', f'{base} {parts[-1]}es'})
    # 有連字號的字也接受空格或連在一起的寫法：carry-on / carry on
    for f in list(forms):
        if '-' in f:
            forms.update({f.replace('-', ' '), f.replace('-', '')})
    return sorted(forms, key=len, reverse=True)


PARTICLES = {'up', 'down', 'in', 'out', 'on', 'off', 'back', 'through', 'over', 'away', 'around'}


def _form_pattern(f):
    parts = re.split(r'\s+', f)
    # 可分片語動詞：call (me) back、put (you) through，中間最多夾兩個字
    if len(parts) == 2 and parts[1] in PARTICLES:
        return re.escape(parts[0]) + r"(?:\s+[A-Za-z'’]+){0,2}?\s+" + re.escape(parts[1])
    return r'\s+'.join(re.escape(p) for p in parts)


def form_regex(forms):
    alts = '|'.join(_form_pattern(f) for f in forms)
    return re.compile(rf"(?<![A-Za-z'’-])({alts})(?![A-Za-z-])", re.I)


def find_span(text, forms):
    m = form_regex(forms).search(text)
    return [m.start(), m.end()] if m else None
