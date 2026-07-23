/* BruinCast — shared helpers used across pages. Requires assets/data.js loaded first. */
window.BC = (function(){
  const DB = window.BRUINCAST_DATA || {};
  const el  = (id)=>document.getElementById(id);
  const esc = (s)=>String(s==null?"":s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const by  = (arr,k,v)=>(arr||[]).find(r=>String(r[k])===String(v));
  const where = (arr,k,v)=>(arr||[]).filter(r=>String(r[k])===String(v));

  function fmtDate(iso){
    if(!iso) return "";
    const d = new Date(iso); if(isNaN(d)) return "";
    const days = Math.floor((Date.now()-d)/86400000);
    if(days===0) return "today"; if(days===1) return "yesterday";
    if(days<30) return days+"d ago";
    return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
  }

  // Render an organization as an expandable <details> block
  function orgDetails(o){
    const school = by(DB.schools,"school_id",o.school_id);
    const cat = by(DB.categories,"category_id",o.category_id);
    const kids = where(DB.brands,"org_id",o.org_id);
    const web = o.website ? String(o.website).replace(/^https?:\/\//,"") : null;
    return `<details class="org">
      <summary>
        <strong>${esc(o.org_name)}</strong>
        ${school?`<span class="tag">${esc(school.school_name)}</span>`:""}
        ${cat?`<span class="tag blue">${esc(cat.category_name)}</span>`:""}
        ${o.founded_year?`<span class="tag">est. ${esc(o.founded_year)}</span>`:""}
        ${o.member_count?`<span class="tag">${esc(o.member_count)} members</span>`:""}
      </summary>
      <div class="detail"><dl class="kv">
        <dt>Creates</dt><dd>${esc(o.what_they_create)||"—"}</dd>
        <dt>How it's run</dt><dd>${esc(o.how_run_notes)||"—"}</dd>
        <dt>Governance</dt><dd>${esc(o.governance_model)||"—"}</dd>
        <dt>Funding</dt><dd>${esc(o.funding_model)||"—"}</dd>
        <dt>Academic credit</dt><dd>${esc(o.academic_credit)||"—"}</dd>
        <dt>Independent</dt><dd>${esc(o.independent_from_school)||"—"}</dd>
        ${web?`<dt>Website</dt><dd><a href="https://${esc(web)}" target="_blank" rel="noopener">${esc(o.website)}</a></dd>`:""}
        ${kids.length?`<dt>Brands / shows</dt><dd>${kids.map(k=>`<strong>${esc(k.brand_name)}</strong> — ${esc(k.description)}`).join("<br>")}</dd>`:""}
      </dl></div>
    </details>`;
  }

  // Render media embeds for a given page key ('ucla'|'colleges'|'other')
  function embeds(pageKey){
    const rows = where(DB.media_embeds,"page",pageKey);
    if(!rows.length) return "";
    return `<div class="embeds">` + rows.map(m=>`
      <div class="embed ${m.kind==='soundcloud'?'audio':''}">
        <div class="frame">
          <iframe loading="lazy" src="${esc(m.src)}"
            allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"
            allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>
        <div class="cap">
          <h4>${esc(m.name)}</h4>
          <p>${esc(m.note)} ${m.link?`· <a href="${esc(m.link)}" target="_blank" rel="noopener">open</a>`:""}</p>
        </div>
      </div>`).join("") + `</div>`;
  }

  return { DB, el, esc, by, where, fmtDate, orgDetails, embeds };
})();
