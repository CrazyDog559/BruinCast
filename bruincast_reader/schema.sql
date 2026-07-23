-- BruinCast — RSS/MRSS reader schema
-- Extends the Student_Run_Media_Research data model (schools / categories / organizations).
-- SQLite dialect; portable to Postgres with minor type swaps (INTEGER PRIMARY KEY -> SERIAL).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------
-- Reference tables (mirror the research workbook so the feed data
-- joins cleanly to the benchmarking research)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schools (
    school_id   INTEGER PRIMARY KEY,
    school_name TEXT NOT NULL,
    conference  TEXT,
    location    TEXT
);

CREATE TABLE IF NOT EXISTS categories (
    category_id   INTEGER PRIMARY KEY,
    category_name TEXT NOT NULL,
    description   TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
    org_id                  INTEGER PRIMARY KEY,
    school_id               INTEGER REFERENCES schools(school_id),
    category_id             INTEGER REFERENCES categories(category_id),
    org_name                TEXT NOT NULL,
    founded_year            INTEGER,
    governance_model        TEXT,
    funding_model           TEXT,
    academic_credit         TEXT,
    independent_from_school TEXT,
    member_count            TEXT,
    website                 TEXT,
    what_they_create        TEXT,
    how_run_notes           TEXT
);

-- ---------------------------------------------------------------
-- Feed layer
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feeds (
    feed_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id          INTEGER REFERENCES organizations(org_id),
    school_id       INTEGER REFERENCES schools(school_id),
    category_id     INTEGER REFERENCES categories(category_id),
    feed_name       TEXT NOT NULL,
    feed_url        TEXT NOT NULL UNIQUE,
    site_url        TEXT,
    vertical        TEXT,            -- sports | gaming | film_tv_theater | art_design | business | sciences | news | radio
    feed_format     TEXT,            -- rss | atom | mrss (detected at fetch time)
    active          INTEGER NOT NULL DEFAULT 1,
    added_at        TEXT,
    last_fetched_at TEXT,
    last_status     TEXT,            -- ok | http_error | parse_error | timeout | unreachable
    last_error      TEXT,
    last_item_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
    item_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id      INTEGER NOT NULL REFERENCES feeds(feed_id) ON DELETE CASCADE,
    guid         TEXT NOT NULL,      -- <guid>, <id>, or link fallback
    title        TEXT,
    link         TEXT,
    author       TEXT,
    published_at TEXT,               -- ISO-8601 UTC
    summary      TEXT,
    content      TEXT,
    fetched_at   TEXT,
    UNIQUE (feed_id, guid)
);

-- Media RSS payloads: <media:content>, <media:thumbnail>, enclosures
CREATE TABLE IF NOT EXISTS media (
    media_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    url          TEXT NOT NULL,
    medium       TEXT,               -- video | audio | image | document
    mime_type    TEXT,
    width        INTEGER,
    height       INTEGER,
    duration_sec INTEGER,
    file_size    INTEGER,
    is_thumbnail INTEGER NOT NULL DEFAULT 0,
    credit       TEXT,
    UNIQUE (item_id, url, is_thumbnail)
);

CREATE TABLE IF NOT EXISTS item_categories (
    item_id INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    term    TEXT NOT NULL,
    PRIMARY KEY (item_id, term)
);

CREATE TABLE IF NOT EXISTS fetch_log (
    log_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id     INTEGER REFERENCES feeds(feed_id) ON DELETE CASCADE,
    run_at      TEXT,
    status      TEXT,
    items_seen  INTEGER,
    items_new   INTEGER,
    duration_ms INTEGER,
    message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_feed      ON items(feed_id);
CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_item      ON media(item_id);
CREATE INDEX IF NOT EXISTS idx_feeds_vertical  ON feeds(vertical);

-- ---------------------------------------------------------------
-- Analysis views
-- ---------------------------------------------------------------

-- Every item with its school / category / vertical context
CREATE VIEW IF NOT EXISTS v_items_enriched AS
SELECT i.item_id, i.title, i.link, i.author, i.published_at, i.summary,
       f.feed_name, f.vertical, f.feed_url,
       s.school_name, s.conference,
       c.category_name,
       (SELECT COUNT(*) FROM media m WHERE m.item_id = i.item_id AND m.is_thumbnail = 0) AS media_count
FROM items i
JOIN feeds f       ON f.feed_id = i.feed_id
LEFT JOIN schools s     ON s.school_id = f.school_id
LEFT JOIN categories c  ON c.category_id = f.category_id;

-- Publishing volume per feed (who is actually producing?)
CREATE VIEW IF NOT EXISTS v_feed_activity AS
SELECT f.feed_id, f.feed_name, f.vertical, s.school_name,
       COUNT(i.item_id)      AS total_items,
       MAX(i.published_at)   AS latest_post,
       MIN(i.published_at)   AS earliest_post,
       f.last_status
FROM feeds f
LEFT JOIN items i   ON i.feed_id = f.feed_id
LEFT JOIN schools s ON s.school_id = f.school_id
GROUP BY f.feed_id;

-- Which schools lean into video/audio (MRSS) vs text?
CREATE VIEW IF NOT EXISTS v_media_mix AS
SELECT s.school_name, f.vertical,
       COUNT(DISTINCT i.item_id) AS items,
       SUM(CASE WHEN m.medium = 'video' THEN 1 ELSE 0 END) AS video_assets,
       SUM(CASE WHEN m.medium = 'audio' THEN 1 ELSE 0 END) AS audio_assets,
       SUM(CASE WHEN m.medium = 'image' THEN 1 ELSE 0 END) AS image_assets
FROM feeds f
LEFT JOIN items i   ON i.feed_id = f.feed_id
LEFT JOIN media m   ON m.item_id = i.item_id AND m.is_thumbnail = 0
LEFT JOIN schools s ON s.school_id = f.school_id
GROUP BY s.school_name, f.vertical;
