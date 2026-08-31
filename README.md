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
| Data Lab | `data-lab.html` | Dataset profile, data-quality checks, coverage drift, exploratory charts, and in-browser models |

Shared assets live in `assets/`:

- `data.js` — the full dataset as a `window.BRUINCAST_DATA` global (generated from `Student_Run_Media_Research.xlsx`)
- `app.css` — shared design system
- `site.js` — shared render helpers
- `lab.css` — Data Lab components (extends `app.css`, loaded only by `data-lab.html`)
- `lab-stats.js` — statistics kernel: profiling, PSI, logistic regression, cross-validation, metrics
- `lab-data.js` — analysis layer: feature engineering, target derivation, quality checks, corpus shaping
- `lab-mock.js` — clearly-labelled synthetic publishing corpus, used only when the ingester has not exported one
- `charts.js` — dependency-free SVG chart primitives
- `lab.js` — Data Lab page controller

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

## The Data Lab

`data-lab.html` is the analyst's view of the same dataset. It runs entirely in the browser, with no build
step and no chart library, and it is split so the analysis is testable on its own:

| Layer | File | Responsibility |
|---|---|---|
| Statistics | `assets/lab-stats.js` | Pure functions — profiling, correlation, PSI, logistic regression, leave-one-out CV, classification metrics. No DOM, no data access. |
| Analysis | `assets/lab-data.js` | Builds the organization frame, derives the target, runs the quality checks and experiment registry. |
| Mock data | `assets/lab-mock.js` | Deterministic stand-in for the publishing corpus. |
| Charts | `assets/charts.js` | SVG bar / column / line / histogram / scatter / heatmap / ROC / coefficient primitives. |
| Page | `assets/lab.js` + `data-lab.html` | State, filters, rendering. |

**What is real and what is simulated.** Every organization-level number — the dataset profile, the quality
checks, the drift figure, the target variable, the features and all model metrics — is computed from the real
research dataset when the page loads. The *item-level publishing corpus* is real only if
`bruincast_reader/data.json` exists; that file is git-ignored, so without it the page falls back to a seeded
synthetic corpus built from the real feed registry and labels every figure drawn from it as simulated. Running
the ingester (below) replaces it with no code change — the page prefers the export automatically.

**Modelling.** The target is `is_cited_model`: the organization is named in
`ucla_recommendations.model_to_copy` as a programme UCLA should copy. Five experiments (one hand rule, four
regularised logistic regressions) are trained and leave-one-out cross-validated in the browser on every run.
With 40 rows and 9 positives, the leading model is a screening aid for choosing what to research next — the
page says so, and nothing from it is deployed anywhere.

**URL state.** Filters live in the hash, so a view is shareable:
`data-lab.html#tab=models&scope=peers&days=90&threshold=0.4`. The `corpus` key forces a corpus state for
testing the loading, empty and error paths: `#corpus=synthetic`, `#corpus=empty`, `#corpus=error`.

### Tests

```bash
node tests/lab-selftest.js   # 39 assertions, no dependencies, no network
```

The suite covers the statistics kernel (including hand-computed correlations, PSI, ROC-AUC and threshold
behaviour), the value parsers, the derived label and its provenance, feature completeness after imputation,
every experiment's metric ranges, the quality checks against the shipped dataset, and corpus handling with
null, undated and malformed items.

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
- The **Data Lab** needs no CDN — its charts are hand-rolled SVG — so it works fully offline.
- Both the Research page and the Data Lab probe `bruincast_reader/data.json` on load. Until the ingester has
  been run that request 404s in the console; the pages handle it and fall back, as designed.
