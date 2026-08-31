/* BruinCast — SYNTHETIC feed corpus for the Data Lab.
 *
 * The research dataset in assets/data.js is real. The item-level publishing
 * corpus is NOT: bruincast_reader/data.json is git-ignored and only exists once
 * somebody runs the ingester, so this module stands in for it.
 *
 * Everything generated here is deterministic (seeded PRNG) and derived from the
 * REAL feed registry in data.js — feed names, verticals and schools are genuine,
 * the per-item volumes and timestamps are simulated. The UI labels every number
 * that comes from here as simulated. To replace it with real data, run:
 *     cd bruincast_reader && python3 ingest.py fetch && python3 ingest.py export
 * and the Data Lab will prefer the exported data.json automatically.
 */
window.BCLabMock = (function(){
  const rnd = window.BCStats.seededRandom(20260624);   // the research brief's date, as a seed

  // Publishing rhythm per vertical: mean items/week and share of items carrying media.
  const CADENCE = {
    news:            {perWeek: 21, media: 0.28, authorRate: 0.94},
    sports:          {perWeek: 12, media: 0.34, authorRate: 0.92},
    art_design:      {perWeek: 5,  media: 0.44, authorRate: 0.88},
    radio:           {perWeek: 3,  media: 0.71, authorRate: 0.55},
    video:           {perWeek: 4,  media: 0.96, authorRate: 0.48},
    film_tv_theater: {perWeek: 3,  media: 0.81, authorRate: 0.62},
    gaming:          {perWeek: 2,  media: 0.66, authorRate: 0.5},
    business:        {perWeek: 1.5,media: 0.14, authorRate: 0.9},
    sciences:        {perWeek: 1,  media: 0.11, authorRate: 0.87}
  };

  const HEADLINES = {
    news:     ["Regents approve {n}% increase in student media funding","Undergraduate council debates newsroom independence","Campus housing plan draws {n} public comments","Enrollment climbs for the {n}th straight year","Student government funds new production studio"],
    sports:   ["Bruins hold off {opp} in {n}-point comeback","Gymnastics posts season-best {n} at home meet","Football preview: three keys against {opp}","Beach volleyball sweeps weekend series","Recruiting notebook: {n} commits sign"],
    art_design:["Student designers stage {n}-piece capstone show","Review: a bold reworking of a familiar score","Gallery talk explores archival printmaking","Costume shop rebuilds a century of stagecraft"],
    radio:    ["Broadcast: {n}-minute live call from Pauley","Playlist: new releases from student artists","Podcast: inside the campus music scene","Live session with a student ensemble"],
    video:    ["Highlights: {n} plays from Saturday","Behind the broadcast: a student control room","Weekly newscast, week {n}","Feature: the crew that runs game day"],
    film_tv_theater:["Student film festival screens {n} shorts","Set report: a two-camera live drama","Craft talk on editing for live sports"],
    gaming:   ["Esports team advances to round {n}","Broadcast crew calls the conference final","Valorant roster reshuffles ahead of playoffs"],
    business: ["Analysis: campus media budgets since 2015","Interview: monetizing a student newsroom"],
    sciences: ["Undergraduate researchers publish {n}-year dataset","Lab notebook: instrumentation on a student budget"]
  };

  const OPPONENTS = ["USC","Oregon","Washington","Michigan","Ohio State","Arizona","Cal","Purdue"];
  const FIRST = ["Alex","Priya","Jordan","Maya","Diego","Simone","Noah","Amara","Wei","Rosa","Ellis","Kai"];
  const LAST  = ["Nguyen","Alvarez","Okafor","Bennett","Kaur","Rossi","Delgado","Mbeki","Park","Ibarra"];

  const pick = (arr)=>arr[Math.floor(rnd()*arr.length)];

  function headline(vertical){
    const set = HEADLINES[vertical] || HEADLINES.news;
    return pick(set)
      .replace("{n}", String(2 + Math.floor(rnd()*28)))
      .replace("{opp}", pick(OPPONENTS));
  }

  /** Seasonality: quieter weekends, and a summer trough that mirrors the academic year. */
  function dayWeight(date){
    const dow = date.getUTCDay();
    const weekend = (dow === 0 || dow === 6) ? 0.45 : 1;
    const month = date.getUTCMonth();               // 0 = January
    const summer = (month === 5 || month === 6 || month === 7) ? 0.35
                 : (month === 11 || month === 0) ? 0.72 : 1;
    return weekend * summer;
  }

  /**
   * Build a corpus shaped exactly like bruincast_reader/data.json.
   * @param {Array} feeds  the real feed registry (BRUINCAST_DATA.feeds)
   * @param {Object} lookup {schoolName(id), categoryName(id)}
   * @param {number} days   how far back to simulate
   */
  function generateCorpus(feeds, lookup, days){
    const window_ = days || 400;
    const now = Date.now();
    const items = [];
    let itemId = 0;

    (feeds||[]).forEach(f=>{
      const cad = CADENCE[f.vertical] || CADENCE.sciences;
      const schoolName = lookup.schoolName(f.school_id);
      const categoryName = lookup.categoryName(f.category_id);
      // Per-feed multiplier keeps outlets distinguishable but stable.
      const mult = 0.55 + rnd()*0.95;

      for(let d = window_; d >= 0; d--){
        const date = new Date(now - d*86400000);
        const lambda = (cad.perWeek/7) * mult * dayWeight(date);
        let n = 0;
        // Small-count Poisson via inversion.
        const L = Math.exp(-lambda);
        let p = 1;
        do { n++; p *= rnd(); } while(p > L);
        n--;

        for(let k=0;k<n;k++){
          itemId++;
          const published = new Date(date.getTime() + Math.floor(rnd()*86400000));
          const hasMedia = rnd() < cad.media;
          const medium = f.vertical === "radio" ? "audio"
                       : (f.vertical === "video" || f.vertical === "film_tv_theater") ? "video" : "image";
          items.push({
            item_id: itemId,
            title: headline(f.vertical),
            link: (f.site_url || "https://example.edu") + "/story/" + itemId,
            // ~7% of items genuinely arrive without a byline in RSS — kept so the
            // quality panel has something real-shaped to report.
            author: rnd() < cad.authorRate ? `${pick(FIRST)} ${pick(LAST)}` : null,
            published_at: rnd() < 0.985 ? published.toISOString() : null,
            summary: null,
            feed_id: f.feed_id,
            feed_name: f.feed_name,
            vertical: f.vertical,
            school_name: schoolName,
            category_name: categoryName,
            thumbnail: null,
            assets: hasMedia ? {[medium]: 1 + Math.floor(rnd()*2)} : {}
          });
        }
      }
    });

    items.sort((a,b)=>String(b.published_at||"").localeCompare(String(a.published_at||"")));

    const feedRollup = (feeds||[]).map(f=>{
      const mine = items.filter(i=>i.feed_id === f.feed_id);
      const dates = mine.map(i=>i.published_at).filter(Boolean).sort();
      return {
        feed_id: f.feed_id, feed_name: f.feed_name, vertical: f.vertical,
        school_name: lookup.schoolName(f.school_id),
        total_items: mine.length,
        earliest_post: dates[0] || null,
        latest_post: dates[dates.length-1] || null,
        last_status: "simulated"
      };
    });

    return {
      generated_at: new Date(now).toISOString(),
      source: "synthetic",
      items, feeds: feedRollup
    };
  }

  return {generateCorpus, CADENCE};
})();
