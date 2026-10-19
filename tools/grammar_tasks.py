"""列出還沒標「可數／不可數」「及物／不及物」的名詞與動詞詞義，切成待標記的工作檔。

用法：python tools/grammar_tasks.py <輸出資料夾> [每檔行數，預設 600]

標記結果放在 tools/grammar/*.tsv，每行：字<TAB>詞性<TAB>中文詞義<TAB>標記
- 名詞：C（可數）、U（不可數）、CU（兩者都常用）
- 動詞：vt（及物）、vi（不及物）、vit（兩者都常用）
build_senses.py 會讀這些檔案，把標記放進詞義資料（欄位 g）。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALID = {'n': {'C', 'U', 'CU'}, 'v': {'vt', 'vi', 'vit'}}


def load_labels():
    """回傳 {(字, 詞性, 中文詞義): 標記}"""
    labels = {}
    for p in sorted((ROOT / 'tools' / 'grammar').glob('*.tsv')):
        for line in p.read_text(encoding='utf-8').splitlines():
            parts = line.split('\t')
            if len(parts) == 4 and parts[3] in VALID.get(parts[1], ()):
                labels[tuple(parts[:3])] = parts[3]
    return labels


def main(out_dir, size=600):
    sys.stdout.reconfigure(encoding='utf-8')
    labels = load_labels()
    rows = []
    for p in sorted((ROOT / 'tools' / 'senses').glob('*.json')):
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
        except ValueError:
            print(f'⚠️ {p.name} 不是合法 JSON，略過')
            continue
        for w, senses in data.items():
            for s in senses:
                if s.get('p') not in VALID or (w, s['p'], s['zh']) in labels:
                    continue
                ex = (s.get('ai') or [['']])[0][0]
                rows.append('\t'.join([w, s['p'], s['zh'], ex.replace('\t', ' ')]))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('g*.tsv'):
        old.unlink()
    for i in range(0, len(rows), size):
        (out / f'g{i // size + 1:02d}.tsv').write_text('\n'.join(rows[i:i + size]) + '\n', encoding='utf-8')
    print(f'已標記 {len(labels)} 個；待標記 {len(rows)} 個，切成 {-(-len(rows) // size)} 個檔案')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 600)
