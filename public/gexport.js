/* Google Workspace export for the Impact page: "Export to Google Sheets" and "Create brief in Google Docs".
   Runs in the browser with the visitor's own Google account (Google Identity Services, drive.file scope, so the app can
   only see files it creates) and saves into their Drive. Uses the same rows as Download CSV. Off until the server has
   GOOGLE_OAUTH_CLIENT_ID. app.js calls GEXPORT.wire(snapshot) on the Impact page; snapshot() returns the plan's rows. */
(function(){
"use strict";
const SCOPE="https://www.googleapis.com/auth/drive.file";
const METHOD=["Measured values come from the open data sources; Your data from your files or inputs.",
  "Assumptions (lever effects with no open source) are marked and never presented as data.","Percentage cuts compound."];
let CFG=null,TC=null,TOKEN="",EXP=0,gisP=null,pending=null,busy=false,snapshot=null,say=t=>console.log(t);

async function config(){if(!CFG){try{CFG=await (await fetch("/api/google-config")).json();}catch(e){CFG={};}}return CFG;}
function loadGis(){
  if(gisP){return gisP;}
  gisP=new Promise((ok,no)=>{if(window.google&&google.accounts&&google.accounts.oauth2){ok();return;}
    const s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.async=true;s.onload=()=>ok();
    s.onerror=()=>{gisP=null;no(new Error("Google sign-in didn't load. Check the internet connection."));};document.head.appendChild(s);});
  return gisP;}
/* Must be called straight from the click (no await before it), or the browser blocks Google's sign-in pop-up. */
function token(){
  if(TOKEN&&Date.now()<EXP-60000){return Promise.resolve(TOKEN);}
  if(!(window.google&&google.accounts&&google.accounts.oauth2)){return Promise.reject(new Error("Google sign-in is still loading. Try again in a moment."));}
  return new Promise((ok,no)=>{pending={ok,no};
    if(!TC){TC=google.accounts.oauth2.initTokenClient({client_id:CFG.oauthClientId,scope:SCOPE,callback:()=>{},
      error_callback:e=>{if(pending){pending.no(new Error(e&&e.type==="popup_closed"?"Google sign-in was closed.":"Google sign-in failed or was blocked."));pending=null;}}});}
    TC.callback=r=>{if(!pending){return;}if(r.error){pending.no(new Error("Google sign-in was cancelled."));}else{TOKEN=r.access_token;EXP=Date.now()+(+r.expires_in||3600)*1000;pending.ok(TOKEN);}pending=null;};
    TC.requestAccessToken({prompt:TOKEN?"":"consent"});});}
async function g(url,body){
  const r=await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+TOKEN,"Content-Type":"application/json"},body:JSON.stringify(body||{})});
  const j=await r.json().catch(()=>({}));
  if(r.status===401){TOKEN="";}
  if(!r.ok){throw new Error((j.error&&j.error.message)||("Google returned an error ("+r.status+")."));}
  return j;}


async function toSheets(s){
  const title="Impact · "+s.entity+" · "+s.when.toLocaleDateString();
  const tabs=["Before vs after","Levers","Method & sources"];
  const ss=await g("https://sheets.googleapis.com/v4/spreadsheets",{properties:{title},sheets:tabs.map(t=>({properties:{title:t,gridProperties:{frozenRowCount:1}}}))});
  const about=[["Persona",s.persona],["Place",s.entity],["Plan",s.plan+(s.best?" (AI best fit)":"")],["Status",s.status],["Exported",s.when.toLocaleString()]]
    .concat(METHOD.map(x=>["Method",x]),s.nodata.map(n=>["Left out",n[0]+" ("+n[1]+")"]));
  await g("https://sheets.googleapis.com/v4/spreadsheets/"+ss.spreadsheetId+"/values:batchUpdate",{valueInputOption:"RAW",data:[
    {range:"'"+tabs[0]+"'!A1",values:[s.head].concat(s.rows)},
    {range:"'"+tabs[1]+"'!A1",values:[["Lever","Class"]].concat(s.levers.length?s.levers:[["None",""]])},
    {range:"'"+tabs[2]+"'!A1",values:[["Item","Detail"]].concat(about)}]});
  await g("https://sheets.googleapis.com/v4/spreadsheets/"+ss.spreadsheetId+":batchUpdate",{requests:ss.sheets.flatMap(sh=>[
    {repeatCell:{range:{sheetId:sh.properties.sheetId,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true}}},fields:"userEnteredFormat.textFormat.bold"}},
    {autoResizeDimensions:{dimensions:{sheetId:sh.properties.sheetId,dimension:"COLUMNS",startIndex:0,endIndex:7}}}])});
  return {url:ss.spreadsheetUrl,label:"Open in Google Sheets"};}

