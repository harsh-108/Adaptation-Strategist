/* Adaptation Strategist: the main app, on the atlas's open data sources. No login: the persona picker sets the
   sections, and the team shares sites, approvals, the audit trail, meter summaries and assumptions on the server. */
(function(){
"use strict";
const MAP=window.ATLAS_MAP,D=window.ATLAS_HAZARDS,HUBS=MAP.hubs,HZD=D.hubs,GOOGLE=window.PV_GOOGLE||{},METERS=window.PV_SAMPLE_METERS||{};
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf=(x,d)=>x==null||!isFinite(x)?"–":Number(x).toLocaleString("en",{maximumFractionDigits:d||0,minimumFractionDigits:0});
const SITEHUBS=[];
const hub=id=>HUBS.find(h=>h.id===id)||SITEHUBS.find(h=>h.id===id);
/* Scope (review of 17 Oct 2026, decision A): every screen shows Asia-Pacific places only. Hubs elsewhere stay in the
   data files untouched; change SCOPE to widen it once rules exist for other regions. */
const SCOPE="Asia-Pacific",inScope=h=>!!h&&h.r===SCOPE;
const allData=()=>HUBS.filter(h=>HZD[h.id]);
const withData=()=>allData().filter(inScope);
const apac=withData;
const inView=id=>{const h=hub(id);return !!(h&&HZD[id]&&(h.site||inScope(h)));};
/* A team site's region: that of the nearest scored hub anywhere. */
const regionAt=(lat,lon)=>{const n=allData().map(h=>({h,d:km(lat,lon,HZD[h.id].lat,HZD[h.id].lon)})).sort((a,b)=>a.d-b.d)[0];return n?n.h.r:SCOPE;};
/* Data sources used by places in scope (plus any not tied to a place); the Glossary lists these and Home counts them. */
const SRCS=(()=>{const ids=(o,acc)=>{if(Array.isArray(o)){o.forEach(v=>ids(v,acc));}else if(o&&typeof o==="object"){Object.entries(o).forEach(([k,v])=>{if(k==="src"){[].concat(v).forEach(x=>acc.add(x));}else{ids(v,acc);}});}return acc;};
  const inS=new Set(),any=new Set();HUBS.forEach(h=>{if(HZD[h.id]){ids(HZD[h.id],any);if(inScope(h)){ids(HZD[h.id],inS);}}});
  return (D.sources||[]).filter(x=>inS.has(x.id)||!any.has(x.id));})();
const W=ms=>new Promise(r=>setTimeout(r,ms));

/* ================= atlas scoring (unchanged rules) ================= */
const HZ=[["heat","Heat","--heat"],["flood","Flood","--flood"],["water","Water stress","--water"],["grid","Grid reliability","--grid"],["cyclone","Cyclones","--cyclone"],["volcano","Volcanoes","--volcano"],["earthquake","Earthquakes","--quake"],["wildfire","Wildfire","--fire"]];
const HZK=HZ.map(h=>h[0]);
const key=(h,p)=>h==="today"?"t":(p==="mod"?"m":"h")+(h==="2030"?"30":"50");
const entry=(z,k)=>(z||{})[k]||((z||{}).other||{})[k];
function scoresOf(z,h,p){const k=key(h,p);return HZK.map(n=>{const e=entry(z,n);if(!e||e.kind==="none"||e.t==null){return null;}return e[k]!=null?e[k]:e.t;});}
function comp(sc){const m=sc.filter(v=>v!=null);if(!m.length){return null;}const a=m.reduce((x,y)=>x+y,0)/m.length;return Math.round(0.6*a+0.4*Math.max(...m));}
const band=c=>c==null?"No data":c<35?"Low":c<55?"Moderate":c<70?"High":"Severe";
const bcol=c=>c==null?"#ECEFEC":c<35?"#DCEFE4":c<55?"#F6EBC9":c<70?"#F8DCC7":"#F3D0CB";
const btxt=c=>c==null?"#3F4D46":c<35?"#1E5A40":c<55?"#6B4D06":c<70?"#7A3410":"#7E1A12";
const pill=c=>`<span class="pill" style="background:${bcol(c)};color:${btxt(c)}">${c==null?"–":c}</span>`;
const goodPill=s=>`<span class="pill" style="background:${bcol(100-s)};color:${btxt(100-s)}">${s}</span>`;
const PROV={modelled:"Data",today:"Data · today only",history:"Data · history",constant:"Data · constant",own:"Your value","own-change":"Data + your change",none:"No data"};
const worstIdx=sc=>{let w=-1;sc.forEach((v,i)=>{if(v!=null&&(w<0||v>sc[w])){w=i;}});return w;};
const cssv=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function km(a,b,c,d){const r=Math.PI/180,x=Math.sin((c-a)*r/2),y=Math.sin((d-b)*r/2);return 2*6371*Math.asin(Math.sqrt(x*x+Math.cos(a*r)*Math.cos(c*r)*y*y));}
const latMs=(a,b)=>Math.round(km(a.lat,a.lon,b.lat,b.lon)/66.7+5);
const gcOf=id=>((HZD[id]||{}).extra||{}).gridCarbon||null;
const scenTxt=(h,p)=>h==="today"?"Today":h+", "+(p==="mod"?"SSP2-4.5":"SSP5-8.5");

/* ================= personas, nav (no login) ================= */
const PERS={
 op:{name:"Data centre operator",scope:"Site scope",job:"Keep a facility efficient and resilient: cooling, water, heat reuse and retrofit capex.",decides:"Retrofit plan",dash:"Site resilience cockpit",get:"an approved retrofit package that meets your PUE rule and resilience target."},
 colo:{name:"Colocation & hyperscaler",scope:"Fleet scope",job:"Decide where to build the next block of capacity and how to design it for the climate it will face.",decides:"Siting & design",dash:"Fleet risk & siting",get:"an investment-committee-ready siting and design choice."},
 ten:{name:"Enterprise tenant",scope:"Tenant scope",job:"Place an AI workload in the cleanest compliant cloud region and report it with confidence.",decides:"Workload placement",dash:"Workload placement advisor",get:"an approved placement plus a disclosure-ready footprint."},
 pol:{name:"Policy maker",scope:"Pooled data only",job:"Plan grid and water capacity for data centre growth and test policy options on public and pooled data.",decides:"Policy package",dash:"Regional observatory",get:"a policy package ready for sign-off, with its modelled effect."}
};
const PK=["op","colo","ten","pol"];
const NAV=[["home","Home"],["work","My workspace"],["dash","Dashboard"],["earth","Earth view"],["impact","Impact"],["glossary","Glossary"]];
const allowed=(page,p)=>!(page==="hubs"&&p==="pol");
const WTABS={op:[["sites","My sites"],["finder","Expansion finder"],["backup","Backup pairing"],["hubs","Manage hubs"],["alerts","Alerts"],["assume","Assumptions"],["guided","Guided flow"]],pol:[["whatif","Growth what-if"],["ranking","Impact ranking"],["alerts","Alerts"],["assume","Assumptions"],["guided","Guided flow"]]};
WTABS.colo=WTABS.op;WTABS.ten=WTABS.op;

/* ================= state ================= */
const S=Object.assign({runs:{op:{},colo:{},ten:{},pol:{}},upload:null,pins:["SIN","NRT","SYD"],finder:{region:"Asia-Pacific",country:"",mw:100,w:{heat:2,flood:2,water:2,grid:2,cyclone:2,volcano:2,earthquake:2,wildfire:2,carbon:2}},approver:""},(()=>{try{return JSON.parse(localStorage.getItem("strategist-v1")||sessionStorage.getItem("strategist-v1")||"{}");}catch(e){return {};}})());
const save=()=>{try{localStorage.setItem("strategist-v1",JSON.stringify(S));}catch(e){}};
let PERSONA=(()=>{try{return localStorage.getItem("st-persona")||"op";}catch(e){return "op";}})();
if(!PERS[PERSONA]){PERSONA="op";}
const setPersona=p=>{if(p!==PERSONA){FLEET=null;if(window.STA){STA.event("select_persona",{persona:p});}}PERSONA=p;try{localStorage.setItem("st-persona",p);}catch(e){}};

/* ================= glossary (ⓘ everywhere) ================= */
const G={
 measured:["Measured","Taken from one of the app's open data sources and shown with that source.","Never estimated from other places.","Data build"],
 yours:["Your data","A number you uploaded or typed, such as meter readings or energy per 1,000 inferences.","Used as given; files are read in your browser.","You"],
 estimate:["Estimate","Worked out from a simple formula, for example latency from distance.","Replace it with a measured value when you have one.","Formula shown in each ⓘ"],
 assume:["Assumption","A lever effect or cost with no open source, such as the PUE saving from liquid cooling.","Blank until someone on the team enters a value in My workspace · Assumptions, with their name and where it comes from. Blank counts as zero. Never presented as data.","Entered by your team"],
 nodata:["No data","No open source covers this here, so it is left out of targets and best fit.","The reason is shown next to it.","–"],
 overall:["Overall climate risk","60% the average of the hazards that have data, plus 40% the worst one.","Bands: under 35 Low, 35–54 Moderate, 55–69 High, 70+ Severe.","All eight hazard data sources"],
 resilience:["Resilience score","100 minus the overall climate risk after your levers; higher is better.","Target 45 means overall risk at or below 55 (below High).","Hazard data and strategy library"],
 critical:["Climate-critical metric","A metric that protects against future climate harm, e.g. resilience or water stress.","A lever that worsens it is maladaptation.","Strategist method"],
 classes:["No-regret, trade-off, maladaptation","No-regret improves metrics without worsening any. Trade-off worsens a non-critical metric. Maladaptation worsens a climate-critical one, or breaks a built-in rule for this place.","Worked out from each lever's own effects at this place.","Strategist method + built-in rules"],
 bestfit:["AI best fit","Every combination of the available levers is tried.","Score = 1,000 × targets met + 3 × objective gain − cost − 5,000 per maladaptation lever. The highest score wins.","Strategist method"],
 compound:["Compounding","Percentage cuts multiply rather than add: −35% then −25% gives −51%, not −60%.","Fixes the design's adding of percentages.","Merged app"],
 heat:["Heat","Hot days (35 °C+) and cooling load.","Half from hot days a year (150 = 100), half from cooling degree days (4,000 = 100).","NASA POWER; World Bank CMIP6"],
 flood:["Flood","River and coastal flood risk.","Worse of Aqueduct's river and coastal scores × 20.","WRI Aqueduct 3.0"],
 water:["Water stress","Local water already in use vs what's available.","Aqueduct score 0–5 (× 20 for the 0–100 hazard score).","WRI Aqueduct"],
 grid:["Grid reliability","How often the grid fails to supply power.","Measured World Bank city outages or Grid-India state shortfall; otherwise No data.","World Bank; Grid-India"],
 cyclone:["Cyclones","Tropical storms passing close by.","Storms within 150 km per decade and typhoon-strength passes within 100 km.","NOAA IBTrACS; STORM"],
 volcano:["Volcanoes","Closest recently active volcano within 100 km.","Closer and more recent = higher.","Smithsonian GVP"],
 earthquake:["Earthquakes","Magnitude 6+ within 300 km.","Per decade, 8 = 100.","USGS"],
 wildfire:["Wildfire","Satellite-detected fires within 25 km.","100 × √(fires a year ÷ 150).","NASA FIRMS"],
 carbon:["Grid carbon intensity","g CO₂ per kWh from the national grid (location-based).","Latest measured year.","Ember via Our World in Data"],
 cfe:["Carbon-free energy (CFE %)","Share of hours a cloud region runs on carbon-free power, including the provider's purchases.","Hourly matched, yearly average.","Google Cloud region data 2025"],
 pue:["PUE","Total facility energy ÷ IT energy.","Σ facility kWh ÷ Σ IT kWh over hours with both readings.","Your meter file"],
 gate:["Data-quality gate","At least 90% of hours must have both readings before a plan can go forward.","Below that the flow stops at the baseline.","Strategist method"],
 latency:["Latency estimate","Rough round trip from users to the site or region.","Distance ÷ 66.7 km per ms + 5 ms.","Formula"],
 sea:["Sea level rise","Projected rise at the nearest tide gauge. Context only.","Relative to 1995–2014.","IPCC AR6"],
 rules:["Rules in force","Regulations and targets per country, each with a source.","Verified, To verify, or App default.","JAPAC rulebook, checked 16 Oct 2026"],
 approval:["Approval route","Who signs off, from the approval rules (cost, block size, country).","Each step needs a reason and is logged.","Strategist approval rules"],
 audit:["Tamper-evident audit log","Each entry carries a SHA-256 fingerprint of the one before.","'Verify audit trail' recomputes them all on the server.","Kept on the server, shared by the team"],
 suit:["Suitability","0–100, higher is better: 100 minus the weighted average of the hazards and grid carbon you care about.","Grid carbon: 0 g = 0, 800 g = 100.","Hazard data; Ember"],
 pair:["Backup pair score","0–100, higher is better: 100 − backup's risk − 15 per shared high hazard − 5 for the same grid.","300–3,000 km apart.","Hazard data"],
 whatif:["Growth what-if","Electricity, emissions and water from steady data centre growth.","MW × 70% load × 8,760 h × PUE.","Ember; Aqueduct"],
 kanon:["k-anonymity","Pooled figures only shown for groups of 5+ operators.","Smaller groups are suppressed.","Pooling rule"],
 persona:["Personas, no login","Pick who you are at the top right; the menu shows that persona's sections.","There are no accounts: the choice is remembered in this browser only.","Merged app"]
};
const info=k=>`<span class="ib" data-g="${k}"></span>`;
const KIND={measured:["Measured","k-measured"],yours:["Your data","k-yours"],estimate:["Estimate","k-estimate"],assume:["Assumption","k-assume"],nodata:["No data","k-nodata"]};
const kindB=k=>`<span class="kind ${KIND[k][1]}">${KIND[k][0]}</span>`;
function wireInfo(root){
  (root||document).querySelectorAll(".ib[data-g]").forEach(el=>{
    if(el.firstChild){return;}const g=G[el.dataset.g];if(!g){return;}const id="tip-"+el.dataset.g+"-"+Math.random().toString(36).slice(2,7);
    el.innerHTML=`<button type="button" aria-expanded="false" aria-controls="${id}" aria-label="About ${esc(g[0])}">i</button><div class="tip" id="${id}" role="note" hidden><b>${esc(g[0])}</b>${esc(g[1])}<div class="how">${esc(g[2])}</div><div class="from">Source: ${esc(g[3])} · <a href="#/glossary">Glossary</a></div></div>`;
  });
}
document.addEventListener("click",e=>{
  const b=e.target.closest&&e.target.closest(".ib>button");
  document.querySelectorAll(".ib>button[aria-expanded='true']").forEach(o=>{if(o!==b){o.setAttribute("aria-expanded","false");o.nextSibling.hidden=true;}});
  if(b){e.preventDefault();const open=b.getAttribute("aria-expanded")!=="true";b.setAttribute("aria-expanded",open);b.nextSibling.hidden=!open;}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){document.querySelectorAll(".ib>button[aria-expanded='true']").forEach(o=>{o.setAttribute("aria-expanded","false");o.nextSibling.hidden=true;o.focus();});}});
let toastT;function toast(t){let el=$("toast");if(!el){el=document.createElement("div");el.id="toast";el.className="toast";el.setAttribute("role","status");document.body.appendChild(el);}el.textContent=t;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{el.hidden=true;},3600);}
function download(name,text){const a=document.createElement("a"),u=URL.createObjectURL(new Blob([text],{type:"text/csv"}));a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
const csvCell=v=>{let s=v==null?"":String(v);if(/^[=+\-@]/.test(s)&&!/^-?\d/.test(s)){s="'"+s;}return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const csv=rows=>"﻿"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
const seg=(items,cur,attr)=>`<div class="seg" role="group">${items.map(it=>`<button type="button" ${attr}="${it[0]}" aria-pressed="${String(it[0])===String(cur)}">${it[1]}</button>`).join("")}</div>`;
const placeOpts=sel=>hubOpts(sel,apac())+siteGroup(sel);
const hubOpts=(sel,list)=>(list||withData()).slice().sort((a,b)=>a.r.localeCompare(b.r)||a.n.localeCompare(b.n)).map(h=>`<option value="${h.id}"${h.id===sel?" selected":""}>${esc(h.n)} · ${esc(h.c)}</option>`).join("");

/* ================= rulebook ================= */
const JUR={"Japan":"JP","Singapore":"SG","Australia":"AU","India":"IN","China":"CN","South Korea":"KR","Korea":"KR","Hong Kong":"HK","Malaysia":"MY"};
const jurOf=h=>h?(h.id==="HKG"?"HK":JUR[h.c]||""):"";
const NORULE=()=>{const cs=[...new Set(withData().filter(h=>!jurOf(h)).map(h=>h.c))].sort();return cs.length?"No rule on file yet for "+cs.join(", ")+".":"";};
const JNAME={JP:"Japan",SG:"Singapore",AU:"Australia",IN:"India",CN:"China",KR:"South Korea",HK:"Hong Kong",MY:"Malaysia"};
const RULES=[
 {j:"JP",name:"Energy Conservation Act: data centre benchmark",area:"Efficiency",req:"PUE ≤ 1.4 by FY2030 (weighted average across the operator's data centres; a benchmark)",pue:1.4,st:"Verified",src:"https://shulman-advisory.com/?p=5994"},
 {j:"JP",name:"Energy Conservation Act: new data centres",area:"Efficiency",req:"PUE ≤ 1.3 for data centres built from FY2029, after two years of operation",pue:1.3,st:"Verified",src:"https://intelligence.uptimeinstitute.com/resource/japan-joins-push-data-center-regulation"},
 {j:"JP",name:"SSBJ climate disclosure",area:"Disclosure",req:"ISSB-based disclosure from FY ending Mar 2027 for Prime-listed companies ≥ ¥3 tn; smaller tiers 2028–2029",st:"Verified",src:"https://www.fsa.go.jp/singi/singi_kinyu/tosin/20260108/02.pdf"},
 {j:"JP",name:"AI Promotion Act",area:"AI governance",req:"In force 4 Jun 2025 (chapters 3–4 from 1 Sep 2025). Cooperation duty; no penalties",st:"Verified",src:"https://fpf.org/blog/understanding-japans-ai-promotion-act/"},
 {j:"SG",name:"Green Data Centre Roadmap (IMDA)",area:"Efficiency",req:"PUE ≤ 1.3 at 100% IT load and WUE ≤ 2.0 m³/MWh, aspirational, by about 2034",pue:1.3,st:"Verified",src:"https://www.mayerbrown.com/en/insights/publications/2024/08/singapores-green-data-centre-roadmap-representing-a-necessary-intersection-between-digital-infrastructure-and-sustainability"},
 {j:"SG",name:"Data Centre Call for Application 2",area:"Efficiency",req:"PUE ≤ 1.25 at 100% IT load, Green Mark Platinum, ≥ 50% green energy. Call closed 31 Mar 2026",pue:1.25,st:"Verified",src:"https://www.imda.gov.sg/resources/press-releases-factsheets-and-speeches/factsheets/2025/launch-of-second-data-centre"},
 {j:"SG",name:"SGX / ACRA climate reporting",area:"Disclosure",req:"Scope 1–2 for all listed companies from FY2025; Scope 3 for STI constituents from FY2026",st:"Verified",src:"https://www.singaporelawwatch.sg/Headlines/singapore-delays-full-climate-disclosures-for-small-and-mid-sized-listcos"},
 {j:"SG",name:"Model AI Governance Framework for Agentic AI",area:"AI governance",req:"Voluntary; launched 22 Jan 2026",st:"Verified",src:"https://www.mddi.gov.sg/newsroom/singapore-launches-new-model-ai-governance-framework-for-agentic-ai--/"},
 {j:"AU",name:"Mandatory climate reporting (AASB S2)",area:"Disclosure",req:"Groups 1–3 from 1 Jan 2025 / 1 Jul 2026 / 1 Jul 2027; reasonable assurance from 1 Jul 2030",st:"Verified",src:"https://www.auasb.gov.au/media/yffbehwp/assa-5010-timeline-for-audits-and-reviews-of-information-in-sustainability-reports-under-the-corporations-act-2001.pdf"},
 {j:"AU",name:"National AI Plan",area:"AI governance",req:"Released 2 Dec 2025; mandatory guardrails paused, existing laws apply",st:"Verified",src:"https://www.adnews.com.au/news/australia-pauses-ai-guardrails-and-goes-with-a-national-plan"},
 {j:"AU",name:"Internal reference target",area:"Efficiency",req:"PUE ≤ 1.35 (no national rule; replace with your own)",pue:1.35,st:"App default",src:""},
 {j:"IN",name:"DPDP Act and Rules 2025: cross-border transfer",area:"Data protection",req:"Main duties, including cross-border transfer (Rule 15), apply from 13 May 2027",st:"Verified",src:"https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-"},
 {j:"IN",name:"Carbon Credit Trading Scheme",area:"Carbon market",req:"490 heavy-industry entities after the Jan 2026 notification; data centres not covered",st:"Verified",src:"https://icapcarbonaction.com/en/news/compliance-obligations-under-indias-carbon-credit-trading-scheme-enter-force-seven-sectors"},
 {j:"IN",name:"Internal reference target",area:"Efficiency",req:"PUE ≤ 1.35 (no national rule; replace with your own)",pue:1.35,st:"App default",src:""},
 {j:"CN",name:"Data centre efficiency action plan",area:"Efficiency",req:"New and renovated large data centres PUE ≤ 1.25 by end-2025; national hub projects ≤ 1.2",pue:1.25,st:"Verified",src:"https://www.gov.cn/zhengce/zhengceku/202407/P020240724272072479001.pdf"},
 {j:"KR",name:"AI Basic Act",area:"AI governance",req:"In force 22 Jan 2026; fines up to KRW 30m after a grace period; applies to foreign operators serving Korea",st:"Verified",src:"https://www.cooley.com/news/insight/2026/2026-01-27-south-koreas-ai-basic-act-overview-and-key-takeaways"},
 {j:"KR",name:"Distributed Energy Activation Act",area:"Grid",req:"Grid impact assessment for new loads of 10 MW or more",st:"To verify",src:"https://view.asiae.co.kr/en/article/2024071716065974967"},
 {j:"HK",name:"HKEX climate disclosures",area:"Disclosure",req:"Scope 1–2 for all issuers from 1 Jan 2025; LargeCap full disclosure incl. Scope 3 from 1 Jan 2026",st:"Verified",src:"https://www.slaughterandmay.com/services/practices/environmental-social-and-governance/esg-in-apac-2025/hong-kong/"},
 {j:"MY",name:"National Sustainability Reporting Framework",area:"Disclosure",req:"IFRS S1/S2 by group from 2025 / 2026 / 2027; reasonable assurance deferred to 2028 / 2029 / 2030",st:"Verified",src:"https://www.sc.com.my/resources/media/media-release/acsrs-mandatory-sustainability-assurance-requirement-to-take-effect-in-2028"},
 {j:"MY",name:"Internal reference target",area:"Efficiency",req:"PUE ≤ 1.35 (no national rule; replace with your own)",pue:1.35,st:"App default",src:""}
];
const pueRule=j=>RULES.filter(r=>r.j===j&&r.pue).sort((a,b)=>b.pue-a.pue)[0];
const rulesBox=j=>j&&RULES.some(r=>r.j===j)?`<div class="tblwrap"><table class="t"><tbody>${RULES.filter(r=>r.j===j).slice(0,5).map(r=>`<tr><td><b>${esc(r.name)}</b><div class="src">${esc(r.req)}</div></td><td>${r.src?`<a href="${esc(r.src)}" target="_blank" rel="noopener noreferrer">${esc(r.st)}</a>`:`<span class="chip grey">${esc(r.st)}</span>`}</td></tr>`).join("")}</tbody></table></div>`:'<p class="sub">No rule on file for this country yet.</p>';
const rulesLink='<p class="src"><a href="#/glossary/rules">All rules in the Glossary →</a></p>';

/* ================= atlas strategy library (hazard effects) ================= */
const LIB=[
 {id:"siteDD",cat:"Siting and planning",t:"Run climate-adjusted due diligence before choosing or expanding a site",e:[10,10,10,10],c:1,lo:1,hi:3,aud:["op","colo","pol"],note:"Cheapest option for new growth because it avoids locking in exposure. Needs forward-looking hazard data, not historical averages."},
 {id:"multi",cat:"Siting and planning",t:"Spread critical workloads across regions with different hazard profiles",e:[8,8,8,8],c:2,lo:3,hi:9,aud:["colo","ten"],note:"Reduces concentration risk, but check latency and data-residency constraints."},
 {id:"zoning",cat:"Siting and planning",t:"Tie permits to local water and power capacity assessments",e:[0,0,10,10],c:2,lo:12,hi:36,aud:["pol"],note:"Slow to put in place, but protects shared community resources as demand grows."},
 {id:"inlet",cat:"Cooling and heat",t:"Run warmer inlet temperatures and tune airflow",e:[8,0,6,0],c:1,lo:1,hi:3,aud:["op","colo"],note:"A quick win, subject to equipment warranty limits and reliability testing."},
 {id:"chill",cat:"Cooling and heat",t:"Size cooling for future design-day temperatures",e:[18,0,0,0],c:2,lo:9,hi:15,aud:["op","colo"],note:"Best done at build or refit time, when added capacity is cheaper to include."},
 {id:"liquid",cat:"Cooling and heat",t:"Adopt liquid or direct-to-chip cooling for high-density racks",e:[14,0,10,0],c:3,lo:12,hi:24,aud:["op","colo"],note:"Tolerates hotter ambient conditions and can cut water use, but needs new plant and skills."},
 {id:"tes",cat:"Cooling and heat",t:"Add thermal storage to ride through peak heat",e:[10,0,0,6],c:2,lo:6,hi:12,aud:["op","colo"],note:"Shifts cooling load away from the hottest, most grid-stressed hours."},
 {id:"tenv",cat:"Cooling and heat",t:"Accept wider thermal envelopes in service agreements",e:[6,0,4,0],c:1,lo:1,hi:3,aud:["ten"],note:"Gives the provider room to cool efficiently. Agree limits for sensitive workloads."},
 {id:"hybrid",cat:"Water",t:"Switch to hybrid or closed-loop cooling",e:[6,0,26,0],c:2,lo:9,hi:12,aud:["op","colo"],note:"Large water saving, but it can raise electricity use, so check the grid first."},
 {id:"recl",cat:"Water",t:"Contract reclaimed or recycled water",e:[0,0,20,0],c:1,lo:3,hi:6,aud:["op","colo","pol"],note:"Depends on a nearby treatment network. A municipal partnership is usually needed."},
 {id:"drought",cat:"Water",t:"Set water-use targets and a drought contingency plan",e:[0,0,10,0],c:1,lo:1,hi:3,aud:["op","colo","pol"],note:"Define triggers for switching cooling mode or shedding load before supply is restricted."},
 {id:"raise",cat:"Flood and storm",t:"Raise critical plant above future flood levels",e:[0,28,0,4],c:3,lo:12,hi:18,aud:["op","colo"],note:"Highest impact for flood-prone sites. Plan around switchgear, generators and fuel storage."},
 {id:"barrier",cat:"Flood and storm",t:"Install flood barriers, drainage and water-level sensing",e:[0,18,0,0],c:2,lo:6,hi:9,aud:["op","colo"],note:"Faster and cheaper than relocation, but needs maintenance and drills to stay effective."},
 {id:"storm",cat:"Flood and storm",t:"Harden roofs, cooling units and cabling for storm loads",e:[0,12,0,6],c:2,lo:6,hi:12,aud:["op","colo"],note:"Match ratings to projected wind and surge, not past events."},
 {id:"feed",cat:"Power and grid",t:"Secure a second, independent grid feed",e:[0,0,0,20],c:3,lo:18,hi:24,aud:["op","colo"],note:"Long lead time, and depends on the utility and local network capacity."},
 {id:"batt",cat:"Power and grid",t:"Add on-site batteries or a microgrid",e:[0,0,0,18],c:3,lo:12,hi:24,aud:["op","colo"],note:"Also supports demand response. Plan for fire safety and battery heat."},
 {id:"dr",cat:"Power and grid",t:"Join demand response and shift flexible workloads",e:[4,0,0,10],c:1,lo:3,hi:6,aud:["op","colo","ten"],note:"Low cost, but needs workloads that can move in time or place without breaking commitments."},
 {id:"ppa",cat:"Power and grid",t:"Contract firmed renewable supply",e:[0,0,0,8],c:2,lo:6,hi:18,aud:["colo","ten"],note:"Hedges price and carbon. Firming matters more than headline volume."},
 {id:"run",cat:"Operations",t:"Create climate-triggered runbooks and early-warning feeds",e:[6,6,4,6],c:1,lo:1,hi:3,aud:["op","colo","ten"],note:"Rehearse them. The value comes from acting before the event, not from the document."},
 {id:"tclause",cat:"Finance and governance",t:"Write climate resilience into contracts and exit clauses",e:[4,4,4,4],c:1,lo:1,hi:3,aud:["ten"],note:"Gives tenants leverage and clarity on failover duties."},
 {id:"disc",cat:"Finance and governance",t:"Prepare IFRS S2-aligned physical-risk disclosure and insurer evidence",e:[2,2,2,2],c:1,lo:3,hi:6,aud:["op","colo","ten","pol"],note:"Mostly a governance gain, but strong evidence can support financing and insurance terms."},
 {id:"waste",cat:"Community",t:"Reuse waste heat in district heating",e:[4,0,0,0],c:3,lo:24,hi:36,aud:["op","colo","pol"],note:"Needs a nearby heat customer. Strong community benefit where it works."},
 {id:"compact",cat:"Community",t:"Publish local water and power use and agree community commitments",e:[0,0,6,4],c:1,lo:3,hi:6,aud:["op","colo","pol"],note:"Builds trust and eases permitting. Commit only to what you will measure."}
];
const ACT={evap:[0,0,0,0]};LIB.forEach(x=>{ACT[x.id]=x.e;});
/* The atlas's own class rules for a place, from its scores. */
function libForce(id,sc){
  if(id==="inlet"&&sc[0]!=null&&sc[0]>=70){return ["mal","Built-in rule: less thermal headroom during the heatwaves this place faces (heat "+sc[0]+")."];}
  if(id==="hybrid"&&sc[3]!=null&&sc[3]>=55){return ["trade","Built-in rule: uses more electricity on a grid that already struggles (grid "+sc[3]+")."];}
  if(id==="chill"&&sc[2]!=null&&sc[2]>=70){return ["trade","Built-in rule: bigger evaporative plant draws more water where stress is "+sc[2]+"."];}
  if(id==="waste"){return ["trade","Built-in rule: needs a nearby heat customer; little resilience gain on its own."];}
  if(id==="multi"){return ["trade","Built-in rule: check latency and data-residency limits."];}
  return null;}
/* Cost bands ($, $$, $$$) as each persona's cost metric. Assumptions, shown as such. */
/* Assumptions (decision 4): lever effects and costs with no open source start blank and count as zero until someone on
   the team enters a value, with their name and where it comes from (My workspace · Assumptions). */
let AS={},ASLOG=[],ASV=0;
const A=k=>AS[k]?AS[k].value:null;
const pctOf=k=>A(k)==null?null:A(k)/100;
const NOVAL="No value entered yet: add it in My workspace · Assumptions.";
const ASSUME=[
 ["op.rdhx.pue","Rear-door liquid cooling","Change in PUE","PUE points, e.g. -0.10"],["op.rdhx.capex","Rear-door liquid cooling","Capex","$M"],
 ["op.dry.pue","Hybrid dry coolers + reclaimed water","Change in PUE","PUE points"],["op.dry.wue_pct","Hybrid dry coolers + reclaimed water","Change in WUE","%, e.g. -20"],["op.dry.capex","Hybrid dry coolers + reclaimed water","Capex","$M"],
 ["op.heat.pue","Heat reuse to a district network","Change in PUE","PUE points"],["op.heat.capex","Heat reuse to a district network","Capex","$M"],
 ["op.setpt.pue","Raise supply-air setpoint to 27 °C","Change in PUE","PUE points"],["op.setpt.capex","Raise supply-air setpoint to 27 °C","Capex","$M"],
 ["op.batt.capex","On-site battery for grid stress hours","Capex","$M"],["op.barrier.capex","Flood barriers, drainage and sensing","Capex","$M"],["op.feed.capex","Second, independent grid feed","Capex","$M"],
 ["op.band.c1","Library strategies costed $","Capex","$M"],["op.band.c2","Library strategies costed $$","Capex","$M"],["op.band.c3","Library strategies costed $$$","Capex","$M"],
 ["colo.relo.capex","Move to another site in the same market","Change in capex index","points"],["colo.liq.capex","Direct liquid cooling design","Change in capex index","points"],
 ["colo.evap.water_pts","Evaporative cooling","Extra water hazard","points on the 0–100 water score"],["colo.evap.capex","Evaporative cooling","Change in capex index","points (negative = cheaper)"],
 ["colo.ppa.carbon_pct","24/7 carbon-free PPA portfolio","Change in grid carbon (market-based)","%, e.g. -50"],["colo.ppa.capex","24/7 carbon-free PPA portfolio","Change in capex index","points"],
 ["colo.bess.carbon_pct","Battery storage + demand response","Change in grid carbon","%"],["colo.bess.capex","Battery storage + demand response","Change in capex index","points"],
 ["colo.band.c1","Library strategies costed $","Change in capex index","points"],["colo.band.c2","Library strategies costed $$","Change in capex index","points"],["colo.band.c3","Library strategies costed $$$","Change in capex index","points"],
 ["ten.small.carbon_pct","Switch to a quantised, smaller model","Change in energy per inference","%, e.g. -35"],["ten.small.lat_ms","Switch to a quantised, smaller model","Change in latency","ms"],["ten.small.cost","Switch to a quantised, smaller model","Change in cost index","points"],
 ["ten.green.carbon_pct","Buy the provider's renewable option","Change in carbon (market-based)","%"],["ten.green.cost","Buy the provider's renewable option","Change in cost index","points"],
 ["ten.cheap.cost","Move to Jakarta to save cost","Change in cost index","points"],
 ["ten.band.c1","Library strategies costed $","Change in cost index","points"],["ten.band.c2","Library strategies costed $$","Change in cost index","points"],["ten.band.c3","Library strategies costed $$$","Change in cost index","points"],
 ["pol.dry.elec_pct","Water-free cooling for new builds","Extra electricity","%, e.g. +3"]
].map(a=>({key:a[0],p:a[0].split(".")[0],lever:a[1],what:a[2],unit:a[3]}));
function applyAssumptions(){ACT.evap=[0,0,-(A("colo.evap.water_pts")||0),0];ASV++;}
async function loadAssumptions(){try{const j=await (await fetch("/api/assumptions")).json();AS=j.items||{};ASLOG=j.log||[];}catch(e){}applyAssumptions();}
const missing=keys=>(keys||[]).filter(k=>A(k)==null);
const COSTTXT=p=>p==="pol"?"no cost model for policy levers":["c1","c2","c3"].map((c,i)=>"$".repeat(i+1)+" = "+(A(p+".band."+c)==null?"blank":A(p+".band."+c)+(p==="op"?" $M":" points"))).join(", ");
function libLevers(p,sc,skip){return LIB.filter(x=>x.aud.includes(p)&&!skip.includes(x.id)&&!(p==="op"&&x.id==="siteDD")).map(x=>({id:"lib-"+x.id,name:x.t,act:[x.id],lib:x,cost:A(p+".band.c"+x.c),tip:x.note,force:libForce(x.id,sc)}));}
/* Approval hierarchy, from the design's approval_rules.csv and users_roles.csv. */
const HIER={op:[["Capex up to $5M","Facility lead",""],["Capex above $5M","Facility lead","Capex committee"],["Japan and PUE above 1.4","Facility lead","Energy manager (METI rationalisation plan)"]],
 colo:[["Block under 200 MW","Investment committee",""],["Block of 200 MW or more","Investment committee","Board"]],
 ten:[["Any placement change","Workload owner",""],["Cost index above 100","Workload owner","FinOps"],["Reporting under Korea","Workload owner","AI compliance lead"]],
 pol:[["Any publication","Policy director","Minister"]]};
const ROLES={op:"operators are editors: they build and send plans",colo:"editors build plans; approvers sign their step",ten:"editors build plans; approvers sign their step",pol:"viewers read; editors build and send packages"};
const EVID={op:["Meter file summary and data-quality score","Hazard scores for the chosen horizon and pathway","Best-fit explanation, lever classes and assumptions"],colo:["Site hazard scores under the chosen scenario","Grid carbon and latency estimate","Best-fit explanation, lever classes and assumptions"],ten:["Residency and SLA checks","Carbon-per-inference calculation with its inputs","Best-fit explanation, lever classes and assumptions"],pol:["Pooled-data rule (k ≥ 5)","Lever assumptions and ranges","Rules in force for the jurisdiction"]};
function applyAct(sc,acts){const o=sc.slice();acts.forEach(a=>(ACT[a]||[]).forEach((e,i)=>{if(o[i]==null||!e){return;}o[i]=e>0?Math.max(Math.min(o[i],5),o[i]-e):Math.min(100,o[i]-e);}));return o;}

/* ================= meter files ================= */
function meterParse(text){
  const lines=text.trim().split(/\r?\n/),head=lines[0].toLowerCase().split(",").map(s=>s.trim()),iF=head.indexOf("facility_kwh"),iI=head.indexOf("it_kwh"),iW=head.indexOf("water_litres");
  if(iF<0||iI<0){throw new Error("The file needs columns facility_kwh and it_kwh (and a timestamp).");}
  let F=0,I=0,Wt=0,IW=0,ok=0;const n=lines.length-1;
  for(const ln of lines.slice(1)){const c=ln.split(","),f=parseFloat(c[iF]),it=parseFloat(c[iI]);if(isFinite(f)&&isFinite(it)&&it>0){F+=f;I+=it;ok++;if(iW>=0&&isFinite(parseFloat(c[iW]))){Wt+=parseFloat(c[iW]);IW+=it;}}}
  if(!ok){throw new Error("No hours with both readings.");}
  return {hours:n,ok,complete:ok/n*100,pue:F/I,wue:IW?Wt/IW:null,itMWh:I/1000};
}
const SLABEL={"OP-S1":"Fictional sample meter file: one complete week","OP-S5":"Fictional sample meter file: one week with gaps"};
const SAMPLES={};Object.keys(METERS).forEach(k=>{try{SAMPLES[k]=Object.assign(meterParse(METERS[k].csv),{label:SLABEL[k]||METERS[k].label,fict:true});}catch(e){}});
const meterOf=id=>id==="upload"?S.upload:SAMPLES[id]||null;

/* ================= Google regions (tenant) ================= */
const REG={"asia-east1":["TPE","Taiwan"],"asia-east2":["HKG","Hong Kong"],"asia-northeast1":["NRT","Japan"],"asia-northeast2":["KIX","Japan"],"asia-northeast3":["ICN","South Korea"],"asia-south1":["BOM","India"],"asia-south2":["DEL","India"],"asia-southeast1":["SIN","Singapore"],"asia-southeast2":["CGK","Indonesia"],"asia-southeast3":["BKK","Thailand"],"australia-southeast1":["SYD","Australia"],"australia-southeast2":["MEL","Australia"]};
const regions=()=>Object.keys(REG).filter(k=>GOOGLE[k]&&HZD[REG[k][0]]);

/* ======================================================================
   The Strategist engine, as in the design: metrics with targets, levers,
   no-regret / trade-off / maladaptation classes, AI best fit over every
   combination, guards and an approval route. Numbers come from the atlas.
   ====================================================================== */
const CFG={};
CFG.op={
  ex:[["Example 1: Chennai campus, complete meter file",{site:"MAA",h:"2050",p:"mod",obj:"Balanced resilience",meter:"OP-S1",budget:16}],
      ["Example 2: Navi Mumbai campus, gaps in readings",{site:"BOM",h:"2050",p:"high",obj:"Lowest water stress",meter:"OP-S5",budget:10}]],
  filters:f=>[
    {id:"site",label:"Site",tip:"Built-in places and the team's sites from My workspace.",type:"select",html:placeOpts(f.site)},
    {id:"h",label:"Climate horizon",tip:"The data sources give today, 2030 and 2050 (no 2040).",opts:[["2030","2030"],["2050","2050"]]},
    {id:"p",label:"Emissions pathway",tip:"SSP2-4.5 middle path, SSP5-8.5 high emissions.",opts:[["mod","SSP2-4.5"],["high","SSP5-8.5"]]},
    {id:"obj",label:"Objective",tip:"What best fit favours once targets are met.",opts:[["Balanced resilience","Balanced resilience"],["Lowest water stress","Lowest water stress"],["Lowest energy","Lowest energy"]]},
    {id:"meter",label:"Meter readings",tip:"Hourly facility and IT kWh. Fictional samples are marked. Your file stays in your browser; only a one-line summary is shared.",opts:[["OP-S1","Sample 1 (complete)"],["OP-S5","Sample 2 (gaps)"]].concat(S.upload?[["upload","Your file"]]:[]).concat([["none","None"]])},
    {id:"budget",label:"Capex budget ($M)",tip:"Your budget; the capex target once lever costs are entered.",type:"number",min:0,max:500,step:0.5},
    {id:"mw",label:"IT capacity (MW)",tip:"Optional. Sets the size group when your meter summary is pooled.",type:"number",min:0,max:5000,step:1}],
  ctx(f){
    const h=hub(f.site),z=HZD[f.site],sc=scoresOf(z,f.h,f.p),j=jurOf(h),pr=pueRule(j),m=meterOf(f.meter);
    const L=[
      {id:"rdhx",name:"Rear-door liquid cooling for high-density halls",act:["liquid"],pue:A("op.rdhx.pue"),capex:A("op.rdhx.capex"),asm:["op.rdhx.pue","op.rdhx.capex"],tip:"Removes heat at the rack; hazard effects: heat −14, water −10."},
      {id:"dry",name:"Hybrid dry coolers + reclaimed water",act:["hybrid","recl"],pue:A("op.dry.pue"),wuePct:A("op.dry.wue_pct"),capex:A("op.dry.capex"),asm:["op.dry.pue","op.dry.wue_pct","op.dry.capex"],tip:"Ambient air most of the year and reclaimed water at peaks; hazard effects: heat −6, water −46 (floor 5)."},
      {id:"heat",name:"Heat reuse to a district network",act:["waste"],pue:A("op.heat.pue"),capex:A("op.heat.capex"),asm:["op.heat.pue","op.heat.capex"],tip:"Needs a nearby heat customer; hazard effect: heat −4."},
      {id:"setpt",name:"Raise supply-air setpoint to 27 °C",act:["inlet"],pue:A("op.setpt.pue"),capex:A("op.setpt.capex"),asm:["op.setpt.pue","op.setpt.capex"],tip:"Efficiency within ASHRAE limits; less thermal headroom in heatwaves."},
      {id:"batt",name:"On-site battery for grid stress hours",act:["batt"],capex:A("op.batt.capex"),asm:["op.batt.capex"],tip:"Rides through grid stress; hazard effect: grid −18."},
      {id:"barrier",name:"Flood barriers, drainage and water-level sensing",act:["barrier"],capex:A("op.barrier.capex"),asm:["op.barrier.capex"],tip:"Hazard effect: flood −18."},
      {id:"feed",name:"Second, independent grid feed",act:["feed"],capex:A("op.feed.capex"),asm:["op.feed.capex"],tip:"Hazard effect: grid −20."}];
    L.forEach(l=>{const fo=l.act.map(a=>libForce(a,sc)).find(Boolean);if(fo){l.force=fo;}});
    L.push(...libLevers("op",sc,["liquid","hybrid","recl","waste","inlet","batt","barrier","feed"]).map(l=>Object.assign(l,{capex:l.cost})));
    const metrics=[];
    if(m){metrics.push({id:"pue",label:"PUE",dec:2,dir:"lower",min:1.05,kind:"yours",kindT:"assume",src:m.label,target:pr?pr.pue:1.4,tsrc:pr?pr.name+" ("+(JNAME[j]||j)+")":"App default",g:"pue"});
      if(m.wue!=null){metrics.push({id:"wue",label:"WUE",unit:"L/kWh",dec:2,dir:"lower",crit:true,kind:"yours",src:m.label,target:1.2,tsrc:"Design target",g:"pue"});}}
    metrics.push({id:"res",label:"Resilience score",unit:"/100",dec:0,dir:"higher",crit:true,kind:"measured",src:"100 − overall climate risk, "+scenTxt(f.h,f.p),target:45,tsrc:"Overall risk below High (55)",g:"resilience"});
    if(sc[2]!=null){metrics.push({id:"water",label:"Water stress exposure",unit:"/100",dec:0,dir:"lower",crit:true,kind:"measured",src:"WRI Aqueduct at the site",target:55,tsrc:"Below High",g:"water"});}
    const capexAny=L.some(l=>l.capex!=null);
    if(capexAny){metrics.push({id:"capex",label:"Capex",unit:"$M",pre:"$",dec:1,dir:"lower",kind:"assume",src:"Costs entered in My workspace · Assumptions",target:+f.budget||0,tsrc:"Your budget",g:"assume"});}
    const calc=ids=>{const on=L.filter(l=>ids.includes(l.id)),after=applyAct(sc,[].concat(...on.map(l=>l.act))),v={};
      if(m){v.pue=Math.max(1.05,m.pue+on.reduce((t,l)=>t+(l.pue||0),0));if(m.wue!=null){v.wue=Math.max(0,m.wue*on.reduce((t,l)=>t*(1+(l.wuePct||0)/100),1));}}
      v.res=100-comp(after);if(sc[2]!=null){v.water=after[2];}if(capexAny){v.capex=on.reduce((t,l)=>t+(l.capex||0),0);}v._haz=after;return v;};
    const nodata=[];if(!m){nodata.push(["PUE","No meter file chosen."]);}else if(m.wue==null){nodata.push(["WUE","The meter file has no water_litres column."]);}if(sc[2]==null){nodata.push(["Water stress","No Aqueduct data here."]);}if(!capexAny){nodata.push(["Capex","No lever costs entered yet: add them in My workspace · Assumptions."]);}
    const gc=gcOf(f.site),x=z.extra||{};
    return {entity:h.n,hubId:f.site,jur:j,sc,levers:L,metrics,calc,cost:capexAny?"capex":null,nodata,
      fxKind:{pue:"assume",capex:"assume",res:"measured",water:"measured",wue:"assume"},
      blocked:m&&m.complete<90?`Data-quality gate: the meter file has ${m.ok} of ${m.hours} hours with both readings (${m.complete.toFixed(1)}%). At least 90% is needed before a plan can go forward.`:"",
      objective:{"Balanced resilience":"res","Lowest water stress":"water","Lowest energy":"pue"}[f.obj],
      facts:[["Grid carbon",gc?gc.g+" g CO₂/kWh ("+gc.year+")":"No data","measured"],["Sea level at nearest gauge",x.seaLevel?"+"+x.seaLevel[f.p==="mod"?"mod":"high"]["2050"].mid+" cm by 2050 ("+x.seaLevel.km+" km)":"No gauge within 30 km",x.seaLevel?"measured":"nodata"],["Data centres within 50 km",dcLabel(z),"measured"],["Meter file",m?m.label:"None","yours"]],
      insight:b=>`${h.n} ${m?`runs at PUE ${b.pue.toFixed(2)} over the meter file, ${b.pue<=(pr?pr.pue:1.4)?"inside":"above"} ${pr?pr.name:"the app default"} (≤ ${pr?pr.pue:1.4}). `:"has no meter file yet, so PUE is left out. "}By ${f.h} under ${f.p==="mod"?"SSP2-4.5":"SSP5-8.5"} the hazard mix puts resilience at ${b.res}/100${b.water!=null?` and water stress at ${b.water}`:""}. ${b.res<45||(b.water!=null&&b.water>55)?"Fix resilience and water first: they are the climate-critical gaps.":"Climate-critical metrics are on track; focus on efficiency."}`,
      approval:(v,on)=>{if(!on.length){return {chain:[],why:"No changes selected, so nothing needs approval; the run is logged."};}const cx=v.capex,two=cx!=null&&cx>5;
        return {chain:["Facility lead"].concat(two?["Capex committee"]:[]).concat(j==="JP"&&v.pue>1.4?["Energy manager"]:[]),why:(cx==null?"No lever costs are entered yet, so the $5M delegation limit can't be checked; the facility lead signs off.":"Capex of $"+cx.toFixed(1)+"M "+(two?"is above the $5M delegation limit, so it needs two-step approval.":"is within the facility lead's limit."))+(j==="JP"&&v.pue>1.4?" PUE stays above 1.4 in Japan, so the energy manager prepares a rationalisation plan.":"")};},
      hit:(v,on)=>[on.length>0&&v.capex!=null&&v.capex<=5,v.capex!=null&&v.capex>5,j==="JP"&&v.pue>1.4],
      just:"e.g. Lifts 2050 resilience above target and closes the PUE gap within budget"};
  }
};
CFG.colo={
  ex:[["Example 1: Kuala Lumpur for the next 100 MW",{cand:"KUL",users:"SIN",h:"2050",p:"high",blk:"100",obj:"Lowest climate risk"}],
      ["Example 2: Singapore, 200 MW, carbon first",{cand:"SIN",users:"SIN",h:"2050",p:"mod",blk:"200",obj:"Lowest carbon"}]],
  filters:f=>[
    {id:"cand",label:"Candidate site",tip:"Any built-in place, or one of the team's sites.",type:"select",html:placeOpts(f.cand)},
    {id:"users",label:"Main users near",tip:"For the latency estimate.",type:"select",html:hubOpts(f.users,apac())},
    {id:"h",label:"Horizon",tip:"2030 or 2050.",opts:[["2030","2030"],["2050","2050"]]},
    {id:"p",label:"Climate scenario",tip:"SSP2-4.5 or SSP5-8.5.",opts:[["mod","SSP2-4.5"],["high","SSP5-8.5"]]},
    {id:"blk",label:"Capacity block",tip:"200 MW or more also needs the board.",opts:[["50","50 MW"],["100","100 MW"],["200","200 MW"]]},
    {id:"obj",label:"Objective",tip:"What best fit favours once targets are met.",opts:[["Lowest climate risk","Lowest climate risk"],["Lowest carbon","Lowest carbon"],["Lowest water risk","Lowest water risk"],["Lowest latency","Lowest latency"]]}],
  ctx(f){
    const h=hub(f.cand),z=HZD[f.cand],sc=scoresOf(z,f.h,f.p),gc=gcOf(f.cand),u=HZD[f.users],k=key(f.h,f.p);
    const wraw=zz=>{const w=zz.water;return w&&w.kind!=="none"&&w.raw&&w.raw[k]!=null?w.raw[k]:null;};
    const alt=withData().filter(q=>q.c===h.c&&q.id!==f.cand).map(q=>({q,c:comp(scoresOf(HZD[q.id],f.h,f.p))})).filter(x=>x.c!=null).sort((a,b)=>a.c-b.c)[0];
    const evW=A("colo.evap.water_pts"),L=[
      {id:"relo",name:alt?"Move to "+alt.q.n+" (same market)":"Move to another site in the same market",tip:"Effect is the real difference to the lowest-risk other place in "+h.c+".",capex:A("colo.relo.capex"),asm:["colo.relo.capex"],dis:alt?"":"No other place in "+h.c+"."},
      {id:"liq",name:"Direct liquid cooling design",act:["liquid"],capex:A("colo.liq.capex"),asm:["colo.liq.capex"],tip:"Hazard effects: heat −14, water −10."},
      {id:"evap",name:"Evaporative cooling to save energy",act:evW!=null?["evap"]:[],capex:A("colo.evap.capex"),asm:["colo.evap.water_pts","colo.evap.capex"],tip:"Cheapest cooling, but draws heavily on local freshwater; its extra water hazard is entered in Assumptions.",dis:evW==null&&A("colo.evap.capex")==null?NOVAL:""},
      {id:"ppa",name:"24/7 carbon-free PPA portfolio",pct:pctOf("colo.ppa.carbon_pct"),capex:A("colo.ppa.capex"),asm:["colo.ppa.carbon_pct","colo.ppa.capex"],tip:"Market-based cut entered in Assumptions; location-based grid figures do not change.",dis:A("colo.ppa.carbon_pct")==null&&A("colo.ppa.capex")==null?NOVAL:""},
      {id:"bess",name:"Battery storage + demand response",act:["batt"],pct:pctOf("colo.bess.carbon_pct"),capex:A("colo.bess.capex"),asm:["colo.bess.carbon_pct","colo.bess.capex"],tip:"Hazard effect: grid −18; any carbon cut from shifting peaks is entered in Assumptions."}];
    L.forEach(l=>{const fo=(l.act||[]).map(a=>libForce(a,sc)).find(Boolean);if(fo){l.force=fo;}});
    L.push(...libLevers("colo",sc,["liquid","batt","ppa"]).map(l=>Object.assign(l,{capex:l.cost})));
    const base={carbon:gc?gc.g:null,water:wraw(z),risk:comp(sc),lat:latMs(u,z),capex:100};
    const metrics=[];
    if(base.carbon!=null){metrics.push({id:"carbon",label:"Grid carbon",unit:"g/kWh",dec:0,dir:"lower",kind:"measured",src:"Ember, "+h.c+" "+gc.year,target:250,tsrc:"Design target",g:"carbon"});}
    if(base.water!=null){metrics.push({id:"water",label:"Water risk",unit:"/5",dec:1,dir:"lower",min:0,crit:true,kind:"measured",src:"WRI Aqueduct, "+scenTxt(f.h,f.p),target:3,tsrc:"Design target",g:"water"});}
    metrics.push({id:"risk",label:"Overall climate risk",unit:"/100",dec:0,dir:"lower",crit:true,kind:"measured",src:"8 hazards, open data",target:55,tsrc:"Below High",g:"overall"});
    metrics.push({id:"lat",label:"Latency to users",unit:"ms",dec:0,dir:"lower",kind:"estimate",src:"Distance to "+hub(f.users).n,target:40,tsrc:"Design target",g:"latency"});
    const capexAny=L.some(l=>l.capex!=null);
    if(capexAny){metrics.push({id:"capex",label:"Capex index",dec:0,dir:"lower",kind:"assume",src:"Standard air-cooled design = 100; changes entered in Assumptions",target:115,tsrc:"Design target",g:"assume"});}
    const calc=ids=>{const on=L.filter(l=>ids.includes(l.id)),v={};let zz=z,s0=sc;
      if(ids.includes("relo")&&alt){zz=HZD[alt.q.id];s0=scoresOf(zz,f.h,f.p);}
      const after=applyAct(s0,[].concat(...on.map(l=>l.act||[])));
      const wr=wraw(zz);if(base.water!=null){v.water=wr==null?null:Math.max(0,Math.min(5,wr+((after[2]??0)-(s0[2]??0))/20));}
      v.risk=comp(after);v.lat=latMs(u,zz);if(capexAny){v.capex=100+on.reduce((t,l)=>t+(l.capex||0),0);}
      if(base.carbon!=null){v.carbon=base.carbon*on.reduce((t,l)=>t*(1+(l.pct||0)),1);}
      v._haz=after;v._at=zz===z?f.cand:alt.q.id;return v;};
    const x=z.extra||{};
    return {entity:h.n,hubId:f.cand,jur:jurOf(h),sc,levers:L,metrics,calc,cost:capexAny?"capex":null,
      fxKind:{carbon:"assume",water:"measured",risk:"measured",lat:"estimate",capex:"assume"},
      nodata:[["Design PUE by climate zone","No open benchmark data."]].concat(base.carbon==null?[["Grid carbon","No Ember data for "+h.c+"."]]:[]).concat(capexAny?[]:[["Capex index","No lever costs entered yet: add them in My workspace · Assumptions."]]),
      objective:{"Lowest climate risk":"risk","Lowest carbon":"carbon","Lowest water risk":"water","Lowest latency":"lat"}[f.obj],
      facts:[["Data centres within 50 km",dcLabel(z),"measured"],["Grid carbon ten years earlier",gc&&gc.past?gc.past.g+" g ("+gc.past.year+")":"No data",gc&&gc.past?"measured":"nodata"],["Sea level at nearest gauge",x.seaLevel?"+"+x.seaLevel[f.p==="mod"?"mod":"high"]["2050"].mid+" cm by 2050":"No gauge within 30 km",x.seaLevel?"measured":"nodata"],["Block",f.blk+" MW","yours"]],
      insight:b=>`A ${f.blk} MW block at ${h.n} sits on a grid averaging ${b.carbon!=null?Math.round(b.carbon)+" g CO₂/kWh":"(no data)"}, with water risk ${b.water!=null?b.water.toFixed(1)+"/5":"(no data)"} and overall climate risk ${b.risk} under ${scenTxt(f.h,f.p)}. ${b.water!=null&&b.water>=4?"This basin is water-stressed: do not buy efficiency with water here.":"Cooling design and clean power are the two decisions that matter most."}`,
      approval:()=>({chain:["Investment committee"].concat(+f.blk>=200?["Board"]:[]),why:"A "+f.blk+" MW build is a capital decision. "+(+f.blk>=200?"Builds of 200 MW or more also need the board.":"The investment committee approves builds under 200 MW.")}),
      hit:()=>[+f.blk<200,+f.blk>=200],
      just:"e.g. Keeps water risk under 3 and climate risk below High, with clean power above target"};
  }
};
CFG.ten={
  ex:[["Example 1: invoice LLM in Singapore",{wl:"Invoice LLM",region:"asia-southeast1",users:"SIN",kwh:0.45,res:"any",sla:120,rep:"Singapore",obj:"Lowest carbon"}],
      ["Example 2: Korean bank chatbot, data stays in Korea",{wl:"Customer chatbot",region:"asia-northeast3",users:"ICN",kwh:0.3,res:"in",sla:60,rep:"Korea",obj:"Lowest carbon"}]],
  filters:f=>[
    {id:"wl",label:"AI workload",tip:"A name for your workload.",type:"text"},
    {id:"region",label:"Runs today in",tip:"Google Cloud regions with published 2025 carbon data.",type:"select",html:regions().map(k=>`<option value="${k}"${k===f.region?" selected":""}>${esc(GOOGLE[k].loc)} (${k})</option>`).join("")},
    {id:"users",label:"Users are in",tip:"For the latency estimate.",type:"select",html:hubOpts(f.users,apac())},
    {id:"kwh",label:"kWh per 1,000 inferences",tip:"From your own usage data (example value shown).",type:"number",min:0.001,max:100,step:0.01},
    {id:"res",label:"Data residency",tip:"In-country blocks moves to other countries.",opts:[["any","Any APAC region"],["in","Must stay in country"]]},
    {id:"sla",label:"Latency SLA (ms)",tip:"p95 round trip the workload must meet.",type:"number",min:5,max:1000,step:1},
    {id:"rep",label:"We report under",tip:"Korea adds the AI compliance lead to approvals.",opts:[["Singapore","Singapore"],["Japan","Japan"],["Australia","Australia"],["Hong Kong","Hong Kong"],["Malaysia","Malaysia"],["Korea","Korea"]]},
    {id:"obj",label:"Objective",tip:"What best fit favours once targets are met.",opts:[["Lowest carbon","Lowest carbon"],["Lowest climate risk","Lowest climate risk"],["Lowest cost","Lowest cost"]]}],
  ctx(f){
    const cur=f.region,g0=GOOGLE[cur],hz0=REG[cur][0],u=HZD[f.users],kwh=Math.max(0.001,+f.kwh||0.001);
    const at=k=>{const z=HZD[REG[k][0]],sc=scoresOf(z,"2050","mod");return {k,g:GOOGLE[k].g,heat:sc[0],risk:comp(sc),lat:latMs(u,z),cty:REG[k][1],sc};};
    const ok=k=>{const a=at(k);return (f.res!=="in"||a.cty===REG[cur][1])&&a.lat<=+f.sla;};
    const best=regions().filter(k=>k!==cur&&ok(k)).sort((a,b)=>GOOGLE[a].g-GOOGLE[b].g)[0];
    const jak="asia-southeast2";
    const L=[
      {id:"move",name:best?"Move to "+GOOGLE[best].loc+" ("+best+")":"Move to a lower-carbon region",to:best,tip:"Lowest-carbon region that meets residency and SLA, from Google's region data and the hazard data.",dis:best?"":f.res==="in"?"Blocked by data residency: no other allowed region in "+REG[cur][1]+" meets the SLA.":"No other region meets the "+f.sla+" ms SLA."},
      {id:"small",name:"Switch to a quantised, smaller model",pct:pctOf("ten.small.carbon_pct"),dlat:A("ten.small.lat_ms"),cost:A("ten.small.cost"),asm:["ten.small.carbon_pct","ten.small.lat_ms","ten.small.cost"],tip:"Energy, latency and cost changes are entered in Assumptions; check accuracy on a test set first.",dis:missing(["ten.small.carbon_pct","ten.small.lat_ms","ten.small.cost"]).length===3?NOVAL:""},
      {id:"batch",name:"Batch non-urgent jobs into low-carbon hours",dis:"Needs hourly grid carbon: set an Electricity Maps key to enable it.",tip:"Carbon-aware scheduling."},
      {id:"green",name:"Buy the provider's renewable option",pct:pctOf("ten.green.carbon_pct"),cost:A("ten.green.cost"),asm:["ten.green.carbon_pct","ten.green.cost"],tip:"Market-based cut entered in Assumptions; auditors still see location-based figures.",dis:missing(["ten.green.carbon_pct","ten.green.cost"]).length===2?NOVAL:""},
      {id:"cheap",name:"Move to Jakarta (asia-southeast2) to save cost",to:jak,cost:A("ten.cheap.cost"),asm:["ten.cheap.cost"],tip:"The cost change is entered in Assumptions; carbon, heat and latency are computed.",dis:cur===jak?"Already runs in Jakarta.":f.res==="in"&&REG[cur][1]!=="Indonesia"?"Blocked by data residency.":""}];
    L.push(...libLevers("ten",at(cur).sc,["ppa"]));
    const metrics=[
      {id:"carbon",label:"Carbon / 1k inferences",unit:"g",dec:1,dir:"lower",kind:"yours",src:"Your kWh × "+g0.loc+" grid ("+g0.g+" g/kWh, Google 2025)",target:Math.round(kwh*g0.g*0.7*10)/10,tsrc:"30% below today",g:"compound"},
      {id:"heat",label:"Host heat risk 2050",unit:"/100",dec:0,dir:"lower",crit:true,kind:"measured",src:"Heat score at the region's place",target:55,tsrc:"Below High",g:"heat"},
      {id:"risk",label:"Host overall climate risk",unit:"/100",dec:0,dir:"lower",kind:"measured",src:"8 hazards, open data",target:55,tsrc:"Below High",g:"overall"},
      {id:"lat",label:"p95 latency",unit:"ms",dec:0,dir:"lower",kind:"estimate",src:"Distance estimate",target:+f.sla,tsrc:"Your SLA",g:"latency"}];
    const costAny=L.some(l=>l.cost!=null);
    if(costAny){metrics.push({id:"cost",label:"Cost index",dec:0,dir:"lower",kind:"assume",src:"Today = 100; changes entered in Assumptions",target:105,tsrc:"Design target",g:"assume"});}
    const calc=ids=>{const on=L.filter(l=>ids.includes(l.id)),mv=on.filter(l=>l.to).slice(-1)[0],a=at(mv?mv.to:cur),v={};
      const af=applyAct(a.sc,[].concat(...on.map(l=>l.act||[])));v.carbon=kwh*a.g*on.reduce((t,l)=>t*(1+(l.pct||0)),1);v.heat=af[0];v.risk=comp(af);v.lat=Math.max(5,a.lat+on.reduce((t,l)=>t+(l.dlat||0),0));if(costAny){v.cost=100+on.reduce((t,l)=>t+(l.cost||0),0);}v._at=REG[a.k][0];v._haz=af;return v;};
    const L2=L.map(l=>l.id==="cheap"&&!l.dis?Object.assign(l,{}):l);
    return {entity:f.wl+" in "+g0.loc,hubId:hz0,jur:JUR[REG[cur][1]]||"",sc:at(cur).sc,levers:L2,metrics,calc,cost:costAny?"cost":null,
      fxKind:{carbon:"assume",heat:"measured",risk:"measured",lat:"estimate",cost:"assume"},
      nodata:[["Water per 1,000 inferences","Cloud providers publish no per-region water use."]].concat(costAny?[]:[["Cost index","No cost changes entered yet: add them in My workspace · Assumptions."]]),
      objective:{"Lowest carbon":"carbon","Lowest climate risk":"risk","Lowest cost":"cost"}[f.obj],
      facts:[["Region CFE",nf(g0.cfe*100)+"% (Google 2025)","measured"],["Monthly volume","kWh per 1,000 inferences: "+kwh,"yours"],["Residency",f.res==="in"?"Must stay in "+REG[cur][1]:"Any APAC region","yours"],["Reporting",f.rep,"yours"]],
      insight:b=>`${esc(f.wl)} runs in ${g0.loc} at ${b.carbon.toFixed(1)} g CO₂ per 1,000 inferences (location-based), p95 latency about ${b.lat} ms against a ${f.sla} ms SLA. Host heat risk is ${b.heat}/100 by 2050. Your target asks for 30% less carbon.${f.res==="in"?" Data residency is in-country, so moves abroad are off the table.":""}`,
      approval:(v,on)=>!on.length?{chain:[],why:"No change to the placement, so nothing needs approval; the run is logged."}:{chain:["Workload owner"].concat(v.cost>100?["FinOps"]:[]).concat(f.rep==="Korea"?["AI compliance lead"]:[]),why:"Placement changes need the workload owner."+(v.cost>100?" Cost rises above today, so FinOps also approves.":"")+(f.rep==="Korea"?" Korea's AI Basic Act: AI output labelling must be confirmed.":"")},
      hit:(v,on)=>[on.length>0,v.cost>100,f.rep==="Korea"],
      just:"e.g. Cuts carbon per inference by a third within SLA and residency rules"};
  }
};
CFG.pol={
  ex:[["Example 1: Jakarta, +50 MW a year for 20 years",{hub:"CGK",mw:50,yrs:"20",obj:"Cut emissions"}],
      ["Example 2: Kuala Lumpur, +100 MW a year for 10 years",{hub:"KUL",mw:100,yrs:"10",obj:"Cut water"}]],
  filters:f=>[
    {id:"hub",label:"Place",tip:"National grid and demand from Ember; water stress at this place.",type:"select",html:hubOpts(f.hub,apac())},
    {id:"mw",label:"New IT MW a year",tip:"Your growth assumption.",type:"number",min:1,max:5000,step:1},
    {id:"yrs",label:"Planning horizon",tip:"Years of steady growth.",opts:[["10","+10 years"],["20","+20 years"],["50","+50 years"]]},
    {id:"obj",label:"Objective",tip:"What best fit favours once targets are met.",opts:[["Cut emissions","Cut emissions"],["Cut water","Cut water"],["Cut electricity","Cut electricity"]]}],
  ctx(f){
    const h=hub(f.hub),z=HZD[f.hub],x=z.extra||{},gc=x.gridCarbon,el=x.electricity,yrs=+f.yrs,it=(+f.mw||0)*yrs,stress=w=>{const e=entry(HZD[w],"water");return e&&e.kind!=="none"&&e.raw?e.raw[yrs<=10?"m30":"m50"]:null;},st0=stress(f.hub);
    const alt=withData().filter(q=>q.c===h.c&&q.id!==f.hub&&stress(q.id)!=null&&st0!=null&&stress(q.id)<st0).sort((a,b)=>stress(a.id)-stress(b.id))[0];
    const L=[
      {id:"pue",name:"Efficiency standard: PUE ≤ 1.3 for new data centres",el:1.3/1.5,tip:"Electricity and emissions × 1.3 ÷ 1.5 (from a typical 1.5, assumption)."},
      {id:"clean",name:"Clean-power requirement: 50% of new load",em:0.5,tip:"Halves the emissions of the new load when it is met with additional clean generation."},
      {id:"dry",name:"Water-free cooling for new builds (WUE 1.8 → 0.2)",wa:0.2/1.8,el:1+(A("pol.dry.elec_pct")||0)/100,asm:["pol.dry.elec_pct"],tip:"Cuts cooling water by 89%; any extra electricity it uses is entered in Assumptions."},
      {id:"steer",name:alt?"Steer new builds to "+alt.n+" (lower water stress)":"Steer new builds to a less water-stressed place",wa:alt?stress(alt.id)/st0:1,dis:alt?"":"No other place in "+h.c+" with lower water stress.",tip:"Water stress ratio from Aqueduct; same national grid."}];
    const hz2=yrs<=10?"2030":"2050";L.push(...libLevers("pol",scoresOf(z,hz2,"mod"),[]));
    const gwh0=it*0.7*8760*1.5/1000;
    const metrics=[];
    if(gc){metrics.push({id:"emis",label:"Sector emissions",unit:"%",signed:true,dec:0,dir:"lower",kind:"measured",src:"Electricity × Ember "+gc.g+" g/kWh",target:-20,tsrc:"vs no new policy",g:"carbon"});}
    if(st0!=null){metrics.push({id:"water",label:"Water drawn in stressed basins",unit:"%",signed:true,dec:0,dir:"lower",crit:true,kind:"measured",src:"Cooling water × Aqueduct stress "+st0.toFixed(2)+"/5",target:-15,tsrc:"vs no new policy",g:"water"});}
    metrics.push({id:"risk",label:"Climate risk at growth sites",unit:"/100",dec:0,dir:"lower",crit:true,kind:"measured",src:"Overall climate risk at the place, "+hz2+" SSP2-4.5",target:55,tsrc:"Below High",g:"overall"});
    metrics.push({id:"elec",label:"Electricity for data centres",unit:"%",signed:true,dec:0,dir:"lower",kind:"measured",src:nf(gwh0)+" GWh/yr by year "+yrs+" with no new policy",target:-10,tsrc:"Policy target (assumption)",g:"whatif"});
    const calc=ids=>{const on=L.filter(l=>ids.includes(l.id)),e=on.reduce((t,l)=>t*(l.el||1),1),em=on.reduce((t,l)=>t*(l.em||1),1),w=on.reduce((t,l)=>t*(l.wa||1),1),v={};
      if(gc){v.emis=Math.round((e*em-1)*100);}if(st0!=null){v.water=Math.round((w-1)*100);}v.elec=Math.round((e-1)*100);const at=on.some(l=>l.id==="steer")&&alt?alt.id:f.hub,af=applyAct(scoresOf(HZD[at],hz2,"mod"),[].concat(...on.map(l=>l.act||[])));v.risk=comp(af);v._haz=af;return v;};
    const share=el&&el.demandTWh?gwh0/(el.demandTWh*1000)*100:null,g=entry(z,"grid")||{},gr=g.raw||{};
    return {entity:h.n+", "+h.c,hubId:f.hub,jur:jurOf(h),sc:scoresOf(z,"2050","mod"),levers:L,metrics,calc,cost:null,
      fxKind:{emis:"assume",water:"assume",elec:"assume",risk:"measured"},
      nodata:[["Grid shortfall (MW)",gr.state?"No open grid-headroom data; Grid-India shows "+gr.state+" energy not supplied: "+nf(gr.ensPct,3)+"%.":"No open grid-headroom data for "+h.c+"."],["Investment change","No source."]],
      objective:{"Cut emissions":"emis","Cut water":"water","Cut electricity":"elec"}[f.obj],
      facts:[["New IT load by year "+yrs,nf(it)+" MW","yours"],["Electricity, no new policy",nf(gwh0)+" GWh/yr","measured"],["Share of national demand",share!=null?nf(share,2)+"% of "+el.year+" demand":"No data",share!=null?"measured":"nodata"],["Grid carbon trend",gc&&gc.past?gc.past.g+" → "+gc.g+" g ("+gc.past.year+"–"+gc.year+")":"No data",gc?"measured":"nodata"]],
      insight:()=>`With +${f.mw} MW a year, data centres in ${h.c} would draw about ${nf(gwh0)} GWh a year by year ${yrs}${share!=null?" ("+nf(share,2)+"% of today's national demand)":""}, on a grid at ${gc?gc.g+" g CO₂/kWh":"(no data)"}${st0!=null?", cooling with water where stress is "+st0.toFixed(2)+" of 5":""}. Efficiency and siting levers usually move fastest; caps protect water but no source models their effect on investment.`,
      approval:()=>({chain:["Policy director","Minister"],why:"Publishing a policy recommendation needs official sign-off. Pooled figures are checked for k ≥ 5 first."}),
      hit:()=>[true],
      just:"e.g. Cuts sector emissions and stressed-basin water draw without capping growth"};
  }
};

function runOf(p){const R=S.runs[p]||(S.runs[p]={});if(!R.f){R.f=Object.assign({},CFG[p].ex[0][1]);}["site","cand","users","hub"].forEach(k=>{if(R.f[k]&&!(hub(R.f[k])&&HZD[R.f[k]])){R.f[k]=CFG[p].ex[0][1][k];}});if(!R.on){R.on={};}if(R.step==null){R.step=0;}if(!R.choice){R.choice="mine";}return R;}
function engine0(p){
  const R=runOf(p),cfg=CFG[p],ctx=cfg.ctx(R.f),M=ctx.metrics,L=ctx.levers,avail=L.filter(l=>!l.dis);
  const base=ctx.calc([]),ids=set=>avail.filter(l=>set[l.id]).map(l=>l.id),calc=set=>ctx.calc(ids(set));
  M.forEach(m=>{if(m.min!=null){base[m.id]=Math.max(m.min,base[m.id]);}});
  const pass=(m,x)=>x==null?false:m.dir==="lower"?x<=m.target+1e-9:x>=m.target-1e-9;
  const met=v=>M.filter(m=>pass(m,v[m.id])).length;
  const delta=l=>{const v=ctx.calc([l.id]);return M.map(m=>({m,d:v[m.id]==null||base[m.id]==null?0:v[m.id]-base[m.id]}));};
  const worsens=l=>delta(l).filter(x=>Math.abs(x.d)>1e-9&&(x.m.dir==="lower"?x.d>0:x.d<0)&&x.m.id!==ctx.cost).map(x=>x.m);
  const kc={},klass=l=>kc[l.id]||(kc[l.id]=l.force?l.force[0]:(w=>w.some(m=>m.crit)?"mal":w.length?"trade":"nore")(worsens(l)));
  const objM=M.find(m=>m.id===ctx.objective),costM=M.find(m=>m.id===ctx.cost);
  const scoreOf=set=>{const v=calc(set);const imp=objM?((objM.dir==="lower"?base[objM.id]-v[objM.id]:v[objM.id]-base[objM.id])/Math.max(Math.abs(base[objM.id]),Math.abs(objM.target),1e-6))*100:0;
    const cost=costM?(v[costM.id]-base[costM.id])/Math.max(Math.abs(costM.target),1)*100:Object.keys(set).length*5;
    return met(v)*1000+imp*3-cost-avail.filter(l=>set[l.id]&&klass(l)==="mal").length*5000;};
  const cand=avail.length>12?avail.map(l=>({l,g:scoreOf({[l.id]:true})})).sort((a,b)=>b.g-a.g).slice(0,12).map(x=>x.l):avail;
  let best={},bs=-Infinity;for(let mask=0;mask<(1<<cand.length);mask++){const set={};cand.forEach((l,i)=>{if(mask&(1<<i)){set[l.id]=true;}});const s=scoreOf(set);if(s>bs){bs=s;best=set;}}
  const mine=calc(R.on),bestV=calc(best),names=set=>{const a=avail.filter(l=>set[l.id]).map(l=>l.name);return a.length?a.join(" · "):"No changes";};
  const fmt=(m,x)=>x==null?"–":(m.signed&&x>0?"+":"")+(m.pre||"")+(x<0?"−"+nf(Math.abs(x),m.dec):nf(x,m.dec))+(m.unit&&m.unit!=="$M"?(m.unit.startsWith("/")||m.unit==="%"?"":" ")+m.unit:m.unit==="$M"?"M":"");
  const final=R.choice==="best"?best:R.on,finalV=calc(final),finalOn=avail.filter(l=>final[l.id]);
  return {p,R,cfg,ctx,M,L,avail,cand,base,mine,best,bestV,calc,pass,met,delta,worsens,klass,names,fmt,final,finalV,finalOn,ap:ctx.approval(finalV,finalOn),hit:ctx.hit?ctx.hit(finalV,finalOn):[]};
}
const EC={};
function engine(p){const R=runOf(p),k=JSON.stringify([R.f,R.on,R.choice,S.upload&&S.upload.label,ASV,SITEHUBS.length]);if(EC[p]&&EC[p].k===k){return EC[p].E;}const E=engine0(p);EC[p]={k,E};return E;}
function profileOf(E,set){const a=E.avail.filter(l=>set[l.id]);if(!a.length){return "no change";}const c={nore:0,trade:0,mal:0};a.forEach(l=>c[E.klass(l)]++);return [c.nore?c.nore+" no-regret":"",c.trade?c.trade+" trade-off":"",c.mal?c.mal+" maladaptation risk":""].filter(Boolean).join(" · ");}
const evidence=E=>EVID[E.p].concat(E.finalOn.some(l=>E.klass(l)==="mal")?["Maladaptation flag and mitigation note"]:[]);

/* ================= shared drawing ================= */
function petals(sc,after,R,labels){
  const N=HZ.length,P=[];
  if(labels){for(let r=1;r<=4;r++){P.push(`<circle r="${R*r/4}" fill="none" stroke="#E2E7E2"/>`);}}
  HZ.forEach((hz,i)=>{const a=(-90+i*360/N)*Math.PI/180;if(labels){P.push(`<line x1="0" y1="0" x2="${(Math.cos(a)*R).toFixed(1)}" y2="${(Math.sin(a)*R).toFixed(1)}" stroke="#E2E7E2"/>`);
    P.push(`<text x="${(Math.cos(a)*(R+12)).toFixed(1)}" y="${(Math.sin(a)*(R+12)).toFixed(1)}" font-size="11" fill="#4A5A52" text-anchor="${Math.abs(Math.cos(a))<.2?"middle":Math.cos(a)>0?"start":"end"}" dominant-baseline="middle">${esc(hz[1].split(" ")[0])}</text>`);}});
  const pet=(i,v,fill,stroke,dash,op,sw)=>{if(v==null){return "";}const a=(-90+i*360/N)*Math.PI/180,w=Math.PI/N*.78,r=Math.max(R*.05,v/100*R),p1=[Math.cos(a-w)*r*.55,Math.sin(a-w)*r*.55],p2=[Math.cos(a)*r,Math.sin(a)*r],p3=[Math.cos(a+w)*r*.55,Math.sin(a+w)*r*.55];
    return `<path d="M0 0 Q${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} Q${p3[0].toFixed(1)} ${p3[1].toFixed(1)} 0 0Z" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="${sw}"${dash?' stroke-dasharray="3 3"':""}/>`;};
  const sw=labels?1.6:Math.max(.4,R/40);
  if(after){HZ.forEach((hz,i)=>P.push(pet(i,sc[i],"none","#5B6B63",true,0,sw)));}
  HZ.forEach((hz,i)=>{const c=cssv(hz[2]);P.push(pet(i,after?after[i]:sc[i],c,c,false,.6,sw));});
  return P.join("");
}
const petalSvg=(sc,after,label)=>`<svg viewBox="-175 -140 350 280" role="img" aria-label="${esc(label)}">${petals(sc,after,100,true)}</svg>`;
const petLegend=()=>`<div class="legend"><span><svg width="18" height="10" aria-hidden="true"><path d="M1 5h16" stroke="#5B6B63" stroke-dasharray="3 3" stroke-width="1.6"/></svg>Before</span><span><svg width="18" height="10" aria-hidden="true"><rect width="18" height="10" rx="2" fill="#2A6CB8" fill-opacity=".6"/></svg>After the plan</span></div>`;
function hazAfter(p){if(p!=="op"&&p!=="colo"){return null;}const E=engine(p);return {hub:E.ctx.hubId,before:E.ctx.sc,after:E.finalV._at&&E.finalV._at!==E.ctx.hubId?null:E.finalV._haz};}
function lineage(z){const used={};HZK.forEach(k=>{const e=entry(z,k);(e&&e.src||[]).forEach(s=>{used[s]=1;});});["gridCarbon","seaLevel","facilities","electricity"].forEach(k=>{const x=(z.extra||{})[k];if(x&&x.src){used[x.src]=1;}});return (D.sources||[]).filter(s=>used[s.id]);}

/* ================= audit chain + approvals ================= */
async function sha(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");}
const who=()=>(S.approver||"").trim()||"Unnamed";
const GOV={requests:[],audit:[],verify:null,loading:false,at:0};
async function loadGov(){GOV.loading=true;try{const [a,b]=await Promise.all([fetch("/api/requests").then(r=>r.json()),fetch("/api/audit").then(r=>r.json())]);GOV.requests=a.requests||[];GOV.audit=b.entries||[];GOV.verify=b.verify||null;}catch(e){}GOV.at=Date.now();GOV.loading=false;}
async function post(url,body,method){const r=await fetch(url,{method:method||"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});const j=await r.json().catch(()=>({}));if(!r.ok){throw new Error(j.error||"The request failed.");}return j;}
function confirmBox(title,body,okText,onOk){let m=$("modal");if(!m){m=document.createElement("div");m.id="modal";m.className="modal";document.body.appendChild(m);}
  m.innerHTML=`<div class="mbox" role="dialog" aria-modal="true" aria-labelledby="m-t"><h2 id="m-t">${esc(title)}</h2><p class="sub">${esc(body)}</p><div class="ctas"><button class="btn danger" type="button" id="m-ok">${esc(okText)}</button><button class="btn alt" type="button" id="m-no">Cancel</button></div></div>`;
  m.hidden=false;const close=()=>{m.hidden=true;document.removeEventListener("keydown",onKey);},onKey=e=>{if(e.key==="Escape"){close();}};document.addEventListener("keydown",onKey);
  $("m-no").onclick=close;m.onclick=e=>{if(e.target===m){close();}};$("m-ok").onclick=()=>{close();onOk();};$("m-no").focus();}

/* ================= pages ================= */
const PAGES={};
const phead=(eyebrow,title,sub,controls,lead)=>`<div class="phead${lead?" lead":""}"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${sub?`<p class="sub">${sub}</p>`:""}</div>${controls?`<div class="controls">${controls}</div>`:""}</div>`;
const pTag=p=>`<span class="pchip"><span class="pdot p-${p}"></span>${esc(PERS[p].name)}</span>`;

/* ---------- Home: Ask + workspaces ---------- */
PAGES.home=()=>{
  const top=apac().map(h=>{const sc=scoresOf(HZD[h.id],"2050","high");return {h,c:comp(sc),w:worstIdx(sc),sc};}).sort((a,b)=>b.c-a.c).slice(0,5);
  return `<div class="wrap"><section class="hero"><div>
    <span class="eyebrow">Decision intelligence for AI infrastructure under climate stress</span>
    <h1>Every AI workload placed, run and reported responsibly; every site ready for the climate of 2050.</h1>
    <p class="lede">One app, four workspaces, tuned to JAPAC rules and built on ${SRCS.length+2} open data sources. Pick who you are, ask a question or start the guided flow. Every number shows whether it is measured, yours, an estimate or an assumption.</p>
    <div class="ask"><input id="askq" aria-label="Ask a question" placeholder="Ask in your own words, or pick an example"><button class="btn" type="button" id="askgo">Ask Gemini</button></div>
    <div class="exs" id="exs"><button type="button">We run a campus in Chennai. What should we fix first for 2050?</button><button type="button">Where in Southeast Asia should we build our next 100 MW block?</button><button type="button">What would 50 MW a year of data centres mean for Malaysia's grid and water?</button></div>
    <div class="askres" id="askres" aria-live="polite"></div>
    <div class="ctas"><a class="btn" href="#/work/guided">Start guided flow →</a><a class="btn alt" href="#/impact">Impact</a><a class="btn dark" href="#/earth">Earth view</a></div>
  </div><div class="stats"><div class="stat"><b>${withData().length}</b><span>JAPAC places scored on 8 hazards</span></div><div class="stat"><b>${SRCS.length+2}</b><span>open data sources, all listed</span></div><div class="stat"><b>4</b><span>personas, each with its own sections</span></div><div class="stat"><b>${RULES.filter(r=>r.src).length}</b><span>JAPAC rules with sources, plus ${RULES.filter(r=>r.st==="App default").length} internal targets</span></div></div></section>
  <section class="section"><h2>Choose your workspace ${info("persona")}</h2><p class="sub">No login. Your choice changes the menu and is remembered in this browser.</p><div class="pcards" style="margin-top:12px">${PK.map((p,i)=>`<button type="button" class="pcard2" data-pick="${p}" aria-pressed="${p===PERSONA}"><div style="display:flex;justify-content:space-between;align-items:center"><span class="src" style="font-family:var(--mono)">0${i+1}</span><span class="chip">${PERS[p].scope}</span></div><h3>${PERS[p].name}</h3><span class="src">${esc(PERS[p].job)}</span><div class="mvp"><b>${PERS[p].dash}</b><br><span class="src">My workspace: ${WTABS[p].map(t=>t[1]).join(" · ")}</span></div><span class="go">${p===PERSONA?"Current workspace ✓":"Switch to this workspace →"}</span></button>`).join("")}</div></section>
  <section class="section"><h2>Shared across every workspace</h2><div class="layers">
    <a class="layer" href="#/work/guided"><span class="tag">GOVERN</span><b>Explain · approve · log</b><span>Each recommendation shows its drivers and sources, needs a named approver and lands in a tamper-evident audit trail.</span><span class="open">Guided flow, step 5 →</span></a>
    <a class="layer" href="#/glossary/sources"><span class="tag">TRUST</span><b>Data lineage</b><span>Every number is Measured, Your data, Estimate, Assumption or No data, with its source.</span><span class="open">Glossary →</span></a>
    <a class="layer" href="#/glossary/terms"><span class="tag">ISOLATE</span><b>Persona-scoped sections</b><span>Each persona sees its own tools. Policy makers see pooled data only (k ≥ 5).</span><span class="open">Glossary →</span></a>
    <a class="layer" href="#/earth"><span class="tag">ADAPT</span><b>Scenario engine</b><span>Today, 2030 and 2050 under SSP2-4.5 and SSP5-8.5, from the open data sources.</span><span class="open">Earth view →</span></a></div></section>
  <section class="section card"><h2>AI system register: this app's own models</h2><p class="sub">Real models in use. Evaluation results will appear here once evaluations are run; none are shown until then.</p><div class="tblwrap"><table class="t"><thead><tr><th>AI system</th><th>Purpose</th><th>Human oversight</th><th>Last evaluation</th></tr></thead><tbody>
    <tr><td><b>Gemini (flash), then Groq gpt-oss-120b</b></td><td class="src">Reads questions on Home, writes briefs</td><td class="src">Answers only set inputs; every plan still needs a human approver</td><td><span class="chip grey">Not yet evaluated</span></td></tr>
    <tr><td><b>Rule engine</b></td><td class="src">Fallback reader when no AI is available</td><td class="src">Deterministic</td><td><span class="chip grey">Not applicable</span></td></tr>
    <tr><td><b>Best-fit optimiser</b></td><td class="src">Tries every lever combination</td><td class="src">User chooses the option; approver signs off</td><td><span class="chip grey">Not applicable</span></td></tr></tbody></table></div></section>
  <section class="section card"><h2>Highest climate risk in Asia-Pacific, 2050 ${info("overall")}</h2><div class="tblwrap"><table class="t"><thead><tr><th>Place</th><th>2050 (SSP5-8.5)</th><th>Band</th><th>Biggest hazard</th></tr></thead><tbody>${top.map(r=>`<tr><td><b>${esc(r.h.n)}</b> <span class="src">${esc(r.h.c)}</span></td><td>${pill(r.c)}</td><td>${band(r.c)}</td><td>${esc(HZ[r.w][1])} ${r.sc[r.w]}</td></tr>`).join("")}</tbody></table></div></section></div>`;
};
PAGES.home.after=()=>{
  $("view").querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>{setPersona(b.dataset.pick);renderNav();route();toast("Workspace: "+PERS[PERSONA].name);});
  const AUD={op:"op",colo:"colo",hyp:"colo",ten:"ten",pol:"pol"};
  const curPlace=workPlace;
  const go=async t=>{t=(t||"").trim();if(!t){return;}const T0=Date.now();const out=$("askres");$("askq").value=t;out.innerHTML='<p class="src"><span class="spin"></span>Gemini is reading your question…</p>';
    try{const r=await fetch("/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:t,hubs:withData().map(h=>({id:h.id,n:h.n,c:h.c,r:h.r})),current:{aud:PERSONA,prio:"bal",layer:"comp",h:"2050",p:"high",region:"Asia-Pacific",site:curPlace(),pins:[],tab:"hub"}})});
      const j=await r.json();if(!r.ok){throw new Error(j.error||"The request failed.");}
      const lt=t.toLowerCase(),kw=/\b(policy|regulat|government|ministry|what would .* mean for|grid and water|impact on)\b/.test(lt)?"pol":/\b(workload|cloud region|inferences?|llm|model|tenant|which region)\b/.test(lt)?"ten":/\b(where .*build|build our next|next \d+ ?mw|expand|expanding|colocation|hyperscale|new site|siting)\b/.test(lt)?"colo":/\b(we run|our (campus|site|facility|data cent(re|er))|we operate|fix first|retrofit)\b/.test(lt)?"op":"";
      /* Stay in the persona the user picked; the persona the question reads like is only offered (review of 17 Oct 2026). */
      let fit=kw||AUD[j.aud]||PERSONA;if(!kw&&j.intent==="impact"){fit="pol";}else if(!kw&&j.intent==="site"&&fit==="op"){fit="colo";}
      const p=PERSONA,hh=j.h==="2030"?"2030":"2050",pp=j.p==="mod"?"mod":"high";
      /* Place: the lowest-risk of the places matching the question; else the one it named; else the persona's current place. */
      const risk=id=>{const c=comp(scoresOf(HZD[id],hh,pp));return c==null?999:c;};
      const ranked=(j.candidates||[]).filter(id=>HZD[id]&&inView(id)).sort((a,b)=>risk(a)-risk(b));
      const site=ranked[0]||(HZD[j.site]&&inView(j.site)?j.site:curPlace());
      const placeTxt=esc(hub(site).n)+(ranked.length>1?" · lowest risk of "+ranked.length+" matches":"");
      if(window.STA){STA.event("ask_question",{answered_by:j.source||"",persona:p,suggested:fit,seconds:Math.round((Date.now()-T0)/100)/10});}
      out.innerHTML=`<div class="note">${esc(j.reply||"")} <span class="src">· ${esc({gemini:"Gemini",groq:"Groq",rules:"Rule engine"}[j.source]||j.source)}</span><div class="exs">${pTag(p)}<span class="chip">Place: ${placeTxt}</span><span class="chip">${hh}, ${pp==="mod"?"SSP2-4.5":"SSP5-8.5"}</span></div><div class="ctas"><button class="btn" type="button" id="askflow">Open the ${esc(PERS[p].name)} guided flow →</button>${fit!==p?`<button class="btn alt sm" type="button" id="askalt">Reads like a ${esc(PERS[fit].name)} question: open it there</button>`:""}</div></div>`;
      const openAs=q=>{const R=runOf(q),own=!hub(site).site;
        if(q==="op"){Object.assign(R.f,{site,h:hh,p:pp});}if(q==="colo"){Object.assign(R.f,{cand:site,h:hh,p:pp,blk:j.dcMw>=200?"200":j.dcMw>=100||!j.dcMw?"100":"50"});}
        if(q==="ten"&&own){Object.assign(R.f,{users:site});}if(q==="pol"&&own){Object.assign(R.f,{hub:site,mw:j.dcMw||R.f.mw});}
        R.on={};R.step=1;R.choice="mine";R.submitted=null;save();if(q!==PERSONA){setPersona(q);renderNav();}location.hash="#/work/guided";};
      $("askflow").onclick=()=>openAs(p);const al=$("askalt");if(al){al.onclick=()=>openAs(fit);}
    }catch(e){out.innerHTML=`<div class="note bad">${esc(e.message)}</div>`;}};
  $("askgo").onclick=()=>go($("askq").value);$("askq").onkeydown=e=>{if(e.key==="Enter"){go($("askq").value);}};
  $("exs").onclick=e=>{const b=e.target.closest("button");if(b){go(b.textContent);}};
};

/* ---------- Guided flow (Strategist engine) ---------- */
const STEPS=["Persona","Inputs","Baseline","Adjust","Best fit","Approval"];
const kindCell=m=>`${kindB(m.kind)} <span class="src">${esc(m.src)}</span>`;
function metricRows(E,v,show){return E.M.map(m=>`<tr><td><b>${esc(m.label)}</b>${m.crit?' <span class="chip bad">climate-critical</span>':""} ${info(m.g)}</td><td class="num">${E.fmt(m,E.base[m.id])}</td>${show?`<td class="num">${E.fmt(m,v[m.id])}</td>`:""}<td class="num">${m.dir==="lower"?"≤":"≥"} ${E.fmt(m,m.target)} <div class="src">${esc(m.tsrc)}</div></td><td>${E.pass(m,(show?v:E.base)[m.id])?'<span class="pass">Meets</span>':'<span class="fail">Misses</span>'}</td><td>${kindCell(m)}</td></tr>`).join("");}
function tracks(E){
  const sets=[E.base,E.mine,E.bestV].concat(E.avail.map(l=>E.calc({[l.id]:true})));
  return `<div class="tracks">${E.M.map(m=>{const xs=sets.map(v=>v[m.id]).filter(x=>x!=null).concat([m.target]);let lo=Math.min(...xs),hi=Math.max(...xs);const pad=(hi-lo)*.12||Math.max(Math.abs(hi)*.1,.5);lo-=pad;hi+=pad;
    const pos=x=>Math.max(0,Math.min(100,(x-lo)/(hi-lo)*100)),tp=pos(m.target),b=E.base[m.id],c=E.mine[m.id];
    return `<div class="trk${m.crit?" crit":""}"><div class="lab">${esc(m.label)} ${info(m.g)}</div><div class="bar" role="img" aria-label="${esc(m.label)}: baseline ${E.fmt(m,b)}, your scenario ${E.fmt(m,c)}, target ${E.fmt(m,m.target)}"><span class="zone" style="${m.dir==="lower"?`left:0;width:${tp}%`:`left:${tp}%;right:0`}"></span><span class="tgt" style="left:${tp}%"></span><span class="mk b" style="left:${pos(b)}%"></span><span class="mk m" style="left:${pos(c)}%"></span></div><div class="val">${E.fmt(m,b)} → <b>${E.fmt(m,c)}</b> <span class="${E.pass(m,c)?"pass":"fail"}">${E.pass(m,c)?"✓":"✗"}</span></div></div>`;}).join("")}</div>
    <div class="legend"><span><span class="pdot" style="border:3px solid #4A5A52;background:#fff;width:12px;height:12px"></span>Baseline</span><span><span class="pdot" style="background:#2F6FB3"></span>Your scenario</span><span><span style="display:inline-block;width:2px;height:12px;background:#13221C"></span> Target</span><span><span style="display:inline-block;width:18px;height:10px;background:#DCEFE4;border-radius:4px"></span> Meets target</span></div>`;
}
function leverCard(E,l){const k=l.dis?null:E.klass(l),on=!!E.R.on[l.id]&&!l.dis,fx=l.dis?[]:E.delta(l).filter(x=>Math.abs(x.d)>1e-9);
  return `<label class="lever${on?" on":""}${l.dis?" off":""}${k==="mal"?" mal":""}"><input type="checkbox" data-lv="${l.id}"${on?" checked":""}${l.dis?" disabled":""}><div><div class="nm">${esc(l.name)}</div><div class="faces">${l.dis?'<span class="chip grey">Not available</span>':`<span class="chip ${k==="mal"?"bad":k==="trade"?"warn":""}">${{nore:"no-regret",trade:"trade-off",mal:"maladaptation risk"}[k]}</span>`}${l.lib?`<span class="chip grey">${"$".repeat(l.lib.c)} · ${l.lib.lo}–${l.lib.hi} months</span>`:""}${l.asm&&!l.dis&&missing(l.asm).length?`<a class="chip grey" href="#/work/assume">No value yet: ${esc(missing(l.asm).map(k=>(ASSUME.find(a=>a.key===k)||{what:k}).what.toLowerCase()).join(", "))}</a>`:""}</div>
    ${l.dis?`<div class="tipx">${esc(l.dis)}</div>`:`<div class="fx">${fx.map(x=>{const good=x.m.dir==="lower"?x.d<0:x.d>0;return `<span class="fxc ${good?"good":"bad"}">${esc(x.m.label)} ${x.d>0?"+":"−"}${nf(Math.abs(x.d),x.m.dec!=null?x.m.dec:1)}${x.m.unit&&x.m.unit!=="$M"?" "+x.m.unit:x.m.unit==="$M"?" $M":""}</span>`;}).join("")}${fx.some(x=>E.ctx.fxKind[x.m.id]==="assume")?kindB("assume"):""}</div><div class="tipx">${esc(l.tip)}${l.force?" "+esc(l.force[1]):""}</div>`}</div></label>`;}
function leverCards(E){const own=E.L.filter(l=>!l.lib),lib=E.L.filter(l=>l.lib),cats=[...new Set(lib.map(l=>l.lib.cat))],onLib=lib.filter(l=>E.R.on[l.id]).length;
  return `<div class="levers">${own.map(l=>leverCard(E,l)).join("")}</div>${lib.length?`<details class="tv libx"${onLib||E.R.libOpen?" open":""}><summary>Strategy library: ${lib.length} more for ${esc(PERS[E.p].name)}${onLib?" · "+onLib+" on":""}</summary><p class="src" style="margin-top:6px">Hazard effects from the strategy library. Cost bands from Assumptions: ${COSTTXT(E.p)} ${kindB("assume")}. <a href="#/glossary/strategies">Whole library →</a></p>${cats.map(c=>`<h3 style="margin-top:12px">${esc(c)}</h3><div class="levers">${lib.filter(l=>l.lib.cat===c).map(l=>leverCard(E,l)).join("")}</div>`).join("")}</details>`:""}`;}
function guards(E){const g=[];E.avail.filter(l=>E.R.on[l.id]).forEach(l=>{if(E.klass(l)==="mal"){g.push(l.name+(l.force?": "+l.force[1]:" worsens "+E.worsens(l).map(m=>m.label.toLowerCase()).join(" and ")+", a climate-critical metric")+". This is maladaptation: it solves today's problem by adding future risk.");}});
  E.M.forEach(m=>{if(E.pass(m,E.base[m.id])&&!E.pass(m,E.mine[m.id])){g.push(m.label+" met its target at baseline but now misses it ("+E.fmt(m,E.mine[m.id])+").");}});return g;}
function cmpCard(E,title,v,set,id,sel){const n=E.met(v),chosen=E.R.choice===id;
  const prof=(()=>{const a=E.avail.filter(l=>set[l.id]);if(!a.length){return "no change";}const c={nore:0,trade:0,mal:0};a.forEach(l=>c[E.klass(l)]++);return [c.nore?c.nore+" no-regret":"",c.trade?c.trade+" trade-off":"",c.mal?c.mal+" maladaptation risk":""].filter(Boolean).join(" · ");})();
  return `<div class="cmpc${sel?"":" ro"}${sel&&chosen?" chosen":""}"><span class="eyebrow">${title}</span><span class="met">${n}/${E.M.length} targets</span><span class="src">${esc(E.names(set))}</span><span class="src">${prof}</span><table>${E.M.map(m=>`<tr><td>${esc(m.label)}</td><td class="${E.pass(m,v[m.id])?"pass":"fail"}">${E.fmt(m,v[m.id])}</td></tr>`).join("")}</table>${sel?`<button class="btn${chosen?"":" alt"} sm" type="button" data-choice="${id}" aria-pressed="${chosen}">${chosen?"Selected ✓":"Use this option"}</button>`:""}</div>`;}
function stepBody(E,st){
  const p=E.p,R=E.R,ctx=E.ctx;
  if(st===0){return `<div class="card"><h2>Who is deciding?</h2><p class="sub">The flow, inputs, levers and approvers follow the persona. No login: switching here also switches the menu.</p><div class="pcards" style="margin-top:12px">${PK.map(q=>`<button type="button" class="pcard2" data-pick="${q}" aria-pressed="${q===p}" style="min-height:0"><h3>${PERS[q].name}</h3><span class="src">Decides: ${PERS[q].decides}</span><span class="src">You get ${esc(PERS[q].get)}</span></button>`).join("")}</div>
    <div class="note" style="margin-top:14px">Six steps: persona → inputs → baseline → adjust → best fit → approval. Two worked examples per persona. New here? Press ▶ Watch a sample run, next to the title above, to see one played through.</div></div>`;}
  if(st===1){return `<div class="card"><h2>Inputs</h2><div class="ctas" style="margin-top:6px">${E.cfg.ex.map((x,i)=>`<button class="btn alt sm" type="button" data-ex="${i}">${esc(x[0])}</button>`).join("")}</div><div class="fields" style="margin-top:12px">${E.cfg.filters(R.f).map(fg=>{
      const tip=`<small>${esc(fg.tip)}</small>`;
      if(fg.type==="select"){return `<label class="field">${esc(fg.label)} ${tip}<select data-f="${fg.id}">${fg.html}</select></label>`;}
      if(fg.type==="number"||fg.type==="text"){return `<label class="field">${esc(fg.label)} ${tip}<input data-f="${fg.id}" type="${fg.type}" value="${esc(R.f[fg.id])}"${fg.min!=null?` min="${fg.min}" max="${fg.max}" step="${fg.step}"`:""}></label>`;}
      return `<div class="field">${esc(fg.label)} ${tip}${seg(fg.opts,R.f[fg.id],'data-fs="'+fg.id+'" data-v')}</div>`;}).join("")}</div>
    ${p==="op"?`<div class="ctas"><label class="btn alt sm" for="g-up" style="cursor:pointer">Upload your own meter CSV</label><input id="g-up" type="file" accept=".csv,text/csv" hidden><span class="src">Columns: timestamp, facility_kwh, it_kwh (optional water_litres). The readings stay in your browser; a one-line summary (country, size group, PUE, WUE, completeness) is kept on the server for pooled figures.</span></div>`:""}
    ${p==="ten"?'<p class="src" style="margin-top:8px">kWh per 1,000 inferences is your own figure; the example values are placeholders to replace.</p>':""}</div>`;}
  if(st===2){return `<div class="row2"><div class="card"><h2>Baseline: ${esc(ctx.entity)}</h2><p class="sub">${ctx.insight(E.base)}</p>
      ${ctx.blocked?`<div class="note bad" style="margin-top:10px"><b>Stopped at the data-quality gate.</b> ${esc(ctx.blocked)} ${info("gate")}<br>Upload a fuller file or choose another in Inputs.</div>`:""}
      <div class="tblwrap" style="margin-top:12px"><table class="t"><thead><tr><th>Metric</th><th>Baseline</th><th>Target</th><th></th><th>Where it comes from</th></tr></thead><tbody>${metricRows(E,null,false)}</tbody></table></div>
      ${ctx.nodata.length?`<h3 style="margin-top:12px">Left out ${info("nodata")}</h3><ul class="src">${ctx.nodata.map(n=>`<li>${kindB("nodata")} <b>${esc(n[0])}</b>: ${esc(n[1])}</li>`).join("")}</ul>`:""}</div>
    <div class="card"><h2>Facts used</h2><dl class="dl2" style="margin-top:8px">${ctx.facts.map(f=>`<dt>${esc(f[0])}</dt><dd>${esc(f[1])} ${kindB(f[2])}</dd>`).join("")}</dl>
      <h3 style="margin-top:14px">Rules in force ${info("rules")}</h3>${rulesBox(ctx.jur)}${rulesLink}
      <p class="src" style="margin-top:14px">Every number carries a badge above. The full list of data sources is in <a href="#/glossary/sources">Glossary · Data sources</a>.</p></div></div>`;}
  if(st===3){const g=guards(E);return `<div class="row2"><div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2>Adjust ${info("classes")}</h2><button class="btn alt sm" type="button" id="g-reset">↺ Reset to baseline</button></div><p class="sub">Switch levers on and watch every metric move against its target.</p>
      ${leverCards(E)}${g.map(x=>`<div class="guard">${esc(x)}</div>`).join("")}</div>
    <div class="card"><h2>Metrics vs targets</h2>${tracks(E)}<details class="tv"><summary>View as table</summary><div class="tblwrap"><table class="t"><thead><tr><th>Metric</th><th>Baseline</th><th>Your scenario</th><th>Target</th><th></th><th>Kind</th></tr></thead><tbody>${metricRows(E,E.mine,true)}</tbody></table></div></details>
      ${E.mine._haz&&(p==="op"||p==="colo")?`<h3 style="margin-top:14px">Hazard exposure</h3><div class="petalbox">${petalSvg(E.ctx.sc,E.mine._at&&E.mine._at!==E.ctx.hubId?null:E.mine._haz,"Hazard petals")}</div>${petLegend()}`:""}</div></div>`;}
  if(st===4){const worse=E.M.filter(m=>m.dir==="lower"?E.bestV[m.id]>E.base[m.id]+1e-9:E.bestV[m.id]<E.base[m.id]-1e-9),objM=E.M.find(m=>m.id===ctx.objective),nm=E.met(E.mine);
    return `<div class="card"><h2>Best fit ${info("bestfit")}</h2><p class="sub">Tried all ${nf(1<<E.cand.length)} combinations of ${E.cand.length===E.avail.length?"the "+E.avail.length+" available levers":"the "+E.cand.length+" strongest of "+E.avail.length+" available levers (design levers and library strategies)"}.</p><div class="cmp">${cmpCard(E,"Baseline",E.base,{},"base",false)}${cmpCard(E,"Your scenario",E.mine,E.R.on,"mine",true)}${cmpCard(E,"AI best fit",E.bestV,E.best,"best",true)}</div>
      <div class="note" style="margin-top:12px">Best fit switches on ${esc(E.names(E.best))}. It meets ${E.met(E.bestV)} of ${E.M.length} targets${objM?` and moves ${esc(objM.label.toLowerCase())} from ${E.fmt(objM,E.base[objM.id])} to ${E.fmt(objM,E.bestV[objM.id])}`:""}, in line with your objective. ${E.met(E.bestV)>nm?"That is "+(E.met(E.bestV)-nm)+" more than your scenario.":E.met(E.bestV)===nm?"Your scenario meets as many: compare cost and side effects.":""}</div>
      ${worse.length?`<div class="note warn" style="margin-top:8px">Trade-off: ${worse.map(m=>esc(m.label)+" moves from "+E.fmt(m,E.base[m.id])+" to "+E.fmt(m,E.bestV[m.id])).join("; ")}.</div>`:""}</div>`;}
  const ap=E.ap;let q=R.submitted?GOV.requests.find(x=>x.id===R.submitted):null;
  if(R.submitted&&!q){if(GOV.at&&Date.now()-GOV.at<4000){R.submitted=null;save();}else{if(!GOV.loading){loadGov().then(route);}return '<div class="card"><p class="src"><span class="spin"></span>Loading the request…</p></div>';}}
  const own=!q||(R.snapshot&&R.snapshot.id===q.id),H=HIER[q?q.persona:p],hit=own?E.hit:[],chain=q?q.steps.map(x=>x.who):ap.chain;
  const route=[["Requester",q?q.by:(S.approver||"[your name]")]].concat(chain.map((c,i)=>["Approver "+(i+1),c])).concat([["Record","Audit trail"]]);
  const st2=i=>!q||i<1||i>q.steps.length?"":q.steps[i-1].state==="approved"?" ok":q.steps[i-1].state==="rejected"?" no":q.state==="pending"&&q.steps.findIndex(x=>x.state==="waiting")===i-1?" cur":"";
  const bar=`<div class="route" aria-label="Approval route">${route.map((r,i)=>`<span class="rstep${st2(i)}${q&&i===route.length-1?" ok":""}"><small>${esc(r[0])}</small><b>${esc(r[1])}</b></span>${i<route.length-1?'<span class="rarr" aria-hidden="true">→</span>':""}`).join("")}</div>`;
  const stmt=!own?`<div class="card"><span class="eyebrow">Request from ${esc(PERS[q.persona].name)}</span><h2 style="margin-top:4px">${esc(q.title)}</h2><pre class="reqtext">${esc(q.text)}</pre></div>`:`<div class="card"><span class="eyebrow">Climate impact statement</span><h2 style="margin-top:4px">${R.choice==="best"?"AI best fit":"Your scenario"} · ${E.met(E.finalV)}/${E.M.length} targets met</h2><p class="sub">${esc(ctx.entity)}: ${esc(E.names(E.final))}</p><div class="tblwrap" style="margin-top:10px"><table class="t"><tbody>${E.M.map(m=>{const ok=E.pass(m,E.finalV[m.id]);return `<tr><td>${esc(m.label)}</td><td class="num">${E.fmt(m,E.base[m.id])} → <b>${E.fmt(m,E.finalV[m.id])}</b></td><td class="${ok?"pass":"fail"}">${ok?"✓ Met":"! Gap"}</td><td>${kindB(m.kind)}</td></tr>`;}).join("")}</tbody></table></div><p class="src" style="margin-top:8px">Climate profile: ${esc(profileOf(E,E.final))}</p></div>`;
  const banner=q?`<div class="note${q.state==="pending"?" warn":""}"><b>${chain.length?"Approval route · "+esc(chain.join(" → ")):"No approval needed"}</b> ${info("approval")}</div>`:`<div class="note${ap.chain.length?" warn":""}"><b>${ap.chain.length?"Approval required · "+esc(ap.chain.join(" → ")):"No approval needed"}</b> ${info("approval")}<br>${esc(ap.why)}</div>`;
  const hier=`<h3 style="margin-top:14px">Approval hierarchy · ${esc(PERS[q?q.persona:p].name)}</h3><div class="tblwrap"><table class="t"><thead><tr><th>When</th><th>Approver 1</th><th>Approver 2</th></tr></thead><tbody>${H.map((r,i)=>`<tr${hit[i]?' class="on"':""}><td>${esc(r[0])}${hit[i]?' <span class="chip">applies</span>':""}</td><td>${esc(r[1])}</td><td>${esc(r[2]||"–")}</td></tr>`).join("")}</tbody></table></div><p class="src">From the design's approval rules and roles: ${esc(ROLES[q?q.persona:p])}. There is no login, so people type their name.</p>`;
  let right;
  if(!q){right=`${banner}${hier}<label class="field" style="margin-top:12px">Your name<input id="g-name" value="${esc(S.approver)}" autocomplete="name"></label>
     <label class="field" style="margin-top:8px">Justification for the approver<textarea id="g-reason" rows="3" placeholder="${esc(ctx.just)}"></textarea></label>
     <p class="src" style="margin-top:8px"><b>Evidence attached automatically</b></p><ul class="evid">${evidence(E).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
     <div class="ctas"><button class="btn" type="button" id="g-submit"${ctx.blocked?" disabled":""}>${ap.chain.length?"Send to "+esc(ap.chain[0]):"Log decision"}</button></div><div id="g-msg" aria-live="polite"></div>`;}
  else{const cur=q.steps.find(x=>x.state==="waiting"),trail=GOV.audit.filter(e=>e.action.includes(q.id)).slice().reverse();
    right=`${banner}<div class="trail"><span class="eyebrow">Audit trail · ${esc(q.id)}</span><b>${q.state==="pending"?"Pending approval · "+esc(cur.who):q.state==="approved"?"Approved":q.state==="rejected"?"Rejected":"Decision logged"}</b>${own?`<pre>${esc(q.text)}</pre>`:""}${trail.map(e=>`<div class="tline">${new Date(e.at).toLocaleString()} · ${esc(e.actor)} · ${esc(e.action)}${e.action.startsWith("Request")||e.action.startsWith("Logged")?"":" · “"+esc(e.detail)+"”"} <span class="hash">${e.hash.slice(0,12)}…</span></div>`).join("")}</div>
     ${q.state==="pending"?`<div class="decide"><h3>Record the decision as ${esc(cur.who)}</h3><div class="fields"><label class="field">Approver's name<input id="d-name"></label><label class="field">Reason<input id="d-note"></label></div><div class="ctas"><button class="btn sm" type="button" data-dec="approve">Approve</button><button class="btn danger sm" type="button" data-dec="reject">Reject with reason</button></div></div>`:""}
     <div class="ctas"><button class="btn alt sm" type="button" id="g-verify">Verify audit trail</button>${own?'<a class="btn alt sm" href="#/impact">See the impact</a>':""}<button class="btn alt sm" type="button" id="g-new">Start a new run</button></div><div id="g-vmsg" aria-live="polite"></div>`;}
  return `${bar}<div class="row2" style="margin-top:14px">${stmt}<div class="card">${right}</div></div>`;
}
let PLAY=null;
let GSTEP="";
function guidedPage(){const E=engine(PERSONA),st=E.R.step;if(GSTEP!==PERSONA+st){GSTEP=PERSONA+st;if(window.STA){STA.event("guided_step",{persona:PERSONA,step:st});}}
  return `<div class="wrap">${phead("My workspace · "+esc(PERS[PERSONA].name)+" · Guided flow",esc(STEPS[st])+(st>0?": "+esc(E.ctx.entity):""),st?"":"Explained, approved, logged.",`${PLAY?'<button class="btn danger sm" type="button" id="g-stop">■ Stop and take over</button>':'<button class="btn dark sm" type="button" id="g-play">▶ Watch a sample run</button>'}`,true)}${wnav("guided")}
  <ol class="steps">${STEPS.map((s,i)=>`<li><button type="button" data-step="${i}" class="${i<st?"done":""}"${i===st?' aria-current="step"':""}${i>2&&E.ctx.blocked?" disabled":""}><i>${i}</i>${s}</button></li>`).join("")}</ol>
  <div id="gbody">${stepBody(E,st)}</div>
  <div class="gnav">${st>0?'<button class="btn alt" type="button" id="gprev">← Back</button>':"<span></span>"}${st<5&&!(st===2&&E.ctx.blocked)?`<button class="btn" type="button" id="gnext">${st===0?"Start":"Next: "+STEPS[st+1]} →</button>`:""}</div></div>`;
};
function guidedAfter(){const v=$("view"),R=runOf(PERSONA),re=()=>{save();route();};
  v.querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>{setPersona(b.dataset.pick);renderNav();re();});
  v.querySelectorAll("[data-step]").forEach(b=>b.onclick=()=>{R.step=+b.dataset.step;re();});
  const nx=$("gnext"),pv=$("gprev");if(nx){nx.onclick=()=>{R.step++;re();};}if(pv){pv.onclick=()=>{R.step--;re();};}
  v.querySelectorAll("[data-ex]").forEach(b=>b.onclick=()=>{R.f=Object.assign({},CFG[PERSONA].ex[+b.dataset.ex][1]);R.on={};R.choice="mine";R.submitted=null;toast("Inputs filled from "+CFG[PERSONA].ex[+b.dataset.ex][0].split(":")[0]+".");re();});
  v.querySelectorAll("[data-f]").forEach(el=>el.onchange=()=>{R.f[el.dataset.f]=el.type==="number"?+el.value:el.value;R.on={};re();});
  v.querySelectorAll("[data-fs]").forEach(b=>b.onclick=()=>{R.f[b.dataset.fs]=b.dataset.v;R.on={};re();});
  const up=$("g-up");if(up){up.onchange=e=>{const f=e.target.files[0];if(!f){return;}if(f.size>5e6){toast("Files up to 5 MB.");return;}const r=new FileReader();r.onload=async()=>{try{const text=String(r.result),m=meterParse(text);S.upload=Object.assign(m,{label:"Your file: "+f.name,fict:false});R.f.meter="upload";re();
      const h=hub(R.f.site),res=await fetch("/api/meters",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({country:h?h.c:"",hub:R.f.site,mw:R.f.mw||null,pue:m.pue,wue:m.wue,complete:m.complete,hours:m.hours,fileHash:await sha(text)})}),j=await res.json().catch(()=>({}));
      toast(!res.ok?(j.error||"The summary couldn't be shared."):j.duplicate?"This file's summary was already shared.":"Summary shared for pooled figures. The readings stayed in your browser.");}catch(err){toast(err.message);}};r.readAsText(f);};}
  v.querySelectorAll("[data-lv]").forEach(cb=>cb.onchange=()=>{if(cb.checked){R.on[cb.dataset.lv]=true;}else{delete R.on[cb.dataset.lv];}R.choice="mine";re();});
  const rs=$("g-reset");if(rs){rs.onclick=()=>{R.on={};re();};}
  v.querySelectorAll("[data-choice]").forEach(b=>b.onclick=()=>{R.choice=b.dataset.choice;re();});
  const nw=$("g-new");if(nw){nw.onclick=()=>{R.on={};R.choice="mine";R.submitted=null;R.step=1;re();};}
  const sb=$("g-submit");if(sb){sb.onclick=async()=>{const reason=($("g-reason").value||"").trim();S.approver=($("g-name").value||"").trim();
    if(!S.approver){$("g-msg").innerHTML='<div class="note bad" style="margin-top:8px">Type your name: there is no login.</div>';$("g-name").focus();return;}
    if(reason.length<8){$("g-msg").innerHTML='<div class="note bad" style="margin-top:8px">Write a justification of at least a few words.</div>';return;}
    const E=engine(PERSONA);
    const fl=CFG[PERSONA].filters(R.f).map(fg=>{const v=R.f[fg.id];return fg.label+": "+(fg.opts?((fg.opts.find(o=>String(o[0])===String(v))||[0,v])[1]):fg.type==="select"&&hub(v)?hub(v).n:(v==null||v===""?"–":v));}).join(" · ");
    const text=["Requested by: "+who()+" ("+PERS[PERSONA].name+")","Entity: "+E.ctx.entity,"Inputs: "+fl,"Option: "+(R.choice==="best"?"AI best fit":"Your scenario")+" — "+E.names(E.final),"Targets met: "+E.met(E.finalV)+"/"+E.M.length+" · climate profile: "+profileOf(E,E.final),"Justification: "+reason,"Data: data build "+String(D.generated).slice(0,10)+" (sources in the Glossary)","Route: "+(E.ap.chain.length?E.ap.chain.join(" → "):"auto-logged"),"Metrics:"].concat(E.M.map(m=>"  "+m.label+": "+E.fmt(m,E.base[m.id])+" → "+E.fmt(m,E.finalV[m.id])+(E.pass(m,E.finalV[m.id])?" (met)":" (gap)"))).join("\n");
    sb.disabled=true;
    try{const j=await post("/api/requests",{persona:PERSONA,title:PERS[PERSONA].decides+": "+E.ctx.entity,entity:E.ctx.entity,levers:E.names(E.final),reason,text,by:S.approver,steps:E.ap.chain});
      await loadGov();R.submitted=j.request.id;R.snapshot={id:j.request.id};if(window.STA){STA.event("approval_sent",{persona:PERSONA,choice:R.choice,approvers:E.ap.chain.length});}re();}
    catch(err){sb.disabled=false;$("g-msg").innerHTML=`<div class="note bad" style="margin-top:8px">${esc(err.message)}</div>`;}};}
  v.querySelectorAll("[data-dec]").forEach(b=>b.onclick=async()=>{const nm=($("d-name").value||"").trim(),note=($("d-note").value||"").trim();
    if(!nm){toast("Type the approver's name: there is no login.");$("d-name").focus();return;}if(note.length<3){toast("Write a short reason.");$("d-note").focus();return;}
    b.disabled=true;try{await post("/api/requests/"+encodeURIComponent(R.submitted)+"/decide",{decision:b.dataset.dec,by:nm,note});if(window.STA){STA.event("approval_decided",{persona:PERSONA,decision:b.dataset.dec});}await loadGov();re();}catch(err){b.disabled=false;toast(err.message);}});
  const gv=$("g-verify");if(gv){gv.onclick=async()=>{await loadGov();const vv=GOV.verify;$("g-vmsg").innerHTML=!vv?'<div class="note bad" style="margin-top:8px">The audit trail could not be checked right now.</div>':vv.ok?`<div class="note" style="margin-top:8px">All ${vv.count} fingerprints in the team's audit trail check out. ${info("audit")}</div>`:`<div class="note bad" style="margin-top:8px">The audit trail is broken at entry ${vv.broken}.</div>`;wireInfo($("g-vmsg"));};}
  if(R.step===5&&R.submitted&&!GOV.loading&&Date.now()-GOV.at>10000){loadGov().then(()=>{if(location.hash.startsWith("#/work/guided")){route();}});}
  v.querySelectorAll("details.libx").forEach(d=>d.addEventListener("toggle",()=>{R.libOpen=d.open;save();}));
  const pl=$("g-play");if(pl){pl.onclick=async()=>{const token={};PLAY=token;R.f=Object.assign({},CFG[PERSONA].ex[0][1]);R.on={};R.choice="mine";R.submitted=null;
    for(let s=0;s<=4;s++){if(PLAY!==token||!location.hash.startsWith("#/work/guided")){return;}R.step=s;
      if(s===3){const E=engine(PERSONA);R.on=Object.assign({},E.best);}if(s===4){R.choice="best";}re();await W(1900);}
    if(PLAY===token){R.step=5;PLAY=null;re();toast("Sample run stopped at approval. Nothing is sent until you write a justification.");}};}
  const sp=$("g-stop");if(sp){sp.onclick=()=>{PLAY=null;re();};}
};

/* ---------- Dashboards ---------- */
function aiRec(p){const E=engine(p);if(E.ctx.blocked){return `<div class="card"><span class="eyebrow">AI recommendation</span><h2 style="margin-top:4px">Paused by the data-quality gate</h2><p class="sub">${esc(E.ctx.blocked)}</p><div class="ctas"><a class="btn alt" href="#/work/guided">Choose another meter file</a></div></div>`;}return `<div class="card"><span class="eyebrow">AI recommendation ${info("bestfit")}</span><h2 style="margin-top:4px">${esc(E.names(E.best))}</h2><p class="sub">For ${esc(E.ctx.entity)}: meets ${E.met(E.bestV)} of ${E.M.length} targets (baseline ${E.met(E.base)}). ${E.M.filter(m=>E.bestV[m.id]!==E.base[m.id]).slice(0,3).map(m=>esc(m.label)+" "+E.fmt(m,E.base[m.id])+" → "+E.fmt(m,E.bestV[m.id])).join(" · ")}</p>
  <div class="ctas"><button class="btn" type="button" data-review="best">Review and send for approval</button><button class="btn alt" type="button" data-review="adjust">Adjust it myself</button></div></div>`;}
/* Dashboard charts (public/charts.js): pictures of numbers the dashboards already show; nothing new is computed. */
const HC=["#F2C9A0","#E58A4E","#A8431A"],BANDC=c=>c==null?"#C9D3CD":c<35?"#4CAF7D":c<55?"#E0B33A":c<70?"#E07B39":"#C8432F";
function trajChart(id,p){const z=HZD[id],h=hub(id);if(!window.ACH||!z||!h){return "";}const hs=["today","2030","2050"].map(x=>scoresOf(z,x,p));
  return `<div class="card"><h2>Hazard trajectory · ${esc(h.n)}</h2><p class="sub">Each hazard today, in 2030 and in 2050 (${p==="mod"?"SSP2-4.5":"SSP5-8.5"}). Hazards with no projection keep today's value; a dot means no data.</p>${ACH.groupedBars({label:"Hazard scores for "+h.n,cats:HZ.map(x=>x[1]),series:["Today","2030","2050"].map((n,i)=>({name:n,color:HC[i],values:hs[i]}))})}</div>`;}
function targetChart(p){const E=engine(p);if(!window.ACH||E.ctx.blocked){return "";}
  return `<div class="card"><h2>Targets: now vs AI best fit ${info("bestfit")}</h2><p class="sub">${esc(E.ctx.entity)}: the AI best fit meets ${E.met(E.bestV)} of ${E.M.length} targets (now ${E.met(E.base)}).</p>${ACH.bullets(E.M.map(m=>({label:m.label,base:E.base[m.id],best:E.bestV[m.id],target:m.target,dir:m.dir,fmt:v=>E.fmt(m,v),pass:E.pass(m,E.bestV[m.id])})))}</div>`;}
function riskRank(p,on){if(!window.ACH){return "";}const rows=withData().map(h=>({h,c:comp(scoresOf(HZD[h.id],"2050",p))})).filter(r=>r.c!=null).sort((a,b)=>b.c-a.c);
  return `<div class="card"><h2>Overall climate risk by 2050 · every place ${info("overall")}</h2><p class="sub">${p==="mod"?"SSP2-4.5":"SSP5-8.5"}, highest first.${on&&hub(on)?" "+esc(hub(on).n)+" is highlighted.":""}</p>${ACH.rankBars(rows.map(r=>({label:r.h.n,sub:r.h.c,value:r.c,color:BANDC(r.c),on:r.h.id===on})))}</div>`;}
/* Outlook: forecast and history line charts from the open data already behind each score (both pathways side by side). */
const OC={t:"#7FD1A8",m:"#4C9BE8",h:"#F0703A"};
function outlook(id){const z=HZD[id],h=hub(id);if(!window.ACH||!z||!h){return "";}
  const X=["Today","2030","2050"],cm=X.map((_,i)=>comp(scoresOf(z,["today","2030","2050"][i],"mod"))),ch=X.map((_,i)=>comp(scoresOf(z,["today","2030","2050"][i],"high")));
  const he=entry(z,"heat")||{},hr=he.raw||{},hc=he.rawCdd||{},x=z.extra||{},sl=x.seaLevel,gc=x.gridCarbon,thr=(D.config||{}).heatThresholdC||35,hx=["1991–2020","2030","2050"];
  const proj=o=>[{name:"SSP2-4.5",color:OC.m,values:[o.t,o.m30,o.m50]},{name:"SSP5-8.5",color:OC.h,values:[o.t,o.h30,o.h50]}];
  const card=(t,sub,body)=>`<div class="card cdark"><span class="eyebrow">Outlook</span><h2 style="margin-top:4px">${t}</h2><p class="sub">${sub}</p>${body}</div>`;
  const cards=[
    card("Climate risk outlook",`Overall climate risk at ${esc(h.n)}, today to 2050. The shading is the difference the emissions pathway makes.`,ACH.lines({label:"Overall climate risk outlook",x:X,yMin:0,bandLabel:"pathway gap",series:[{name:"SSP2-4.5",color:OC.m,values:cm},{name:"SSP5-8.5",color:OC.h,values:ch,band:{lo:cm,hi:ch}}]})),
    hr.t!=null?card(`Hot days a year (≥ ${thr} °C)`,"1991–2020 average, then projected with World Bank CMIP6 warming. More hot days means thinner cooling margins.",ACH.lines({label:"Hot days a year",x:hx,yMin:0,unit:" days",series:proj(hr)})):"",
    hc.t!=null?card("Cooling degree days","Base 18 °C: how hard cooling plant works over a year. Higher means more energy and water for cooling.",ACH.lines({label:"Cooling degree days",x:hx,series:proj(hc)})):"",
    sl?card(`Sea level rise · tide gauge ${sl.km} km away`,"IPCC AR6, relative to 1995–2014. Lines are the median; shading is the likely range.",ACH.lines({label:"Sea level rise",x:["1995–2014","2030","2050"],yMin:0,unit:" cm",bandLabel:"likely range",series:["mod","high"].map(k=>({name:k==="mod"?"SSP2-4.5":"SSP5-8.5",color:k==="mod"?OC.m:OC.h,values:[0,sl[k]["2030"].mid,sl[k]["2050"].mid],band:{lo:[0,sl[k]["2030"].lo,sl[k]["2050"].lo],hi:[0,sl[k]["2030"].hi,sl[k]["2050"].hi]}}))})):"",
    gc&&gc.past?card("Grid carbon intensity",`National grid, ${gc.past.year} to ${gc.year} (Ember via Our World in Data). Lower means cleaner power for every server.`,ACH.lines({label:"Grid carbon intensity",x:[String(gc.past.year),String(gc.year)],yMin:0,unit:" g/kWh",series:[{name:"g CO₂/kWh",color:OC.t,values:[gc.past.g,gc.g]}]})):"",
    card("Temperature history, 1991–2020",`Yearly mean temperature at ${esc(h.n)} (NASA POWER), with the 30-year average and warming stripes.`,`<div class="outtemp" data-lat="${z.lat}" data-lon="${z.lon}"><p class="achnd">Loading…</p></div>`)].filter(Boolean);
  return `<div class="outhead"><h2>Outlook · ${esc(h.n)}</h2><p>Forecasts and history from the open data behind every score. Hover a chart for values.</p></div><div class="chartrow">${cards.join("")}</div>`;}
async function fillOutlook(root){if(!window.ACH||!root){return;}ACH.wire(root);
  for(const el of root.querySelectorAll(".outtemp")){try{const r=await fetch("/api/stripes?lat="+el.dataset.lat+"&lon="+el.dataset.lon);if(!r.ok){throw new Error();}
    const T=(await r.json()).years||{},ys=Object.keys(T).sort();if(!ys.length){throw new Error();}const v=ys.map(y=>T[y]),mean=v.reduce((a,b)=>a+b,0)/v.length,lo=Math.min(...v),hi=Math.max(...v);
    const S=["#08519c","#3182bd","#9ecae1","#fee0d2","#fc9272","#de2d26","#a50f15"],col=t=>S[Math.min(S.length-1,Math.floor((t-lo)/((hi-lo)||1)*S.length))];
    el.innerHTML=ACH.lines({label:"Yearly mean temperature",x:ys,unit:" °C",mean:+mean.toFixed(2),meanLabel:"1991–2020 average",series:[{name:"Yearly mean °C",color:"#F3C440",values:v}],stripes:v.map(col)});ACH.wire(el);}
  catch(e){el.innerHTML='<p class="achnd">Temperature history is unavailable right now (NASA POWER could not be reached).</p>';}}}
const DASH={};
DASH.op=()=>{const E=engine("op"),f=E.R.f,h=hub(f.site),z=HZD[f.site],sc=E.ctx.sc,c=comp(sc),gc=gcOf(f.site),m=meterOf(f.meter),j=jurOf(h),pr=pueRule(j),g=entry(z,"grid")||{},gr=g.raw||{},w=worstIdx(sc);
  return phead("Dashboard · "+PERS.op.dash,esc(h.n)+": site resilience cockpit",esc(h.c)+" · "+scenTxt(f.h,f.p)+` · <a href="#/work/guided">change site in the guided flow</a>`)+`
  <section class="kpis"><div class="kpi"><span class="k">Resilience${info("resilience")}</span><span class="v">${100-c}<small>/100</small></span><span class="d">Overall risk ${c} · ${band(c)}</span></div>
   <div class="kpi"><span class="k">Biggest hazard${info(HZ[w][0])}</span><span class="v">${esc(HZ[w][1])}<small>${sc[w]}</small></span><span class="d">${kindB("measured")}</span></div>
   <div class="kpi${m?"":" empty"}"><span class="k">PUE${info("pue")}</span><span class="v">${m?m.pue.toFixed(2):"No data"}<small>${pr?"rule ≤ "+pr.pue:""}</small></span><span class="d">${m?esc(m.label.slice(0,40))+"… "+m.complete.toFixed(0)+"% complete":"Choose a meter file in Inputs"}</span></div>
   <div class="kpi"><span class="k">Grid carbon${info("carbon")}</span><span class="v">${gc?gc.g:"–"}<small>g/kWh</small></span><span class="d">${gc?gc.year:"No data"}</span></div>
   <div class="kpi${g.kind&&g.kind!=="none"?"":" empty"}"><span class="k">Grid reliability${info("grid")}</span><span class="v">${g.kind&&g.kind!=="none"?(gr.ensPct!=null?nf(gr.ensPct,3)+"<small>% unsupplied</small>":nf(gr.saidi,1)+"<small>h a year</small>"):"No data"}</span><span class="d">${esc(gr.state||gr.where||"No measured outages here")}</span></div></section>
  <div class="chartrow">${trajChart(f.site,f.p||"high")}${targetChart("op")}</div>${outlook(f.site)}
  <div class="row2" style="margin-top:16px">${aiRec("op")}<div class="card"><h2>Physical climate risk · ${f.h}</h2><div class="petalbox">${petalSvg(sc,null,"Hazard petals for "+h.n)}</div></div></div>
  <div class="row2" style="margin-top:16px"><div class="card"><h2>Rules in force · ${esc(JNAME[j]||h.c)} ${info("rules")}</h2>${rulesBox(j)}${rulesLink}</div><div class="card"><h2>Inputs, filters and outputs</h2><div class="row3"><div><h3 class="eyebrow">Inputs</h3><ul class="src"><li>Data build ${String(D.generated).slice(0,10)} · <a href="#/glossary/sources">sources</a></li>${m?`<li>${esc(m.label)}</li>`:""}</ul></div><div><h3 class="eyebrow">Filters</h3><ul class="src"><li>${scenTxt(f.h,f.p)}</li><li>${esc(f.obj)}</li><li>Budget $${f.budget}M</li></ul></div><div><h3 class="eyebrow">Outputs</h3><ul class="src"><li>Best fit: ${esc(E.names(E.best))}</li><li>Route: ${E.ctx.approval(E.bestV,E.avail.filter(l=>E.best[l.id])).chain.join(" → ")||"none"}</li></ul></div></div></div></div>`;};
DASH.colo=()=>{const E=engine("colo"),f=E.R.f;return phead("Dashboard · "+PERS.colo.dash,"Where to build, where to run in Asia-Pacific",scenTxt(f.h,f.p))+`<div id="fleet" class="card"><p class="src"><span class="spin"></span>Loading sites…</p></div>
  <div class="row2" style="margin-top:16px">${aiRec("colo")}<div class="card" id="dsiting"></div></div>
  <div class="chartrow">${riskRank(f.p||"high",f.cand||f.site)}${targetChart("colo")}</div>${outlook(f.cand||f.site)}`;};
DASH.ten=()=>{const E=engine("ten"),f=E.R.f,u=HZD[f.users];
  const rows=regions().map(k=>{const z=HZD[REG[k][0]],sc=scoresOf(z,"2050","mod"),l=latMs(u,z),why=f.res==="in"&&REG[k][1]!==REG[f.region][1]?"Residency":l>f.sla?"Over SLA":"";return {k,g:GOOGLE[k],c:comp(sc),heat:sc[0],l,why,t:(+f.kwh||0)*GOOGLE[k].g};}).sort((a,b)=>a.t-b.t);
  return phead("Dashboard · "+PERS.ten.dash,"Where should "+esc(f.wl)+" run?","Google Cloud region data 2025 + hazard data, 2050 SSP2-4.5")+`<div class="row2">${aiRec("ten")}<div class="card"><h2>Sustainable AI scorecard</h2><dl class="dl2" style="margin-top:8px"><dt>Carbon / 1k inferences</dt><dd>${E.fmt(E.M[0],E.base.carbon)} ${kindB("yours")}</dd><dt>Region CFE</dt><dd>${nf(GOOGLE[f.region].cfe*100)}% ${kindB("measured")}</dd><dt>Host heat 2050</dt><dd>${E.base.heat} ${kindB("measured")}</dd><dt>Water / 1k inferences</dt><dd>${kindB("nodata")} no per-region data</dd><dt>Reporting</dt><dd>${esc(f.rep)}</dd></dl><div class="ctas"><button class="btn alt sm" type="button" id="t-csv">Export scorecard CSV</button></div></div></div>
  <div class="card" style="margin-top:16px"><h2>Region options ${info("cfe")}</h2><div class="tblwrap"><table class="t"><thead><tr><th>Region</th><th>g CO₂/kWh</th><th>CFE</th><th>g / 1k inferences</th><th>Heat 2050</th><th>Overall risk</th><th>Latency (est.)</th><th>Allowed</th></tr></thead><tbody>${rows.map(r=>`<tr${r.k===f.region?' class="on"':""}><td><b>${esc(r.g.loc)}</b> <span class="src">${r.k}</span>${r.k===f.region?' <span class="chip grey">current</span>':""}</td><td class="num">${nf(r.g.g)}</td><td class="num">${nf(r.g.cfe*100)}%</td><td class="num">${nf(r.t,1)}</td><td>${pill(r.heat)}</td><td>${pill(r.c)}</td><td class="num">${r.l} ms</td><td>${r.why?`<span class="st-no">No</span> <span class="src">${r.why}</span>`:'<span class="st-ok">Yes</span>'}</td></tr>`).join("")}</tbody></table></div></div>
  ${window.ACH?`<div class="chartrow"><div class="card"><h2>Carbon vs climate risk, by region</h2><p class="sub">Lower left is best: less carbon per 1,000 inferences and lower overall risk (2050, SSP2-4.5). Green = allowed by residency and SLA; ringed = current region.</p>${ACH.scatter({label:"Regions by carbon and climate risk",xLabel:"g CO₂ per 1,000 inferences",yLabel:"Overall climate risk",points:rows.filter(r=>r.c!=null).map(r=>({x:r.t,y:r.c,label:r.g.loc+" ("+r.k+")",short:r.g.loc,color:r.why?"#C25A1E":"#2E7D5B",ring:r.k===f.region}))})}</div>${targetChart("ten")}</div>`:""}${REG[f.region]?outlook(REG[f.region][0]):""}`;};
DASH.pol=()=>{const E=engine("pol"),f=E.R.f,h=hub(f.hub),j=jurOf(h);
  return phead("Dashboard · "+PERS.pol.dash,esc(h.c)+": data centre growth vs grid and water",`Pooled and public data only ${info("kanon")}`)+`<section class="kpis">${E.ctx.facts.map(x=>`<div class="kpi${x[2]==="nodata"?" empty":""}"><span class="k">${esc(x[0])}</span><span class="v" style="font-size:22px">${esc(x[1])}</span><span class="d">${kindB(x[2])}</span></div>`).join("")}</section>
  <div class="chartrow">${trajChart(f.hub,f.p||"high")}${targetChart("pol")}</div>${outlook(f.hub)}
  <div class="row2" style="margin-top:16px">${aiRec("pol")}<div class="card" id="pooled"><h2>Pooled operator figures ${info("kanon")}</h2><p class="src"><span class="spin"></span>Loading…</p></div></div>
  <div class="card" style="margin-top:16px"><h2>Rules in force · ${esc(JNAME[j]||h.c)}</h2>${rulesBox(j)}${rulesLink}</div>`;};
PAGES.dash=()=>`<div class="wrap">${ctxBar()}${DASH[PERSONA]()}<div class="card" id="pending" style="margin-top:16px"><h2>Approvals</h2><p class="src"><span class="spin"></span>Loading…</p></div></div>`;
PAGES.dash.after=()=>{const v=$("view");fillOutlook(v);
  v.querySelectorAll("[data-review]").forEach(b=>b.onclick=()=>{const E=engine(PERSONA),R=E.R;if(b.dataset.review==="best"){R.on=Object.assign({},E.best);R.choice="best";R.step=5;}else{R.step=3;}R.submitted=null;save();location.hash="#/work/guided";});
  if(PERSONA==="colo"){loadFleet("dash");}
  loadGov().then(()=>{const el=$("pending");if(!el){return;}const mine=GOV.requests.filter(q=>q.persona===PERSONA),pend=mine.filter(q=>q.state==="pending"),recent=mine.filter(q=>q.state!=="pending").slice(0,5);
    el.innerHTML=`<h2>Approvals · ${esc(PERS[PERSONA].name)} ${info("approval")}</h2><p class="sub">${pend.length?pend.length+" waiting for a decision.":"Nothing waiting."} Requests are shared by the team; open one to record a decision.</p>${mine.length?`<div class="tblwrap"><table class="t"><thead><tr><th>Request</th><th>Requested</th><th>Status</th><th></th></tr></thead><tbody>${pend.concat(recent).map(q=>{const cur=q.steps.find(x=>x.state==="waiting");return `<tr><td><b>${esc(q.id)}</b> ${esc(q.title)}<div class="src">${esc(q.levers).slice(0,160)}</div></td><td class="src">${esc(q.by)}<br>${new Date(q.at*1000).toLocaleString()}</td><td>${q.state==="pending"?`<span class="chip warn">Waiting · ${esc(cur?cur.who:"")}</span>`:q.state==="approved"?'<span class="chip">Approved</span>':q.state==="rejected"?'<span class="chip bad">Rejected</span>':'<span class="chip grey">Logged</span>'}</td><td><button class="btn alt sm" type="button" data-open="${esc(q.id)}">Open</button></td></tr>`;}).join("")}</tbody></table></div>`:""}`;
    wireInfo(el);el.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{const R=runOf(PERSONA);R.submitted=b.dataset.open;R.step=5;save();location.hash="#/work/guided";});});
  const po=$("pooled");if(po){fetch("/api/meters/pooled").then(r=>r.json()).then(j=>{const g=j.groups||[];
    po.innerHTML=`<h2>Pooled operator figures ${info("kanon")}</h2><p class="sub">Median PUE and WUE from operators' meter summaries (files at least 90% complete). Groups of fewer than ${j.k} operators are hidden.</p>${g.length?`<div class="tblwrap"><table class="t"><thead><tr><th>Country</th><th>Size group</th><th>Operators</th><th>Median PUE</th><th>Median WUE</th></tr></thead><tbody>${g.map(r=>r.suppressed?`<tr><td>${esc(r.country)}</td><td>${esc(r.size)}</td><td colspan="3" class="src">Hidden: fewer than ${j.k} operators</td></tr>`:`<tr><td>${esc(r.country)}</td><td>${esc(r.size)}</td><td class="num">${r.n}</td><td class="num">${r.pue}</td><td class="num">${r.wue??"–"}</td></tr>`).join("")}</tbody></table></div>`:`<p class="src" style="margin-top:8px">No pooled figures yet (${j.files||0} complete meter summaries so far). They appear once ${j.k} operators in a country and size group have uploaded a meter file.</p>`}`;wireInfo(po);}).catch(()=>{po.innerHTML='<h2>Pooled operator figures</h2><p class="src">Unavailable right now.</p>';});}
  const tc=$("t-csv");if(tc){tc.onclick=()=>{const E=engine("ten");download("ai-scorecard.csv",csv([["Metric","Value","Kind","Source"]].concat(E.M.map(m=>[m.label,E.fmt(m,E.base[m.id]),KIND[m.kind][0],m.src])).concat([["Water per 1,000 inferences","","No data","No per-region data published"]])));};}
};

/* ---------- My workspace ---------- */
PAGES.work=sub=>{const tabs=WTABS[PERSONA];if(!tabs.some(t=>t[0]===sub)){sub=tabs[0][0];}if(sub==="guided"){return guidedPage();}
  return `<div class="wrap">${phead("My workspace · "+esc(PERS[PERSONA].name),{sites:"My sites",finder:"Expansion finder",backup:"Backup pairing",hubs:"Manage hubs",alerts:"Alerts",assume:"Assumptions",whatif:"Growth what-if",ranking:"Impact ranking"}[sub],{alerts:"Shown in the app only; nothing is emailed. Shared by the team.",assume:"Lever effects and costs with no open source, entered by the team.",hubs:"Places the app scores. Not shown to Policy.",sites:"Your sites, scored on the same eight hazards.",finder:"Rank places for the next block by what matters to you. Higher = better.",backup:"Pair a site with a recovery region that doesn't share its risks.",whatif:"What steady growth would mean for electricity, emissions and water.",ranking:"Where new data centres would do least harm and face least climate risk."}[sub])}
  ${wnav(sub)}${["sites","finder","backup","whatif","ranking"].includes(sub)?ctxBar():""}${WORK[sub]()}</div>`;};
function wnav(sub){return `<nav class="subnav" aria-label="Workspace">${WTABS[PERSONA].map(t=>`<a href="#/work/${t[0]}"${t[0]===sub?' aria-current="page"':""}>${t[1]}</a>`).join("")}</nav>`;}
/* One set of inputs per persona: the guided flow's. Every workspace tab and the Dashboard read and change these (review point 14). */
function ctxBar(){const p=PERSONA,f=runOf(p).f,E=engine(p),h=hub(f.site||f.cand),u=hub(f.users);
  const bits={op:()=>[scenTxt(f.h,f.p)],colo:()=>[f.blk+" MW block",scenTxt(f.h,f.p)],ten:()=>[u?"users near "+u.n:"",f.sla?"latency limit "+f.sla+" ms":""],pol:()=>["+"+nf(+f.mw)+" MW a year","+"+f.yrs+" years"]}[p]().filter(Boolean);
  return `<div class="ctxbar"><span class="k">Working on</span><b>${esc(E.ctx.entity)}${h&&!h.site?", "+esc(h.c):""}</b>${bits.map(b=>`<span>${esc(b)}</span>`).join("")}<span class="go"><a href="#/work/guided" data-ctxedit>Change inputs</a><a class="btn sm" href="#/work/guided">Continue in the guided flow →</a></span></div>`;}
/* "Plan this": make a place or site the one the persona is working on, then open the guided flow. */
const PLANKEY={op:"site",colo:"cand",pol:"hub"};
function planAt(id){const k=PLANKEY[PERSONA];if(!k||!inView(id)||(PERSONA==="pol"&&hub(id).site)){return;}const R=runOf(PERSONA);R.f[k]=id;R.on={};R.submitted=null;R.step=2;save();if(window.STA){STA.event("plan_this",{persona:PERSONA,place:hub(id).site?"site":id});}toast("Working on "+hub(id).n+".");location.hash="#/work/guided";}
document.addEventListener("click",e=>{const b=e.target.closest("[data-plan]");if(b){e.preventDefault();planAt(b.dataset.plan);return;}if(e.target.closest("[data-ctxedit]")){runOf(PERSONA).step=1;save();}});
const WORK={};
let FLEET=null,BK=null,SITEPOLL=null,PICK=null,ALLSMP=null;
async function loadSites(force){
  if(!FLEET||force){try{const j=await (await fetch("/api/sites?persona="+(PERSONA==="pol"?"op":PERSONA))).json();FLEET={sites:j.sites||[],samples:j.samples||[],max:j.max||0};}catch(e){FLEET={sites:[],samples:[],max:0};}
    if(!ALLSMP){try{ALLSMP=(await Promise.all(["op","colo","ten"].map(async q=>((await (await fetch("/api/sites?persona="+q)).json()).samples||[]).map(x=>Object.assign(x,{pp:q}))))).flat();}catch(e){ALLSMP=[];}}
    registerSites();}
  clearTimeout(SITEPOLL);if(FLEET.sites.some(x=>x.state==="building")){SITEPOLL=setTimeout(async()=>{await loadSites(true);if(/^#\/(work\/(sites|backup)|dash)/.test(location.hash)){loadFleet(location.hash.startsWith("#/dash")?"dash":"");}},5000);}
  return FLEET;}
function registerSites(){SITEHUBS.length=0;(FLEET.sites||[]).filter(x=>x.state==="ready"&&x.record&&regionAt(x.lat,x.lon)===SCOPE).forEach(x=>{const id="S"+x.id;
  SITEHUBS.push({id,n:x.name,c:x.country,r:SCOPE,site:true});HZD[id]=Object.assign({},x.record,{lat:x.lat,lon:x.lon});});
  (ALLSMP||[]).filter(x=>x.record).forEach(x=>{SITEHUBS.push({id:x.id,n:x.name,c:x.country,r:SCOPE,site:true,sample:true,pp:x.pp});HZD[x.id]=Object.assign({},x.record,{lat:x.lat,lon:x.lon});});}
function siteGroup(sel){const pp=PERSONA==="pol"?"op":PERSONA,o=h=>`<option value="${h.id}"${h.id===sel?" selected":""}>${esc(h.n)} · ${esc(h.c)}</option>`,t=SITEHUBS.filter(h=>!h.sample),m=SITEHUBS.filter(h=>h.sample&&(h.pp===pp||h.id===sel));
  return (t.length?`<optgroup label="Team sites">${t.map(o).join("")}</optgroup>`:"")+(m.length?`<optgroup label="Example sites (real data centres)">${m.map(o).join("")}</optgroup>`:"");}
async function fleet(){const F=await loadSites();return F.sites.filter(x=>x.record&&regionAt(x.lat,x.lon)===SCOPE).concat(F.samples.filter(x=>x.record));}
WORK.sites=()=>`<div class="row2e"><div class="card" id="fleet"><p class="src"><span class="spin"></span>Loading sites…</p></div>
  <div class="card"><h2>Add a site</h2><p class="sub">One list for the whole team. The site gets its own hazard data from its coordinates, from the same open sources as hubs (about 25 seconds).</p>
  <div class="ctas"><input id="s-q" placeholder="Search a city, e.g. Ambattur, India" aria-label="Search a place" style="min-height:42px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;flex:1"><button class="btn alt sm" type="button" id="s-find">Search</button></div><div id="s-res"></div>
  <p class="src" id="s-place" style="margin-top:8px">${PICK?"Place: "+esc(PICK.place+", "+PICK.country):"No place picked yet."}</p>
  <div class="fields" style="margin-top:8px"><label class="field">Name<input id="s-name" placeholder="e.g. Ambattur hall 3"></label><label class="field">IT capacity (MW) <small>optional</small><input id="s-mw" type="number" min="0" step="any"></label><label class="field">Status<select id="s-status"><option value="existing">Existing</option><option value="planned">Planned</option><option value="candidate">Candidate</option></select></label></div>
  <div class="ctas"><button class="btn" type="button" id="s-add"${PICK?"":" disabled"}>Add site</button></div><div id="s-msg" aria-live="polite"></div></div></div>`;
function coloRank(){const C=S.finder,out=[];C.region=SCOPE;
  withData().forEach(h=>{if(C.region!=="Global"&&h.r!==C.region){return;}if(C.country&&h.c!==C.country){return;}
    const z=HZD[h.id],sc=scoresOf(z,"2050","high"),gc=gcOf(h.id);let num=0,den=0,n=0;
    HZK.forEach((k,i)=>{const w=C.w[k];if(w>0&&sc[i]!=null){num+=w*sc[i];den+=w;n++;}});if(C.w.carbon>0&&gc){num+=C.w.carbon*Math.min(100,gc.g/8);den+=C.w.carbon;}
    if(den&&n>=4){out.push({h,sc,gc,s:100-Math.round(num/den),z,c:comp(sc)});}});
  return out.sort((a,b)=>b.s-a.s);}
WORK.finder=()=>{const C=S.finder;C.region=SCOPE;if(C.country&&!withData().some(h=>h.c===C.country)){C.country="";}const r=coloRank().slice(0,10),cs=[...new Set(withData().filter(h=>C.region==="Global"||h.r===C.region).map(h=>h.c))].sort();
  return `<div class="row2e"><div class="card"><h2>What matters ${info("suit")}</h2><div class="fields" style="margin:10px 0"><label class="field">Country<select id="f-cty"><option value="">Any</option>${cs.map(x=>`<option${x===C.country?" selected":""}>${esc(x)}</option>`).join("")}</select></label><label class="field">Block (MW)<input id="f-mw" type="number" min="1" value="${C.mw}"></label></div>
    <div style="display:grid;gap:8px">${HZK.concat(["carbon"]).map(k=>`<label class="wsl"><span>${k==="carbon"?"Grid carbon":esc(HZ.find(x=>x[0]===k)[1])}</span><input type="range" min="0" max="3" value="${C.w[k]}" data-w="${k}"><b>${["Ignore","Low","Normal","High"][C.w[k]]}</b></label>`).join("")}</div></div>
  <div class="card"><h2>Ranked places</h2><p class="sub">2050, SSP5-8.5 · higher = better</p><div class="tblwrap"><table class="t"><thead><tr><th>#</th><th>Place</th><th>Suitability</th><th>Overall risk</th><th>Grid g/kWh</th><th>t CO₂/yr for ${nf(C.mw)} MW</th>${PERSONA==="colo"?"<th></th>":""}</tr></thead><tbody>${r.map((x,i)=>`<tr${i===0?' class="on"':""}><td>${i+1}</td><td><b>${esc(x.h.n)}</b> <span class="src">${esc(x.h.c)}</span></td><td>${goodPill(x.s)}</td><td>${pill(x.c)}</td><td class="num">${x.gc?x.gc.g:"No data"}</td><td class="num">${x.gc?nf(C.mw*.7*8760*1.5/1000*x.gc.g):"–"}</td>${PERSONA==="colo"?`<td><button class="btn alt sm" type="button" data-plan="${x.h.id}">Plan this →</button></td>`:""}</tr>`).join("")}</tbody></table></div>
  </div></div>`;};
WORK.backup=()=>`<div class="card" id="backup"><p class="src"><span class="spin"></span>Loading sites…</p></div>`;
function pairsFor(base){const psc=scoresOf(base.record,"2050","high"),out=[];withData().forEach(h=>{const z=HZD[h.id],d=km(base.lat,base.lon,z.lat,z.lon);if(d<300||d>3000){return;}const sc=scoresOf(z,"2050","high"),c=comp(sc),sh=HZK.map((k,i)=>i).filter(i=>psc[i]!=null&&sc[i]!=null&&psc[i]>=55&&sc[i]>=55);
  out.push({h,d,c,sh,s:Math.max(0,100-c-15*sh.length-(h.c===base.country?5:0))});});return out.sort((a,b)=>b.s-a.s);}
async function loadFleet(where){const all=await fleet(),F=FLEET,el=$("fleet");
  if(el){const rows=F.sites.map(x=>({s:x,sc:x.record?scoresOf(x.record,"2050","high"):null,out:regionAt(x.lat,x.lon)!==SCOPE})).concat(F.samples.filter(x=>x.record).map(x=>({s:x,sc:scoresOf(x.record,"2050","high")}))).map(r=>Object.assign(r,{c:r.sc?comp(r.sc):null})).sort((a,b)=>(b.c??-1)-(a.c??-1)),
      ready=rows.filter(r=>r.c!=null&&!r.out),mwAt=ready.filter(r=>r.c>=55).reduce((t,r)=>t+(r.s.mw||0),0),mw=ready.reduce((t,r)=>t+(r.s.mw||0),0),dash=where==="dash",smp=F.samples.filter(x=>x.record).length;
    el.innerHTML=`<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline"><h2>${dash?"Fleet risk heatmap":"My sites"} ${info("overall")}</h2><span class="src">${F.sites.length?F.sites.length+" team site"+(F.sites.length===1?"":"s")+" (up to "+F.max+")":"No team sites yet"}${smp?" · "+smp+" example"+(smp===1?"":"s")+" shown":""} · ${ready.filter(r=>r.c>=55).length} of ${ready.length} at High or Severe (2050, SSP5-8.5)${mw?" · "+nf(mwAt)+" of "+nf(mw)+" MW":""}</span></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>Site</th><th>MW</th><th>Overall</th>${HZ.map(hz=>`<th>${esc(hz[1].split(" ")[0])}</th>`).join("")}${dash?"":"<th></th>"}</tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.s.name)}</b>${r.s.sample?' <span class="chip fict">Example · real data centre</span>':""}${r.out?' <span class="chip grey">Outside JAPAC scope</span>':""}<div class="src">${esc(r.s.place||"")}${r.s.operator?" · "+esc(r.s.operator):""}${r.s.link?` · <a href="${esc(r.s.link)}" target="_blank" rel="noopener noreferrer">${esc(r.s.source||"Source")} ↗</a>`:""}</div></td><td class="num">${r.s.mw??"–"}</td>${r.sc?`<td>${pill(r.c)}</td>${r.sc.map(v=>`<td>${pill(v)}</td>`).join("")}`:`<td colspan="9">${r.s.state==="building"?'<span class="spin"></span> Fetching open data for this site…':`<span class="st-no">Data failed</span> <span class="src">${esc(r.s.error||"")}</span>`}</td>`}${dash?"":`<td class="noprint">${r.sc&&!r.out&&(PERSONA==="op"||PERSONA==="colo")?`<button class="btn alt sm" type="button" data-plan="${r.s.sample?esc(r.s.id):"S"+r.s.id}">Plan this →</button> `:""}${r.s.sample?(r.sc?`<a href="#/work/backup" data-bk="${esc(r.s.id)}">Find a backup</a>`:""):`${r.s.state==="failed"?`<button class="btn alt sm" type="button" data-retry="${r.s.id}">Retry</button> `:""}${r.sc?`<a href="#/work/backup" data-bk="${r.s.id}">Find a backup</a> `:""}<button class="btn danger sm" type="button" data-rm="${r.s.id}" data-nm="${esc(r.s.name)}">Remove</button>`}</td>`}</tr>`).join("")}</tbody></table></div><p class="src">Examples are real data centres from OpenStreetMap and PeeringDB, scored at their own coordinates. They aren't the team's sites, and no open source publishes their MW. More in Earth view · <a href="#/earth/dc">Data centres</a>, where any of them can be added as a team site.</p>`;
    el.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>confirmBox("Remove "+b.dataset.nm+"?","It is removed for the whole team, with its alert rules. This can't be undone.","Remove site",async()=>{try{await post("/api/sites/"+b.dataset.rm,{},"DELETE");await loadSites(true);toast("Site removed.");loadFleet(where);}catch(e){toast(e.message);}}));
    el.querySelectorAll("[data-retry]").forEach(b=>b.onclick=async()=>{b.disabled=true;try{await post("/api/sites/"+b.dataset.retry+"/refresh",{});await loadSites(true);loadFleet(where);}catch(e){b.disabled=false;toast(e.message);}});
    el.querySelectorAll("[data-bk]").forEach(a=>a.onclick=()=>{BK=a.dataset.bk;});}
  const ds=$("dsiting");if(ds){const r=coloRank().slice(0,5);ds.innerHTML=`<h2>Siting shortlist ${info("suit")}</h2><p class="sub">${esc(S.finder.region)} · <a href="#/work/finder">open Expansion finder →</a></p><div class="tblwrap"><table class="t"><thead><tr><th>#</th><th>Place</th><th>Suitability</th><th>Risk</th></tr></thead><tbody>${r.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.h.n)}</b> <span class="src">${esc(x.h.c)}</span></td><td>${goodPill(x.s)}</td><td>${pill(x.c)}</td></tr>`).join("")}</tbody></table></div>`;}
  const bx=$("backup");if(bx){if(!all.length){bx.innerHTML='<p class="sub">No sites yet. Add one in My sites.</p>';}else{const base=all.find(s=>String(s.id)===String(BK))||all[0],pr=pairsFor(base).slice(0,6);
    bx.innerHTML=`<h2>Backup pairing ${info("pair")}</h2><label class="field" style="margin:8px 0;max-width:420px">Site to protect<select id="b-site">${all.map(s=>`<option value="${s.id}"${s.id===base.id?" selected":""}>${esc(s.name)}</option>`).join("")}</select></label><div class="tblwrap"><table class="t"><thead><tr><th>Backup</th><th>Pair score</th><th>Distance</th><th>High at both</th></tr></thead><tbody>${pr.map((x,i)=>`<tr${i===0?' class="on"':""}><td><b>${esc(x.h.n)}</b> <span class="src">${esc(x.h.c)}</span></td><td>${goodPill(x.s)}</td><td class="num">${nf(x.d)} km</td><td>${x.sh.length?esc(x.sh.map(k=>HZ[k][1]).join(", ")):'<span class="st-ok">None</span>'}</td></tr>`).join("")}</tbody></table></div><p class="src">300–3,000 km apart, straight-line. 2050, SSP5-8.5.</p>`;
    $("b-site").onchange=e=>{BK=e.target.value;loadFleet();};}}
  wireInfo($("view"));
}
function whatif(P){const z=HZD[P.hub],x=z.extra||{},gc=x.gridCarbon,el=x.electricity,w=entry(z,"water"),slope=gc&&gc.past?(gc.g-gc.past.g)/(gc.year-gc.past.year):null,rows=[];
  for(let y=1;y<=P.years;y++){const it=P.mw*y,gwh=it*.7*8760*1.5/1000;rows.push({y,gwh,held:gc?gwh*gc.g:null,tr:gc&&slope!=null?gwh*Math.max(0,gc.g+slope*y):null,water:it*.7*8760*1000*1.8/1e6});}
  return {rows,gc,el,w,slope};}
WORK.whatif=()=>{const F=runOf("pol").f,P={hub:F.hub,mw:+F.mw||1,years:+F.yrs||20},h=hub(P.hub),r=whatif(P),last=r.rows[r.rows.length-1],share=r.el&&r.el.demandTWh?last.gwh/(r.el.demandTWh*1000)*100:null;
  const Wd=640,H=200,L=56,max=Math.max(...r.rows.map(q=>Math.max(q.held||0,q.tr||0)))||1,X=y=>L+(y-1)/Math.max(1,r.rows.length-1)*(Wd-L-10),Y=v=>10+(1-v/max)*(H-40),pl=k=>r.rows.map(q=>X(q.y).toFixed(1)+","+Y(q[k]||0).toFixed(1)).join(" ");
  return `<div class="card"><div class="fields"><label class="field">Place<select id="w-hub">${hubOpts(P.hub,apac())}</select></label><label class="field">New IT MW a year<input id="w-mw" type="number" min="1" value="${P.mw}"></label><div class="field">Years ahead ${seg([["10","+10"],["20","+20"],["50","+50"]],String(P.years),"data-wy")}</div></div>
  <div class="kpis" style="margin-top:12px"><div class="kpi"><span class="k">Electricity by year ${P.years}${info("whatif")}</span><span class="v">${nf(last.gwh)}<small>GWh/yr</small></span><span class="d">${share!=null?nf(share,2)+"% of "+esc(h.c)+"'s demand ("+r.el.year+")":"No national demand data"}</span></div>
  <div class="kpi"><span class="k">CO₂ by year ${P.years}${info("carbon")}</span><span class="v">${r.gc?nf(Math.min(last.held,last.tr??last.held)/1e6,2)+"–"+nf(Math.max(last.held,last.tr??last.held)/1e6,2):"–"}<small>Mt/yr</small></span><span class="d">${r.gc?"grid held at "+r.gc.g+" g vs last-ten-years trend":"No grid data"}</span></div>
  <div class="kpi"><span class="k">Cooling water by year ${P.years}${info("water")}</span><span class="v">${nf(last.water)}<small>ML/yr</small></span><span class="d">${r.w&&r.w.kind!=="none"?"water stress "+r.w.raw["m50"]+" of 5 by 2050 (Aqueduct)":"No water data"} · WUE 1.8 ${kindB("assume")}</span></div></div>
  <div class="chart" style="margin-top:12px"><svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Yearly CO2 for this growth path">${[0,.5,1].map(f=>`<line class="gl2" x1="${L}" x2="${Wd-10}" y1="${Y(max*f)}" y2="${Y(max*f)}"/><text class="ax" x="${L-6}" y="${Y(max*f)+4}" text-anchor="end">${nf(max*f/1e6,1)}M t</text>`).join("")}<polyline points="${pl("held")}" fill="none" stroke="#1D6B50" stroke-width="2.4"/>${r.slope!=null?`<polyline points="${pl("tr")}" fill="none" stroke="#1D6B50" stroke-width="2" stroke-dasharray="5 4"/>`:""}<text class="ax" x="${L}" y="${H-6}">+1</text><text class="ax" x="${Wd-10}" y="${H-6}" text-anchor="end">+${P.years} years</text></svg><div class="legend"><span>— grid held at today</span><span>- - last-ten-years trend continues</span></div></div>
  <div class="ctas"><button class="btn sm" type="button" id="w-guided">Test policy levers on this in the guided flow →</button></div></div>`;};
WORK.ranking=()=>{const reg="Asia-Pacific",rank=withData().filter(q=>q.r===reg).map(q=>{const zz=HZD[q.id],g2=gcOf(q.id),e2=(zz.extra||{}).electricity,sc=scoresOf(zz,"2050","mod"),gw=100*.7*8760*1.5/1000,sh=e2&&e2.demandTWh?gw/(e2.demandTWh*1000)*100:null,parts=[g2?Math.min(100,g2.g/8):null,sc[2],sh!=null?Math.min(100,sh*20):null].filter(v=>v!=null),imp=parts.length?Math.round(parts.reduce((a,b)=>a+b,0)/parts.length):null,risk=comp(sc);return {q,imp,risk,s:imp!=null&&risk!=null?100-Math.round((imp+risk)/2):null,g:g2};}).filter(r=>r.s!=null).sort((a,b)=>b.s-a.s);
  return `<div class="card"><p class="sub">Per 100 MW (70% load, PUE 1.5). Suitability = 100 − average of impact (grid carbon, water stress, share of national power) and climate risk. Higher is better. ${info("suit")}</p><div class="tblwrap"><table class="t"><thead><tr><th>#</th><th>Place</th><th>Suitability</th><th>Low impact</th><th>Climate safety</th><th>Grid g/kWh</th><th></th></tr></thead><tbody>${rank.map((r,i)=>`<tr${i===0?' class="on"':""}><td>${i+1}</td><td><b>${esc(r.q.n)}</b> <span class="src">${esc(r.q.c)}</span></td><td>${goodPill(r.s)}</td><td class="num">${100-r.imp}</td><td class="num">${100-r.risk}</td><td class="num">${r.g?r.g.g:"–"}</td><td><button class="btn alt sm" type="button" data-plan="${r.q.id}">Plan this →</button></td></tr>`).join("")}</tbody></table></div></div>`;};
PAGES.work.after=sub=>{const v=$("view"),tabs=WTABS[PERSONA];if(!tabs.some(t=>t[0]===sub)){sub=tabs[0][0];}if(sub==="guided"){guidedAfter();return;}
  if(sub==="sites"||sub==="backup"){loadFleet();}
  if(sub==="hubs"){hubsAfter();}
  if(sub==="sites"){
    $("s-find").onclick=async()=>{const q=$("s-q").value.trim(),o=$("s-res");o.innerHTML='<p class="src"><span class="spin"></span>Searching…</p>';try{const r=await fetch("/api/places?q="+encodeURIComponent(q)),j=await r.json();if(!r.ok){throw new Error(j.error);}
      o.innerHTML=(j.results||[]).length?`<div class="exs">${j.results.map((x,i)=>`<button type="button" data-r="${i}"${x.region&&x.region!==SCOPE?" disabled":""}>${esc(x.name)}${x.admin1?", "+esc(x.admin1):""}, ${esc(x.country)}${x.region&&x.region!==SCOPE?" · outside JAPAC":""}</button>`).join("")}</div>`:'<p class="src">No match. Try "City, Country".</p>';
      o.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{const x=j.results[+b.dataset.r];PICK={place:x.name+(x.admin1?", "+x.admin1:""),country:x.country,iso2:x.iso2,iso3:x.iso3,lat:x.lat,lon:x.lon};$("s-place").textContent="Place: "+PICK.place+", "+PICK.country+" ("+x.lat+", "+x.lon+")";$("s-add").disabled=false;if(!$("s-name").value){$("s-name").value=x.name+" site";}});}
      catch(e){o.innerHTML=`<p class="src">${esc(e.message||"The place search is unavailable right now.")}</p>`;}};
    $("s-q").onkeydown=e=>{if(e.key==="Enter"){$("s-find").click();}};
    $("s-add").onclick=async()=>{const b=$("s-add");if(!PICK){return;}b.disabled=true;try{await post("/api/sites",Object.assign({name:$("s-name").value.trim(),mw:$("s-mw").value,status:$("s-status").value},PICK));PICK=null;await loadSites(true);if(window.STA){STA.event("add_team_site",{from:"search"});}toast("Site added. Fetching its open data (about 25 seconds).");route();}
      catch(e){b.disabled=false;$("s-msg").innerHTML=`<div class="note bad" style="margin-top:8px">${esc(e.message)}</div>`;}};}
  if(sub==="assume"){assumeAfter();}
  if(sub==="alerts"){alertsAfter();}
  if(sub==="finder"){const C=S.finder,on=(id,fn)=>{const e=$(id);if(e){e.onchange=fn;}};on("f-reg",e=>{C.region=e.target.value;C.country="";save();route();});on("f-cty",e=>{C.country=e.target.value;save();route();});on("f-mw",e=>{C.mw=Math.max(1,+e.target.value||100);save();route();});
    v.querySelectorAll("input[data-w]").forEach(s=>s.oninput=()=>{C.w[s.dataset.w]=+s.value;save();clearTimeout(s._t);s._t=setTimeout(route,150);});
    }
  if(sub==="whatif"){const R=runOf("pol"),F=R.f,ch=()=>{R.on={};R.submitted=null;save();route();};$("w-hub").onchange=e=>{F.hub=e.target.value;ch();};$("w-mw").onchange=e=>{F.mw=Math.max(1,+e.target.value||1);ch();};v.querySelectorAll("[data-wy]").forEach(b=>b.onclick=()=>{F.yrs=b.dataset.wy;ch();});
    $("w-guided").onclick=()=>{R.step=3;save();location.hash="#/work/guided";};}
};

/* ---------- Alerts (team-wide, in the app only) ---------- */
let AL=null,ALMSG="",ALPOLL=null;
async function loadAlerts(){try{const r=await fetch("/api/alerts");if(r.ok){AL=await r.json();}}catch(e){}alertBadge();return AL;}
function alertBadge(){const a=document.querySelector('#nav a[data-r="work"]');if(!a){return;}let b=a.querySelector(".nbadge");
  if(!AL||!AL.unread){if(b){b.remove();}a.removeAttribute("aria-label");return;}
  if(!b){b=document.createElement("span");b.className="nbadge";b.setAttribute("aria-hidden","true");a.appendChild(b);}b.textContent=AL.unread>99?"99+":AL.unread;a.setAttribute("aria-label","My workspace, "+AL.unread+" unread alert"+(AL.unread===1?"":"s"));}
const follows=id=>!!(AL&&AL.places.some(x=>x.kind==="hub"&&x.ref===id));
const ago=t=>{const s=(Date.now()/1000-t);return s<90?"just now":s<3600?Math.round(s/60)+" min ago":s<86400?Math.round(s/3600)+" h ago":new Date(t*1000).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});};
WORK.alerts=()=>`<div class="row2"><div class="card" id="al-watch"><p class="src"><span class="spin"></span>Loading…</p></div><div class="card" id="al-list"></div></div>`;
function alertsRender(){const w=$("al-watch"),l=$("al-list");if(!w||!AL){return;}const M=AL.metrics,mk=Object.keys(M);
  const free=withData().filter(h=>!follows(h.id)).sort((a,b)=>a.n.localeCompare(b.n));
  w.innerHTML=`<h2>What the team follows</h2><p class="sub">The team's sites are followed automatically once their data is built. Follow hubs here. An alert comes when a place's overall risk band changes (today, or 2050 high emissions) after its data is updated, or when a live reading passes a limit you set. Live limits are checked every ${AL.minutes} minutes; each fires at most once every 12 hours.</p>
    ${ALMSG?`<div class="note bad" style="margin-top:8px">${esc(ALMSG)}</div>`:""}
    <div class="ctas"><select id="al-hub" aria-label="Hub to follow" style="min-height:40px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;flex:1"><option value="">Follow a hub…</option>${free.map(h=>`<option value="${h.id}">${esc(h.n)} · ${esc(h.c)}</option>`).join("")}</select><button class="btn alt sm" type="button" id="al-follow">Follow</button></div>
    ${AL.places.length?AL.places.map(x=>`<div class="alplace"><div class="alhead"><div><b>${esc(x.name)}</b> <span class="chip grey">${x.kind==="hub"?"Hub":"Team site"}</span></div>${x.kind==="hub"?`<button class="btn alt sm" type="button" data-unwatch="${esc(x.ref)}" data-nm="${esc(x.name)}" data-n="${x.rules.length}">Stop following</button>`:""}</div>
      ${x.rules.length?`<ul class="alrules">${x.rules.map(r=>{const m=M[r.metric]||{label:r.metric,unit:""};return `<li><span>${esc(m.label)} ≥ <b>${nf(r.threshold,1)} ${esc(m.unit)}</b>${r.last_value!=null?` <span class="src">· last reading ${nf(r.last_value,1)} ${esc(m.unit)}${r.last_checked?", "+ago(r.last_checked):""}</span>`:'<span class="src"> · not checked yet</span>'}</span><button class="btn danger sm" type="button" data-rdel="${r.id}" aria-label="Remove this limit">Remove</button></li>`;}).join("")}</ul>`:""}
      <div class="aladd" data-kind="${x.kind}" data-ref="${esc(x.ref)}"><select aria-label="Live reading for ${esc(x.name)}">${mk.map(k=>`<option value="${k}">${esc(M[k].label)} (${esc(M[k].unit)})</option>`).join("")}</select><input inputmode="decimal" placeholder="${esc(M[mk[0]].hint)}" aria-label="Limit for ${esc(x.name)}"><button class="btn alt sm" type="button" data-radd>Add limit</button></div></div>`).join(""):'<p class="src" style="margin-top:10px">Nothing followed yet. Follow a hub above, or add sites in My sites.</p>'}`;
  l.innerHTML=`<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline"><h2>Alerts <span class="src">${AL.unread} unread</span></h2><div class="ctas" style="margin:0"><button class="btn alt sm" type="button" id="al-check">Check now</button><button class="btn alt sm" type="button" id="al-readall"${AL.unread?"":" disabled"}>Mark all read</button></div></div>
    ${AL.alerts.length?`<div class="alist">${AL.alerts.map(a=>`<div class="alitem${a.read?"":" unread"}"><div><b>${esc(a.title)}</b><p>${esc(a.detail)}</p><span class="src">${a.kind==="live"?"Live reading":"Data update"} · ${esc(ago(a.created))}</span></div>${a.read?"":`<button class="btn alt sm" type="button" data-read="${a.id}">Mark read</button>`}</div>`).join("")}</div>`:'<p class="src" style="margin-top:10px">No alerts yet. They appear here when a followed place changes risk band or passes a limit.</p>'}`;
  alertsWire();}
async function alAct(promise){ALMSG="";try{AL=await promise;}catch(e){ALMSG=e.message;}alertBadge();alertsRender();}
function alertsWire(){const v=$("view");
  $("al-follow").onclick=()=>{const id=$("al-hub").value;if(id){alAct(post("/api/watch",{hub:id,on:true}));}};
  v.querySelectorAll("[data-unwatch]").forEach(b=>b.onclick=()=>{const go=()=>alAct(post("/api/watch",{hub:b.dataset.unwatch,on:false}));if(+b.dataset.n){confirmBox("Stop following "+b.dataset.nm+"?","Its "+b.dataset.n+" live limit"+(b.dataset.n==="1"?"":"s")+" will be removed too.","Stop following",go);}else{go();}});
  v.querySelectorAll("[data-rdel]").forEach(b=>b.onclick=()=>alAct(post("/api/alerts/rules/"+b.dataset.rdel,{},"DELETE")));
  v.querySelectorAll(".aladd").forEach(box=>{const sel=box.querySelector("select"),inp=box.querySelector("input");sel.onchange=()=>{inp.placeholder=(AL.metrics[sel.value]||{}).hint||"";};
    const add=()=>alAct(post("/api/alerts/rules",{kind:box.dataset.kind,ref:box.dataset.ref,metric:sel.value,threshold:inp.value}));box.querySelector("[data-radd]").onclick=add;inp.onkeydown=e=>{if(e.key==="Enter"){add();}};});
  v.querySelectorAll("[data-read]").forEach(b=>b.onclick=()=>alAct(post("/api/alerts/read",{ids:[+b.dataset.read]})));
  const ra=$("al-readall");if(ra){ra.onclick=()=>alAct(post("/api/alerts/read",{}));}
  const ck=$("al-check");if(ck){ck.onclick=async()=>{ck.disabled=true;ck.innerHTML='<span class="spin"></span>Checking…';await alAct(post("/api/alerts/check",{}));toast("Checked the followed places.");};}}
function alertsAfter(){if(AL){alertsRender();}loadAlerts().then(alertsRender);}

let AF="mine",AE=null;
WORK.assume=()=>{const list=ASSUME.filter(a=>AF==="all"||a.p===PERSONA);
  return `<div class="card"><div class="controls" style="margin-bottom:10px">${seg([["mine",PERS[PERSONA].name+" levers"],["all","All personas"]],AF,"data-af")}</div>
  <p class="sub">These have no open data source, so they start blank, and blank counts as zero: a lever with nothing entered does nothing in the guided flow, and cost targets are left out until costs exist. Each value needs your name and where it comes from, and every change is logged. ${info("assume")}</p>
  <div class="tblwrap" style="margin-top:10px"><table class="t"><thead><tr><th>Lever</th><th>What</th><th>Value</th><th>Entered by</th><th></th></tr></thead><tbody>${list.map(a=>{const cur=AS[a.key];return `<tr${AE===a.key?' class="on"':""}><td>${AF==="all"?pTag(a.p)+"<br>":""}<b>${esc(a.lever)}</b></td><td>${esc(a.what)}<div class="src">${esc(a.unit)}</div></td><td class="num">${cur?`<b>${nf(cur.value,3)}</b>`:'<span class="chip grey">Blank</span>'}</td><td class="src">${cur?esc(cur.by)+" · "+new Date(cur.at*1000).toLocaleDateString()+"<br>“"+esc(cur.note)+"”":"–"}</td><td><button class="btn alt sm" type="button" data-ae="${a.key}">${cur?"Change":"Enter"}</button></td></tr>${AE===a.key?`<tr class="on"><td colspan="5"><div class="fields"><label class="field">Value <small>${esc(a.unit)}; leave empty to clear</small><input id="a-val" type="number" step="any" value="${cur?cur.value:""}"></label><label class="field">Where it comes from<input id="a-note" placeholder="e.g. Vendor quote, March 2026"></label><label class="field">Your name<input id="a-by" value="${esc(S.approver)}" autocomplete="name"></label></div><div class="ctas"><button class="btn sm" type="button" id="a-save">Save</button><button class="btn alt sm" type="button" id="a-cancel">Cancel</button></div><div id="a-msg" aria-live="polite"></div></td></tr>`:""}`;}).join("")}</tbody></table></div></div>
  <div class="card" style="margin-top:16px"><h2>Change log</h2>${ASLOG.length?`<div class="tblwrap"><table class="t"><tbody>${ASLOG.slice(0,40).map(l=>{const a=ASSUME.find(x=>x.key===l.key)||{lever:l.key,what:""};return `<tr><td class="src">${new Date(l.at*1000).toLocaleString()}</td><td>${esc(a.lever)} · ${esc(a.what)}</td><td class="num">${l.value==null?"cleared":nf(l.value,3)}</td><td class="src">${esc(l.by)} · “${esc(l.note)}”</td></tr>`;}).join("")}</tbody></table></div>`:'<p class="sub">Nothing entered yet.</p>'}</div>`;};
function assumeAfter(){const v=$("view");
  v.querySelectorAll("[data-af]").forEach(b=>b.onclick=()=>{AF=b.dataset.af;AE=null;route();});
  v.querySelectorAll("[data-ae]").forEach(b=>b.onclick=()=>{AE=b.dataset.ae;route();const i=$("a-val");if(i){i.focus();}});
  const c=$("a-cancel");if(c){c.onclick=()=>{AE=null;route();};}
  const sv=$("a-save");if(sv){sv.onclick=async()=>{S.approver=($("a-by").value||"").trim();save();sv.disabled=true;
    try{const j=await post("/api/assumptions",{key:AE,value:$("a-val").value,note:$("a-note").value,by:S.approver},"PUT");AS=j.items||{};ASLOG=j.log||[];applyAssumptions();toast("Saved for the whole team.");AE=null;route();}
    catch(e){sv.disabled=false;$("a-msg").innerHTML=`<div class="note bad" style="margin-top:8px">${esc(e.message)}</div>`;}};}}

/* ---------- Earth view ---------- */
let EV={reg:"Asia-Pacific",mode:"after",sel:null,h:"2050",p:"high"};
const REGBOX=reg=>{if(reg==="Global"){return [0,0,1000,520];}const hs=withData().filter(h=>h.r===reg),xs=hs.map(h=>h.x),ys=hs.map(h=>h.y),pad=40,x0=Math.min(...xs)-pad,y0=Math.min(...ys)-pad;return [x0,y0,Math.max(...xs)+pad-x0,Math.max(...ys)+pad-y0];};
const earthView=()=>{const ha=hazAfter(PERSONA);if(ha&&PAGES.earth._synced!==PERSONA){const f=runOf(PERSONA).f;EV.h=f.h;EV.p=f.p;PAGES.earth._synced=PERSONA;}const b=REGBOX(EV.reg),gs=Math.max(4,b[2]/70),focus=EV.sel||(ha?ha.hub:engine(PERSONA).ctx.hubId);
  const g=withData().filter(h=>EV.reg==="Global"||h.r===EV.reg).map(h=>{const sc=scoresOf(HZD[h.id],EV.h,EV.p),af=EV.mode==="after"&&ha&&ha.after&&h.id===ha.hub&&EV.h===runOf(PERSONA).f.h&&EV.p===runOf(PERSONA).f.p?ha.after:null;
    return `<g class="hubg${h.id===focus?" sel":""}" tabindex="0" role="button" data-h="${h.id}" aria-label="${esc(h.n)}, overall ${comp(af||sc)}" transform="translate(${h.x} ${h.y}) scale(${gs/100})"><circle r="105" fill="#fff" fill-opacity=".7" stroke="#9FB4A8" stroke-width="3"/>${petals(sc,af,100,false)}</g>${h.id===focus?`<text class="lbl" x="${h.x}" y="${h.y+gs*1.25}" text-anchor="middle" style="font-size:${gs*.75}px">${esc(h.n)}</text>`:""}`;}).join("");
  return `<div class="wrap">${phead("Earth view","Hazard exposure, before and after your plan",`Each place is a glyph, one petal per hazard. ${ha?"In “After plan”, the place in your "+esc(PERS[PERSONA].name)+" run shows the plan's effect inside a dashed outline (same horizon only).":"Plans for this persona don't change hazards, so the map shows exposure only."} ${info("classes")}`)}${enav("view")}<div class="controls" style="margin-bottom:12px">${seg([["today","Today"],["2030","2030"],["2050","2050"]],EV.h,"data-eh")+seg([["mod","SSP2-4.5"],["high","SSP5-8.5"]],EV.p,"data-ep")+(ha?seg([["before","Before"],["after","After plan"]],EV.mode,"data-mode"):"")}</div>
   <div class="earthwrap"><div class="card map" style="padding:10px"><svg viewBox="${b.join(" ")}" role="group" aria-label="Map of places"><path class="sph" d="${MAP.sphere}"/><path class="grat" d="${MAP.grat}"/><path class="land" d="${MAP.land}"/><path class="bord" d="${MAP.borders}"/>${g}</svg><div class="legend">${HZ.map(hz=>`<span><span class="dot" style="background:var(${hz[2]})"></span>${esc(hz[1])}</span>`).join("")}</div></div><div class="card" id="eside"></div></div></div>`;};
function earthSide(id){const h=hub(id),z=HZD[id],sc=scoresOf(z,EV.h,EV.p),ha=hazAfter(PERSONA),af=EV.mode==="after"&&ha&&ha.after&&id===ha.hub&&EV.h===runOf(PERSONA).f.h&&EV.p===runOf(PERSONA).f.p?ha.after:null,x=z.extra||{},sl=x.seaLevel;
  $("eside").innerHTML=`<span class="eyebrow">${esc(h.c)} · ${esc(h.r)}</span><h2 style="margin-top:4px">${esc(h.n)}</h2><p class="sub">${scenTxt(EV.h,EV.p)}</p><div style="display:flex;gap:10px;align-items:baseline;margin:8px 0"><span style="font-family:var(--disp);font-size:34px;font-weight:600">${comp(sc)}${af&&comp(af)!==comp(sc)?" → "+comp(af):""}</span>${pill(comp(af||sc))}</div>
    <div class="petalbox">${petalSvg(sc,af,"Hazard petals for "+h.n)}</div>${af?petLegend():""}
    <ul class="src" style="padding-left:18px">${sl?`<li>Sea level at nearest tide gauge (${sl.km} km): +${sl[EV.p==="mod"?"mod":"high"]["2050"].mid} cm by 2050 ${info("sea")}</li>`:"<li>No tide gauge within 30 km.</li>"}${x.gridCarbon?`<li>Grid ${x.gridCarbon.g} g CO₂/kWh (${x.gridCarbon.year})</li>`:""}${dcAt(z)!=null||x.facilities?`<li>${dcLabel(z)} data centres within 50 km (OpenStreetMap, PeeringDB) · <a href="#/earth/dc" id="e-dc">see them</a></li>`:""}</ul>
    <div class="ctas"><button class="btn alt sm" type="button" id="e-live">Conditions now</button><button class="btn alt sm" type="button" id="e-news">Recent events</button><a class="btn alt sm" href="#/earth/place" id="e-detail">Place detail →</a></div><div id="e-out" aria-live="polite" style="margin-top:10px"></div>`;
  wireInfo($("eside"));
  $("e-live").onclick=()=>showLive(id,$("e-out"));$("e-news").onclick=()=>showNews(id,$("e-out"));$("e-detail").onclick=()=>{MV.sel=id;};
}
async function showLive(id,o){o.innerHTML='<p class="src"><span class="spin"></span>Fetching live readings…</p>';try{const j=await (await fetch("/api/live/"+id)).json();o.innerHTML=`<table class="t"><tbody>${(j.items||[]).map(it=>`<tr><td>${esc(it.label)}</td><td><b>${it.status==="ok"?esc(it.value)+" "+esc(it.unit):esc(it.status==="off"?"Not configured":it.status==="none"?"No data":"Unavailable")}</b><div class="src">${esc(it.detail||"")} ${esc(it.source||"")}</div></td></tr>`).join("")}</tbody></table>`;}catch(e){o.innerHTML='<p class="src">Live readings are unavailable right now.</p>';}}
async function showNews(id,o){o.innerHTML='<p class="src"><span class="spin"></span>Checking GDACS, NASA EONET and feeds…</p>';try{const r=await fetch("/api/context",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hub:id})});const j=await r.json();if(!r.ok){throw new Error(j.error);}o.innerHTML=((j.points||[]).length?`<ul>${j.points.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"")+((j.items||[]).length?`<ol class="src" style="padding-left:18px">${j.items.slice(0,6).map(it=>`<li>${it.url?`<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>`:esc(it.title)} · ${esc((it.date||"").slice(0,10))} · ${esc(it.source)}${it.km!=null?" · "+it.km+" km":""}</li>`).join("")}</ol>`:'<p class="src">Nothing in the last 180 days.</p>');}catch(e){o.innerHTML=`<p class="src">${esc(e.message||"Feeds unavailable.")}</p>`;}}
const earthAfter=()=>{const v=$("view");
  v.querySelectorAll("[data-reg]").forEach(b=>b.onclick=()=>{EV.reg=b.dataset.reg;route();});v.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{EV.mode=b.dataset.mode;route();});
  v.querySelectorAll("[data-eh]").forEach(b=>b.onclick=()=>{EV.h=b.dataset.eh;route();});v.querySelectorAll("[data-ep]").forEach(b=>b.onclick=()=>{EV.p=b.dataset.ep;route();});
  v.querySelectorAll(".hubg").forEach(g=>{const pick=()=>{EV.sel=g.dataset.h;v.querySelectorAll(".hubg").forEach(x=>x.classList.toggle("sel",x===g));earthSide(g.dataset.h);};g.onclick=pick;g.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick();}};});
  const ha=hazAfter(PERSONA);earthSide(EV.sel||(ha?ha.hub:engine(PERSONA).ctx.hubId));};

/* ---------- Impact ---------- */
PAGES.impact=()=>{const E=engine(PERSONA),R=E.R,v=E.finalV,ha=hazAfter(PERSONA);
  const kp=m=>{const b=E.base[m.id],a=v[m.id],d=(a??0)-(b??0),better=m.dir==="lower"?d<0:d>0;return `<div class="kpi"><span class="k">${esc(m.label)}${info(m.g)}</span><span class="v">${E.fmt(m,b)} → ${E.fmt(m,a)}</span><span class="d">${Math.abs(d)<1e-9?"no change":`<span class="${better?"good":"badc"}">${d<0?"▼":"▲"} ${nf(Math.abs(d),m.dec!=null?m.dec:1)} ${better?"better":"worse"}</span>`} · ${E.pass(m,a)?'<span class="pass">meets target</span>':'<span class="fail">misses target</span>'}</span></div>`;};
  return `<div class="wrap">${phead("Impact · "+esc(PERS[PERSONA].name),"What the "+(R.choice==="best"?"AI best fit":"chosen plan")+" does for "+esc(E.ctx.entity),esc(E.names(E.final))+(R.submitted?" · sent as "+R.submitted:" · not sent yet"),'<a class="btn alt sm" href="#/work/guided">Change the plan</a><button class="btn alt sm" type="button" id="i-csv">Download CSV</button><button class="btn sm" type="button" id="i-print">Print or save as PDF</button><button class="btn alt sm" type="button" id="i-sheets">Export to Google Sheets</button><button class="btn alt sm" type="button" id="i-docs">'+(PERSONA==="pol"?"Create policy brief in Google Docs":"Create brief in Google Docs")+'</button><span class="src" id="i-gout" aria-live="polite"></span>')}
  ${E.finalOn.length?"":'<div class="note warn" style="margin-bottom:12px">No levers chosen yet, so before and after are the same. Pick levers in the guided flow, or open the dashboard\'s AI recommendation.</div>'}
  <section class="kpis">${E.M.map(kp).join("")}</section>
  <div class="row2" style="margin-top:16px"><div class="card"><h2>Before vs after</h2><div class="tblwrap"><table class="t"><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Target</th><th></th><th>Kind</th></tr></thead><tbody>${metricRows(E,v,true)}</tbody></table></div>
    <h3 style="margin-top:12px">Levers</h3><ul class="src">${E.finalOn.map(l=>`<li><b>${esc(l.name)}</b> · ${{nore:"no-regret",trade:"trade-off",mal:"maladaptation risk"}[E.klass(l)]}</li>`).join("")||"<li>None</li>"}</ul></div>
   <div class="card"><h2>${ha?"Hazard exposure":"Method"}</h2>${ha&&ha.after?`<div class="petalbox">${petalSvg(ha.before,ha.after,"Before and after")}</div>${petLegend()}`:ha?'<p class="sub">The plan moves the build to another place; see both on the Earth view.</p>':""}
    <ul class="src"><li>Measured values come from the open data sources; Your data from your files or inputs.</li><li>Assumptions (lever effects with no open source) are marked and never presented as data.</li><li>Percentage cuts compound. ${info("compound")}</li>${E.ctx.nodata.map(n=>`<li>Left out: ${esc(n[0])} (${esc(n[1])})</li>`).join("")}</ul></div></div></div>`;};
PAGES.impact.after=()=>{$("i-print").onclick=()=>{if(window.STA){STA.event("export",{format:"pdf"});}window.print();};
  /* Google Sheets / Docs export (public/gexport.js): the same rows as Download CSV. */
  if(window.GEXPORT){GEXPORT.wire(()=>{const E=engine(PERSONA),R=E.R,v=E.finalV,KL={nore:"no-regret",trade:"trade-off",mal:"maladaptation risk"};
    return {pol:PERSONA==="pol",persona:PERS[PERSONA].name,entity:E.ctx.entity,plan:E.names(E.final),best:R.choice==="best",status:R.submitted?"sent as "+R.submitted:"not sent yet",when:new Date(),
      head:["Metric","Before","After","Target","Meets","Kind","Source"],
      rows:E.M.map(m=>[m.label,E.fmt(m,E.base[m.id]),E.fmt(m,v[m.id]),E.fmt(m,m.target),E.pass(m,v[m.id])?"yes":"no",KIND[m.kind][0],m.src]),
      metBefore:E.M.filter(m=>E.pass(m,E.base[m.id])).length,levers:E.finalOn.map(l=>[l.name,KL[E.klass(l)]||""]),nodata:E.ctx.nodata.map(n=>[n[0],n[1]])};},toast);}
  $("i-csv").onclick=()=>{if(window.STA){STA.event("export",{format:"csv"});}const E=engine(PERSONA);download("impact-"+PERSONA+".csv",csv([["# Adaptation Strategist impact export, "+new Date().toLocaleString()],["# "+PERS[PERSONA].name+" · "+E.ctx.entity+" · "+E.names(E.final)],["Metric","Before","After","Target","Meets","Kind","Source"]].concat(E.M.map(m=>[m.label,E.fmt(m,E.base[m.id]),E.fmt(m,E.finalV[m.id]),E.fmt(m,m.target),E.pass(m,E.finalV[m.id])?"yes":"no",KIND[m.kind][0],m.src]))));};};

/* ---------- Manage hubs (all but Policy) ---------- */
let HF={region:"Asia-Pacific"};
WORK.hubs=()=>{const list=withData().concat(HUBS.filter(h=>!HZD[h.id]&&inScope(h))).sort((a,b)=>a.n.localeCompare(b.n));
  return `<div class="controls" style="margin-bottom:12px"><span class="src">${list.length} Asia-Pacific hubs. ${HUBSLOCKED?'<b>Editing is switched off on this public demo</b>, so the shared hub list stays intact for everyone. Every hub and its data is still shown.':'Fully open in the app (decision 1): keep the server on the internal network.'}</span></div>
  <div class="row2e"><div class="card"><h2 id="h-title">Add a hub</h2><p class="sub">Search a city to fill the details, then check it. Saving runs the data jobs for the new place (about 25 seconds).</p>
   <div class="ctas"><input id="h-q" placeholder="e.g. Kochi, India" style="min-height:42px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;flex:1" aria-label="City"><button class="btn alt sm" type="button" id="h-find">Search</button></div><div id="h-res"></div>
   <div class="hubform"><label class="field">ID (3–4 letters)<input id="h-id" maxlength="4"></label><label class="field">Name<input id="h-name"></label><label class="field">Country<input id="h-country"></label><label class="field">Region<select id="h-region"><option>${SCOPE}</option></select></label><label class="field">Latitude<input id="h-lat" type="number" step="0.01"></label><label class="field">Longitude<input id="h-lon" type="number" step="0.01"></label><label class="field">ISO3<input id="h-iso3" maxlength="3"></label><label class="field">ISO2<input id="h-iso2" maxlength="2"></label></div>
   <div class="ctas"><button class="btn alt" type="button" id="h-check">Check</button><button class="btn" type="button" id="h-save">Save and build data</button><button class="btn alt" type="button" id="h-clear">Clear form</button></div><div id="h-msg" aria-live="polite"></div>
   <div class="locked" style="margin-top:10px">No login: anyone who can open the app can change hubs. Keep the server on the internal network.</div></div>
  <div class="card"><h2>Hubs <span class="src">${list.length}</span></h2><div class="tblwrap"><table class="t"><thead><tr><th>ID</th><th>Place</th><th>Hazards with data</th><th>Overall 2050</th><th>Grid g/kWh</th><th></th></tr></thead><tbody>${list.map(h=>{const z=HZD[h.id],sc=z?scoresOf(z,"2050","high"):[];return `<tr><td class="num">${h.id}</td><td><b>${esc(h.n)}</b> <span class="src">${esc(h.c)}</span></td><td class="num">${z?sc.filter(x=>x!=null).length+" of 8":'<span class="src">Building</span>'}</td><td>${z?pill(comp(sc)):"–"}</td><td class="num">${(gcOf(h.id)||{}).g||"–"}</td><td class="noprint"><button class="btn alt sm" type="button" data-hedit="${h.id}">Edit</button> <button class="btn danger sm" type="button" data-hrm="${h.id}" data-nm="${esc(h.n)}">Remove</button></td></tr>`;}).join("")}</tbody></table></div></div></div>
  <div class="card" style="margin-top:16px" id="feeds"><h2>News feeds</h2><p class="src"><span class="spin"></span>Loading…</p></div>`;};
PAGES.hubs=()=>{setTimeout(()=>location.replace("#/work/hubs"));return "";};
PAGES.guided=()=>{setTimeout(()=>location.replace("#/work/guided"));return "";};
PAGES.rules=()=>{setTimeout(()=>location.replace("#/glossary/rules"));return "";};
PAGES.approvals=()=>{setTimeout(()=>location.replace("#/work/guided"));return "";};
function hubsAfter(){const v=$("view");v.querySelectorAll("[data-hr]").forEach(b=>b.onclick=()=>{HF.region=b.dataset.hr;route();});
  const fill=r=>{if(r.region&&r.region!==SCOPE){toast(r.name+", "+r.country+" is outside the JAPAC scope: only Asia-Pacific hubs can be added.");return;}$("h-name").value=r.name;$("h-country").value=r.country;$("h-lat").value=r.lat;$("h-lon").value=r.lon;$("h-iso3").value=r.iso3;$("h-iso2").value=r.iso2;$("h-id").value=(r.name||"").replace(/[^A-Za-z]/g,"").slice(0,3).toUpperCase();};
  $("h-find").onclick=async()=>{const q=$("h-q").value.trim(),o=$("h-res");o.innerHTML='<p class="src"><span class="spin"></span>Searching…</p>';try{const r=await fetch("/api/admin/lookup?q="+encodeURIComponent(q)),j=await r.json();if(!r.ok){throw new Error(j.error);}
    o.innerHTML=(j.results||[]).length?`<div class="exs">${j.results.map((x,i)=>`<button type="button" data-r="${i}"${x.region&&x.region!==SCOPE?" disabled":""}>${esc(x.name)}${x.admin1?", "+esc(x.admin1):""}, ${esc(x.country)}${x.region&&x.region!==SCOPE?" · outside JAPAC":""}</button>`).join("")}</div>`:'<p class="src">No match.</p>';o.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>fill(j.results[+b.dataset.r]));}
    catch(e){o.innerHTML=`<p class="src">${esc(e.message||"Search unavailable.")}</p>`;}};
  let MODE="add";
  const body=extra=>Object.assign({mode:MODE,id:$("h-id").value.trim().toUpperCase(),name:$("h-name").value.trim(),country:$("h-country").value.trim(),region:$("h-region").value,lat:+$("h-lat").value,lon:+$("h-lon").value,iso3:$("h-iso3").value.trim(),iso2:$("h-iso2").value.trim()},extra||{});
  const reloadNote=t=>`<div class="note" style="margin-top:8px">${t} <button class="btn sm" type="button" id="h-reload">Reload the app</button></div>`;
  const wireReload=()=>{const b=$("h-reload");if(b){b.onclick=()=>location.reload();}};
  $("h-check").onclick=async()=>{const o=$("h-msg");o.innerHTML='<p class="src"><span class="spin"></span>Checking…</p>';try{const j=await post("/api/admin/hubs",body({preview:true}));o.innerHTML=`<div class="note" style="margin-top:8px">Ready to ${MODE==="edit"?"save":"add"} as <b>${esc(j.id)}</b>. Nothing was saved yet.${(j.warnings||[]).map(w=>"<br>"+esc(w)).join("")}</div>`;}catch(e){o.innerHTML=`<div class="note bad" style="margin-top:8px">${esc(e.message)}</div>`;}};
  $("h-save").onclick=async()=>{const o=$("h-msg"),b=$("h-save");b.disabled=true;o.innerHTML='<p class="src"><span class="spin"></span>Saving and fetching open data for this place (about 25 seconds)…</p>';
    try{const j=await post("/api/admin/hubs",body());const bw=j.build||{};o.innerHTML=reloadNote(`Saved <b>${esc(j.id)}</b>. ${bw.ok?"Its data is built.":"Saved, but the data build had a problem: "+esc(bw.error||"")}${(bw.warnings||[]).length?"<br>"+bw.warnings.map(esc).join("<br>"):""}<br>Reload to see it across the app.`);wireReload();}
    catch(e){o.innerHTML=`<div class="note bad" style="margin-top:8px">${esc(e.message)}</div>`;}b.disabled=false;};
  $("h-clear").onclick=()=>{MODE="add";["h-id","h-name","h-country","h-lat","h-lon","h-iso3","h-iso2"].forEach(i=>{$(i).value="";});$("h-id").readOnly=false;$("h-title").textContent="Add a hub";$("h-msg").innerHTML="";};
  let HL=null;
  v.querySelectorAll("[data-hedit]").forEach(b=>b.onclick=async()=>{try{if(!HL){HL=(await (await fetch("/api/admin/hubs")).json()).hubs||[];}const x=HL.find(q=>q.id===b.dataset.hedit);if(!x){toast("That hub isn't on the server any more.");return;}
    MODE="edit";$("h-id").value=x.id;$("h-id").readOnly=true;$("h-name").value=x.name;$("h-country").value=x.country;$("h-region").value=x.region;$("h-lat").value=x.lat;$("h-lon").value=x.lon;$("h-iso3").value=x.iso3||"";$("h-iso2").value=x.iso2||"";$("h-title").textContent="Edit "+x.name;$("h-msg").innerHTML="";$("h-title").scrollIntoView({behavior:"smooth",block:"start"});}catch(e){toast("Couldn't load the hub.");}});
  v.querySelectorAll("[data-hrm]").forEach(b=>b.onclick=()=>confirmBox("Remove "+b.dataset.nm+"?","The hub and its data leave the app for everyone. Its sources stay available, so it can be added again later.","Remove hub",async()=>{try{await post("/api/admin/hubs/"+b.dataset.hrm,{},"DELETE");$("h-msg").innerHTML=reloadNote("Removed "+esc(b.dataset.nm)+". Reload to update the app.");wireReload();$("h-msg").scrollIntoView({block:"center"});}catch(e){toast(e.message);}}));
  const feeds=async()=>{const el=$("feeds");if(!el){return;}try{const j=await (await fetch("/api/admin/feeds")).json(),fs=j.feeds||[];
    el.innerHTML=`<h2>News feeds</h2><p class="sub">RSS or Atom feeds checked by "Recent events", next to GDACS and NASA EONET. Items are matched to a place by its name.</p>${fs.length?`<div class="tblwrap"><table class="t"><tbody>${fs.map(x=>`<tr><td><b>${esc(x.name||x.url)}</b><div class="src">${esc(x.url)}${x.country?" · "+esc(x.country):""}</div></td><td><button class="btn danger sm" type="button" data-frm="${x.id}">Remove</button></td></tr>`).join("")}</tbody></table></div>`:'<p class="src">No feeds added.</p>'}
    <div class="fields" style="margin-top:10px"><label class="field">Feed address<input id="f-url" placeholder="https://…/rss"></label><label class="field">Name<input id="f-name"></label><label class="field">Country <small>optional</small><input id="f-cty"></label></div><div class="ctas"><button class="btn alt sm" type="button" id="f-add">Add feed</button></div><div id="f-msg"></div>`;
    $("f-add").onclick=async()=>{try{await post("/api/admin/feeds",{url:$("f-url").value.trim(),name:$("f-name").value.trim(),country:$("f-cty").value.trim()});toast("Feed added.");feeds();}catch(e){$("f-msg").innerHTML=`<div class="note bad" style="margin-top:8px">${esc(e.message)}</div>`;}};
    el.querySelectorAll("[data-frm]").forEach(b=>b.onclick=()=>confirmBox("Remove this feed?","It stops being checked for recent events.","Remove feed",async()=>{try{await post("/api/admin/feeds/"+b.dataset.frm,{},"DELETE");feeds();}catch(e){toast(e.message);}}));}
    catch(e){el.innerHTML='<h2>News feeds</h2><p class="src">Unavailable right now.</p>';}};feeds();}

/* ---------- Glossary: terms, rules, strategies, data sources ---------- */
let GQ="",RF="",SF=null;
const GTABS=[["terms","Terms"],["rules","Rules in force"],["strategies","Strategy library"],["sources","Data sources"]];
PAGES.glossary=sub=>{sub=GTABS.some(t=>t[0]===sub)?sub:"terms";const sf=SF||PERSONA;
  const body={
   terms:()=>`<div class="controls" style="margin-bottom:12px"><label for="gq">Search</label><input id="gq" value="${esc(GQ)}" style="min-height:40px;border:1px solid var(--line);border-radius:8px;padding:6px 10px"></div><div class="gl">${Object.keys(G).filter(k=>!GQ||G[k].join(" ").toLowerCase().includes(GQ.toLowerCase())).map(k=>`<article><h3>${esc(G[k][0])}</h3><p>${esc(G[k][1])}</p><p class="how">${esc(G[k][2])}</p><div class="from">Source: ${esc(G[k][3])}</div></article>`).join("")||'<p class="sub">No match.</p>'}</div>`,
   rules:()=>`<div class="controls" style="margin-bottom:12px">${seg([["","All"]].concat(Object.keys(JNAME).map(k=>[k,JNAME[k]])),RF,"data-rf")}</div><p class="sub" style="margin-bottom:10px">${RULES.filter(r=>r.src).length} rules with their sources, plus ${RULES.filter(r=>r.st==="App default").length} internal targets marked App default (no source: replace them with your own), checked 16 Oct 2026. ${NORULE()} Not legal advice. ${info("rules")}</p><div class="card"><div class="tblwrap"><table class="t"><thead><tr><th>Country</th><th>Rule</th><th>Area</th><th>Requirement</th><th>Status</th></tr></thead><tbody>${RULES.filter(r=>!RF||r.j===RF).map(r=>`<tr><td>${JNAME[r.j]}</td><td><b>${esc(r.name)}</b></td><td class="src">${esc(r.area)}</td><td>${esc(r.req)}</td><td>${r.src?`<a href="${esc(r.src)}" target="_blank" rel="noopener noreferrer">${esc(r.st)}</a>`:`<span class="chip ${r.st==="App default"?"grey":"warn"}">${esc(r.st)}</span>`}</td></tr>`).join("")}</tbody></table></div></div>`,
   strategies:()=>{const list=LIB.filter(x=>sf==="all"||x.aud.includes(sf)),cats=[...new Set(list.map(x=>x.cat))];
     return `<div class="controls" style="margin-bottom:12px">${seg([["all","All personas"]].concat(PK.map(q=>[q,PERS[q].name])),sf,"data-sf")}</div><p class="sub" style="margin-bottom:10px">${LIB.length} adaptation strategies. Effects are points taken off each hazard score; cost and lead time are screening estimates. In the guided flow they appear as levers under "Strategy library". ${info("classes")}</p>
     ${cats.map(c=>`<div class="card" style="margin-bottom:12px"><h2>${esc(c)}</h2><div class="tblwrap"><table class="t"><thead><tr><th>Strategy</th><th>Heat</th><th>Flood</th><th>Water</th><th>Grid</th><th>Cost</th><th>Lead time</th><th>For</th></tr></thead><tbody>${list.filter(x=>x.cat===c).map(x=>`<tr><td><b>${esc(x.t)}</b><div class="src">${esc(x.note)}</div></td>${x.e.map(v=>`<td class="num">${v?"−"+v:"–"}</td>`).join("")}<td>${"$".repeat(x.c)}</td><td class="num">${x.lo}–${x.hi} mo</td><td class="src">${x.aud.map(a=>PERS[a].name).join(", ")}</td></tr>`).join("")}</tbody></table></div></div>`).join("")}`;},
   sources:()=>`<div class="card"><p class="sub" style="margin-bottom:10px">Every source the app uses. This is the only place they are listed; elsewhere each number carries a Measured / Your data / Estimate / Assumption / No data badge.</p><div class="tblwrap"><table class="t"><thead><tr><th>Source</th><th>Used for</th><th>Licence</th></tr></thead><tbody>${SRCS.map(x=>`<tr><td>${esc(x.name)}</td><td class="src">${esc(x.used||"")}</td><td class="src">${esc(x.licence||"")}</td></tr>`).join("")}<tr><td>Google Cloud region carbon data 2025</td><td class="src">Enterprise tenant: region grid intensity and CFE</td><td class="src">Apache 2.0</td></tr><tr><td>OpenStreetMap: data centre buildings and sites (extract via the japan-data-centers project)</td><td class="src">Real data centres: Earth view · Data centres, example sites, facilities near each place (with PeeringDB)</td><td class="src">ODbL, © OpenStreetMap contributors</td></tr></tbody></table></div></div>`};
  return `<div class="wrap">${phead("Glossary",{terms:"Every term, how it's worked out and where it comes from",rules:"Rules in force across JAPAC",strategies:"Strategy library",sources:"Data sources"}[sub],{terms:"The same text appears in each ⓘ.",rules:"",strategies:"",sources:""}[sub])}
  <nav class="subnav" aria-label="Glossary">${GTABS.map(t=>`<a href="#/glossary/${t[0]}"${t[0]===sub?' aria-current="page"':""}>${t[1]}</a>`).join("")}</nav>${body[sub]()}</div>`;};
PAGES.glossary.after=sub=>{const v=$("view"),q=$("gq");if(q){q.oninput=()=>{GQ=q.value;const pos=q.selectionStart;route();const n=$("gq");n.focus();n.setSelectionRange(pos,pos);};}
  v.querySelectorAll("[data-rf]").forEach(b=>b.onclick=()=>{RF=b.dataset.rf;route();});v.querySelectorAll("[data-sf]").forEach(b=>b.onclick=()=>{SF=b.dataset.sf;route();});};

/* ---------- What changes (plan summary) ---------- */
/* ---------- Earth view tabs: Map & ranking, Place detail, Compare (the former More menu, folded in on 17 Oct 2026) ---------- */
let MV={reg:"Asia-Pacific",h:"2050",p:"high",layer:"overall",sel:null};
const ETABS=[["lapse","Timelapse"],["view","Hazard view"],["dc","Data centres"],["map","Map & ranking"],["place","Place detail"],["compare","Compare"]];
const enav=sub=>`<nav class="subnav" aria-label="Earth view">${ETABS.map(t=>`<a href="#/earth/${t[0]}"${t[0]===sub?' aria-current="page"':""}>${t[1]}</a>`).join("")}</nav>`;
const MORE={};
/* Colour by lists a hazard only when the places shown differ on it; hazards with no 2030/2050 projection say so.
   Volcanoes, earthquakes and wildfire are left out of the menu (review point 5, 17 Oct 2026); they still count in every score. */
const LAYER_SKIP=["volcano","earthquake","wildfire"];
const PROJ=k=>withData().some(h=>{const e=entry(HZD[h.id],k);return !!e&&["m30","h30","m50","h50"].some(q=>e[q]!=null&&e[q]!==e.t);});
const layerList=hs=>[["overall","Overall climate risk"]].concat(HZ.filter((hz,i)=>{if(LAYER_SKIP.includes(hz[0])){return false;}const v=hs.map(h=>scoresOf(HZD[h.id],MV.h,MV.p)[i]).filter(x=>x!=null);return v.length>1&&Math.min(...v)!==Math.max(...v);}).map(hz=>[hz[0],hz[1]+(PROJ(hz[0])?"":" (today only)")]));
const layerOpts=L=>L.map(o=>`<option value="${o[0]}"${o[0]===MV.layer?" selected":""}>${esc(o[1])}</option>`).join("");
const scenCtl=()=>seg([["today","Today"],["2030","2030"],["2050","2050"]],MV.h,"data-mh")+seg([["mod","SSP2-4.5"],["high","SSP5-8.5"]],MV.p,"data-mp");
MORE.map=()=>{const LL=layerList(withData());if(!LL.some(o=>o[0]===MV.layer)){MV.layer="overall";}const b=REGBOX(MV.reg),gs=Math.max(4,b[2]/70),li=HZK.indexOf(MV.layer),val=h=>{const sc=scoresOf(HZD[h.id],MV.h,MV.p);return li<0?comp(sc):sc[li];};
  const hs=withData().filter(h=>MV.reg==="Global"||h.r===MV.reg),rows=hs.map(h=>({h,v:val(h)})).filter(r=>r.v!=null).sort((a,b)=>a.v-b.v),nd=hs.length-rows.length,lab=li<0?"Overall climate risk":HZ[li][1];
  return `<div class="controls" style="margin-bottom:12px">${scenCtl()}<label class="persona" style="color:var(--ink)">Colour by<select id="m-layer" style="background:#fff;color:var(--ink);border-color:var(--line)">${layerOpts(LL)}</select></label></div>${li>=0&&MV.h!=="today"&&!PROJ(MV.layer)?`<p class="note" style="margin-bottom:12px">The open data has no ${MV.h} projection for ${esc(HZ[li][1].toLowerCase())}, so the map shows today's value for every year.</p>`:""}
  <div class="earthwrap"><div class="card map" style="padding:10px"><svg viewBox="${b.join(" ")}" role="group" aria-label="Map of places coloured by ${esc(lab)}"><path class="sph" d="${MAP.sphere}"/><path class="grat" d="${MAP.grat}"/><path class="land" d="${MAP.land}"/><path class="bord" d="${MAP.borders}"/>${hs.map(h=>{const v=val(h);return `<g class="dotg" data-h="${h.id}" tabindex="0" role="button" aria-label="${esc(h.n)}: ${v==null?"no data":v}"><circle cx="${h.x}" cy="${h.y}" r="${(gs*.55).toFixed(2)}" fill="${bcol(v)}" stroke="${btxt(v)}" stroke-width="${(gs*.12).toFixed(2)}"/></g>`;}).join("")}</svg>
    <div class="legend">${[["Low",20],["Moderate",45],["High",60],["Severe",80],["No data",null]].map(x=>`<span><span class="dot" style="background:${bcol(x[1])};border:1px solid ${btxt(x[1])}"></span>${x[0]}</span>`).join("")}</div></div>
  <div class="card"><h2>Ranking · ${esc(lab)} ${info(li<0?"overall":HZ[li][0])}</h2><p class="sub">${scenTxt(MV.h,MV.p)}. Climate safety = 100 − score: higher is better, safest first.${nd?" "+nd+" places have no data for this and are left out.":""}</p>
    <div class="tblwrap"><table class="t"><thead><tr><th>#</th><th>Place</th><th>Climate safety</th><th>Score</th><th>Compare</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><a href="#/earth/place" data-go="${r.h.id}"><b>${esc(r.h.n)}</b></a> <span class="src">${esc(r.h.c)}</span></td><td>${goodPill(100-r.v)}</td><td>${pill(r.v)}</td><td><input type="checkbox" data-pin="${r.h.id}" aria-label="Compare ${esc(r.h.n)}"${S.pins.includes(r.h.id)?" checked":""}></td></tr>`).join("")}</tbody></table></div></div></div>`;};
const libFor=(sc,p)=>LIB.filter(x=>x.aud.includes(p)).map(x=>({x,ben:x.e.reduce((t,e,i)=>t+e*(sc[i]==null?0:sc[i])/100,0)})).filter(o=>o.ben>0.5).sort((a,b)=>b.ben-a.ben);
MORE.hub=()=>{let id=MV.sel||engine(PERSONA).ctx.hubId;if(!inView(id)){id=exPlace(PERSONA);}MV.sel=id;
  const h=hub(id),z=HZD[id],sc=scoresOf(z,MV.h,MV.p),c=comp(sc),w=worstIdx(sc),x=z.extra||{},gc=x.gridCarbon,sl=x.seaLevel,hs=["today","2030","2050"].map(hh=>scoresOf(z,hh,MV.p));
  return `<div class="controls" style="margin-bottom:12px"><label class="persona" style="color:var(--ink)">Place<select id="m-hub" style="background:#fff;color:var(--ink);border-color:var(--line)">${hubOpts(id)}${siteGroup(id)}</select></label>${scenCtl()}<button class="btn alt sm" type="button" id="m-pin">${S.pins.includes(id)?"In compare ✓":"Add to compare"}</button>${hub(id)&&!hub(id).site?`<button class="btn alt sm" type="button" id="m-watch" aria-pressed="${follows(id)}">${follows(id)?"Following for alerts ✓":"Follow for alerts"}</button>`:""}</div>
  <section class="kpis"><div class="kpi"><span class="k">Overall climate risk${info("overall")}</span><span class="v">${c??"–"}<small>/100 · ${band(c)}</small></span><span class="d">Climate safety ${c==null?"–":100-c}</span></div>
   <div class="kpi"><span class="k">Biggest hazard</span><span class="v">${w<0?"–":esc(HZ[w][1])}<small>${w<0?"":sc[w]}</small></span><span class="d">${esc(h.c)}</span></div>
   <div class="kpi${gc?"":" empty"}"><span class="k">Grid carbon${info("carbon")}</span><span class="v">${gc?gc.g:"No data"}<small>${gc?"g/kWh":""}</small></span><span class="d">${gc?gc.year:""}</span></div>
   <div class="kpi${sl?"":" empty"}"><span class="k">Sea level 2050${info("sea")}</span><span class="v">${sl?"+"+sl[MV.p==="mod"?"mod":"high"]["2050"].mid:"–"}<small>${sl?"cm":""}</small></span><span class="d">${sl?"Tide gauge "+sl.km+" km away":"No gauge within 30 km"}</span></div>
   <div class="kpi${x.facilities?"":" empty"}"><span class="k">Data centres within 50 km</span><span class="v">${dcLabel(z)}</span><span class="d">OpenStreetMap + PeeringDB</span></div></section>
  <div class="row2" style="margin-top:16px"><div class="card"><h2>${esc(h.n)}: each hazard</h2><div class="tblwrap"><table class="t"><thead><tr><th>Hazard</th><th>Today</th><th>2030</th><th>2050</th><th>Data</th></tr></thead><tbody>${HZ.map((hz,i)=>{const e=entry(z,hz[0])||{};return `<tr><td>${esc(hz[1])} ${info(hz[0])}</td>${[0,1,2].map(j=>`<td>${pill(hs[j][i])}</td>`).join("")}<td><span class="prov">${esc(PROV[e.kind||"none"]||"Data")}</span>${e.basis?`<details class="tv"><summary>How</summary><p class="src">${esc(e.basis)}</p></details>`:""}</td></tr>`;}).join("")}</tbody></table></div></div>
   <div class="card"><h2>Exposure</h2><div class="petalbox">${petalSvg(sc,null,"Hazard petals for "+h.n)}</div><div class="ctas"><button class="btn alt sm" type="button" id="m-live">Conditions now</button><button class="btn alt sm" type="button" id="m-news">Recent events</button>${PLANKEY[PERSONA]&&!(PERSONA==="pol"&&hub(id).site)?`<button class="btn sm" type="button" data-plan="${id}">Plan this in the guided flow →</button>`:""}</div><div id="m-out" aria-live="polite" style="margin-top:10px"></div></div></div>${outlook(id)}
  <div class="card" style="margin-top:16px"><h2>Strategies that help most here · ${esc(PERS[PERSONA].name)} ${info("classes")}</h2><p class="sub">Strategy library, ranked by hazard points removed at this place (${scenTxt(MV.h,MV.p)}).</p><div class="tblwrap"><table class="t"><thead><tr><th>Strategy</th><th>Points removed</th><th>Cost</th><th>Lead time</th><th>Class here</th></tr></thead><tbody>${libFor(sc,PERSONA).slice(0,8).map(o=>{const fo=libForce(o.x.id,sc);return `<tr><td><b>${esc(o.x.t)}</b><div class="src">${esc(o.x.note)}</div></td><td class="num">${nf(o.ben,1)}</td><td>${"$".repeat(o.x.c)}</td><td class="num">${o.x.lo}–${o.x.hi} mo</td><td>${fo?`<span class="chip ${fo[0]==="mal"?"bad":"warn"}">${fo[0]==="mal"?"maladaptation":"trade-off"}</span><div class="src">${esc(fo[1])}</div>`:'<span class="chip">no-regret</span>'}</td></tr>`;}).join("")||'<tr><td colspan="5" class="src">No strategy for this persona addresses the hazards with data here.</td></tr>'}</tbody></table></div></div>
  <div class="card" id="m-dc" style="margin-top:16px">${dcNearCard(id)}</div>`;};
MORE.compare=()=>{const pins=S.pins.filter(inView);
  const cols=pins.map(id=>{const z=HZD[id],sc=scoresOf(z,MV.h,MV.p),x=z.extra||{};return {id,h:hub(id),sc,c:comp(sc),gc:x.gridCarbon,sl:x.seaLevel,f:x.facilities};});
  const help=LIB.filter(x=>x.aud.includes(PERSONA)).map(x=>({x,n:cols.filter(c=>x.e.some((e,i)=>e>0&&c.sc[i]!=null&&c.sc[i]>=55)).length})).filter(o=>o.n>=2).sort((a,b)=>b.n-a.n||a.x.c-b.x.c).slice(0,8);
  return `<div class="controls" style="margin-bottom:12px">${scenCtl()}<label class="persona" style="color:var(--ink)">Add<select id="m-add" style="background:#fff;color:var(--ink);border-color:var(--line)"><option value="">Choose a place…</option>${hubOpts("")}</select></label></div>
  ${cols.length?`<div class="card"><div class="tblwrap"><table class="t"><thead><tr><th></th>${cols.map(c=>`<th><a href="#/earth/place" data-go="${c.id}">${esc(c.h.n)}</a><div class="src">${esc(c.h.c)}</div><button class="btn alt sm" type="button" data-unpin="${c.id}">Remove</button></th>`).join("")}</tr></thead><tbody>
    <tr><td><b>Overall climate risk</b> ${info("overall")}</td>${cols.map(c=>`<td>${pill(c.c)} <span class="src">${band(c.c)}</span></td>`).join("")}</tr>
    ${HZ.map((hz,i)=>`<tr><td>${esc(hz[1])}</td>${cols.map(c=>`<td>${pill(c.sc[i])}</td>`).join("")}</tr>`).join("")}
    <tr><td>Grid carbon (g/kWh)</td>${cols.map(c=>`<td class="num">${c.gc?c.gc.g:"No data"}</td>`).join("")}</tr>
    <tr><td>Sea level by 2050 (cm)</td>${cols.map(c=>`<td class="num">${c.sl?"+"+c.sl[MV.p==="mod"?"mod":"high"]["2050"].mid:"No gauge"}</td>`).join("")}</tr>
    <tr><td>Data centres within 50 km</td>${cols.map(c=>`<td class="num">${c.f?c.f.n:"No data"}</td>`).join("")}</tr></tbody></table></div></div>
  <div class="card" style="margin-top:16px"><h2>Strategies that help several of these places</h2><p class="sub">Library strategies for ${esc(PERS[PERSONA].name)} that reduce a hazard scoring High (55+) at two or more of them.</p>${help.length?`<div class="tblwrap"><table class="t"><tbody>${help.map(o=>`<tr><td><b>${esc(o.x.t)}</b><div class="src">${esc(o.x.note)}</div></td><td class="num">${o.n} of ${cols.length} places</td><td>${"$".repeat(o.x.c)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="src">None: no shared High hazard that this persona\'s strategies address.</p>'}</div>`:'<div class="card"><p class="sub">Nothing to compare yet. Add places here or tick them in Map & ranking.</p></div>'}`;};
PAGES.more=sub=>{setTimeout(()=>location.replace("#/earth/"+({hub:"place",compare:"compare"}[sub]||"map")));return "";};
/* Timelapse tab (public/timelapse.js): the same scores as the Hazard view, on a satellite globe with a play timeline. */
const lapsePage=()=>`<div class="wrap">${phead("Earth view","Climate timelapse: how exposure grows to 2050","Every place as a ring sized and coloured by its overall climate risk, on NASA satellite imagery. Press play to step through today, 2030 and 2050, or pick a place from the list.")}${enav("lapse")}</div><div id="tlroot">${window.TIMELAPSE?"":'<div class="wrap"><p class="note bad">The timelapse script did not load.</p></div>'}</div>`;
function lapseAfter(){if(!window.TIMELAPSE||!$("tlroot")){return;}const ks=[];["today","2030","2050"].forEach(h=>["mod","high"].forEach(p=>ks.push([h,p])));
  const places=withData().map(h=>{const z=HZD[h.id],sc={},cp={};ks.forEach(([hh,pp])=>{const s=scoresOf(z,hh,pp);sc[hh+"|"+pp]=s;cp[hh+"|"+pp]=comp(s);});
    return {id:h.id,n:h.n,c:h.c,lat:z.lat,lon:z.lon,sc,comp:cp,dc:dcAt(z),gc:(z.extra||{}).gridCarbon||null};}).filter(p=>p.lat!=null&&p.lon!=null);
  TIMELAPSE.mount($("tlroot"),{places,petal:petalSvg,scen:scenTxt,state:{h:EV.h,p:EV.p,sel:EV.sel},
    onState:s=>{EV.h=s.h;EV.p=s.p;EV.sel=s.sel;},openPlace:id=>{MV.sel=id;location.hash="#/earth/place";}});}
PAGES.earth=sub=>{if(sub==="hub"){sub="place";}if(!sub){sub="lapse";}if(sub==="lapse"){return lapsePage();}if(!ETABS.some(t=>t[0]===sub)||sub==="view"){return earthView();}
  return `<div class="wrap">${phead("Earth view",{dc:"Data centres",map:"Map & ranking",place:"Place detail",compare:"Compare"}[sub],{dc:"Real data centres from OpenStreetMap and PeeringDB, with the climate risk of our places. Click a dot for details.",map:"Every place coloured by the hazard you choose, with a ranking. Higher score = better.",place:"One place in depth: its hazards, conditions now, recent events and the strategies that help most.",compare:"Up to six places side by side."}[sub])}${enav(sub)}${MORE[sub==="place"?"hub":sub]()}</div>`;};
PAGES.earth.after=sub=>{if(sub==="hub"){sub="place";}if(!sub||sub==="lapse"){loadDCF().finally(lapseAfter);return;}if(!ETABS.some(t=>t[0]===sub)||sub==="view"){earthAfter();}else if(sub==="dc"){loadDCF().then(dcRender);if(window.STA){STA.event("dc_map_open",{country:DCV.cc||"all"});}}else{moreAfter();fillOutlook($("view"));}};
const moreAfter=()=>{const v=$("view");
  v.querySelectorAll("[data-mr]").forEach(b=>b.onclick=()=>{MV.reg=b.dataset.mr;route();});v.querySelectorAll("[data-mh]").forEach(b=>b.onclick=()=>{MV.h=b.dataset.mh;route();});v.querySelectorAll("[data-mp]").forEach(b=>b.onclick=()=>{MV.p=b.dataset.mp;route();});
  const ly=$("m-layer");if(ly){ly.onchange=()=>{MV.layer=ly.value;route();};}
  v.querySelectorAll(".dotg").forEach(g=>{const go=()=>{MV.sel=g.dataset.h;location.hash="#/earth/place";};g.onclick=go;g.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go();}};});
  v.querySelectorAll("[data-go]").forEach(a=>a.onclick=()=>{MV.sel=a.dataset.go;});
  v.querySelectorAll("[data-pin]").forEach(cb=>cb.onchange=()=>{const id=cb.dataset.pin;S.pins=S.pins.filter(x=>x!==id);if(cb.checked){if(S.pins.length>=6){cb.checked=false;toast("Compare up to 6 places.");return;}S.pins.push(id);}save();});
  v.querySelectorAll("[data-unpin]").forEach(b=>b.onclick=()=>{S.pins=S.pins.filter(x=>x!==b.dataset.unpin);save();route();});
  const ad=$("m-add");if(ad){ad.onchange=()=>{const id=ad.value;if(!id){return;}if(!S.pins.includes(id)){if(S.pins.length>=6){toast("Compare up to 6 places.");return;}S.pins.push(id);save();}route();};}
  const mh=$("m-hub");if(mh){mh.onchange=()=>{MV.sel=mh.value;route();};
    $("m-pin").onclick=()=>{const id=MV.sel;if(S.pins.includes(id)){S.pins=S.pins.filter(x=>x!==id);}else if(S.pins.length<6){S.pins.push(id);}else{toast("Compare up to 6 places.");}save();route();};
    const mw=$("m-watch");if(mw){mw.onclick=async()=>{const on=!follows(MV.sel);try{AL=await post("/api/watch",{hub:MV.sel,on});alertBadge();toast(on?"Following for alerts. See My workspace · Alerts.":"No longer following.");route();}catch(e){toast(e.message);}};}
    $("m-live").onclick=()=>showLive(MV.sel,$("m-out"));$("m-news").onclick=()=>showNews(MV.sel,$("m-out"));
    }
};


/* ================= the place being worked on ================= */
/* Each persona's first example place, used only when nothing else is known (no fixed Chennai). */
function exPlace(p){const e=CFG[p].ex[0][1];return e.site||e.cand||e.hub||e.users;}
function workPlace(){const f=runOf(PERSONA).f,v=f.site||f.cand||f.hub||f.users;return HZD[v]?v:exPlace(PERSONA);}
/* Warming stripes for that place: NASA POWER yearly mean temperature 1991-2020, fetched by the server and cached there. */
const STRIPE={key:null};
async function drawStripes(){const id=workPlace(),z=HZD[id],el=$("stripes");if(!z||z.lat==null||!el){return;}const key=z.lat.toFixed(1)+","+z.lon.toFixed(1);if(STRIPE.key===key){return;}STRIPE.key=key;
  try{const r=await fetch("/api/stripes?lat="+z.lat+"&lon="+z.lon);if(!r.ok){throw new Error();}const T=(await r.json()).years,ys=Object.keys(T);if(STRIPE.key!==key||!ys.length){return;}
    const mean=ys.reduce((a,y)=>a+T[y],0)/ys.length,sd=Math.sqrt(ys.reduce((a,y)=>a+(T[y]-mean)**2,0)/ys.length)||1,blues=["#08306B","#2171B5","#6BAED6","#C6DBEF"],reds=["#FCBBA1","#FB6A4A","#CB181D","#67000D"];
    el.innerHTML=ys.map(y=>{const a=(T[y]-mean)/sd,c=a<0?blues[Math.max(0,Math.min(3,3+Math.round(a*1.2)))]:reds[Math.max(0,Math.min(3,Math.round(a*1.2)))];return `<i style="background:${c}" title="${esc((hub(id)||{}).n||"")} ${y}: ${T[y].toFixed(1)} °C"></i>`;}).join("");
    el.setAttribute("aria-label",((hub(id)||{}).n||"This place")+": yearly mean temperature 1991 to 2020 (NASA POWER)");}catch(e){STRIPE.key=null;}}

/* ================= real data centres (public/facilities.json from jobs/sources/facilities.py) ================= */
let DCF=null,DCMAP=null,DCVIEW=null,LEAF=null;
/* Google Maps JavaScript API for the Data centres map when the server has GOOGLE_MAPS_BROWSER_KEY; otherwise, or if
   Google refuses the key, the Leaflet + OpenStreetMap map below works exactly as before. */
let GMAPKEY="",GMFAIL=false,GMP=null,HUBSLOCKED=false;
async function loadGcfg(){try{const j=await (await fetch("/api/google-config")).json();GMAPKEY=j.mapsKey||"";HUBSLOCKED=!!j.hubsLocked;document.body.classList.toggle("hubs-locked",HUBSLOCKED);if(window.STA){STA.init(j.gaId||"");}}catch(e){}}
function loadGmaps(){if(GMP){return GMP;}
  const js=(u,cb)=>new Promise((r,j)=>{const x=document.createElement("script");x.src=u;x.async=true;if(!cb){x.onload=r;}x.onerror=()=>j(new Error("could not load "+u.split("?")[0].split("/").pop()));if(cb){window[cb]=r;}document.head.appendChild(x);});
  window.gm_authFailure=()=>{GMFAIL=true;toast("Google Maps didn't accept the key, so the map uses OpenStreetMap.");dcRender();};
  GMP=js("https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(GMAPKEY)+"&v=weekly&loading=async&callback=__atlasGm","__atlasGm")
    .then(()=>window.markerClusterer?null:js("https://cdn.jsdelivr.net/npm/@googlemaps/markerclusterer@2.5.3/dist/index.min.js"))
    .catch(e=>{GMP=null;throw e;});
  return GMP;}
async function loadDCF(){if(DCF){return DCF;}try{const r=await fetch("/facilities.json");if(r.ok){DCF=await r.json();}}catch(e){}return DCF;}
const dcNearLL=(lat,lon,r)=>DCF?DCF.facilities.filter(f=>Math.abs(f.lat-lat)<1&&Math.abs(f.lon-lon)<1.3&&km(lat,lon,f.lat,f.lon)<=(r||50)):[];
function dcAt(z){return DCF&&z&&z.lat!=null?dcNearLL(z.lat,z.lon).length:null;}
function dcLabel(z){const n=dcAt(z);return n!=null?n:((z&&z.extra||{}).facilities?z.extra.facilities.n:"No data");}
const SEGC={"Hyperscale / cloud":"#7B3FA0","Colocation / wholesale":"#D62728","Telecom carrier":"#1F77B4","IT services":"#2CA02C","Research / academic":"#FF7F0E","Financial":"#8C564B","Government / public":"#17BECF","Unclassified":"#8A8F8C"};
const ISO3={IN:"IND",SG:"SGP",MY:"MYS",ID:"IDN",PH:"PHL",TH:"THA",CN:"CHN",HK:"HKG",TW:"TWN",KR:"KOR",JP:"JPN",AU:"AUS",NZ:"NZL",VN:"VNM"};
const DCV={cc:"",hide:{},src:"all",heat:false,rings:true,base:"google"};
const safeUrl=u=>/^https?:\/\//i.test(u||"")?u:"";
const dcShown=()=>DCF?DCF.facilities.filter(f=>(!DCV.cc||f.cc===DCV.cc)&&!DCV.hide[f.seg]&&(DCV.src==="all"||(DCV.src==="both"?f.src.length===2:f.src.includes(DCV.src)))):[];
const dcSrcLinks=f=>[f.osm?`<a href="${esc(f.osm)}" target="_blank" rel="noopener noreferrer">OpenStreetMap ↗</a>`:"",f.pdb?`<a href="${esc(f.pdb)}" target="_blank" rel="noopener noreferrer">PeeringDB ↗</a>`:"",safeUrl(f.web)?`<a href="${esc(f.web)}" target="_blank" rel="noopener noreferrer">Website ↗</a>`:""].filter(Boolean).join(" · ");
function dcNearCard(id){const z=HZD[id],h=hub(id);if(!DCF||!z){return '<p class="src">The data-centre list is not loaded.</p>';}
  const L=dcNearLL(z.lat,z.lon).map(f=>Object.assign({d:km(z.lat,z.lon,f.lat,f.lon)},f)).sort((a,b)=>a.d-b.d),segs={},ops={};L.forEach(f=>{segs[f.seg]=(segs[f.seg]||0)+1;if(f.op){ops[f.op]=(ops[f.op]||0)+1;}});
  const top=Object.entries(ops).sort((a,b)=>b[1]-a[1]).slice(0,5);
  return `<h2>Data centres within 50 km of ${esc(h.n)}</h2><p class="sub">${L.length} mapped in OpenStreetMap or PeeringDB${top.length?" · largest operators here: "+top.map(o=>esc(o[0])+" ("+o[1]+")").join(", "):""}. Not every data centre is mapped. <a href="#/earth/dc">See them on the map →</a></p>
   ${L.length?`<div class="dcsegs">${Object.entries(segs).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span><i style="background:${SEGC[k]}"></i>${esc(k)} ${v}</span>`).join("")}</div>
   <div class="tblwrap"><table class="t"><thead><tr><th>Facility</th><th>Operator</th><th>Type</th><th>Distance</th><th>Footprint</th><th>Source</th></tr></thead><tbody>${L.slice(0,8).map(f=>`<tr><td><b>${esc(f.n)}</b></td><td>${esc(f.op||"–")}</td><td><span class="dot" style="background:${SEGC[f.seg]}"></span> ${esc(f.seg)}</td><td class="num">${nf(f.d,1)} km</td><td class="num">${f.fp?nf(f.fp)+" m²":"–"}</td><td class="src">${dcSrcLinks(f)}</td></tr>`).join("")}</tbody></table></div>`:""}`;}
MORE.dc=()=>`<div id="dcwrap"><p class="src"><span class="spin"></span>Loading data centres…</p></div>`;
function loadLeaflet(){if(LEAF){return LEAF;}const B="https://cdnjs.cloudflare.com/ajax/libs/";
  const css=u=>new Promise(r=>{const l=document.createElement("link");l.rel="stylesheet";l.href=u;l.onload=r;l.onerror=r;document.head.appendChild(l);});
  const js=u=>new Promise((r,j)=>{const x=document.createElement("script");x.src=u;x.onload=r;x.onerror=()=>j(new Error("could not load "+u.split("/").pop()));document.head.appendChild(x);});
  LEAF=Promise.all([css(B+"leaflet/1.9.4/leaflet.min.css"),css(B+"leaflet.markercluster/1.5.3/MarkerCluster.css"),css(B+"leaflet.markercluster/1.5.3/MarkerCluster.Default.css"),js(B+"leaflet/1.9.4/leaflet.min.js")])
    .then(()=>Promise.all([js(B+"leaflet.markercluster/1.5.3/leaflet.markercluster.js"),js(B+"leaflet.heat/0.2.0/leaflet-heat.js")])).catch(e=>{LEAF=null;throw e;});
  return LEAF;}
function dcPopup(f){const z=f.hub?HZD[f.hub]:null,c=z?comp(scoresOf(z,"2050","high")):null;
  return `<div class="dcpop"><b>${esc(f.n)}</b><div class="src">${esc(f.op||"Operator not recorded")} · ${esc(f.seg)}</div><table>${f.fp?`<tr><td>Footprint</td><td>${nf(f.fp)} m²${f.lv?" · "+esc(f.lv)+" floors":""}</td></tr>`:""}${f.nets!=null?`<tr><td>PeeringDB</td><td>${f.nets} networks · ${f.ix} exchanges</td></tr>`:""}${f.city?`<tr><td>City</td><td>${esc(f.city)}</td></tr>`:""}${f.hub?`<tr><td>Nearest place</td><td>${esc(hub(f.hub).n)}, ${nf(f.km,1)} km · climate risk 2050: ${c??"–"} (${band(c)})</td></tr>`:""}</table>
    <div class="src">${dcSrcLinks(f)}</div><div class="dcpopb">${f.hub?`<a class="btn alt sm" href="#/earth/place" data-dcgo="${f.hub}">Place detail</a>`:""}${PERSONA!=="pol"?`<button class="btn sm" type="button" data-addfac="${esc(f.id)}">Add to team sites</button>`:""}</div></div>`;}
function dcRender(){const el=$("dcwrap");if(!el){return;}
  if(!DCF){el.innerHTML='<div class="note bad">The data-centre file is missing. Run python -m jobs.sources.facilities and reload.</div>';return;}
  const L=dcShown(),C=DCF.coverage,cs=Object.keys(C).sort((a,b)=>C[a].name.localeCompare(C[b].name)),base=DCF.facilities.filter(f=>!DCV.cc||f.cc===DCV.cc);
  const known=L.filter(f=>f.op).length,both=L.filter(f=>f.src.length===2).length,fps=L.map(f=>f.fp).filter(Boolean).sort((a,b)=>a-b),med=fps.length?fps[Math.floor(fps.length/2)]:null;
  const segN={};base.forEach(f=>{segN[f.seg]=(segN[f.seg]||0)+1;});
  const cov=cs.map(c=>({c,x:C[c],rep:C[c].reported?C[c].reported.n:null})).sort((a,b)=>b.x.mapped-a.x.mapped),mx=Math.max(1,...cov.map(r=>Math.max(r.x.mapped,r.rep||0)));
  const ops={};L.forEach(f=>{if(f.op){(ops[f.op]=ops[f.op]||{n:0,seg:{}}).n++;ops[f.op].seg[f.seg]=(ops[f.op].seg[f.seg]||0)+1;}});const topOps=Object.entries(ops).sort((a,b)=>b[1].n-a[1].n).slice(0,12),omx=topOps.length?topOps[0][1].n:1;
  const byC=(DCV.cc?[DCV.cc]:cs).map(c=>{const r=L.filter(f=>f.cc===c),seg={};r.forEach(f=>{seg[f.seg]=(seg[f.seg]||0)+1;});return {c,n:r.length,seg};}).filter(r=>r.n).sort((a,b)=>b.n-a.n),cmx=Math.max(1,...byC.map(r=>r.n));
  const places=withData().map(h=>{const z=HZD[h.id],near=dcNearLL(z.lat,z.lon).filter(f=>L.includes(f)),o={};near.forEach(f=>{if(f.op){o[f.op]=(o[f.op]||0)+1;}});const top=Object.entries(o).sort((a,b)=>b[1]-a[1])[0];return {h,n:near.length,top,c:comp(scoresOf(z,"2050","high"))};}).filter(r=>r.n).sort((a,b)=>b.n-a.n);
  el.innerHTML=`<div class="controls" style="margin-bottom:12px"><label class="persona" style="color:var(--ink)">Country<select id="dc-cc" style="background:#fff;color:var(--ink);border-color:var(--line)"><option value="">All 14 (${DCF.facilities.length})</option>${cs.map(c=>`<option value="${c}"${c===DCV.cc?" selected":""}>${esc(C[c].name)} (${C[c].mapped})</option>`).join("")}</select></label>${seg([["all","Both sources"],["osm-dc","OpenStreetMap"],["peeringdb","PeeringDB"],["both","Listed in both"]],DCV.src,"data-dcs")}${GMAPKEY&&!GMFAIL?`<span class="src" style="margin-left:6px">Map</span>${seg([["google","Google Maps"],["osm","OpenStreetMap (with density layer)"]],DCV.base,"data-dcb")}`:""}</div>
  <section class="kpis"><div class="kpi"><span class="k">Data centres shown</span><span class="v">${nf(L.length)}</span><span class="d">${kindB("measured")}</span></div><div class="kpi"><span class="k">With a known operator</span><span class="v">${L.length?Math.round(known/L.length*100):0}<small>%</small></span><span class="d">${nf(known)} facilities</span></div><div class="kpi"><span class="k">In both sources</span><span class="v">${nf(both)}</span><span class="d">same building in OpenStreetMap and PeeringDB</span></div><div class="kpi${med?"":" empty"}"><span class="k">Median footprint</span><span class="v">${med?nf(med):"–"}<small>${med?"m²":""}</small></span><span class="d">${nf(fps.length)} with a mapped building outline</span></div></section>
  <div class="dclegend" role="group" aria-label="Facility types (click to hide or show)">${DCF.segments.filter(k=>segN[k]).map(k=>`<button type="button" class="dcseg" data-dcseg="${esc(k)}" aria-pressed="${!DCV.hide[k]}"><i style="background:${SEGC[k]}"></i>${esc(k)} <b>${segN[k]}</b></button>`).join("")}</div>
  <div class="card dcmapcard"><div id="dcmap"></div></div>
  <p class="src" style="margin-top:8px">Dots are sized by building footprint where OpenStreetMap has an outline. Use the layer box to switch on the density (heat) layer or hide the climate-risk rings of our places. OpenStreetMap ${DCF.osmLatestEdit?"(edits up to "+esc(DCF.osmLatestEdit)+")":""} and PeeringDB (read ${esc(DCF.generated)}); some OpenStreetMap objects tagged as data centres are other buildings, and stay Unclassified.</p>
  <div class="row2" style="margin-top:16px"><div class="card"><h2>How complete is the map?</h2><p class="sub">Mapped (OpenStreetMap + PeeringDB) against each country's published total, where one exists. A missing dot is not proof of no data centre.</p>
    <div class="hbars">${cov.map(r=>`<div class="hb"><span class="hl">${esc(r.x.name)}</span><span class="ht">${r.rep?`<i class="rep" style="width:${(r.rep/mx*100).toFixed(1)}%"></i>`:""}<i class="map" style="width:${(r.x.mapped/mx*100).toFixed(1)}%"></i></span><span class="hv">${r.x.mapped}${r.rep?` / ${r.rep} <small>(${Math.round(r.x.mapped/r.rep*100)}%)</small>`:' <small>no published total</small>'}</span></div>`).join("")}</div>
    <p class="src">Published totals: ${[...new Set(cov.filter(r=>r.x.reported).map(r=>r.x.reported.tracker+" via "+r.x.reported.by+", "+r.x.reported.as_of))].map(esc).join("; ")||"none"}. <span class="dot" style="background:var(--line)"></span> published total <span class="dot" style="background:var(--accent)"></span> mapped</p></div>
   <div class="card"><h2>Largest operators${DCV.cc?" · "+esc(C[DCV.cc].name):""}</h2><p class="sub">Facilities per operator in the current selection, coloured by their main type.</p>
    <div class="hbars">${topOps.map(([k,v])=>{const s0=Object.entries(v.seg).sort((a,b)=>b[1]-a[1])[0][0];return `<div class="hb"><span class="hl">${esc(k)}</span><span class="ht"><i style="width:${(v.n/omx*100).toFixed(1)}%;background:${SEGC[s0]}"></i></span><span class="hv">${v.n}</span></div>`;}).join("")||'<p class="src">No operator recorded in this selection.</p>'}</div></div></div>
  <div class="row2" style="margin-top:16px"><div class="card"><h2>Facility types by country</h2><div class="hbars">${byC.map(r=>`<div class="hb"><span class="hl">${esc(C[r.c].name)}</span><span class="ht stack" style="width:${(r.n/cmx*100).toFixed(1)}%">${DCF.segments.filter(k=>r.seg[k]).map(k=>`<i style="flex:${r.seg[k]};background:${SEGC[k]}" title="${esc(k)}: ${r.seg[k]}"></i>`).join("")}</span><span class="hv">${r.n}</span></div>`).join("")}</div></div>
   <div class="card"><h2>Data centres near our places</h2><p class="sub">Within 50 km, with each place's overall climate risk (2050, SSP5-8.5). Where the industry already is, and how exposed it is.</p><div class="tblwrap"><table class="t"><thead><tr><th>Place</th><th>Data centres</th><th>Largest operator</th><th>Climate risk</th></tr></thead><tbody>${places.slice(0,14).map(r=>`<tr><td><a href="#/earth/place" data-dcgo="${r.h.id}"><b>${esc(r.h.n)}</b></a> <span class="src">${esc(r.h.c)}</span></td><td class="num">${r.n}</td><td>${r.top?esc(r.top[0])+" ("+r.top[1]+")":"–"}</td><td>${pill(r.c)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
  wireInfo(el);
  $("dc-cc").onchange=e=>{DCV.cc=e.target.value;DCVIEW=null;dcRender();};
  el.querySelectorAll("[data-dcs]").forEach(b=>b.onclick=()=>{DCV.src=b.dataset.dcs;dcRender();});
  el.querySelectorAll("[data-dcseg]").forEach(b=>b.onclick=()=>{const k=b.dataset.dcseg;DCV.hide[k]=!DCV.hide[k];dcRender();});
  el.querySelectorAll("[data-dcb]").forEach(b=>b.onclick=()=>{DCV.base=b.dataset.dcb;dcRender();});
  dcMap(L);}
async function dcMap(F){const box=$("dcmap");if(!box){return;}
  if(GMAPKEY&&!GMFAIL&&DCV.base==="google"){try{await dcMapGoogle(F,box);return;}catch(e){console.warn("Google Maps failed, using OpenStreetMap:",e);GMFAIL=true;if(!document.body.contains(box)){return;}box.innerHTML="";}}
  try{await loadLeaflet();}catch(e){box.innerHTML=`<p class="note bad" style="margin:16px">The map library didn't load (${esc(e.message)}). The charts below still work; the map needs internet access in the browser.</p>`;return;}
  if(!document.body.contains(box)){return;}
  const Lf=window.L;if(DCMAP){try{DCMAP.remove();}catch(e){}DCMAP=null;}
  const map=Lf.map(box,{preferCanvas:true,worldCopyJump:true,scrollWheelZoom:true});DCMAP=map;
  /* Keyless tiles only: OpenStreetMap's own (light = the same tiles greyed in CSS) and OpenStreetMap France's Humanitarian style. */
  const OSMA='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const light=Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,className:"dctile-light",attribution:OSMA}).addTo(map);
  const std=Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:OSMA});
  const hot=Lf.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",{subdomains:"abc",maxZoom:19,attribution:OSMA+', style <a href="https://www.hotosm.org/">HOT</a> by <a href="https://openstreetmap.fr/">OSM France</a>'});
  const cl=Lf.markerClusterGroup({disableClusteringAtZoom:12,showCoverageOnHover:false,maxClusterRadius:45,chunkedLoading:true});
  F.forEach(f=>{const m=Lf.circleMarker([f.lat,f.lon],{radius:f.fp?Math.max(4,Math.min(16,Math.sqrt(f.fp)/11)):5,color:"#fff",weight:1,fillColor:SEGC[f.seg]||"#888",fillOpacity:.85});m.bindPopup(()=>dcPopup(f),{maxWidth:340});m.bindTooltip(esc(f.n));cl.addLayer(m);});
  map.addLayer(cl);
  const heat=Lf.heatLayer(F.map(f=>[f.lat,f.lon,f.fp?Math.min(1,.35+Math.sqrt(f.fp)/250):.35]),{radius:24,blur:18,minOpacity:.3});
  const rings=Lf.layerGroup(withData().map(h=>{const z=HZD[h.id],c=comp(scoresOf(z,"2050","high"));return Lf.circleMarker([z.lat,z.lon],{radius:13,color:btxt(c),weight:3,fill:false,interactive:true}).bindTooltip(`<b>${esc(h.n)}</b><br>Climate risk 2050 (SSP5-8.5): ${c??"–"} · ${band(c)}<br>${dcNearLL(z.lat,z.lon).length} data centres within 50 km`);}));
  if(DCV.rings){rings.addTo(map);}if(DCV.heat){heat.addTo(map);}
  Lf.control.layers({"Light (OpenStreetMap)":light,"OpenStreetMap":std,"Humanitarian (OSM France)":hot},{"Data centres":cl,"Density (heat)":heat,"Climate risk of our places":rings},{collapsed:true}).addTo(map);
  map.on("overlayadd overlayremove",e=>{if(e.layer===heat){DCV.heat=e.type==="overlayadd";}if(e.layer===rings){DCV.rings=e.type==="overlayadd";}});
  map.on("moveend",()=>{DCVIEW={c:map.getCenter(),z:map.getZoom()};});
  if(DCVIEW){map.setView(DCVIEW.c,DCVIEW.z);}else if(F.length){map.fitBounds(Lf.latLngBounds(F.map(f=>[f.lat,f.lon])),{padding:[24,24],maxZoom:11});}else{map.setView([12,112],3);}}
/* The same map on Google Maps: same dots (colour by type, size by footprint), clustering up to zoom 11, popups and
   climate-risk rings, plus Google's map, satellite and terrain views. The density layer stays on the OpenStreetMap map,
   because Google retired its heat-map layer. */
async function dcMapGoogle(F,box){await loadGmaps();
  const [{Map,InfoWindow},{Marker},core]=await Promise.all(["maps","marker","core"].map(l=>google.maps.importLibrary(l)));
  if(!document.body.contains(box)){return;}
  if(DCMAP){try{DCMAP.remove();}catch(e){}DCMAP=null;}
  const map=new Map(box,{center:{lat:12,lng:112},zoom:3,mapTypeControl:true,streetViewControl:false,fullscreenControl:true,gestureHandling:"greedy"});
  const iw=new InfoWindow({maxWidth:340}),dot=f=>({path:core.SymbolPath.CIRCLE,scale:f.fp?Math.max(4,Math.min(16,Math.sqrt(f.fp)/11)):5,fillColor:SEGC[f.seg]||"#888",fillOpacity:.85,strokeColor:"#fff",strokeWeight:1});
  const dots=F.map(f=>{const m=new Marker({position:{lat:f.lat,lng:f.lon},title:f.n,icon:dot(f)});m.addListener("click",()=>{iw.setContent(dcPopup(f));iw.open({map,anchor:m});});return m;});
  const cl=new markerClusterer.MarkerClusterer({map,markers:dots,algorithm:new markerClusterer.SuperClusterAlgorithm({maxZoom:11,radius:60})});
  const rings=withData().map(h=>{const z=HZD[h.id],c=comp(scoresOf(z,"2050","high"));
    const m=new Marker({position:{lat:z.lat,lng:z.lon},title:`${h.n} · climate risk 2050 (SSP5-8.5): ${c??"–"} · ${band(c)}`,zIndex:1e6,map:DCV.rings?map:null,
      icon:{path:core.SymbolPath.CIRCLE,scale:13,fillOpacity:0,strokeColor:btxt(c),strokeWeight:3}});
    m.addListener("click",()=>{iw.setContent(`<div class="dcpop"><b>${esc(h.n)}</b><br>Climate risk 2050 (SSP5-8.5): ${c??"–"} · ${band(c)}<br>${dcNearLL(z.lat,z.lon).length} data centres within 50 km</div>`);iw.open({map,anchor:m});});return m;});
  const ctl=document.createElement("div");
  ctl.style.cssText="background:#fff;margin:10px;padding:8px 10px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.3);font:13px/1.6 var(--sans);color:#13221C";
  ctl.innerHTML=`<label style="display:block"><input type="checkbox" id="gm-dc" checked> Data centres</label><label style="display:block"><input type="checkbox" id="gm-rings"${DCV.rings?" checked":""}> Climate risk of our places</label>`;
  ctl.querySelector("#gm-dc").onchange=e=>{if(e.target.checked){cl.addMarkers(dots);}else{cl.clearMarkers();}};
  ctl.querySelector("#gm-rings").onchange=e=>{DCV.rings=e.target.checked;rings.forEach(m=>m.setMap(DCV.rings?map:null));};
  map.controls[core.ControlPosition.LEFT_BOTTOM].push(ctl);
  map.addListener("idle",()=>{const c=map.getCenter();DCVIEW={c:{lat:c.lat(),lng:c.lng()},z:map.getZoom()};});
  if(DCVIEW){map.setCenter({lat:+DCVIEW.c.lat,lng:+DCVIEW.c.lng});map.setZoom(DCVIEW.z);}
  else if(F.length){const b=new core.LatLngBounds();F.forEach(f=>b.extend({lat:f.lat,lng:f.lon}));map.fitBounds(b,24);
    core.event.addListenerOnce(map,"idle",()=>{if(map.getZoom()>11){map.setZoom(11);}});}
  DCMAP={remove(){cl.clearMarkers();rings.forEach(m=>m.setMap(null));}};}
document.addEventListener("click",async e=>{const g=e.target.closest("[data-dcgo]");if(g){MV.sel=g.dataset.dcgo;return;}
  const a=e.target.closest("[data-addfac]");if(!a){return;}const f=DCF&&DCF.facilities.find(x=>x.id===a.dataset.addfac);if(!f){return;}a.disabled=true;
  try{await post("/api/sites",{name:f.n.slice(0,80),mw:"",status:"existing",place:(f.city||(f.hub?hub(f.hub).n:"")||DCF.coverage[f.cc].name).slice(0,120),country:DCF.coverage[f.cc].name,iso2:f.cc,iso3:ISO3[f.cc],lat:f.lat,lon:f.lon});
    await loadSites(true);a.textContent="Added ✓";if(window.STA){STA.event("add_team_site",{from:"data_centre_map",country:f.cc});}toast(f.n+" is now a team site. Its open data takes about 25 seconds; see My workspace · My sites.");}catch(err){a.disabled=false;toast(err.message);}});

/* ================= router ================= */
function renderNav(){
  $("nav").innerHTML=NAV.filter(n=>allowed(n[0],PERSONA)).map(n=>`<a href="#/${n[0]}${n[0]==="work"?"/"+WTABS[PERSONA][0][0]:""}" data-r="${n[0]}"${n[0]==="work"?' class="lead"':""}>${n[1]}</a>`).join("");
  $("persona").innerHTML=PK.map(p=>`<option value="${p}"${p===PERSONA?" selected":""}>${PERS[p].name}</option>`).join("");
  alertBadge();
}
function route(){
  const parts=(location.hash||"#/").replace(/^#\/?/,"").split("/"),r=parts[0]||"home",sub=parts[1];let page=PAGES[r]?r:"home";
  const same=route._last===location.hash,y=window.scrollY;
  if(!allowed(page,PERSONA)){$("view").innerHTML=`<div class="wrap"><div class="card" style="margin-top:24px"><h2>Not in the ${esc(PERS[PERSONA].name)} workspace</h2><p class="sub">Manage hubs is for the Data centre operator, Colocation & hyperscaler and Enterprise tenant personas. Switch persona at the top right to use it.</p><div class="ctas"><a class="btn" href="#/">Home</a></div></div></div>`;}
  else{$("view").innerHTML=PAGES[page](sub);if(PAGES[page].after){PAGES[page].after(sub);}}
  document.querySelectorAll("#nav a").forEach(a=>{if(a.dataset.r===page){a.setAttribute("aria-current","page");}else{a.removeAttribute("aria-current");}});
  wireInfo($("view"));
  document.title=({home:"Home",guided:"Guided flow",dash:"Dashboard",work:"My workspace",earth:"Earth view",impact:"Impact",hubs:"Manage hubs",rules:"Rules",approvals:"Approvals",glossary:"Glossary",more:"More"}[page])+" · Adaptation Strategist";
  if(same){window.scrollTo(0,y);}else{window.scrollTo(0,0);}route._last=location.hash;drawStripes();if(window.STA){STA.page(page+(sub?"/"+sub:""),document.title);}
}
$("persona").addEventListener("change",e=>{setPersona(e.target.value);PLAY=null;renderNav();route();toast("Workspace: "+PERS[PERSONA].name);});
window.addEventListener("hashchange",route);
renderNav();
Promise.all([loadAssumptions(),loadSites(),loadAlerts(),loadDCF(),loadGcfg()]).finally(route);
setInterval(()=>{loadAlerts().then(()=>{if(location.hash.startsWith("#/work/alerts")){alertsRender();}});},5*60*1000);
})();
