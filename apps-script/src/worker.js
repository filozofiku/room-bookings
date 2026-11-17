import {requestBudget,quotaDay} from '../../mailer/read-budget.js';
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
async function database(request=http){
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
 const db=firestoreRest(config.projectId,token,request);
 const originalCollection=db.collection;
 db.collection=name=>['periods','rooms'].includes(name)?{get:async()=>({docs:(await references({collection:originalCollection},name)).map(data=>({id:data.id,data:()=>data}))})}:originalCollection(name);
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
 const budget=requestBudget(http,props);
 const report={checkedAt:new Date().toISOString(),mode:checkOnly?'check':'send',pending:0,sent:0,errors:0,deferred:false,quota:MailApp.getRemainingDailyQuota()};
 try{
  if(!checkOnly&&props.getProperty('QUOTA_BLOCKED_DAY')===quotaDay(Date.now()))return {quotaPaused:true};
  budget.ensure(1);
  const window=publicEventWeek(Date.now());
  const scanQueues=checkOnly||Date.now()-Number(props.getProperty('LAST_QUEUE_SCAN')||0)>=300000;
  const initialPublic=Date.now()>=window.dueAt&&props.getProperty('PUBLIC_DONE_WEEK')!==window.start;
  if(!scanQueues&&!initialPublic)return {idle:true};
  const db=await database(budget.request);
  const queues=['requestNotifications','requestDecisions','studentChangeNotifications','studentNotifications','cancellationNotifications','modificationNotifications'];
  const queue=[];if(scanQueues)for(const name of queues)queue.push(...await db.pending(name));report.pending=queue.length;
  let retries=[];
  if(scanQueues&&!initialPublic)for(const ref of await db.pending('publicEventDeliveries')){
   const data=(await ref.get()).data();if(data?.weekStart===window.start)retries.push(data.recipient);
  }
  const processPublic=checkOnly||initialPublic||retries.length>0;
  const settings=processPublic?(await db.doc('mailSettings/publicEvents').get()).data():null;
  const periods=processPublic?await references(db,'periods'):[];
  const week=settings?.enabled?await preparePublicWeek(db,Date.now(),periods,{create:!checkOnly}):null;
  report.publicEventsDue=week?.bookingIds.length||0;report.publicWeek=week?.start||null;
  if(checkOnly){await db.doc('publicEventRecipients/_health').get();report.message='Connection verified. No email sent.';return report;}
  let remaining=report.quota;
  const exhausted=()=>Date.now()>=deadline||remaining<=0||report.sent>=50;
  const send=async mail=>{
   if(exhausted())throw Object.assign(Error('Worker budget exhausted'),{code:'worker-budget'});
   // Leave enough budget to record acceptance before any further delivery.
   budget.ensure(12,3);
   MailApp.sendEmail({to:mail.to,subject:mail.subject,body:mail.text,htmlBody:emailHtml(mail.text,mail.descriptionSections),name:'Fakulteti Filozofik · Universiteti i Prishtinës'});
   remaining--;report.sent++;
  };
  for(const ref of queue){
   if(exhausted()){report.deferred=true;break;}
   try{await deliverCancellation(ref,{db,auth:{getUser:async uid=>(await db.doc('users/'+uid).get()).data()||{}},send,now:Date.now,timestamp,token:Utilities.getUuid()});if((await ref.get()).data()?.status==='failed')report.errors++;}
   catch(error){if(['worker-budget','RESOURCE_EXHAUSTED'].includes(error.code))throw error;report.errors++;}
  }
  if(scanQueues)props.setProperty('LAST_QUEUE_SCAN',String(Date.now()));
  if(week&&!exhausted()){
   const rooms=await references(db,'rooms'),catalog=(await db.doc('resourceCatalog/current').get()).data()||{};
   const recipients=initialPublic?(settings.recipients||[]):[...new Set(retries)].filter(r=>settings.recipients.includes(r));
   const cursor=initialPublic&&props.getProperty('PUBLIC_CURSOR_WEEK')===week.start?Number(props.getProperty('PUBLIC_CURSOR')||0):0;
   for(let index=cursor;index<recipients.length;index++){
    if(exhausted()){report.deferred=true;break;}
    try{await deliverPublicWeek(week,recipients[index],{db,periods,rooms,catalog,send,now:Date.now,token:Utilities.getUuid()});}
    catch(error){if(['worker-budget','RESOURCE_EXHAUSTED'].includes(error.code))throw error;report.errors++;}
    if(initialPublic){props.setProperty('PUBLIC_CURSOR_WEEK',week.start);props.setProperty('PUBLIC_CURSOR',String(index+1));}
   }
   if(initialPublic&&!report.deferred)props.setProperty('PUBLIC_DONE_WEEK',week.start);
  }else if(week)report.deferred=true;
  else if(initialPublic)props.setProperty('PUBLIC_DONE_WEEK',window.start);
  report.quotaRemaining=remaining;
  if(report.errors)throw Error('Some notifications failed; inspect Statusi i njoftimeve me email.');
  return report;
 }catch(error){
  if(error.code==='worker-budget'){report.deferred=true;report.databaseBudgetReached=true;return report;}
  report.failure=true;report.failureCode=['RESOURCE_EXHAUSTED','PERMISSION_DENIED','UNAUTHENTICATED','UNAVAILABLE'].includes(error.code)?error.code:'WORKER_ERROR';
  if(error.code==='RESOURCE_EXHAUSTED')props.setProperty('QUOTA_BLOCKED_DAY',quotaDay(Date.now()));
  throw error;
 }finally{report.databaseUsage=budget.snapshot();report.durationMs=Date.now()-started;props.setProperty('LAST_RUN',JSON.stringify(report));console.log(JSON.stringify(report));lock.releaseLock();}
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
