import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarInstant,calendarFile} from '../src/calendar-export.js';
test('Albanian time uses winter and summer UTC offsets',()=>{
 assert.equal(calendarInstant('2026-11-01','13:00'),'20261101T120000Z');
 assert.equal(calendarInstant('2026-07-01','13:00'),'20260701T110000Z');
});
test('ICS escapes text, folds Unicode safely, and includes online details',()=>{
 const s=calendarFile({id:'one',date:'2026-11-01',start:'13:00',end:'14:00',title:'Titull, një; test',description:'Paragrafi 1\nParagrafi 2 '+ 'ë'.repeat(100),onlineUrl:'https://example.org'});
 assert(s.includes('SUMMARY:Titull\\, një\\; test'));
 for(const line of s.split('\r\n'))assert(Buffer.byteLength(line)<=75);
 assert(s.includes('DTEND:20261101T130000Z'));
 assert(s.replaceAll('\r\n ','').includes('https://example.org'));
 assert(s.includes('Paragrafi 1\\nParagrafi 2'));
});
