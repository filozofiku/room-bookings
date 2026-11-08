import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire('/tmp/fet-resource-tests/package.json'),{chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const catalog=JSON.parse(readFileSync('public-schedule/calendar-classes.json','utf8'));
 await page.route('https://filozofiku.github.io/calendar-config.json',route=>route.fulfill({json:{endpoint:'https://script.google.com/macros/s/FEED/exec',syncEndpoint:'https://script.google.com/macros/s/SYNC/exec'}}));
 await page.route('https://filozofiku.github.io/calendar-classes.json',route=>route.fulfill({json:catalog}));
 await page.route('https://calendar-ui.test/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({contentType:path==='/'?'text/html':'text/javascript',body:path==='/'?`<!doctype html><html lang="en"><body><main></main><script type="module">import{calendarActions}from'/calendar.js';import{EN}from'/i18n.js';window.show=event=>document.querySelector('main').replaceChildren(calendarActions(event,s=>document.documentElement.lang==='en'?(EN[s]||s):s));window.show({id:'one',title:'Titulli',date:'2026-11-08',start:'14:30',end:'16:00'});</script></body></html>`:readFileSync(path==='/calendar.js'?'src/calendar-export.js':'public-schedule/i18n.js','utf8')});});
 await page.goto('https://calendar-ui.test/');await page.locator('summary').click();await page.getByRole('link',{name:'Connect Google Calendar (check every 5 minutes)'}).waitFor();
 let link=new URL(await page.locator('a').getAttribute('href'));assert.equal(link.pathname,'/macros/s/SYNC/exec');assert.equal(link.searchParams.get('booking'),'one');assert.equal(link.searchParams.get('lang'),'en');assert.match(await page.locator('input').inputValue(),/^https:\/\/script.google.com\/macros\/s\/FEED\/exec\?booking=one$/);assert.match(await page.locator('main').textContent(),/Your authorization is required/);
 const cls=catalog.classes[0];await page.evaluate(cls=>{document.documentElement.lang='sq';window.show({id:'local',title:cls.title,weekly:true,classKey:cls.key,date:'2026-09-15',start:cls.start,end:cls.end});},cls);await page.locator('summary').click();await page.getByRole('link',{name:'Lidh Google Calendar (kontroll çdo 5 minuta)'}).waitFor();link=new URL(await page.locator('a').getAttribute('href'));assert.equal(link.searchParams.get('class'),cls.id);assert.equal(link.searchParams.get('lang'),'sq');assert(!link.searchParams.has('booking'));
 assert.deepEqual(errors,[]);console.log('Fast calendar connection links passed: bookings/classes, Albanian/English, correct user service, and preserved feed fallback.');
}finally{await browser.close();}
