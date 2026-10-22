import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localDate, bookingRows, overlaps, dayIndex} from '../public-schedule/booking-model.js';
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
