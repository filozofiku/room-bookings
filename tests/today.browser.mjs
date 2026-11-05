import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire((process.env.TEST_MODULES_DIR||'/tmp/fet-resource-tests')+'/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-11-05T11:07:00Z')});
 await page.route('https://today.test/**',route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
  if(name==='public-bookings.js')return route.fulfill({contentType:'text/javascript',body:`export function connectBookings(config,onDate,report){window.report=report;onDate(date=>{window.selectedDate=date;report({status:'loading'});});}`});
  const path=existsSync('public-schedule/'+name)?'public-schedule/'+name:'/tmp/fet-schedule-publish/'+name;
  if(!existsSync(path))return route.abort();
  return route.fulfill({contentType:name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'image/svg+xml',body:readFileSync(path)});
 });
 await page.goto('https://today.test/#sot');
 await page.waitForFunction(()=>window.report&&!document.querySelector('#mainContent').hidden);
 assert.equal(await page.locator('#todayPanel').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.selectedDate),'2026-11-05');
 assert.match(await page.locator('#todayRooms').textContent(),/nuk mund të verifikohet/);
 const state={status:'ready',date:'2026-11-05',day:{weekday:'4',fetActive:false,bookingAllowed:true},rooms:[{name:'Salla 014'},{name:'Salla 127'}],rows:[{id:'test',title:'Event now',date:'2026-11-05',room:'Salla 014',slots:[{start:'12:00',end:'13:00'}],creatorName:'Private name'},{id:'roomless',title:'Online event',date:'2026-11-05',room:'',slots:[{start:'14:00',end:'15:00'}]}]};
 await page.evaluate(s=>window.report(s),state);
 assert.equal(await page.locator('#todayNow button').count(),1);
 assert.equal(await page.locator('#todayEvents button').count(),2);
 assert.doesNotMatch(await page.locator('#todayEvents').textContent(),/Private name/);
 assert.doesNotMatch(await page.locator('#todayRooms').textContent(),/Salla 014/);
 const url=new URL(await page.locator('#todayRooms a').first().getAttribute('href'));
 assert.equal(url.searchParams.get('date'),'2026-11-05');assert.equal(url.searchParams.get('room'),'Salla 127');assert.equal(url.searchParams.get('start'),'12:15');assert.equal(url.searchParams.get('end'),'13:45');
 await page.locator('#todayNow button').click();assert.match(await page.locator('#modalDetails').textContent(),/Private name/);await page.click('#closeDialog');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(s=>window.report({...s,day:{...s.day,bookingAllowed:false}}),state);assert.equal(await page.locator('#todayRooms a').count(),0);
 await page.evaluate(()=>window.report({status:'error'}));assert.equal(await page.locator('#todayRooms a').count(),0);
 await page.evaluate(s=>window.report(s),state);
 await page.clock.fastForward(60*60*1000);assert.equal(await page.locator('#todayNow button').count(),0);
 assert.deepEqual(errors,[]);console.log('Mobile Today view: events, privacy, room availability, booking links, clock updates, and failure states passed.');
}finally{await browser.close();}
