import {readFileSync,existsSync} from 'node:fs';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`),{chromium}=require('playwright');
const auth=`export class GoogleAuthProvider{setCustomParameters(){}};export const signInWithPopup=async()=>{};export const signOut=async()=>window.testAuth(null);export function onAuthStateChanged(auth,cb){window.testAuth=cb;cb({uid:'owner',email:'teacher@uni-pr.edu',displayName:'Teacher'});}`;
const firestore=`
const info={subject:'Course',start:'08:00',end:'08:30',room:'Room 1',teachers:['Teacher'],groups:['Group 1 Automatic Subgroup']};
const lesson={weekday:'4',roomId:'r1',groupIds:['g1'],teacherIds:['t1'],periodIds:['p01','p02'],publicInfo:info,keys:['r1__p01','r1__p02','g1__p01','g1__p02','t1__p01','t1__p02']};
const store=new Map([['users/owner',{active:true,role:'teacher',teacherIds:['t1']}],['users/other',{active:true,role:'teacher',teacherIds:['t2']}],['settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:'2026-11-23',endDate:'2026-12-06'}],['regularClasses/class-1',lesson],['regularClasses/class-2',{...lesson,teacherIds:['t2'],publicInfo:{...info,subject:'Other teacher course'}}],...Array.from({length:14},(_,i)=>{const d=new Date('2026-11-23T12:00Z');d.setUTCDate(d.getUTCDate()+i);return ['calendarDays/'+d.toISOString().slice(0,10),{bookingAllowed:true,fetActive:true,weekday:String(d.getUTCDay())}];})]);window.store=store;
const listeners=[];window.listeners=listeners;
export const doc=(db,...parts)=>({path:parts.join('/')});export const collection=(db,path)=>({path});export const where=(...args)=>args;export const query=(ref,...filters)=>({...ref,filters});export const serverTimestamp=()=>({seconds:123});
const snap=ref=>({id:ref.path.split('/').at(-1),metadata:{fromCache:false},exists:()=>store.has(ref.path),data:()=>store.get(ref.path)});
export const getDoc=async ref=>snap(ref);export const getDocs=async ref=>({docs:[...store.keys()].filter(path=>path.startsWith(ref.path+'/')).map(path=>snap({path})).filter(doc=>(ref.filters||[]).every(([field,op,value])=>op==='array-contains'?doc.data()[field]?.includes(value):doc.data()[field]===value))});
export const onSnapshot=(ref,options,next,error)=>{const listener={ref,next,stopped:false};listeners.push(listener);next(snap(ref));return()=>listener.stopped=true;};
export const runTransaction=async(db,callback)=>{const writes=[];const result=await callback({get:getDoc,update:(ref,data)=>writes.push([ref,data])});for(const [ref,data] of writes){store.set(ref.path,{...store.get(ref.path),...data});for(const listener of listeners)if(!listener.stopped&&listener.ref.path===ref.path)listener.next(snap(ref));}return result;};
`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-11-26T07:05:00Z'));
 await page.route('https://classes.test/**',route=>{
  const path=new URL(route.request().url()).pathname;let body,type='text/javascript';
  if(path==='/'){body=readFileSync('index.html');type='text/html';}
  else if(path==='/auth.js')body=auth;else if(path==='/firestore.js')body=firestore;else if(path==='/src/firebase.js')body='export const db={};export const auth={};';
  else if(/^\/(src|public-schedule)\/[\w-]+\.js$/.test(path))body=readFileSync(path.slice(1),'utf8').replaceAll("'firebase/auth'","'/auth.js'").replaceAll("'firebase/firestore'","'/firestore.js'");
  else if(path.endsWith('.css')){body=readFileSync(path.startsWith('/src/')||path.startsWith('/public-schedule/')?path.slice(1):'public'+path);type='text/css';}
  else if(path.endsWith('.png')){body=readFileSync('public'+path);type='image/png';}else if(path==='/university-shell.js')body=readFileSync('public/university-shell.js');else return route.abort();return route.fulfill({body,contentType:type});
 });
 await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
 await page.goto('https://classes.test/?section=class-cancellations');await page.waitForSelector('.regular-class-card');
 assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#class-cancellations').isVisible(),true);
 assert.equal(await page.locator('.regular-class-card').count(),1);assert.match(await page.locator('#class-list').textContent(),/Course/);assert.doesNotMatch(await page.locator('#class-list').textContent(),/Other teacher course/);
 assert.equal(await page.locator('[data-my-reservations] + [data-class-cancellations]').count(),1);
 await page.getByRole('button',{name:'Anuloni mësimin',exact:true}).click();assert.match(await page.locator('#class-change-summary').textContent(),/26 nëntor 2026/);await page.locator('#class-change-form button[value="back"]').click();
 assert.equal(await page.evaluate(()=>window.store.get('calendarDays/2026-11-26').cancelledClasses),undefined);
 await page.getByRole('button',{name:'Anuloni mësimin',exact:true}).click();await page.locator('#class-confirm-change').click();await page.waitForSelector('.regular-class-card.cancelled-class');
 const cancelled=await page.evaluate(()=>window.store.get('calendarDays/2026-11-26'));assert.equal(cancelled.releasedKeys.length,6);
 assert.equal(await page.evaluate(()=>window.store.get('calendarDays/2026-12-03').cancelledClasses),undefined);
 await page.selectOption('#languagePicker','en');assert.equal(await page.locator('#class-heading').textContent(),'Class cancellations');assert.equal(await page.getByRole('button',{name:'Restore class',exact:true}).count(),1);
 await page.evaluate(()=>window.store.set('eventDays/2026-11-26',{bookings:{g1__p01:'new-booking'}}));
 await page.getByRole('button',{name:'Restore class',exact:true}).click();await page.locator('#class-confirm-change').click();await page.waitForFunction(()=>document.getElementById('class-feedback').textContent.includes('cannot be restored'));
 assert.equal(await page.locator('.cancelled-class').count(),1);
 await page.evaluate(()=>window.store.delete('eventDays/2026-11-26'));
 await page.getByRole('button',{name:'Restore class',exact:true}).click();await page.locator('#class-confirm-change').click();await page.waitForFunction(()=>!document.querySelector('.regular-class-card.cancelled-class'));
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#class-next').click();assert.match(await page.locator('#class-list').textContent(),/3 December/);
 await page.evaluate(()=>window.testAuth({uid:'other',email:'other@uni-pr.edu',displayName:'Other'}));await page.waitForFunction(()=>document.getElementById('class-list').textContent.includes('Other teacher course'));assert.equal(await page.locator('.regular-class-card').count(),1);
 await page.locator('#logout').click();assert.equal(await page.locator('#class-cancellations').isVisible(),false);assert.equal(await page.evaluate(()=>window.listeners.every(l=>l.stopped)),true);assert.deepEqual(errors,[]);
 // Public views use the same dated snapshot; the class stays visible and its room becomes available.
 const publicPage=await browser.newPage({viewport:{width:1280,height:900}});publicPage.on('pageerror',e=>errors.push(e.message));await publicPage.clock.setFixedTime(new Date('2026-11-26T07:05:00Z'));
 const times=Array.from({length:8},(_,i)=>String(8+Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0'));
 const html=kind=>{const name=kind==='rooms'?'Room 1':kind==='teachers'?'Teacher':'Group 1 Automatic Subgroup';return '<table id="table_1"><caption><span class="name">'+name+'</span></caption><thead><tr>'+times.map(t=>'<th class="xAxis">'+t+'</th>').join('')+'</tr></thead><tbody>'+['E hënë','E martë','E mërkurë','E enjte','E premte'].map((day,d)=>'<tr><th class="yAxis">'+day+'</th>'+(d===3?'<td colspan="2"><span class="subject">Course</span><span class="teacher">Teacher</span><span class="studentsset">Group 1</span><span class="room">Room 1</span></td><td class="empty" colspan="6"></td>':'<td class="empty" colspan="8"></td>')+'</tr>').join('')+'</tbody></table>';};
 await publicPage.route('https://public.test/**',route=>{
  const path=new URL(route.request().url()).pathname.slice(1)||'index.html';let body,type='text/javascript';
  if(path==='public-bookings.js')body=`export function connectBookings(config,onDate,report){window.report=report;onDate(date=>report({status:'loading',date}));}`;
  else if(path==='staff-navigation.js')body='export async function connectStaffNavigation(){}';
  else if(/^WinterF_.*_days_vertical.html$/.test(path)){body=html(path.includes('teachers')?'teachers':path.includes('subgroups')?'subgroups':'rooms');type='text/html';}
  else if(existsSync('public-schedule/'+path)){body=readFileSync('public-schedule/'+path);type=path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript';}
  else return route.abort();return route.fulfill({body,contentType:type});
 });
 await publicPage.route('https://static.cloudflareinsights.com/**',route=>route.abort());await publicPage.goto('https://public.test/');await publicPage.waitForFunction(()=>window.report&&!document.getElementById('mainContent').hidden);
 const state={status:'ready',date:'2026-11-26',day:cancelled,days:{'2026-11-26':cancelled},rooms:[{name:'Room 1'}],rows:[]};await publicPage.evaluate(s=>window.report(s),state);
 await publicPage.selectOption('#category','rooms');assert.equal(await publicPage.locator('.event.cancelled-class').count(),1);
 await publicPage.click('#viewList');assert.equal(await publicPage.locator('.agenda-entry.cancelled-class').count(),1);await publicPage.locator('.agenda-entry.cancelled-class').click();assert.match(await publicPage.locator('#modalDetails').textContent(),/Anuluar/);await publicPage.click('#closeDialog');
 await publicPage.click('#navFree');await publicPage.selectOption('#freeStart','0');await publicPage.selectOption('#freeEnd','2');assert.equal(await publicPage.locator('#roomResults a').count(),1);
 await publicPage.click('#navToday');await publicPage.evaluate(s=>window.report(s),state);assert.equal(await publicPage.locator('#todayNow .cancelled-class').count(),1);assert.equal(await publicPage.locator('#todayRooms a').count(),1);
 const restored={...cancelled,cancelledClasses:{},releasedKeys:[]};await publicPage.evaluate(s=>window.report(s),{...state,day:restored,days:{'2026-11-26':restored}});assert.equal(await publicPage.locator('#todayNow .cancelled-class').count(),0);assert.equal(await publicPage.locator('#todayRooms a').count(),0);
 assert.deepEqual(errors,[]);console.log('Dated cancellation and restoration, account scoping, conflicts, live updates, public hatching, room availability, translations, and mobile layout passed.');
}finally{await browser.close();}
