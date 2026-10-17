/* Google Analytics 4 (the Firebase project's property), only with the visitor's consent.
   Nothing loads until the server gives a measurement ID (GA_MEASUREMENT_ID) and the visitor presses "Allow analytics";
   "No thanks" is remembered and nothing is ever sent. Events carry short codes only (persona, step, format, place id):
   never question text, names typed for approvals, or site names. GA4 does not log or store IP addresses. */
(function(){
"use strict";
const KEY="st-analytics";                     // "yes" | "no"; absent until the visitor chooses
let id="",loaded=false;const queue=[];
const get=()=>{try{return localStorage.getItem(KEY);}catch(e){return null;}};
const put=v=>{try{if(v){localStorage.setItem(KEY,v);}else{localStorage.removeItem(KEY);}}catch(e){}};
function gtag(){window.dataLayer.push(arguments);}
function load(){
  if(loaded||!id){return;}loaded=true;
  window.dataLayer=window.dataLayer||[];window.gtag=gtag;
  gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"granted"});
  gtag("js",new Date());
  gtag("config",id,{send_page_view:false});         // the app sends a page view for each screen itself (it changes screens without reloading)
  const s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(id);document.head.appendChild(s);
  queue.splice(0).forEach(a=>gtag.apply(null,a));}
function clean(p){const o={};Object.keys(p||{}).forEach(k=>{const v=p[k];if(typeof v==="number"||typeof v==="boolean"){o[k]=v;}else if(v!=null&&v!==""){o[k]=String(v).slice(0,100);}});return o;}
function bar(){
  if(document.getElementById("ga-bar")){return;}
  const b=document.createElement("div");b.id="ga-bar";b.className="ga-bar";b.setAttribute("role","region");b.setAttribute("aria-label","Usage analytics");
  b.innerHTML='<p><b>Help improve this demo?</b> Allow anonymous usage analytics (Google Analytics). It counts which screens and features are used; no questions, names or site details are sent.</p>'+
    '<div class="ctas"><button class="btn sm" type="button" data-ga="yes">Allow analytics</button><button class="btn alt sm" type="button" data-ga="no">No thanks</button></div>';
  b.addEventListener("click",e=>{const x=e.target.closest("[data-ga]");if(!x){return;}STA.choose(x.dataset.ga==="yes");});
  document.body.appendChild(b);}
const STA={
  init(measurementId){id=String(measurementId||"").trim();if(!/^G-[A-Z0-9]{4,20}$/.test(id)){id="";return;}
    const c=get();if(c==="yes"){load();}else if(c!=="no"){bar();}},
  enabled(){return !!id;},
  choice(){return get();},
  choose(yes){put(yes?"yes":"no");const b=document.getElementById("ga-bar");if(b){b.remove();}if(yes){load();STA.page(STA._last||"home");}},
  page(path,title){STA._last=path;STA.event("page_view",{page_title:title||document.title,page_location:location.href,page_path:"/"+path});},
  event(name,params){if(!id||get()!=="yes"){return;}const a=["event",name,clean(params)];if(loaded){gtag.apply(null,a);}else{queue.push(a);}}
};
window.STA=STA;
})();
