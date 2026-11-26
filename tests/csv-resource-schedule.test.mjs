import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsvResourceSchedule,reconcileReservations} from '../scripts/csv-resource-schedule.mjs';
import {resourceId} from '../scripts/resource-schedule.mjs';

const hierarchy='<Students_List><Year><Name>Year</Name><Group><Name>A</Name></Group><Group><Name>B</Name></Group></Year><Year><Name>Other</Name></Year></Students_List>';
const catalog={rooms:{},groups:{},teachers:{},groupNames:{}};
const csv=rows=>'Activity Id,Day,Hour,Students Sets,Subject,Teachers,Room\n'+rows;
const periods=[{id:'p01',start:'08:00'},{id:'p02',start:'08:15'}];
test('whole years expand to all atomic subgroups and combined sets/teachers expand separately',()=>{
  const s=parseCsvResourceSchedule(csv('1,Monday,08:00,Year+Other,Class,T1+T2,Room'),hierarchy,periods,catalog);
  const keys=s.weekly[1].busyKeys;
  for (const [prefix,name] of [['g','A Automatic Subgroup'],['g','B Automatic Subgroup'],['g','Other Automatic Group Automatic Subgroup'],['t','T1'],['t','T2'],['r','Room']]) assert.ok(keys.includes(`${resourceId(prefix,name)}__p01`));
  assert.equal(keys.length,6);
  assert.deepEqual(s.weeklyRooms.values().next().value.activities.p01.groupIds,[resourceId('g','A Automatic Subgroup'),resourceId('g','B Automatic Subgroup'),resourceId('g','Other Automatic Group Automatic Subgroup')]);
  assert.deepEqual(catalog,{rooms:{},groups:{},teachers:{},groupNames:{}});
});
test('a group class does not occupy its sibling, and roomless classes still lock teachers/students',()=>{
  const s=parseCsvResourceSchedule(csv('1,E hënë,08:00,A,Class,T1,'),hierarchy,periods,catalog);
  assert.equal(s.weekly[1].busyKeys.length,2);
  assert.equal(s.weeklyRooms.size,0);
  assert.ok(!s.weekly[1].busyKeys.includes(`${resourceId('g','B Automatic Subgroup')}__p01`));
});
test('invalid groups, missing hierarchy members, periods, and official overlaps abort parsing',()=>{
  assert.throws(()=>parseCsvResourceSchedule(csv('1,Monday,08:00,Unknown,C,T,R'),hierarchy,periods,catalog),/Unknown/);
  assert.throws(()=>parseCsvResourceSchedule(csv('1,Monday,09:00,A,C,T,R'),hierarchy,periods,catalog),/Invalid/);
  assert.throws(()=>parseCsvResourceSchedule(csv('1,Monday,08:00,A,C,T,R\n2,Monday,08:00,B,C,T,R'),hierarchy,periods,catalog),/Overlapping/);
  assert.throws(()=>parseCsvResourceSchedule(csv('1,Monday,08:00,A,C,T,R'),hierarchy,periods,{...catalog,groupNames:{old:'Missing'}}),/absent/);
});
const booking={title:'Keep this',date:'2026-11-16',periodIds:['p01','p02'],roomId:'r1',groupIds:['g1','g2'],teacherIds:['t1','t2'],revision:3,description:'Keep description',ownerUid:'owner'};
const calendar=new Map([[booking.date,{weekday:'1',fetActive:true}]]);
const weekly=Array.from({length:7},()=>({busyKeys:[]}));
weekly[1]={busyKeys:['r1__p02','g1__p01','t1__p02']};
test('removes only conflicting assignments and rebuilds locks, preserving reservation metadata',()=>{
  const {updates,days}=reconcileReservations([{id:'event',data:booking}],calendar,weekly);
  assert.deepEqual(updates[0].after,{...booking,roomId:'',groupIds:['g2'],teacherIds:['t2'],revision:4});
  assert.deepEqual(days.get(booking.date).bookings,{'g2__p01':'event','g2__p02':'event','t2__p01':'event','t2__p02':'event'});
  assert.equal(booking.roomId,'r1');
});
test('holidays preserve assignments; unchanged imports do not increment revisions',()=>{
  const result=reconcileReservations([{id:'event',data:booking}],new Map([[booking.date,{weekday:'1',fetActive:false}]]),weekly);
  assert.equal(result.updates.length,0);
  assert.equal(Object.keys(result.days.get(booking.date).bookings).length,10);
});
test('reservations remain present when every resource conflicts',()=>{
  const w=structuredClone(weekly);w[1].busyKeys.push('g2__p01','t2__p01');
  const result=reconcileReservations([{id:'event',data:booking}],calendar,w);
  assert.deepEqual(result.updates[0].after,{...booking,roomId:'',groupIds:[],teacherIds:[],revision:4});
  assert.equal(result.days.size,0);
});
test('missing dates and overlapping reservations abort reconciliation',()=>{
  assert.throws(()=>reconcileReservations([{id:'event',data:booking}],new Map(),weekly),/Missing calendar/);
  assert.throws(()=>reconcileReservations([{id:'a',data:booking},{id:'b',data:booking}],calendar,weekly),/Reservations overlap/);
});
