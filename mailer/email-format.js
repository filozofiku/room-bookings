// HTML paragraphs avoid the hard-wrapped appearance of plain-text messages.
// Escape all event text; descriptions must never become executable HTML.
export function emailHtml(text){
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const lineHtml=line=>escape(line).replace(/https?:\/\/[^\s<]+/g,url=>`<a href="${url}" style="color:#a51f25;overflow-wrap:anywhere">${url}</a>`);
 const paragraphs=String(text).replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(p=>`<p style="margin:0 0 16px;overflow-wrap:anywhere">${p.split('\n').map(lineHtml).join('<br>')}</p>`).join('');
 return `<!doctype html><html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#fff;color:#242222;font:16px/1.6 Arial,sans-serif"><div style="max-width:720px;margin:0 auto">${paragraphs}</div></body></html>`;
}
