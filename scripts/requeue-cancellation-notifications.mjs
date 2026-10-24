// Replay pending notifications created before the email function was deployed.
// Dry run by default; --apply triggers real delivery when the function is active.
import admin from 'firebase-admin';
if(process.argv.slice(2).some(a=>a!=='--apply')) throw Error('Usage: node scripts/requeue-cancellation-notifications.mjs [--apply]');
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'filozofiku'});
try {
 const db=admin.firestore();
 const pending=await db.collection('cancellationNotifications').where('status','==','pending').get();
 console.log(`${pending.size} pending cancellation notifications${process.argv.includes('--apply')?' — requeueing':' (dry run)'}.`);
 if(process.argv.includes('--apply'))for(const item of pending.docs)await db.runTransaction(async tx=>{
   const current=await tx.get(item.ref);
   if(current.data()?.status==='pending')tx.update(item.ref,{requeuedAt:admin.firestore.FieldValue.serverTimestamp()});
 });
}finally{await admin.app().delete();}
