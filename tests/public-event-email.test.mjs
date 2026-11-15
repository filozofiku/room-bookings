import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventStart,publicEventWeek,weekForDate,preparePublicWeek,publicEventEmail,publicWeekEmail,deliverPublicWeek,deliveryId,recipientId,calendarLinks} from '../mailer/public-event-email.js';
import {emailHtml} from '../mailer/email-format.js';
const periods=[{id:'p1',start:'13:00',end:'13:15'}];
const booking={isPublic:true,date:'2026-10-26',periodIds:['p1'],title:'Panel',eventType:'Panel',roomId:'',mode:'online',onlineUrl:'https://example.test/event',description:'Përshkrimi',creatorName:'Organizatori',groupIds:[],teacherIds:[]};
const monday=Date.parse('2026-10-26T07:00:00Z');
test('Monday 08:00 and calendar weeks follow Tirane daylight saving and year boundaries',()=>{
 for(const [date,utc] of [['2026-10-26','2026-10-26T07:00:00Z'],['2026-07-27','2026-07-27T06:00:00Z'],['2026-03-23','2026-03-23T07:00:00Z'],['2026-03-30','2026-03-30T06:00:00Z']])assert.equal(weekForDate(date).dueAt,Date.parse(utc));
 assert.equal(publicEventWeek(Date.parse('2026-11-01T22:59Z')).start,'2026-10-26');
 assert.equal(publicEventWeek(Date.parse('2026-11-01T23:00Z')).start,'2026-11-02');
 assert.equal(weekForDate('2027-01-01').start,'2026-12-28');
 assert.equal(new Date(eventStart('2026-10-26','13:00')).toISOString(),'2026-10-26T12:00:00.000Z');
});
test('Albanian event details retain online link, resources and descriptions',()=>{
 const email=publicEventEmail(booking,periods,[],{});
 for(const value of ['Panel','26 tetor 2026','13:00–13:15','https://example.test/event','Përshkrimi'])assert.ok(email.text.includes(value));
 assert.doesNotMatch(email.text,/Salla:|Grupet e studentëve:|Mësimdhënësit:|Rezervuar nga|Organizatori/);
});
function fixture(){
 const store=new Map([['publicBookings/event',booking],['mailSettings/publicEvents',{enabled:true,recipients:['a@example.test','b@example.test']}]]);let chain=Promise.resolve();
 const sent=[];let fail=false,afterClaim=()=>{},clock=monday;
 const db={doc:path=>({path,id:path.split('/').at(-1),get:async()=>({exists:store.has(path),data:()=>store.get(path)})}),upcoming:async date=>[...store].filter(([key,value])=>key.startsWith('publicBookings/')&&value.date>=date).map(([key,value])=>({id:key.split('/').at(-1),data:()=>value})),runTransaction:cb=>{
  const task=chain.then(()=>cb({get:ref=>ref.get(),update:(ref,patch)=>{store.set(ref.path,{...store.get(ref.path),...patch});if(ref.path.startsWith('publicEventDeliveries/')&&patch.status==='sending')afterClaim();}}));chain=task.catch(()=>{});return task;
 }};
 const deps={db,periods,rooms:[],catalog:{},token:'12345678-1234-1234-1234-123456789012',now:()=>clock,send:async mail=>{if(fail)throw Error('smtp failure');sent.push(mail);}};
 const prepare=()=>preparePublicWeek(db,clock,periods);
 return {store,sent,deps,prepare,setFail:v=>fail=v,setClock:v=>clock=v,setAfterClaim:v=>afterClaim=v};
}
test('no 48-hour notices; snapshot starts Monday at 08:00 and is not created later in the week',async()=>{
 const f=fixture();for(const time of [monday-48*3600000,monday-1]){f.setClock(time);assert.equal(await f.prepare(),null);}
 f.setClock(monday);const week=await f.prepare();assert.deepEqual(week.bookingIds,['event']);
 f.store.set('publicBookings/late',{...booking,title:'Added late'});f.setClock(monday+86400000);
 assert.deepEqual((await f.prepare()).bookingIds,['event']);
 const late=fixture();late.setClock(monday+86400000);assert.equal(await late.prepare(),null);
});
test('Monday–Sunday roster includes Monday morning, Sunday and only public events in this week',async()=>{
 const f=fixture();for(const [id,date,isPublic] of [['sun','2026-11-01',true],['next','2026-11-02',true],['past','2026-10-25',true],['private','2026-10-27',false]])f.store.set('publicBookings/'+id,{...booking,date,isPublic});
 assert.deepEqual((await f.prepare()).bookingIds,['event','sun']);
});
test('one email per recipient per week, with multiple events, calendar subscriptions and unsubscribe',async()=>{
 const f=fixture();f.store.set('publicBookings/second',{...booking,title:'Sunday talk',date:'2026-11-01'});
 const week=await f.prepare();await deliverPublicWeek(week,'a@example.test',f.deps);
 assert.equal(f.sent.length,1);const mail=f.sent[0];
 for(const text of ['Panel','Sunday talk','26 tetor 2026','1 nëntor 2026','Abonohu në Google Calendar:','Abonohu me URL (Apple Calendar / Outlook):','unsubscribe.html#id=','token=','mos iu përgjigjni'])assert(mail.text.includes(text));
 assert.equal((mail.text.match(/Abonohu në Google Calendar:/g)||[]).length,2);
 const links=calendarLinks('event with & symbols');assert.equal(new URL(links.feed).searchParams.get('booking'),'event with & symbols');assert.equal(new URL(links.google).searchParams.get('booking'),'event with & symbols');
 assert(emailHtml(mail.text,mail.descriptionSections).includes('href="https://filozofiku.github.io/room-bookings/unsubscribe.html#id='));
 await deliverPublicWeek(week,'a@example.test',f.deps);assert.equal(f.sent.length,1);
});
test('per-recipient retries, parallel leases, stable message IDs and a new week',async()=>{
 const f=fixture(),week=await f.prepare();await Promise.all([deliverPublicWeek(week,'a@example.test',f.deps),deliverPublicWeek(week,'a@example.test',{...f.deps,token:'second'})]);assert.equal(f.sent.length,1);
 f.setFail(true);await assert.rejects(deliverPublicWeek(week,'b@example.test',f.deps));f.setFail(false);
 await deliverPublicWeek(week,'b@example.test',f.deps);assert.deepEqual(f.sent.map(m=>m.to),['a@example.test','b@example.test']);
 assert.equal(f.store.get('publicEventDeliveries/'+deliveryId(week.start,'b@example.test')).attempts,2);
 f.setClock(Date.parse('2026-11-02T07:00Z'));const next=await f.prepare();await deliverPublicWeek(next,'a@example.test',f.deps);assert.equal(f.sent.length,3);assert.notEqual(f.sent[0].messageId,f.sent[2].messageId);
 assert.equal(f.store.get('publicEventRecipients/'+recipientId('a@example.test')).unsubscribeToken,f.deps.token);
});
test('cancellation, edits, privacy and opt-out are rechecked immediately before sending',async()=>{
 const f=fixture();f.store.set('publicBookings/second',{...booking,title:'Second'});const week=await f.prepare();
 f.setAfterClaim(()=>{f.store.delete('publicBookings/event');f.store.set('publicBookings/second',{...booking,title:'Edited'});});
 await deliverPublicWeek(week,'a@example.test',f.deps);assert(!f.sent[0].text.includes('Aktiviteti: Panel'));assert(f.sent[0].text.includes('Aktiviteti: Edited'));
 const g=fixture(),w=await g.prepare();g.setAfterClaim(()=>g.store.set('publicEventRecipients/'+recipientId('a@example.test'),{unsubscribed:true}));
 await deliverPublicWeek(w,'a@example.test',g.deps);assert.equal(g.sent.length,0);
 const h=fixture(),hw=await h.prepare();h.setAfterClaim(()=>h.store.set('mailSettings/publicEvents',{enabled:false,recipients:['a@example.test']}));await deliverPublicWeek(hw,'a@example.test',h.deps);assert.equal(h.sent.length,0);
});
test('opt-outs persist across weeks, suppress retries and do not expose addresses in URLs',async()=>{
 const f=fixture(),week=await f.prepare();await deliverPublicWeek(week,'a@example.test',f.deps);
 const profile=f.store.get('publicEventRecipients/'+recipientId('a@example.test'));profile.unsubscribed=true;
 f.setClock(Date.parse('2026-11-02T07:00Z'));await deliverPublicWeek(await f.prepare(),'a@example.test',f.deps);assert.equal(f.sent.length,1);
 assert(!f.sent[0].text.includes('a@example.test'));
});
test('empty weeks send an explicit summary and retries stop at the next week',async()=>{
 const f=fixture();f.store.delete('publicBookings/event');const week=await f.prepare();await deliverPublicWeek(week,'a@example.test',f.deps);assert.match(f.sent[0].text,/Nuk ka aktivitete publike/);
 f.setClock(week.expiresAt);assert.equal(await deliverPublicWeek(week,'b@example.test',f.deps),'skipped');assert.equal(f.sent.length,1);
});
test('five failures require administrator retry and fail before sending incomplete event data',async()=>{
 const f=fixture(),week=await f.prepare();f.setFail(true);for(let i=0;i<5;i++)await assert.rejects(deliverPublicWeek(week,'a@example.test',f.deps));
 f.setFail(false);await deliverPublicWeek(week,'a@example.test',f.deps);assert.equal(f.sent.length,0);assert.equal(f.store.get('publicEventDeliveries/'+deliveryId(week.start,'a@example.test')).status,'failed');
 const g=fixture();g.store.set('publicBookings/broken',{...booking,periodIds:['missing']});await assert.rejects(g.prepare(),/missing-periods/);assert(!g.store.has('publicEventWeeks/2026-10-26'));
});

test('digest retains description markers and styles repeated descriptions for each event',()=>{
 const description='Orari i takimit\nOrari: tekst i autorit\n\nParagrafi i dytë.';
 const mail=publicWeekEmail([{...booking,id:'one',description},{...booking,id:'two',description}],weekForDate(booking.date),periods,[],{},'https://example.test/unsubscribe');
 assert.equal(mail.text.split(description).length-1,2);
 assert.equal((emailHtml(mail.text,mail.descriptionSections).match(/data-email-section="description"/g)||[]).length,2);
});
