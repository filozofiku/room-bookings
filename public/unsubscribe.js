// The token stays in the URL fragment: it is never sent in page requests or
// Referer headers. Opening an email link does not itself change preferences.
const params=new URLSearchParams(location.hash.slice(1));
const id=params.get('id'),token=params.get('token');
const button=document.getElementById('unsubscribe'),status=document.getElementById('status');
if(!/^[a-f0-9]{64}$/.test(id||'')||!/^[a-zA-Z0-9-]{32,128}$/.test(token||'')){
 status.textContent='Lidhja e çregjistrimit nuk është e vlefshme. Përdorni lidhjen nga emaili juaj javor.';
}else{
 button.disabled=false;
 button.onclick=async()=>{
  button.disabled=true;status.textContent='Duke ruajtur…';
  try{
   const response=await fetch('https://firestore.googleapis.com/v1/projects/filozofiku/databases/(default)/documents:commit',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes:[{
     update:{name:'projects/filozofiku/databases/(default)/documents/publicEventRecipients/'+id,fields:{confirmationToken:{stringValue:token},unsubscribed:{booleanValue:true}}},
     updateMask:{fieldPaths:['confirmationToken','unsubscribed']},
     updateTransforms:[{fieldPath:'unsubscribedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{exists:true}
    }]}),signal:AbortSignal.timeout(30000)
   });
   if(!response.ok)throw Error('unsubscribe-failed');
   status.textContent='U çregjistruat me sukses. Nuk do të merrni më emailat javore për aktivitetet publike.';
   button.hidden=true;history.replaceState(null,'',location.pathname);
  }catch{
   status.textContent='Çregjistrimi nuk u ruajt. Provoni përsëri ose përdorni lidhjen nga emaili juaj i fundit.';
   button.disabled=false;
  }
 };
}
