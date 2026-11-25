import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timetableCourses,coursesForGroups,validReplacementDate,requiresPrivateVisibility} from '../src/replacement-courses.js';

test('courses are deduplicated across the timetable and filtered by group membership',()=>{
  const catalog={groups:{g1:'Group 1',g2:'Group 2',g3:'Group 10'},groupNames:{g1:'Group 1 Automatic Subgroup'}};
  const courses=timetableCourses([
    {id:'1__room',activities:{p01:{subject:'Course A',studentSets:'Group 1'},p02:{subject:'Course B',studentSets:'Group 2'}}},
    {id:'2__room',activities:{p03:{subject:'Course A',groupIds:['g2']},p04:{subject:' '}}}
  ],catalog);
  assert.equal(courses.length,2);
  assert.deepEqual(coursesForGroups(courses,['g1']).map(c=>c.title),['Course A']);
  assert.deepEqual(coursesForGroups(courses,['g2']).map(c=>c.title),['Course A','Course B']);
  assert.deepEqual(coursesForGroups(courses,['g3']),[]);
  assert.equal(coursesForGroups(courses,[]).length,2);
  assert.deepEqual(courses[0].source,{weeklyRoomId:'1__room',periodId:'p01'});
});

test('legacy faculty year names include their BA/MA subgroups without including sibling years',()=>{
  const courses=timetableCourses([{id:'1__room',activities:{p01:{subject:'Year course',studentSets:'Psikologji-2BA'}}}],{groups:{a:'Psikologji-2.1BA',b:'Psikologji-2.2BA',c:'Psikologji-1.1BA',d:'Psikologji-2.1MA'}});
  assert.equal(coursesForGroups(courses,['a']).length,1);
  assert.equal(coursesForGroups(courses,['b']).length,1);
  assert.equal(coursesForGroups(courses,['c']).length,0);
  assert.equal(coursesForGroups(courses,['d']).length,0);
});

test('explicit FET hierarchy membership takes priority over names',()=>{
  const courses=timetableCourses([{id:'1__r',activities:{p01:{subject:'Whole year course',studentSets:'Year',groupIds:['a','b']}}}],{groups:{a:'A',b:'B',c:'Year'}});
  assert.equal(coursesForGroups(courses,['a']).length,1);
  assert.equal(coursesForGroups(courses,['b']).length,1);
  assert.equal(coursesForGroups(courses,['c']).length,0);
});

test('missed-class dates must be real dates, including leap-day handling',()=>{
  for(const value of ['','2026-02-29','2026-02-30','2026-13-01','2026-1-01','tomorrow'])assert.equal(validReplacementDate(value),false,value);
  for(const value of ['2024-02-29','2026-01-01','2026-12-31'])assert.equal(validReplacementDate(value),true,value);
});

test('replacement classes and colloquia require private visibility',()=>{
  assert.equal(requiresPrivateVisibility('Zëvendësim i mësimit'),true);
  assert.equal(requiresPrivateVisibility('Kolokium'),true);
  assert.equal(requiresPrivateVisibility('Panel'),false);
});
