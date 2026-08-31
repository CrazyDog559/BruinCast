/* BruinCast — inline-SVG chart primitives for the Data Lab.
   No dependencies: the site has no build step and every page except the SQL
   console works offline, so charts are hand-rolled SVG rather than a CDN library.
   Every chart returns a <figure> string with a title, axis labels, units, a
   keyboard-reachable mark for each datum and a <details> data table fallback. */
window.BCChart = (function(){

  const esc = (s)=>String(s==null?"":s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let uid = 0;
  const nextId = ()=>"bcc"+(++uid);

  const PALETTE = ["#2774AE","#003B5C","#8a6d00","#4d7c8a","#7b5ea7","#9b1c1c"];

  function fmt(v, dp){
    if(v === null || v === undefined || (typeof v === "number" && !isFinite(v))) return "—";
    if(typeof v !== "number") return String(v);
    const d = dp == null ? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 1 : 3) : dp;
    return v.toLocaleString(undefined,{minimumFractionDigits:d, maximumFractionDigits:d});
  }

  /** Counts render without a decimal; ratios keep theirs. */
  const fmtV = (v)=>(typeof v === "number" && isFinite(v) && Number.isInteger(v)) ? fmt(v,0) : fmt(v);

  /** "Nice" axis ticks covering [min,max]. */
  function ticks(min, max, count){
    if(!isFinite(min) || !isFinite(max)) return [0];
    if(min === max) return [min];
    const span = max-min, step0 = span/Math.max(1,(count||5));
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0/mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10)*mag;
    const out = [];
    for(let t = Math.ceil(min/step)*step; t <= max+step*1e-9; t += step) out.push(Math.round(t/step)*step);
    return out.length ? out : [min, max];
  }

  /** Shared <figure> wrapper: caption, accessible SVG, data table. */
  function figure(o){
    const id = nextId();
    const desc = o.desc || o.subtitle || o.title;
    const table = o.table ? `<details class="chart-data">
        <summary>Data table${o.tableNote?` <span class="muted">— ${esc(o.tableNote)}</span>`:""}</summary>
        <div class="tablewrap">${o.table}</div></details>` : "";
    return `<figure class="chart" ${o.chartClass?`data-kind="${esc(o.chartClass)}"`:""}>
      <figcaption>
        <h4>${esc(o.title)}</h4>
        ${o.subtitle?`<p>${esc(o.subtitle)}</p>`:""}
      </figcaption>
      <svg viewBox="0 0 ${o.w} ${o.h}" role="img" aria-labelledby="${id}t ${id}d"
           preserveAspectRatio="xMidYMid meet" class="chart-svg">
        <title id="${id}t">${esc(o.title)}</title>
        <desc id="${id}d">${esc(desc)}</desc>
        ${o.body}
      </svg>
      ${o.legend || ""}
      ${table}
    </figure>`;
  }

  function legend(items){
    return `<ul class="chart-legend">` + items.map(i=>
      `<li><span class="swatch" style="background:${esc(i.color)}"></span>${esc(i.label)}</li>`).join("") + `</ul>`;
  }

  function dataTable(headers, rows){
    return `<table><thead><tr>` + headers.map(h=>`<th>${esc(h)}</th>`).join("") +
      `</tr></thead><tbody>` + rows.map(r=>`<tr>` + r.map((c,i)=>
        `<td class="${i?"num":""}">${esc(c)}</td>`).join("") + `</tr>`).join("") +
      `</tbody></table>`;
  }

  /* ---------------- horizontal bars (categorical) ---------------- */

  function hbar(o){
    const data = (o.data||[]).slice();
    const w = o.width || 720;
    const rowH = 26, padT = 10, padB = 34, padR = 58;
    const padL = o.labelWidth || Math.round(Math.min(190, w*0.4));
    const h = padT + padB + Math.max(1,data.length)*rowH;
    const max = Math.max(1, ...data.map(d=>d.value||0));
    const plotW = w - padL - padR;
    const xt = ticks(0, max, 4);
    const gridlines = xt.map(t=>{
      const x = padL + (t/max)*plotW;
      return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${h-padB}" class="grid"/>
              <text x="${x}" y="${h-padB+15}" class="axis-tick" text-anchor="middle">${esc(fmt(t,0))}</text>`;
    }).join("");
    const bars = data.map((d,i)=>{
      const y = padT + i*rowH + 4;
      const bw = Math.max(1, (d.value/max)*plotW);
      const color = d.color || (o.highlight && d.highlight ? PALETTE[2] : PALETTE[0]);
      const tip = d.tip || `${d.label}: ${fmtV(d.value)}${o.unit?" "+o.unit:""}`;
      return `<g class="mark" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}">
        <text x="${padL-8}" y="${y+13}" class="axis-label" text-anchor="end">${esc(d.label)}</text>
        <rect x="${padL}" y="${y}" width="${bw}" height="${rowH-9}" rx="2" fill="${esc(color)}"/>
        <text x="${padL+bw+6}" y="${y+13}" class="bar-value">${esc(d.display != null ? d.display : fmtV(d.value))}</text>
      </g>`;
    }).join("");
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"hbar",
      desc:`Horizontal bar chart. ${data.length} categories. Highest: ${data.length?data[0].label+" at "+fmt(data[0].value):"none"}.`,
      body:`<g role="list">${gridlines}${bars}</g>
            <text x="${padL+plotW/2}" y="${h-4}" class="axis-title" text-anchor="middle">${esc(o.xTitle||o.unit||"")}</text>`,
      table:dataTable([o.categoryTitle||"Category", o.unit||"Value"],
        data.map(d=>[d.label, d.display != null ? d.display : fmtV(d.value)])),
      legend:o.legendItems ? legend(o.legendItems) : ""
    });
  }

  /* ---------------- grouped columns ---------------- */

  function groupedBar(o){
    const cats = o.categories||[], series = o.series||[];
    const w = o.width || 720, h = 300, padT = 12, padB = 74, padL = 52, padR = 12;
    const plotW = w-padL-padR, plotH = h-padT-padB;
    const max = Math.max(1, ...series.flatMap(s=>s.values));
    const yt = ticks(0, max, 4);
    const grid = yt.map(t=>{
      const y = h-padB-(t/max)*plotH;
      return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" class="grid"/>
              <text x="${padL-7}" y="${y+4}" class="axis-tick" text-anchor="end">${esc(fmt(t,0))}</text>`;
    }).join("");
    const groupW = plotW/Math.max(1,cats.length);
    const barW = Math.min(26, (groupW-10)/Math.max(1,series.length));
    const bars = cats.map((c,i)=>{
      const gx = padL + i*groupW + (groupW - barW*series.length)/2;
      const cols = series.map((s,j)=>{
        const v = s.values[i]||0;
        const bh = (v/max)*plotH;
        const tip = `${c} · ${s.name}: ${fmtV(v)}${o.unit?" "+o.unit:""}`;
        return `<rect class="mark" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}"
                  x="${gx+j*barW}" y="${h-padB-bh}" width="${barW-2}" height="${Math.max(1,bh)}"
                  rx="2" fill="${esc(s.color||PALETTE[j%PALETTE.length])}"/>`;
      }).join("");
      const label = String(c).length > 14 ? String(c).slice(0,13)+"…" : String(c);
      return cols + `<text x="${padL+i*groupW+groupW/2}" y="${h-padB+16}" class="axis-tick"
        text-anchor="end" transform="rotate(-35 ${padL+i*groupW+groupW/2} ${h-padB+16})">${esc(label)}</text>`;
    }).join("");
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"grouped",
      desc:`Grouped column chart comparing ${series.map(s=>s.name).join(" and ")} across ${cats.length} categories.`,
      body:`<g role="list">${grid}${bars}</g>
            <text transform="rotate(-90 14 ${padT+plotH/2})" x="14" y="${padT+plotH/2}" class="axis-title" text-anchor="middle">${esc(o.yTitle||o.unit||"")}</text>`,
      legend:legend(series.map((s,j)=>({label:s.name, color:s.color||PALETTE[j%PALETTE.length]}))),
      table:dataTable([o.categoryTitle||"Category"].concat(series.map(s=>s.name)),
        cats.map((c,i)=>[c].concat(series.map(s=>fmt(s.values[i],0)))))
    });
  }

  /* ---------------- histogram ---------------- */

  function histogram(o){
    const bins = o.bins||[];
    const w = o.width || 720, h = 280, padT = 12, padB = 54, padL = 48, padR = 12;
    const plotW = w-padL-padR, plotH = h-padT-padB;
    const max = Math.max(1, ...bins.map(b=>b.count));
    const yt = ticks(0, max, 4);
    const grid = yt.map(t=>{
      const y = h-padB-(t/max)*plotH;
      return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" class="grid"/>
              <text x="${padL-7}" y="${y+4}" class="axis-tick" text-anchor="end">${esc(fmt(t,0))}</text>`;
    }).join("");
    const bw = plotW/Math.max(1,bins.length);
    const bars = bins.map((b,i)=>{
      const bh = (b.count/max)*plotH;
      const tip = `${fmt(b.from,0)}–${fmt(b.to,0)}: ${b.count} ${o.unit||"records"}`;
      return `<rect class="mark" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}"
        x="${padL+i*bw+1}" y="${h-padB-bh}" width="${Math.max(1,bw-2)}" height="${Math.max(1,bh)}"
        rx="1.5" fill="${PALETTE[0]}"/>`;
    }).join("");
    const labels = bins.map((b,i)=> (i%Math.ceil(bins.length/6) === 0)
      ? `<text x="${padL+i*bw}" y="${h-padB+16}" class="axis-tick" text-anchor="middle">${esc(fmt(b.from,0))}</text>` : "").join("");
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"histogram",
      desc:`Histogram with ${bins.length} equal-width bins over ${o.xTitle||"the value range"}.`,
      body:`<g role="list">${grid}${bars}${labels}</g>
        <text x="${padL+plotW/2}" y="${h-6}" class="axis-title" text-anchor="middle">${esc(o.xTitle||"")}</text>
        <text transform="rotate(-90 12 ${padT+plotH/2})" x="12" y="${padT+plotH/2}" class="axis-title" text-anchor="middle">${esc(o.yTitle||"count")}</text>`,
      table:dataTable(["Bin", "Count"], bins.map(b=>[`${fmt(b.from,0)} – ${fmt(b.to,0)}`, b.count]))
    });
  }

  /* ---------------- time series line ---------------- */

  function line(o){
    const series = o.series||[];
    const pts = series.flatMap(s=>s.points);
    const w = o.width || 720, h = 280, padT = 14, padB = 52, padL = 52, padR = 14;
    const plotW = w-padL-padR, plotH = h-padT-padB;
    if(!pts.length) return figure({title:o.title, subtitle:o.subtitle, w, h,
      body:`<text x="${w/2}" y="${h/2}" class="axis-label" text-anchor="middle">No observations in range</text>`,
      desc:"No data in the selected range."});
    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
    const xMin = Math.min.apply(null,xs), xMax = Math.max.apply(null,xs);
    const yMax = Math.max(1, Math.max.apply(null,ys));
    const sx = (x)=>padL + (xMax === xMin ? plotW/2 : ((x-xMin)/(xMax-xMin))*plotW);
    const sy = (y)=>h-padB-(y/yMax)*plotH;
    const yt = ticks(0, yMax, 4);
    const grid = yt.map(t=>`<line x1="${padL}" y1="${sy(t)}" x2="${w-padR}" y2="${sy(t)}" class="grid"/>
      <text x="${padL-7}" y="${sy(t)+4}" class="axis-tick" text-anchor="end">${esc(fmt(t,0))}</text>`).join("");
    const xTickCount = Math.min(6, pts.length);
    const xLabels = [];
    for(let i=0;i<xTickCount;i++){
      const x = xMin + (xMax-xMin)*(xTickCount===1?0.5:i/(xTickCount-1));
      xLabels.push(`<text x="${sx(x)}" y="${h-padB+18}" class="axis-tick" text-anchor="middle">${esc(o.xFormat?o.xFormat(x):fmt(x,0))}</text>`);
    }
    const paths = series.map((s,j)=>{
      const color = s.color||PALETTE[j%PALETTE.length];
      const d = s.points.map((p,i)=>`${i?"L":"M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
      const marks = s.points.map(p=>{
        const tip = p.tip || `${o.xFormat?o.xFormat(p.x):fmt(p.x,0)} · ${s.name}: ${fmtV(p.y)}${o.unit?" "+o.unit:""}`;
        return `<circle class="mark" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}"
          cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.5" fill="${esc(color)}"/>`;
      }).join("");
      return `<path d="${d}" fill="none" stroke="${esc(color)}" stroke-width="2"
        stroke-linejoin="round" stroke-dasharray="${s.dashed?"5 4":""}"/>${marks}`;
    }).join("");
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"line",
      desc:`Line chart of ${series.map(s=>s.name).join(", ")} across ${series[0]?series[0].points.length:0} periods.`,
      body:`<g role="list">${grid}${xLabels.join("")}${paths}</g>
        <text x="${padL+plotW/2}" y="${h-6}" class="axis-title" text-anchor="middle">${esc(o.xTitle||"")}</text>
        <text transform="rotate(-90 12 ${padT+plotH/2})" x="12" y="${padT+plotH/2}" class="axis-title" text-anchor="middle">${esc(o.yTitle||o.unit||"")}</text>`,
      legend:series.length > 1 ? legend(series.map((s,j)=>({label:s.name, color:s.color||PALETTE[j%PALETTE.length]}))) : "",
      table:dataTable([o.xTitle||"x"].concat(series.map(s=>s.name)),
        (series[0]?series[0].points:[]).map((p,i)=>
          [o.xFormat?o.xFormat(p.x):fmt(p.x,0)].concat(series.map(s=>s.points[i]?fmt(s.points[i].y,0):"—"))))
    });
  }

  /* ---------------- scatter ---------------- */

  function scatter(o){
    const groups = o.groups||[];
    const w = o.width || 720, h = 320, padT = 14, padB = 54, padL = 56, padR = 14;
    const plotW = w-padL-padR, plotH = h-padT-padB;
    const pts = groups.flatMap(g=>g.points);
    if(!pts.length) return figure({title:o.title, subtitle:o.subtitle, w, h,
      body:`<text x="${w/2}" y="${h/2}" class="axis-label" text-anchor="middle">No complete observations</text>`,
      desc:"No complete observations to plot."});
    const xMin = Math.min.apply(null,pts.map(p=>p.x)), xMax = Math.max.apply(null,pts.map(p=>p.x));
    const yMin = Math.min(0, Math.min.apply(null,pts.map(p=>p.y))), yMax = Math.max.apply(null,pts.map(p=>p.y));
    const sx = (x)=>padL + (xMax===xMin?plotW/2:((x-xMin)/(xMax-xMin))*plotW);
    const sy = (y)=>h-padB-(yMax===yMin?plotH/2:((y-yMin)/(yMax-yMin))*plotH);
    const grid = ticks(yMin,yMax,4).map(t=>`<line x1="${padL}" y1="${sy(t)}" x2="${w-padR}" y2="${sy(t)}" class="grid"/>
      <text x="${padL-7}" y="${sy(t)+4}" class="axis-tick" text-anchor="end">${esc(fmt(t,0))}</text>`).join("");
    const xLab = ticks(xMin,xMax,5).map(t=>`<text x="${sx(t)}" y="${h-padB+18}" class="axis-tick" text-anchor="middle">${esc(fmt(t,0))}</text>`).join("");
    const marks = groups.map((g,j)=>{
      const color = g.color||PALETTE[j%PALETTE.length];
      return g.points.map(p=>{
        const cx = sx(p.x), cy = sy(p.y);
        const tip = `${p.label} — ${o.xTitle}: ${fmtV(p.x)}, ${o.yTitle}: ${fmtV(p.y)} (${g.name})`;
        // Shape encodes the group as well as colour, so the split never relies on colour alone.
        const shape = g.shape === "square"
          ? `<rect x="${(cx-4.5).toFixed(1)}" y="${(cy-4.5).toFixed(1)}" width="9" height="9" fill="${esc(color)}"/>`
          : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="none" stroke="${esc(color)}" stroke-width="1.8"/>`;
        return `<g class="mark" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}">${shape}</g>`;
      }).join("");
    }).join("");
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"scatter",
      desc:`Scatter plot of ${o.yTitle} against ${o.xTitle} for ${pts.length} organizations, split by ${groups.map(g=>g.name).join(" and ")}.`,
      body:`<g role="list">${grid}${xLab}${marks}</g>
        <text x="${padL+plotW/2}" y="${h-6}" class="axis-title" text-anchor="middle">${esc(o.xTitle||"")}</text>
        <text transform="rotate(-90 13 ${padT+plotH/2})" x="13" y="${padT+plotH/2}" class="axis-title" text-anchor="middle">${esc(o.yTitle||"")}</text>`,
      legend:legend(groups.map((g,j)=>({label:g.name+(g.shape==="square"?" (filled square)":" (open circle)"), color:g.color||PALETTE[j%PALETTE.length]}))),
      table:dataTable(["Organization", o.xTitle||"x", o.yTitle||"y", "Group"],
        groups.flatMap(g=>g.points.map(p=>[p.label, fmtV(p.x), fmtV(p.y), g.name])))
    });
  }

  /* ---------------- correlation heatmap ---------------- */

  function heatmap(o){
    const labels = o.labels||[], m = o.matrix||[];
    const cell = 40, padL = 148, padT = 118, padR = 16, padB = 16;
    const w = padL + labels.length*cell + padR;
    const h = padT + labels.length*cell + padB;
    // Diverging blue (negative) → neutral → gold-brown (positive); |r| drives opacity.
    const color = (v)=>{
      if(v === null || v === undefined) return "#eef2f6";
      const a = Math.min(1, Math.abs(v));
      return v >= 0 ? `rgba(39,116,174,${(0.10+0.85*a).toFixed(3)})`
                    : `rgba(138,109,0,${(0.10+0.85*a).toFixed(3)})`;
    };
    let body = "";
    labels.forEach((l,i)=>{
      body += `<text x="${padL-8}" y="${padT+i*cell+cell/2+4}" class="axis-label" text-anchor="end">${esc(l)}</text>`;
      body += `<text transform="rotate(-45 ${padL+i*cell+cell/2} ${padT-10})" x="${padL+i*cell+cell/2}" y="${padT-10}" class="axis-label" text-anchor="start">${esc(l)}</text>`;
    });
    labels.forEach((r,i)=>labels.forEach((c,j)=>{
      const v = m[i][j];
      const tip = `r(${r}, ${c}) = ${v===null?"not estimable":fmt(v,2)}`;
      const strong = v !== null && Math.abs(v) > 0.55;
      body += `<g class="mark" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}">
        <rect x="${padL+j*cell}" y="${padT+i*cell}" width="${cell-1}" height="${cell-1}" fill="${color(v)}"/>
        <text x="${padL+j*cell+cell/2}" y="${padT+i*cell+cell/2+4}" text-anchor="middle"
          class="cell-value" fill="${strong?"#fff":"#41505f"}">${v===null?"·":esc(fmt(v,2))}</text></g>`;
    }));
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"heatmap",
      desc:`Correlation matrix of ${labels.length} engineered features. Values are Pearson r from -1 to 1; a dot means not estimable.`,
      body:`<g role="list">${body}</g>`,
      table:dataTable(["Feature pair","Pearson r"],
        labels.flatMap((r,i)=>labels.slice(i+1).map((c,k)=>[`${r} × ${labels[i+1+k]}`, fmt(m[i][i+1+k],2)]))),
      tableNote:"unique pairs only"
    });
  }

  /* ---------------- ROC curve ---------------- */

  function roc(o){
    const w = 340, h = 340, pad = 46;
    const plot = w-pad*2;
    const sx = (v)=>pad+v*plot, sy = (v)=>h-pad-v*plot;
    const d = (o.points||[]).map((p,i)=>`${i?"L":"M"}${sx(p.fpr).toFixed(1)} ${sy(p.tpr).toFixed(1)}`).join(" ");
    const grid = [0,0.25,0.5,0.75,1].map(t=>
      `<line x1="${sx(0)}" y1="${sy(t)}" x2="${sx(1)}" y2="${sy(t)}" class="grid"/>
       <text x="${pad-7}" y="${sy(t)+4}" class="axis-tick" text-anchor="end">${t}</text>
       <text x="${sx(t)}" y="${h-pad+17}" class="axis-tick" text-anchor="middle">${t}</text>`).join("");
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"roc",
      desc:`ROC curve from leave-one-out cross-validation. Area under the curve ${fmt(o.auc,3)}; the dashed diagonal is random ranking (0.5).`,
      body:`${grid}
        <line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(1)}" stroke="#9aa5b1" stroke-dasharray="4 4"/>
        <path d="${d}" fill="none" stroke="${PALETTE[0]}" stroke-width="2.2"/>
        <g class="mark" tabindex="0" role="listitem" aria-label="Area under the ROC curve ${esc(fmt(o.auc,3))}"
           data-tip="AUC = ${esc(fmt(o.auc,3))} (0.5 = random ranking)">
          <text x="${sx(0.52)}" y="${sy(0.18)}" class="bar-value">AUC ${esc(fmt(o.auc,3))}</text></g>
        <text x="${pad+plot/2}" y="${h-8}" class="axis-title" text-anchor="middle">False positive rate</text>
        <text transform="rotate(-90 13 ${pad+plot/2})" x="13" y="${pad+plot/2}" class="axis-title" text-anchor="middle">True positive rate</text>`,
      table:dataTable(["Threshold","False positive rate","True positive rate"],
        (o.points||[]).map(p=>[fmt(p.threshold,3), fmt(p.fpr,3), fmt(p.tpr,3)]))
    });
  }

  /* ---------------- diverging coefficient bars ---------------- */

  function coefficients(o){
    const data = (o.data||[]).slice();
    const w = o.width || 720, rowH = 30, padT = 26, padB = 34, padR = 58;
    const padL = o.labelWidth || Math.round(Math.min(210, w*0.42));
    const h = padT+padB+Math.max(1,data.length)*rowH;
    const plotW = w-padL-padR, mid = padL+plotW/2;
    const max = Math.max(0.001, ...data.map(d=>Math.abs(d.value)));
    const bars = data.map((d,i)=>{
      const y = padT+i*rowH;
      const len = (Math.abs(d.value)/max)*(plotW/2-8);
      const x = d.value >= 0 ? mid : mid-len;
      const dir = d.value >= 0 ? "increases" : "decreases";
      const tip = `${d.label}: ${fmt(d.value,3)} — a one standard-deviation increase ${dir} the log-odds`;
      return `<g class="mark" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}">
        <text x="${padL-10}" y="${y+17}" class="axis-label" text-anchor="end">${esc(d.label)}</text>
        <rect x="${x}" y="${y+5}" width="${Math.max(1,len)}" height="${rowH-14}" rx="2"
          fill="${d.value>=0?PALETTE[0]:PALETTE[2]}"/>
        <text x="${d.value>=0?x+len+6:x-6}" y="${y+17}" class="bar-value"
          text-anchor="${d.value>=0?"start":"end"}">${esc((d.value>=0?"+":"")+fmt(d.value,2))}</text>
      </g>`;
    }).join("");
    return figure({
      title:o.title, subtitle:o.subtitle, w, h, chartClass:"coef",
      desc:"Standardised logistic-regression coefficients in log-odds. Bars right of the zero line push toward the positive class; bars left push away. Coefficients describe association, not causation.",
      body:`<g role="list">${bars}</g>
        <line x1="${mid}" y1="${padT}" x2="${mid}" y2="${h-padB}" stroke="#41505f" stroke-width="1"/>
        <text x="${mid}" y="${padT-10}" class="axis-tick" text-anchor="middle">0</text>
        <text x="${padL+plotW*0.25}" y="${h-10}" class="axis-title" text-anchor="middle">← less likely to be cited</text>
        <text x="${padL+plotW*0.78}" y="${h-10}" class="axis-title" text-anchor="middle">more likely to be cited →</text>`,
      table:dataTable(["Feature","Coefficient (log-odds per SD)"], data.map(d=>[d.label, fmt(d.value,3)]))
    });
  }

  /* ---------------- tooltip controller ---------------- */

  /** One delegated listener drives hover *and* keyboard focus tooltips. */
  function enableTooltips(){
    if(document.getElementById("bcc-tip")) return;
    const tip = document.createElement("div");
    tip.id = "bcc-tip";
    tip.className = "chart-tip";
    tip.setAttribute("role","status");
    tip.hidden = true;
    document.body.appendChild(tip);

    function show(target){
      const text = target.getAttribute("data-tip");
      if(!text) return;
      tip.textContent = text;
      tip.hidden = false;
      const r = target.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      let left = r.left + r.width/2 - tr.width/2;
      left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
      let top = r.top - tr.height - 8;
      if(top < 8) top = r.bottom + 8;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    const hide = ()=>{ tip.hidden = true; };
    const find = (e)=>e.target && e.target.closest ? e.target.closest("[data-tip]") : null;

    document.addEventListener("mouseover", e=>{ const t = find(e); if(t) show(t); });
    document.addEventListener("mouseout",  e=>{ if(find(e)) hide(); });
    document.addEventListener("focusin",   e=>{ const t = find(e); t ? show(t) : hide(); });
    document.addEventListener("focusout",  e=>{ if(find(e)) hide(); });
    document.addEventListener("keydown",   e=>{ if(e.key === "Escape") hide(); });
    window.addEventListener("scroll", hide, {passive:true});
  }

  return {PALETTE, esc, fmt, fmtV, ticks, figure, legend, dataTable,
          hbar, groupedBar, histogram, line, scatter, heatmap, roc, coefficients,
          enableTooltips};
})();
