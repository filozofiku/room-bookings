// Store only a restricted Firebase refresh token in GitHub, never Admin credentials.
import admin from 'firebase-admin';
import {execFileSync} from 'node:child_process';
import config from '../public-schedule/firebase-config.js';
if(process.argv.slice(2).some(a=>a!=='--apply'))throw Error('Use --apply to configure the worker');
const apply=process.argv.includes('--apply'), uid='cancellation-mail-worker';
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:config.projectId});
try {
 const db=admin.firestore(), auth=admin.auth();
 const users=await db.collection('users').get();
 let updated=0;
 for(const doc of users.docs){
  let user;try{user=await auth.getUser(doc.id);}catch(e){if(e.code==='auth/user-not-found')continue;throw e;}
  if(user.email && doc.data().email!==user.email){if(apply)await doc.ref.set({email:user.email},{merge:true});updated++;}
 }
 console.log(`${updated} user email records ${apply?'updated':'need updating'}.`);
 if(apply){
  let worker;try{worker=await auth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;worker=await auth.createUser({uid});}
  if(worker.email || worker.providerData.length || (await db.doc(`users/${uid}`).get()).exists)throw Error('Worker identity is not isolated');
  await auth.setCustomUserClaims(uid,{cancellationMailWorker:true});
  const customToken=await auth.createCustomToken(uid);
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:customToken,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok || result.localId!==uid || !result.refreshToken)throw Error('Worker token exchange failed');
  execFileSync('gh',['secret','set','CANCELLATION_FIREBASE_REFRESH_TOKEN','--repo','filozofiku/room-bookings'],{input:result.refreshToken,stdio:['pipe','pipe','pipe']});
  console.log('Restricted worker token stored in GitHub Actions. No email sent.');
 }
}finally{await admin.app().delete();}
