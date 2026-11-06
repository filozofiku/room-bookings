import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.env.TEST_MODULES_DIR?`${process.env.TEST_MODULES_DIR}/package.json`:import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // 10:07 in Prishtina: the next reservable period starts at 10:15.
 await page.clock.setFixedTime(new Date('2026-11-06T09:07:00Z'));
 await page.route('**/public-bookings.js',route=>route.fulfill({contentType:'text/javascript',body:`export async function connectBookings(config,onDate,report){window.reportToday=report;onDate(date=>report({status:'loading',date}));}`}));
 await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8765');
 await page.waitForSelector('#mainContent:not([hidden])');
 await page.selectOption('#category','rooms');
 const rooms=await page.locator('#entity option').evaluateAll(options=>options.slice(0,4).map(o=>({name:o.value})));
 assert.equal(rooms.length,4);
 await page.click('#navToday');
 const result={status:'ready',date:'2026-11-06',day:{weekday:'5',fetActive:false,bookingAllowed:true},rooms,rows:[
  {room:rooms[0].name,title:'After 45 minutes',slots:[{start:'11:00',end:'11:15'}]},
  {room:rooms[1].name,title:'After 90 minutes',slots:[{start:'11:45',end:'12:00'}]},
  {room:rooms[2].name,title:'After 135 minutes',slots:[{start:'12:30',end:'12:45'}]},
  {room:rooms[3].name,title:'Busy now',slots:[{start:'10:00',end:'10:15'}]}
 ].map(b=>({...b,date:'2026-11-06'}))};
 await page.evaluate(result=>window.reportToday(result),result);
 const listed=()=>page.locator('#todayRooms a').evaluateAll(links=>links.map(link=>new URL(link.href).searchParams.get('room')));
 const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
 for(const [duration,expected] of [['45',rooms.slice(0,3)],['90',rooms.slice(1,3)],['135',rooms.slice(2,3)]]){
  await page.selectOption('#todayDuration',duration);
  assert.deepEqual((await listed()).sort(),expected.map(r=>r.name).sort());
  for(const href of await page.locator('#todayRooms a').evaluateAll(links=>links.map(link=>link.href))){
   const params=new URL(href).searchParams;assert.equal(params.get('start'),'10:15');assert.equal(minutes(params.get('end'))-minutes(params.get('start')),Number(duration));
  }
 }
 // A reservation ending exactly now no longer excludes a room.
 await page.clock.setFixedTime(new Date('2026-11-06T09:15:00Z'));
 await page.selectOption('#todayDuration','45');assert.ok((await listed()).includes(rooms[3].name));
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(result=>window.reportToday({...result,day:{...result.day,bookingAllowed:false}}),result);
 assert.equal(await page.locator('#todayRooms a').count(),0);assert.match(await page.locator('#todayRooms').textContent(),/mbyllur/);
 await page.clock.setFixedTime(new Date('2026-11-06T19:00:00Z'));
 await page.evaluate(result=>window.reportToday(result),result);await page.selectOption('#todayDuration','135');
 assert.equal(await page.locator('#todayRooms a').count(),0);assert.match(await page.locator('#todayRooms').textContent(),/kohë të mjaftueshme/);
 await page.evaluate(()=>window.reportToday({status:'loading',date:'2026-11-06'}));assert.equal(await page.locator('#todayRooms a').count(),0);
 assert.deepEqual(errors,[]);
 console.log('Today duration filters passed: 45/90/135 minutes, full-interval availability, exact booking links, boundaries, closed dates, loading, and mobile layout.');
}finally{await browser.close();}
