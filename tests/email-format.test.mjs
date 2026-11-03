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
test('Albanian email dates use day, month name and year in every month',async()=>{
 const {emailDate}=await import('../mailer/email-format.js');
 for(const [month,name] of ['janar','shkurt','mars','prill','maj','qershor','korrik','gusht','shtator','tetor','nëntor','dhjetor'].entries())assert.equal(emailDate(`2026-${String(month+1).padStart(2,'0')}-05`),`5 ${name} 2026`);
});
test('description paragraphs are styled separately from all system text and escaped',()=>{
 const description='Paragrafi i parë.\n\n<img src=x onerror=alert(1)>\nhttps://example.test';
 const html=emailHtml(`Përshëndetje,\n\nPërshkrimi:\n${description}\n\nFakulteti Filozofik`,[{label:'Përshkrimi:',text:description}]);
 assert.equal((html.match(/data-email-section="description"/g)||[]).length,1);
 assert.match(html,/font:14px\/1.6 Arial/);assert.match(html,/font:18px\/1.7 Georgia/);
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 const block=html.split('data-email-section="description"')[1].split('</div>')[0];
 assert.ok(block.includes('Paragrafi i parë.'));assert.ok(block.includes('&lt;img'));assert.ok(!block.includes('Fakulteti Filozofik'));
});
test('public events include physical locations or the online link label',()=>{
 const base={title:'Panel',date:'2026-11-05',periodIds:['p1'],roomId:'',mode:'physical',location:'Biblioteka qendrore',description:'Teksti i aktivitetit'};
 const periods=[{id:'p1',start:'10:00',end:'11:00'}];
 const physical=publicEventEmail(base,periods,[],{});
 assert.match(physical.text,/Lokacioni: Biblioteka qendrore/);assert.match(physical.text,/Data: 5 nëntor 2026/);
 assert.match(emailHtml(physical.text,physical.descriptionSections),/data-email-section="description"/);
 const online=publicEventEmail({...base,mode:'online',onlineUrl:'https://example.test/event'},periods,[],{});
 assert.match(online.text,/Linku i ngjarjes online: https:\/\/example.test\/event/);assert.doesNotMatch(online.text,/Lokacioni:/);
});
