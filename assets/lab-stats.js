/* BruinCast — Data Lab statistics kernel.
   Pure functions only: no DOM, no data access, no rendering. Loaded as a browser
   global (window.BCStats) and required directly by tests/lab-selftest.js. */
(function(root, factory){
  const api = factory();
  root.BCStats = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(){

  /* ---------------- small helpers ---------------- */

  const isNum = (v)=>typeof v === "number" && isFinite(v);
  const isBlank = (v)=>v === null || v === undefined || v === "" ||
                       v === "None" || v === "NULL" ||
                       (typeof v === "number" && !isFinite(v));

  function round(v, dp){
    if(!isNum(v)) return null;
    const f = Math.pow(10, dp==null ? 4 : dp);
    return Math.round(v*f)/f;
  }

  /** Deterministic PRNG (mulberry32) so generated corpora are reproducible. */
  function seededRandom(seed){
    let a = seed >>> 0;
    return function(){
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- descriptive statistics ---------------- */

  function mean(xs){
    const v = xs.filter(isNum);
    if(!v.length) return null;
    return v.reduce((a,b)=>a+b,0)/v.length;
  }

  function quantile(xs, p){
    const v = xs.filter(isNum).slice().sort((a,b)=>a-b);
    if(!v.length) return null;
    if(v.length === 1) return v[0];
    const pos = (v.length-1)*p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? v[lo] : v[lo] + (v[hi]-v[lo])*(pos-lo);
  }

  function stdev(xs){
    const v = xs.filter(isNum);
    if(v.length < 2) return null;
    const m = mean(v);
    return Math.sqrt(v.reduce((a,b)=>a+(b-m)*(b-m),0)/(v.length-1));
  }

  /** n / mean / sd / min / q1 / median / q3 / max plus 1.5-IQR outlier fences. */
  function numericSummary(xs){
    const v = xs.filter(isNum);
    if(!v.length) return {n:0, missing:xs.length, mean:null, sd:null, min:null, max:null,
                          q1:null, median:null, q3:null, iqr:null, lowerFence:null,
                          upperFence:null, outliers:[]};
    const q1 = quantile(v,0.25), q3 = quantile(v,0.75), iqr = q3-q1;
    const lowerFence = q1 - 1.5*iqr, upperFence = q3 + 1.5*iqr;
    return {
      n: v.length, missing: xs.length - v.length,
      mean: mean(v), sd: stdev(v),
      min: Math.min.apply(null,v), max: Math.max.apply(null,v),
      q1, median: quantile(v,0.5), q3, iqr, lowerFence, upperFence,
      outliers: v.filter(x=>x < lowerFence || x > upperFence)
    };
  }

  /** Equal-width histogram. Returns [{from,to,count}] with `bins` buckets. */
  function histogram(xs, bins){
    const v = xs.filter(isNum);
    const k = Math.max(1, bins||10);
    if(!v.length) return [];
    const min = Math.min.apply(null,v), max = Math.max.apply(null,v);
    if(min === max) return [{from:min, to:max, count:v.length}];
    const w = (max-min)/k;
    const out = [];
    for(let i=0;i<k;i++) out.push({from:min+i*w, to:min+(i+1)*w, count:0});
    v.forEach(x=>{
      let i = Math.floor((x-min)/w);
      if(i >= k) i = k-1;
      if(i < 0) i = 0;
      out[i].count++;
    });
    return out;
  }

  /** Pearson correlation over pairwise-complete numeric observations. */
  function pearson(a, b){
    const xs = [], ys = [];
    for(let i=0;i<Math.min(a.length,b.length);i++){
      if(isNum(a[i]) && isNum(b[i])){ xs.push(a[i]); ys.push(b[i]); }
    }
    if(xs.length < 3) return null;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for(let i=0;i<xs.length;i++){
      const px = xs[i]-mx, py = ys[i]-my;
      num += px*py; dx += px*px; dy += py*py;
    }
    if(dx === 0 || dy === 0) return null;   // zero-variance column
    return num/Math.sqrt(dx*dy);
  }

  /** Symmetric correlation matrix for {label -> values[]} columns. */
  function correlationMatrix(columns){
    const labels = Object.keys(columns);
    const m = labels.map(r=>labels.map(c=>r===c ? 1 : pearson(columns[r], columns[c])));
    return {labels, matrix:m};
  }

  /**
   * Population Stability Index between a reference and a comparison distribution.
   * Both are {bucket: count} maps. Zero cells are floored so the log stays finite.
   * Convention: < 0.10 stable, 0.10–0.25 moderate shift, > 0.25 material shift.
   */
  function psi(reference, comparison){
    const keys = Array.from(new Set(Object.keys(reference).concat(Object.keys(comparison))));
    const sum = (o)=>keys.reduce((a,k)=>a+(o[k]||0),0);
    const rTot = sum(reference), cTot = sum(comparison);
    if(!rTot || !cTot) return {value:null, buckets:[]};
    const FLOOR = 0.0001;
    let total = 0;
    const buckets = keys.map(k=>{
      const r = Math.max((reference[k]||0)/rTot, FLOOR);
      const c = Math.max((comparison[k]||0)/cTot, FLOOR);
      const contribution = (c-r)*Math.log(c/r);
      total += contribution;
      return {bucket:k, referenceShare:r, comparisonShare:c, contribution};
    }).sort((a,b)=>b.contribution-a.contribution);
    return {value: total, buckets};
  }

  function psiBand(v){
    if(v === null || v === undefined) return "unknown";
    if(v < 0.10) return "stable";
    if(v < 0.25) return "moderate";
    return "material";
  }

  /* ---------------- profiling ---------------- */

  /** Infer a column type from its populated values. */
  function inferType(values){
    const present = values.filter(v=>!isBlank(v));
    if(!present.length) return "empty";
    const allNum = present.every(v=>isNum(v) || (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))));
    if(allNum) return "numeric";
    const distinct = new Set(present.map(String));
    if(distinct.size <= Math.max(2, Math.min(12, present.length/3))) return "categorical";
    return "text";
  }

  /** Per-column profile of an array of row objects. */
  function profileTable(rows){
    const list = Array.isArray(rows) ? rows : [];
    const cols = list.length ? Object.keys(list[0]) : [];
    const columns = cols.map(c=>{
      const values = list.map(r=>r ? r[c] : null);
      const missing = values.filter(isBlank).length;
      const distinct = new Set(values.filter(v=>!isBlank(v)).map(String)).size;
      return {
        name: c,
        type: inferType(values),
        missing,
        missingRate: list.length ? missing/list.length : 0,
        distinct,
        constant: distinct === 1
      };
    });
    const missingCells = columns.reduce((a,c)=>a+c.missing,0);
    return {
      rows: list.length,
      columns,
      cells: list.length * cols.length,
      missingCells,
      missingRate: (list.length && cols.length) ? missingCells/(list.length*cols.length) : 0
    };
  }

  /** Rows sharing a composite key. Returns [{key, count, rows:[index...]}]. */
  function duplicateGroups(rows, keyFn){
    const seen = new Map();
    (rows||[]).forEach((r,i)=>{
      const k = keyFn(r);
      if(k === null || k === undefined || k === "") return;
      const key = String(k).toLowerCase().trim();
      if(!seen.has(key)) seen.set(key, []);
      seen.get(key).push(i);
    });
    const out = [];
    seen.forEach((idx,key)=>{ if(idx.length > 1) out.push({key, count:idx.length, rows:idx}); });
    return out;
  }

  /* ---------------- feature matrix ---------------- */

  /** Median of the populated values; used for explicit, reported imputation. */
  function median(xs){ return quantile(xs, 0.5); }

  /** Replace nulls with the column median. Returns {values, imputed}. */
  function imputeMedian(xs){
    const m = median(xs);
    let imputed = 0;
    const values = xs.map(v=>{
      if(isNum(v)) return v;
      imputed++;
      return isNum(m) ? m : 0;
    });
    return {values, imputed, median:m};
  }

  /** Column-wise z-scores. Zero-variance columns collapse to 0. */
  function standardize(X){
    if(!X.length) return {Z:[], mu:[], sigma:[]};
    const p = X[0].length, mu = [], sigma = [];
    for(let j=0;j<p;j++){
      const col = X.map(r=>r[j]);
      const m = mean(col) || 0;
      const s = stdev(col);
      mu.push(m); sigma.push(isNum(s) && s > 1e-9 ? s : 1);
    }
    return {Z: X.map(r=>r.map((v,j)=>(v-mu[j])/sigma[j])), mu, sigma};
  }

  /* ---------------- logistic regression ---------------- */

  const sigmoid = (z)=>1/(1+Math.exp(-Math.max(-35, Math.min(35, z))));

  /**
   * L2-regularised logistic regression by batch gradient descent.
   * X is already standardised; y is 0/1. The intercept is not penalised.
   */
  function logisticFit(X, y, opts){
    const o = Object.assign({l2:1.0, lr:0.15, iterations:600}, opts||{});
    const n = X.length, p = n ? X[0].length : 0;
    let w = new Array(p).fill(0), b = 0;
    if(!n || !p) return {weights:w, intercept:b, iterations:0, converged:false};
    let converged = false, iter = 0;
    for(; iter<o.iterations; iter++){
      const gw = new Array(p).fill(0);
      let gb = 0;
      for(let i=0;i<n;i++){
        let z = b;
        for(let j=0;j<p;j++) z += w[j]*X[i][j];
        const err = sigmoid(z) - y[i];
        gb += err;
        for(let j=0;j<p;j++) gw[j] += err*X[i][j];
      }
      let maxStep = Math.abs(o.lr*gb/n);
      b -= o.lr*gb/n;
      for(let j=0;j<p;j++){
        const step = o.lr*(gw[j]/n + o.l2*w[j]/n);
        w[j] -= step;
        maxStep = Math.max(maxStep, Math.abs(step));
      }
      if(maxStep < 1e-7){ converged = true; iter++; break; }
    }
    return {weights:w, intercept:b, iterations:iter, converged};
  }

  function logisticPredict(model, row){
    let z = model.intercept;
    for(let j=0;j<row.length;j++) z += model.weights[j]*row[j];
    return sigmoid(z);
  }

  /**
   * Leave-one-out cross-validation. Standardisation is refitted inside each fold
   * so held-out rows never inform the scaling.
   */
  function looCV(X, y, opts){
    const n = X.length;
    const scores = new Array(n).fill(0.5);
    if(n < 3) return {scores, folds:0};
    for(let i=0;i<n;i++){
      const trX = [], trY = [];
      for(let k=0;k<n;k++) if(k!==i){ trX.push(X[k]); trY.push(y[k]); }
      const {Z, mu, sigma} = standardize(trX);
      const model = logisticFit(Z, trY, opts);
      const row = X[i].map((v,j)=>(v-mu[j])/sigma[j]);
      scores[i] = logisticPredict(model, row);
    }
    return {scores, folds:n};
  }

  /* ---------------- classification metrics ---------------- */

  function confusion(y, scores, threshold){
    const t = threshold == null ? 0.5 : threshold;
    let tp=0, fp=0, tn=0, fn=0;
    for(let i=0;i<y.length;i++){
      const pred = scores[i] >= t ? 1 : 0;
      if(y[i] === 1 && pred === 1) tp++;
      else if(y[i] === 0 && pred === 1) fp++;
      else if(y[i] === 0 && pred === 0) tn++;
      else fn++;
    }
    return {tp, fp, tn, fn};
  }

  function classificationMetrics(y, scores, threshold){
    const c = confusion(y, scores, threshold);
    const total = c.tp+c.fp+c.tn+c.fn;
    const precision = (c.tp+c.fp) ? c.tp/(c.tp+c.fp) : null;
    const recall = (c.tp+c.fn) ? c.tp/(c.tp+c.fn) : null;
    const f1 = (precision !== null && recall !== null && (precision+recall) > 0)
      ? 2*precision*recall/(precision+recall) : 0;
    return {
      accuracy: total ? (c.tp+c.tn)/total : null,
      precision, recall, f1,
      rocAuc: rocAuc(y, scores),
      confusion: c,
      n: total, positives: c.tp+c.fn
    };
  }

  /** ROC AUC via the rank (Mann-Whitney) formulation; handles ties. */
  function rocAuc(y, scores){
    const pos = [], neg = [];
    for(let i=0;i<y.length;i++) (y[i] === 1 ? pos : neg).push(scores[i]);
    if(!pos.length || !neg.length) return null;
    const idx = scores.map((s,i)=>({s, y:y[i]})).sort((a,b)=>a.s-b.s);
    const ranks = new Array(idx.length);
    let i = 0;
    while(i < idx.length){
      let j = i;
      while(j+1 < idx.length && idx[j+1].s === idx[i].s) j++;
      const avg = (i+j)/2 + 1;
      for(let k=i;k<=j;k++) ranks[k] = avg;
      i = j+1;
    }
    let rankSum = 0;
    idx.forEach((d,k)=>{ if(d.y === 1) rankSum += ranks[k]; });
    const nPos = pos.length, nNeg = neg.length;
    return (rankSum - nPos*(nPos+1)/2)/(nPos*nNeg);
  }

  /** ROC curve points, ordered by descending score. */
  function rocCurve(y, scores){
    const pts = [{fpr:0, tpr:0, threshold:1.01}];
    const order = scores.map((s,i)=>({s, y:y[i]})).sort((a,b)=>b.s-a.s);
    const nPos = y.filter(v=>v===1).length, nNeg = y.length-nPos;
    if(!nPos || !nNeg) return pts;
    let tp = 0, fp = 0;
    order.forEach(d=>{
      if(d.y === 1) tp++; else fp++;
      pts.push({fpr:fp/nNeg, tpr:tp/nPos, threshold:d.s});
    });
    return pts;
  }

  /** Wilson score interval — honest uncertainty band for small-sample rates. */
  function wilsonInterval(successes, n, z){
    if(!n) return {low:null, high:null};
    const zz = z == null ? 1.96 : z;
    const p = successes/n, d = 1 + zz*zz/n;
    const centre = (p + zz*zz/(2*n))/d;
    const half = (zz*Math.sqrt(p*(1-p)/n + zz*zz/(4*n*n)))/d;
    return {low: Math.max(0, centre-half), high: Math.min(1, centre+half)};
  }

  return {
    isNum, isBlank, round, seededRandom,
    mean, median, quantile, stdev, numericSummary, histogram,
    pearson, correlationMatrix, psi, psiBand,
    inferType, profileTable, duplicateGroups,
    imputeMedian, standardize,
    logisticFit, logisticPredict, looCV,
    confusion, classificationMetrics, rocAuc, rocCurve, wilsonInterval
  };
});
