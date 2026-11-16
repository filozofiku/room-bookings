import {test} from 'node:test';import assert from 'node:assert/strict';
import {publicDescriptionError,wordCount,needsReapproval,SPECIAL_ROOMS} from '../src/booking-resources.js';
test('public descriptions accept 100–500 words, with whitespace separated counting',()=>{
 for(const count of [100,101,500])assert.equal(publicDescriptionError('Panel',Array(count).fill('fjalë').join(' \n\t ')),'');
 for(const text of ['', 'a'.repeat(1000),Array(99).fill('fjalë').join(' ')])assert.match(publicDescriptionError('Panel',text),/100 fjalë/);
 assert.match(publicDescriptionError('Panel',Array(501).fill('fjalë').join(' ')),/500 fjalë/);assert.equal(wordCount(' \n një\t dy \n'),2);
});
test('only room, date and period changes trigger reapproval for either special room',()=>{
 for(const roomId of SPECIAL_ROOMS){const before={roomId,date:'2026-11-16',periodIds:['p1'],groupIds:[],teacherIds:[]};
  assert(!needsReapproval(before,{...before,title:'Changed',studentEmails:['a@student.uni-pr.edu'],mode:'online',groupIds:['g'],teacherIds:['t']}));
  for(const patch of [{roomId:''},{roomId:'normal'},{date:'2026-11-17'},{periodIds:['p2']},{periodIds:['p1','p2']}])assert(needsReapproval(before,{...before,...patch}));
  assert(needsReapproval({...before,roomId:'normal'},before));
 }
});
