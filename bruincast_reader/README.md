# BruinCast Reader — RSS / MRSS ingester

Pulls student-media feeds into a SQLite database so the research dataset keeps growing on its own.
**Python 3.8+, standard library only — nothing to install.**

## Quickstart

```bash
cd bruincast_reader

python3 ingest.py init            # create bruincast.db from schema.sql
python3 ingest.py load feeds.csv  # register the 23 starter feeds
python3 ingest.py fetch           # fetch them all (validates each URL)
python3 ingest.py stats           # see what landed
python3 ingest.py export          # write data.json for the reader UI
```

Then open the reader:

```bash
python3 -m http.server 8000       # then visit http://localhost:8000/reader.html
```

*(Opening `reader.html` directly via `file://` works in Safari but Chrome blocks the local
`data.json` fetch — use the tiny server above.)*

## Commands

| Command | What it does |
|---|---|
| `init` | Creates `bruincast.db` from `schema.sql` |
| `load <csv>` | Registers feeds from a CSV (duplicates skipped safely) |
| `fetch` | Fetches all active feeds; `--feed N` for one, `--delay N` to throttle |
| `stats` | Feed/item/media counts, broken down by vertical |
| `export` | Writes `data.json` for `reader.html` |
| `selftest` | Runs 25 parser tests against built-in fixtures — no network needed |

## What it parses

- **RSS 2.0** — title, link, guid, `dc:creator`, `pubDate` (RFC-822), `description`, `content:encoded`, categories, enclosures
- **Atom** — `id`, `link[rel=alternate]`, `author/name`, `published`/`updated` (ISO-8601), categories
- **Media RSS (MRSS)** — `media:content` (incl. nested in `media:group`), `media:thumbnail`, `media:description`, `media:credit`, plus duration/dimensions/filesize

Dates normalize to ISO-8601 UTC. HTML is stripped from summaries. Feed format is auto-detected
and recorded per feed.

## Design notes

**Self-validating feed registry.** Feed URLs in `feeds.csv` follow standard platform conventions
(WordPress `/feed`, SNworks `?f=rss`), but conventions drift. Rather than assume they work, the
ingester records `last_status` and `last_error` per feed on every run. After your first `fetch`,
`python3 ingest.py stats` tells you exactly which are live. Prune or fix the rest — a failing feed
logs and moves on, it never halts the run.

**Idempotent.** Items dedupe on `(feed_id, guid)`, so re-running `fetch` only adds what's new.
Safe to run on a cron/schedule.

**Every run is logged.** The `fetch_log` table keeps status, item counts and duration per feed per
run, so you can spot a feed that quietly died.

## Adding feeds

Append to `feeds.csv` and re-run `load`. Columns: `feed_name, feed_url, site_url, vertical,
school_id, category_id, org_id`. The three ID columns join to the `schools`, `categories` and
`organizations` tables from `Student_Run_Media_Research.xlsx` — leave blank if unknown.

**YouTube channels are a strong MRSS source** (student TV stations post there). The feed URL is:

```
https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
```

Find `CHANNEL_ID` in the channel page source. These return Atom + Media RSS with thumbnails and
video metadata — exactly what the `media` table is built for.

## Schema

`schema.sql` defines: `feeds` → `items` → `media` / `item_categories`, plus `fetch_log` and three
analysis views:

- `v_items_enriched` — items joined to school, category and vertical
- `v_feed_activity` — publishing volume and latest post per feed
- `v_media_mix` — video/audio/image asset counts by school and vertical (who actually does video?)

The reference tables (`schools`, `categories`, `organizations`) mirror the research workbook, so
feed data and benchmarking research live in one queryable database.

### Example queries

```sql
-- Which schools publish the most video?
SELECT school_name, video_assets FROM v_media_mix
WHERE video_assets > 0 ORDER BY video_assets DESC;

-- Sports output over the last 30 days
SELECT school_name, COUNT(*) AS stories
FROM v_items_enriched
WHERE vertical = 'sports' AND published_at > date('now','-30 days')
GROUP BY school_name ORDER BY stories DESC;

-- Feeds that have gone quiet
SELECT feed_name, latest_post FROM v_feed_activity
WHERE latest_post < date('now','-60 days') OR latest_post IS NULL;
```

## Troubleshooting

**`disk I/O error` on init** — SQLite can't take file locks on some synced/network drives
(Dropbox, iCloud, mounted volumes). Point the DB somewhere local:

```bash
BRUINCAST_DB=~/bruincast.db python3 ingest.py init
```

Set that variable for every command in the session.

**A feed returns `http_error 403`** — some sites block unknown user agents. Adjust `USER_AGENT`
near the top of `ingest.py`.
