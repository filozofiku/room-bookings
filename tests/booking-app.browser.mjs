import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.TEST_MODULES_DIR?`${process.env.TEST_MODULES_DIR}/package.json`:import.meta.url);
const {chromium}=require('playwright');
const authModule=`
export class GoogleAuthProvider{setCustomParameters(){}}
export const signInWithPopup=async()=>{};
export const signOut=async()=>window.testAuth(null);
export function onAuthStateChanged(auth,cb){window.testAuth=cb;cb(new URLSearchParams(location.search).has('signedout')?null:{uid:'teacher',displayName:'Mësimdhënës',email:'test@example.test'});}
`;
const firestoreModule=`
const periods=Array.from({length:18},(_,i)=>{
const time=n=>String(8+Math.floor(n/4)).padStart(2,'0')+':'+String(n%4*15).padStart(2,'0');
return {id:'p'+String(i+1).padStart(2,'0'),start:time(i),end:time(i+1),label:time(i)+'–'+time(i+1)};
});
const room='r_123456abcdef', date='2026-10-23';
const store=new Map([
['users/teacher',{active:true,role:'teacher'}],
['settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:date,endDate:date}],
['rooms/'+room,{name:'Salla 014'}],
['calendarDays/'+date,{weekday:'5',bookingAllowed:true,fetActive:true}],
['resourceCatalog/current',{groups:{g_one:'Grupi 1',g_two:'Grupi 2'},teachers:{t_one:'Mësimdhënësi 1',t_two:'Mësimdhënësi 2'}}],
['weeklyResources/5',{busyKeys:[room+'__p18']}],
['eventDays/'+date,{bookings:{[room+'__p17']:'existing'},changedReservationId:'existing'}],
['reservations/existing',{date,roomId:room,periodIds:['p17'],title:'Mbledhje',ownerUid:'teacher'}],
...periods.map(p=>['periods/'+p.id,p])]);
window.testStore=store;
export const collection=(db,name)=>name;
export const doc=(db,...parts)=>{const path=parts.length?parts.join('/'):(db+'/new');return {path,id:path.split('/').at(-1)};};
export const where=(...args)=>args;
export const query=(path,...filters)=>({path,filters});
const snap=ref=>{const path=ref.path||ref;return {id:path.split('/').at(-1),exists:()=>store.has(path),data:()=>store.get(path)};};
export const getDoc=async path=>{if(window.testFail)throw Object.assign(new Error('English SDK error'),{code:'unavailable'});return snap(path)};
export const getDocs=async ref=>{const path=ref.path||ref;return {docs:[...store.keys()].filter(k=>k.startsWith(path+'/')).map(snap).filter(s=>(ref.filters||[]).every(([field,op,value])=>field.split('.').reduce((v,k)=>v?.[k],s.data())===value))}};
export const serverTimestamp=()=>({seconds:123456});
export const runTransaction=async(db,callback)=>{
const writes=[];await callback({get:getDoc,set:(...args)=>writes.push(['set',...args]),delete:path=>writes.push(['delete',path])});
for(const [op,path,data] of writes)if(op==='set')store.set(path.path,data);else store.delete(path.path);
};
`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://booking.test/**',route=>{
const path=new URL(route.request().url()).pathname;
let body,contentType='text/javascript';
if(path==='/'){body=readFileSync('index.html','utf8');contentType='text/html';}
else if(path==='/auth.js')body=authModule;
else if(path==='/firestore.js')body=firestoreModule;
else if(path==='/src/firebase.js')body='export const auth={};export const db={};';
else if(['/src/main.js','/src/update-reservation.js','/src/reservation-requests.js'].includes(path))body=readFileSync(path.slice(1),'utf8').replaceAll("'firebase/auth'","'/auth.js'").replaceAll("'firebase/firestore'","'/firestore.js'");
else if(['/src/booking-ui.js','/src/booking-resources.js'].includes(path))body=readFileSync(path.slice(1),'utf8');
else return route.abort();
return route.fulfill({contentType,body});
});
async function submitBooking(){
 await page.locator('#booking-form button').click();
 if(await page.locator('#reservation-dialog').isVisible())await page.locator('#reservation-dialog button[value="confirm"]').click();
 await page.waitForFunction(()=>!document.querySelector('#booking-form button').disabled);
}
await page.goto('https://booking.test/');
await page.waitForFunction(()=>document.getElementById('slots').children.length===18);
assert.equal(await page.locator('html').getAttribute('lang'),'sq');
for (const kind of ['groups','teachers']) {
 const search=kind==='groups'?'GRUPI 2':'mesimdhenesi 2';
 await page.locator(`#${kind} input`).first().check();
 await page.fill(`#${kind}-search`,search);
 assert.equal(await page.locator(`#${kind} label:visible`).count(),1);
 assert.equal(await page.locator(`#${kind} input`).first().isChecked(),true);
 await page.fill(`#${kind}-search`,'nukekziston');
 assert.equal(await page.locator(`#${kind} label:visible`).count(),0);
 assert.match(await page.locator(`#${kind}-results`).textContent(),/Nuk u gjet/);
 await page.fill(`#${kind}-search`,'');
 assert.equal(await page.locator(`#${kind} label:visible`).count(),2);
 await page.locator(`#${kind} input`).first().uncheck();
}

