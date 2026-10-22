import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectPeriods,reservationTime,errorText,BookingError} from '../src/booking-ui.js';
const periods=Array.from({length:17},(_,i)=>({id:`p${String(i+1).padStart(2,'0')}`,start:`${String(8+Math.floor(i/4)).padStart(2,'0')}:${String(i%4*15).padStart(2,'0')}`,end:`${String(8+Math.floor((i+1)/4)).padStart(2,'0')}:${String((i+1)%4*15).padStart(2,'0')}`}));
test('accepts 1 to 16 periods but rejects 17, reversed and absent periods',()=>{
 for(let n=1;n<=16;n++) assert.equal(selectPeriods(periods,'p01',periods[n-1].id).length,n);
 for(const [a,b] of [['p01','p17'],['p03','p02'],['bad','p01']]) assert.throws(()=>selectPeriods(periods,a,b),/1–16/);
});
test('reservation summaries use actual boundary times',()=>{
 assert.equal(reservationTime(['p04','p02','p01','p03'],periods),'08:00–09:00');
 assert.equal(reservationTime(periods.slice(0,16).map(p=>p.id),periods),'08:00–12:00');
 assert.equal(reservationTime(['unknown'],periods),'Ora nuk është e disponueshme');
});
test('app validation is localized',()=>{
 assert.equal(errorText(new BookingError('Zgjidhni një sallë.')),'Zgjidhni një sallë.');
});
