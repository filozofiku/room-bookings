import nodemailer from 'nodemailer';
import {randomUUID} from 'node:crypto';
import config from '../public-schedule/firebase-config.js';
import {firestoreRest,timestamp} from './firestore-rest.js';
import {deliverCancellation} from './cancellation-email.js';
const mode=process.argv[2] || 'check';
if(!['check','send','verify-smtp'].includes(mode))throw Error('Expected check, send or verify-smtp');
const refreshToken=process.env.CANCELLATION_FIREBASE_REFRESH_TOKEN;
if(!refreshToken)throw Error('Missing CANCELLATION_FIREBASE_REFRESH_TOKEN');
const response=await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`,{
 method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
 body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}),signal:AbortSignal.timeout(30000)
});
const auth=await response.json();
if(!response.ok || auth.user_id!=='cancellation-mail-worker')throw Error('Mail worker authentication failed');
const db=firestoreRest(config.projectId,auth.id_token);
const queue=await db.pending();
console.log(`Pending cancellation notifications: ${queue.length}`);
if(mode==='check')process.exit(0);
const password=process.env.CANCELLATION_SMTP_PASSWORD?.replace(/\s/g,'');
if(!password)throw Error('Missing CANCELLATION_SMTP_PASSWORD');
const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:587,secure:false,requireTLS:true,
 auth:{user:'zzha.filozofik@uni-pr.edu',pass:password},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:60000,
 disableFileAccess:true,disableUrlAccess:true});
try {
 if(queue.length || mode==='verify-smtp')await transport.verify();
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
 if(errors)process.exitCode=1;
} catch {console.error('SMTP verification or delivery failed. Check the mail settings; credentials are not logged.');process.exitCode=1;}
