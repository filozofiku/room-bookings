import {doc,runTransaction,serverTimestamp} from 'firebase/firestore';
import {slotKeys,conflictMessage} from './booking-resources.js';
import {BookingError} from './booking-ui.js';
export async function updateReservation(db,id,expectedRevision,data,user){
 return runTransaction(db,async tx=>{
  const ref=doc(db,'reservations',id),snapshot=await tx.get(ref);
  if(!snapshot.exists())throw new BookingError('Rezervimi nuk ekziston më. Rifreskoni listën.');
  const before=snapshot.data();
  if((before.revision||0)!==expectedRevision)throw new BookingError('Rezervimi është ndryshuar ndërkohë. Hapeni përsëri për redaktim.');
  const controls=await tx.get(doc(db,'settings','control'));
  const profile=await tx.get(doc(db,'users',user.uid));
  if(!profile.data()?.active || (before.ownerUid!==user.uid && !profile.data()?.canCancelAll))throw new BookingError('Nuk keni leje për ta ndryshuar këtë rezervim.');
  if(!controls.data()?.bookingOpen)throw new BookingError('Rezervimet janë pezulluar.');
  const calendar=await tx.get(doc(db,'calendarDays',data.date));
  if(!calendar.data()?.bookingAllowed)throw new BookingError('Rezervimet janë të mbyllura për këtë datë.');
  const day=calendar.data();
  const weekly=day.fetActive?await tx.get(doc(db,'weeklyResources',String(day.weekday))):null;
  const oldRef=doc(db,'eventDays',before.date),newRef=doc(db,'eventDays',data.date);
  const oldSnap=await tx.get(oldRef),newSnap=before.date===data.date?oldSnap:await tx.get(newRef);
  const oldLocks={...(oldSnap.data()?.bookings||{})};
  const oldKeys=slotKeys(before);
  if(oldKeys.some(key=>oldLocks[key]!==id))throw new BookingError('Të dhënat e rezervimit nuk përputhen. Rifreskoni faqen.');
  oldKeys.forEach(key=>delete oldLocks[key]);
  const newLocks=before.date===data.date?oldLocks:{...(newSnap.data()?.bookings||{})};
  const conflict=conflictMessage(data,newLocks,weekly?.data()?.busyKeys||[]);
  if(conflict)throw new BookingError(conflict);
  const booking={...data,ownerUid:before.ownerUid,creatorName:before.creatorName,createdAt:before.createdAt,revision:expectedRevision+1,updatedAt:serverTimestamp()};
  const {ownerUid,...published}=booking;
  tx.set(ref,booking);tx.set(doc(db,'publicBookings',id),published);
  const newKeys=slotKeys(booking);newKeys.forEach(key=>newLocks[key]=id);
  if(before.date!==data.date && oldKeys.length)tx.set(oldRef,{bookings:oldLocks,changedReservationId:id});
  if(newKeys.length || (before.date===data.date && oldKeys.length))tx.set(newRef,{bookings:newLocks,changedReservationId:id});
  tx.set(doc(db,'modificationNotifications',`${id}__${booking.revision}`),{
   reservationId:id,before,booking,previousKeys:oldKeys,modifiedBy:user.uid,modifierName:user.displayName||'Mësimdhënës',createdAt:serverTimestamp(),status:before.ownerUid===user.uid?'recorded':'pending'
  });
 });
}
