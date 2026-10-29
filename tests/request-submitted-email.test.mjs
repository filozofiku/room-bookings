import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestSubmittedEmail,REQUEST_REVIEWER_EMAIL} from '../mailer/request-submitted-email.js';
import {deliverCancellation} from '../mailer/cancellation-email.js';
const periods=[{id:'p01',start:'08:00',end:'08:15'}];
const booking={title:'Takim',creatorName:'Zamira',date:'2026-10-30',periodIds:['p01'],roomId:'room',eventType:'Mbledhje',description:'Paragrafi 1\n\nParagrafi 2'};
test('new request email contains Albanian details and review link',()=>{
 for(const name of ['Salla 102','Salla 127']){
  const mail=requestSubmittedEmail(booking,periods,name);
  for(const text of ['Zamira','Takim',name,'2026-10-30','08:00–08:15','Mbledhje',booking.description,'https://filozofiku.github.io/room-bookings/','mos iu përgjigjni'])assert.ok(mail.text.includes(text));
 }
});
test('reviewer notification retries, uses a fixed recipient, and suppresses successful duplicates',async()=>{
 let data={booking,kind:'request-submitted',status:'pending'},attempts=0;
 const sent=[],ref={id:'request'};
 const deps={db:{runTransaction:async cb=>cb({get:async()=>({exists:true,data:()=>data}),update:(_,patch)=>{data={...data,...patch}}}),collection:()=>({get:async()=>({docs:periods.map(p=>({id:p.id,data:()=>p}))})}),doc:()=>({get:async()=>({data:()=>({name:'Salla 127'})})})},auth:{getUser:async()=>{throw Error('Wrong recipient lookup')}},send:async mail=>{if(++attempts===1)throw Error('temporary');sent.push(mail)},now:()=>1000,timestamp:ms=>({toMillis:()=>ms}),token:'lease'};
 await assert.rejects(deliverCancellation(ref,deps));assert.equal(data.status,'retrying');
 await deliverCancellation(ref,deps);await deliverCancellation(ref,deps);
 assert.equal(sent.length,1);assert.equal(sent[0].to,REQUEST_REVIEWER_EMAIL);assert.equal(sent[0].to,'bardhok.bashota@uni-pr.edu');assert.equal(data.status,'sent');
 assert.match(sent[0].messageId,/^<request-submitted-/);
});