assert.equal(await page.locator('#from option').first().textContent(),'08:00');
assert.equal(await page.locator('#through option').first().textContent(),'08:15');
assert.equal(await page.getByText('Salla e lirë',{exact:true}).count(),16);
assert.equal(await page.getByText('E rezervuar',{exact:true}).count(),1);
assert.equal(await page.getByText('Mësim sipas orarit',{exact:true}).count(),1);
assert.match(await page.locator('#my-reservations').textContent(),/12:00–12:15/);
assert.doesNotMatch(await page.locator('#my-reservations').textContent(),/p17/);
assert.equal(await page.locator('#slots .reserve-from').count(),16);
assert.equal(await page.locator('#slots .slot').filter({hasText:'E rezervuar'}).getByRole('button').count(),0);
assert.equal(await page.locator('#slots .slot').filter({hasText:'Mësim sipas orarit'}).getByRole('button').count(),0);
await page.locator('#slots .reserve-from').nth(2).click();
assert.equal(await page.locator('#from').inputValue(),'p03');
assert.equal(await page.locator('#through').inputValue(),'p08');
assert.equal(await page.locator('#through option:checked').textContent(),'10:00');
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
await page.waitForFunction(()=>{
 const box=document.getElementById('booking-form').getBoundingClientRect();
 return box.top < innerHeight && box.bottom > 0;
});
assert.equal(await page.locator('#from').isEnabled(),true);
assert.equal(await page.locator('#through').isEnabled(),true);
await page.locator('#slots .reserve-from').last().click();
assert.equal(await page.locator('#from').inputValue(),'p16');
assert.equal(await page.locator('#through').inputValue(),'p18');
assert.match(await page.locator('#selection-hint').textContent(),/12:30/);
await page.selectOption('#from','p01');
assert.equal(await page.locator('#selection-hint').textContent(),'');
await page.fill('#title','Seminar');await page.selectOption('#through','p17');
await submitBooking();
assert.match(await page.locator('#booking-message').textContent(),/më shumë se 16 periudha/);
assert.equal(await page.locator('#booking-message').isVisible(),true);
assert.equal(await page.getByText('Zgjidhni 1–16 periudha të njëpasnjëshme (deri në 4 orë).',{exact:false}).count(),0);
await page.selectOption('#through','p16');
await page.getByRole('button',{name:'Bëni rezervimin',exact:true}).click();
assert.match(await page.locator('#reservation-summary').textContent(),/Seminar/);
assert.match(await page.locator('#reservation-summary').textContent(),/08:00–12:00/);
assert.match(await page.locator('#reservation-summary').textContent(),/Salla 014/);
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
await page.locator('#reservation-dialog button[value="back"]').click();
assert.equal(await page.locator('#title').inputValue(),'Seminar');
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
await page.locator('#booking-form button').click();await page.keyboard.press('Escape');
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
await submitBooking();
await page.waitForFunction(()=>document.getElementById('message').textContent.includes('u krijua me sukses'));
await page.waitForFunction(()=>document.getElementById('my-reservations').textContent.includes('08:00–12:00'));
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').periodIds.length),16);
await page.locator('#my-reservations .slot').filter({hasText:'Seminar'}).getByRole('button',{name:'Anuloni',exact:true}).click();
await page.locator('#cancel-dialog button[value="cancel"]').click();
await page.waitForFunction(()=>document.getElementById('message').textContent.includes('u anulua'));
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
// Optional resources, metadata, and exact conflict messages.
assert.deepEqual(await page.locator('#event-type option').allTextContents(),['Zëvendësim i mësimit','Konferencë','Panel','Mbrojtje publike','Mbledhje','Tryezë','Diskutim','Punëtori','Ligjëratë e ftuar','Ceremoni','Kolokium','Ekspozitë']);
await page.selectOption('#room','');
await page.fill('#title','Ngjarje online');await page.selectOption('#through','p02');
await page.selectOption('#event-type','Konferencë');
await page.selectOption('#visibility','public');assert.equal(await page.locator('#email-notice').isVisible(),true);
assert.equal(await page.locator('#description-field').isVisible(),true);
await page.fill('#description',Array(501).fill('fjalë').join(' '));
await submitBooking();
assert.match(await page.locator('#booking-message').textContent(),/500 fjalë/);
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
const paragraphs=Array(250).fill('fjalë').join(' ')+'\n\n'+Array(250).fill('fjalë').join(' ');
await page.fill('#description',paragraphs);
assert.equal(await page.locator('#description-count').textContent(),'500 / 500 fjalë');
await page.selectOption('#mode','online');assert.equal(await page.locator('#online-field').isVisible(),true);
await page.fill('#online-url','javascript:alert(1)');await submitBooking();
assert.match(await page.locator('#message').textContent(),/link të vlefshëm/);
await page.fill('#online-url','https://example.test/event');
await submitBooking();
await page.waitForFunction(()=>document.getElementById('message').textContent.includes('u krijua me sukses'));
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').description),paragraphs);
assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/new').description),paragraphs);
assert.deepEqual(await page.evaluate(()=>{const d=window.testStore.get('reservations/new');return [d.roomId,d.groupIds,d.teacherIds,d.isPublic,d.mode,d.onlineUrl,d.eventType]}),['',[],[],true,'online','https://example.test/event','Konferencë']);
await page.locator('#my-reservations .slot').filter({hasText:'Ngjarje online'}).getByRole('button',{name:'Anuloni',exact:true}).click();await page.locator('#cancel-dialog button[value="cancel"]').click();
await page.waitForFunction(()=>!window.testStore.has('reservations/new'));
await page.selectOption('#mode','physical');assert.equal(await page.locator('#online-field').isVisible(),false);
await page.selectOption('#visibility','private');assert.equal(await page.locator('#email-notice').isVisible(),false);
assert.equal(await page.locator('#description-field').isVisible(),false);
await page.fill('#title','Panel');
for(const [selector,key,error] of [['#groups input[value="g_one"]','g_one','Grupi i studentëve'],['#teachers input[value="t_one"]','t_one','Mësimdhënësi']]) {
 await page.locator(selector).check();
 for(const source of ['fet','booking']) {
  await page.evaluate(({source,key})=>{window.testStore.set('weeklyResources/5',{busyKeys:source==='fet'?[key+'__p01']:[]});window.testStore.set('eventDays/2026-10-23',{bookings:source==='booking'?{[key+'__p01']:'occupied'}:{}})},{source,key});
  await submitBooking();
  assert.equal(await page.locator('#message').textContent(),error+' nuk është i lirë në intervalin e përzgjedhur.');
  assert.equal(await page.locator('#booking-message').textContent(),error+' nuk është i lirë në intervalin e përzgjedhur.');
  assert.equal(await page.locator('#booking-message').isVisible(),true);
  assert.ok(await page.locator('#booking-message').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight}));
 }
 await page.locator(selector).uncheck();
}
await page.selectOption('#room','r_123456abcdef');
await page.evaluate(()=>window.testStore.set('weeklyResources/5',{busyKeys:['r_123456abcdef__p01']}));
await submitBooking();
assert.equal(await page.locator('#message').textContent(),'Salla nuk është e lirë në intervalin e përzgjedhur.');
await page.locator('#groups input').first().check();await page.locator('#teachers input').first().check();
await page.evaluate(()=>{window.testStore.set('weeklyResources/5',{busyKeys:['g_one__p01','r_123456abcdef__p01']});window.testStore.set('eventDays/2026-10-23',{bookings:{t_one__p01:'occupied'}})});
await submitBooking();
assert.deepEqual((await page.locator('#booking-message').textContent()).split('\n'),[
 'Grupi i studentëve nuk është i lirë në intervalin e përzgjedhur.',
 'Salla nuk është e lirë në intervalin e përzgjedhur.',
 'Mësimdhënësi nuk është i lirë në intervalin e përzgjedhur.'
]);
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
await page.evaluate(()=>{window.testStore.set('weeklyResources/5',{busyKeys:[]});window.testStore.set('eventDays/2026-10-23',{bookings:{}})});
await page.locator('#groups input').first().check();await page.locator('#groups input').last().check();
await page.locator('#teachers input').first().check();await page.locator('#teachers input').last().check();
await submitBooking();
await page.waitForFunction(()=>window.testStore.has('reservations/new'));
assert.deepEqual(await page.evaluate(()=>{const d=window.testStore.get('reservations/new');return [d.groupIds,d.teacherIds,d.onlineUrl,d.isPublic]}),[['g_one','g_two'],['t_one','t_two'],'',false]);
assert.equal(await page.evaluate(()=>Object.keys(window.testStore.get('eventDays/2026-10-23').bookings).length),10);
// Editing pre-fills the form, preserves identity, and ignores its own occupancy.
const original=await page.evaluate(()=>window.testStore.get('reservations/new'));
await page.locator('#my-reservations .slot').filter({hasText:original.title}).getByRole('button',{name:'Redaktoni',exact:true}).click();
assert.equal(await page.locator('#title').inputValue(),original.title);
await submitBooking();assert.match(await page.locator('#booking-message').textContent(),/Nuk keni bërë ndryshime/);
await page.fill('#title','Rezervimi i ndryshuar');
await submitBooking();
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').title),'Rezervimi i ndryshuar');
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').ownerUid),'teacher');
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').revision),1);
assert.equal(await page.evaluate(()=>window.testStore.get('modificationNotifications/new__1').status),'recorded');
await page.locator('#my-reservations .slot').filter({hasText:'Rezervimi i ndryshuar'}).getByRole('button',{name:'Redaktoni',exact:true}).click();
await page.selectOption('#from','p03');await page.selectOption('#through','p04');await submitBooking();
assert.equal(await page.evaluate(()=>window.testStore.get('eventDays/2026-10-23').bookings['g_one__p01']),undefined);
assert.equal(await page.evaluate(()=>window.testStore.get('eventDays/2026-10-23').bookings['g_one__p03']),'new');
await page.locator('#my-reservations .slot').filter({hasText:'Rezervimi i ndryshuar'}).getByRole('button',{name:'Redaktoni',exact:true}).click();
await page.evaluate(()=>window.testStore.set('weeklyResources/5',{busyKeys:['g_one__p05']}));
await page.selectOption('#from','p05');await page.selectOption('#through','p05');await submitBooking();
assert.match(await page.locator('#booking-message').textContent(),/Grupi i studentëve nuk është i lirë/);
assert.deepEqual(await page.evaluate(()=>window.testStore.get('reservations/new').periodIds),['p03','p04']);
await page.locator('#stop-editing').click();
await page.locator('#my-reservations .slot').filter({hasText:'Rezervimi i ndryshuar'}).getByRole('button',{name:'Redaktoni',exact:true}).click();
await page.evaluate(()=>{const b=window.testStore.get('reservations/new');window.testStore.set('reservations/new',{...b,revision:3})});
await page.fill('#title','Stale edit');await submitBooking();
assert.match(await page.locator('#booking-message').textContent(),/ndryshuar ndërkohë/);
await page.locator('#stop-editing').click();
await page.evaluate(async()=>{
 window.testStore.set('reservations/someone',{date:'2026-10-23',roomId:'',periodIds:['p01'],title:'Rezervimi i kolegut',ownerUid:'someone',creatorName:'Kolegu'});
 window.testStore.set('publicBookings/someone',{title:'Rezervimi i kolegut'});
 await window.testAuth({uid:'teacher',displayName:'Mësimdhënës'});
});
assert.equal(await page.locator('#my-reservations').getByText(/Rezervimi i kolegut/).count(),0);
assert.equal(await page.locator('#reservations-heading').textContent(),'Rezervimet e mia');
await page.evaluate(async()=>{
 window.testStore.set('users/manager',{active:true,role:'admin',canCancelAll:true});
 await window.testAuth({uid:'manager',displayName:'Administratori'});
});
assert.equal(await page.locator('#reservations-heading').textContent(),'Të gjitha rezervimet');
await page.locator('#my-reservations .slot').filter({hasText:'Rezervimi i ndryshuar'}).getByRole('button',{name:'Redaktoni',exact:true}).click();
assert.match(await page.locator('#edit-notice').textContent(),/njoftohet me email/);
await page.fill('#title','Ndryshuar nga administratori');await submitBooking();
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').ownerUid),'teacher');
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').creatorName),'Mësimdhënës');
assert.equal(await page.evaluate(()=>window.testStore.get('modificationNotifications/new__4').booking.title),'Ndryshuar nga administratori');
assert.equal(await page.evaluate(()=>window.testStore.get('modificationNotifications/new__4').before.title),'Rezervimi i ndryshuar');

