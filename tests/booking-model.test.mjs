import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localDate, bookingRows, overlaps, dayIndex, weekDates, reservationEvents, bookingTimestamp} from '../public-schedule/booking-model.js';
const rooms = [{id:'r1',name:'Salla 1'}];
const periods = [{id:'p01',start:'08:00',end:'08:15'},{id:'p02',start:'08:15',end:'08:30'}];
test('resolves room IDs and actual period times, preserving calendar dates', () => {
  const [row] = bookingRows([{roomId:'r1',date:'2026-10-23',periodIds:['p02','p01']}],rooms,periods);
  assert.equal(row.date,'2026-10-23');
  assert.equal(row.room,'Salla 1');
  assert.equal(row.slots[0].start,'08:00');
  assert.ok(overlaps(row,'Salla 1','08:00','08:15'));
  assert.ok(!overlaps(row,'Salla 1','08:30','09:00'));
  assert.ok(!overlaps(row,'Salla 2','08:00','09:00'));
});
test('unmapped rooms and periods fail instead of falsely declaring availability', () => {
  assert.throws(() => bookingRows([{roomId:'missing',periodIds:['p01']}],rooms,periods));
  assert.throws(() => bookingRows([{roomId:'r1',periodIds:['missing']}],rooms,periods));
});
test('uses Tirane date at UTC midnight boundary and recognises Albanian weekdays', () => {
  assert.equal(localDate(new Date('2026-10-22T22:30:00Z')),'2026-10-23');
  assert.equal(dayIndex(['E hënë','E martë','E mërkurë','E enjte','E premte'],'5'),4);
  assert.equal(dayIndex(['E hënë'],'0'),-1);
});

test('reservations merge adjacent periods and stay within their calendar week and room', () => {
 const dates=weekDates('2026-10-22');
 assert.deepEqual([dates[0],dates[6]],['2026-10-19','2026-10-25']);
 const row={date:'2026-10-22',room:'Salla 1',title:'Meeting',creatorName:'Teacher',slots:periods};
 const events=reservationEvents([row],'Salla 1',dates,['Monday','Tuesday','Wednesday','Thursday','Friday'],['08:00','08:15','08:30']);
 assert.equal(events.length,1);
 assert.equal(events[0].s,0);
 assert.equal(events[0].e,2);
 assert.equal(events[0].d,3);
 assert.equal(events[0].creatorName,'Teacher');
 assert.equal(reservationEvents([row],'Salla 1',weekDates('2026-10-26'),[],[]).length,0);
 assert.equal(reservationEvents([row],'Salla 2',dates,[],[]).length,0);
 assert.match(bookingTimestamp(null),/disponueshme/);
});

test('roomless reservations and non-public details appear for every selected group and teacher',()=>{
 const catalog={groups:{g1:'Grupi 1',g2:'Grupi 2'},groupNames:{g1:'Grupi 1 Automatic Subgroup',g2:'Grupi 2 Automatic Subgroup'},teachers:{t1:'Mësimdhënësi 1',t2:'Mësimdhënësi 2'}};
 const rows=bookingRows([{title:'Konferencë',roomId:'',date:'2026-10-23',periodIds:['p01','p02'],groupIds:['g1','g2'],teacherIds:['t1','t2'],isPublic:false,eventType:'Konferencë',mode:'online',onlineUrl:'https://example.test'}],rooms,periods,catalog);
 for(const [kind,name] of [['subgroups','Grupi 1'],['subgroups','Grupi 2 Automatic Subgroup'],['teachers','Mësimdhënësi 1'],['teachers','Mësimdhënësi 2']]){
  const events=reservationEvents(rows,name,weekDates('2026-10-23'),['E premte'],['08:00','08:15','08:30'],kind);
  assert.equal(events.length,1);assert.equal(events[0].a,'Konferencë');assert.equal(events[0].r,'Pa sallë');assert.equal(events[0].onlineUrl,'https://example.test');
 }
 assert.equal(reservationEvents(rows,'Salla 1',weekDates('2026-10-23'),[],[]).length,0);
});

test('all reservations include rooms and roomless events without changing resource views',()=>{
 const rows=[{title:'Room',roomId:'r1',room:'Salla 1',groups:['G'],teachers:['T'],date:'2026-10-23',slots:periods},{title:'Roomless',roomId:'',room:'',date:'2026-10-23',slots:periods}];
 const args=[weekDates('2026-10-23'),['E premte'],['08:00','08:15','08:30']];
 assert.equal(reservationEvents(rows,'',...args,'reservations').length,2);
 for(const [kind,name] of [['rooms','Salla 1'],['subgroups','G'],['teachers','T']])assert.equal(reservationEvents(rows,name,...args,kind).length,1);
});
test('overlap lanes handle nested events, adjacent boundaries and separate clusters',async()=>{
 const {eventLanes}=await import('../public-schedule/booking-model.js');
 const events=[{s:0,e:8},{s:1,e:3},{s:3,e:5},{s:4,e:6},{s:8,e:9}];
 const lanes=eventLanes(events);
 assert.equal(lanes.get(events[0]).count,3);
 assert.equal(lanes.get(events[1]).lane,lanes.get(events[2]).lane);
 assert.equal(lanes.get(events[4]).count,1);
 for(const a of events)for(const b of events)if(a!==b && a.s<b.e && b.s<a.e)assert.notEqual(lanes.get(a).lane,lanes.get(b).lane);
});
