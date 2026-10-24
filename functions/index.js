import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore, Timestamp} from 'firebase-admin/firestore';
import {onDocumentWritten} from 'firebase-functions/v2/firestore';
import {defineString,defineInt,defineSecret} from 'firebase-functions/params';
import nodemailer from 'nodemailer';
import {randomUUID} from 'node:crypto';
import {deliverCancellation} from './cancellation-email.js';
initializeApp();
const smtpHost=defineString('CANCELLATION_SMTP_HOST',{default:'smtp.gmail.com'});
const smtpPort=defineInt('CANCELLATION_SMTP_PORT',{default:587});
const from=defineString('CANCELLATION_EMAIL_FROM',{default:'zzha.filozofik@uni-pr.edu'});
const smtpUser=defineString('CANCELLATION_SMTP_USER',{default:'zzha.filozofik@uni-pr.edu'});
const smtpPassword=defineSecret('CANCELLATION_SMTP_PASSWORD');
export const sendCancellationEmail=onDocumentWritten({
  document:'cancellationNotifications/{id}',region:'europe-west1',retry:true,
  timeoutSeconds:120,maxInstances:2,concurrency:1,secrets:[smtpPassword]
},async event=>{
  // Updates to sending/sent/retrying/failed do not start another delivery.
  // A trusted operator can retry a failed item by setting status=pending, attempts=0.
  if(!event.data?.after.exists || event.data.after.data().status!=='pending') return;
  const port=smtpPort.value();
  const transport=nodemailer.createTransport({
    host:smtpHost.value(),port,secure:port===465,requireTLS:port!==465,
    auth:{user:smtpUser.value(),pass:smtpPassword.value()},
    connectionTimeout:15000,greetingTimeout:15000,socketTimeout:60000,
    disableFileAccess:true,disableUrlAccess:true
  });
  await deliverCancellation(event.data.after.ref,{
    db:getFirestore(),auth:getAuth(),send:async mail=>{
      const result=await transport.sendMail({...mail,from:from.value()});
      if(!result.accepted?.length) throw Error('smtp-not-accepted');
    },now:Date.now,timestamp:Timestamp.fromMillis,token:randomUUID()
  });
});
