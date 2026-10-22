// Run after deploying the publicBookings rules and the updated booking app.
// Default: preview only. Add --apply to publish existing reservations.
import admin from 'firebase-admin';
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS first');
admin.initializeApp({credential:admin.credential.applicationDefault()});
const db = admin.firestore();
const apply = process.argv.includes('--apply');
const existing = await db.collection('reservations').get();
const publicData = data => {
  const {title, date, roomId, periodIds} = data;
  if (typeof title !== 'string' || !date || !roomId || !Array.isArray(periodIds) || !periodIds.length) {
    throw new Error('Incomplete reservation; nothing should be published until corrected.');
  }
  return {title,date,roomId,periodIds};
};
// Validate the complete snapshot before writing anything.
existing.docs.forEach(item => publicData(item.data()));
let count = 0;
for (const item of existing.docs) {
  if (!apply) { count++; continue; }
  // Re-read inside a transaction: a concurrent cancellation must not be resurrected.
  const published = await db.runTransaction(async tx => {
    const current = await tx.get(item.ref);
    if (!current.exists) return false;
    tx.set(db.collection('publicBookings').doc(item.id), publicData(current.data()));
    return true;
  });
  if (published) count++;
}
console.log(`${apply ? 'Published' : 'Would publish'} ${count} reservations to publicBookings${apply ? '' : ' (dry run; add --apply)'}`);
await admin.app().delete();
