#!/usr/bin/env python3
"""
BruinCast feed ingester — RSS 2.0, Atom, and Media RSS (MRSS) into SQLite.

Standard library only. No pip install required.

Usage:
    python ingest.py init                 # create bruincast.db from schema.sql
    python ingest.py load feeds.csv       # register feeds from the registry
    python ingest.py fetch                # fetch all active feeds
    python ingest.py fetch --feed 3       # fetch one feed
    python ingest.py stats                # summary of what's in the DB
    python ingest.py export               # write data.json for reader.html
    python ingest.py selftest             # parse local fixtures, no network
"""

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
# Override with BRUINCAST_DB if the project folder is on a network/synced drive
# where SQLite can't take file locks (Dropbox, some mounted volumes).
DB_PATH = os.environ.get("BRUINCAST_DB") or os.path.join(HERE, "bruincast.db")
SCHEMA_PATH = os.path.join(HERE, "schema.sql")
USER_AGENT = "BruinCastReader/1.0 (student media research; +https://github.com/)"
TIMEOUT = 20

NS = {
    "media":   "http://search.yahoo.com/mrss/",
    "atom":    "http://www.w3.org/2005/Atom",
    "dc":      "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "itunes":  "http://www.itunes.com/dtds/podcast-1.0.dtd",
}


# ----------------------------------------------------------------- helpers

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def strip_html(text):
    if not text:
        return None
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;?", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip() or None


def parse_date(raw):
    """RSS uses RFC-822, Atom uses ISO-8601. Return ISO-8601 UTC or None."""
    if not raw:
        return None
    raw = raw.strip()
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        pass
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat(timespec="seconds")
    except ValueError:
        return None


def parse_duration(raw):
    """MRSS duration is seconds; iTunes uses HH:MM:SS. Return int seconds."""
    if not raw:
        return None
    raw = raw.strip()
    if raw.isdigit():
        return int(raw)
    parts = raw.split(":")
    try:
        parts = [int(p) for p in parts]
    except ValueError:
        return None
    seconds = 0
    for p in parts:
        seconds = seconds * 60 + p
    return seconds


def as_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def text_of(elem, *paths):
    """First non-empty text among the given paths."""
    for path in paths:
        found = elem.find(path, NS)
        if found is not None:
            if found.text and found.text.strip():
                return found.text.strip()
            # Atom <content type="html"> can hold nested markup
            inner = "".join(found.itertext()).strip()
            if inner:
                return inner
    return None


def medium_from(mime, declared):
    if declared:
        return declared
    if not mime:
        return None
    root = mime.split("/")[0]
    return {"video": "video", "audio": "audio", "image": "image"}.get(root, "document")


# ----------------------------------------------------------------- parsing

def parse_feed(xml_bytes):
    """Return (feed_format, [item dicts]). Raises ET.ParseError on bad XML."""
    root = ET.fromstring(xml_bytes)
    tag = root.tag.split("}")[-1]

    if tag == "feed":                      # Atom
        entries = root.findall("atom:entry", NS) or root.findall("entry")
        items = [parse_atom_entry(e) for e in entries]
        fmt = "atom"
    else:                                  # RSS / RDF
        channel = root.find("channel") or root
        entries = channel.findall("item")
        items = [parse_rss_item(e) for e in entries]
        fmt = "rss"

    if any(i["media"] for i in items):
        fmt = "mrss"
    return fmt, items


def parse_rss_item(item):
    link = text_of(item, "link")
    guid = text_of(item, "guid") or link or text_of(item, "title")
    return {
        "guid": guid,
        "title": text_of(item, "title"),
        "link": link,
        "author": text_of(item, "author", "dc:creator"),
        "published_at": parse_date(text_of(item, "pubDate", "dc:date")),
        "summary": strip_html(text_of(item, "description", "media:description")),
        "content": text_of(item, "content:encoded"),
        "categories": [c.text.strip() for c in item.findall("category") if c.text and c.text.strip()],
        "media": extract_media(item),
    }


def parse_atom_entry(entry):
    link_el = entry.find("atom:link[@rel='alternate']", NS) or entry.find("atom:link", NS)
    link = link_el.get("href") if link_el is not None else None
    return {
        "guid": text_of(entry, "atom:id") or link,
        "title": text_of(entry, "atom:title"),
        "link": link,
        "author": text_of(entry, "atom:author/atom:name", "dc:creator"),
        "published_at": parse_date(text_of(entry, "atom:published", "atom:updated")),
        "summary": strip_html(text_of(entry, "atom:summary")),
        "content": text_of(entry, "atom:content"),
        "categories": [c.get("term") for c in entry.findall("atom:category", NS) if c.get("term")],
        "media": extract_media(entry),
    }


