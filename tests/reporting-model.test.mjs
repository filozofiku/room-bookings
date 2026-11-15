import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityHistory,summarizeReport,reportDate,reportCsv,validReportDate,median} from '../src/reporting-model.js';

const at=date=>new Date(date);
const range={start:'2026-11-01',end:'2026-11-30'};
const booking={ownerUid:'staff-a',title:'Panel',date:'2026-12-20',createdAt:at('2026-11-02T10:00:00Z')};
test('report dates use local midnight, and invalid date inputs are rejected',()=>{
  assert.equal(reportDate(at('2026-11-01T23:30:00Z')),'2026-11-02');
  for(const value of ['2026-02-30','invalid','2026-99-99','2026-2-3'])assert.equal(validReportDate(value),false);
  assert.throws(()=>summarizeReport({}, {start:'2026-11-30',end:'2026-11-01'}),/invalid-report-range/);
  assert.equal(median([]),null);assert.equal(median([5,1,2,4]),3);
});
test('staff adoption counts distinct creators and requesters, not reviewers; scheduled dates do not shift actions',()=>{
  const data={reservations:[{id:'a',...booking},{id:'b',...booking}],reservationRequests:[{id:'r',...booking,ownerUid:'staff-b'}],
    requestDecisions:[{id:'q',booking:{...booking,ownerUid:'staff-c',createdAt:at('2026-10-01')},outcome:'approved',decidedBy:'reviewer',createdAt:at('2026-11-03')}]
  };
  const r=summarizeReport(data,range);assert.equal(r.staff,3);assert.equal(r.reservations.direct,2);assert.equal(r.reservations.approved,1);assert.equal(r.requests.submitted,1);
  assert.equal(r.requests.approved,1);assert.equal(r.requests.pending,1);
  assert.equal(summarizeReport(data,{start:'2026-12-01',end:'2026-12-31'}).reservations.direct,0);
});
test('immutable events and legacy sources deduplicate by business operation after edits and deletion',()=>{
  const data={activityEvents:[{id:'x__created',kind:'created',entityId:'x',ownerUid:'staff-a',method:'direct',source:'app',occurredAt:booking.createdAt}],
    modificationNotifications:[{id:'x__1',reservationId:'x',before:booking,booking:{...booking,revision:1},createdAt:at('2026-11-03')}],
    cancellationNotifications:[{id:'x',booking:{...booking,revision:1},createdAt:at('2026-11-04')}],
    studentChangeNotifications:[{id:'x__cancel',reservationId:'x',booking:{...booking,revision:1},eventAction:'cancelled',createdAt:at('2026-11-04')}]
  };
  const r=summarizeReport(data,range);assert.equal(r.reservations.direct,1);assert.equal(r.reservations.edited,1);assert.equal(r.reservations.cancelled,1);assert.equal(r.historicalEvents,2);
  assert.equal(activityHistory(data).filter(e=>e.kind==='created')[0].source,'app');
});
test('request lifetime survives deletion and median uses submission-to-decision timestamps',()=>{
  const data={requestNotifications:[{id:'a',booking:{...booking,createdAt:at('2026-11-01T10:00Z')}}],requestDecisions:[
    {id:'a',booking:{...booking,createdAt:at('2026-11-01T10:00Z')},outcome:'approved',createdAt:at('2026-11-01T11:00Z')},
    {id:'b',booking:{...booking,createdAt:at('2026-11-01T10:00Z')},outcome:'rejected',createdAt:at('2026-11-01T13:00Z')},
    {id:'c',booking:{...booking,createdAt:at('2026-10-01')},outcome:'rejected',createdAt:at('2026-12-01')}
  ]};
  const r=summarizeReport(data,range);assert.equal(r.requests.submitted,2);assert.equal(r.requests.approved,1);assert.equal(r.requests.declined,1);assert.equal(r.responseMedianMs,2*3600000);assert.equal(r.responseCount,2);assert.equal(r.requests.pending,1);
});
test('pending requests are reported as of the selected end date, including earlier submissions',()=>{
  const data={requestDecisions:[{id:'r',booking:{...booking,createdAt:at('2026-10-01')},outcome:'approved',createdAt:at('2026-11-02')} ]};
  assert.equal(summarizeReport(data,{start:'2026-10-20',end:'2026-11-01'}).requests.pending,1);
  assert.equal(summarizeReport(data,range).requests.pending,0);
});
test('message reach counts each notification/recipient once, by send date, across changes and retries',()=>{
  const first='a@student.uni-pr.edu',second='b@student.uni-pr.edu';
  const data={studentNotifications:[{id:'n',createdAt:at('2026-10-31'),recipients:[first,second],sentRecipients:[first,first.toUpperCase(),second],status:'sent',sentAt:at('2026-12-01'),recipientSentAt:{[first]:at('2026-11-01'),[second]:at('2026-11-02')}}],
    studentChangeNotifications:[{id:'change',createdAt:at('2026-11-02'),eventAction:'modified',recipients:[first],sentRecipients:[first],recipientSentAt:{[first]:at('2026-11-02')},status:'sent'}]};
  const r=summarizeReport(data,range);assert.equal(r.notifications.initial,0);assert.equal(r.notifications.change,1);assert.equal(r.notifications.messages,3);assert.equal(r.notifications.recipients,2);assert.equal(r.notifications.approximateMessages,0);
});
test('legacy completed batches have approximate send dates; undated partial sends are disclosed and not assigned a false date',()=>{
  const recipient='a@student.uni-pr.edu';
  const data={studentNotifications:[{id:'a',createdAt:at('2026-11-01'),recipients:[recipient],sentRecipients:[recipient],status:'sent',sentAt:at('2026-11-03')},
    {id:'b',createdAt:at('2026-11-01'),recipients:[recipient,'b@student.uni-pr.edu'],sentRecipients:[recipient],status:'failed'}]};
  const r=summarizeReport(data,range);assert.equal(r.notifications.messages,1);assert.equal(r.notifications.approximateMessages,1);assert.equal(r.notifications.undatedMessages,1);assert.equal(r.problems.failed,1);assert.equal(r.problems.partial,1);
});
test('notification states include all queues and recorded edits are not email failures',()=>{
  const data={studentNotifications:[{id:'a',createdAt:at('2026-11-01'),status:'awaiting-approval'}],requestNotifications:[{id:'r',createdAt:at('2026-11-01'),status:'retrying'}],modificationNotifications:[{id:'m',createdAt:at('2026-11-01'),status:'recorded'}],publicEventDeliveries:[{id:'p',createdAt:at('2026-11-01'),status:'failed'}]};
  assert.deepEqual(summarizeReport(data,range).problems,{pending:1,failed:1,partial:0,awaitingApproval:1});
});
test('missing traffic is unavailable, explicit zero days remain zero, partial days and top paths aggregate',()=>{
  assert.equal(summarizeReport({},range).traffic,null);
  const data={trafficDaily:[{id:'2026-11-01',visits:0,pageViews:0,paths:[],complete:true},{id:'2026-11-02',visits:3,pageViews:6,paths:[{path:'/',pageViews:4},{path:'/room-bookings/',pageViews:2}],complete:false},{id:'2026-11-03',visits:2,pageViews:5,paths:[{path:'/',pageViews:5}],complete:true}]};
  const r=summarizeReport(data,range);assert.equal(r.traffic.visits,5);assert.equal(r.traffic.pageViews,11);assert.equal(r.traffic.partialDays,1);assert.equal(r.traffic.paths[0].pageViews,9);assert.equal(r.traffic.visitors,null);
});
test('trusted import adjustments remain separate from human edits',()=>{
  const data={timetableImports:[{id:'import',appliedAt:at('2026-11-14'),conflicts:[{id:'r',date:'2026-11-12',title:'Adjusted'}]}]};
  const r=summarizeReport(data,range);assert.equal(r.reservations.adjusted,1);assert.equal(r.reservations.edited,0);
});
test('CSV exports have coverage, timestamps and UTF-8 BOM, and never include recipient addresses or UIDs',()=>{
  const data={studentNotifications:[{id:'n',createdAt:at('2026-11-01'),recipients:['private@student.uni-pr.edu'],sentRecipients:['private@student.uni-pr.edu'],sentAt:at('2026-11-02')}]};
  const csv=reportCsv(summarizeReport(data,range));assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/Days covered/);assert.match(csv,/Generated at/);assert.doesNotMatch(csv,/@student|ownerUid/);
});
