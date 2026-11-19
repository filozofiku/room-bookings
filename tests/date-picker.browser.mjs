import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`),{chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:420,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-11-19T10:00Z'));
 await page.route('https://calendar.test/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<html lang="sq"><link rel="stylesheet" href="/date-picker.css"><style>.booking-portal button{background:#99080d;color:white;border:1px solid red;padding:10px 16px;min-height:42px}</style><body class="booking-portal"><label for="date">Data</label><input id="date" type="date" value="2026-12-10" min="2026-11-19" max="2027-02-15"><script type="module">import {inlineCalendar} from '/date-picker.js';window.language='sq';window.changes=0;const input=document.getElementById('date');input.addEventListener('change',()=>changes++);window.calendar=inlineCalendar(input,{language:()=>language});</script></html>`});
  if(!['/date-picker.js','/dates.js','/date-picker.css'].includes(path))return route.abort();return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync('public-schedule'+path)});
 });
 await page.goto('https://calendar.test/');await page.waitForSelector('.calendar-grid');
 assert.equal(await page.locator('#date').isVisible(),false);assert.equal(await page.locator('.calendar-selection').textContent(),'10 dhjetor 2026');
 assert.equal(await page.locator('[role=gridcell]').count(),42);
 await page.getByRole('button',{name:'Muaji i mëparshëm',exact:true}).click();
 assert.equal(await page.locator('[data-date="2026-11-18"]').isDisabled(),true);
 assert.equal(await page.locator('[data-date="2026-11-18"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
 await page.locator('[data-date="2026-11-19"]').click();assert.equal(await page.locator('#date').inputValue(),'2026-11-19');assert.equal(await page.evaluate(()=>changes),1);
 await page.evaluate(()=>{language='en';calendar.render()});assert.equal(await page.locator('.calendar-selection').textContent(),'19 November 2026');
 await page.getByRole('button',{name:'Next month',exact:true}).click();await page.locator('[data-date="2026-12-10"]').click();
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator(':focus').getAttribute('data-date'),'2026-12-11');
 assert.equal(await page.locator('#date').inputValue(),'2026-12-10');await page.keyboard.press('Enter');assert.equal(await page.locator('#date').inputValue(),'2026-12-11');
 await page.keyboard.press('PageDown');assert.equal(await page.locator(':focus').getAttribute('data-date'),'2027-01-11');await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Next month',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Next month',exact:true}).isDisabled(),true);assert.equal(await page.locator('[data-date="2027-02-16"]').isDisabled(),true);
 await page.getByRole('button',{name:/Choose today:/}).click();assert.equal(await page.locator('#date').inputValue(),'2026-11-19');
 await page.evaluate(()=>{const input=document.getElementById('date');input.min='2028-01-01';input.max='2028-03-31';input.value='2028-02-28';calendar.render()});
 await page.locator('[data-date="2028-02-28"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator(':focus').getAttribute('data-date'),'2028-02-29');await page.keyboard.press('ArrowRight');assert.equal(await page.locator(':focus').getAttribute('data-date'),'2028-03-01');
 await page.setViewportSize({width:320,height:700});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.doesNotMatch(await page.locator('body').innerText(),/2028-0[123]-/);
 await page.screenshot({path:'/tmp/fet-calendar-mobile.png'});assert.deepEqual(errors,[]);
 console.log('Inline calendar passed: visible month, localized dates, bounded selection, keyboard navigation, leap day, Today, and mobile width.');
}finally{await browser.close()}