def extract_media(item):
    """Pull MRSS media:content / media:thumbnail plus RSS enclosures."""
    out = []

    # media:content, including those nested inside media:group
    contents = item.findall("media:content", NS) + item.findall("media:group/media:content", NS)
    for m in contents:
        url = m.get("url")
        if not url:
            continue
        credit_el = m.find("media:credit", NS)
        out.append({
            "url": url,
            "medium": medium_from(m.get("type"), m.get("medium")),
            "mime_type": m.get("type"),
            "width": as_int(m.get("width")),
            "height": as_int(m.get("height")),
            "duration_sec": parse_duration(m.get("duration")),
            "file_size": as_int(m.get("fileSize")),
            "is_thumbnail": 0,
            "credit": credit_el.text.strip() if credit_el is not None and credit_el.text else None,
        })

    for t in item.findall("media:thumbnail", NS) + item.findall("media:group/media:thumbnail", NS):
        if t.get("url"):
            out.append({
                "url": t.get("url"), "medium": "image", "mime_type": None,
                "width": as_int(t.get("width")), "height": as_int(t.get("height")),
                "duration_sec": None, "file_size": None, "is_thumbnail": 1, "credit": None,
            })

    for e in item.findall("enclosure"):
        if e.get("url"):
            out.append({
                "url": e.get("url"),
                "medium": medium_from(e.get("type"), None),
                "mime_type": e.get("type"),
                "width": None, "height": None,
                "duration_sec": parse_duration(text_of(item, "itunes:duration")),
                "file_size": as_int(e.get("length")),
                "is_thumbnail": 0, "credit": None,
            })

    # de-dupe on (url, is_thumbnail)
    seen, unique = set(), []
    for m in out:
        key = (m["url"], m["is_thumbnail"])
        if key not in seen:
            seen.add(key)
            unique.append(m)
    return unique


# ----------------------------------------------------------------- db

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def cmd_init(args):
    with open(SCHEMA_PATH) as fh:
        sql = fh.read()
    conn = connect()
    conn.executescript(sql)
    conn.commit()
    print(f"Initialized {DB_PATH}")
    conn.close()


