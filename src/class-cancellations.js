import {doc,runTransaction,serverTimestamp} from 'firebase/firestore';
import {BookingError} from './booking-ui.js';

export async function setClassCancelled(db,classId,date,cancelled,user){
  return runTransaction(db,async tx=>{
    const dayRef=doc(db,'calendarDays',date);
    const [profile,control,regular,daySnap,occupancy]=await Promise.all([
      tx.get(doc(db,'users',user.uid)),tx.get(doc(db,'settings','control')),
      tx.get(doc(db,'regularClasses',classId)),tx.get(dayRef),tx.get(doc(db,'eventDays',date))
    ]);
    const teacherIds=profile.data()?.teacherIds||[],lesson=regular.data(),day=daySnap.data();
    if(!profile.data()?.active || !['teacher','admin'].includes(profile.data()?.role) || !lesson?.teacherIds.some(id=>teacherIds.includes(id)))throw new BookingError('Mund të ndryshoni vetëm mësimin tuaj.');
    if(!control.data()?.bookingOpen)throw new BookingError('Rezervimet janë pezulluar.');
    if(!day?.fetActive || String(day.weekday)!==lesson.weekday || date<control.data().startDate || date>control.data().endDate)throw new BookingError('Kjo orë mësimore nuk është e planifikuar për datën e zgjedhur.');
    const cancelledClasses={...day.cancelledClasses};
    if(Boolean(cancelledClasses[classId])===cancelled)return;
    if(!cancelled && lesson.keys.some(key=>occupancy.data()?.bookings?.[key]))throw new BookingError('Mësimi nuk mund të rikthehet: salla, grupi ose mësimdhënësi është rezervuar ndërkohë.');
    const released=new Set(day.releasedKeys||[]);
    if(cancelled){
      cancelledClasses[classId]={by:lesson.teacherIds.find(id=>teacherIds.includes(id)),at:serverTimestamp(),class:lesson.publicInfo};
      lesson.keys.forEach(key=>released.add(key));
    }else{
      delete cancelledClasses[classId];lesson.keys.forEach(key=>released.delete(key));
    }
    tx.update(dayRef,{cancelledClasses,releasedKeys:[...released].sort(),changedClassId:classId,classChangeBy:lesson.teacherIds.find(id=>teacherIds.includes(id)),classChangeAt:serverTimestamp()});
  });
}
