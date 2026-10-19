"""Build an offline Chinese-to-English reverse index from dict/w/*.json."""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
DICT_DIR = ROOT / "dict" / "w"
OUT = ROOT / "dict" / "zh-index.json"
HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
# Taiwan-localized display meanings for common terms where the source gloss is
# awkward or uses wording uncommon in Taiwan.
ZH_LOCALIZED_MEANINGS = {
    "razor": ["刮鬍刀"],
    "shaver": ["電動刮鬍刀"],
}
# Useful Taiwan terms absent from the source dictionary.
ZH_EXTRA_ENTRIES = {
    "power bank": ("行動電源", "noun"),
}


def main() -> None:
    simplified = OpenCC("t2s")
    entries: list[tuple[int, str, str, str, str]] = []
    for path in sorted(DICT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for key, entry in data.get("e", {}).items():
            meanings = []
            labels = []
            for sense in entry.get("m", []):
                if sense.get("d"):
                    continue
                meaning = str(sense.get("m") or "").strip()
                if meaning and HAN.search(meaning) and meaning not in meanings:
                    meanings.append(meaning)
                    label = str(sense.get("l") or "").strip()
                    if label and label not in labels:
                        labels.append(label)
            if key in ZH_LOCALIZED_MEANINGS:
                meanings = ZH_LOCALIZED_MEANINGS[key].copy()
            if meanings:
                rank = int(entry.get("f") or 0)
                entries.append((rank or 10**9, key, "；".join(meanings), "／".join(labels), ""))

    existing = {key for _, key, _, _, _ in entries}
    for key, (meaning, pos) in ZH_EXTRA_ENTRIES.items():
        if key not in existing:
            entries.append((10**9, key, meaning, pos, ""))

    entries.sort(key=lambda row: (row[0], row[1]))
    postings: dict[str, set[int]] = defaultdict(set)
    words = []
    for index, (rank, key, meaning, pos, _) in enumerate(entries):
        simple_meaning = simplified.convert(meaning)
        words.append([key, meaning, rank if rank < 10**9 else 0, pos, simple_meaning if simple_meaning != meaning else ""])
        for variant in {meaning, simple_meaning}:
            for text in HAN.findall(variant):
                for offset in range(len(text) - 1):
                    postings[text[offset:offset + 2]].add(index)

    value = {
        "v": 1,
        "words": words,
        "grams": {gram: sorted(ids) for gram, ids in sorted(postings.items())},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"中文反查索引：{len(words):,} 個詞條、{len(postings):,} 個雙字索引，{OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
