"""Update a compact, seven-day UN News RSS learning feed."""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "news.json"
FEED_URL = "https://news.un.org/feed/subscribe/en/news/all/rss.xml"
SOURCE_URL = "https://news.un.org/en/"
TAIPEI = timezone(timedelta(hours=8))
RETENTION = timedelta(days=7)
STOP = set("a an and are as at be been being by can could did do does for from had has have he her hers him his how i if in into is it its may more most not of on or our she should that the their them there these they this those to was we were what when where which who will with would you your after also around back because before between both during each first get had here just last made make many much new now other out per said says several since some such than then these through under until up use very well while within without work about all".split())


class TextOnly(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_text(value: str, limit: int = 320) -> str:
    parser = TextOnly()
    parser.feed(html.unescape(value or ""))
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    if len(text) <= limit:
        return text
    shortened = text[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return shortened + "…"


def published_datetime(item: ET.Element) -> datetime | None:
    raw = item.findtext("pubDate") or ""
    try:
        dt = parsedate_to_datetime(raw)
        return (dt or datetime.now(timezone.utc)).astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def article_image(item: ET.Element) -> str:
    enclosure = item.find("enclosure")
    if enclosure is None or not (enclosure.get("type") or "").lower().startswith("image/"):
        return ""
    value = (enclosure.get("url") or "").strip()
    try:
        from urllib.parse import urlparse
        parsed = urlparse(value)
        if parsed.scheme == "https" and parsed.hostname == "global.unitednations.entermediadb.net":
            return value
    except ValueError:
        pass
    return ""


def dictionary_entry(word: str, cache: dict[str, dict]) -> dict | None:
    shard = word[:2].lower()
    if len(shard) < 2 or not shard.isalpha():
        return None
    if shard not in cache:
        path = ROOT / "dict" / "w" / f"{shard}.json"
        try:
            cache[shard] = json.loads(path.read_text(encoding="utf-8")).get("e", {})
        except (OSError, json.JSONDecodeError):
            cache[shard] = {}
    entry = cache[shard].get(word.lower())
    return entry if isinstance(entry, dict) else None


def learning_words(text: str, cache: dict[str, dict]) -> list[str]:
    words = list(dict.fromkeys(
        (match.group(0).lower(), match.group(0)[0].isupper())
        for match in re.finditer(r"[A-Za-z]{5,}", text)
    ))
    ranked = []
    for word, capitalized in words:
        if capitalized or word in STOP:
            continue
        entry = dictionary_entry(word, cache)
        rank = entry.get("f") if entry else None
        pos = {sense.get("p") for sense in entry.get("m", [])} if entry else set()
        if rank and 300 <= rank <= 18000 and pos.intersection({"n", "noun", "adj", "a"}):
            ranked.append((rank, word))
    ranked.sort(key=lambda row: row[0], reverse=True)
    steady = [row for row in ranked if not row[1].endswith(("ing", "ed"))]
    selected = (steady + [row for row in ranked if row not in steady])[:4]
    return [word for _, word in selected]


def load_existing() -> list[dict]:
    try:
        value = json.loads(OUT.read_text(encoding="utf-8"))
        return value.get("articles", []) if isinstance(value, dict) else []
    except (OSError, json.JSONDecodeError):
        return []


def main() -> int:
    now = datetime.now(timezone.utc)
    cutoff = now - RETENTION
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": "EnglishNotebook/1.0 (educational RSS reader)"})
    with urllib.request.urlopen(request, timeout=30) as response:
        root = ET.fromstring(response.read())

    existing = load_existing()
    by_day: dict[str, dict] = {}
    ranks: dict[str, dict] = {}
    for item in root.findall("./channel/item"):
        dt = published_datetime(item)
        title = clean_text(item.findtext("title") or "", 180)
        summary = clean_text(item.findtext("description") or "")
        url = (item.findtext("guid") or item.findtext("link") or "").strip()
        if not dt or dt < cutoff or dt > now + timedelta(hours=1):
            continue
        if not (url.startswith("https://news.un.org/") and title and summary):
            continue
        key = dt.astimezone(TAIPEI).date().isoformat()
        if key in by_day:
            continue
        by_day[key] = {
            "id": re.sub(r"[^a-zA-Z0-9_-]", "", item.findtext("guid") or url)[-100:],
            "title": title,
            "summary": summary,
            "url": url,
            "publishedAt": dt.isoformat().replace("+00:00", "Z"),
            "vocabulary": learning_words(title + " " + summary, ranks),
        }
        image_url = article_image(item)
        if image_url:
            by_day[key]["imageUrl"] = image_url

    # Keep one selected item per day for the seven-day window when the feed rolls forward.
    for article in existing:
        try:
            dt = datetime.fromisoformat(article["publishedAt"].replace("Z", "+00:00"))
            key = dt.astimezone(TAIPEI).date().isoformat()
            if dt >= cutoff and key not in by_day and article.get("url", "").startswith("https://news.un.org/"):
                by_day[key] = article
        except (KeyError, TypeError, ValueError):
            continue

    articles = sorted(by_day.values(), key=lambda a: a["publishedAt"], reverse=True)[:7]
    old_value = {"source": "UN News", "sourceUrl": SOURCE_URL, "retentionDays": 7, "articles": existing}
    value = {"source": "UN News", "sourceUrl": SOURCE_URL, "retentionDays": 7, "articles": articles}
    if value == old_value:
        print(f"No feed changes; kept {len(articles)} stories.")
        return 0
    OUT.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {len(articles)} stories from the last seven days ({OUT.stat().st_size:,} bytes).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"News update failed: {exc}", file=sys.stderr)
        raise
