# BruinCast

A research site benchmarking student-run media across US universities to inform what UCLA should
build next. Static site — no build step, no framework. Deploys as-is to Vercel or GitHub Pages.

## Pages

| Page | File | What's on it |
|---|---|---|
| Research | `index.html` | Overview, all organizations, UCLA recommendations, deep dives, **live SQL console**, RSS feed reader, sources |
| UCLA | `ucla.html` | Everything UCLA already has, with embedded UCLA Radio + Daily Bruin video, and the gap list |
| Colleges | `colleges.html` | Peer-school media grouped by school, with embedded student TV channels |
| Other Media | `other-media.html` | Conference broadcast networks, esports production, social, thought leaders, tracked feeds |

Shared assets live in `assets/`:

- `data.js` — the full dataset as a `window.BRUINCAST_DATA` global (generated from `Student_Run_Media_Research.xlsx`)
- `app.css` — shared design system
- `site.js` — shared render helpers

## Run locally

Any static server works. Because the pages read `assets/data.js` and the reader reads
`bruincast_reader/data.json`, use a server rather than opening files directly (Chrome blocks
local `file://` fetches):

```bash
cd BruinCast
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to Vercel

**Option A — dashboard (no CLI):**
1. Push this folder to a GitHub repo (see below).
2. At [vercel.com/new](https://vercel.com/new), import the repo.
3. Framework preset: **Other**. Build command: **none**. Output directory: **`./`** (root).
4. Deploy. `vercel.json` is already configured (clean URLs, asset caching).

**Option B — CLI:**
```bash
npm i -g vercel
cd BruinCast
vercel        # preview
vercel --prod # production
```

## Push to GitHub

```bash
cd BruinCast
git init
git add .
git commit -m "BruinCast student media research site"
git branch -M main
git remote add origin https://github.com/<you>/bruincast.git
git push -u origin main
```

### GitHub Pages (alternative host)
Settings → Pages → Source: **Deploy from a branch** → `main` / `root`. The site is served from the
repo root, so it works with no changes.

## The feed reader (optional, refreshes the data)

`bruincast_reader/` is a standalone RSS/MRSS ingester (Python standard library only). It populates
the Feed Reader tab.

```bash
cd bruincast_reader
python3 ingest.py init            # create bruincast.db
python3 ingest.py load feeds.csv  # register feeds
python3 ingest.py fetch           # pull items (validates each feed)
python3 ingest.py export          # writes data.json the site reads
python3 ingest.py selftest        # 25 parser tests, no network
```

The generated `bruincast.db` and `data.json` are git-ignored — regenerate them anywhere. See
`bruincast_reader/README.md` for schema and query examples.

## Editing the data

The site's source of truth is `Student_Run_Media_Research.xlsx`. After editing it, regenerate
`assets/data.js` (one row per record, keyed by tab). The dataset powers every page and the SQL
console, so everything stays in sync from that one file.

## Notes

- The **SQL console** builds a real SQLite database in the browser via `sql.js` (loaded from CDN),
  so that one tab needs internet the first time; every other page works fully offline.
- Embedded video/audio is pulled from each outlet's own YouTube / SoundCloud channel.
