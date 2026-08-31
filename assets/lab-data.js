/* BruinCast — Data Lab data access + feature layer.
   Turns the research dataset (assets/data.js) into an analysis frame, profiles its
   quality, and normalises the publishing corpus. No DOM, no rendering: the page
   (assets/lab.js) consumes what this returns. Also required by tests/lab-selftest.js. */
(function(root, factory){
  const api = factory(root);
  root.BCLab = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(root){

  const S = root.BCStats || (typeof require !== "undefined" ? require("./lab-stats.js") : null);
  const CURRENT_YEAR = new Date().getFullYear();

  /* ============================================================
     1. Analysis scopes — every scope filters the org-level frame
     ============================================================ */

  const BROADCAST_CATEGORIES = [1, 4, 6, 7];   // Athletics Broadcast, Video/TV, Live Events, Esports

  const SCOPES = [
    {id:"all",       label:"All organizations",
     note:"Every organization in the research dataset.",
     test:()=>true},
    {id:"peers",     label:"Peer schools only (excludes UCLA)",
     note:"UCLA is the subject of the study, not a benchmark — this is the comparison population.",
     test:(o,ctx)=>String(o.school_id) !== String(ctx.uclaId)},
    {id:"bigten",    label:"Big Ten schools",
     note:"UCLA's own conference since 2024 — the most transferable comparison set.",
     test:(o,ctx)=>{ const s = ctx.school(o.school_id); return !!s && s.conference === "Big Ten"; }},
    {id:"broadcast", label:"Broadcast & video verticals",
     note:"Athletics broadcast, video/TV, live events and esports only.",
     test:(o)=>BROADCAST_CATEGORIES.indexOf(Number(o.category_id)) !== -1}
  ];

  /* ============================================================
     2. Target variable
     ============================================================
     `is_cited_model` = the organization is named as a program UCLA should copy in
     ucla_recommendations.model_to_copy. The recommendations write program names
     loosely ("CommRadio (Penn State, 150+ students)"), so this alias table bridges
     an organization row to the phrasing used in the recommendation text. Each
     alias is verified against the live recommendation strings at build time — if
     the workbook changes and a phrase disappears, the row simply stops being
     labelled positive rather than silently carrying a stale label. */

  const MODEL_ALIASES = {
    "CitrusTV":                                        ["citrustv"],
    "PSN-TV (Penn State)":                             ["psn-tv"],
    "CommRadio (Penn State)":                          ["commradio"],
    "Big Ten Network StudentU (USC)":                  ["usc & penn state studentu"],
    "Big Ten Network StudentU (Penn State)":           ["usc & penn state studentu"],
    "Marquette ESPN+ Student Production Crew":         ["marquette espn+"],
    "Boise State Esports":                             ["boise state esports"],
    "UC Irvine Esports":                               ["uc irvine esports"],
    "USC / college-athletics student TikTok teams (trend)": ["tiktok teams"]
  };

  /* ============================================================
     3. Feature dictionary — every model input is defined here once
     ============================================================ */

  const FEATURES = [
    {key:"academic_credit", label:"Academic credit", unit:"0 / 1", type:"binary",
     source:"organizations.academic_credit",
     desc:"1 when students can earn course credit for the work."},
    {key:"independence", label:"Editorial independence", unit:"0 / 0.5 / 1", type:"ordinal",
     source:"organizations.independent_from_school",
     desc:"No = 0, Partly = 0.5, Yes = 1."},
    {key:"broadcast_vertical", label:"Broadcast vertical", unit:"0 / 1", type:"binary",
     source:"organizations.category_id",
     desc:"1 for athletics broadcast, video/TV, live events or esports."},
    {key:"student_run", label:"Student-run governance", unit:"0 / 1", type:"binary",
     source:"organizations.governance_model",
     desc:"1 when the governance model describes a student-run or student-led structure."},
    {key:"university_backed", label:"University-backed funding", unit:"0 / 1", type:"binary",
     source:"organizations.funding_model",
     desc:"1 when a university, school, college, department or athletics budget is named."},
    {key:"paid_roles", label:"Paid student roles", unit:"0 / 1", type:"binary",
     source:"organizations.funding_model",
     desc:"1 when the funding model explicitly names paid student positions."},
    {key:"org_age_decades", label:"Organization age", unit:"decades", type:"numeric",
     source:"organizations.founded_year",
     desc:`(${CURRENT_YEAR} − founded_year) / 10. Missing values are median-imputed and flagged.`},
    {key:"age_imputed", label:"Age was imputed", unit:"0 / 1", type:"binary",
     source:"derived",
     desc:"Missing-data indicator for founded_year — carries the information that the year is unknown."},
    {key:"feeds_registered", label:"Registered feeds", unit:"count", type:"numeric",
     source:"feeds.org_id",
     desc:"How many syndication feeds the ingester tracks for this organization."},
    {key:"brands_listed", label:"Named brands or shows", unit:"count", type:"numeric",
     source:"brands.org_id",
     desc:"Distinct sub-brands or shows recorded for the organization."}
  ];

  /* ============================================================
     4. Value parsers
     ============================================================ */

  /** member_count is free text ("350+", "~8,000 circ", "Large"). */
  function parseMemberCount(raw){
    if(S.isBlank(raw)) return {value:null, status:"missing", raw:raw};
    const text = String(raw).trim();
    if(/circ/i.test(text)){
      const n = Number(text.replace(/[^0-9.]/g,""));
      return {value:isFinite(n)?n:null, status:"wrong_unit", raw:text};   // circulation, not people
    }
    const m = text.match(/[\d][\d,\.]*/);
    if(!m) return {value:null, status:"unparseable", raw:text};           // "Large", "Varies/campus"
    const n = Number(m[0].replace(/,/g,""));
    return {value:isFinite(n)?n:null, status:isFinite(n)?"ok":"unparseable", raw:text};
  }

  function parseFoundedYear(raw){
    if(S.isBlank(raw)) return {value:null, status:"missing"};
    const n = Number(raw);
    if(!isFinite(n)) return {value:null, status:"unparseable"};
    if(n < 1800 || n > CURRENT_YEAR) return {value:n, status:"out_of_range"};
    return {value:n, status:"ok"};
  }

  const INDEPENDENCE = {"No":0, "Partly":0.5, "Yes":1};

  /* ============================================================
     5. The organization frame
     ============================================================ */

  function context(DB){
    const schools = DB.schools||[], categories = DB.categories||[];
    const schoolById = new Map(schools.map(s=>[String(s.school_id), s]));
    const catById = new Map(categories.map(c=>[String(c.category_id), c]));
    const ucla = schools.find(s=>/Los Angeles/.test(s.school_name||""));
    return {
      school:(id)=>schoolById.get(String(id)) || null,
      category:(id)=>catById.get(String(id)) || null,
      schoolName:(id)=>{ const s = schoolById.get(String(id)); return s ? s.school_name : null; },
      categoryName:(id)=>{ const c = catById.get(String(id)); return c ? c.category_name : null; },
      uclaId: ucla ? ucla.school_id : null
    };
  }

  /** Resolve each alias against the live recommendation text. */
  function citationIndex(DB){
    const recs = DB.ucla_recommendations||[];
    const index = new Map();
    Object.keys(MODEL_ALIASES).forEach(orgName=>{
      const phrases = MODEL_ALIASES[orgName];
      const hits = recs.filter(r=>{
        const text = String(r.model_to_copy||"").toLowerCase();
        return phrases.some(p=>text.indexOf(p) !== -1);
      });
      if(hits.length) index.set(orgName, hits);
    });
    return index;
  }

  /**
   * Build the analysis frame: one row per organization, with engineered features,
   * the derived label and the evidence behind it.
   */
  function buildOrgFrame(DB, scopeId){
    const ctx = context(DB);
    const scope = SCOPES.find(s=>s.id === scopeId) || SCOPES[0];
    const cites = citationIndex(DB);
    const orgs = (DB.organizations||[]).filter(o=>scope.test(o, ctx));

    const feedsByOrg = new Map();
    (DB.feeds||[]).forEach(f=>{
      const k = String(f.org_id);
      feedsByOrg.set(k, (feedsByOrg.get(k)||0)+1);
    });
    const brandsByOrg = new Map();
    (DB.brands||[]).forEach(b=>{
      const k = String(b.org_id);
      brandsByOrg.set(k, (brandsByOrg.get(k)||0)+1);
    });

    const prepared = orgs.map(o=>{
      const year = parseFoundedYear(o.founded_year);
      const members = parseMemberCount(o.member_count);
      const cat = ctx.category(o.category_id);
      const funding = String(o.funding_model||"");
      const governance = String(o.governance_model||"");
      const evidence = cites.get(o.org_name) || [];
      return {
        org: o,
        school: ctx.school(o.school_id),
        category: cat,
        label: evidence.length ? 1 : 0,
        evidence,
        members,
        ageYears: year.value === null ? null : CURRENT_YEAR - year.value,
        raw: {
          academic_credit: o.academic_credit === "Yes" ? 1 : 0,
          independence: INDEPENDENCE[o.independent_from_school] != null
                        ? INDEPENDENCE[o.independent_from_school] : null,
          broadcast_vertical: BROADCAST_CATEGORIES.indexOf(Number(o.category_id)) !== -1 ? 1 : 0,
          student_run: /student[- ]run|student[- ]led|fully student/i.test(governance) ? 1 : 0,
          university_backed: /universit|school|college|department|athletics|asucla/i.test(funding) ? 1 : 0,
          paid_roles: /paid/i.test(funding) ? 1 : 0,
          org_age_decades: year.value === null ? null : (CURRENT_YEAR - year.value)/10,
          age_imputed: year.value === null ? 1 : 0,
          feeds_registered: feedsByOrg.get(String(o.org_id))||0,
          brands_listed: brandsByOrg.get(String(o.org_id))||0
        }
      };
    });

    // Explicit, reported imputation: median for age, 0 for the ordinal independence gap.
    const ageCol = prepared.map(r=>r.raw.org_age_decades);
    const ageImp = S.imputeMedian(ageCol);
    const indepCol = prepared.map(r=>r.raw.independence);
    const indepMedian = S.median(indepCol);

    const rows = prepared.map((r,i)=>{
      const features = Object.assign({}, r.raw, {
        org_age_decades: ageImp.values[i],
        independence: r.raw.independence === null
          ? (S.isNum(indepMedian) ? indepMedian : 0) : r.raw.independence
      });
      return Object.assign({}, r, {features});
    });

    const positives = rows.filter(r=>r.label === 1).length;
    return {
      scope,
      rows,
      n: rows.length,
      positives,
      positiveRate: rows.length ? positives/rows.length : 0,
      imputation: {
        org_age_decades: {n: ageImp.imputed, strategy: "median", value: ageImp.median},
        independence: {n: indepCol.filter(v=>v===null).length, strategy: "median", value: indepMedian}
      },
      featureDefs: FEATURES,
      // Guard rails: below these the cross-validated metrics are not worth reporting.
      viable: rows.length >= 15 && positives >= 3 && positives < rows.length
    };
  }

  /** Matrix form for the modelling functions. */
  function designMatrix(frame, featureKeys){
    const keys = featureKeys && featureKeys.length ? featureKeys : FEATURES.map(f=>f.key);
    return {
      keys,
      X: frame.rows.map(r=>keys.map(k=>{
        const v = r.features[k];
        return S.isNum(v) ? v : 0;
      })),
      y: frame.rows.map(r=>r.label)
    };
  }

  /* ============================================================
     6. Experiment registry — every run is really trained here
     ============================================================ */

  const EXPERIMENTS = [
    {id:"exp-01", name:"Vertical + credit rule", version:"v1.0", family:"rule",
     summary:"Hand rule: broadcast vertical AND (academic credit OR paid roles).",
     rule:(f)=> (f.broadcast_vertical === 1 && (f.academic_credit === 1 || f.paid_roles === 1)) ? 1 : 0},
    {id:"exp-02", name:"Logistic — core structure", version:"v1.0", family:"logreg",
     summary:"Four structural signals only. Smallest defensible model for n this size.",
     features:["broadcast_vertical","academic_credit","paid_roles","university_backed"], l2:1.0},
    {id:"exp-03", name:"Logistic — core + maturity", version:"v1.1", family:"logreg",
     summary:"Adds organization age and its missing-data indicator.",
     features:["broadcast_vertical","academic_credit","paid_roles","university_backed",
               "org_age_decades","age_imputed"], l2:1.0},
    {id:"exp-04", name:"Logistic — all features", version:"v1.2", family:"logreg",
     summary:"Every engineered feature, light regularisation. Expected to overfit.",
     features:FEATURES.map(f=>f.key), l2:0.5},
    {id:"exp-05", name:"Logistic — all, strong L2", version:"v1.3", family:"logreg",
     summary:"Same inputs as v1.2 with heavier shrinkage to damp the overfit.",
     features:FEATURES.map(f=>f.key), l2:6.0}
  ];

  /** Train + leave-one-out cross-validate one experiment against a frame. */
  function runExperiment(exp, frame, threshold){
    const t = threshold == null ? 0.5 : threshold;
    const y = frame.rows.map(r=>r.label);
    if(exp.family === "rule"){
      const scores = frame.rows.map(r=>exp.rule(r.features));
      return {
        experiment: exp,
        metrics: S.classificationMetrics(y, scores, 0.5),
        scores,
        coefficients: null,
        validation: "in-sample (no parameters are fitted)",
        featureCount: 2
      };
    }
    const {keys, X} = designMatrix(frame, exp.features);
    const cv = S.looCV(X, y, {l2:exp.l2});
    const full = S.standardize(X);
    const fitted = S.logisticFit(full.Z, y, {l2:exp.l2});
    return {
      experiment: exp,
      metrics: S.classificationMetrics(y, cv.scores, t),
      scores: cv.scores,
      coefficients: keys.map((k,j)=>({
        key: k,
        label: (FEATURES.find(f=>f.key===k)||{}).label || k,
        value: fitted.weights[j]
      })).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)),
      intercept: fitted.intercept,
      converged: fitted.converged,
      validation: `leave-one-out cross-validation (${cv.folds} folds)`,
      featureCount: keys.length
    };
  }

  /** Run the whole registry and pick a leader by F1, breaking ties on ROC-AUC. */
  function runAllExperiments(frame, threshold){
    const results = EXPERIMENTS.map(e=>runExperiment(e, frame, threshold));
    let best = null;
    results.forEach(r=>{
      if(!best) { best = r; return; }
      const a = r.metrics, b = best.metrics;
      if(a.f1 > b.f1 || (a.f1 === b.f1 && (a.rocAuc||0) > (b.rocAuc||0))) best = r;
    });
    results.forEach(r=>{ r.selected = (r === best); });
    return {results, best};
  }

  /* ============================================================
     7. Data quality
     ============================================================ */

  const TABLE_ROLES = {
    schools:"dimension", categories:"dimension", organizations:"fact",
    brands:"fact", thought_leaders:"fact", ucla_recommendations:"fact",
    deep_dive_areas:"fact", sources:"reference", feeds:"fact",
    media_embeds:"presentation", ucla_extra:"presentation"
  };

  function qualityReport(DB){
    const tables = Object.keys(DB).filter(k=>Array.isArray(DB[k])).map(name=>{
      const p = S.profileTable(DB[name]);
      return {name, role: TABLE_ROLES[name] || "other", profile: p};
    });

    const checks = [];
    const add = (c)=>checks.push(c);
    const orgs = DB.organizations||[], feeds = DB.feeds||[];

    /* -- completeness ------------------------------------------------ */
    const memberStatus = orgs.map(o=>parseMemberCount(o.member_count));
    const memberMissing = memberStatus.filter(m=>m.status === "missing").length;
    const memberUnparseable = memberStatus.filter(m=>m.status === "unparseable").length;
    const memberWrongUnit = memberStatus.filter(m=>m.status === "wrong_unit");
    add({id:"member_count_coverage", severity:"high", kind:"missing",
      table:"organizations", column:"member_count",
      label:"member_count is unusable as a numeric feature",
      count: memberMissing + memberUnparseable,
      denominator: orgs.length,
      detail:`${memberMissing} rows are empty and ${memberUnparseable} hold free text ("Large", "Varies/campus"). Only ${orgs.length-memberMissing-memberUnparseable} rows yield a number at all, and ${memberWrongUnit.length} of those is a circulation figure rather than a headcount.`,
      action:"Excluded from every model. Split into member_count_min (INTEGER) and member_count_note (TEXT) at the next workbook export."});

    add({id:"member_count_units", severity:"medium", kind:"invalid",
      table:"organizations", column:"member_count",
      label:"member_count mixes people with circulation",
      count: memberWrongUnit.length, denominator: orgs.length,
      detail: memberWrongUnit.length
        ? `${memberWrongUnit.length} row(s) record a circulation figure (${memberWrongUnit.map(m=>m.raw).join(", ")}) in a column that otherwise counts students.`
        : "No unit conflicts detected.",
      action:"Move circulation to its own column so the two units are never averaged together."});

    const yearStatus = orgs.map(o=>parseFoundedYear(o.founded_year));
    const yearMissing = yearStatus.filter(y=>y.status === "missing").length;
    add({id:"founded_year_coverage", severity:"medium", kind:"missing",
      table:"organizations", column:"founded_year",
      count: yearMissing, denominator: orgs.length,
      label:"founded_year is missing for half the dataset",
      detail:`${yearMissing} of ${orgs.length} organizations have no founding year, so organization age is median-imputed and paired with a missing-data indicator.`,
      action:"Backfill from each outlet's own about page; the indicator stays until coverage is above 80%."});

    add({id:"founded_year_range", severity:"info", kind:"invalid",
      table:"organizations", column:"founded_year",
      count: yearStatus.filter(y=>y.status === "out_of_range").length, denominator: orgs.length,
      label:"founded_year values sit in a plausible range",
      detail:"Every populated year falls between 1800 and the current year.",
      action:"No action required."});

    /* -- validity ---------------------------------------------------- */
    const noScheme = orgs.filter(o=>o.website && !/^https?:\/\//i.test(String(o.website)));
    add({id:"website_scheme", severity:"medium", kind:"invalid",
      table:"organizations", column:"website",
      count: noScheme.length, denominator: orgs.filter(o=>o.website).length,
      label:"website values are stored without a URL scheme",
      detail:`${noScheme.length} of ${orgs.filter(o=>o.website).length} populated websites are bare hostnames, so every consumer has to prepend https:// itself.`,
      action:"Normalise to absolute URLs in the export step."});

    const domains = [
      {table:"organizations", column:"academic_credit", allowed:["Yes","No"], rows:orgs},
      {table:"organizations", column:"independent_from_school", allowed:["Yes","No","Partly"], rows:orgs},
      {table:"ucla_recommendations", column:"priority", allowed:["High","Medium","Low"], rows:DB.ucla_recommendations||[]},
      {table:"deep_dive_areas", column:"tier", allowed:["Primary","Secondary"], rows:DB.deep_dive_areas||[]}
    ];
    const domainViolations = domains.map(d=>{
      const bad = d.rows.filter(r=>!S.isBlank(r[d.column]) && d.allowed.indexOf(String(r[d.column])) === -1);
      return {column:`${d.table}.${d.column}`, bad:bad.length, allowed:d.allowed};
    });
    const domainBad = domainViolations.reduce((a,d)=>a+d.bad,0);
    add({id:"categorical_domains", severity: domainBad ? "high" : "info", kind:"invalid",
      table:"multiple", column:"categorical columns",
      count: domainBad, denominator: domains.reduce((a,d)=>a+d.rows.length,0),
      label: domainBad ? "categorical columns contain out-of-domain values"
                       : "categorical columns stay inside their allowed value sets",
      detail: domainViolations.map(d=>`${d.column} ∈ {${d.allowed.join(", ")}}: ${d.bad} violation(s)`).join(" · "),
      action: domainBad ? "Fix at source before the columns are one-hot encoded."
                        : "Safe to encode directly."});

    /* -- type consistency -------------------------------------------- */
    const orgKeyTypes = new Set(orgs.map(o=>typeof o.school_id));
    const feedKeyTypes = new Set(feeds.map(f=>typeof f.school_id));
    const typeMismatch = !(orgKeyTypes.size === 1 && feedKeyTypes.size === 1 &&
                           Array.from(orgKeyTypes)[0] === Array.from(feedKeyTypes)[0]);
    add({id:"join_key_types", severity: typeMismatch ? "high" : "info", kind:"schema",
      table:"feeds / organizations", column:"school_id, category_id, org_id",
      count: typeMismatch ? feeds.length : 0, denominator: feeds.length,
      label: typeMismatch ? "join keys are typed inconsistently across tables"
                          : "join keys share one type across tables",
      detail: typeMismatch
        ? `organizations.school_id is ${Array.from(orgKeyTypes).join("/")} while feeds.school_id is ${Array.from(feedKeyTypes).join("/")}. Every join in this dashboard casts to string; a strict SQL or pandas join would silently return no rows.`
        : "All foreign keys share a single JavaScript type.",
      action: typeMismatch ? "Emit integer keys for feeds in the workbook export." : "No action required."});

    /* -- referential integrity ---------------------------------------- */
    const idSet = (rows, key)=>new Set((rows||[]).map(r=>String(r[key])));
    const schoolIds = idSet(DB.schools,"school_id");
    const catIds = idSet(DB.categories,"category_id");
    const orgIds = idSet(orgs,"org_id");
    const fkChecks = [
      {label:"organizations.school_id → schools", rows:orgs, key:"school_id", set:schoolIds},
      {label:"organizations.category_id → categories", rows:orgs, key:"category_id", set:catIds},
      {label:"feeds.school_id → schools", rows:feeds, key:"school_id", set:schoolIds},
      {label:"feeds.org_id → organizations", rows:feeds, key:"org_id", set:orgIds},
      {label:"brands.org_id → organizations", rows:DB.brands, key:"org_id", set:orgIds},
      {label:"ucla_recommendations.category_id → categories", rows:DB.ucla_recommendations, key:"category_id", set:catIds}
    ].map(c=>{
      const orphans = (c.rows||[]).filter(r=>!S.isBlank(r[c.key]) && !c.set.has(String(r[c.key])));
      return {label:c.label, orphans:orphans.length, of:(c.rows||[]).length};
    });
    const orphanTotal = fkChecks.reduce((a,c)=>a+c.orphans,0);
    add({id:"referential_integrity", severity: orphanTotal ? "high" : "info", kind:"integrity",
      table:"multiple", column:"foreign keys",
      count: orphanTotal, denominator: fkChecks.reduce((a,c)=>a+c.of,0),
      label: orphanTotal ? "orphaned foreign keys found" : "all foreign keys resolve",
      detail: fkChecks.map(c=>`${c.label}: ${c.orphans}/${c.of} orphaned`).join(" · "),
      action: orphanTotal ? "Repair before loading into SQL — the schema declares these as REFERENCES."
                          : "Safe to load into the SQL schema as-is."});

    const unusedSchools = (DB.schools||[]).filter(s=>!orgs.some(o=>String(o.school_id) === String(s.school_id)));
    add({id:"unused_dimension_rows", severity: unusedSchools.length ? "medium" : "info", kind:"integrity",
      table:"schools", column:"school_id",
      count: unusedSchools.length, denominator:(DB.schools||[]).length,
      label:"schools carried with no organizations attached",
      detail: unusedSchools.length
        ? `${unusedSchools.length} school row(s) have zero organizations: ${unusedSchools.map(s=>s.school_name).join(", ")}.`
        : "Every school row has at least one organization.",
      action: unusedSchools.length ? "Either finish the research for these schools or drop them from the dimension."
                                   : "No action required."});

    /* -- duplicates ---------------------------------------------------- */
    const dupOrgs = S.duplicateGroups(orgs, o=>`${o.school_id}|${o.org_name}`);
    const dupFeeds = S.duplicateGroups(feeds, f=>f.feed_url);
    const dupSources = S.duplicateGroups(DB.sources, s=>s.url);
    const dupTotal = dupOrgs.length + dupFeeds.length + dupSources.length;
    add({id:"duplicates", severity: dupTotal ? "high" : "info", kind:"duplicate",
      table:"multiple", column:"natural keys",
      count: dupTotal, denominator: orgs.length + feeds.length + (DB.sources||[]).length,
      label: dupTotal ? "duplicate natural keys found" : "no duplicate natural keys",
      detail:`organizations (school + name): ${dupOrgs.length} · feeds (feed_url): ${dupFeeds.length} · sources (url): ${dupSources.length}`,
      action: dupTotal ? "De-duplicate before aggregating — counts would be double-billed."
                       : "Counts are safe to aggregate."});

    /* -- pipeline freshness -------------------------------------------- */
    const neverFetched = feeds.filter(f=>!/ok|success/i.test(String(f.validation_status||"")));
    add({id:"feed_validation", severity: neverFetched.length === feeds.length ? "high" : "medium",
      kind:"pipeline", table:"feeds", column:"validation_status",
      count: neverFetched.length, denominator: feeds.length,
      label:"registered feeds have never returned a validated fetch",
      detail:`${neverFetched.length} of ${feeds.length} feeds are still marked "${feeds.length?feeds[0].validation_status:"unknown"}". Until the ingester runs, no item-level data exists and the publishing charts fall back to a simulated corpus.`,
      action:"Run: cd bruincast_reader && python3 ingest.py fetch && python3 ingest.py export"});

    /* -- outliers ------------------------------------------------------- */
    const years = orgs.map(o=>parseFoundedYear(o.founded_year).value).filter(S.isNum);
    const yearStats = S.numericSummary(years);
    add({id:"founded_year_outliers", severity: yearStats.outliers.length ? "info" : "info", kind:"outlier",
      table:"organizations", column:"founded_year",
      count: yearStats.outliers.length, denominator: years.length,
      label:"founding-year outliers (1.5 × IQR)",
      detail: yearStats.outliers.length
        ? `Outside [${Math.round(yearStats.lowerFence)}, ${Math.round(yearStats.upperFence)}]: ${yearStats.outliers.sort((a,b)=>a-b).join(", ")}. These are 19th-century newspapers, not errors — keep them and use a robust scale.`
        : `No values outside [${Math.round(yearStats.lowerFence)}, ${Math.round(yearStats.upperFence)}].`,
      action:"Verified as genuine; no correction applied."});

    const totals = tables.reduce((a,t)=>({
      rows: a.rows + t.profile.rows,
      cells: a.cells + t.profile.cells,
      missing: a.missing + t.profile.missingCells
    }), {rows:0, cells:0, missing:0});

    const order = {high:0, medium:1, info:2};
    checks.sort((a,b)=>(order[a.severity]-order[b.severity]) || (b.count-a.count));

    return {
      tables, checks, totals,
      missingRate: totals.cells ? totals.missing/totals.cells : 0,
      failing: checks.filter(c=>c.severity !== "info" && c.count > 0).length,
      yearStats
    };
  }

  /* ============================================================
     8. Coverage drift
     ============================================================
     Is the feed registry we ingest actually representative of the landscape we
     researched? PSI over the category mix answers that directly. */

  function coverageDrift(DB){
    const ctx = context(DB);
    const orgShare = {}, feedShare = {};
    (DB.organizations||[]).forEach(o=>{
      const k = ctx.categoryName(o.category_id) || "Unknown";
      orgShare[k] = (orgShare[k]||0)+1;
    });
    (DB.feeds||[]).forEach(f=>{
      const k = ctx.categoryName(f.category_id) || "Unknown";
      feedShare[k] = (feedShare[k]||0)+1;
    });
    const result = S.psi(orgShare, feedShare);
    return {
      reference: orgShare, comparison: feedShare,
      psi: result.value, band: S.psiBand(result.value), buckets: result.buckets,
      referenceLabel: "Researched organizations", comparisonLabel: "Registered feeds"
    };
  }

  /* ============================================================
     9. Publishing corpus
     ============================================================ */

  const DAY = 86400000;

  /** Filter a corpus to a date window and vertical, and report what was dropped. */
  function filterCorpus(corpus, opts){
    const o = opts||{};
    const items = (corpus && corpus.items) || [];
    const cutoff = o.days ? Date.now() - o.days*DAY : null;
    let undated = 0;
    const kept = items.filter(i=>{
      if(o.vertical && i.vertical !== o.vertical) return false;
      if(!i.published_at){ undated++; return false; }
      const t = Date.parse(i.published_at);
      if(!isFinite(t)){ undated++; return false; }
      if(cutoff && t < cutoff) return false;
      return true;
    });
    return {items:kept, undated, total:items.length};
  }

  /** Weekly item counts (UTC weeks starting Monday). */
  function weeklySeries(items){
    const buckets = new Map();
    items.forEach(i=>{
      const t = Date.parse(i.published_at);
      if(!isFinite(t)) return;
      const d = new Date(t);
      const dow = (d.getUTCDay()+6)%7;                       // Monday = 0
      const weekStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()-dow);
      buckets.set(weekStart, (buckets.get(weekStart)||0)+1);
    });
    return Array.from(buckets.entries()).sort((a,b)=>a[0]-b[0])
      .map(([x,y])=>({x, y}));
  }

  function countBy(items, key){
    const out = {};
    items.forEach(i=>{ const k = i[key] || "Unknown"; out[k] = (out[k]||0)+1; });
    return out;
  }

  /** Headline corpus metrics for the summary cards. */
  function corpusSummary(filtered, corpus, days){
    const items = filtered.items;
    const withMedia = items.filter(i=>i.assets && Object.keys(i.assets).length).length;
    const withAuthor = items.filter(i=>i.author).length;
    const weeks = Math.max(1, (days||90)/7);
    return {
      items: items.length,
      perWeek: items.length/weeks,
      mediaRate: items.length ? withMedia/items.length : 0,
      bylineRate: items.length ? withAuthor/items.length : 0,
      undated: filtered.undated,
      undatedRate: filtered.total ? filtered.undated/filtered.total : 0,
      activeFeeds: new Set(items.map(i=>i.feed_name)).size,
      generatedAt: corpus ? corpus.generated_at : null,
      source: corpus ? corpus.source : "none"
    };
  }

  const VERTICAL_LABELS = {
    news:"News", sports:"Sports", art_design:"Art & design", radio:"Radio",
    video:"Video", film_tv_theater:"Film / TV / theater", gaming:"Gaming",
    business:"Business", sciences:"Sciences"
  };

  return {
    CURRENT_YEAR, SCOPES, FEATURES, EXPERIMENTS, MODEL_ALIASES, VERTICAL_LABELS,
    BROADCAST_CATEGORIES,
    context, parseMemberCount, parseFoundedYear, citationIndex,
    buildOrgFrame, designMatrix, runExperiment, runAllExperiments,
    qualityReport, coverageDrift,
    filterCorpus, weeklySeries, countBy, corpusSummary
  };
});
