import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(`${process.env.TEST_MODULES_DIR||'/tmp/fet-reporting-validation'}/package.json`),{chromium}=require('playwright');
const auth=`export class GoogleAuthProvider{setCustomParameters(){}};export const signInWithPopup=async()=>{};export const signOut=async()=>window.testAuth(null);export function onAuthStateChanged(auth,callback){window.testAuth=callback;callback({uid:'teacher',displayName:'Teacher'});}`;
const firestore=`
const stamp=date=>({seconds:Date.parse(date)/1000});
const store=new Map([
 ['users/teacher',{active:true,role:'teacher'}],['users/manager',{active:true,role:'admin',canCancelAll:true}],
 ['settings/control',{slotStorage:'resources-v2',startDate:'2026-09-15',endDate:'2026-12-31',auditCompleteFrom:stamp('2026-11-15')}],
 ['activityEvents/one__created',{kind:'created',entityId:'one',ownerUid:'teacher',method:'direct',source:'app',title:'Original <img src=x onerror=alert(1)>',occurredAt:stamp('2026-11-15T10:00Z'),activityDate:'2026-12-01'}],
 ['activityEvents/two__requested',{kind:'requested',entityId:'two',ownerUid:'other',source:'app',title:'Request',occurredAt:stamp('2026-11-14T10:00Z')}],
 ['activityEvents/two__declined',{kind:'declined',entityId:'two',ownerUid:'other',source:'app',title:'Request',requestedAt:stamp('2026-11-14T10:00Z'),occurredAt:stamp('2026-11-15T10:00Z')}],
 ['studentNotifications/email',{booking:{title:'Panel'},kind:'students',createdAt:stamp('2026-11-15T10:00Z'),sentAt:stamp('2026-11-15T10:01Z'),recipients:['private@student.uni-pr.edu'],sentRecipients:['private@student.uni-pr.edu'],status:'sent'}],
 ['trafficDaily/2026-11-15',{visits:12,pageViews:37,complete:false,paths:[{path:'/',pageViews:30},{path:'/room-bookings/',pageViews:7}]}],
 ['reportSettings/traffic',{status:'ready',lastSuccessAt:stamp('2026-11-15T10:00Z')}]
]);window.testStore=store;window.testQueries=[];
export const collection=(db,path)=>path;export const doc=(db,...parts)=>({path:parts.join('/')});export const query=path=>path;export const where=(...args)=>args;export const serverTimestamp=()=>stamp('2026-11-15T10:00Z');export const runTransaction=async()=>{};
export const getDoc=async ref=>{window.testQueries.push(ref.path);if(window.testDelay){await window.testDelay;}return {exists:()=>store.has(ref.path),data:()=>store.get(ref.path)};};
export const getDocs=async path=>{window.testQueries.push(path);if(window.testFail)throw Error('unavailable');return {docs:[...store].filter(([key])=>key.startsWith(path+'/')).map(([key,data])=>({id:key.split('/').at(-1),data:()=>data}))};};
`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-11-15T11:00Z'));
 await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
 await page.route('https://reporting.test/**',route=>{
   const path=new URL(route.request().url()).pathname;let body,type='text/javascript';
   if(path==='/'){body=readFileSync('index.html');type='text/html';}
   else if(path==='/auth.js')body=auth;
   else if(path==='/firestore.js')body=firestore;
   else if(path==='/src/firebase.js')body='export const db={};export const auth={};';
   else if(path==='/public-schedule/date-picker.css'){body=readFileSync('public-schedule/date-picker.css');type='text/css';}
   else if(['/university-shell.css','/src/reports.css'].includes(path)){body=readFileSync(path.startsWith('/src/')?path.slice(1):'public'+path);type='text/css';}
   else if(path==='/university-logo.png'){body=readFileSync('public/university-logo.png');type='image/png';}
   else if(path==='/university-shell.js')body=readFileSync('public/university-shell.js');
   else if(/^\/(src|public-schedule)\/[a-z0-9-]+\.js$/.test(path))body=readFileSync(path.slice(1),'utf8').replaceAll("'firebase/auth'","'/auth.js'").replaceAll("'firebase/firestore'","'/firestore.js'");
   else return route.abort();
   return route.fulfill({body,contentType:type});
 });
 await page.goto('https://reporting.test/?section=reports');await page.waitForFunction(()=>window.testAuth);
 await page.waitForFunction(()=>document.getElementById('message').textContent.includes('autorizim'));
 assert.equal(await page.locator('#reports').isVisible(),false);assert.equal(await page.locator('#reports-link').isVisible(),false);
 assert.deepEqual(await page.evaluate(()=>window.testQueries),['users/teacher']);
 await page.evaluate(()=>window.testAuth({uid:'manager',displayName:'Manager'}));
 await page.waitForFunction(()=>document.getElementById('reports-content').textContent.includes('37'));
 assert.equal(await page.locator('#reports').isVisible(),true);assert.equal(await page.locator('#app').isVisible(),false);
 assert.equal(await page.locator('#reports-content img').count(),0);
 assert.match(await page.locator('#reports-content').textContent(),/Original <img/);
 assert.doesNotMatch(await page.locator('#reports-content').textContent(),/private@student/);
 await page.selectOption('#languagePicker','en');
 assert.equal(await page.locator('#reports-heading').textContent(),'Statistics and reports');
 assert.equal(await page.locator('header h1').textContent(),'Statistics and reports');
 assert.match(await page.locator('#reports-content').textContent(),/Distinct addresses/);
 const download=page.waitForEvent('download');await page.click('#report-export');assert.match((await download).suggestedFilename(),/^faculty-report-2026-11-01-2026-11-15\.csv$/);
 await page.locator('#report-start-calendar button[aria-label="Next month"]').click();await page.locator('#report-start-calendar button[data-date="2026-12-01"]').click();assert.equal(await page.locator('#report-export').isDisabled(),true);
 await page.locator('#report-end-calendar button[aria-label="Next month"]').click();await page.locator('#report-end-calendar button[data-date="2026-12-31"]').click();assert.equal(await page.locator('#report-export').isDisabled(),false);
 assert.match(await page.locator('#reports-content').textContent(),/No synchronized traffic data/);
 await page.selectOption('#report-period','month');
 await page.screenshot({path:'/tmp/fet-reporting-dashboard-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/tmp/fet-reporting-dashboard-mobile.png',fullPage:true});
 await page.evaluate(()=>window.testAuth(null));
 assert.equal(await page.locator('#reports').isVisible(),false);assert.equal(await page.locator('#reports-content').textContent(),'');assert.equal(await page.locator('#report-export').isDisabled(),true);
 // Signing out while loading cannot reveal the prior user's report afterwards.
 await page.evaluate(()=>{window.testDelay=new Promise(resolve=>window.testRelease=resolve);window.testAuth({uid:'manager'});});
 await page.evaluate(()=>window.testAuth(null));await page.evaluate(()=>{window.testRelease();window.testDelay=null;});
 assert.equal(await page.locator('#reports').isVisible(),false);
 await page.evaluate(()=>window.testAuth({uid:'manager'}));await page.waitForSelector('#report-export:not([disabled])');
 await page.evaluate(()=>window.testFail=true);await page.click('#report-refresh');
 await page.waitForFunction(()=>document.getElementById('reports-feedback').textContent.includes('could not be loaded'));
 assert.equal(await page.locator('#reports-content').textContent(),'');assert.equal(await page.locator('#report-export').isDisabled(),true);
 assert.deepEqual(errors,[]);
 console.log('Reporting browser checks passed: access, filters, bilingual rendering, CSV, error states, logout races, escaping, and responsive layout.');
}finally{await browser.close();}