async function toDocs(s){
  const pol=s.pol,title=(pol?"Policy brief: ":"Brief: ")+s.entity;
  const met=s.rows.filter(r=>r[4]==="yes").length,parts=[];
  const add=(text,style,extra)=>parts.push(Object.assign({text:text+"\n",style:style||"NORMAL_TEXT"},extra||{}));
  add(title,"TITLE");
  add(s.persona+" · "+s.when.toLocaleDateString()+" · "+s.status,"SUBTITLE");
  add("Summary","HEADING_1");
  add((s.best?"The AI best fit":"The chosen plan")+" for "+s.entity+" ("+s.plan+") meets "+met+" of "+s.rows.length+" targets, against "+s.metBefore+" before the plan.");
  add("The plan","HEADING_1");
  (s.levers.length?s.levers:[["No levers chosen yet",""]]).forEach(l=>add(l[0]+(l[1]?" · "+l[1]:""),"NORMAL_TEXT",{bullet:true,bold:l[0].length}));
  add("Before and after","HEADING_1");
  s.rows.forEach(r=>add(r[0]+": "+r[1]+" → "+r[2]+" (target "+r[3]+", "+(r[4]==="yes"?"meets target":"misses target")+") · "+r[5],"NORMAL_TEXT",{bullet:true,bold:r[0].length}));
  if(s.nodata.length){add("Not covered","HEADING_1");s.nodata.forEach(n=>add(n[0]+" ("+n[1]+")","NORMAL_TEXT",{bullet:true}));}
  add("Method","HEADING_1");METHOD.forEach(x=>add(x,"NORMAL_TEXT",{bullet:true}));
  add("Sources","HEADING_1");[...new Set(s.rows.map(r=>r[6]).filter(Boolean))].forEach(x=>add(x,"NORMAL_TEXT",{bullet:true}));
  add("Made with Adaptation Strategist. Every number keeps its label: Measured, Your data, Estimate, Assumption or No data.");
  const doc=await g("https://docs.googleapis.com/v1/documents",{title});
  const req=[{insertText:{location:{index:1},text:parts.map(p=>p.text).join("")}}];
  let i=1;
  parts.forEach(p=>{const a=i,b=i+p.text.length;i=b;
    req.push({updateParagraphStyle:{range:{startIndex:a,endIndex:b},paragraphStyle:{namedStyleType:p.style},fields:"namedStyleType"}});
    if(p.bullet){req.push({createParagraphBullets:{range:{startIndex:a,endIndex:b-1},bulletPreset:"BULLET_DISC_CIRCLE_SQUARE"}});}
    if(p.bold){req.push({updateTextStyle:{range:{startIndex:a,endIndex:a+p.bold},textStyle:{bold:true},fields:"bold"}});}});
  await g("https://docs.googleapis.com/v1/documents/"+doc.documentId+":batchUpdate",{requests:req});
  return {url:"https://docs.google.com/document/d/"+doc.documentId+"/edit",label:"Open in Google Docs"};}

function run(btn,make){
  if(busy){return;}
  const out=document.getElementById("i-gout");
  if(!CFG||!CFG.oauthClientId){say("Google export isn't set up on this server. Add GOOGLE_OAUTH_CLIENT_ID (an OAuth web client ID) and restart.");return;}
  const s=snapshot(),old=btn.textContent;busy=true;btn.disabled=true;btn.textContent="Working…";
  token().then(()=>make(s)).then(r=>{if(out){out.innerHTML='Saved to your Google Drive: <a href="'+r.url+'" target="_blank" rel="noopener">'+r.label+'</a>';}say("Saved to your Google Drive.");if(window.STA){STA.event("export",{format:make===toSheets?"sheets":"docs"});}})
    .catch(e=>say(e.message||"Google export failed."))
    .finally(()=>{busy=false;btn.disabled=false;btn.textContent=old;});}

window.GEXPORT={wire(snap,toastFn){
  snapshot=snap;if(toastFn){say=toastFn;}
  const a=document.getElementById("i-sheets"),b=document.getElementById("i-docs");if(!a||!b){return;}
  config().then(c=>{if(c.oauthClientId){loadGis().catch(()=>{});}else{[a,b].forEach(x=>{x.title="Needs GOOGLE_OAUTH_CLIENT_ID on the server";});}});
  a.onclick=()=>run(a,toSheets);b.onclick=()=>run(b,toDocs);}};
})();
