/* BruinCast — Data Lab page controller.
   Owns state, filters and rendering. All statistics come from BCStats,
   all data shaping from BCLab, all drawing from BCChart. */
(function(){
  "use strict";

  const DB = window.BRUINCAST_DATA || {};
  const S = window.BCStats, L = window.BCLab, C = window.BCChart;
  const el = (id)=>document.getElementById(id);
  const esc = C.esc, fmt = C.fmt;
  const pct = (v, dp)=>v === null || v === undefined ? "—" : (v*100).toFixed(dp == null ? 1 : dp) + "%";

  const TABS = ["overview","quality","explore","models"];
  // Charts placed two-up in .chart-grid use a narrower viewBox so their labels
  // are not scaled down into illegibility.
  const CHART_W = 470;
  const DEFAULTS = {tab:"overview", scope:"all", days:"180", vertical:"", threshold:"0.5", corpus:"auto"};

  const state = Object.assign({}, DEFAULTS);
  let corpus = null;                 // normalised publishing corpus, or null
  let corpusMode = "loading";        // loading | live | synthetic | empty | error
  let corpusError = "";
  let analysis = null;               // {frame, quality, drift, models, ranAt, ms}
  let dataLastModified = null;
  const runLog = [];

  /* ================= state <-> URL ================= */

  function readHash(){
    const h = (location.hash||"").replace(/^#/,"");
    if(!h) return;
    h.split("&").forEach(p=>{
      const [k,v] = p.split("=");
      if(k && Object.prototype.hasOwnProperty.call(DEFAULTS, k)) state[k] = decodeURIComponent(v||"");
    });
    if(TABS.indexOf(state.tab) === -1) state.tab = DEFAULTS.tab;
  }

  function writeHash(){
    const parts = Object.keys(DEFAULTS)
      .filter(k=>state[k] !== DEFAULTS[k])
      .map(k=>`${k}=${encodeURIComponent(state[k])}`);
    const next = parts.length ? "#"+parts.join("&") : " ";
    if(("#"+parts.join("&")) !== location.hash) history.replaceState(null, "", next);
  }

  /* ================= corpus loading ================= */

  function lookup(){
    const ctx = L.context(DB);
    return {schoolName:ctx.schoolName, categoryName:ctx.categoryName};
  }

  function synthesise(){
    return window.BCLabMock.generateCorpus(DB.feeds||[], lookup(), 400);
  }

  function normaliseCorpus(json, sourceLabel){
    if(!json || !Array.isArray(json.items)) throw new Error("data.json has no items array");
    return {
      generated_at: json.generated_at || null,
      source: sourceLabel,
      items: json.items.filter(Boolean),
      feeds: Array.isArray(json.feeds) ? json.feeds : []
    };
  }

  /** Real export first, then the labelled synthetic stand-in. */
  function loadCorpus(){
    if(state.corpus === "error"){
      corpusMode = "error";
      corpusError = "Forced by ?corpus=error — the publishing corpus could not be read.";
      corpus = null;
      return Promise.resolve();
    }
    if(state.corpus === "empty"){
      corpusMode = "empty"; corpus = {generated_at:null, source:"empty", items:[], feeds:[]};
      return Promise.resolve();
    }
    if(state.corpus === "synthetic"){
      corpus = synthesise(); corpusMode = "synthetic";
      return Promise.resolve();
    }
    const tryFetch = (url, label)=>fetch(url, {cache:"no-store"})
      .then(r=>{ if(!r.ok) throw new Error(r.status+" "+r.statusText); return r.json(); })
      .then(j=>{ corpus = normaliseCorpus(j, label); corpusMode = "live"; });

    return tryFetch("bruincast_reader/data.json","live")
      .catch(()=>tryFetch("data.json","live"))
      .catch(err=>{
        // A missing export is expected (it is git-ignored); a malformed one is not.
        if(err && /items array/.test(err.message)){
          corpusMode = "error";
          corpusError = "A publishing export was found but could not be parsed: " + err.message;
          corpus = null;
          return;
        }
        corpus = synthesise();
        corpusMode = "synthetic";
      });
  }

  function corpusPill(){
    if(corpusMode === "live") return `<span class="pill live">Live export</span>`;
    if(corpusMode === "synthetic") return `<span class="pill sim">Simulated corpus</span>`;
    if(corpusMode === "empty") return `<span class="pill">Empty corpus</span>`;
    if(corpusMode === "error") return `<span class="pill sim">Corpus unavailable</span>`;
    return `<span class="pill">Loading…</span>`;
  }

  /* ================= analysis ================= */

  function runAnalysis(){
    const t0 = performance.now();
    setStatus("running", "Recomputing…");
    const frame = L.buildOrgFrame(DB, state.scope);
    const quality = L.qualityReport(DB);
    const drift = L.coverageDrift(DB);
    const models = frame.viable ? L.runAllExperiments(frame, Number(state.threshold)) : null;
    const filtered = L.filterCorpus(corpus, {days:Number(state.days), vertical:state.vertical});
    const summary = L.corpusSummary(filtered, corpus, Number(state.days));
    const ms = performance.now()-t0;
    analysis = {frame, quality, drift, models, filtered, summary, ranAt:new Date(), ms};
    runLog.unshift({
      at: analysis.ranAt,
      scope: frame.scope.label,
      window: state.days === "0" ? "all time" : state.days+" days",
      vertical: state.vertical ? (L.VERTICAL_LABELS[state.vertical]||state.vertical) : "all verticals",
      threshold: Number(state.threshold),
      ms,
      outcome: models
        ? `${models.results.length} experiments · best F1 ${fmt(models.best.metrics.f1,3)}`
        : `frame too small to model (n=${frame.n}, positives=${frame.positives})`
    });
    if(runLog.length > 8) runLog.length = 8;
    setStatus(corpusMode === "error" ? "error" : "ok",
      `Analysis complete · ${fmt(ms,0)} ms`);
    renderAll();
  }

  function setStatus(kind, text){
    const node = el("runStatus");
    if(!node) return;
    node.dataset.state = kind === "running" ? "running" : kind === "error" ? "error" : "ok";
    node.querySelector(".txt").textContent = text;
  }

  /* ================= shared partials ================= */

  function kpi(o){
    return `<div class="kpi ${o.tone||""}">
      <span class="k-label">${esc(o.label)}</span>
      <span class="k-value">${o.value}${o.unit?`<span class="k-unit">${esc(o.unit)}</span>`:""}</span>
      ${o.note?`<span class="k-note">${o.note}</span>`:""}
    </div>`;
  }

  function severityTag(sev){
    const labels = {high:"High", medium:"Medium", info:"Pass"};
    return `<span class="sev ${sev}">${labels[sev]||sev}</span>`;
  }

  function emptyState(title, body){
    return `<div class="empty"><h4>${esc(title)}</h4><p>${body}</p></div>`;
  }

  function skeleton(n){
    let out = "";
    for(let i=0;i<(n||1);i++) out += `<div class="skeleton"><i></i><i></i><i></i></div>`;
    return out;
  }

  const weekLabel = (x)=>new Date(x).toLocaleDateString(undefined,{month:"short", day:"numeric"});

  /* ================= overview ================= */

  function renderOverview(){
    const {frame, quality, drift, models, summary} = analysis;
    const ci = S.wilsonInterval(frame.positives, frame.n);

    el("ovKpis").innerHTML = [
      kpi({label:"Rows profiled", value:fmt(quality.totals.rows,0), unit:"records",
           note:`across ${quality.tables.length} tables`}),
      kpi({label:"Modelling rows", value:fmt(frame.n,0), unit:"orgs",
           note:`${frame.positives} positive · ${esc(frame.scope.label.toLowerCase())}`}),
      kpi({label:"Usable model features", value:fmt(L.FEATURES.length,0), unit:"features",
           note:"engineered from 3 tables · member_count excluded"}),
      kpi({label:"Missing cells", value:pct(quality.missingRate), unit:"",
           tone: quality.missingRate > 0.1 ? "warn" : "good",
           note:`${fmt(quality.totals.missing,0)} of ${fmt(quality.totals.cells,0)} cells`}),
      kpi({label:"Checks needing action", value:fmt(quality.failing,0), unit:`of ${quality.checks.length}`,
           tone: quality.failing ? "warn" : "good", note:"data-quality rules"}),
      kpi({label:"Coverage drift (PSI)", value:fmt(drift.psi,2), unit:"",
           tone: drift.band === "material" ? "bad" : drift.band === "moderate" ? "warn" : "good",
           note:`${drift.band} shift · feeds vs researched orgs`}),
      kpi({label:"Items in window", value:fmt(summary.items,0), unit:"items",
           note:`${corpusPill()} ${fmt(summary.perWeek,1)}/week`}),
      kpi({label:"Best model F1", value: models ? fmt(models.best.metrics.f1,3) : "n/a",
           unit: models ? "" : "",
           tone: models ? (models.best.metrics.f1 >= 0.6 ? "warn" : "bad") : "warn",
           note: models ? `${esc(models.best.experiment.name)} · leave-one-out CV`
                        : "scope too small to train"})
    ].join("");

    /* dataset overview card */
    const typeCounts = {};
    quality.tables.forEach(t=>t.profile.columns.forEach(c=>{ typeCounts[c.type] = (typeCounts[c.type]||0)+1; }));
    el("datasetCard").innerHTML = `
      <h3>Dataset overview</h3>
      <dl class="kv">
        <dt>Source</dt><dd><code>Student_Run_Media_Research.xlsx</code> → <code>assets/data.js</code>
          (one array per workbook tab, loaded as a browser global)</dd>
        <dt>Tables</dt><dd>${quality.tables.length} — ${quality.tables.map(t=>`${esc(t.name)} (${t.profile.rows})`).join(", ")}</dd>
        <dt>Shape</dt><dd>${fmt(quality.totals.rows,0)} rows · ${fmt(quality.totals.cells,0)} cells ·
          ${quality.tables.reduce((a,t)=>a+t.profile.columns.length,0)} columns</dd>
        <dt>Feature types</dt><dd>${Object.keys(typeCounts).sort().map(k=>
          `<span class="tag">${esc(k)}: ${typeCounts[k]}</span>`).join(" ")}</dd>
        <dt>Unit of analysis</dt><dd>One student-media organization (<code>organizations</code>)</dd>
        <dt>Target variable</dt><dd><code>is_cited_model</code> — the organization is named in
          <code>ucla_recommendations.model_to_copy</code> as a program UCLA should copy.
          Derived at load time from the live recommendation text.</dd>
        <dt>Class balance</dt><dd>${frame.positives} positive / ${frame.n - frame.positives} negative
          (${pct(frame.positiveRate)}, 95% CI ${pct(ci.low)}–${pct(ci.high)}) — imbalanced and small,
          so recall is reported alongside every accuracy figure.</dd>
        <dt>Publishing corpus</dt><dd>${corpusPill()} ${summary.generatedAt
          ? "generated "+esc(new Date(summary.generatedAt).toLocaleString())
          : corpusMode === "error" ? esc(corpusError) : "not generated"}</dd>
        <dt>Last updated</dt><dd>${dataLastModified
          ? esc(dataLastModified.toLocaleString())+" (Last-Modified of assets/data.js)"
          : "unknown — the export carries no timestamp"}</dd>
      </dl>
      <p class="provenance">Label provenance: ${frame.rows.filter(r=>r.label===1).length} organizations matched a
        recommendation. Each match is listed with its citation in the
        <a href="#" data-goto="models">Models</a> tab.</p>`;

    /* publishing trend */
    renderTrend("ovTrend");

    /* alerts */
    el("alerts").innerHTML = buildAlerts().map(a=>`
      <div class="check">
        <div class="row1">${severityTag(a.severity)}<h4>${esc(a.title)}</h4></div>
        <p>${a.body}</p>
        ${a.action?`<p class="action"><b>Next:</b> ${a.action}</p>`:""}
      </div>`).join("");

    /* recommended actions */
    el("actions").innerHTML = buildActions().map((a,i)=>`
      <li><strong>${esc(a.title)}</strong><br><span class="k-note">${a.body}</span></li>`).join("");

    /* run log */
    el("runlog").innerHTML = `<div class="tablewrap"><table>
      <caption class="visually-hidden">Analyses run in this session</caption>
      <thead><tr><th scope="col">Run at</th><th scope="col">Scope</th><th scope="col">Window</th>
        <th scope="col">Vertical</th><th scope="col">Threshold</th><th scope="col">Duration</th>
        <th scope="col">Outcome</th></tr></thead><tbody>` +
      runLog.map(r=>`<tr>
        <td>${esc(r.at.toLocaleTimeString())}</td><td>${esc(r.scope)}</td><td>${esc(r.window)}</td>
        <td>${esc(r.vertical)}</td><td class="num">${fmt(r.threshold,2)}</td>
        <td class="num">${fmt(r.ms,0)} ms</td><td>${esc(r.outcome)}</td></tr>`).join("") +
      `</tbody></table></div>`;
  }

  function buildAlerts(){
    const {quality, drift, frame, models, summary} = analysis;
    const out = [];
    quality.checks.filter(c=>c.severity === "high" && c.count > 0).forEach(c=>{
      out.push({severity:"high", title:c.label,
        body:`${esc(c.detail)}`, action:esc(c.action)});
    });
    if(drift.band === "material"){
      const top = drift.buckets[0];
      out.push({severity:"medium",
        title:`Feed coverage does not match the researched landscape (PSI ${fmt(drift.psi,2)})`,
        body:`The largest gap is <strong>${esc(top.bucket)}</strong>: ${pct(top.referenceShare,0)} of researched
              organizations but ${pct(top.comparisonShare,0)} of registered feeds. Any trend read off the feed
              corpus is weighted toward the over-covered verticals.`,
        action:"Add feeds for the under-covered verticals before treating corpus trends as landscape trends."});
    }
    if(corpusMode === "synthetic"){
      out.push({severity:"medium", title:"Publishing figures are simulated",
        body:`No <code>bruincast_reader/data.json</code> was found, so every item-level number on this page comes
              from a seeded, clearly-labelled stand-in built from the real feed registry.`,
        action:`Run <code>python3 ingest.py fetch &amp;&amp; python3 ingest.py export</code> in
                <code>bruincast_reader/</code>; the page prefers the real export automatically.`});
    }
    if(corpusMode === "error"){
      out.push({severity:"high", title:"Publishing corpus could not be read",
        body:esc(corpusError), action:"Re-export from the ingester, then reload."});
    }
    if(models && models.best.metrics.recall < 0.7){
      out.push({severity:"medium", title:"The leading model misses most positive cases",
        body:`Recall at threshold ${fmt(Number(state.threshold),2)} is ${pct(models.best.metrics.recall)} —
              ${models.best.metrics.confusion.fn} of ${frame.positives} cited programs are not recovered.
              Treat the score as a ranking aid, not a decision rule.`,
        action:"Lower the decision threshold for screening, or label more organizations before retraining."});
    }
    if(!frame.viable){
      out.push({severity:"high", title:"Current scope is too small to model",
        body:`${frame.n} rows with ${frame.positives} positives is below the floor of 15 rows / 3 positives
              this dashboard will train on.`,
        action:"Widen the analysis scope."});
    }
    if(summary.undated > 0){
      out.push({severity:"medium", title:"Items without a usable publish date",
        body:`${summary.undated} of ${fmt(analysis.filtered.total,0)} corpus items (${pct(summary.undatedRate)})
              carry no parseable <code>published_at</code> and are excluded from every time series.`,
        action:"Fall back to the fetch timestamp during ingest so undated items still land on the timeline."});
    }
    return out;
  }

  function buildActions(){
    const {quality, drift, models, frame} = analysis;
    const out = [];
    const feedCheck = quality.checks.find(c=>c.id === "feed_validation");
    if(feedCheck && feedCheck.count){
      out.push({title:"Run the ingester once end to end",
        body:`${feedCheck.count} of ${feedCheck.denominator} feeds have never returned a validated fetch, so no
              real item-level data exists yet. This is the single change that turns the simulated half of this
              page into measurement.`});
    }
    const under = (drift.buckets||[]).filter(b=>b.comparisonShare < b.referenceShare).slice(0,2);
    if(under.length){
      out.push({title:"Close the feed-coverage gap in "+under.map(b=>b.bucket).join(" and "),
        body:`These verticals are ${under.map(b=>`${esc(b.bucket)} (${pct(b.referenceShare,0)} of orgs vs
              ${pct(b.comparisonShare,0)} of feeds)`).join(", ")}. Adding feeds there is what moves PSI back
              under 0.25.`});
    }
    out.push({title:"Split member_count into a number and a note",
      body:`Only ${frame.n ? fmt(analysis.frame.rows.filter(r=>r.members.status === "ok").length,0) : 0}
            organizations yield a usable headcount today, which is why programme size — plausibly the strongest
            predictor available — is absent from every model on this page.`});
    if(models){
      out.push({title:"Label more organizations before trusting the score",
        body:`The target has ${frame.positives} positives. At that size a leave-one-out F1 of
              ${fmt(models.best.metrics.f1,3)} carries a confidence interval wide enough to include
              "no better than the rule baseline". Use the ranking to choose what to research next, not to
              conclude which programmes are strong.`});
    }
    return out;
  }

  /* ================= data quality ================= */

  function renderQuality(){
    const {quality} = analysis;

    el("qKpis").innerHTML = [
      kpi({label:"Tables profiled", value:fmt(quality.tables.length,0), unit:"tables",
           note:`${fmt(quality.totals.rows,0)} rows`}),
      kpi({label:"Missing-cell rate", value:pct(quality.missingRate), unit:"",
           tone: quality.missingRate > 0.1 ? "warn" : "good",
           note:`${fmt(quality.totals.missing,0)} empty cells`}),
      kpi({label:"Duplicate keys", value:fmt((quality.checks.find(c=>c.id==="duplicates")||{}).count||0,0),
           unit:"groups", tone:"good", note:"organizations, feeds, sources"}),
      kpi({label:"Orphaned foreign keys",
           value:fmt((quality.checks.find(c=>c.id==="referential_integrity")||{}).count||0,0), unit:"rows",
           tone:"good", note:"6 relationships checked"}),
      kpi({label:"Outliers flagged",
           value:fmt((quality.checks.find(c=>c.id==="founded_year_outliers")||{}).count||0,0), unit:"values",
           note:"founded_year, 1.5 × IQR"}),
      kpi({label:"Drift band", value:esc(analysis.drift.band), unit:"",
           tone: analysis.drift.band === "material" ? "bad" : analysis.drift.band === "moderate" ? "warn" : "good",
           note:`PSI ${fmt(analysis.drift.psi,2)}`})
    ].join("");

    el("qTables").innerHTML = `<div class="tablewrap"><table>
      <caption class="visually-hidden">Row, column and missing-value counts for every table</caption>
      <thead><tr><th scope="col">Table</th><th scope="col">Role</th><th scope="col">Rows</th>
        <th scope="col">Columns</th><th scope="col">Missing cells</th><th scope="col">Missing rate</th>
        <th scope="col">Constant columns</th></tr></thead><tbody>` +
      quality.tables.map(t=>`<tr>
        <td class="mono">${esc(t.name)}</td>
        <td><span class="tag">${esc(t.role)}</span></td>
        <td class="num">${fmt(t.profile.rows,0)}</td>
        <td class="num">${fmt(t.profile.columns.length,0)}</td>
        <td class="num">${fmt(t.profile.missingCells,0)}</td>
        <td class="num">${pct(t.profile.missingRate)}</td>
        <td>${t.profile.columns.filter(c=>c.constant).map(c=>`<span class="tag">${esc(c.name)}</span>`).join(" ")||"—"}</td>
      </tr>`).join("") + `</tbody></table></div>`;

    const orgProfile = quality.tables.find(t=>t.name === "organizations");
    const missCols = orgProfile.profile.columns
      .filter(c=>c.missing > 0)
      .sort((a,b)=>b.missing-a.missing)
      .map(c=>({label:c.name, value:c.missingRate*100,
                display:`${c.missing} (${(c.missingRate*100).toFixed(0)}%)`,
                tip:`${c.name}: ${c.missing} of ${orgProfile.profile.rows} rows missing (${(c.missingRate*100).toFixed(1)}%) · type ${c.type}`}));
    el("qMissing").innerHTML = missCols.length
      ? C.hbar({title:"Missing values by column — organizations", unit:"% of rows",
          xTitle:"% of rows with no value", categoryTitle:"Column", data:missCols,
          subtitle:`${orgProfile.profile.rows} rows. Columns with full coverage are omitted.`})
      : emptyState("No missing values", "Every column in <code>organizations</code> is fully populated.");

    el("qChecks").innerHTML = quality.checks.map(c=>{
      const rate = c.denominator ? c.count/c.denominator : 0;
      return `<div class="check">
        <div class="row1">${severityTag(c.severity)}<h4>${esc(c.label)}</h4>
          <span class="tag">${esc(c.table)}</span>
          <span class="tag blue">${esc(c.kind)}</span>
          <span class="k-note">${fmt(c.count,0)} of ${fmt(c.denominator,0)} rows</span></div>
        <div class="meter" role="img" aria-label="${esc(fmt(rate*100,0))}% of rows affected">
          <i class="${c.severity}" style="width:${Math.max(1,Math.min(100,rate*100)).toFixed(1)}%"></i></div>
        <p>${esc(c.detail)}</p>
        <p class="action"><b>Action:</b> ${esc(c.action)}</p>
      </div>`;
    }).join("");

    renderDrift("qDrift");
  }

  function renderDrift(target){
    const d = analysis.drift;
    const cats = Object.keys(d.reference).sort((a,b)=>(d.reference[b]||0)-(d.reference[a]||0));
    const total = (o)=>Object.keys(o).reduce((a,k)=>a+o[k],0);
    const rTot = total(d.reference), cTot = total(d.comparison);
    el(target).innerHTML =
      C.groupedBar({
        title:"Coverage drift — researched landscape vs ingested feeds",
        subtitle:`Share of each category, normalised within its own source. PSI ${fmt(d.psi,3)} (${d.band} shift; under 0.10 is stable, over 0.25 is material).`,
        categories:cats, categoryTitle:"Category", unit:"% of source", yTitle:"% of source",
        series:[
          {name:`${d.referenceLabel} (n=${rTot})`, color:C.PALETTE[0],
           values:cats.map(c=>+(100*(d.reference[c]||0)/rTot).toFixed(1))},
          {name:`${d.comparisonLabel} (n=${cTot})`, color:C.PALETTE[2],
           values:cats.map(c=>+(100*(d.comparison[c]||0)/cTot).toFixed(1))}
        ]}) +
      `<div class="card"><h3>What drives the drift</h3>
        <div class="tablewrap"><table>
        <thead><tr><th scope="col">Category</th><th scope="col">Researched share</th>
          <th scope="col">Feed share</th><th scope="col">PSI contribution</th></tr></thead><tbody>` +
        d.buckets.map(b=>`<tr><td>${esc(b.bucket)}</td>
          <td class="num">${pct(b.referenceShare,1)}</td>
          <td class="num">${pct(b.comparisonShare,1)}</td>
          <td class="num">${fmt(b.contribution,3)}</td></tr>`).join("") +
        `</tbody></table></div>
        <p class="provenance">PSI compares two distributions of the same variable. Here it answers a concrete
        question: is what the ingester collects representative of the landscape the research describes?</p></div>`;
  }

  /* ================= exploration ================= */

  function renderTrend(target){
    const node = el(target);
    if(corpusMode === "error"){
      node.innerHTML = `<div class="err">Publishing corpus unavailable — ${esc(corpusError)}
        <br>Charts that depend on item-level data are hidden until it loads.</div>`;
      return;
    }
    const items = analysis.filtered.items;
    if(!items.length){
      node.innerHTML = emptyState("No items in this window",
        `No published items match ${state.vertical?`the <strong>${esc(L.VERTICAL_LABELS[state.vertical]||state.vertical)}</strong> vertical in `:""}the selected date range. Widen the range or clear the vertical filter.`);
      return;
    }
    const series = L.weeklySeries(items);
    node.innerHTML = C.line({
      title:"Publishing volume per week",
      subtitle:`${fmt(items.length,0)} items · ${state.vertical?esc(L.VERTICAL_LABELS[state.vertical]||state.vertical):"all verticals"} · ${corpusMode === "synthetic" ? "simulated corpus" : "live export"}`,
      xTitle:"Week beginning", yTitle:"items published", unit:"items",
      xFormat:weekLabel,
      series:[{name:"Items", color:C.PALETTE[0], points:series}]
    });
  }

  function renderExplore(){
    const {frame, filtered} = analysis;
    renderTrend("exTrend");

    /* corpus composition */
    const node = el("exCorpus");
    if(corpusMode === "error" || !filtered.items.length){
      node.innerHTML = corpusMode === "error"
        ? `<div class="err">Corpus unavailable — vertical and media charts need item-level data.</div>`
        : emptyState("Nothing to summarise", "No corpus items fall inside the current filters.");
    } else {
      const byVertical = L.countBy(filtered.items, "vertical");
      const vData = Object.keys(byVertical).map(k=>({
        label: L.VERTICAL_LABELS[k]||k, value: byVertical[k], display: fmt(byVertical[k],0),
        tip:`${L.VERTICAL_LABELS[k]||k}: ${byVertical[k]} items (${pct(byVertical[k]/filtered.items.length)} of the window)`
      })).sort((a,b)=>b.value-a.value);

      const mediaByVertical = {};
      filtered.items.forEach(i=>{
        const k = L.VERTICAL_LABELS[i.vertical]||i.vertical||"Unknown";
        if(!mediaByVertical[k]) mediaByVertical[k] = {n:0, media:0};
        mediaByVertical[k].n++;
        if(i.assets && Object.keys(i.assets).length) mediaByVertical[k].media++;
      });
      const mData = Object.keys(mediaByVertical)
        .map(k=>({label:k, value:100*mediaByVertical[k].media/mediaByVertical[k].n,
                  display:`${(100*mediaByVertical[k].media/mediaByVertical[k].n).toFixed(0)}%`,
                  tip:`${k}: ${mediaByVertical[k].media} of ${mediaByVertical[k].n} items carry an audio, video or image asset`}))
        .sort((a,b)=>b.value-a.value);

      node.innerHTML =
        C.hbar({title:"Items by vertical", subtitle:"Where the tracked outlets actually publish.",
          unit:"items", xTitle:"items in window", categoryTitle:"Vertical", data:vData, width:CHART_W}) +
        C.hbar({title:"Media attachment rate by vertical",
          subtitle:"Share of items carrying an audio, video or image asset — the closest proxy the feed layer has for broadcast output.",
          unit:"%", xTitle:"% of items with a media asset", categoryTitle:"Vertical", data:mData,
          width:CHART_W});
    }

    /* research-set distributions */
    const years = frame.rows.map(r=>L.parseFoundedYear(r.org.founded_year))
      .filter(y=>y.status === "ok").map(y=>y.value);
    el("exYears").innerHTML = years.length
      ? C.histogram({title:"Founding year of organizations in scope",
          subtitle:`${years.length} of ${frame.n} organizations record a founding year; the remaining ${frame.n-years.length} are median-imputed for modelling.`,
          bins:S.histogram(years, 10), xTitle:"founding year", yTitle:"organizations",
          unit:"organizations", width:CHART_W})
      : emptyState("No founding years in scope", "No organization in this scope records a founding year.");

    /* positive rate by category */
    const byCat = {};
    frame.rows.forEach(r=>{
      const k = r.category ? r.category.category_name : "Unknown";
      if(!byCat[k]) byCat[k] = {n:0, pos:0};
      byCat[k].n++; byCat[k].pos += r.label;
    });
    const catData = Object.keys(byCat).map(k=>({
      label:`${k} (n=${byCat[k].n})`, value:100*byCat[k].pos/byCat[k].n,
      display:`${(100*byCat[k].pos/byCat[k].n).toFixed(0)}%`,
      highlight: byCat[k].pos > 0,
      tip:`${k}: ${byCat[k].pos} of ${byCat[k].n} organizations are cited as a model UCLA should copy`
    })).sort((a,b)=>b.value-a.value);
    el("exSegments").innerHTML = C.hbar({
      title:"Cited-model rate by category",
      subtitle:`Share of organizations in each category that a UCLA recommendation names as a model to copy. Base rate across the whole scope is ${pct(frame.positiveRate,0)}. Small denominators — read the counts, not just the bars.`,
      unit:"%", xTitle:"% of category cited as a model", categoryTitle:"Category",
      data:catData, width:CHART_W, labelWidth:200});

    /* correlations */
    const keys = L.FEATURES.map(f=>f.key);
    const cols = {};
    keys.forEach(k=>{ cols[(L.FEATURES.find(f=>f.key===k)||{}).label || k] = frame.rows.map(r=>r.features[k]); });
    cols["is_cited_model (target)"] = frame.rows.map(r=>r.label);
    const cm = S.correlationMatrix(cols);
    el("exCorr").innerHTML = C.heatmap({
      title:"Feature correlation matrix",
      subtitle:"Pearson r over pairwise-complete rows, target included. A dot means the pair has no variance to correlate. Correlation is association, not cause.",
      labels:cm.labels, matrix:cm.matrix});

    /* relationship scatter */
    const groups = [
      {name:"Cited as a model", color:C.PALETTE[0], shape:"square",
       points:frame.rows.filter(r=>r.label === 1 && S.isNum(r.ageYears)).map(r=>({
         x:r.ageYears, y:r.features.feeds_registered + r.features.brands_listed, label:r.org.org_name}))},
      {name:"Not cited", color:C.PALETTE[3], shape:"circle",
       points:frame.rows.filter(r=>r.label === 0 && S.isNum(r.ageYears)).map(r=>({
         x:r.ageYears, y:r.features.feeds_registered + r.features.brands_listed, label:r.org.org_name}))}
    ];
    el("exScatter").innerHTML = C.scatter({
      title:"Organization age against tracked output surfaces",
      subtitle:"Only organizations with a recorded founding year appear; age is never imputed in this chart. Output surfaces = registered feeds + named brands or shows.",
      xTitle:"age in years", yTitle:"output surfaces", groups, width:CHART_W});
  }

  /* ================= models ================= */

  function renderModels(){
    const {frame, models} = analysis;

    el("mTask").innerHTML = `
      <h3>What is being modelled, and why</h3>
      <dl class="kv">
        <dt>Question</dt><dd>Which structural traits separate the student-media programmes that UCLA's own
          recommendations single out as models to copy?</dd>
        <dt>Task</dt><dd>Binary classification on ${frame.n} organizations
          (${frame.positives} positive, ${pct(frame.positiveRate)}). Classification metrics only —
          there is no continuous target here, so RMSE, MAE and R² would be meaningless.</dd>
        <dt>Decision it supports</dt><dd>Ranking organizations that are <em>not</em> cited yet by how much they
          resemble the cited ones, to choose what to research next. It does not score programme quality.</dd>
        <dt>Validation</dt><dd>Leave-one-out cross-validation. Standardisation is refitted inside each fold, so
          held-out rows never inform the scaling.</dd>
        <dt>Deployment status</dt><dd><span class="sev high">Not deployed</span>
          Nothing here is production-ready: ${frame.positives} positive examples is far too few, the label is
          derived from the same research that generated the features, and both come from one analyst's workbook.</dd>
      </dl>`;

    if(!frame.viable || !models){
      el("mResults").innerHTML = emptyState("Not enough labelled data in this scope",
        `<strong>${frame.n} rows with ${frame.positives} positive examples</strong> is below the floor this
         dashboard will train on (15 rows, 3 positives, at least one of each class). Cross-validated metrics on a
         frame this small would be noise presented as evidence.<br><br>
         Choose a wider analysis scope to train, or add labelled organizations to the workbook.`);
      return;
    }

    const rows = models.results.map(r=>{
      const m = r.metrics, e = r.experiment;
      return `<tr class="${r.selected?"selected-model":""}">
        <td class="mono">${esc(e.id)}</td>
        <td><strong>${esc(e.name)}</strong><br><span class="k-note">${esc(e.summary)}</span></td>
        <td class="mono">${esc(e.version)}</td>
        <td>${r.selected
              ? `<span class="sev medium">Selected</span>`
              : `<span class="sev neutral">Evaluated</span>`}<br>
            <span class="k-note">${esc(r.validation)}</span></td>
        <td class="num">${fmt(r.featureCount,0)}</td>
        <td class="num">${fmt(m.accuracy,3)}</td>
        <td class="num">${m.precision === null ? "—" : fmt(m.precision,3)}</td>
        <td class="num">${fmt(m.recall,3)}</td>
        <td class="num"><strong>${fmt(m.f1,3)}</strong></td>
        <td class="num">${m.rocAuc === null ? "—" : fmt(m.rocAuc,3)}</td>
        <td>${esc(analysis.ranAt.toLocaleString())}</td>
      </tr>`;
    }).join("");

    el("mResults").innerHTML = `
      <div class="tablewrap"><table>
        <caption class="visually-hidden">Experiment comparison</caption>
        <thead><tr>
          <th scope="col">ID</th><th scope="col">Model</th><th scope="col">Version</th>
          <th scope="col">Status</th><th scope="col">Features</th><th scope="col">Accuracy</th>
          <th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">F1</th>
          <th scope="col">ROC-AUC</th><th scope="col">Trained</th>
        </tr></thead><tbody>${rows}</tbody></table></div>
      <p class="provenance">All five experiments are trained in your browser when the analysis runs — the numbers
        above are computed, not stored. Selection rule: highest F1 at the current decision threshold
        (${fmt(Number(state.threshold),2)}), ties broken on ROC-AUC. <strong>Selected ≠ deployed:</strong> no model
        from this page serves traffic anywhere.</p>`;

    const best = models.best;
    const m = best.metrics;
    el("mBestKpis").innerHTML = [
      kpi({label:"Selected model", value:esc(best.experiment.id), unit:"",
           note:esc(best.experiment.name)}),
      kpi({label:"F1 (LOO-CV)", value:fmt(m.f1,3), unit:"",
           tone: m.f1 >= 0.6 ? "warn" : "bad", note:`at threshold ${fmt(Number(state.threshold),2)}`}),
      kpi({label:"Precision", value:fmt(m.precision,3), unit:"",
           note:`${m.confusion.tp} of ${m.confusion.tp+m.confusion.fp} flagged are truly cited`}),
      kpi({label:"Recall", value:fmt(m.recall,3), unit:"",
           tone: m.recall < 0.7 ? "warn" : "good",
           note:`${m.confusion.fn} of ${m.positives} cited programmes missed`}),
      kpi({label:"ROC-AUC", value:fmt(m.rocAuc,3), unit:"",
           note:"ranking quality; 0.5 = random"}),
      kpi({label:"Accuracy", value:fmt(m.accuracy,3), unit:"",
           note:`baseline for always predicting "not cited" is ${fmt(1-frame.positiveRate,3)}`})
    ].join("");

    el("mRoc").innerHTML = C.roc({
      title:"ROC curve — selected model",
      subtitle:`Out-of-fold scores from ${best.validation}. Every point is one decision threshold.`,
      points:S.rocCurve(frame.rows.map(r=>r.label), best.scores), auc:m.rocAuc});

    el("mConfusion").innerHTML = `
      <figure class="chart"><figcaption>
        <h4>Confusion matrix at threshold ${fmt(Number(state.threshold),2)}</h4>
        <p>Counts of out-of-fold predictions against the derived label.</p></figcaption>
        <div class="tablewrap"><table>
          <thead><tr><th scope="col"></th><th scope="col">Predicted: cited</th>
            <th scope="col">Predicted: not cited</th></tr></thead>
          <tbody>
            <tr><th scope="row">Actually cited</th>
              <td class="num">${m.confusion.tp} <span class="k-note">true positive</span></td>
              <td class="num">${m.confusion.fn} <span class="k-note">false negative</span></td></tr>
            <tr><th scope="row">Actually not cited</th>
              <td class="num">${m.confusion.fp} <span class="k-note">false positive</span></td>
              <td class="num">${m.confusion.tn} <span class="k-note">true negative</span></td></tr>
          </tbody></table></div>
        <p class="provenance">Move the decision threshold in the filter bar to trade precision against recall.</p>
      </figure>`;

    el("mCoef").innerHTML = best.coefficients
      ? C.coefficients({
          title:"Feature influence — standardised coefficients",
          subtitle:"Log-odds change per one standard deviation of each feature, fitted on all rows in scope. With this few positives, treat the ordering as a hypothesis to test, not a finding.",
          data:best.coefficients})
      : emptyState("No coefficients", "The selected model is a hand-written rule, so it has no fitted parameters.");

    /* shortlist: the actual decision output */
    const ranked = frame.rows.map((r,i)=>({row:r, score:best.scores[i]}))
      .filter(d=>d.row.label === 0)
      .sort((a,b)=>b.score-a.score)
      .slice(0,8);
    el("mShortlist").innerHTML = `
      <h3>Screening shortlist — not yet cited, most similar to those that are</h3>
      <p class="sub">Out-of-fold scores from the selected model, highest first. This is the output a researcher
        would actually use: a reading order, not a verdict.</p>
      <div class="tablewrap"><table>
        <thead><tr><th scope="col">Organization</th><th scope="col">School</th>
          <th scope="col">Category</th><th scope="col">Score</th><th scope="col">Above threshold</th>
        </tr></thead><tbody>` +
      ranked.map(d=>`<tr>
        <td><strong>${esc(d.row.org.org_name)}</strong></td>
        <td>${esc(d.row.school ? d.row.school.school_name : "—")}</td>
        <td>${esc(d.row.category ? d.row.category.category_name : "—")}</td>
        <td class="num">${fmt(d.score,3)}</td>
        <td>${d.score >= Number(state.threshold)
              ? `<span class="sev medium">Yes</span>` : `<span class="sev neutral">No</span>`}</td>
      </tr>`).join("") + `</tbody></table></div>`;

    /* label provenance */
    el("mLabels").innerHTML = `
      <h3>Label provenance</h3>
      <p class="sub">Every positive label traces to a sentence in the research. Nothing is hand-assigned here.</p>
      <div class="tablewrap"><table>
        <thead><tr><th scope="col">Organization</th><th scope="col">Cited in recommendation</th>
          <th scope="col">model_to_copy text</th></tr></thead><tbody>` +
      frame.rows.filter(r=>r.label === 1).map(r=>`<tr>
        <td><strong>${esc(r.org.org_name)}</strong></td>
        <td class="num">${r.evidence.map(e=>"#"+esc(e.rec_id)).join(", ")}</td>
        <td>${r.evidence.map(e=>esc(e.model_to_copy)).join(" · ")}</td></tr>`).join("") +
      `</tbody></table></div>
      <p class="provenance">Feature dictionary and imputation are listed under
        <a href="#" data-goto="quality">Data quality</a>. Imputed this run:
        ${Object.keys(frame.imputation).filter(k=>frame.imputation[k].n)
          .map(k=>`<code>${esc(k)}</code> ${frame.imputation[k].n} rows (${esc(frame.imputation[k].strategy)} = ${fmt(frame.imputation[k].value,2)})`)
          .join(", ") || "nothing"}.</p>`;

    el("mFeatures").innerHTML = `
      <h3>Feature dictionary</h3>
      <div class="tablewrap"><table>
        <thead><tr><th scope="col">Feature</th><th scope="col">Unit</th><th scope="col">Type</th>
          <th scope="col">Source column</th><th scope="col">Definition</th></tr></thead><tbody>` +
      L.FEATURES.map(f=>`<tr>
        <td class="mono">${esc(f.key)}</td><td>${esc(f.unit)}</td><td>${esc(f.type)}</td>
        <td class="mono">${esc(f.source)}</td><td>${esc(f.desc)}</td></tr>`).join("") +
      `</tbody></table></div>`;
  }

  /* ================= render orchestration ================= */

  function renderAll(){
    if(!analysis) return;
    renderOverview();
    renderQuality();
    renderExplore();
    renderModels();
    el("foot").innerHTML =
      `Data Lab · research dataset from <code>Student_Run_Media_Research.xlsx</code> · publishing corpus:
       ${corpusMode === "live" ? "live ingester export" : corpusMode === "synthetic"
         ? "simulated stand-in (assets/lab-mock.js)" : esc(corpusMode)} ·
       last analysis ${esc(analysis.ranAt.toLocaleString())} in ${fmt(analysis.ms,0)} ms.`;
  }

  function showTab(tab){
    state.tab = TABS.indexOf(tab) === -1 ? "overview" : tab;
    TABS.forEach(t=>{
      el(t).hidden = (t !== state.tab);
      const btn = document.querySelector(`#labnav button[data-t="${t}"]`);
      if(btn){
        btn.setAttribute("aria-selected", String(t === state.tab));
        btn.tabIndex = t === state.tab ? 0 : -1;
      }
    });
    writeHash();
  }

  /* ================= filters ================= */

  function buildFilters(){
    el("fScope").innerHTML = L.SCOPES.map(s=>
      `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");
    const verticals = Array.from(new Set((DB.feeds||[]).map(f=>f.vertical).filter(Boolean))).sort();
    el("fVertical").innerHTML = `<option value="">All verticals</option>` +
      verticals.map(v=>`<option value="${esc(v)}">${esc(L.VERTICAL_LABELS[v]||v)}</option>`).join("");
    syncFilters();
  }

  function syncFilters(){
    el("fScope").value = state.scope;
    el("fDays").value = state.days;
    el("fVertical").value = state.vertical;
    el("fThreshold").value = state.threshold;
    const scope = L.SCOPES.find(s=>s.id === state.scope) || L.SCOPES[0];
    el("scopeHint").innerHTML = `<strong>${esc(scope.label)}:</strong> ${esc(scope.note)}
      Date range and vertical filter the publishing corpus; scope and threshold drive the models.
      Data-quality checks always run against the full dataset.`;
  }

  function bindFilters(){
    ["fScope","fDays","fVertical","fThreshold"].forEach(id=>{
      el(id).addEventListener("change", ()=>{
        state.scope = el("fScope").value;
        state.days = el("fDays").value;
        state.vertical = el("fVertical").value;
        state.threshold = el("fThreshold").value;
        syncFilters(); writeHash(); runAnalysis();
      });
    });
    el("rerun").addEventListener("click", runAnalysis);
    el("reset").addEventListener("click", ()=>{
      const tab = state.tab;
      Object.assign(state, DEFAULTS, {tab});
      syncFilters(); writeHash(); runAnalysis();
    });

    const nav = el("labnav");
    nav.addEventListener("click", e=>{
      const b = e.target.closest("button[data-t]");
      if(b) showTab(b.dataset.t);
    });
    nav.addEventListener("keydown", e=>{
      if(e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.indexOf(state.tab);
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length-1)) % TABS.length];
      showTab(next);
      const btn = document.querySelector(`#labnav button[data-t="${next}"]`);
      if(btn) btn.focus();
      e.preventDefault();
    });

    document.addEventListener("click", e=>{
      const link = e.target.closest("[data-goto]");
      if(!link) return;
      e.preventDefault();
      showTab(link.dataset.goto);
      window.scrollTo({top:0, behavior:"smooth"});
    });
  }

  /* ================= boot ================= */

  function boot(){
    readHash();
    buildFilters();
    bindFilters();
    showTab(state.tab);
    C.enableTooltips();

    // Visible loading state until the corpus resolves.
    ["ovKpis","qKpis"].forEach(id=>{ el(id).innerHTML = skeleton(1); });
    ["ovTrend","exTrend","qChecks","mResults"].forEach(id=>{ el(id).innerHTML = skeleton(2); });
    setStatus("running","Loading publishing corpus…");

    // Real "last updated" for the research dataset, straight off the asset.
    fetch("assets/data.js", {method:"HEAD"})
      .then(r=>{
        const lm = r.headers.get("Last-Modified");
        if(lm && isFinite(Date.parse(lm))) dataLastModified = new Date(lm);
      })
      .catch(()=>{})
      .then(loadCorpus)
      .then(()=>{ runAnalysis(); })
      .catch(err=>{
        corpusMode = "error";
        corpusError = err && err.message ? err.message : String(err);
        runAnalysis();
      });
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
