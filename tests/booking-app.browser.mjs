import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.TEST_MODULES_DIR?`${process.env.TEST_MODULES_DIR}/package.json`:import.meta.url);
const {chromium}=require('playwright');
const authModule=`
export class GoogleAuthProvider{setCustomParameters(){}}
export const signInWithPopup=async()=>{};
export const signOut=async()=>window.testAuth(null);
export function onAuthStateChanged(auth,cb){window.testAuth=cb;cb({uid:'teacher',displayName:'Mësimdhënës',email:'test@example.test'});}
`;
const firestoreModule=`
const periods=Array.from({length:18},(_,i)=>{
const time=n=>String(8+Math.floor(n/4)).padStart(2,'0')+':'+String(n%4*15).padStart(2,'0');
return {id:'p'+String(i+1).padStart(2,'0'),start:time(i),end:time(i+1),label:time(i)+'–'+time(i+1)};
});
const room='r_123456abcdef', date='2026-10-23';
const store=new Map([
['users/teacher',{active:true,role:'teacher'}],
['settings/control',{bookingOpen:true,slotStorage:'daily-v1',startDate:date,endDate:date}],
['rooms/'+room,{name:'Salla 014'}],
['calendarDays/'+date,{weekday:'5',bookingAllowed:true,fetActive:true}],
['weeklyRooms/5__'+room,{busyPeriods:['p18']}],
['roomDays/'+date+'__'+room,{bookings:{p17:'existing'},changedReservationId:'existing'}],
['reservations/existing',{date,roomId:room,periodIds:['p17'],title:'Mbledhje',ownerUid:'teacher'}],
...periods.map(p=>['periods/'+p.id,p])]);
window.testStore=store;
export const collection=(db,name)=>name;
export const doc=(db,...parts)=>{const path=parts.length?parts.join('/'):(db+'/new');return {path,id:path.split('/').at(-1)};};
export const where=(...args)=>args;
export const query=(path,...filters)=>path;
const snap=ref=>{const path=ref.path||ref;return {id:path.split('/').at(-1),exists:()=>store.has(path),data:()=>store.get(path)};};
export const getDoc=async path=>{if(window.testFail)throw Object.assign(new Error('English SDK error'),{code:'unavailable'});return snap(path)};
export const getDocs=async path=>({docs:[...store.keys()].filter(k=>k.startsWith(path+'/')).map(snap)});
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
else if(path==='/src/main.js')body=readFileSync('src/main.js','utf8').replaceAll("'firebase/auth'","'/auth.js'").replaceAll("'firebase/firestore'","'/firestore.js'");
else if(path==='/src/booking-ui.js')body=readFileSync('src/booking-ui.js','utf8');
else return route.abort();
return route.fulfill({contentType,body});
});
await page.goto('https://booking.test/');
await page.waitForFunction(()=>document.getElementById('slots').children.length===18);
assert.equal(await page.locator('html').getAttribute('lang'),'sq');
assert.equal(await page.locator('#from option').first().textContent(),'08:00');
assert.equal(await page.locator('#through option').first().textContent(),'08:15');
assert.equal(await page.getByText('Salla e lirë',{exact:true}).count(),16);
assert.equal(await page.getByText('E rezervuar',{exact:true}).count(),1);
assert.equal(await page.getByText('Mësim sipas orarit',{exact:true}).count(),1);
assert.match(await page.locator('#my-reservations').textContent(),/12:00–12:15/);
assert.doesNotMatch(await page.locator('#my-reservations').textContent(),/p17/);
await page.fill('#title','Seminar');await page.selectOption('#through','p17');
await page.locator('#booking-form button').click();
assert.match(await page.locator('#message').textContent(),/1–16/);
await page.selectOption('#through','p16');await page.locator('#booking-form button').click();
await page.waitForFunction(()=>document.getElementById('message').textContent.includes('u krijua me sukses'));
await page.waitForFunction(()=>document.getElementById('my-reservations').textContent.includes('08:00–12:00'));
assert.equal(await page.evaluate(()=>window.testStore.get('reservations/new').periodIds.length),16);
await page.locator('#my-reservations .slot').filter({hasText:'Seminar'}).getByRole('button').click();
await page.locator('#cancel-dialog button[value="cancel"]').click();
await page.waitForFunction(()=>document.getElementById('message').textContent.includes('u anulua'));
assert.equal(await page.evaluate(()=>window.testStore.has('reservations/new')),false);
await page.evaluate(()=>{window.testFail=true});await page.locator('#room').dispatchEvent('change');
await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Shërbimi nuk është'));
assert.doesNotMatch(await page.locator('#message').textContent(),/English SDK/);
assert.deepEqual(errors,[]);
console.log('Albanian signed-in UI, status labels, boundary times, validation, 16-period booking/cancellation and localized SDK errors passed.');
}finally{await browser.close();}
