import {emailDate} from './email-format.js';
import {createHash} from 'node:crypto';
import {timestamp} from './firestore-rest.js';
import calendarConfig from '../public/calendar-config.json' with {type:'json'};
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
// Calendar dates are advanced in UTC; eventStart converts each boundary separately
// so a week spanning a clock change still starts at 08:00 local time.
export function publicEventWeek(now){
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 return weekForDate(date);
}
export function weekForDate(date){
 const day=new Date(date+'T12:00:00Z'),offset=(day.getUTCDay()+6)%7;
 day.setUTCDate(day.getUTCDate()-offset);
 const start=day.toISOString().slice(0,10);
 day.setUTCDate(day.getUTCDate()+7);
 const end=day.toISOString().slice(0,10);
 return {start,end,dueAt:eventStart(start,'08:00'),expiresAt:eventStart(end,'00:00')};
}
export function inPublicWeek(booking,week){
 return booking?.isPublic===true && booking.date>=week.start && booking.date<week.end;
}
export function deliveryId(week,recipient){return createHash('sha256').update(`${week}\n${recipient}`).digest('hex');}
export function recipientId(recipient){return deliveryId('subscription',recipient);}
export function calendarLinks(id){
 const feed=calendarConfig.endpoint+'?booking='+encodeURIComponent(id);
 const google=calendarConfig.syncEndpoint
  ?calendarConfig.syncEndpoint+'?booking='+encodeURIComponent(id)+'&lang=sq'
  :'https://calendar.google.com/calendar/render?cid='+encodeURIComponent(feed.replace(/^https:/,'webcal:'));
 return {google,feed};
}
// Freeze the Monday roster once. Later additions do not generate follow-up
// emails; cancellations and edits are checked again before every send.
export async function preparePublicWeek(db,now,periods,{create=true}={}){
 const week=publicEventWeek(now);
 if(now<week.dueAt)return null;
 const ref=db.doc('publicEventWeeks/'+week.start),existing=(await ref.get()).data();
 if(existing)return {...week,...existing};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 if(today!==week.start)return null;
 const events=(await db.upcoming(week.start)).filter(e=>inPublicWeek(e.data(),week));
 // Validate before freezing; malformed event data must not produce a partial digest.
 for(const e of events)selectedPeriods(e.data(),periods);
 const snapshot={weekStart:week.start,bookingIds:events.map(e=>e.id),createdAt:timestamp(now)};
 if(!create)return {...week,...snapshot};
 const saved=await db.runTransaction(async tx=>{
  const data=(await tx.get(ref)).data();if(data)return data;
  tx.update(ref,snapshot);return snapshot;
 });
 return {...week,...saved};
}
function publicEventDetails(booking,periods,rooms,catalog){
 const selected=selectedPeriods(booking,periods);
 const room=booking.roomId ? rooms.find(r=>r.id===booking.roomId)?.name : 'Pa sallë';
 if(!room)throw Error('missing-room');
 return {descriptionSections:[{label:'Përshkrimi:',text:booking.description||''}],text:[
  `Aktiviteti: ${booking.title}`,`Lloji: ${booking.eventType}`,`Data: ${emailDate(booking.date)}`,
  `Ora: ${selected[0].start}–${selected.at(-1).end} (ora lokale e Prishtinës/Tiranës)`,
  ...(booking.roomId?[`Salla: ${room}`]:[]),...(booking.mode==='physical'&&!booking.roomId&&booking.location?[`Lokacioni: ${booking.location}`]:[]),`Mënyra e zhvillimit: ${booking.mode==='online'?'Online':'Fizik'}`,
  ...(booking.mode==='online' && booking.onlineUrl ? [`Linku i ngjarjes online: ${booking.onlineUrl}`] : []),
  ...((booking.groupIds||[]).length?[`Grupet e studentëve: ${booking.groupIds.map(id=>catalog.groups?.[id]||id).join(', ')}`]:[]),
  ...((booking.teacherIds||[]).length?[`Mësimdhënësit: ${booking.teacherIds.map(id=>catalog.teachers?.[id]||id).join(', ')}`]:[]),
  ...(booking.description?['','Përshkrimi:',booking.description]:[]),'',
 ].join('\n').trim()};
}
export function publicEventEmail(booking,periods,rooms,catalog){
 const details=publicEventDetails(booking,periods,rooms,catalog);
 return {...details,subject:'Njoftim për aktivitet publik',text:[
  'Përshëndetje,','','Ju njoftojmë për aktivitetin publik të mëposhtëm:','',details.text,'',
  'Orari: https://filozofiku.github.io/#orari/reservations/te-gjitha','',
  'Fakulteti Filozofik','Universiteti i Prishtinës','',
  'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
 ].join('\n')};
}
export function publicWeekEmail(events,week,periods,rooms,catalog,unsubscribeUrl){
 const sections=events.map(event=>{
  const mail=publicEventDetails(event,periods,rooms,catalog),links=calendarLinks(event.id);
  const details=mail.text;
  return {text:details+'\n\nAbonohu në Google Calendar: '+links.google+'\nAbonohu me URL (Apple Calendar / Outlook): '+links.feed,descriptions:mail.descriptionSections};
 });
 const sunday=new Date(week.end+'T12:00:00Z');sunday.setUTCDate(sunday.getUTCDate()-1);
 return {subject:`Aktivitetet publike të javës · ${emailDate(week.start)} – ${emailDate(sunday.toISOString().slice(0,10))}`,
  descriptionSections:sections.flatMap(s=>s.descriptions),text:[
  'Përshëndetje,','',`Aktivitetet publike për javën ${emailDate(week.start)} – ${emailDate(sunday.toISOString().slice(0,10))}:`,'',
  sections.length?sections.map(s=>s.text).join('\n\n────────────────────\n\n'):'Nuk ka aktivitete publike të planifikuara për këtë javë.','',
  'Abonimet në kalendar pasqyrojnë ndryshimet dhe anulimet; rifreskimi varet nga shërbimi i kalendarit.',
  'Orari: https://filozofiku.github.io/#orari/reservations/te-gjitha','',
  'Për të mos marrë më njoftime javore për aktivitetet publike, çregjistrohuni këtu:',unsubscribeUrl,'',
  'Fakulteti Filozofik','Universiteti i Prishtinës','',
  'Ky është një njoftim automatik. Ju lutemi, mos iu përgjigjni këtij emaili, sepse përgjigjet nuk do të lexohen.'
 ].join('\n')};
}
export async function deliverPublicWeek(week,recipient,{db,periods,rooms,catalog,send,now=Date.now,token}){
 if(now()<week.dueAt||now()>=week.expiresAt)return 'skipped';
 const subscriptionRef=db.doc('publicEventRecipients/'+recipientId(recipient));
 const subscription=await db.runTransaction(async tx=>{
  const data=(await tx.get(subscriptionRef)).data();if(data)return data;
  const created={recipient,unsubscribeToken:token,unsubscribed:false};tx.update(subscriptionRef,created);return created;
 });
 if(subscription.unsubscribed)return 'skipped';
 const id=deliveryId(week.start,recipient),ref=db.doc('publicEventDeliveries/'+id);
 const work=await db.runTransaction(async tx=>{
  const data=(await tx.get(ref)).data()||{};
  if(['sent','failed','skipped'].includes(data.status))return null;
  if(data.status==='sending' && data.leaseUntil.toMillis()>now())return null;
  const patch={weekStart:week.start,bookingIds:week.bookingIds,recipient,status:'sending',attempts:(data.attempts||0)+1,leaseToken:token,leaseUntil:timestamp(now()+300000),...(!data.createdAt?{createdAt:timestamp(now())}:{})};
  tx.update(ref,patch);return patch;
 });
 if(!work)return 'skipped';
 const finish=patch=>db.runTransaction(async tx=>{
  if((await tx.get(ref)).data()?.leaseToken!==token)throw Error('delivery-lease-lost');
  tx.update(ref,patch);
 });
 try{
  const current=await Promise.all(week.bookingIds.map(async id=>({id,...(await db.doc('publicBookings/'+id).get()).data()})));
  const events=current.filter(event=>inPublicWeek(event,week)).sort((a,b)=>a.date.localeCompare(b.date)||selectedPeriods(a,periods)[0].start.localeCompare(selectedPeriods(b,periods)[0].start)||a.id.localeCompare(b.id));
  const settings=(await db.doc('mailSettings/publicEvents').get()).data();
  if(!settings?.enabled || !settings.recipients.includes(recipient) || (await subscriptionRef.get()).data()?.unsubscribed || now()>=week.expiresAt){
   await finish({status:'skipped'});return 'skipped';
  }
  const unsubscribeUrl='https://filozofiku.github.io/room-bookings/unsubscribe.html#id='+recipientId(recipient)+'&token='+encodeURIComponent(subscription.unsubscribeToken);
  await send({to:recipient,...publicWeekEmail(events,week,periods,rooms,catalog,unsubscribeUrl),messageId:`<public-week-${id}@filozofiku.github.io>`});
  await finish({status:'sent',sentAt:timestamp(now()),bookingIds:events.map(e=>e.id)});return 'sent';
 }catch(error){
  const failed=work.attempts>=5;
  await finish({status:failed?'failed':'retrying',lastErrorCode:'delivery-error',lastAttemptAt:timestamp(now())});
  throw Error(failed?'public-week-delivery-failed':'public-week-delivery-retry');
 }
}
