import {reportDate,validReportDate} from '../src/reporting-model.js';
export const HOSTNAME='filozofiku.github.io';
const BEACON_TOKEN='dbaf5970dd9649848c810f4c245f57ad';
const identifier=value=>typeof value==='string'&&/^[a-f0-9]{32}$/i.test(value);

// Calendar days in Prishtina/Tirana, including 23/25-hour DST transition days.
export function localMidnight(date){
  if(!validReportDate(date))throw Error('invalid-traffic-date');
  const target=Date.parse(date+'T00:00:00Z');let result=target;
  for(let i=0;i<4;i++){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Tirane',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(result).map(p=>[p.type,p.value]));
    const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    if(represented===target)return new Date(result).toISOString();result+=target-represented;
  }
  throw Error('invalid-traffic-midnight');
}
export const nextDate=date=>new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
export async function cloudflareRequest(token,path,body,request=fetch){
  const response=await request('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('cloudflare-http-'+response.status);
  const data=await response.json();
  if(data.errors?.length||data.success===false)throw Error('cloudflare-query-failed');
  return data;
}
export async function findSiteTag(token,accountId,request=fetch){
  if(!identifier(accountId))throw Error('invalid-cloudflare-account-id');
  let page=1;
  do{
    const data=await cloudflareRequest(token,`/accounts/${accountId}/rum/site_info/list?page=${page}&per_page=100`,undefined,request);
    const site=data.result?.find(s=>s.site_token===BEACON_TOKEN);
    if(site){if(!identifier(site.site_tag))throw Error('invalid-cloudflare-site-tag');return site.site_tag;}
    if(page>=(data.result_info?.total_pages||1))break;
    page++;
  }while(page<=20);
  throw Error('cloudflare-site-not-found');
}
export async function resolveCloudflareSite({token,accountId,siteTag,request=fetch}){
  if(accountId)return {accountId,siteTag:siteTag||await findSiteTag(token,accountId,request)};
  // Account Settings Read is already needed for site discovery. Prefer the exact
  // installed beacon token over asking an administrator to identify API tags.
  for(let page=1;page<=20;page++){
    const response=await cloudflareRequest(token,`/accounts?page=${page}&per_page=50`,undefined,request);
    for(const account of response.result||[])try{return {accountId:account.id,siteTag:await findSiteTag(token,account.id,request)};}catch(error){if(error.message!=='cloudflare-site-not-found')throw error;}
    if(page>=(response.result_info?.total_pages||1))break;
  }
  throw Error('cloudflare-site-not-found');
}
export async function fetchTrafficDay({token,accountId,siteTag,date,now=Date.now(),request=fetch}){
  if(!identifier(accountId)||!identifier(siteTag))throw Error('invalid-cloudflare-identifiers');
  const start=localMidnight(date),end=localMidnight(nextDate(date));
  if(Date.parse(start)>=now)throw Error('future-traffic-date');
  const complete=Date.parse(end)<=now,until=complete?end:new Date(now).toISOString();
  const filter=`{siteTag:${JSON.stringify(siteTag)},requestHost:${JSON.stringify(HOSTNAME)},datetime_geq:${JSON.stringify(start)},datetime_lt:${JSON.stringify(until)},bot:0}`;
  const query=`{viewer{accounts(filter:{accountTag:${JSON.stringify(accountId)}}){total:rumPageloadEventsAdaptiveGroups(limit:1,filter:${filter}){count sum{visits} avg{sampleInterval}} paths:rumPageloadEventsAdaptiveGroups(limit:500,orderBy:[count_DESC],filter:${filter}){count dimensions{requestPath}}}}}`;
  const data=await cloudflareRequest(token,'/graphql',{query},request);
  const account=data.data?.viewer?.accounts?.[0];
  if(!account||!Array.isArray(account.total)||!Array.isArray(account.paths))throw Error('invalid-cloudflare-response');
  if(account.paths.length>=500)throw Error('too-many-traffic-paths');
  const total=account.total[0],pageViews=total?.count??0,visits=total?.sum?.visits??0;
  if(!Number.isFinite(pageViews)||pageViews<0||!Number.isFinite(visits)||visits<0)throw Error('invalid-cloudflare-counts');
  const paths=new Map();
  for(const row of account.paths){
    if(!Number.isFinite(row.count)||row.count<0||typeof row.dimensions?.requestPath!=='string')throw Error('invalid-cloudflare-path');
    // Do not copy query parameters or personal deep-link details into reports.
    const path=row.dimensions.requestPath.split(/[?#]/)[0]||'/';
    if(!path.startsWith('/')||path.length>500)throw Error('invalid-cloudflare-path');
    paths.set(path,(paths.get(path)||0)+row.count);
  }
  return {date,visits,pageViews,paths:[...paths].map(([path,pageViews])=>({path,pageViews})).sort((a,b)=>b.pageViews-a.pageViews),complete,source:'cloudflare',timezone:'Europe/Tirane',sampled:(total?.avg?.sampleInterval||1)>1};
}
export function datesToSync({now=new Date(),days=7,startDate='2026-11-15'}={}){
  if(!validReportDate(startDate)||!Number.isInteger(days)||days<1||days>30)throw Error('invalid-sync-range');
  const today=reportDate(now),earliest=new Date(Date.parse(today+'T12:00:00Z')-(days-1)*86400000).toISOString().slice(0,10),dates=[];
  for(let d=earliest<startDate?startDate:earliest;d<=today;d=nextDate(d))dates.push(d);
  return dates;
}