def cmd_load(args):
    conn = connect()
    added = skipped = 0
    with open(args.csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if not row.get("feed_url"):
                continue
            try:
                conn.execute(
                    """INSERT INTO feeds (org_id, school_id, category_id, feed_name, feed_url,
                                          site_url, vertical, active, added_at)
                       VALUES (?,?,?,?,?,?,?,1,?)""",
                    (as_int(row.get("org_id")), as_int(row.get("school_id")),
                     as_int(row.get("category_id")), row.get("feed_name"),
                     row["feed_url"].strip(), row.get("site_url"),
                     row.get("vertical"), now_iso()))
                added += 1
            except sqlite3.IntegrityError:
                skipped += 1
    conn.commit()
    conn.close()
    print(f"Registered {added} feeds ({skipped} already present).")


def fetch_one(conn, feed):
    started = time.time()
    feed_id, url = feed["feed_id"], feed["feed_url"]
    status, message, fmt = "ok", None, None
    seen = new = 0

    try:
        req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
        with urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
        fmt, items = parse_feed(raw)
        seen = len(items)

        for it in items:
            if not it["guid"]:
                continue
            cur = conn.execute(
                """INSERT OR IGNORE INTO items
                   (feed_id, guid, title, link, author, published_at, summary, content, fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (feed_id, it["guid"], it["title"], it["link"], it["author"],
                 it["published_at"], it["summary"], it["content"], now_iso()))
            if cur.rowcount == 0:
                continue
            new += 1
            item_id = cur.lastrowid
            for m in it["media"]:
                conn.execute(
                    """INSERT OR IGNORE INTO media
                       (item_id, url, medium, mime_type, width, height, duration_sec,
                        file_size, is_thumbnail, credit)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (item_id, m["url"], m["medium"], m["mime_type"], m["width"], m["height"],
                     m["duration_sec"], m["file_size"], m["is_thumbnail"], m["credit"]))
            for term in it["categories"]:
                conn.execute("INSERT OR IGNORE INTO item_categories (item_id, term) VALUES (?,?)",
                             (item_id, term))

    except HTTPError as e:
        status, message = "http_error", f"HTTP {e.code}"
    except URLError as e:
        status, message = "unreachable", str(e.reason)[:200]
    except ET.ParseError as e:
        status, message = "parse_error", str(e)[:200]
    except Exception as e:                                    # noqa: BLE001
        status, message = "error", f"{type(e).__name__}: {e}"[:200]

    duration_ms = int((time.time() - started) * 1000)
    conn.execute("""UPDATE feeds SET last_fetched_at=?, last_status=?, last_error=?,
                                     last_item_count=?, feed_format=COALESCE(?, feed_format)
                    WHERE feed_id=?""",
                 (now_iso(), status, message, seen, fmt, feed_id))
    conn.execute("""INSERT INTO fetch_log (feed_id, run_at, status, items_seen, items_new,
                                           duration_ms, message)
                    VALUES (?,?,?,?,?,?,?)""",
                 (feed_id, now_iso(), status, seen, new, duration_ms, message))
    conn.commit()
    return status, seen, new, message


def cmd_fetch(args):
    conn = connect()
    if args.feed:
        feeds = conn.execute("SELECT * FROM feeds WHERE feed_id=?", (args.feed,)).fetchall()
    else:
        feeds = conn.execute("SELECT * FROM feeds WHERE active=1 ORDER BY feed_id").fetchall()

    if not feeds:
        print("No feeds registered. Run: python ingest.py load feeds.csv")
        return

    ok = 0
    for f in feeds:
        status, seen, new, msg = fetch_one(conn, f)
        flag = "OK " if status == "ok" else "FAIL"
        detail = f"{seen:>3} items, {new:>3} new" if status == "ok" else (msg or status)
        print(f"[{flag}] {f['feed_name'][:44]:<44} {detail}")
        if status == "ok":
            ok += 1
        time.sleep(args.delay)
    print(f"\n{ok}/{len(feeds)} feeds fetched successfully.")
    conn.close()


def cmd_stats(args):
    conn = connect()
    q = lambda sql: conn.execute(sql).fetchall()  # noqa: E731
    total_feeds = q("SELECT COUNT(*) c FROM feeds")[0]["c"]
    live = q("SELECT COUNT(*) c FROM feeds WHERE last_status='ok'")[0]["c"]
    items = q("SELECT COUNT(*) c FROM items")[0]["c"]
    media = q("SELECT COUNT(*) c FROM media WHERE is_thumbnail=0")[0]["c"]
    print(f"Feeds registered : {total_feeds}")
    print(f"Feeds responding : {live}")
    print(f"Items ingested   : {items}")
    print(f"Media assets     : {media}\n")

    rows = q("""SELECT vertical, COUNT(DISTINCT f.feed_id) feeds, COUNT(i.item_id) items
                FROM feeds f LEFT JOIN items i ON i.feed_id=f.feed_id
                GROUP BY vertical ORDER BY items DESC""")
    if rows:
        print(f"{'vertical':<18}{'feeds':>7}{'items':>8}")
        for r in rows:
            print(f"{(r['vertical'] or '-'):<18}{r['feeds']:>7}{r['items']:>8}")
    conn.close()


def cmd_export(args):
    """Write data.json next to reader.html."""
    conn = connect()
    items = [dict(r) for r in conn.execute("""
        SELECT i.item_id, i.title, i.link, i.author, i.published_at, i.summary,
               f.feed_name, f.vertical, s.school_name, c.category_name
        FROM items i
        JOIN feeds f      ON f.feed_id = i.feed_id
        LEFT JOIN schools s    ON s.school_id = f.school_id
        LEFT JOIN categories c ON c.category_id = f.category_id
        ORDER BY COALESCE(i.published_at,'') DESC
        LIMIT 2000""")]
    for it in items:
        thumbs = conn.execute(
            "SELECT url FROM media WHERE item_id=? AND is_thumbnail=1 LIMIT 1", (it["item_id"],)).fetchone()
        assets = conn.execute(
            "SELECT medium, COUNT(*) n FROM media WHERE item_id=? AND is_thumbnail=0 GROUP BY medium",
            (it["item_id"],)).fetchall()
        it["thumbnail"] = thumbs["url"] if thumbs else None
        it["assets"] = {a["medium"]: a["n"] for a in assets if a["medium"]}

    feeds = [dict(r) for r in conn.execute("SELECT * FROM v_feed_activity")]
    out = {"generated_at": now_iso(), "items": items, "feeds": feeds}
    path = os.path.join(HERE, "data.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(f"Exported {len(items)} items -> {path}")
    conn.close()


# ----------------------------------------------------------------- selftest

RSS_FIXTURE = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Test Paper</title>
  <item>
    <title>Bruins win opener</title>
    <link>https://example.edu/a1</link>
    <guid>https://example.edu/a1</guid>
    <dc:creator>Jane Reporter</dc:creator>
    <pubDate>Tue, 21 Jul 2026 18:30:00 GMT</pubDate>
    <description>&lt;p&gt;A &lt;b&gt;big&lt;/b&gt; win.&lt;/p&gt;</description>
    <content:encoded>Full story body.</content:encoded>
    <category>Sports</category><category>Football</category>
    <enclosure url="https://example.edu/a1.mp3" type="audio/mpeg" length="512000"/>
  </item>
</channel></rss>"""

MRSS_FIXTURE = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Student TV</title>
  <item>
    <title>Game highlights</title>
    <link>https://example.edu/v1</link>
    <guid>v1</guid>
    <pubDate>Mon, 20 Jul 2026 02:00:00 GMT</pubDate>
    <media:group>
      <media:content url="https://example.edu/v1.mp4" type="video/mp4" medium="video"
                     duration="212" width="1920" height="1080" fileSize="88000000">
        <media:credit>Student Crew</media:credit>
      </media:content>
    </media:group>
    <media:thumbnail url="https://example.edu/v1.jpg" width="640" height="360"/>
    <media:description>Highlights from the opener.</media:description>
  </item>
</channel></rss>"""

ATOM_FIXTURE = b"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Campus Radio</title>
  <entry>
    <id>tag:example.edu,2026:1</id>
    <title>Weekly show</title>
    <link rel="alternate" href="https://example.edu/s1"/>
    <author><name>DJ Bruin</name></author>
    <published>2026-07-19T15:00:00Z</published>
    <summary>Episode notes.</summary>
    <category term="Radio"/>
  </entry>
</feed>"""


def cmd_selftest(args):
    failures = []

    def check(label, cond):
        print(f"  {'PASS' if cond else 'FAIL'}  {label}")
        if not cond:
            failures.append(label)

    print("RSS 2.0:")
    fmt, items = parse_feed(RSS_FIXTURE)
    it = items[0]
    check("one item parsed", len(items) == 1)
    check("title", it["title"] == "Bruins win opener")
    check("dc:creator author", it["author"] == "Jane Reporter")
    check("RFC-822 date -> ISO", it["published_at"] == "2026-07-21T18:30:00+00:00")
    check("HTML stripped from summary", it["summary"] == "A big win.")
    check("content:encoded", it["content"] == "Full story body.")
    check("categories", it["categories"] == ["Sports", "Football"])
    check("enclosure -> audio media", it["media"][0]["medium"] == "audio")
    check("enclosure size", it["media"][0]["file_size"] == 512000)

    print("Media RSS:")
    fmt, items = parse_feed(MRSS_FIXTURE)
    it = items[0]
    check("format detected as mrss", fmt == "mrss")
    m = [x for x in it["media"] if not x["is_thumbnail"]][0]
    check("media:group/content found", m["url"].endswith("v1.mp4"))
    check("duration parsed", m["duration_sec"] == 212)
    check("dimensions", (m["width"], m["height"]) == (1920, 1080))
    check("credit", m["credit"] == "Student Crew")
    check("thumbnail captured", any(x["is_thumbnail"] for x in it["media"]))
    check("media:description fallback", it["summary"] == "Highlights from the opener.")

    print("Atom:")
    fmt, items = parse_feed(ATOM_FIXTURE)
    it = items[0]
    check("format detected as atom", fmt == "atom")
    check("atom id as guid", it["guid"] == "tag:example.edu,2026:1")
    check("alternate link", it["link"] == "https://example.edu/s1")
    check("author name", it["author"] == "DJ Bruin")
    check("ISO date", it["published_at"] == "2026-07-19T15:00:00+00:00")
    check("atom category term", it["categories"] == ["Radio"])

    print("Edge cases:")
    check("HH:MM:SS duration", parse_duration("1:02:03") == 3723)
    check("bad date -> None", parse_date("not a date") is None)
    check("empty html -> None", strip_html("<p></p>") is None)

    print(f"\n{'ALL TESTS PASSED' if not failures else str(len(failures)) + ' FAILURE(S)'}")
    return 1 if failures else 0


# ----------------------------------------------------------------- cli

def main():
    p = argparse.ArgumentParser(description="BruinCast RSS/MRSS ingester")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init").set_defaults(func=cmd_init)

    lp = sub.add_parser("load")
    lp.add_argument("csv_path")
    lp.set_defaults(func=cmd_load)

    fp = sub.add_parser("fetch")
    fp.add_argument("--feed", type=int, help="fetch a single feed_id")
    fp.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    fp.set_defaults(func=cmd_fetch)

    sub.add_parser("stats").set_defaults(func=cmd_stats)
    sub.add_parser("export").set_defaults(func=cmd_export)
    sub.add_parser("selftest").set_defaults(func=cmd_selftest)

    args = p.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
