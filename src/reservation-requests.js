import {collection,doc,runTransaction,serverTimestamp} from 'firebase/firestore';
import {slotKeys,conflictMessage} from './booking-resources.js';
import {BookingError} from './booking-ui.js';
export const SPECIAL_ROOMS=['r_9c3ca97a27ce','r_a8ae63f60a13'];
export const isSpecialRoom=id=>SPECIAL_ROOMS.includes(id);
export async function submitReservationRequest(db,data,user){
 const ref=doc(collection(db,'reservationRequests'));
 await runTransaction(db,async tx=>{
  const control=await tx.get(doc(db,'settings','control'));
  const day=await tx.get(doc(db,'calendarDays',data.date));
  if(!control.data()?.bookingOpen)throw new BookingError('Rezervimet janë pezulluar.');
  if(!day.data()?.bookingAllowed)throw new BookingError('Rezervimet janë të mbyllura për këtë datë.');
  const occupancy=await tx.get(doc(db,'eventDays',data.date));
  const weekly=day.data().fetActive?await tx.get(doc(db,'weeklyResources',String(day.data().weekday))):null;
  const conflict=conflictMessage(data,occupancy.data()?.bookings||{},weekly?.data()?.busyKeys||[]);
  if(conflict)throw new BookingError(conflict);
  const booking={...data,ownerUid:user.uid,creatorName:user.displayName||'Mësimdhënës',createdAt:serverTimestamp()};
  tx.set(ref,booking);
  tx.set(doc(db,'requestNotifications',ref.id),{booking,kind:'request-submitted',status:'pending',createdAt:serverTimestamp()});
 });
 return ref.id;
}
export async function decideReservationRequest(db,id,outcome,reason,user){
 reason=reason.trim();
 if(!['approved','rejected'].includes(outcome)||!reason||reason.length>2000)throw new BookingError('Shkruani arsyen e vendimit (deri në 2000 karaktere).');
 await runTransaction(db,async tx=>{
  const ref=doc(db,'reservationRequests',id),snap=await tx.get(ref);
  const profile=await tx.get(doc(db,'users',user.uid));
  if(!profile.data()?.active||!profile.data()?.canCancelAll)throw new BookingError('Nuk keni leje për të shqyrtuar kërkesat.');
  if(!snap.exists())throw new BookingError('Kërkesa është shqyrtuar tashmë. Rifreskoni listën.');
  const data=snap.data();
  if(outcome==='approved'){
   const control=await tx.get(doc(db,'settings','control'));
   const day=await tx.get(doc(db,'calendarDays',data.date));
   const existing=await tx.get(doc(db,'reservations',id));
   if(existing.exists())throw new BookingError('Rezervimi ekziston tashmë.');
   if(!control.data()?.bookingOpen)throw new BookingError('Rezervimet janë pezulluar.');
   if(!day.data()?.bookingAllowed)throw new BookingError('Rezervimet janë të mbyllura për këtë datë.');
   const occupancyRef=doc(db,'eventDays',data.date),occupancy=await tx.get(occupancyRef);
   const weekly=day.data().fetActive?await tx.get(doc(db,'weeklyResources',String(day.data().weekday))):null;
   const locks={...(occupancy.data()?.bookings||{})};
   const conflict=conflictMessage(data,locks,weekly?.data()?.busyKeys||[]);
   if(conflict)throw new BookingError(conflict);
   const booking={...data,createdAt:serverTimestamp()}, {ownerUid,...published}=booking;
   tx.set(doc(db,'reservations',id),booking);tx.set(doc(db,'publicBookings',id),published);
   slotKeys(data).forEach(key=>locks[key]=id);
   tx.set(occupancyRef,{bookings:locks,changedReservationId:id});
  }
  tx.set(doc(db,'requestDecisions',id),{booking:data,outcome,reason,status:'pending',decidedBy:user.uid,deciderName:user.displayName||'Mësimdhënës',createdAt:serverTimestamp()});
  tx.delete(ref);
 });
}
