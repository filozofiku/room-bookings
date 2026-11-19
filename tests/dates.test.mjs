import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDate,formatDate,formatDateTime,formatTimetableStamp,localDate} from '../public-schedule/dates.js';
test('written dates preserve the selected calendar day in either language',()=>{
 assert.equal(formatDate('2026-12-10'),'E enjte · 10 dhjetor 2026');
 assert.equal(formatDate('2026-12-10','en'),'Thursday · 10 December 2026');
 assert.equal(formatDate('2028-02-29'),'E martë · 29 shkurt 2028');
 assert.equal(parseDate('2026-02-29'),null);assert.equal(parseDate('2026-13-01'),null);
 assert.equal(formatDate(null),'—');
 assert.equal(localDate(new Date('2026-10-22T22:30:00Z')),'2026-10-23');
});
test('timestamps and FET export footers use full written dates and Tirane time',()=>{
 const date=new Date('2026-12-10T10:00:00Z');
 assert.equal(formatDateTime(date),'E enjte · 10 dhjetor 2026 · 11:00');
 assert.equal(formatDateTime({seconds:date.getTime()/1000},'en'),'Thursday · 10 December 2026 · 11:00');
 assert.equal(formatDateTime(null),'—');
 assert.equal(formatTimetableStamp('11/18/26 8:40\u202fPM'),'E mërkurë · 18 nëntor 2026 · 20:40');
 assert.equal(formatTimetableStamp('2026-12-10 08:30','en'),'Thursday · 10 December 2026 · 08:30');
});

test('all seven weekday names match the calendar date, including weekend dates',()=>{
 const sq=['E hënë','E martë','E mërkurë','E enjte','E premte','E shtunë','E diel'];
 const en=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 for(let i=0;i<7;i++){
  const date=`2026-11-${16+i}`;
  assert.equal(formatDate(date),`${sq[i]} · ${16+i} nëntor 2026`);
  assert.equal(formatDate(date,'en'),`${en[i]} · ${16+i} November 2026`);
 }
 assert.equal(formatDateTime(new Date('2026-12-24T23:30:00Z')),'E premte · 25 dhjetor 2026 · 00:30');
});
