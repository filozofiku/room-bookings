import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventCategory,reservationEvents} from '../public-schedule/booking-model.js';
test('timetable tags determine colors, with elective precedence over activity type',()=>{
 for(const [a,category] of [['Ligjërata','lecture'],['Ushtrime','exercise'],['Ligjërata, Zgjedhore','elective'],['Ushtrime, Zgjedhore','elective']])assert.equal(eventCategory({a,t:'Same subject'}),category);
});
test('public flag survives conversion and overrides reservation activity type',()=>{
 for(const isPublic of [true,false,undefined]){
  const [event]=reservationEvents([{title:'Test',room:'Salla 014',date:'2026-10-29',slots:[{start:'08:00',end:'08:15'}],eventType:'Ligjëratë e ftuar',isPublic}],'Salla 014',['2026-10-29'],['E enjte'],['08:00','08:15']);
  assert.equal(eventCategory(event),isPublic===true?'public-reservation':'private-reservation');
 }
});
