"""把 tools/senses/*.json（詞義分項與例句分配）轉成 App 用的 dict/s/<shard>.json，並做品質檢查。

用法：python tools/build_senses.py <pairs.tsv>
（pairs.tsv 由 tools/tatoeba_pairs.py 產生）

tools/senses/*.json 格式：
{
  "book": [
    {"p": "n", "zh": "書；書籍", "t": [12345, 67890], "ai": [["英文例句", "中文翻譯"]]},
    {"p": "v", "zh": "預訂", "t": [...], "fix": {"12345": "修訂後的中文翻譯"}, "src": "app"}
  ]
}
- p：詞性（n v adj adv prep conj pron phr int num aux）
- zh：這個詞義的繁體中文解釋（依 ECDICT 詞義整理）
- t：Tatoeba 英文例句 id（已人工確認屬於這個詞義）
- ai：Tatoeba 找不到足夠例句時的 AI 補充例句，App 會標示「AI 生成」
- fix：Tatoeba 中文翻譯不夠忠實或不是台灣用語時的修訂版，App 會標示「翻譯經修訂」
- src: "app"：ECDICT 沒有這個詞義、由 App 補充（例如 red-eye 的「夜間航班」）

檢查（以詞義為單位）：
 1. 每個詞義的例句數（2～3 句為達標）
 2. 每句都有繁體中文翻譯（含中文字）
 3. 目標字（含詞形變化、片語）確實出現在英文例句中，並記錄位置供高亮
 4. 詞性屬於 ECDICT 列出的詞性（App 補充的詞義除外）
 5. 同一個字的不同詞義之間沒有重複例句
 6. Tatoeba 例句保留 id、作者、翻譯者（資料裡保留以符合授權，App 不逐句顯示）；AI 例句標示來源
 7. 名詞、動詞詞義的文法標記（tools/grammar/*.tsv：C／U／CU、vt／vi／vit），沒標到的會列出數量
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from build_topics import ROOT, norm, resolve, shard_of
from examples_lib import find_span, load_pairs, word_forms
from grammar_tasks import load_labels

POS_LABEL = {'n': 'noun', 'v': 'verb', 'adj': '形容詞', 'adv': '副詞', 'prep': '介系詞', 'conj': '連接詞',
             'pron': '代名詞', 'phr': '片語', 'int': '感嘆詞', 'num': '數詞', 'aux': '助動詞', 'art': '冠詞'}
CJK = re.compile(r'[一-鿿]')
TRAD_ONLY_BAD = re.compile(r'[们这个说时会来为对过还没么样]')  # 常見簡體字，出現代表沒轉換好


def main(pairs_path, only=None):
    """only：只檢查這一個檔案，不寫出任何資料（給平行作業的各批次自行驗證用）"""
    sys.stdout.reconfigure(encoding='utf-8')
    pairs = load_pairs(pairs_path)
    labels = load_labels()
    src = {}
    files = sorted((ROOT / 'tools' / 'senses').glob('*.json'))
    if only:
        target = Path(only).resolve()
        others = set()
        for p in files:
            if p.resolve() != target:
                others.update(json.loads(p.read_text(encoding='utf-8')).keys())
        src = json.loads(target.read_text(encoding='utf-8'))
        dup = [w for w in src if w in others]
        if dup:
            print(f'⚠️ 這些字已經在其他檔案做過，請從本檔刪除：{", ".join(dup)}')
    else:
        for p in files:
            for w, senses in json.loads(p.read_text(encoding='utf-8')).items():
                if w in src:
                    print(f'⚠️ {w} 在多個檔案出現，使用 {p.name} 的版本')
                src[w] = senses

    errors, warns = [], []
    shards = defaultdict(dict)
    stats = {'words': 0, 'words_with_ex': 0, 'senses': 0, 'ok': 0, 'one': 0, 'zero': 0, 'tatoeba': 0, 'ai': 0, 'revised': 0, 'no_g': 0}
    for w, senses in src.items():
        key, entry = resolve(w)
        key = key or norm(w)
        forms = word_forms(w)
        ecdict_pos = {g['p'] for g in (entry or {}).get('m', [])}
        seen_en = {}
        out = []
        stats['words'] += 1
        has_ex = False
        for i, s in enumerate(senses):
            where = f'{w} 詞義{i + 1}（{s.get("zh", "")}）'
            p = s.get('p')
            if p not in POS_LABEL:
                errors.append(f'{where}：詞性 {p} 不正確')
                continue
            if not s.get('zh') or not CJK.search(s['zh']):
                errors.append(f'{where}：缺少中文解釋')
            # ECDICT 沒標詞性（other）時無法比對，略過
            if entry and s.get('src') != 'app' and p != 'phr' and p not in ecdict_pos and ecdict_pos - {'other'}:
                warns.append(f'{where}：詞性 {POS_LABEL[p]} 不在 ECDICT 列出的詞性 {sorted(ecdict_pos)} 中')
            ex = []
            fixes = {str(k): v for k, v in (s.get('fix') or {}).items()}
            for tid in s.get('t', []):
                pr = pairs.get(str(tid))
                if not pr:
                    errors.append(f'{where}：找不到 Tatoeba 例句 {tid}')
                    continue
                zh = fixes.get(str(tid), pr['zh'])
                item = {'en': pr['en'], 'zh': zh, 's': 't', 'id': pr['id'], 'by': pr['by'], 'zid': pr['zid'], 'zby': pr['zby']}
                if str(tid) in fixes:
                    item['rev'] = 1
                ex.append(item)
            for pair in s.get('ai', []):
                if len(pair) != 2:
                    errors.append(f'{where}：AI 例句格式錯誤 {pair}')
                    continue
                ex.append({'en': pair[0], 'zh': pair[1], 's': 'ai'})
            for e in ex:
                span = find_span(e['en'], forms)
                if not span:
                    errors.append(f'{where}：例句裡找不到目標字「{w}」：{e["en"]}')
                    continue
                e['sp'] = span
                if not CJK.search(e['zh']):
                    errors.append(f'{where}：例句沒有中文翻譯：{e["en"]}')
                if TRAD_ONLY_BAD.search(e['zh']):
                    warns.append(f'{where}：翻譯可能含簡體字：{e["zh"]}')
                low = e['en'].lower().strip()
                if low in seen_en:
                    errors.append(f'{where}：例句和「{seen_en[low]}」重複：{e["en"]}')
                seen_en[low] = s['zh']
            ex = [e for e in ex if 'sp' in e]
            n = len(ex)
            stats['senses'] += 1
            stats['ok' if n >= 2 else 'one' if n == 1 else 'zero'] += 1
            stats['tatoeba'] += sum(e['s'] == 't' for e in ex)
            stats['ai'] += sum(e['s'] == 'ai' for e in ex)
            stats['revised'] += sum(e.get('rev', 0) for e in ex)
            if n < 2:
                warns.append(f'{where}：只有 {n} 句例句')
            has_ex = has_ex or n > 0
            sense = {'p': p, 'l': POS_LABEL[p], 'zh': s['zh'], 'ex': ex}
            if s.get('src') == 'app':
                sense['src'] = 'app'
            if p in ('n', 'v'):
                g = labels.get((w, p, s['zh']))
                if g:
                    sense['g'] = g
                else:
                    stats['no_g'] += 1
            out.append(sense)
        stats['words_with_ex'] += has_ex
        shards[shard_of(key)][key] = out

    if only:
        if errors:
            print('❌ 發現錯誤：')
            for e in errors:
                print('  -', e)
        print(f"{'❌' if errors else '✅'} 本檔 {stats['words']} 個字、{stats['senses']} 個詞義；"
              f"2 句以上 {stats['ok']}、只有 1 句 {stats['one']}、沒有例句 {stats['zero']}；"
              f"Tatoeba {stats['tatoeba']} 句、AI {stats['ai']} 句")
        for w in warns:
            print('  ⚠️', w)
        sys.exit(1 if errors else 0)

    # 主題詞彙是否都有逐義例句
    topics = json.loads((ROOT / 'dict' / 'topics.json').read_text(encoding='utf-8'))
    no_senses = [k for k in topics['byWord'] if not any(k in s for s in shards.values())]
    stats['topic_words'] = len(topics['byWord'])
    stats['topic_words_missing'] = len(no_senses)
    counts = [len(s['ex']) for shard in shards.values() for senses in shard.values() for s in senses]
    stats['ex_2_3'] = sum(2 <= c <= 3 for c in counts)
    stats['ex_4_plus'] = sum(c >= 4 for c in counts)
    if no_senses:
        warns.append(f'主題詞彙中有 {len(no_senses)} 個字還沒有逐義例句：{", ".join(no_senses[:30])}')

    if errors:
        print('❌ 發現錯誤：')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    d = ROOT / 'dict' / 's'
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob('*.json'):
        old.unlink()
    for s, data in shards.items():
        (d / f'{s}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (ROOT / 'dict' / 'senses-stats.json').write_text(json.dumps(stats, ensure_ascii=False), encoding='utf-8')
    print(f"✅ {stats['words']} 個字、{stats['senses']} 個詞義；"
          f"2 句以上 {stats['ok']}、只有 1 句 {stats['one']}、沒有例句 {stats['zero']}；"
          f"真人例句（Tatoeba）{stats['tatoeba']} 句（翻譯經修訂 {stats['revised']}）、AI 補充 {stats['ai']} 句")
    print(f"   每義 2～3 句：{stats['ex_2_3']}、4 句以上：{stats['ex_4_plus']}；"
          f"主題詞彙 {stats['topic_words']} 個，缺逐義例句 {stats['topic_words_missing']} 個")
    print(f"   名詞／動詞詞義缺文法標記（可數、及物）：{stats['no_g']} 個")
    if warns:
        print(f'⚠️ {len(warns)} 個提醒：')
        for w in warns:
            print('  -', w)


if __name__ == '__main__':
    # python tools/build_senses.py <pairs.tsv> [--only tools/senses/某批次.json]
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    main(sys.argv[1], only)
