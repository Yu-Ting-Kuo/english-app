"""檢查一個情境主題檔（tools/topics_v2/<id>.json）。

用法：python tools/check_topic_file.py tools/topics_v2/workplace.json

主題檔格式：
{"id": "workplace", "zh": "辦公室", "en": "Workplace", "intro": "一句話介紹",
 "sections": [["分組中文", "Group English", [["word", "在這個情境的中文意思"], ...]], ...]}

檢查：
- 3～6 個分組、全部 80～150 個字、主題內沒有重複
- 每個字都查得到詞典條目（或是某個詞條的變化形）
- 中文意思有中文字
- 基礎字（詞頻前 2,000 名）不超過 12%
- 列出還沒有逐義例句的字（之後要補例句）與 TOEIC 600／750／900 的分布
"""
import json
import re
import sys
from pathlib import Path

from build_topics import load_senses, norm, rank_of, resolve, toeic_level

CJK = re.compile(r'[一-鿿]')


def main(path):
    sys.stdout.reconfigure(encoding='utf-8')
    errors, warns = [], []
    t = json.loads(Path(path).read_text(encoding='utf-8'))
    for k in ('id', 'zh', 'en', 'intro', 'sections'):
        if not t.get(k):
            errors.append(f'缺少欄位 {k}')
    secs = t.get('sections') or []
    if not 3 <= len(secs) <= 6:
        errors.append(f'分組數 {len(secs)}，應為 3～6 個')
    senses = load_senses()
    seen, basic, new, levels = {}, [], [], {'600': 0, '750': 0, '900': 0}
    total = 0
    for sec in secs:
        if len(sec) != 3 or not CJK.search(sec[0]) or not sec[1]:
            errors.append(f'分組格式錯誤：{sec[:2]}')
            continue
        for item in sec[2]:
            if len(item) != 2:
                errors.append(f'{sec[0]}：格式錯誤 {item}')
                continue
            w, g = item
            total += 1
            key, entry = resolve(w)
            ident = key or norm(w)
            if ident in seen:
                errors.append(f'「{w}」在「{seen[ident]}」和「{sec[0]}」重複')
            seen[ident] = sec[0]
            if not entry:
                # 詞典沒有獨立條目的片語（maternity leave）可以收，App 會顯示主題意思和逐義例句；但組成的單字都要查得到
                parts = [x for x in re.split(r'[\s-]+', w) if x]
                if len(parts) > 1 and all(resolve(x)[1] for x in parts):
                    new.append(w)
                    levels[toeic_level(rank_of(w, None))] += 1
                    if not CJK.search(g or ''):
                        errors.append(f'「{w}」缺少中文意思')
                    continue
                errors.append(f'詞典查不到「{w}」，請換一個字或改用常見寫法')
                continue
            if not CJK.search(g or ''):
                errors.append(f'「{w}」缺少中文意思')
            r = rank_of(w, entry)
            levels[toeic_level(r)] += 1
            if r and r <= 2000:
                basic.append(f'{w}({r})')
            if not (senses.get(norm(w)) or senses.get(key)):
                new.append(w)
    if not 80 <= total <= 150:
        errors.append(f'共 {total} 個字，應為 80～150 個')
    if total and len(basic) > total * 0.12:
        errors.append(f'基礎字（詞頻前 2,000）有 {len(basic)} 個，超過 12%：{", ".join(basic)}')
    elif basic:
        warns.append(f'基礎字 {len(basic)} 個（上限 12%）：{", ".join(basic)}')
    print(f'{t.get("id")}：{len(secs)} 組、{total} 個字；TOEIC 600 {levels["600"]}、750 {levels["750"]}、900 {levels["900"]}；'
          f'還沒有逐義例句 {len(new)} 個')
    if new:
        print('  需要補例句：' + ', '.join(new))
    for w in warns:
        print('⚠️', w)
    if errors:
        print('❌ 發現錯誤：')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    print('✅ 通過')


if __name__ == '__main__':
    main(sys.argv[1])
