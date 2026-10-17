/* Climate timelapse for Earth view, in the style of Google Earth Timelapse: a cloud-free satellite globe (NASA Blue
   Marble, or Black Marble city lights; public domain, served by NASA GIBS), every place as a glowing ring sized and
   coloured by its overall climate risk, and a timeline that plays Today → 2030 → 2050. A pure view: app.js passes the
   scores it already shows and nothing is recalculated; rings only animate between the three published horizons. */
(function(){
"use strict";
const STEPS=[["today","Today",2025],["2030","2030",2030],["2050","2050",2050]];
const Y0=2025,Y1=2050,pos=y=>(y-Y0)/(Y1-Y0)*100;
const RISK=c=>c==null?"#9AA5A0":c<35?"#38D39F":c<55?"#F3C440":c<70?"#FF8B3D":"#FF4B4B";
const BAND=c=>c==null?"No data":c<35?"Low":c<55?"Moderate":c<70?"High":"Severe";
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const GIBS=(layer,fmt)=>`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.${fmt}`;
const BASES={day:{name:"Satellite",url:GIBS("BlueMarble_NextGeneration","jpeg"),attr:'Imagery: NASA Blue Marble via <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">GIBS</a>'},
  night:{name:"City lights",url:GIBS("VIIRS_CityLights_2012","jpg"),attr:'Imagery: NASA Black Marble (VIIRS, 2012) via <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">GIBS</a>'}};
function thumb(lat,lon){const z=6,n=2**z,r=lat*Math.PI/180,x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);
  return BASES.day.url.replace("{z}",z).replace("{y}",y).replace("{x}",x);}
let LP=null;
function loadL(){if(window.L&&L.map){return Promise.resolve();}if(LP){return LP;}const B="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  LP=new Promise((ok,no)=>{const l=document.createElement("link");l.rel="stylesheet";l.href=B+"leaflet.min.css";document.head.appendChild(l);
    const s=document.createElement("script");s.src=B+"leaflet.min.js";s.onload=()=>ok();s.onerror=()=>{LP=null;no(new Error("The map library didn't load."));};document.head.appendChild(s);});
  return LP;}

