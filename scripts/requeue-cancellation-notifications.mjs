// Retry failed notifications after correcting the delivery configuration.
// Dry run by default; --apply allows the scheduled worker to retry delivery.
import admin from 'firebase-admin';
if(process.argv.slice(2).some(a=>a!=='--apply')) throw Error('Usage: node scripts/requeue-cancellation-notifications.mjs [--apply]');
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'filozofiku'});
try {
 const db=admin.firestore();
 const pending=await db.collection('cancellationNotifications').where('status','==','failed').get();
 console.log(`${pending.size} failed cancellation notifications${process.argv.includes('--apply')?' — requeueing':' (dry run)'}.`);
 if(process.argv.includes('--apply'))for(const item of pending.docs)await db.runTransaction(async tx=>{
   const current=await tx.get(item.ref);
   if(current.data()?.status==='failed')tx.update(item.ref,{status:'pending',attempts:0});
 });
}finally{await admin.app().delete();}
