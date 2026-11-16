import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`),{chromium}=require('playwright');
const auth=`export class GoogleAuthProvider{setCustomParameters(){}};export const signInWithPopup=async()=>{};export const signOut=async()=>{};export function onAuthStateChanged(auth,cb){window.testAuth=cb;cb({uid:'owner',displayName:'Owner'});}`;
const firestore=`
const periods=[{id:'p1',start:'08:00',end:'08:15',label:'08:00–08:15'},{id:'p2',start:'08:15',end:'08:30',label:'08:15–08:30'},{id:'p3',start:'08:30',end:'08:45',label:'08:30–08:45'},{id:'p4',start:'08:45',end:'09:00',label:'08:45–09:00'}];
const initial={title:'Approved event',date:'2026-11-16',roomId:'r_9c3ca97a27ce',periodIds:['p1','p2'],groupIds:[],teacherIds:[],eventType:'Panel',isPublic:false,description:'',mode:'physical',onlineUrl:'',location:'',ownerUid:'owner',creatorName:'Owner',createdAt:{seconds:100}};
const {ownerUid,...published}=initial;
const store=new Map([['users/owner',{active:true,role:'teacher'}],['users/admin',{active:true,role:'admin',canCancelAll:true}],['settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:'2026-11-16',endDate:'2026-11-17'}],['resourceCatalog/current',{rooms:{r_9c3ca97a27ce:'Salla 102',r_a8ae63f60a13:'Salla 127',normal:'Salla 014'},groups:{g1:'Grupi 1',g2:'Grupi 2'},teachers:{t1:'Teacher 1',t2:'Teacher 2'}}],['calendarDays/2026-11-16',{bookingAllowed:true,fetActive:false}],['calendarDays/2026-11-17',{bookingAllowed:true,fetActive:false}],['reservations/event',initial],['publicBookings/event',published],['studentNotifications/event',{booking:initial,recipients:['old@student.uni-pr.edu'],kind:'students',status:'sent'}],['eventDays/2026-11-16',{bookings:{r_9c3ca97a27ce__p1:'event',r_9c3ca97a27ce__p2:'event'},changedReservationId:'event'}],...periods.map(p=>['periods/'+p.id,p]),...Object.entries({r_9c3ca97a27ce:'Salla 102',r_a8ae63f60a13:'Salla 127',normal:'Salla 014'}).map(([id,name])=>['rooms/'+id,{name}])]);
window.testStore=store;let seq=0;
export const collection=(db,name)=>name;export const doc=(db,...parts)=>{const path=parts.length?parts.join('/'):db+'/request'+(++seq);return {path,id:path.split('/').at(-1)}};
export const where=(...args)=>args;export const query=(path,...filters)=>({path,filters});export const serverTimestamp=()=>({seconds:200});
const snapshot=ref=>{const path=ref.path||ref;return {id:path.split('/').at(-1),exists:()=>store.has(path),data:()=>store.get(path)}};
export const getDoc=async ref=>snapshot(ref);export const getDocs=async ref=>({docs:[...store.keys()].filter(k=>k.startsWith((ref.path||ref)+'/')).map(snapshot).filter(s=>(ref.filters||[]).every(([field,op,value])=>field.split('.').reduce((v,k)=>v?.[k],s.data())===value))});
export const runTransaction=async(db,cb)=>{const writes=[];const result=await cb({get:getDoc,set:(ref,data)=>writes.push(()=>store.set(ref.path,data)),update:(ref,data)=>writes.push(()=>store.set(ref.path,{...store.get(ref.path),...data})),delete:ref=>writes.push(()=>store.delete(ref.path))});writes.forEach(write=>write());return result;};
`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-11-16T09:00Z'));
 await page.route('https://edit.test/**',route=>{
  const path=new URL(route.request().url()).pathname;let body,type='text/javascript';
  if(path==='/'){body=readFileSync('index.html');type='text/html';}
  else if(path==='/auth.js')body=auth;
  else if(path==='/firestore.js')body=firestore;
  else if(path==='/src/firebase.js')body='export const auth={};export const db={};';
  else if(/^\/(src|public-schedule)\/[\w-]+\.js$/.test(path))body=readFileSync(path.slice(1),'utf8').replaceAll("'firebase/auth'","'/auth.js'").replaceAll("'firebase/firestore'","'/firestore.js'");
  else if(path.endsWith('.css')){body=readFileSync(path.startsWith('/src/')?path.slice(1):'public'+path);type='text/css';}
  else if(path.endsWith('.png')){body=readFileSync('public'+path);type='image/png';}
  else if(path==='/university-shell.js')body=readFileSync('public/university-shell.js');
  else return route.abort();return route.fulfill({body,contentType:type});
 });
 await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
 await page.goto('https://edit.test/?section=my-reservations');await page.waitForSelector('#app:not([hidden])');
 const begin=async()=>{if(await page.locator('#reservations-section').getAttribute('open')===null)await page.locator('#reservations-section > summary').click();await page.locator('#my-reservations').getByRole('button',{name:'Redaktoni',exact:true}).click();await page.waitForFunction(()=>document.getElementById('booking-heading').textContent==='Redaktoni rezervimin');};
 const submit=async()=>{await page.locator('#booking-form button').click();await page.waitForSelector('#reservation-dialog[open]');await page.locator('#reservation-dialog button[value="confirm"]').click();await page.waitForFunction(()=>!document.querySelector('#booking-form button').disabled);};
 await begin();assert.equal(await page.locator('#student-emails-field').isVisible(),true);assert.equal(await page.locator('#student-emails').inputValue(),'old@student.uni-pr.edu');
 await page.fill('#title','Metadata changed');await page.fill('#student-emails','new@student.uni-pr.edu');await page.selectOption('#mode','online');await page.fill('#online-url','https://example.test/online');await page.locator('#groups input').first().check();await page.locator('#teachers input').first().check();await submit();
 assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/event').title),'Metadata changed');assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/event').roomId),'r_9c3ca97a27ce');
 assert.deepEqual(await page.evaluate(()=>window.testStore.get('reservations/event').studentEmails),['new@student.uni-pr.edu']);assert.equal(await page.evaluate(()=>('studentEmails' in window.testStore.get('publicBookings/event'))),false);
 assert.equal(await page.evaluate(()=>[...window.testStore.keys()].filter(k=>k.startsWith('reservationEditRequests/')).length),0);
 await begin();await page.selectOption('#room','normal');await page.selectOption('#from','p3');await page.selectOption('#through','p4');await page.fill('#title','Pending schedule');await submit();
 const pending=await page.evaluate(()=>[...window.testStore.keys()].find(k=>k.startsWith('reservationEditRequests/')));assert(pending);
 assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/event').title),'Metadata changed');assert.deepEqual(await page.evaluate(()=>window.testStore.get('publicBookings/event').periodIds),['p1','p2']);assert.equal(await page.locator('#booking-receipt .status-pending').count(),1);
 await page.evaluate(()=>window.testAuth({uid:'admin',displayName:'Admin'}));await page.waitForFunction(()=>document.getElementById('reservation-requests').textContent.includes('Pending schedule'));
 await page.locator('#requests-section > summary').click();
 await page.locator('#reservation-requests').getByRole('button',{name:'Miratoni',exact:true}).click();await page.fill('#request-decision-reason','Approved');await page.locator('#request-decision-dialog button[value="confirm"]').click();await page.waitForFunction(key=>!window.testStore.has(key),pending);
 assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/event').title),'Pending schedule');assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/event').roomId),'normal');assert.deepEqual(await page.evaluate(()=>window.testStore.get('publicBookings/event').periodIds),['p3','p4']);assert.equal(await page.evaluate(()=>window.testStore.get('reservations/event').createdAt.seconds),100);
 await page.evaluate(()=>window.testAuth({uid:'owner',displayName:'Owner'}));await begin();await page.selectOption('#room','r_a8ae63f60a13');await page.fill('#title','Rejected schedule');await submit();
 const reject=await page.evaluate(()=>[...window.testStore.keys()].find(k=>k.startsWith('reservationEditRequests/')));await page.evaluate(()=>window.testAuth({uid:'admin',displayName:'Admin'}));await page.waitForFunction(()=>document.getElementById('reservation-requests').textContent.includes('Rejected schedule'));
 await page.locator('#requests-section > summary').click();
 await page.locator('#reservation-requests').getByRole('button',{name:'Refuzoni',exact:true}).click();await page.fill('#request-decision-reason','Rejected');await page.locator('#request-decision-dialog button[value="confirm"]').click();await page.waitForFunction(key=>!window.testStore.has(key),reject);
 assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/event').roomId),'normal');assert.equal(await page.evaluate(()=>window.testStore.get('publicBookings/event').title),'Pending schedule');assert.deepEqual(errors,[]);
 console.log('Edit flow passed: private student lists, immediate metadata/group/teacher/mode changes, pending room/time changes, approval, rejection, and stable reservation identity.');
}finally{await browser.close();}
