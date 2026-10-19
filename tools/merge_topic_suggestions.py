"""把 tools/topic_suggestions/*.json（批次作業建議的「字 → 情境主題分組」）合併進 tools/topics.json。

用法：python tools/merge_topic_suggestions.py [--dry-run]

建議格式：{"invoice": [["orders", 1, "請款單、發票"]]}
- 主題 id 或分組編號不存在、該主題已經有這個字、中文空白：略過並列出
- 每個主題最多新增 25 個字，避免情境主題被稀釋成一般字表
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'topics.json'
MAX_PER_TOPIC = 25


def main(dry_run=False):
    sys.stdout.reconfigure(encoding='utf-8')
    src = json.loads(SRC.read_text(encoding='utf-8'))
    topics = src['topics']
    added, skipped = Counter(), []
    for p in sorted((ROOT / 'tools' / 'topic_suggestions').glob('*.json')):
        for word, sugg in json.loads(p.read_text(encoding='utf-8')).items():
            for item in sugg[:2]:
                if len(item) != 3:
                    skipped.append(f'{p.name} {word}：格式錯誤 {item}')
                    continue
                tid, idx, gloss = item
                t = topics.get(tid)
                if not t or not isinstance(idx, int) or not 0 <= idx < len(t['sections']):
                    skipped.append(f'{p.name} {word}：主題或分組不存在 {tid}/{idx}')
                    continue
                if not str(gloss).strip():
                    skipped.append(f'{p.name} {word}：沒有中文')
                    continue
                have = {w.lower() for s in t['sections'] for w, _ in s[2]}
                if word.lower() in have:
                    continue
                if added[tid] >= MAX_PER_TOPIC:
                    skipped.append(f'{p.name} {word}：{tid} 已達每主題新增上限')
                    continue
                t['sections'][idx][2].append([word, str(gloss).strip()])
                added[tid] += 1
    print(f'新增 {sum(added.values())} 個主題關聯，分布在 {len(added)} 個主題；略過 {len(skipped)} 個')
    for s in skipped[:40]:
        print('  -', s)
    if not dry_run:
        SRC.write_text(json.dumps(src, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main('--dry-run' in sys.argv)
