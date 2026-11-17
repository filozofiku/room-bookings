import {test} from 'node:test';import assert from 'node:assert/strict';
import {requestBudget,quotaDay,BUDGET_KEY} from '../mailer/read-budget.js';
function fixture(options={}){const saved=new Map(),properties={getProperty:k=>saved.get(k),setProperty:(k,v)=>saved.set(k,v)};let calls=0;const budget=requestBudget(async()=>{calls++;return {ok:true,json:()=>[]};},properties,{now:()=>Date.parse('2026-11-17T09:00Z'),...options});return {budget,saved,calls:()=>calls};}
const url='https://firestore.googleapis.com/v1/projects/demo/databases/(default)/documents:runQuery',query=limit=>({body:JSON.stringify({structuredQuery:{limit}})});
test('empty queries count as one read and unbounded queries never reach Firestore',async()=>{const f=fixture();await f.budget.request(url,query(25));assert.equal(f.budget.snapshot().reads,1);await assert.rejects(f.budget.request(url,query(undefined)),e=>e.code==='worker-budget');assert.equal(f.calls(),1);});
test('read budget is reserved before network access and persists across invocations',async()=>{const f=fixture({readLimit:25});await f.budget.request(url,query(25));await assert.rejects(f.budget.request(url,query(25)),e=>e.code==='worker-budget');assert.equal(f.calls(),1);const next=requestBudget(()=>{throw Error('must not reach network');},{getProperty:k=>f.saved.get(k),setProperty:(k,v)=>f.saved.set(k,v)},{now:()=>Date.parse('2026-11-17T09:00Z'),readLimit:25});await assert.rejects(next.request(url,query(25)),e=>e.code==='worker-budget');});
test('failed requests retain a conservative reservation and writes have their own limit',async()=>{const f=fixture({writeLimit:1});await f.budget.request(url.replace(':runQuery',':commit'),{body:JSON.stringify({writes:[{}]})});assert.equal(f.budget.snapshot().writes,1);await assert.rejects(f.budget.request(url.replace(':runQuery',':commit'),{body:JSON.stringify({writes:[{}]})}),e=>e.code==='worker-budget');});
test('the database day follows midnight Pacific including daylight saving changes',()=>{assert.equal(quotaDay(Date.parse('2026-11-17T07:59Z')),'2026-11-16');assert.equal(quotaDay(Date.parse('2026-11-17T08:00Z')),'2026-11-17');assert.equal(quotaDay(Date.parse('2026-07-17T06:59Z')),'2026-07-16');assert.equal(quotaDay(Date.parse('2026-07-17T07:00Z')),'2026-07-17');});
test('a new quota day resets the worker allowance',()=>{const f=fixture();f.saved.set(BUDGET_KEY,JSON.stringify({day:'2026-11-16',reads:6000,writes:1500}));assert.equal(f.budget.snapshot().reads,0);f.budget.ensure(500,20);});

test('a request spanning midnight cannot refund yesterday\'s reservation into today\'s allowance',async()=>{
 let now=Date.parse('2026-11-17T07:59:59Z');const saved=new Map();
 const budget=requestBudget(async()=>{now=Date.parse('2026-11-17T08:00:01Z');return {ok:true,json:()=>[]};},{getProperty:k=>saved.get(k),setProperty:(k,v)=>saved.set(k,v)},{now:()=>now});
 await budget.request(url,query(500));assert.equal(budget.snapshot().day,'2026-11-17');assert.equal(budget.snapshot().reads,0);
});
