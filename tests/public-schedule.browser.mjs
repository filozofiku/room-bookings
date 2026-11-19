import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(process.env.TEST_MODULES_DIR ? `${process.env.TEST_MODULES_DIR}/package.json` : import.meta.url);
const {chromium} = require('playwright');
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  // Use the real staff navigation module with deterministic Firebase responses.
  await page.route('https://www.gstatic.com/firebasejs/12.0.0/**',route => {
    const file=new URL(route.request().url()).pathname.split('/').at(-1);
    const modules={
      'firebase-app.js':`let app;export const getApps=()=>app?[app]:[];export const getApp=()=>app;export const initializeApp=config=>(app=config);`,
      'firebase-auth.js':`export const getAuth=()=>({});export const signOut=async()=>window.testStaffAuth(null);export const onAuthStateChanged=(auth,callback)=>{window.testStaffAuth=callback;callback(null);return ()=>{};};`,
      'firebase-firestore.js':`export const getFirestore=()=>({});export const doc=(db,collection,uid)=>uid;export const getDoc=async uid=>{if(window.testStaffDelay)await window.testStaffDelay;if(window.testStaffFailure)throw Error('offline');return {exists:()=>uid!=='student',data:()=>({active:['staff','nonstaff'].includes(uid),role:uid==='nonstaff'?'student':'teacher'})};};`
    };
    return route.fulfill({contentType:'text/javascript',body:modules[file]});
  });
  await page.route('**/public-bookings.js',route => route.fulfill({contentType:'text/javascript',body:`
    export async function connectBookings(config, onDate, report) {
      window.testReport = report;
      onDate(date => {window.testDate = date;report({status:'loading'});});
    }
  `}));
  await page.route('https://filozofiku.github.io/calendar-config.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({endpoint:'https://script.google.com/macros/s/TEST/exec'})}));
  await page.route('https://filozofiku.github.io/calendar-classes.json',route=>route.fulfill({contentType:'application/json',body:readFileSync('public-schedule/calendar-classes.json','utf8')}));
  await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:8765');
  await page.waitForFunction(() => window.testReport && !document.getElementById('mainContent').hidden);
  await page.waitForFunction(()=>window.testStaffAuth);
  assert.equal(await page.locator('.rail-links a:visible').count(),4);
  assert.equal(await page.locator('a[data-staff-entry]').isVisible(),true);
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),false);
  await page.evaluate(()=>window.testStaffAuth({uid:'student',email:'student@student.uni-pr.edu'}));
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),false);
  await page.evaluate(()=>window.testStaffAuth({uid:'inactive',email:'inactive@uni-pr.edu'}));
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),false);
  await page.evaluate(()=>window.testStaffAuth({uid:'nonstaff',email:'nonstaff@uni-pr.edu'}));
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),false);
  await page.evaluate(()=>window.testStaffAuth({uid:'staff',email:'teacher@uni-pr.edu'}));
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),true);
  assert.equal(await page.locator('a[data-staff-entry]').isVisible(),false);
  assert.equal(await page.locator('[data-staff-identity]').textContent(),'teacher@uni-pr.edu');
  await page.selectOption('#languagePicker','en');
  assert.equal(await page.locator('[data-my-reservations]').textContent(),'My reservations');
  assert.equal(await page.locator('[data-staff-logout]').textContent(),'Sign out');
  await page.selectOption('#languagePicker','sq');
  await page.locator('[data-staff-logout]').click();
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),false);
  await page.evaluate(async()=>{window.testStaffFailure=true;await window.testStaffAuth({uid:'staff'});window.testStaffFailure=false;});
  assert.equal(await page.locator('a[data-staff-entry]').isVisible(),true);
  assert.equal(await page.locator('#mainContent').isVisible(),true);
  await page.evaluate(()=>{window.testStaffDelay=new Promise(resolve=>window.releaseStaff=resolve);window.testStaffAuth({uid:'staff'});});
  await page.evaluate(()=>window.testStaffAuth(null));
  await page.evaluate(()=>{window.releaseStaff();window.testStaffDelay=null;});
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),false);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('a[data-staff-entry]').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'/tmp/fet-public-staff-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:720});
  await page.locator('#bookingDate').evaluate((el,date)=>{el.value=date},'2026-10-23');
  // Anonymous visitors can export a class occurrence from the displayed week.
  await page.locator('#weekBody .event').first().click();
  assert.match(await page.locator('#modalCalendar').textContent(),/Përsëritet çdo javë deri më 31 dhjetor 2026/);
  await page.locator('#modalCalendar summary').click();
  await page.locator('#modalCalendar a').waitFor({state:'visible'});
  const classUrl=new URL(await page.locator('#modalCalendar a').getAttribute('href'));
  const classFeed=new URL(classUrl.searchParams.get('cid'));
  assert.match(classFeed.searchParams.get('class'),/^class-\d+$/);
  assert.equal(classFeed.searchParams.has('booking'),false);
  assert.equal(classFeed.protocol,'webcal:');
  assert.equal(await page.locator('#modalCalendar input').inputValue(),classFeed.href.replace(/^webcal:/,'https:'));
  const classDownload=page.waitForEvent('download');await page.locator('#modalCalendar button').click();assert.equal((await classDownload).suggestedFilename(),'rezervimi.ics');
  await page.click('#closeDialog');
  assert.equal(await page.locator('#bookingDate').isVisible(),false);
  assert.equal(await page.locator('#weekNavigation').isVisible(),true);
  await page.click('#nextWeek');assert.equal(await page.locator('#bookingDate').inputValue(),'2026-10-26');
  assert.equal(await page.evaluate(()=>window.testDate),'2026-10-26');
  await page.click('#previousWeek');assert.equal(await page.locator('#bookingDate').inputValue(),'2026-10-19');
  await page.click('#navFree');assert.equal(await page.locator('#bookingDate-calendar').isVisible(),true);
  assert.equal(await page.locator('#weekNavigation').isVisible(),false);
  await page.locator('#bookingDate-calendar button[data-date="2026-10-23"]').click();
  await page.click('#navSchedules');assert.equal(await page.locator('#bookingDate').isVisible(),false);
  await page.selectOption('#category','rooms');
  const roomName = await page.locator('#entity').inputValue();
  const result = {status:'ready',date:'2026-10-23',day:{weekday:'5',fetActive:false,bookingAllowed:true},rooms:[{id:'r1',name:roomName}],rows:[]};
  await page.evaluate(value => window.testReport(value),result);
  assert.equal(await page.locator('#bookingStatus').isVisible(),false);
  assert.doesNotMatch(await page.locator('body').innerText(),/Rezervimet shfaqen në orar, vetëm në javën e zgjedhur/);
  assert.equal(await page.locator('#weekBody .day-column').count(),5);
  assert.equal(await page.locator('#agendaView .agenda-day').count(),5);
  for(const date of ['2026-10-24','2026-10-25']) {
    await page.evaluate(value => window.testReport(value),{...result,rows:[{
      title:'Rezervim në fundjavë',date,room:roomName,slots:[{start:'12:00',end:'12:15'}]
    }]});
    assert.equal(await page.locator('#weekBody .day-column').count(),7);
    assert.equal(await page.locator('#agendaView .agenda-day').count(),7);
    assert.match(await page.locator('#weekHeader').textContent(),/E shtunë/);
    assert.match(await page.locator('#weekHeader').textContent(),/E diel/);
  }
  await page.evaluate(value => window.testReport(value),result);
  assert.equal(await page.locator('#weekBody .day-column').count(),5);
  assert.equal(await page.locator('#agendaView .agenda-day').count(),5);
  await page.click('#navFree');
  assert.equal(await page.locator('#freeDay').evaluate(el=>el.tagName),'OUTPUT');
  assert.equal(await page.locator('#freeDay').textContent(),'E premte');
  assert.match(await page.locator('#freeDayHint').textContent(),/ndryshoni datën/);
  await page.locator('#bookingDate').evaluate((el,value)=>{el.value=value},'2026-10-24');await page.locator('#bookingDate').dispatchEvent('change');
  assert.equal(await page.locator('#freeDay').textContent(),'E shtunë');
  await page.locator('#bookingDate').evaluate((el,value)=>{el.value=value},'2026-10-23');await page.locator('#bookingDate').dispatchEvent('change');
  await page.evaluate(value=>window.testReport(value),result);
  assert.equal(await page.locator('.room-choice').count(),1);
  {const link=new URL(await page.locator('.room-choice').first().getAttribute('href'));
   assert.equal(link.origin+link.pathname,'https://filozofiku.github.io/room-bookings/');
   assert.equal(link.searchParams.get('date'),await page.locator('#bookingDate').inputValue());
   assert.equal(link.searchParams.get('room'),roomName);
   assert.equal(link.searchParams.get('start'),await page.locator('#freeStart option:checked').textContent());
   assert.equal(link.searchParams.get('end'),await page.locator('#freeEnd option:checked').textContent());}
  // Optional capacity/equipment filters combine with availability and can be cleared.
  const featureRooms=['Salla 02','Salla 05','Salla 108','Salla 127'];
  await page.evaluate(value=>window.testReport(value),{...result,rooms:featureRooms.map((name,i)=>({id:'test'+i,name})),rows:[]});
  assert.equal(await page.locator('.room-choice').count(),4);
  await page.fill('#freeCapacity','63');assert.equal(await page.locator('.room-choice').count(),2);
  await page.selectOption('#freeSmartboard','yes');assert.equal(await page.locator('.room-choice').count(),2);
  await page.selectOption('#freeWhiteboard','yes');assert.equal(await page.locator('.room-choice').count(),1);
  assert.match(await page.locator('.room-choice').textContent(),/Salla 05/);
  await page.selectOption('#freeWhiteboard','no');assert.equal(await page.locator('.room-choice').count(),1);
  assert.match(await page.locator('.room-choice').textContent(),/Salla 127/);
  await page.fill('#freeCapacity','64');assert.equal(await page.locator('.room-choice').count(),0);
  await page.fill('#freeCapacity','');await page.selectOption('#freeSmartboard','no');
  assert.match(await page.locator('.room-choice').textContent(),/Salla 108/);
  await page.fill('#freeCapacity','-1');assert.equal(await page.locator('#freeError').isVisible(),true);
  await page.fill('#freeCapacity','2.5');assert.equal(await page.locator('#freeError').isVisible(),true);
  await page.fill('#freeCapacity','');await page.selectOption('#freeSmartboard','');await page.selectOption('#freeWhiteboard','');
  assert.equal(await page.locator('.room-choice').count(),4);
  await page.evaluate(value=>window.testReport(value),result);
  const booking = {title:'<img src=x onerror=alert(1)>',date:result.date,room:roomName,creatorName:'Test Teacher',createdAt:{seconds:1792706400},slots:[{start:'12:00',end:'12:15'},{start:'12:15',end:'12:30'}]};
  assert.equal(await page.locator('.legend-swatch').count(),5);
  for(const entry of await page.locator('.agenda-entry:not(.reservation-event)').all()){
    const tag=await entry.locator('span').textContent();
    const category=tag.includes('Zgjedhore')?'elective':tag.includes('Ushtrime')?'exercise':'lecture';
    assert.ok((await entry.getAttribute('class')).includes('category-'+category));
  }
  for(const [isPublic,category,color] of [[true,'public-reservation','rgb(254, 243, 199)'],[false,'private-reservation','rgb(226, 232, 240)']]){
    await page.evaluate(value=>window.testReport(value),{...result,rows:[{...booking,isPublic}]});
    for(const selector of ['.event.reservation-event','.agenda-entry.reservation-event']){
      const event=page.locator(selector).first();
      assert.doesNotMatch(await event.textContent(),/Test Teacher/);
      assert.doesNotMatch(await event.getAttribute('title')||'',/Test Teacher/);
      assert.ok((await event.getAttribute('class')).includes('category-'+category));
      assert.equal(await event.evaluate(el=>getComputedStyle(el).backgroundColor),color);
    }
  }

  const bilingual={...booking,title:'Takimi shqip',titleEn:'English meeting',description:'Përshkrimi shqip',descriptionEn:'English description <script>unsafe</script>'};
  await page.evaluate(value=>window.testReport(value),{...result,rows:[bilingual]});
  await page.click('#navSchedules');await page.click('#viewWeek');
  await page.locator('#weekBody .reservation-event').click();
  assert.equal(await page.locator('#modalTitle').textContent(),'Takimi shqip');
  await page.selectOption('#languagePicker','en');
  assert.equal(await page.locator('#modalTitle').textContent(),'English meeting');
  assert.match(await page.locator('#modalDetails').textContent(),/English description <script>unsafe<\/script>/);
  assert.equal(await page.locator('#modalDetails script').count(),0);
  await page.click('#closeDialog');
  assert.match(await page.locator('#weekBody .reservation-event').textContent(),/English meeting/);
  await page.click('#viewList');assert.match(await page.locator('#agendaView .reservation-event').textContent(),/English meeting/);
  await page.selectOption('#languagePicker','sq');
  assert.match(await page.locator('#agendaView .reservation-event').textContent(),/Takimi shqip/);
  await page.evaluate(value => window.testReport(value),{...result,rows:[booking]});
  assert.equal(await page.locator('.room-choice').count(),0);
  await page.click('#navSchedules');
  await page.click('#viewWeek');
  assert.equal(await page.locator('#weekBody .reservation-event').count(),1);
  assert.equal(await page.locator('#weekBody .reservation-event img').count(),0);
  await page.locator('#weekBody .reservation-event').click();
  assert.match(await page.locator('#modalDetails').textContent(),/Test Teacher/);
  assert.match(await page.locator('#modalDetails').textContent(),/12:00–12:30/);
  assert.match(await page.locator('#modalCalendar').textContent(),/E konfirmuar/);
  await page.locator('#modalCalendar summary').click();
  await page.locator('#modalCalendar a').waitFor({state:'visible'});
  const calendarUrl=new URL(await page.locator('#modalCalendar a').getAttribute('href'));
  assert.ok(new URL(calendarUrl.searchParams.get('cid')).searchParams.get('booking'));
  assert.equal(new URL(calendarUrl.searchParams.get('cid')).searchParams.has('class'),false);
  const download=page.waitForEvent('download');await page.locator('#modalCalendar button').click();assert.equal((await download).suggestedFilename(),'rezervimi.ics');
  assert.match(await page.locator('#modalDetails').textContent(),/Rezervimi u krijua/);
  await page.click('#closeDialog');
  await page.click('#viewList');
  assert.equal(await page.locator('#agendaView .reservation-event').count(),1);
  await page.locator('#agendaView .reservation-event').click();
  assert.match(await page.locator('#modalDetails').textContent(),/Test Teacher/);
  await page.click('#closeDialog');
  for (const kind of ['subgroups','teachers']) {
    await page.selectOption('#category',kind);
    const name=await page.locator('#entity').inputValue();
    const selected={...booking,title:'Konferencë online',description:'Përshkrimi i konferencës\n\nParagrafi i dytë.',eventType:'Konferencë',room:'',groups:kind==='subgroups'?[name]:[],groupNames:kind==='subgroups'?[name]:[],teachers:kind==='teachers'?[name]:[],isPublic:false,mode:'online',onlineUrl:'https://example.test/event'};
    await page.evaluate(value=>window.testReport(value),{...result,rows:[selected]});
    assert.equal(await page.locator('#agendaView .reservation-event').count(),1);
    await page.locator('#agendaView .reservation-event').click();
    assert.match(await page.locator('#modalDetails').textContent(),/Pa sallë/);
    assert.match(await page.locator('#modalDetails').textContent(),/Përshkrimi i konferencës/);
    const description=page.locator('#modalDetails dd').filter({hasText:'Përshkrimi i konferencës'});
    assert.equal(await description.textContent(),'Përshkrimi i konferencës\n\nParagrafi i dytë.');
    assert.equal(await description.evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');
    assert.equal(await page.locator('#modalDetails a').getAttribute('href'),'https://example.test/event');
    assert.equal(await page.locator('#modalDetails a').getAttribute('rel'),'noopener noreferrer');
    await page.click('#closeDialog');
    await page.click('#viewWeek');assert.equal(await page.locator('#weekBody .reservation-event').count(),1);await page.click('#viewList');
  }
  await page.selectOption('#category','rooms');
  await page.selectOption('#category','reservations');
  assert.equal(await page.locator('#selectedTitle').textContent(),'Rezervimet');
  assert.equal(await page.locator('#entity').isVisible(),false);
  assert.equal(await page.locator('#lookup').isVisible(),false);
  const roomless={...booking,title:'Ngjarje pa sallë',roomId:'',room:'',groups:[],teachers:[],isPublic:false};
  const roomlessGroup={...roomless,title:'Ngjarje me grup',groups:['Grupi 1'],teachers:['Mësimdhënësi 1']};
  await page.evaluate(value=>window.testReport(value),{...result,rows:[booking,roomless,roomlessGroup,{...roomless,title:'Javën tjetër',date:'2026-10-30'}]});
  assert.equal(await page.locator('#agendaView .reservation-event').count(),3);
  await page.locator('#agendaView .reservation-event').filter({hasText:'Ngjarje pa sallë'}).click();
  assert.match(await page.locator('#modalDetails').textContent(),/Pa sallë/);
  assert.match(await page.locator('#modalDetails').textContent(),/Test Teacher/);
  await page.click('#closeDialog');
  await page.click('#viewWeek');assert.equal(await page.locator('#weekBody .reservation-event').count(),3);
  const boxes=await page.locator('#weekBody .reservation-event').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {left:b.left,right:b.right}}));
  boxes.sort((a,b)=>a.left-b.left);
  assert.ok(boxes.every((b,i)=>i===0 || b.left>=boxes[i-1].right));
  for(const button of await page.locator('#weekBody .reservation-event').all()){await button.click();assert.equal(await page.locator('#modalDetails').isVisible(),true);await page.click('#closeDialog');}
  // An earlier standalone reservation uses the same width as the later pair.
  const alignedRows=[
    {...roomless,title:'Standalone activity',slots:[{start:'11:30',end:'12:00'}]},
    {...booking,title:'Parallel activity A'},
    {...booking,title:'Parallel activity B'}
  ];
  await page.evaluate(value=>window.testReport(value),{...result,rows:alignedRows});
  for(const viewport of [{width:1280,height:720},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    const aligned=await page.locator('#weekBody .reservation-event').evaluateAll(nodes=>nodes.map(node=>{
      const box=node.getBoundingClientRect();return {left:box.left,right:box.right,width:box.width};
    }));
    assert.equal(aligned.length,3);
    assert.ok(aligned.every(box=>Math.abs(box.width-aligned[0].width)<1));
    assert.ok(Math.abs(aligned[0].left-Math.min(aligned[1].left,aligned[2].left))<1);
    assert.ok(aligned[1].right<=aligned[2].left||aligned[2].right<=aligned[1].left);
  }
  await page.setViewportSize({width:1280,height:720});
  await page.evaluate(value=>window.testReport(value),{...result,rows:[booking,roomless,roomlessGroup]});
  const otherHash=new URL(page.url()).hash;
  assert.equal(otherHash,'#orari/reservations/te-gjitha');
  await page.selectOption('#category','rooms');
  assert.equal(await page.locator('#entity').isVisible(),true);
  await page.evaluate(hash=>{location.hash=hash},otherHash);
  await page.waitForFunction(()=>document.getElementById('category').value==='reservations');
  assert.equal(await page.locator('#weekBody .reservation-event').count(),3);
  await page.evaluate(value=>window.testReport(value),result);
  assert.equal(await page.locator('.reservation-event').count(),0);
  await page.selectOption('#category','rooms');
  await page.locator('#bookingDate').evaluate((el,date)=>{el.value=date},'2026-10-30');
  await page.locator('#bookingDate').dispatchEvent('change');
  assert.equal(await page.locator('.reservation-event').count(),0);
  await page.locator('#bookingDate').evaluate((el,date)=>{el.value=date},'2026-10-23');
  await page.click('#navFree');
  await page.evaluate(value => window.testReport(value),result);
  assert.equal(await page.locator('.room-choice').count(),1);
  assert.equal(await page.locator('.reservation-event').count(),0);
  await page.evaluate(value => window.testReport(value),{...result,day:{...result.day,bookingAllowed:false}});
  assert.equal(await page.locator('.room-choice').count(),0);
  await page.evaluate(() => window.testReport({status:'error',message:'Offline'}));
  assert.equal(await page.locator('.room-choice').count(),0);
  assert.match(await page.locator('#freeCount').textContent(),/nuk mund/);
  await page.locator('#bookingDate').evaluate((el,date)=>{el.value=date},'2026-10-24');
  await page.locator('#bookingDate').dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.testDate),'2026-10-24');
  assert.equal(await page.locator('.room-choice').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/fet-public-preview-mobile.png',fullPage:true});
  // A missing authentication SDK must not prevent anonymous timetable access.
  await page.route('https://www.gstatic.com/firebasejs/12.0.0/**',route=>route.abort());
  await page.reload();
  await page.waitForSelector('#mainContent:not([hidden])');
  assert.equal(await page.locator('a[data-staff-entry]').isVisible(),true);
  assert.equal(await page.locator('[data-my-reservations]').isVisible(),false);
  await page.locator('[data-portal-page="today"]').click();
  assert.equal(await page.locator('#todayPanel').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: staff access, sign-out, anonymous access without authentication SDK, timetable loading, weekly/list reservation blocks, details, cancellation, overlap, closed dates, offline, date change, safe titles.');
} finally { await browser.close(); }
