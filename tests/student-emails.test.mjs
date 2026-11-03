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
