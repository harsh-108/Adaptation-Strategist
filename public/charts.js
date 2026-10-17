/* Small SVG chart kit for the dashboards. Pure drawing: app.js passes the numbers it already shows, nothing is
   computed here. Each function returns an SVG/HTML string; hovering a mark shows its exact value (<title>). */
(function(){
"use strict";
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const n0=v=>v==null||!isFinite(v)?"–":(Math.abs(v)>=100?Math.round(v):Math.round(v*10)/10).toLocaleString("en");

/* Grouped vertical bars: cats on x, one bar per series, 0..max on y (default 0-100 scores). */
function groupedBars(o){
  const W=640,H=250,m={l:34,r:8,t:12,b:56},pw=W-m.l-m.r,ph=H-m.t-m.b,max=o.max||100,cw=pw/o.cats.length,k=o.series.length,bw=Math.min(18,(cw*.74-(k-1)*2)/k);
  const Y=v=>m.t+ph-(v/max)*ph;
  let s=`<svg class="ach" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label||"")}">`;
  [0,25,50,75,100].filter(v=>v<=max).forEach(v=>{s+=`<line class="g" x1="${m.l}" x2="${W-m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tk" x="${m.l-6}" y="${Y(v)+4}" text-anchor="end">${v}</text>`;});
  o.cats.forEach((c,i)=>{const cx=m.l+cw*i+cw/2,x0=cx-(k*bw+(k-1)*2)/2;
    o.series.forEach((sr,j)=>{const v=sr.values[i],x=x0+j*(bw+2);
      if(v==null){s+=`<text class="nd" x="${x+bw/2}" y="${Y(0)-4}" text-anchor="middle">·</text>`;return;}
      const y=Y(v),h=Math.max(1,m.t+ph-y),r=Math.min(4,bw/2,h);
      s+=`<path d="M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+bw-r}Q${x+bw},${y} ${x+bw},${y+r}V${y+h}Z" fill="${sr.color}"><title>${esc(c)} · ${esc(sr.name)}: ${n0(v)}</title></path>`;});
    s+=`<text class="cl" x="${cx}" y="${H-m.b+16}" text-anchor="middle">${esc(c.length>11?c.slice(0,10)+"…":c)}</text>`;});
  s+=`<line class="b" x1="${m.l}" x2="${W-m.r}" y1="${Y(0)}" y2="${Y(0)}"/></svg>`;
  return `<div class="achl">${o.series.map(sr=>`<span><i style="background:${sr.color}"></i>${esc(sr.name)}</span>`).join("")}</div>`+s;}

/* Bullet rows: baseline marker, AI best fit bar, target tick. rows: {label, base, best, target, dir:"lower"|"higher", fmt(v), pass} */
function bullets(rows){
  return `<div class="achb">${rows.map(r=>{
    const vals=[r.base,r.best,r.target].filter(v=>v!=null&&isFinite(v));
    if(r.base==null&&r.best==null){return `<div class="br"><div class="bl">${esc(r.label)}</div><div class="bt nd">No data</div><div class="bv">–</div></div>`;}
    const max=Math.max(...vals.map(Math.abs))*1.18||1,P=v=>Math.max(0,Math.min(100,(v/max)*100));
    const ok=r.pass;
    return `<div class="br"><div class="bl">${esc(r.label)}<small>${r.dir==="lower"?"lower is better":"higher is better"}</small></div>
      <div class="bt" title="Now ${esc(r.fmt(r.base))} · AI best fit ${esc(r.fmt(r.best))} · target ${esc(r.fmt(r.target))}">
        <span class="bb ${ok?"ok":"no"}" style="width:${P(r.best??r.base)}%"></span>
        ${r.base!=null?`<span class="bn" style="left:${P(r.base)}%"></span>`:""}
        ${r.target!=null?`<span class="bg" style="left:${P(r.target)}%"><em>target</em></span>`:""}
      </div>
      <div class="bv"><b>${esc(r.fmt(r.best??r.base))}</b><small>${r.best!=null&&r.base!=null&&r.best!==r.base?"from "+esc(r.fmt(r.base)):"no change"} · ${ok?"meets target":"misses target"}</small></div></div>`;}).join("")}
    <div class="achl"><span><i class="lk-bar"></i>AI best fit</span><span><i class="lk-now"></i>Now</span><span><i class="lk-tgt"></i>Target</span></div></div>`;}

/* Horizontal ranked bars: items {label, sub, value, color, on} on a 0..max scale. */
function rankBars(items,o){o=o||{};const max=o.max||100;
  return `<div class="achr">${items.map(it=>`<div class="rr${it.on?" on":""}"><span class="rl">${esc(it.label)}${it.sub?`<small>${esc(it.sub)}</small>`:""}</span><span class="rt"><i style="width:${it.value==null?0:Math.max(1,it.value/max*100)}%;background:${it.color}" title="${esc(it.label)}: ${n0(it.value)}"></i></span><span class="rv">${n0(it.value)}</span></div>`).join("")}</div>`;}

/* Scatter: points {x, y, label, color, ring} with axis labels. */
function scatter(o){
  const W=640,H=280,m={l:46,r:16,t:14,b:40},pw=W-m.l-m.r,ph=H-m.t-m.b,xs=o.points.map(p=>p.x),ys=o.points.map(p=>p.y);
  const x1=Math.max(...xs)*1.1||1,y1=Math.max(100,Math.max(...ys)),X=v=>m.l+(v/x1)*pw,Y=v=>m.t+ph-(v/y1)*ph;
  let s=`<svg class="ach" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label||"")}">`;
  [0,25,50,75,100].forEach(v=>{s+=`<line class="g" x1="${m.l}" x2="${W-m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tk" x="${m.l-6}" y="${Y(v)+4}" text-anchor="end">${v}</text>`;});
  [0,.25,.5,.75,1].forEach(f=>{const v=x1*f;s+=`<text class="tk" x="${X(v)}" y="${H-m.b+16}" text-anchor="middle">${n0(v)}</text>`;});
  s+=`<text class="ax" x="${m.l+pw/2}" y="${H-6}" text-anchor="middle">${esc(o.xLabel)}</text><text class="ax" transform="translate(12 ${m.t+ph/2}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`;
  o.points.forEach(p=>{s+=`<g><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.ring?9:7}" fill="${p.color}" fill-opacity=".85" stroke="${p.ring?"#13221C":"#fff"}" stroke-width="${p.ring?2.5:1.5}"><title>${esc(p.label)}: ${n0(p.x)} · risk ${n0(p.y)}</title></circle><text class="pl" x="${X(p.x)+11}" y="${Y(p.y)+4}">${esc(p.short||p.label)}</text></g>`;});
  return s+`<line class="b" x1="${m.l}" x2="${W-m.r}" y1="${Y(0)}" y2="${Y(0)}"/></svg>`;}

/* Line / forecast chart: x labels (categorical, evenly spaced), series {name, color, values, dash, band:{lo,hi}}.
   Bands draw a shaded range (e.g. a likely range, or the gap between two pathways). Hover shows every value at that x. */
function niceTicks(lo,hi){if(hi===lo){hi=lo+1;}const raw=(hi-lo)/4,mag=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/mag,st=(f<1.5?1:f<3?2:f<7?5:10)*mag,a=Math.floor(lo/st)*st,b=Math.ceil(hi/st)*st,t=[];for(let v=a;v<=b+st/2;v+=st){t.push(+v.toFixed(6));}return {lo:a,hi:b,t};}
let LID=0;const LDATA={};
function lines(o){
  const id="l"+(++LID),W=640,H=o.h||240,end=o.series.length>1&&o.endLabels!==false,m={l:46,r:end?92:18,t:16,b:30},n=o.x.length,pw=W-m.l-m.r,ph=H-m.t-m.b;
  const all=[];o.series.forEach(s=>{s.values.forEach(v=>{if(v!=null){all.push(v);}});if(s.band){s.band.lo.concat(s.band.hi).forEach(v=>{if(v!=null){all.push(v);}});}});(o.extra||[]).forEach(v=>all.push(v));
  if(!all.length){return '<p class="achnd">No data for this place.</p>';}
  const tk=niceTicks(o.yMin!=null?Math.min(o.yMin,...all):Math.min(...all),Math.max(...all)),X=i=>m.l+(n===1?pw/2:i*pw/(n-1)),Y=v=>m.t+ph-(v-tk.lo)/(tk.hi-tk.lo)*ph;
  let s=`<svg class="ach achline" viewBox="0 0 ${W} ${H}" data-lid="${id}" role="img" aria-label="${esc(o.label||"")}">`;
  tk.t.forEach(v=>{s+=`<line class="g" x1="${m.l}" x2="${W-m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tk" x="${m.l-8}" y="${Y(v)+4}" text-anchor="end">${n0(v)}</text>`;});
  /* x labels every `every` points, always the last one; the label before the last is dropped when the two would touch */
  const every=Math.max(1,Math.ceil(n/Math.max(2,Math.floor(pw/64)))),shown=o.x.map((_,i)=>i).filter(i=>i%every===0);
  if(shown.at(-1)!==n-1){if(n-1-shown.at(-1)<every*0.75){shown.pop();}shown.push(n-1);}
  shown.forEach(i=>{s+=`<text class="tk" x="${X(i)}" y="${H-8}" text-anchor="${i===0&&n>4?"start":i===n-1&&n>4?"end":"middle"}">${esc(o.x[i])}</text>`;});
  if(o.mean!=null){s+=`<line class="mean" x1="${m.l}" x2="${W-m.r}" y1="${Y(o.mean)}" y2="${Y(o.mean)}"/><text class="mt" x="${m.l+4}" y="${Y(o.mean)-5}">${esc(o.meanLabel||"average")} ${n0(o.mean)}</text>`;}
  o.series.forEach(sr=>{if(!sr.band){return;}const pts=sr.band.hi.map((v,i)=>v==null?null:[X(i),Y(v)]).filter(Boolean),lo=sr.band.lo.map((v,i)=>v==null?null:[X(i),Y(v)]).filter(Boolean).reverse();
    if(pts.length>1){s+=`<path d="M${pts.concat(lo).map(p=>p.join(",")).join("L")}Z" fill="${sr.color}" fill-opacity=".18"/>`;}});
  o.series.forEach(sr=>{const p=sr.values.map((v,i)=>v==null?null:[X(i),Y(v)]);let d="",pen=false;p.forEach(q=>{if(!q){pen=false;return;}d+=(pen?"L":"M")+q[0].toFixed(1)+","+q[1].toFixed(1);pen=true;});
    s+=`<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="${sr.w||2.5}" stroke-linejoin="round" stroke-linecap="round"${sr.dash?' stroke-dasharray="6 5"':""}/>`;
    if(n<=12){p.forEach(q=>{if(q){s+=`<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="${sr.color}" class="pt"/>`;}});}});
  if(end){const lab=o.series.map(sr=>{const i=sr.values.map((v,j)=>v==null?-1:j).filter(j=>j>=0).pop();return i==null?null:{y:Y(sr.values[i]),t:sr.name,c:sr.color};}).filter(Boolean).sort((a,b)=>a.y-b.y);
    for(let i=1;i<lab.length;i++){if(lab[i].y-lab[i-1].y<14){lab[i].y=lab[i-1].y+14;}}lab.forEach(l=>{s+=`<text class="el" x="${W-m.r+10}" y="${l.y+4}" fill="${l.c}">${esc(l.t)}</text>`;});}
  if(o.stripes){const sw=pw/n;o.stripes.forEach((c,i)=>{s+=`<rect x="${m.l+i*sw}" y="${H-m.b+2}" width="${sw+.5}" height="5" fill="${c}"/>`;});}
  s+=`<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t+ph}" style="opacity:0"/><rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
  LDATA[id]={o,X,W,m,pw,n,u:o.unit||""};
  return `<div class="achl">${o.series.map(sr=>`<span><i style="background:${sr.color}${sr.dash?";opacity:.6":""}"></i>${esc(sr.name)}</span>`).join("")}${o.series.some(sr=>sr.band)?`<span><i class="lk-band"></i>${esc(o.bandLabel||"range")}</span>`:""}</div>${s}`;}

/* Hover read-outs for line charts inside root (call after inserting the HTML). */
let TIP=null;
function wire(root){
  if(!TIP){TIP=document.createElement("div");TIP.className="achtip";TIP.hidden=true;document.body.appendChild(TIP);}
  (root||document).querySelectorAll("svg.achline").forEach(svg=>{const d=LDATA[svg.dataset.lid];if(!d||svg._w){return;}svg._w=1;const xh=svg.querySelector(".xh");
    const mv=e=>{const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)*(d.W/r.width),i=Math.max(0,Math.min(d.n-1,Math.round((x-d.m.l)/d.pw*(d.n-1)))),px=d.X(i);
      xh.setAttribute("x1",px);xh.setAttribute("x2",px);xh.style.opacity=1;
      TIP.innerHTML=`<b>${esc(d.o.x[i])}</b>`+d.o.series.map(sr=>sr.values[i]==null?"":`<div><i style="background:${sr.color}"></i>${esc(sr.name)}: <b>${n0(sr.values[i])}</b>${esc(d.u)}${sr.band&&sr.band.lo[i]!=null?` <span>(${n0(sr.band.lo[i])}–${n0(sr.band.hi[i])})</span>`:""}</div>`).join("");
      TIP.hidden=false;const w=TIP.offsetWidth,h=TIP.offsetHeight;let tx=e.clientX+14,ty=e.clientY-h-10;if(tx+w>innerWidth-8){tx=e.clientX-w-14;}if(ty<8){ty=e.clientY+16;}TIP.style.left=tx+"px";TIP.style.top=ty+"px";};
    svg.addEventListener("pointermove",mv);svg.addEventListener("pointerdown",mv);svg.addEventListener("pointerleave",()=>{xh.style.opacity=0;TIP.hidden=true;});});}

window.ACH={groupedBars,bullets,rankBars,scatter,lines,wire};
})();
