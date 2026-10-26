import {createHash} from 'node:crypto';
import {timestamp} from './firestore-rest.js';
const zone='Europe/Tirane';
export function eventStart(date,time) {
  const target=Date.parse(`${date}T${time}:00Z`);
  if(!Number.isFinite(target))throw Error('invalid-event-time');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let result=target;
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(parts.formatToParts(new Date(result)).map(p=>[p.type,p.value]));
    const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    if(local===target)return result;
    result+=target-local;
  }
  throw Error('invalid-local-event-time');
}
export function selectedPeriods(booking,periods){
 const selected=(booking.periodIds||[]).map(id=>periods.find(p=>p.id===id));
 if(!selected.length||selected.some(p=>!p))throw Error('missing-periods');
 return selected.sort((a,b)=>a.start.localeCompare(b.start));
}
export function notificationDue(booking,periods,now){
 if(booking.isPublic!==true)return false;
 const start=eventStart(booking.date,selectedPeriods(booking,periods)[0].start);
 return now>=start-24*60*60*1000 && now<start;
}
export function publicEventEmail(booking,periods,rooms,catalog){
 const selected=selectedPeriods(booking,periods);
 const room=booking.roomId ? rooms.find(r=>r.id===booking.roomId)?.name : 'Pa sallë';
 if(!room)throw Error('missing-room');
 return {subject:'Njoftim për aktivitet publik',text:[
  'Përshëndetje,','', 'Ju njoftojmë për aktivitetin publik të mëposhtëm:','',
  `Aktiviteti: ${booking.title}`,`Lloji: ${booking.eventType}`,`Data: ${booking.date}`,
  `Ora: ${selected[0].start}–${selected.at(-1).end} (ora lokale e Prishtinës/Tiranës)`,
  `Salla: ${room}`,`Mënyra e zhvillimit: ${booking.mode==='online'?'Online':'Fizik'}`,
  ...(booking.mode==='online' && booking.onlineUrl ? [`Linku: ${booking.onlineUrl}`] : []),
  `Grupet e studentëve: ${(booking.groupIds||[]).map(id=>catalog.groups?.[id]||id).join(', ')||'Pa grup të studentëve'}`,
  `Mësimdhënësit: ${(booking.teacherIds||[]).map(id=>catalog.teachers?.[id]||id).join(', ')||'Pa mësimdhënës'}`,
  `Rezervuar nga: ${booking.creatorName||'Emri nuk është i disponueshëm'}`,
  ...(booking.description?['','Përshkrimi:',booking.description]:[]),'',
  'Orari: https://filozofiku.github.io/#orari/reservations/te-gjitha','',
  'Fakulteti Filozofik','Universiteti i Prishtinës','',
  'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
 ].join('\n')};
}
export function deliveryId(bookingId,recipient){return createHash('sha256').update(`${bookingId}\n${recipient}`).digest('hex');}
// One private delivery record per recipient: successful recipients are never retried.
export async function deliverPublicEvent(bookingId,recipient,{db,periods,rooms,catalog,send,now=Date.now,token}){
 const bookingRef=db.doc(`publicBookings/${bookingId}`);
 const latest=(await bookingRef.get()).data();
 if(!latest || !notificationDue(latest,periods,now()))return 'skipped';
 const id=deliveryId(bookingId,recipient),ref=db.doc(`publicEventDeliveries/${id}`);
 const work=await db.runTransaction(async tx=>{
  const snap=await tx.get(ref),data=snap.data()||{};
  if(['sent','failed'].includes(data.status))return null;
  if(data.status==='sending' && data.leaseUntil.toMillis()>now())return null;
  const attempts=(data.attempts||0)+1;
  const patch={bookingId,recipient,status:'sending',attempts,leaseToken:token,leaseUntil:timestamp(now()+300000)};
  tx.update(ref,patch);return patch;
 });
 if(!work)return 'skipped';
 const finish=patch=>db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(snap.data()?.leaseToken!==token)throw Error('delivery-lease-lost');
  tx.update(ref,patch);
 });
 try{
  // Cancellation before SMTP handoff suppresses the notice. A message already
  // accepted by SMTP cannot be recalled if cancellation happens afterwards.
  const current=(await bookingRef.get()).data();
  if(!current || !notificationDue(current,periods,now())){
   await finish({status:'skipped'});return 'skipped';
  }
  await send({to:recipient,...publicEventEmail(current,periods,rooms,catalog),messageId:`<public-event-${id}@filozofiku.github.io>`});
  await finish({status:'sent',sentAt:timestamp(now())});return 'sent';
 }catch(error){
  const failed=work.attempts>=5;
  await finish({status:failed?'failed':'retrying',lastErrorCode:'delivery-error',lastAttemptAt:timestamp(now())});
  throw Error(failed?'public-event-delivery-failed':'public-event-delivery-retry');
 }
}