function mount(root,D){
  const st=Object.assign({h:"2050",p:"high",sel:null,base:"day",playing:false,speed:1,q:""},D.state||{});
  const key=()=>st.h+"|"+st.p,cOf=pl=>pl.comp[key()],idx=()=>STEPS.findIndex(s=>s[0]===st.h);
  let map=null,base=null,timer=null;const mk={};
  root.innerHTML=`<div class="tl">
    <aside class="tl-side" aria-label="Places"><div class="tl-sh"><h2>Climate timelapse</h2><p>${D.places.length} places · overall climate risk from open data</p>
      <input type="search" id="tl-q" placeholder="Find a place" aria-label="Find a place"></div><div class="tl-list" id="tl-list"></div></aside>
    <div class="tl-main"><div class="tl-map" id="tl-map"></div>
      <button class="tl-fold" type="button" id="tl-fold" aria-label="Hide the list">◀</button>
      <div class="tl-banner" id="tl-banner" aria-live="polite"></div>
      <div class="tl-base" role="group" aria-label="Imagery"><button type="button" data-b="day">Satellite</button><button type="button" data-b="night">City lights</button></div>
      <div class="tl-card" id="tl-card" hidden></div>
      <div class="tl-legend">${[["Low",20],["Moderate",45],["High",62],["Severe",80]].map(x=>`<span><i style="background:${RISK(x[1])}"></i>${x[0]}</span>`).join("")}<span class="tl-lg2">Ring size = overall risk</span></div>
      <div class="tl-bar" role="group" aria-label="Timeline">
        <button class="tl-play" type="button" id="tl-play" aria-label="Play"></button><button class="tl-nav" type="button" id="tl-prev" aria-label="Previous">‹</button>
        <div class="tl-track"><div class="tl-rail"></div><div class="tl-head" id="tl-head"></div>
          ${[2035,2040,2045].map(y=>`<span class="tl-tick" style="left:${pos(y)}%">${y}</span>`).join("")}
          ${STEPS.map(s=>`<button type="button" class="tl-step" data-s="${s[0]}" style="left:${pos(s[2])}%">${s[1]}</button>`).join("")}</div>
        <button class="tl-nav" type="button" id="tl-next" aria-label="Next">›</button>
        <div class="tl-pw" role="group" aria-label="Emissions pathway"><button type="button" data-p="mod">SSP2-4.5</button><button type="button" data-p="high">SSP5-8.5</button></div>
        <button class="tl-speed" type="button" id="tl-speed">1×</button></div></div></div>`;
  const $=id=>root.querySelector("#"+id);
  const alive=()=>document.body.contains(root);

  function spark(pl){const v=STEPS.map(s=>pl.comp[s[0]+"|"+st.p]),pts=v.map((c,i)=>c==null?null:[4+i*26,16-(c/100)*13]);
    return `<svg width="60" height="18" aria-hidden="true"><path d="${pts.filter(Boolean).map((p,i)=>(i?"L":"M")+p.join(",")).join("")}" fill="none" stroke="#9FB4A8" stroke-width="1.5"/>${pts.map((p,i)=>p?`<circle cx="${p[0]}" cy="${p[1]}" r="${i===idx()?3.2:2.2}" fill="${RISK(v[i])}"/>`:"").join("")}</svg>`;}
  function list(){const q=st.q.toLowerCase(),L=D.places.filter(p=>!q||(p.n+" "+p.c).toLowerCase().includes(q)).sort((a,b)=>(cOf(b)??-1)-(cOf(a)??-1));
    $("tl-list").innerHTML=L.map(p=>{const c=cOf(p);return `<button type="button" class="tl-it${p.id===st.sel?" on":""}" data-id="${p.id}"><img loading="lazy" alt="" src="${thumb(p.lat,p.lon)}"><span class="tl-tx"><b>${esc(p.n)}</b><small>${esc(p.c)}</small>${spark(p)}</span><span class="tl-pill" style="background:${RISK(c)}">${c??"–"}</span></button>`;}).join("")||'<p class="tl-empty">No place matches.</p>';
    $("tl-list").querySelectorAll(".tl-it").forEach(b=>b.onclick=()=>select(b.dataset.id,true));}
  function banner(){const cs=D.places.map(cOf).filter(c=>c!=null),hi=cs.filter(c=>c>=55).length,top=D.places.filter(p=>cOf(p)!=null).sort((a,b)=>cOf(b)-cOf(a))[0];
    $("tl-banner").innerHTML=`<b>${esc(D.scen(st.h,st.p))}</b> · ${hi} of ${cs.length} places at high or severe climate risk${top?` · highest: ${esc(top.n)} (${cOf(top)})`:""}`;}
  function bar(){const i=idx();$("tl-head").style.left=pos(STEPS[i][2])+"%";
    root.querySelectorAll(".tl-step").forEach(b=>b.classList.toggle("on",b.dataset.s===st.h));
    root.querySelectorAll(".tl-pw button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.p===st.p)));
    root.querySelectorAll(".tl-base button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.b===st.base)));
    $("tl-play").innerHTML=st.playing?'<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor"/></svg>':'<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>';
    $("tl-play").setAttribute("aria-label",st.playing?"Pause":"Play");$("tl-speed").textContent=st.speed+"×";
    $("tl-prev").disabled=i===0;$("tl-next").disabled=i===STEPS.length-1;}
  function rings(){D.places.forEach(p=>{const m=mk[p.id];if(!m){return;}const el=m.getElement();if(!el){return;}const c=cOf(p),d=c==null?8:12+c*.44,col=RISK(c);
    const dot=el.querySelector(".tl-dot"),gl=el.querySelector(".tl-glow");dot.style.width=dot.style.height=d+"px";dot.style.background=col;dot.style.boxShadow=`0 0 0 2px rgba(255,255,255,.9),0 0 ${8+d*.4}px ${2+d*.12}px ${col}`;
    gl.style.width=gl.style.height=(d*1.9)+"px";gl.style.borderColor=col;el.classList.toggle("sel",p.id===st.sel);
    m.setZIndexOffset(p.id===st.sel?2000:Math.round(c||0));
    el.querySelector(".tl-lb").textContent=p.n+(c!=null?" · "+c:"");});}
  function card(){const c=$("tl-card"),p=D.places.find(x=>x.id===st.sel);if(!p){c.hidden=true;return;}const sc=p.sc[key()],v=cOf(p),t0=p.comp["today|"+st.p];
    c.hidden=false;c.innerHTML=`<button class="tl-x" type="button" aria-label="Close">×</button><span class="tl-ey">${esc(p.c)}</span><h3>${esc(p.n)}</h3>
      <div class="tl-big"><b>${v??"–"}</b><span class="tl-pill" style="background:${RISK(v)}">${BAND(v)}</span>${st.h!=="today"&&t0!=null&&v!=null?`<small>${v>=t0?"▲":"▼"} from ${t0} today</small>`:""}</div>
      <div class="tl-pet">${D.petal(sc,"Hazard petals for "+p.n)}</div>
      <ul>${p.dc!=null?`<li>${p.dc} data centres within 50 km</li>`:""}${p.gc?`<li>Grid ${p.gc.g} g CO₂/kWh (${p.gc.year})</li>`:""}<li>${esc(D.scen(st.h,st.p))}</li></ul>
      <button class="tl-go" type="button">Place detail →</button>`;
    c.querySelector(".tl-x").onclick=()=>{st.sel=null;sync();};c.querySelector(".tl-go").onclick=()=>D.openPlace(p.id);}
  function sync(){if(!alive()){stop();return;}list();banner();bar();rings();card();if(D.onState){D.onState({h:st.h,p:st.p,sel:st.sel});}}
  function select(id,fly){st.sel=id;sync();const p=D.places.find(x=>x.id===id);if(fly&&p&&map){map.flyTo([p.lat,p.lon],Math.max(map.getZoom(),5),{duration:1.2});}}
  function step(d){const i=Math.max(0,Math.min(STEPS.length-1,idx()+d));st.h=STEPS[i][0];sync();}
  function stop(){st.playing=false;clearTimeout(timer);timer=null;}
  function tick(){if(!alive()||!st.playing){return;}const i=idx();st.h=STEPS[(i+1)%STEPS.length][0];sync();timer=setTimeout(tick,(st.h==="today"?1600:2400)/st.speed);}
  function setBase(b){st.base=b;if(!map){return;}if(base){map.removeLayer(base);}base=L.tileLayer(BASES[b].url,{maxNativeZoom:8,maxZoom:10,attribution:BASES[b].attr}).addTo(map);bar();}

  $("tl-q").oninput=e=>{st.q=e.target.value;list();};
  $("tl-fold").onclick=()=>{const t=root.querySelector(".tl").classList.toggle("folded");$("tl-fold").textContent=t?"▶":"◀";$("tl-fold").setAttribute("aria-label",t?"Show the list":"Hide the list");if(map){setTimeout(()=>map.invalidateSize(),260);}};
  $("tl-play").onclick=()=>{if(st.playing){stop();bar();}else{st.playing=true;bar();timer=setTimeout(tick,500);}};
  $("tl-prev").onclick=()=>{stop();step(-1);};$("tl-next").onclick=()=>{stop();step(1);};
  $("tl-speed").onclick=()=>{st.speed=st.speed===1?2:st.speed===2?0.5:1;bar();};
  root.querySelectorAll(".tl-step").forEach(b=>b.onclick=()=>{stop();st.h=b.dataset.s;sync();});
  root.querySelectorAll(".tl-pw button").forEach(b=>b.onclick=()=>{st.p=b.dataset.p;sync();});
  root.querySelectorAll(".tl-base button").forEach(b=>b.onclick=()=>setBase(b.dataset.b));
  sync();
  loadL().then(()=>{if(!alive()){return;}
    map=L.map($("tl-map"),{zoomControl:false,worldCopyJump:true,minZoom:2,attributionControl:true});L.control.zoom({position:"topright"}).addTo(map);
    setBase(st.base);
    D.places.forEach(p=>{mk[p.id]=L.marker([p.lat,p.lon],{keyboard:true,title:p.n,icon:L.divIcon({className:"tl-mk",iconSize:[0,0],html:'<i class="tl-glow"></i><i class="tl-dot"></i><b class="tl-lb"></b>'})}).addTo(map).on("click",()=>select(p.id,false));});
    map.fitBounds(L.latLngBounds(D.places.map(p=>[p.lat,p.lon])),{padding:[40,40],maxZoom:5});
    rings();
  }).catch(e=>{$("tl-map").innerHTML=`<p class="tl-err">${esc(e.message)} The timeline and list still work.</p>`;});
  return {stop};}

window.TIMELAPSE={mount};
})();
