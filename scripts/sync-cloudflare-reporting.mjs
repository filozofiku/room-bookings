// API credentials stay in the job environment. The browser reads aggregate snapshots only.
import {resolveCloudflareSite,fetchTrafficDay,datesToSync,HOSTNAME} from './cloudflare-reporting.mjs';
import {encode} from '../mailer/firestore-rest.js';
import config from '../public-schedule/firebase-config.js';
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Usage: node scripts/sync-cloudflare-reporting.mjs [--apply]');
const token=process.env.CLOUDFLARE_ANALYTICS_API_TOKEN;
if(!token)throw Error('Set CLOUDFLARE_ANALYTICS_API_TOKEN');
let firebaseToken;
async function commit(path,values){
  const fields=encode(values).mapValue.fields;
  const transforms=[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}];
  if(values.status==='ready')transforms.push({fieldPath:'lastSuccessAt',setToServerValue:'REQUEST_TIME'});
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents:commit`,{method:'POST',headers:{Authorization:`Bearer ${firebaseToken}`,'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:`projects/${config.projectId}/databases/(default)/documents/${path}`,fields},updateMask:{fieldPaths:Object.keys(fields)},updateTransforms:transforms}]}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('reporting-firestore-write-'+response.status);
}
try{
  if(apply){
    const refresh=process.env.REPORTING_FIREBASE_REFRESH_TOKEN;
    if(!refresh)throw Error('Missing REPORTING_FIREBASE_REFRESH_TOKEN');
    const response=await fetch(`https://securetoken.googleapis.com/v1/token?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh}),signal:AbortSignal.timeout(30000)});
    const auth=await response.json();
    if(!response.ok||auth.user_id!=='reporting-worker'||!auth.id_token)throw Error('reporting-worker-authentication-failed');firebaseToken=auth.id_token;
  }
  const {accountId,siteTag}=await resolveCloudflareSite({token,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,siteTag:process.env.CLOUDFLARE_SITE_TAG});
  const days=datesToSync({days:Number(process.env.REPORTING_SYNC_DAYS||7),startDate:process.env.REPORTING_START_DATE||'2026-11-15'});
  // Fetch every day successfully before replacing any cache documents.
  const snapshots=[];
  for(const date of days)snapshots.push(await fetchTrafficDay({token,accountId,siteTag,date}));
  if(apply){
    for(const {date,...values} of snapshots)await commit('trafficDaily/'+date,values);
    await commit('reportSettings/traffic',{status:'ready',errorCode:'',hostname:HOSTNAME,lastCompleteDate:snapshots.filter(d=>d.complete).at(-1)?.date||''});
  }
  console.log(JSON.stringify({apply,days:snapshots.length,pageViews:snapshots.reduce((n,d)=>n+d.pageViews,0),visits:snapshots.reduce((n,d)=>n+d.visits,0)}));
}catch(error){
  const code=/^(cloudflare-|invalid-|too-many-|reporting-|future-)/.test(error.message)?error.message:'traffic-sync-failed';
  if(firebaseToken)try{await commit('reportSettings/traffic',{status:'error',errorCode:code,hostname:HOSTNAME});}catch{}
  console.error('Traffic reporting sync failed: '+code);process.exitCode=1;
}
