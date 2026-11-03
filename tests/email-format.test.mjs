import {test} from 'node:test';import assert from 'node:assert/strict';
import {emailHtml} from '../mailer/email-format.js';
import {publicEventEmail} from '../mailer/public-event-email.js';
test('email HTML preserves paragraphs, flows sentences and escapes untrusted text',()=>{
 const sentence='Një fjali e gjatë me tekst që duhet të rrjedhë sipas gjerësisë së ekranit. '.repeat(10);
 const html=emailHtml(sentence+'\n\nParagrafi i dytë\nRreshti tjetër\n\n<img src=x onerror=alert(1)>\nhttps://example.test/?a=1&b=2');
 assert(html.includes(sentence));assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('Paragrafi i dytë<br>Rreshti tjetër'));assert(html.includes('href="https://example.test/?a=1&amp;b=2"'));assert.equal((html.match(/<p /g)||[]).length,3);
});
test('assigned public-event resources are included without reservation creator',()=>{
 const mail=publicEventEmail({title:'Panel',date:'2026-11-03',periodIds:['p1'],roomId:'r1',groupIds:['g1'],teacherIds:['t1'],creatorName:'PRIVATE CREATOR',mode:'physical'},[{id:'p1',start:'10:00',end:'11:00'}],[{id:'r1',name:'Salla 014'}],{groups:{g1:'Grupi 1'},teachers:{t1:'Profesor 1'}});
 for(const text of ['Salla: Salla 014','Grupet e studentëve: Grupi 1','Mësimdhënësit: Profesor 1'])assert(mail.text.includes(text));assert(!mail.text.includes('PRIVATE CREATOR'));
});
