import {readFileSync} from 'node:fs';
import admin from 'firebase-admin';
const [file,flag]=process.argv.slice(2);
if(!file || (flag && flag!=='--apply'))throw Error('Usage: node scripts/configure-public-event-emails.mjs RECIPIENT_FILE [--apply]');
const entries=readFileSync(file,'utf8').split(/[,\n]+/).map(s=>s.trim()).filter(Boolean);
const recipients=[...new Set(entries.map(entry=>{
 const email=(entry.match(/<([^<>]+)>$/)?.[1]||entry).toLowerCase();
 if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email))throw Error('Invalid recipient in mailing list');
 return email;
}))];
if(!recipients.length)throw Error('Empty mailing list');
console.log(`${recipients.length} unique recipients validated. Addresses are not logged.`);
if(flag==='--apply'){
 admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'filozofiku'});
 try{await admin.firestore().doc('mailSettings/publicEvents').set({enabled:true,recipients,updatedAt:admin.firestore.FieldValue.serverTimestamp()});console.log('Private public-event mailing list saved.');}
 finally{await admin.app().delete();}
}
