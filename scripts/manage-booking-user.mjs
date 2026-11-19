// Dry run by default. No passwords are set and no emails are sent.
import admin from 'firebase-admin';
const [email, permission, ...args] = process.argv.slice(2);
let apply=false, name;
for(let i=0;i<args.length;i++){
  if(args[i]==='--apply')apply=true;
  else if(args[i]==='--name' && args[i+1]?.trim() && !args[i+1].startsWith('--'))name=args[++i].trim();
  else throw Error('Unknown or incomplete argument: '+args[i]);
}
if (!email || !['teacher','cancel-all','request-only'].includes(permission)) throw Error('Usage: node scripts/manage-booking-user.mjs EMAIL teacher|cancel-all|request-only [--name NAME] [--apply]');
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'filozofiku'});
try {
  let user;
  try { user = await admin.auth().getUserByEmail(email); }
  catch(error) { if (error.code !== 'auth/user-not-found') throw error; }
  const before = user ? (await admin.firestore().doc(`users/${user.uid}`).get()).data() : null;
  console.log(JSON.stringify({email,authExists:!!user,disabled:user?.disabled || false,permissions:before ? {active:before.active,role:before.role,canCancelAll:before.canCancelAll || false,requiresApproval:before.requiresApproval || false} : null,requested:permission,name,apply}));
  if (apply) {
    if (user?.disabled) throw Error('Account is disabled; resolve this before granting booking access.');
    if (!user) user = await admin.auth().createUser({email,...(name?{displayName:name}:{})});
    else if(name && user.displayName!==name)user=await admin.auth().updateUser(user.uid,{displayName:name});
    const update = {active:true,role:before?.role || 'teacher',email};
    if (permission === 'cancel-all') update.canCancelAll = true;
    if (permission === 'request-only')Object.assign(update,{role:'teacher',canCancelAll:false,requiresApproval:true});
    if (name)update.bookingName=name;
    await admin.firestore().doc(`users/${user.uid}`).set(update,{merge:true});
    const verified = (await admin.firestore().doc(`users/${user.uid}`).get()).data();
    if (!verified.active || !['teacher','admin'].includes(verified.role) || (permission === 'cancel-all' && !verified.canCancelAll)) throw Error('Permission verification failed');
    if(permission==='request-only' && (!verified.requiresApproval || verified.canCancelAll))throw Error('Request-only permission verification failed');
    if(name && (verified.bookingName!==name || (await admin.auth().getUser(user.uid)).displayName!==name))throw Error('Name verification failed');
    console.log('Booking permissions saved and verified.');
  }
} finally { await admin.app().delete(); }
