import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`),{chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://unsubscribe.test/**',route=>route.fulfill({body:readFileSync(route.request().url().includes('.js')?'public/unsubscribe.js':'public/unsubscribe.html'),contentType:route.request().url().includes('.js')?'text/javascript':'text/html'}));
 let fail=false;
 await page.route('https://firestore.googleapis.com/**',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:fail?403:200,contentType:'application/json',body:'{}'});});
 await page.goto('https://unsubscribe.test/unsubscribe.html');assert.equal(await page.locator('button').isDisabled(),true);assert.match(await page.locator('#status').innerText(),/nuk është e vlefshme/);
 const id='a'.repeat(64),token='12345678-1234-1234-1234-123456789012';
 await page.goto(`https://unsubscribe.test/unsubscribe.html#id=${id}&token=${token}`);await page.reload();assert.equal(await page.locator('button').isEnabled(),true);assert.equal(writes.length,0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 fail=true;await page.locator('button').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('nuk u ruajt'));assert.equal(await page.locator('button').isEnabled(),true);
 fail=false;await page.locator('button').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('me sukses'));
 assert.equal(writes.length,2);assert.equal(writes[1].writes[0].update.fields.confirmationToken.stringValue,token);assert.equal(writes[1].writes[0].updateTransforms[0].setToServerValue,'REQUEST_TIME');assert.equal(await page.locator('button').isVisible(),false);assert.equal(new URL(page.url()).hash,'');assert.deepEqual(errors,[]);
 console.log('Unsubscribe: no automatic action, invalid links, failure/retry, confirmation, mobile layout and token removal passed.');
}finally{await browser.close();}
