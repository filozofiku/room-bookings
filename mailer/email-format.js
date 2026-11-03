const months=['janar','shkurt','mars','prill','maj','qershor','korrik','gusht','shtator','tetor','nëntor','dhjetor'];
export function emailDate(date){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date||'');
 if(!match)return date||'';
 return `${Number(match[3])} ${months[Number(match[2])-1]} ${match[1]}`;
}
// Explicit section metadata separates authored descriptions from system text.
// All text remains escaped, including links and descriptions supplied by users.
export function emailHtml(text,descriptionSections=[]){
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const lineHtml=line=>escape(line).replace(/https?:\/\/[^\s<]+/g,url=>`<a href="${url}" style="color:#a51f25;overflow-wrap:anywhere">${url}</a>`);
 const paragraphs=value=>value.replace(/\r\n?/g,'\n').split(/\n\s*\n/).filter(Boolean).map(p=>`<p style="margin:0 0 16px;overflow-wrap:anywhere">${p.split('\n').map(lineHtml).join('<br>')}</p>`).join('');
 text=String(text);
 const ranges=descriptionSections.filter(s=>s.text).map(section=>{
  const marker=section.label+'\n'+section.text,index=text.indexOf(marker);
  return {start:index+section.label.length+1,end:index+marker.length,found:index>=0};
 }).filter(r=>r.found).sort((a,b)=>a.start-b.start);
 let body='',cursor=0;
 for(const range of ranges){
  if(range.start<cursor)continue;
  body+=`<div style="font:14px/1.6 Arial,sans-serif;color:#666">${paragraphs(text.slice(cursor,range.start))}</div>`;
  body+=`<div data-email-section="description" style="font:18px/1.7 Georgia,serif;color:#242222;border-left:3px solid #a51f25;padding:12px 20px;margin:0 0 24px;background:#faf8f5">${paragraphs(text.slice(range.start,range.end))}</div>`;
  cursor=range.end;
 }
 body+=`<div style="font:14px/1.6 Arial,sans-serif;color:#666">${paragraphs(text.slice(cursor))}</div>`;
 return `<!doctype html><html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#fff"><div style="max-width:720px;margin:0 auto">${body}</div></body></html>`;
}
