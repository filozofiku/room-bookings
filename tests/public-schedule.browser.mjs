import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(process.env.TEST_MODULES_DIR ? `${process.env.TEST_MODULES_DIR}/package.json` : import.meta.url);
const {chromium} = require('playwright');
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.route('**/public-bookings.js',route => route.fulfill({contentType:'text/javascript',body:`
    export async function connectBookings(config, onDate, report) {
      window.testReport = report;
      onDate(date => {window.testDate = date;report({status:'loading'});});
    }
  `}));
  await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:8765');
  await page.waitForFunction(() => window.testReport && !document.getElementById('mainContent').hidden);
  await page.selectOption('#category','rooms');
  const roomName = await page.locator('#entity').inputValue();
  const result = {status:'ready',date:'2026-10-23',day:{weekday:'5',fetActive:false,bookingAllowed:true},rooms:[{id:'r1',name:roomName}],rows:[]};
  await page.evaluate(value => window.testReport(value),result);
  await page.click('#navFree');
  assert.equal(await page.locator('.room-choice').count(),1);
  const booking = {title:'<img src=x onerror=alert(1)>',date:result.date,room:roomName,slots:[{start:'12:00',end:'12:15'}]};
  await page.evaluate(value => window.testReport(value),{...result,rows:[booking]});
  assert.equal(await page.locator('.room-choice').count(),0);
  assert.equal(await page.locator('#bookingRows tr').count(),1);
  assert.equal(await page.locator('#bookingRows img').count(),0);
  await page.evaluate(value => window.testReport(value),result);
  assert.equal(await page.locator('.room-choice').count(),1);
  assert.equal(await page.locator('#bookingRows tr').count(),0);
  await page.evaluate(value => window.testReport(value),{...result,day:{...result.day,bookingAllowed:false}});
  assert.equal(await page.locator('.room-choice').count(),0);
  await page.evaluate(() => window.testReport({status:'error',message:'Offline'}));
  assert.equal(await page.locator('.room-choice').count(),0);
  assert.match(await page.locator('#freeCount').textContent(),/nuk mund/);
  await page.locator('#bookingDate').fill('2026-10-24');
  await page.locator('#bookingDate').dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.testDate),'2026-10-24');
  assert.equal(await page.locator('.room-choice').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/fet-public-preview-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: timetable loading, public table, cancellation, overlap, closed dates, offline, date change, safe titles.');
} finally { await browser.close(); }
