import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStudentEmails} from '../src/student-emails.js';
import {deliverCancellation} from '../mailer/cancellation-email.js';
test('optional student list accepts supported separators and deduplicates',()=>{
 assert.deepEqual(parseStudentEmails('  '),[]);
 assert.deepEqual(parseStudentEmails('ANA@student.uni-pr.edu:ben@student.uni-pr.edu;ana@student.uni-pr.edu, c@student.uni-pr.edu\nd@student.uni-pr.edu'),['ana@student.uni-pr.edu','ben@student.uni-pr.edu','c@student.uni-pr.edu','d@student.uni-pr.edu']);
 for(const value of ['a@uni-pr.edu','a@student.uni-pr.edu.evil','a@@student.uni-pr.edu','a..b@student.uni-pr.edu','.a@student.uni-pr.edu','a@student.uni-pr.edu,b@elsewhere.edu'])assert.throws(()=>parseStudentEmails(value));
 assert.equal(parseStudentEmails(Array.from({length:100},(_,i)=>`s${i}@student.uni-pr.edu`).join(':')).length,100);
 assert.throws(()=>parseStudentEmails(Array(101).fill('a@student.uni-pr.edu').join(';')));
});
test('student delivery sends separately, checkpoints progress and resumes after worker budget',async()=>{
 let data={kind:'students',status:'pending',recipients:['a@student.uni-pr.edu','b@student.uni-pr.edu'],booking:{title:'Panel',date:'2026-11-05',periodIds:['p1'],roomId:'room',creatorName:'Teacher',onlineUrl:'https://example.org'}};
 const sent=[],ref={id:'booking'},db={runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>data}),update:(_,patch)=>{data={...data,...patch};}}),collection:()=>({get:async()=>({docs:[{id:'p1',data:()=>({start:'09:00',end:'10:00'})}]})}),doc:()=>({get:async()=>({data:()=>({name:'014'})})})};
 let budget=1;
 const deps={db,now:()=>1000,timestamp:n=>({toMillis:()=>n}),token:'lease',send:async mail=>{if(!budget--)throw Object.assign(Error('budget'),{code:'worker-budget'});sent.push(mail);}};
 await assert.rejects(deliverCancellation(ref,deps));
 assert.deepEqual(data.sentRecipients,['a@student.uni-pr.edu']);assert.equal(data.status,'retrying');assert.equal(data.attempts,0);
 budget=1;await deliverCancellation(ref,deps);await deliverCancellation(ref,deps);
 assert.equal(data.status,'sent');assert.equal(sent.length,2);
 assert.equal(sent[1].to,'b@student.uni-pr.edu');assert.ok(sent[1].text.includes('09:00–10:00'));assert.ok(sent[1].text.includes('014'));assert.ok(!sent[0].text.includes('b@student'));
});
test('student changes and cancellations notify recipients once and suppress obsolete notices',async()=>{
 const before={title:'Old title',date:'2026-11-05',periodIds:['p1'],roomId:'',groupIds:[],teacherIds:[],creatorName:'Private owner'};
 for(const action of ['modified','cancelled']){
  let data={kind:'students',eventAction:action,reservationId:'event',status:'pending',recipients:['a@student.uni-pr.edu','b@student.uni-pr.edu'],before,booking:{...before,title:'New title',revision:1},reason:'Orari ndryshoi'};
  const sent=[],db={runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>data}),update:(_,p)=>data={...data,...p}}),collection:name=>({get:async()=>({docs:name==='periods'?[{id:'p1',data:()=>({start:'09:00',end:'10:00'})}]:[]})}),doc:path=>({get:async()=>({data:()=>path==='publicBookings/event'?(action==='modified'?data.booking:undefined):{}})})};
  const deps={db,now:()=>1000,timestamp:n=>({toMillis:()=>n}),token:'lease',send:async m=>sent.push(m)};
  await deliverCancellation({id:action},deps);await deliverCancellation({id:action},deps);
  assert.equal(sent.length,2);assert(sent.every(m=>m.subject.includes(action==='modified'?'ndryshimin':'anulimin')));assert(sent.every(m=>!m.text.includes('Private owner')));
  if(action==='modified')assert(sent[0].text.includes('Old title')&&sent[0].text.includes('New title'));
 }
 for(const current of [undefined,{revision:2}]){
  let data={kind:'students',status:'pending',recipients:['a@student.uni-pr.edu'],booking:before};let count=0;
  const db={runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>data}),update:(_,p)=>data={...data,...p}}),collection:()=>({get:async()=>({docs:[{id:'p1',data:()=>({start:'09:00',end:'10:00'})}]})}),doc:()=>({get:async()=>({data:()=>current})})};
  await deliverCancellation({id:'event'},{db,now:()=>1,timestamp:n=>({toMillis:()=>n}),token:'t',send:async()=>count++});assert.equal(count,0);assert.equal(data.status,'skipped');
 }
});
