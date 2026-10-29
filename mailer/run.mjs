import nodemailer from 'nodemailer';
import {randomUUID} from 'node:crypto';
import config from '../public-schedule/firebase-config.js';
import {firestoreRest,timestamp} from './firestore-rest.js';
import {localDate} from '../public-schedule/booking-model.js';
import {notificationDue,deliverPublicEvent} from './public-event-email.js';
import {deliverCancellation} from './cancellation-email.js';
const mode=process.argv[2] || 'check';
if(!['check','check-public','send','verify-smtp'].includes(mode))throw Error('Expected check, check-public, send or verify-smtp');
const refreshToken=process.env.CANCELLATION_FIREBASE_REFRESH_TOKEN;
if(!refreshToken)throw Error('Missing CANCELLATION_FIREBASE_REFRESH_TOKEN');
const response=await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`,{
 method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
 body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}),signal:AbortSignal.timeout(30000)
});
const auth=await response.json();
if(!response.ok || auth.user_id!=='cancellation-mail-worker')throw Error('Mail worker authentication failed');
const db=firestoreRest(config.projectId,auth.id_token);
const cancellations=await db.pending();
const modifications=await db.pending('modificationNotifications');
const decisions=await db.pending('requestDecisions');
const requests=await db.pending('requestNotifications');
const queue=[...cancellations,...modifications,...decisions,...requests];
console.log(`Pending reservation notifications: ${queue.length} (${modifications.length} modifications, ${decisions.length} request decisions, ${requests.length} new requests)`);
let publicWork=null;
if((process.env.PUBLIC_EVENT_EMAIL_ENABLED==='true' || mode==='check-public')){
 const settings=(await db.doc('mailSettings/publicEvents').get()).data();
 if(!settings?.enabled || !settings.recipients?.length)throw Error('Public event email configuration missing');
 const [events,periodDocs,roomDocs,catalogDoc]=await Promise.all([db.upcoming(localDate()),db.collection('periods').get(),db.collection('rooms').get(),db.doc('resourceCatalog/current').get()]);
 const periods=periodDocs.docs.map(d=>({id:d.id,...d.data()}));
 const due=events.filter(d=>notificationDue(d.data(),periods,Date.now()));
 publicWork={due,periods,rooms:roomDocs.docs.map(d=>({id:d.id,...d.data()})),catalog:catalogDoc.data(),recipients:settings.recipients};
 console.log(`Due public events: ${due.length}; configured recipients: ${settings.recipients.length}`);
}
if(['check','check-public'].includes(mode))process.exit(0);
const password=process.env.CANCELLATION_SMTP_PASSWORD?.replace(/\s/g,'');
if(!password)throw Error('Missing CANCELLATION_SMTP_PASSWORD');
const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:587,secure:false,requireTLS:true,
 auth:{user:'zzha.filozofik@uni-pr.edu',pass:password},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:60000,
 disableFileAccess:true,disableUrlAccess:true});
try {
 if(queue.length || publicWork?.due.length || mode==='verify-smtp')await transport.verify();
 if(mode==='verify-smtp'){console.log('Gmail SMTP authentication verified; no email sent.');process.exit(0);}
 let errors=0;
 for(const ref of queue){
  try {
   await deliverCancellation(ref,{db,auth:{getUser:async uid=>(await db.doc(`users/${uid}`).get()).data() || {}},
    send:async mail=>{const result=await transport.sendMail({...mail,from:'zzha.filozofik@uni-pr.edu'});if(!result.accepted?.length)throw Error('smtp-not-accepted');},
    now:Date.now,timestamp,token:randomUUID()});
   if((await ref.get()).data()?.status==='failed')errors++;
  }catch{errors++;}
 }
 console.log(`Processed ${queue.length} notifications; ${errors} need a retry or attention.`);
 if(publicWork){
  let sent=0,failed=0,deferred=false;
  const deadline=Date.now()+7*60*1000;
  outer: for(const event of publicWork.due)for(const recipient of publicWork.recipients){
   if(Date.now()>deadline){deferred=true;break outer;}
   try{
    const result=await deliverPublicEvent(event.id,recipient,{db,...publicWork,token:randomUUID(),send:async mail=>{
     const response=await transport.sendMail({...mail,from:'zzha.filozofik@uni-pr.edu'});
     if(!response.accepted?.length)throw Error('smtp-not-accepted');
    }});
    if(result==='sent')sent++;
   }catch{failed++;}
  }
  console.log(`Public event emails accepted: ${sent}; delivery errors: ${failed}; deferred: ${deferred}`);
  errors+=failed;
 }
 if(errors)process.exitCode=1;
} catch(error) {
 const code=['EAUTH','ECONNECTION','ETIMEDOUT','ESOCKET','EDNS','ETLS'].includes(error.code)?error.code:'UNKNOWN';
 const responseCode=Number.isInteger(error.responseCode)?error.responseCode:'none';
 console.error(`SMTP verification or delivery failed (code=${code}, response=${responseCode}). Credentials are not logged.`);
 process.exitCode=1;
}
