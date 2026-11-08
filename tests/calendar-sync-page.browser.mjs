import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {connectionPage} from '../calendar-sync/page.js';
const require=createRequire('/tmp/fet-resource-tests/package.json'),{chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{for(const language of ['sq','en']){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>{
  window.calls=[];window.rpcFail=false;let state={connected:false,calendar:null,items:[],automatic:false};
  const runner=(success,failure)=>new Proxy({},{get(_,key){if(key==='withSuccessHandler')return callback=>runner(callback,failure);if(key==='withFailureHandler')return callback=>runner(success,callback);return arg=>{window.calls.push({method:key,arg});if(window.rpcFail){failure({message:'Google Calendar request failed ('+(window.rpcStatus||403)+').' });return;}
   if(key==='connectFacultyActivity')state={connected:true,calendar:{name:'Fakulteti Filozofik · Orari',id:'alice@example.test',url:'https://calendar.google.com/calendar/embed?src=alice%40example.test',visible:true},items:[{kind:'class',id:'class-1',title:'Psikologji <img src=x onerror=alert(1)>',eventUrl:'https://www.google.com/calendar/event?eid=test'}],automatic:true,action:'connected'};
   else if(key==='reauthorizeFacultyCalendar')state={authorizationReset:true};
   else if(key==='removeFacultyActivity')state={...state,items:[],automatic:false,action:'removed'};
   else state={...state,action:null};success(state);
  };}});window.google={script:{run:runner()}};
 });
 await page.route('https://calendar-page.test/',route=>route.fulfill({contentType:'text/html',body:connectionPage({kind:'class',id:'class-1'},language)}));
 await page.goto('https://calendar-page.test/');await page.locator('#add').waitFor({state:'visible'});await page.click('#add');
 assert.equal(await page.locator('#calendar-name').textContent(),'Fakulteti Filozofik · Orari');assert.equal(await page.locator('#calendar-id').textContent(),'alice@example.test');assert.match(await page.locator('#calendar-link').getAttribute('href'),/calendar\/embed\?src=alice%40example.test/);assert.equal(await page.locator('#items img').count(),0);assert.equal(await page.locator('#items a').getAttribute('href'),'https://www.google.com/calendar/event?eid=test');assert.match(await page.locator('#message').textContent(),language==='sq'?/Aktiviteti u lidh/:/Activity connected/);
 await page.locator('#items button').click();assert.equal(await page.locator('#items li').count(),0);assert.match(await page.locator('#message').textContent(),language==='sq'?/u hoq/:/was removed/);
 await page.evaluate(()=>window.rpcFail=true);await page.click('#refresh');assert.equal(await page.locator('#error-box').getAttribute('hidden'),null);assert.match(await page.locator('#error-details').textContent(),/403/);assert.equal(await page.evaluate(()=>calls.at(-1).method),'checkFacultyCalendar');await page.evaluate(()=>window.rpcStatus=401);await page.click('#refresh');await page.locator('#reauthorize').waitFor({state:'visible'});assert.match(await page.locator('#message').textContent(),/401/);await page.evaluate(()=>window.rpcFail=false);await page.click('#reauthorize');assert.equal(await page.evaluate(()=>calls.at(-1).method),'reauthorizeFacultyCalendar');assert.equal(await page.locator('#refresh').isDisabled(),true);assert.deepEqual(errors,[]);await page.close();
}console.log('Connection page verified in Albanian and English: destination calendar, safe event links, add/remove outcomes, check-now handler and visible errors.');}finally{await browser.close();}
