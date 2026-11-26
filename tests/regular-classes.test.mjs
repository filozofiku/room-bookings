import {test} from 'node:test';import assert from 'node:assert/strict';
import {teacherIdsForEmail} from '../scripts/teacher-identity.mjs';
import {classCancellation,markClassCancellation} from '../public-schedule/regular-classes.js';
import {parseCsvResourceSchedule,reconcileReservations} from '../scripts/csv-resource-schedule.mjs';
import {conflictMessage} from '../src/booking-resources.js';
test('teacher links use unique institutional email names, including accents',()=>{
 const teachers={t:'Jon Konjufca',a:'Aliriza Arënliu'};
 assert.deepEqual(teacherIdsForEmail('jon.konjufca@uni-pr.edu',teachers),['t']);assert.deepEqual(teacherIdsForEmail('aliriza.arenliu@uni-pr.edu',teachers),['a']);
 assert.deepEqual(teacherIdsForEmail('jon.konjufca@example.com',teachers),[]);assert.deepEqual(teacherIdsForEmail('jon.konjufca@uni-pr.edu',{...teachers,other:'Jon Konjufca'}),[]);
});
test('all three resources become bookable only for released periods',()=>{
 const booking={roomId:'r',groupIds:['g'],teacherIds:['t'],periodIds:['p1']};const keys=['r__p1','g__p1','t__p1'];
 assert.equal(conflictMessage(booking,{},keys,keys),'');assert.match(conflictMessage(booking,{'r__p1':'booked'},keys,keys),/Salla/);assert.match(conflictMessage(booking,{},keys,keys.slice(1)),/Salla/);
});
test('the public cancellation marker matches the occurrence and every teacher/group/room view',()=>{
 const info={subject:'Course',start:'09:00',end:'09:30',room:'Room',teachers:['Teacher'],groups:['Group Automatic Subgroup']};
 const day={cancelledClasses:{'class-1':{by:'t',class:info}}};const event={t:'Course',r:'Room',p:'Teacher',s:0,e:2};const times=['09:00','09:15','09:30'];
 for(const [kind,entity] of [['teachers','Teacher'],['subgroups','Group Automatic Subgroup'],['rooms','Room']])assert.equal(markClassCancellation(event,day,times,kind,entity).cancelled,true);
 assert.equal(classCancellation({...event,booking:true},day,times),null);assert.equal(classCancellation({...event,p:'Other'},day,times),null);assert.equal(classCancellation(event,{},times),null);assert.equal(classCancellation({...event,e:1},day,times),null);
});
test('the authoritative class catalog includes roomless teaching and exact FET group membership',()=>{
 const csv='Activity Id,Day,Hour,Students Sets,Subject,Teachers,Activity Tags,Room\n1,Monday,09:00,Year,Course,Teacher,Ligjërata,\n1,Monday,09:15,Year,Course,Teacher,Ligjërata,';
 const fet='<fet><Students_List><Year><Name>Year</Name><Group><Name>A</Name></Group><Group><Name>B</Name></Group></Year></Students_List></fet>';
 const periods=[{id:'p1',start:'09:00',end:'09:15'},{id:'p2',start:'09:15',end:'09:30'}];
 const p=parseCsvResourceSchedule(csv,fet,periods,{rooms:{},teachers:{},groups:{},groupNames:{}});const lesson=p.regularClasses.get('class-1');
 assert.equal(lesson.roomId,'');assert.equal(lesson.groupIds.length,2);assert.equal(lesson.keys.length,6);assert.equal(lesson.publicInfo.end,'09:30');
 const booking={date:'2026-11-30',roomId:'',groupIds:lesson.groupIds,teacherIds:lesson.teacherIds,periodIds:['p1']};
 const result=reconcileReservations([{id:'b',data:booking}],new Map([[booking.date,{weekday:'1',fetActive:true,releasedKeys:lesson.keys}]]),p.weekly);
 assert.equal(result.updates.length,0);
});