await page.locator('#my-reservations .slot').filter({hasText:'Rezervimi i kolegut'}).getByRole('button',{name:'Anuloni',exact:true}).click();
assert.equal(await page.locator('#cancel-reason-field').isVisible(),true);
await page.locator('#cancel-dialog button[value="cancel"]').click();
assert.match(await page.locator('#cancel-error').textContent(),/Shkruani arsyen/);
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/someone')),true);
await page.fill('#cancel-reason','   ');
await page.locator('#cancel-dialog button[value="cancel"]').click();
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/someone')),true);
await page.fill('#cancel-reason','Salla nevojitet për një aktivitet të fakultetit.');
await page.locator('#cancel-dialog button[value="cancel"]').click();
await page.waitForFunction(()=>!window.testStore.has('reservations/someone'));
assert.equal(await page.evaluate(()=>window.testStore.has('publicBookings/someone')),false);
assert.equal(await page.evaluate(()=>window.testStore.get('cancellationNotifications/someone').reason),'Salla nevojitet për një aktivitet të fakultetit.');
assert.equal(await page.evaluate(()=>window.testStore.get('cancellationNotifications/someone').booking.ownerUid),'someone');
// Special-room requests remain private until an elevated user approves them.
await page.evaluate(async()=>{
 window.testStore.set('rooms/r_a8ae63f60a13',{name:'Salla 127'});
 window.testStore.set('users/teacher',{active:true,role:'teacher'});
 await window.testAuth({uid:'teacher',displayName:'Mësimdhënës',email:'test@example.test'});
});
await page.selectOption('#room','r_a8ae63f60a13');
await page.fill('#title','Kërkesa për sallën 127');
await page.selectOption('#from','p01');await page.selectOption('#through','p02');
for(const kind of ['groups','teachers'])for(const input of await page.locator(`#${kind} input`).all())await input.uncheck();
await page.selectOption('#visibility','private');
assert.match(await page.locator('#booking-form button').textContent(),/Dërgoni kërkesën/);
const beforePublic=await page.evaluate(()=>JSON.stringify([...window.testStore].filter(([k])=>k.startsWith('publicBookings/'))));
await submitBooking();
assert.equal(await page.evaluate(()=>window.testStore.has('reservationRequests/new')),true);
assert.equal(await page.evaluate(()=>window.testStore.get('requestNotifications/new').status),'pending');
assert.equal(await page.evaluate(()=>window.testStore.get('requestNotifications/new').booking.title),'Kërkesa për sallën 127');
assert.equal(await page.evaluate(()=>JSON.stringify([...window.testStore].filter(([k])=>k.startsWith('publicBookings/')))),beforePublic);
assert.match(await page.locator('#reservation-requests').textContent(),/Në pritje/);
assert.equal(await page.locator('#reservation-requests button').count(),0);
await page.evaluate(async()=>{
 window.testStore.set('users/admin',{active:true,role:'admin',canCancelAll:true});
 window.testStore.delete('reservations/new');window.testStore.delete('publicBookings/new');
 await window.testAuth({uid:'admin',displayName:'Administrator',email:'admin@example.test'});
});
await page.locator('#reservation-requests').getByRole('button',{name:'Miratoni',exact:true}).click();
await page.locator('#request-decision-dialog button[value="confirm"]').click();
assert.match(await page.locator('#request-decision-error').textContent(),/Shkruani arsyen/);
await page.fill('#request-decision-reason','Miratohet përdorimi për aktivitetin.');
await page.locator('#request-decision-dialog button[value="confirm"]').click();
await page.waitForFunction(()=>!window.testStore.has('reservationRequests/new'));
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').ownerUid),'teacher');
assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/new').title),'Kërkesa për sallën 127');
assert.equal(await page.evaluate(()=>window.testStore.get('requestDecisions/new').outcome),'approved');
assert.equal(await page.evaluate(()=>window.testStore.get('requestDecisions/new').status),'pending');
await page.evaluate(()=>{
 const booking={...window.testStore.get('reservations/new'),title:'Kërkesa e dytë'};
 window.testStore.set('reservationRequests/reject',booking);
 window.testStore.set('reservationRequests/conflict',booking);
});
await page.click('#refresh-requests');
await page.locator('.request-card').filter({hasText:'Kërkesa e dytë'}).first().getByRole('button',{name:'Refuzoni',exact:true}).click();
await page.fill('#request-decision-reason','Salla nevojitet për një aktivitet tjetër.');
await page.locator('#request-decision-dialog button[value="confirm"]').click();
await page.waitForFunction(()=>!window.testStore.has('reservationRequests/reject'));
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/reject')),false);
assert.equal(await page.evaluate(()=>window.testStore.get('requestDecisions/reject').status),'pending');
await page.locator('#reservation-requests').getByRole('button',{name:'Miratoni',exact:true}).click();
await page.fill('#request-decision-reason','Miratim');
await page.locator('#request-decision-dialog button[value="confirm"]').click();
await page.waitForFunction(()=>document.querySelector('#reservation-requests').textContent.includes('Salla nuk është e lirë'));
assert.equal(await page.evaluate(()=>window.testStore.has('reservationRequests/conflict')),true);
await page.evaluate(()=>{window.testFail=true});await page.locator('#room').dispatchEvent('change');
await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Shërbimi nuk është'));
assert.doesNotMatch(await page.locator('#message').textContent(),/English SDK/);
// Deep links survive sign-in and map the finishing time to the inclusive last period.
await page.goto('https://booking.test/?date=2026-10-23&room=Salla%20014&start=08%3A30&end=09%3A30&signedout=1');
await page.waitForFunction(()=>window.testAuth);
assert.equal(await page.locator('#app').isVisible(),false);
await page.evaluate(()=>window.testAuth({uid:'teacher',displayName:'Mësimdhënës',email:'test@example.test'}));
assert.equal(await page.locator('#date').inputValue(),'2026-10-23');
assert.equal(await page.locator('#room').inputValue(),'r_123456abcdef');
assert.equal(await page.locator('#from').inputValue(),'p03');
assert.equal(await page.locator('#through').inputValue(),'p06');
await page.selectOption('#from','p04');assert.equal(await page.locator('#from').inputValue(),'p04');
await page.selectOption('#through','p07');assert.equal(await page.locator('#through').inputValue(),'p07');
await page.goto('https://booking.test/?date=2026-10-23&room=Unknown&start=08:30&end=09:30');
await page.waitForFunction(()=>document.getElementById('booking-message').textContent.includes('nuk është e vlefshme'));
await page.goto('https://booking.test/?date=2026-10-23&room=Salla%20014&start=08:00&end=12:30');
await page.waitForFunction(()=>document.getElementById('booking-message').textContent.includes('16'));
assert.equal(await page.locator('#through').inputValue(),'p18');
assert.deepEqual(errors,[]);
console.log('Albanian signed-in UI, status labels, boundary times, validation, 16-period booking/cancellation and localized SDK errors passed.');
}finally{await browser.close();}
