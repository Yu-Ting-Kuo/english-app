#!/usr/bin/env python3
"""Build a compact offline synonym/antonym index from Princeton WordNet 3.0.

Requires the NLTK package and its WordNet corpus. Example:
  python -m nltk.downloader wordnet
  python tools/build_wordnet_relations.py dict/relations.json
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import nltk
from nltk.corpus import wordnet as wn


ROOT = Path(__file__).resolve().parents[1]
DICT_DIR = ROOT / "dict" / "w"
# WordNet treats the spelling "in" as an abbreviation for inch. That association
# is technically valid in its source but misleading in a learner-facing thesaurus.
SKIP_HEADWORD_SYNSETS = {("in", "inch.n.01")}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("_", " ").replace("-", " ")).strip().lower()


def ecdict_pos(shard: dict[str, object]) -> dict[str, set[str]]:
    """Map each ECDICT headword to the WordNet POS values it actually has."""
    out: dict[str, set[str]] = {}
    pos_map = {"n": {"n"}, "v": {"v"}, "adj": {"a", "s"}, "adv": {"r"}}
    for word, entry in shard.get("e", {}).items():
        found: set[str] = set()
        for meaning in entry.get("m", []):
            found.update(pos_map.get(meaning.get("p", ""), set()))
        # ECDICT labels prepositions as prep; WordNet stores many of these as adverbs.
        if any(m.get("p") == "prep" for m in entry.get("m", [])):
            found.add("r")
        if found:
            out[word] = found
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=ROOT / "dict" / "r")
    parser.add_argument("--nltk-data", type=Path, help="Path containing corpora/wordnet.zip or corpora/wordnet")
    args = parser.parse_args()
    if args.nltk_data:
        nltk.data.path.insert(0, str(args.nltk_data))

    vocabulary: set[str] = set()
    vocabulary_pos: dict[str, set[str]] = {}
    for path in DICT_DIR.glob("*.json"):
        shard = json.loads(path.read_text(encoding="utf-8"))
        vocabulary.update(shard.get("e", {}).keys())
        vocabulary_pos.update(ecdict_pos(shard))

    pos_names = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}
    relations: dict[str, list[dict[str, object]]] = {}
    for synset in wn.all_synsets():
        lemmas = synset.lemmas()
        pos = synset.pos()
        # Do not merge proper names/acronyms into lowercase headwords (e.g. IN → in).
        usable = [lemma for lemma in lemmas if lemma.name() == lemma.name().lower()]
        group_words = sorted({normalize(lemma.name()) for lemma in usable} & vocabulary)
        group_words = [word for word in group_words if pos in vocabulary_pos.get(word, set())]
        group_words = [word for word in group_words if (word, synset.name()) not in SKIP_HEADWORD_SYNSETS]
        if not group_words:
            continue
        synonyms = group_words
        antonyms = sorted({
            normalize(antonym.name())
            for lemma in usable
            for antonym in lemma.antonyms()
            if antonym.name() == antonym.name().lower()
            and normalize(antonym.name()) in vocabulary
            and pos in vocabulary_pos.get(normalize(antonym.name()), set())
        })
        if len(synonyms) < 2 and not antonyms:
            continue
        for headword in group_words:
            related_synonyms = [word for word in synonyms if word != headword]
            if not related_synonyms and not antonyms:
                continue
            relations.setdefault(headword, []).append({
                "p": pos_names.get(pos, ""),
                "g": synset.definition(),
                "s": related_synonyms,
                "a": antonyms,
            })

    overrides_path = Path(__file__).with_name("relations_overrides.json")
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}
    for headword, groups in overrides.items():
        if headword not in vocabulary:
            raise ValueError(f"Override headword is missing from ECDICT: {headword}")
        for group in groups:
            group["s"] = [word for word in group.get("s", []) if word in vocabulary and word != headword]
            group["a"] = [word for word in group.get("a", []) if word in vocabulary and word != headword]
            group["src"] = "app"
        relations[headword] = groups

    args.output.mkdir(parents=True, exist_ok=True)
    by_letter: dict[str, dict[str, list[dict[str, object]]]] = {}
    for headword, groups in relations.items():
        letter = re.sub(r"[^a-z]", "", headword)[:1] or "_"
        by_letter.setdefault(letter, {})[headword] = groups
    files = []
    for letter, data in by_letter.items():
        filename = f"{letter}.json"
        (args.output / filename).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        files.append(filename)
    (args.output / "manifest.json").write_text(json.dumps(sorted(files), separators=(",", ":")) + "\n", encoding="utf-8")
    groups = sum(len(items) for items in relations.values())
    size = sum(path.stat().st_size for path in args.output.glob("*.json"))
    print(f"headwords={len(relations):,} groups={groups:,} shards={len(files)} bytes={size:,} output={args.output}")


if __name__ == "__main__":
    main()
