"""整理 tools/senses/*.json：移除在較早檔案已經出現過的字，並統一排版（每個詞義一行）。

用法：python tools/senses_tidy.py <要整理的檔名>
"""
import json
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent / 'senses'


def dump(data):
    lines = ['{']
    items = list(data.items())
    for i, (word, senses) in enumerate(items):
        lines.append(f'  {json.dumps(word, ensure_ascii=False)}: [')
        for j, s in enumerate(senses):
            lines.append('    ' + json.dumps(s, ensure_ascii=False) + (',' if j < len(senses) - 1 else ''))
        lines.append('  ]' + (',' if i < len(items) - 1 else ''))
    lines.append('}')
    return '\n'.join(lines) + '\n'


def main(name):
    sys.stdout.reconfigure(encoding='utf-8')
    target = DIR / name
    seen = set()
    for p in sorted(DIR.glob('*.json')):
        if p.name != name:
            seen.update(json.loads(p.read_text(encoding='utf-8')).keys())
    data = json.loads(target.read_text(encoding='utf-8'))
    dupes = [w for w in data if w in seen]
    for w in dupes:
        del data[w]
    target.write_text(dump(data), encoding='utf-8')
    print(f'移除重複 {len(dupes)} 個：{", ".join(dupes)}；剩 {len(data)} 個字')


if __name__ == '__main__':
    main(sys.argv[1])
