// Administrative setup. Private worker token is written once; never printed.
import admin from 'firebase-admin';
import {readFileSync,writeFileSync} from 'node:fs';
import config from '../public-schedule/firebase-config.js';
const mode=process.argv[2];
if(!['--worker','--enable-audit'].includes(mode)||process.argv.length!==3)throw Error('Usage: node scripts/configure-reporting.mjs --worker|--enable-audit');
const key=JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));
if(key.project_id!==config.projectId)throw Error('Unexpected Firebase project');
admin.initializeApp({credential:admin.credential.cert(key)});
try{
  if(mode==='--enable-audit'){
    const db=admin.firestore();
    await db.runTransaction(async tx=>{
      const ref=db.doc('settings/control'),snap=await tx.get(ref);
      if(snap.data()?.slotStorage!=='resources-v2')throw Error('Database not ready');
      tx.update(ref,{auditLoggingRequired:true,...(!snap.data().auditCompleteFrom?{auditCompleteFrom:admin.firestore.FieldValue.serverTimestamp()}:{})});
    });
    console.log('Complete audit logging required for subsequent browser actions. Existing coverage date preserved.');
  }else{
    const uid='reporting-worker',auth=admin.auth();let user;
    try{user=await auth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;user=await auth.createUser({uid});}
    if(user.disabled||user.email||user.providerData.length)throw Error('Unexpected reporting worker identity');
    if(user.customClaims&&!user.customClaims.reportingWorker)throw Error('Unexpected reporting worker claims');
    await auth.setCustomUserClaims(uid,{reportingWorker:true});
    const custom=await auth.createCustomToken(uid);
    const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    if(!response.ok||!data.refreshToken)throw Error('Worker sign-in failed');
    const verified=await auth.verifyIdToken(data.idToken);
    if(verified.uid!==uid||verified.reportingWorker!==true)throw Error('Unexpected worker token');
    const path='/tmp/fet-reporting-worker.secret';
    writeFileSync(path,data.refreshToken,{mode:0o600,flag:'wx'});
    console.log('Restricted reporting worker ready. Private token file: '+path);
  }
}finally{await admin.app().delete();}
