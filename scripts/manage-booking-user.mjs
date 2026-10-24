// Dry run by default. No passwords are set and no emails are sent.
import admin from 'firebase-admin';
const [email, permission, flag] = process.argv.slice(2);
if (!email || !['teacher','cancel-all'].includes(permission) || (flag && flag !== '--apply')) throw Error('Usage: node scripts/manage-booking-user.mjs EMAIL teacher|cancel-all [--apply]');
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'filozofiku'});
try {
  let user;
  try { user = await admin.auth().getUserByEmail(email); }
  catch(error) { if (error.code !== 'auth/user-not-found') throw error; }
  const before = user ? (await admin.firestore().doc(`users/${user.uid}`).get()).data() : null;
  console.log(JSON.stringify({email,authExists:!!user,disabled:user?.disabled || false,permissions:before ? {active:before.active,role:before.role,canCancelAll:before.canCancelAll || false} : null,requested:permission,apply:flag === '--apply'}));
  if (flag === '--apply') {
    if (user?.disabled) throw Error('Account is disabled; resolve this before granting booking access.');
    if (!user) user = await admin.auth().createUser({email});
    const update = {active:true,role:before?.role || 'teacher',email};
    if (permission === 'cancel-all') update.canCancelAll = true;
    await admin.firestore().doc(`users/${user.uid}`).set(update,{merge:true});
    const verified = (await admin.firestore().doc(`users/${user.uid}`).get()).data();
    if (!verified.active || !['teacher','admin'].includes(verified.role) || (permission === 'cancel-all' && !verified.canCancelAll)) throw Error('Permission verification failed');
    console.log('Booking permissions saved and verified.');
  }
} finally { await admin.app().delete(); }
