#!/usr/bin/env node
/* BruinCast Data Lab — self-test.
 * Same spirit as `python3 ingest.py selftest`: no dependencies, no network,
 * no browser. Run from the repository root with:
 *     node tests/lab-selftest.js
 * Covers the statistics kernel (assets/lab-stats.js) and the analysis layer
 * (assets/lab-data.js), including the real research dataset it ships with.
 */
"use strict";

// The browser modules attach to `window`; give them one.
global.window = global.window || {};
const path = require("path");
const root = path.join(__dirname, "..");
require(path.join(root, "assets/data.js"));
const S = require(path.join(root, "assets/lab-stats.js"));
const L = require(path.join(root, "assets/lab-data.js"));
const DB = global.window.BRUINCAST_DATA;

let passed = 0, failed = 0;
const fails = [];

function test(name, fn){
  try { fn(); passed++; }
  catch(err){ failed++; fails.push(`${name}\n    ${err.message}`); }
}
function eq(actual, expected, msg){
  if(actual !== expected) throw new Error(`${msg||"eq"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function near(actual, expected, tol, msg){
  if(!(Math.abs(actual-expected) <= (tol==null?1e-6:tol)))
    throw new Error(`${msg||"near"}: expected ${expected} ±${tol}, got ${actual}`);
}
function ok(cond, msg){ if(!cond) throw new Error(msg||"expected truthy"); }

/* ---------------- descriptive statistics ---------------- */

test("mean and median ignore nulls", ()=>{
  near(S.mean([1,2,3,null,undefined,"x"]), 2);
  near(S.median([1,2,3,4]), 2.5);
});

test("quantile interpolates between order statistics", ()=>{
  near(S.quantile([1,2,3,4,5], 0.25), 2);
  near(S.quantile([1,2,3,4], 0.5), 2.5);
});

test("stdev is the sample standard deviation", ()=>{
  near(S.stdev([2,4,4,4,5,5,7,9]), 2.13808993, 1e-6);
  eq(S.stdev([3]), null, "a single observation has no sample sd");
});

test("numericSummary reports 1.5 IQR fences and outliers", ()=>{
  const r = S.numericSummary([1,2,3,4,5,6,7,8,9,100]);
  eq(r.n, 10);
  eq(r.outliers.length, 1);
  eq(r.outliers[0], 100);
});

test("histogram bins are equal width and total the input count", ()=>{
  const bins = S.histogram([1,2,3,4,5,6,7,8,9,10], 5);
  eq(bins.length, 5);
  eq(bins.reduce((a,b)=>a+b.count,0), 10);
  const max = S.histogram([7,7,7], 4);
  eq(max.length, 1, "a constant column collapses to one bin");
});

test("pearson matches a hand-computed correlation", ()=>{
  near(S.pearson([1,2,3,4,5],[2,4,6,8,10]), 1);
  near(S.pearson([1,2,3,4,5],[10,8,6,4,2]), -1);
  eq(S.pearson([1,1,1,1],[1,2,3,4]), null, "zero variance is not estimable");
  eq(S.pearson([1,2],[2,4]), null, "fewer than three pairs is not estimable");
});

test("pearson uses pairwise-complete observations", ()=>{
  near(S.pearson([1,2,3,null,5],[2,4,6,99,10]), 1);
});

test("PSI is zero for identical distributions and grows as they diverge", ()=>{
  const same = S.psi({a:10,b:10}, {a:5,b:5});
  near(same.value, 0, 1e-9);
  const shifted = S.psi({a:10,b:10}, {a:19,b:1});
  ok(shifted.value > 0.25, "a 50/50 to 95/5 shift is material");
  eq(S.psiBand(0.05), "stable");
  eq(S.psiBand(0.15), "moderate");
  eq(S.psiBand(0.40), "material");
});

test("PSI is symmetric in magnitude for a swapped pair", ()=>{
  const a = S.psi({x:8,y:2}, {x:2,y:8}).value;
  const b = S.psi({x:2,y:8}, {x:8,y:2}).value;
  near(a, b, 1e-9);
});

test("wilsonInterval brackets the point estimate", ()=>{
  const w = S.wilsonInterval(9, 40);
  ok(w.low < 9/40 && w.high > 9/40, "the interval must contain the observed rate");
  ok(w.low >= 0 && w.high <= 1, "the interval stays inside [0,1]");
});

/* ---------------- profiling ---------------- */

test("profileTable counts missing cells and distinct values", ()=>{
  const rows = [{a:1,b:"x"},{a:null,b:"x"},{a:3,b:""}];
  const p = S.profileTable(rows);
  eq(p.rows, 3);
  eq(p.cells, 6);
  eq(p.missingCells, 2, "one null in a, one empty string in b");
  eq(p.columns.find(c=>c.name==="a").missing, 1);
  eq(p.columns.find(c=>c.name==="b").distinct, 1);
});

test("profileTable survives an empty table", ()=>{
  const p = S.profileTable([]);
  eq(p.rows, 0); eq(p.missingRate, 0); eq(p.columns.length, 0);
});

test("duplicateGroups finds repeated natural keys, case-insensitively", ()=>{
  const g = S.duplicateGroups([{k:"A"},{k:"a"},{k:"b"},{k:null}], r=>r.k);
  eq(g.length, 1);
  eq(g[0].count, 2);
});

/* ---------------- modelling ---------------- */

test("standardize centres and scales, and survives a constant column", ()=>{
  const {Z, mu, sigma} = S.standardize([[1,5],[3,5],[5,5]]);
  near(mu[0], 3); near(sigma[1], 1, 1e-9);
  near(Z[0][0], -1.0, 1e-9);
  near(Z[0][1], 0, 1e-9);
});

test("imputeMedian fills gaps and reports how many", ()=>{
  const r = S.imputeMedian([1,null,3,null,5]);
  eq(r.imputed, 2);
  eq(r.median, 3);
  eq(r.values.filter(v=>v===3).length, 3);
});

test("logisticFit separates a linearly separable problem", ()=>{
  const X = [[-2],[-1],[-0.5],[0.5],[1],[2]];
  const y = [0,0,0,1,1,1];
  const m = S.logisticFit(X, y, {l2:0.01, iterations:3000, lr:0.5});
  ok(m.weights[0] > 0, "the weight should point toward the positive class");
  ok(S.logisticPredict(m, [2]) > S.logisticPredict(m, [-2]), "scores must be monotonic in x");
});

test("stronger L2 shrinks the fitted weight", ()=>{
  const X = [[-2],[-1],[-0.5],[0.5],[1],[2]], y = [0,0,0,1,1,1];
  const light = S.logisticFit(X, y, {l2:0.01, iterations:2000});
  const heavy = S.logisticFit(X, y, {l2:50, iterations:2000});
  ok(Math.abs(heavy.weights[0]) < Math.abs(light.weights[0]), "regularisation must shrink");
});

test("confusion matrix and metrics agree with hand counts", ()=>{
  const y      = [1,1,0,0];
  const scores = [0.9,0.2,0.8,0.1];
  const m = S.classificationMetrics(y, scores, 0.5);
  eq(m.confusion.tp, 1); eq(m.confusion.fn, 1);
  eq(m.confusion.fp, 1); eq(m.confusion.tn, 1);
  near(m.accuracy, 0.5); near(m.precision, 0.5); near(m.recall, 0.5); near(m.f1, 0.5);
});

test("threshold trades precision against recall", ()=>{
  const y = [1,1,0,0], scores = [0.9,0.6,0.55,0.1];
  const lo = S.classificationMetrics(y, scores, 0.5);
  const hi = S.classificationMetrics(y, scores, 0.8);
  ok(lo.recall > hi.recall, "a lower threshold recovers more positives");
  ok(hi.precision >= lo.precision, "a higher threshold is at least as precise");
});

test("rocAuc is 1 for a perfect ranking, 0.5 for ties", ()=>{
  near(S.rocAuc([1,1,0,0],[0.9,0.8,0.2,0.1]), 1);
  near(S.rocAuc([1,0,1,0],[0.5,0.5,0.5,0.5]), 0.5, 1e-9);
  eq(S.rocAuc([1,1,1],[0.9,0.8,0.7]), null, "AUC needs both classes");
});

test("rocCurve starts at the origin and ends at (1,1)", ()=>{
  const pts = S.rocCurve([1,0,1,0],[0.9,0.6,0.4,0.1]);
  near(pts[0].fpr, 0); near(pts[0].tpr, 0);
  near(pts[pts.length-1].fpr, 1); near(pts[pts.length-1].tpr, 1);
});

test("looCV returns one out-of-fold score per row", ()=>{
  const X = [[-2],[-1],[-0.5],[0.5],[1],[2]], y = [0,0,0,1,1,1];
  const cv = S.looCV(X, y, {l2:1});
  eq(cv.scores.length, 6);
  eq(cv.folds, 6);
  ok(cv.scores.every(s=>s >= 0 && s <= 1), "scores are probabilities");
});

/* ---------------- value parsers ---------------- */

test("parseMemberCount classifies the shapes present in the workbook", ()=>{
  eq(L.parseMemberCount("350+").value, 350);
  eq(L.parseMemberCount("~1,000").value, 1000);
  eq(L.parseMemberCount("Large").status, "unparseable");
  eq(L.parseMemberCount("Varies/campus").status, "unparseable");
  eq(L.parseMemberCount(null).status, "missing");
  eq(L.parseMemberCount("~8,000 circ").status, "wrong_unit");
});

test("parseFoundedYear rejects impossible years", ()=>{
  eq(L.parseFoundedYear(1919).status, "ok");
  eq(L.parseFoundedYear(1500).status, "out_of_range");
  eq(L.parseFoundedYear(L.CURRENT_YEAR + 5).status, "out_of_range");
  eq(L.parseFoundedYear(null).status, "missing");
  eq(L.parseFoundedYear("not a year").status, "unparseable");
});

/* ---------------- the shipped dataset ---------------- */

test("the research dataset loads with the tables the lab expects", ()=>{
  ["schools","categories","organizations","brands","feeds","ucla_recommendations"]
    .forEach(t=>ok(Array.isArray(DB[t]) && DB[t].length, `${t} should be a non-empty array`));
});

test("every label traces to live recommendation text", ()=>{
  const index = L.citationIndex(DB);
  ok(index.size > 0, "at least one organization must be cited");
  index.forEach((recs, orgName)=>{
    ok(recs.length > 0, `${orgName} matched no recommendation`);
    recs.forEach(r=>ok(String(r.model_to_copy||"").length > 0, "evidence must carry its text"));
  });
  // No alias may point at an organization that does not exist.
  Object.keys(L.MODEL_ALIASES).forEach(name=>{
    ok(DB.organizations.some(o=>o.org_name === name), `alias "${name}" has no matching organization`);
  });
});

test("buildOrgFrame produces a complete, finite feature matrix", ()=>{
  const frame = L.buildOrgFrame(DB, "all");
  eq(frame.n, DB.organizations.length);
  ok(frame.positives > 0 && frame.positives < frame.n, "both classes must be present");
  frame.rows.forEach(r=>{
    L.FEATURES.forEach(f=>{
      const v = r.features[f.key];
      ok(typeof v === "number" && isFinite(v),
         `${r.org.org_name}.${f.key} must be a finite number after imputation, got ${v}`);
    });
  });
});

test("imputation is reported, not silent", ()=>{
  const frame = L.buildOrgFrame(DB, "all");
  const missingYears = DB.organizations.filter(o=>L.parseFoundedYear(o.founded_year).status !== "ok").length;
  eq(frame.imputation.org_age_decades.n, missingYears,
     "the imputation count must equal the number of unusable founding years");
  eq(frame.imputation.org_age_decades.strategy, "median");
});

test("scopes filter the frame and set the viability flag honestly", ()=>{
  const all = L.buildOrgFrame(DB, "all");
  const peers = L.buildOrgFrame(DB, "peers");
  const bigten = L.buildOrgFrame(DB, "bigten");
  ok(peers.n < all.n, "excluding UCLA must shrink the frame");
  ok(peers.rows.every(r=>!/Los Angeles/.test(r.school ? r.school.school_name : "")),
     "the peer scope must contain no UCLA rows");
  eq(all.viable, true);
  eq(bigten.viable, bigten.n >= 15 && bigten.positives >= 3);
  const unknown = L.buildOrgFrame(DB, "does-not-exist");
  eq(unknown.scope.id, "all", "an unknown scope falls back to the full frame");
});

test("every experiment trains and returns metrics in range", ()=>{
  const frame = L.buildOrgFrame(DB, "all");
  const {results, best} = L.runAllExperiments(frame, 0.5);
  eq(results.length, L.EXPERIMENTS.length);
  results.forEach(r=>{
    const m = r.metrics;
    ok(m.accuracy >= 0 && m.accuracy <= 1, `${r.experiment.id} accuracy out of range`);
    ok(m.recall >= 0 && m.recall <= 1, `${r.experiment.id} recall out of range`);
    ok(m.f1 >= 0 && m.f1 <= 1, `${r.experiment.id} F1 out of range`);
    ok(m.rocAuc === null || (m.rocAuc >= 0 && m.rocAuc <= 1), `${r.experiment.id} AUC out of range`);
    eq(m.confusion.tp + m.confusion.fp + m.confusion.tn + m.confusion.fn, frame.n,
       `${r.experiment.id} confusion matrix must cover every row`);
  });
  eq(results.filter(r=>r.selected).length, 1, "exactly one model is selected");
  ok(results.every(r=>r.metrics.f1 <= best.metrics.f1 + 1e-12), "the selected model has the highest F1");
});

test("modelling is deterministic across runs", ()=>{
  const a = L.runAllExperiments(L.buildOrgFrame(DB, "all"), 0.5);
  const b = L.runAllExperiments(L.buildOrgFrame(DB, "all"), 0.5);
  a.results.forEach((r,i)=>near(r.metrics.f1, b.results[i].metrics.f1, 1e-12, r.experiment.id));
});

test("lowering the threshold cannot lower recall", ()=>{
  const frame = L.buildOrgFrame(DB, "all");
  const strict = L.runExperiment(L.EXPERIMENTS[4], frame, 0.7);
  const loose  = L.runExperiment(L.EXPERIMENTS[4], frame, 0.3);
  ok(loose.metrics.recall >= strict.metrics.recall, "a looser threshold recovers at least as many positives");
});

test("qualityReport covers every table and orders by severity", ()=>{
  const q = L.qualityReport(DB);
  eq(q.tables.length, Object.keys(DB).filter(k=>Array.isArray(DB[k])).length);
  ok(q.checks.length >= 10, "the check suite should not silently shrink");
  const rank = {high:0, medium:1, info:2};
  for(let i=1;i<q.checks.length;i++){
    ok(rank[q.checks[i-1].severity] <= rank[q.checks[i].severity], "checks must be severity-ordered");
  }
  q.checks.forEach(c=>{
    ok(c.count <= c.denominator || c.denominator === 0, `${c.id}: count exceeds its denominator`);
    ok(typeof c.action === "string" && c.action.length, `${c.id} must state an action`);
  });
});

test("quality checks report the real state of the shipped dataset", ()=>{
  const q = L.qualityReport(DB);
  eq(q.checks.find(c=>c.id === "referential_integrity").count, 0, "the shipped dataset has no orphan keys");
  eq(q.checks.find(c=>c.id === "duplicates").count, 0, "the shipped dataset has no duplicate natural keys");
  const missing = DB.organizations.filter(o=>S.isBlank(o.member_count)).length;
  ok(q.checks.find(c=>c.id === "member_count_coverage").count >= missing,
     "unusable member_count must count blanks and free text");
});

test("coverageDrift compares the same variable across two sources", ()=>{
  const d = L.coverageDrift(DB);
  ok(d.psi >= 0, "PSI is non-negative");
  eq(d.band, S.psiBand(d.psi));
  const contributions = d.buckets.reduce((a,b)=>a+b.contribution, 0);
  near(contributions, d.psi, 1e-9, "bucket contributions must sum to the reported PSI");
});

/* ---------------- corpus handling ---------------- */

test("filterCorpus tolerates null, undated and malformed items", ()=>{
  const corpus = {items:[
    {published_at:new Date().toISOString(), vertical:"news"},
    {published_at:null, vertical:"news"},
    {published_at:"not a date", vertical:"news"},
    {published_at:new Date(Date.now()-500*86400000).toISOString(), vertical:"news"},
    {published_at:new Date().toISOString(), vertical:"radio"}
  ]};
  const all = L.filterCorpus(corpus, {days:90});
  eq(all.items.length, 2, "old and undated items are excluded");
  eq(all.undated, 2, "null and unparseable dates are both counted as undated");
  const news = L.filterCorpus(corpus, {days:90, vertical:"news"});
  eq(news.items.length, 1);
  eq(L.filterCorpus(null, {days:90}).items.length, 0, "a missing corpus is not an error");
});

test("weeklySeries buckets by ISO week and stays ordered", ()=>{
  const mk = (iso)=>({published_at:iso});
  const series = L.weeklySeries([
    mk("2026-03-02T10:00:00Z"), mk("2026-03-04T10:00:00Z"),  // same Mon-start week
    mk("2026-03-10T10:00:00Z"),
    mk("bad-date")
  ]);
  eq(series.length, 2);
  eq(series[0].y, 2);
  eq(series[1].y, 1);
  ok(series[0].x < series[1].x, "weeks must be ordered");
});

test("corpusSummary reports rates over the filtered window", ()=>{
  const items = [
    {published_at:"2026-08-01T00:00:00Z", author:"A", assets:{video:1}},
    {published_at:"2026-08-02T00:00:00Z", author:null, assets:{}}
  ];
  const s = L.corpusSummary({items, undated:1, total:3}, {generated_at:"x", source:"synthetic"}, 7);
  eq(s.items, 2);
  near(s.perWeek, 2);
  near(s.mediaRate, 0.5);
  near(s.bylineRate, 0.5);
  near(s.undatedRate, 1/3);
  eq(s.source, "synthetic");
});

test("corpusSummary does not divide by zero on an empty window", ()=>{
  const s = L.corpusSummary({items:[], undated:0, total:0}, null, 30);
  eq(s.items, 0); eq(s.mediaRate, 0); eq(s.undatedRate, 0);
});

/* ---------------- report ---------------- */

console.log(`\nBruinCast Data Lab self-test — ${passed} passed, ${failed} failed\n`);
if(failed){
  fails.forEach(f=>console.error("  FAIL " + f));
  process.exit(1);
}
process.exit(0);
