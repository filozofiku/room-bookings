import {emailHtml} from '../../mailer/email-format.js';
import config from '../../public-schedule/firebase-config.js';
import {firestoreRest,timestamp} from '../../mailer/firestore-rest.js';
import {deliverCancellation} from '../../mailer/cancellation-email.js';
import {deliverPublicWeek,preparePublicWeek,publicEventWeek} from '../../mailer/public-event-email.js';
const SENDER='zzha.filozofik@uni-pr.edu';
const HANDLER='runEmailWorker';
function account(){if(Session.getEffectiveUser().getEmail().toLowerCase()!==SENDER)throw Error('Open this project and run it as '+SENDER);}
function http(url,options={}){
 const response=UrlFetchApp.fetch(url,{method:options.method||'GET',headers:options.headers||{},...(options.body?{payload:options.body}:{}),muteHttpExceptions:true,followRedirects:false});
 return {ok:response.getResponseCode()>=200&&response.getResponseCode()<300,json:()=>JSON.parse(response.getContentText())};
}
async function database(){
 const properties=PropertiesService.getScriptProperties(),refresh=properties.getProperty('FIREBASE_REFRESH_TOKEN');
 if(!refresh)throw Error('Set FIREBASE_REFRESH_TOKEN in Script properties.');
 const cached=CacheService.getScriptCache().get('firebase-worker-token');
 let token=cached;
 if(!token){
  const response=http('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=refresh_token&refresh_token='+encodeURIComponent(refresh)});
  const data=response.json();if(!response.ok||data.user_id!=='cancellation-mail-worker'||!data.id_token)throw Error('Firebase worker authentication failed. Check the private token.');
  token=data.id_token;if(data.refresh_token)properties.setProperty('FIREBASE_REFRESH_TOKEN',data.refresh_token);
  CacheService.getScriptCache().put('firebase-worker-token',token,3000);
 }
 const db=firestoreRest(config.projectId,token,http);
 return db;
}
// Cache only public reference data, never recipient lists or OAuth tokens.
async function references(db,collection){
 const cache=CacheService.getScriptCache(),key='mailer-reference-v1-'+collection,cached=cache.get(key);
 if(cached){try{return JSON.parse(cached);}catch{}}
 const data=(await db.collection(collection).get()).docs.map(d=>({id:d.id,...d.data()}));
 cache.put(key,JSON.stringify(data),3600);return data;
}
export async function run(checkOnly=false){
 account();const props=PropertiesService.getScriptProperties();
 if(!checkOnly&&props.getProperty('EMAIL_ENABLED')!=='true'){console.log('Email worker paused.');return {paused:true};}
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {busy:true};
 const started=Date.now(),deadline=started+180000;
 const report={checkedAt:new Date().toISOString(),mode:checkOnly?'check':'send',pending:0,sent:0,errors:0,deferred:false,quota:MailApp.getRemainingDailyQuota()};
 try{
  const db=await database();
  // Reviewer requests are first, followed by decisions, cancellations and changes.
  const queues=['studentChangeNotifications','studentNotifications','requestNotifications','requestDecisions','cancellationNotifications','modificationNotifications'];
  const queue=[];for(const name of queues)queue.push(...await db.pending(name));report.pending=queue.length;
  const window=publicEventWeek(Date.now());
  const checkPublic=checkOnly || (Date.now()>=window.dueAt && Date.now()>=Number(props.getProperty('PUBLIC_SCAN_AFTER')||0));
  const settings=checkPublic?(await db.doc('mailSettings/publicEvents').get()).data():null;
  const periods=checkPublic?await references(db,'periods'):[];
  const week=settings?.enabled?await preparePublicWeek(db,Date.now(),periods,{create:!checkOnly}):null;
  if(checkOnly){
   await db.collection('publicEventRecipients').get();
   await db.publicReceipts(publicEventWeek(Date.now()).start);
  }
  report.publicEventsDue=week?.bookingIds.length||0;
  report.publicWeek=week?.start||null;
  if(checkOnly){report.message='Connection verified. No email sent.';return report;}
  let remaining=report.quota;
  const exhausted=()=>Date.now()>=deadline||remaining<=0||report.sent>=50;
  const send=async mail=>{
   // No recipient or message body comes from an HTTP request or browser.
   if(exhausted())throw Object.assign(Error('Worker budget exhausted'),{code:'worker-budget'});
   MailApp.sendEmail({to:mail.to,subject:mail.subject,body:mail.text,htmlBody:emailHtml(mail.text,mail.descriptionSections),name:'Fakulteti Filozofik · Universiteti i Prishtinës'});
   remaining--;report.sent++;
  };
  for(const ref of queue){
   if(exhausted()){report.deferred=true;break;}
   try{await deliverCancellation(ref,{db,auth:{getUser:async uid=>(await db.doc('users/'+uid).get()).data()||{}},send,now:Date.now,timestamp,token:Utilities.getUuid()});
    if((await ref.get()).data()?.status==='failed')report.errors++;
   }catch{report.errors++;}
  }
  if(week&&!exhausted()){
   const rooms=await references(db,'rooms');
   const catalog=(await db.doc('resourceCatalog/current').get()).data()||{};
   const finished=new Set((await db.publicReceipts(week.start)).filter(r=>['sent','failed','skipped'].includes(r.status)).map(r=>r.recipient));
   for(const recipient of settings.recipients||[]){
    if(finished.has(recipient))continue;
    if(exhausted()){report.deferred=true;break;}
    try{await deliverPublicWeek(week,recipient,{db,periods,rooms,catalog,send,now:Date.now,token:Utilities.getUuid()});}catch{report.errors++;}
   }
  }else if(week)report.deferred=true;
  // Once the weekly run is finished, scan hourly for explicit retries instead
  // of rereading every recipient receipt every minute for the rest of the week.
  if(checkPublic)props.setProperty('PUBLIC_SCAN_AFTER',String(Date.now()+(report.deferred||report.errors?60000:3600000)));
  report.quotaRemaining=remaining;
  if(report.errors)throw Error('Some notifications failed; inspect Statusi i njoftimeve me email.');
  return report;
 }catch(error){report.failure=true;report.failureCode=['RESOURCE_EXHAUSTED','PERMISSION_DENIED','UNAUTHENTICATED','UNAVAILABLE'].includes(error.code)?error.code:'WORKER_ERROR';throw error;}
 finally{
  report.durationMs=Date.now()-started;
  props.setProperty('LAST_RUN',JSON.stringify(report));console.log(JSON.stringify(report));lock.releaseLock();
 }
}
export async function install(){
 await run(true); // Verify account, Firebase access and required permissions first.
 remove();PropertiesService.getScriptProperties().setProperty('EMAIL_ENABLED','true');
 ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(1).create();
 console.log('Enabled: checks every minute. Pending emails may now be sent.');
}
export function remove(){
 account();PropertiesService.getScriptProperties().setProperty('EMAIL_ENABLED','false');
 for(const trigger of ScriptApp.getProjectTriggers())if(trigger.getHandlerFunction()===HANDLER)ScriptApp.deleteTrigger(trigger);
 console.log('Apps Script email worker paused.');
}
export function status(){account();console.log(PropertiesService.getScriptProperties().getProperty('LAST_RUN')||'No runs yet.');}
