import {collection,doc,runTransaction,serverTimestamp} from 'firebase/firestore';
import {slotKeys,conflictMessage,needsReapproval} from './booking-resources.js';
import {BookingError} from './booking-ui.js';
import {applyReservationEdit} from './update-reservation.js';
import {recordActivity} from './activity-events.js';
export {SPECIAL_ROOMS,isSpecialRoom,needsReapproval} from './booking-resources.js';
export async function submitReservationRequest(db,data,user,studentEmails=[]){
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
  const booking={...data,studentEmails,ownerUid:user.uid,creatorName:user.displayName||'Mësimdhënës',createdAt:serverTimestamp()};
  tx.set(ref,booking);
  recordActivity(tx,db,'requested',ref.id,booking,user);
  if(studentEmails.length)tx.set(doc(db,'studentNotifications',ref.id),{booking,recipients:studentEmails,kind:'students',status:'awaiting-approval',createdAt:serverTimestamp()});
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
  const students=await tx.get(doc(db,'studentNotifications',id));
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
   const booking={...data,createdAt:serverTimestamp()}, {ownerUid,studentEmails,...published}=booking;
   tx.set(doc(db,'reservations',id),booking);tx.set(doc(db,'publicBookings',id),published);
   recordActivity(tx,db,'created',id,booking,user,{method:'approved'});
   const keys=slotKeys(data);keys.forEach(key=>locks[key]=id);
   if(keys.length)tx.set(occupancyRef,{bookings:locks,changedReservationId:id});
  }
  tx.set(doc(db,'requestDecisions',id),{booking:data,outcome,reason,status:'pending',decidedBy:user.uid,deciderName:user.displayName||'Mësimdhënës',createdAt:serverTimestamp()});
  recordActivity(tx,db,outcome==='approved'?'approved':'declined',id,data,user,{requestedAt:data.createdAt});
  if(students.exists())tx.update(doc(db,'studentNotifications',id),{status:outcome==='approved'?'pending':'cancelled'});
  tx.delete(ref);
 });
}

// A pending edit is a proposal. It never changes the published event or its locks.
export async function submitReservationEditRequest(db,id,expectedRevision,data,user){
 const ref=doc(collection(db,'reservationEditRequests'));
 await runTransaction(db,async tx=>{
  const current=await tx.get(doc(db,'reservations',id));
  const control=await tx.get(doc(db,'settings','control'));
  const profile=await tx.get(doc(db,'users',user.uid));
  const day=await tx.get(doc(db,'calendarDays',data.date));
  if(!current.exists())throw new BookingError('Rezervimi nuk ekziston më. Rifreskoni listën.');
  const before=current.data();
  if(before.ownerUid!==user.uid || !profile.data()?.active)throw new BookingError('Nuk keni leje për ta ndryshuar këtë rezervim.');
  if((before.revision||0)!==expectedRevision)throw new BookingError('Rezervimi është ndryshuar ndërkohë. Hapeni përsëri për redaktim.');
  if(!control.data()?.bookingOpen)throw new BookingError('Rezervimet janë pezulluar.');
  if(!day.data()?.bookingAllowed)throw new BookingError('Rezervimet janë të mbyllura për këtë datë.');
  if(!needsReapproval(before,data,profile.data()?.requiresApproval===true))throw new BookingError('Ky ndryshim nuk kërkon miratim. Ruani ndryshimet drejtpërdrejt.');
  const occupied=await tx.get(doc(db,'eventDays',data.date));
  const weekly=day.data().fetActive?await tx.get(doc(db,'weeklyResources',String(day.data().weekday))):null;
  const locks=Object.fromEntries(Object.entries(occupied.data()?.bookings||{}).filter(([,value])=>value!==id));
  const conflict=conflictMessage(data,locks,weekly?.data()?.busyKeys||[]);
  if(conflict)throw new BookingError(conflict);
  const booking={...data,ownerUid:before.ownerUid,creatorName:before.creatorName,createdAt:before.createdAt};
  tx.set(ref,{reservationId:id,expectedRevision,booking,ownerUid:user.uid,createdAt:serverTimestamp()});
  tx.set(doc(db,'requestNotifications',ref.id),{booking,kind:'request-submitted',status:'pending',createdAt:serverTimestamp()});
  recordActivity(tx,db,'requested',ref.id,booking,user);
 });
 return ref.id;
}
export async function decideReservationEditRequest(db,id,outcome,reason,user){
 reason=reason.trim();
 if(!['approved','rejected'].includes(outcome)||!reason||reason.length>2000)throw new BookingError('Shkruani arsyen e vendimit (deri në 2000 karaktere).');
 return runTransaction(db,async tx=>{
  const ref=doc(db,'reservationEditRequests',id),request=await tx.get(ref);
  const profile=await tx.get(doc(db,'users',user.uid));
  if(!profile.data()?.active||!profile.data()?.canCancelAll)throw new BookingError('Nuk keni leje për të shqyrtuar kërkesat.');
  if(!request.exists())throw new BookingError('Kërkesa është shqyrtuar tashmë. Rifreskoni listën.');
  const proposal=request.data();
  if(outcome==='approved'){
   const current=await tx.get(doc(db,'reservations',proposal.reservationId));
   const students=await tx.get(doc(db,'studentNotifications',proposal.reservationId));
   if(!current.exists())throw new BookingError('Rezervimi nuk ekziston më. Refuzoni kërkesën e vjetër.');
   if((current.data().revision||0)!==proposal.expectedRevision)throw new BookingError('Rezervimi ka ndryshuar pas kërkesës. Refuzoni kërkesën dhe kërkoni një propozim të ri.');
   await applyReservationEdit(tx,db,proposal.reservationId,current.data(),proposal.booking,user,students);
  }
  tx.set(doc(db,'requestDecisions',id),{booking:proposal.booking,reservationId:proposal.reservationId,outcome,reason,status:'pending',decidedBy:user.uid,deciderName:user.displayName||'Mësimdhënës',createdAt:serverTimestamp()});
  recordActivity(tx,db,outcome==='approved'?'approved':'declined',id,proposal.booking,user,{requestedAt:proposal.createdAt});
  tx.delete(ref);
 });
}
