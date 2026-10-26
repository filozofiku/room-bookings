export const timestamp = ms => ({toMillis:()=>ms});
export function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return timestamp(Date.parse(value.timestampValue));
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v])=>[k,decode(v)]));
  throw Error('unsupported-firestore-value');
}
export function encode(value) {
  if(value===null) return {nullValue:null};
  if(typeof value==='string') return {stringValue:value};
  if(typeof value==='boolean') return {booleanValue:value};
  if(typeof value==='number') return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
  if(typeof value?.toMillis==='function') return {timestampValue:new Date(value.toMillis()).toISOString()};
  if(Array.isArray(value)) return {arrayValue:{values:value.map(encode)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
}
export function firestoreRest(project, token, request = fetch, origin = 'https://firestore.googleapis.com') {
  const base=`${origin}/v1/projects/${project}/databases/(default)/documents`;
  const call=async(suffix,method='GET',body)=>{
    const response=await request(base+suffix,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    if(!response.ok) throw Object.assign(Error('firestore-request-failed'),{code:data.error?.status || 'HTTP_ERROR'});
    return data;
  };
  const snapshot=raw=>({exists:!!raw,id:raw?.name?.split('/').at(-1),updateTime:raw?.updateTime,data:()=>raw?decode({mapValue:{fields:raw.fields}}):undefined});
  const read=async path=>{
    try{return snapshot(await call('/'+path.split('/').map(encodeURIComponent).join('/')))}
    catch(error){if(error.code==='NOT_FOUND')return snapshot(null);throw error;}
  };
  const db={
    doc:path=>({path,id:path.split('/').at(-1),get:()=>read(path)}),
    collection:path=>({get:async()=>{
      const docs=[];let pageToken='';
      do{const data=await call('/'+path+'?pageSize=100'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));docs.push(...(data.documents||[]).map(snapshot));pageToken=data.nextPageToken;}while(pageToken);
      return {docs};
    }}),
    // The delivery worker only changes one document. An update-time precondition
    // provides atomic compare-and-set without giving it administrative credentials.
    runTransaction:async callback=>{
      for(let attempt=0;attempt<5;attempt++){
        let readRef,version,patch;
        const result=await callback({get:async ref=>{
          if(readRef)throw Error('single-document-transaction-required');
          readRef=ref;const snap=await read(ref.path);version=snap.updateTime;return snap;
        },update:(ref,data)=>{
          if(ref.path!==readRef?.path)throw Error('single-document-transaction-required');
          patch=data;
        }});
        if(!patch)return result;
        try{
          await call(':commit','POST',{writes:[{update:{name:`projects/${project}/databases/(default)/documents/${readRef.path}`,fields:encode(patch).mapValue.fields},updateMask:{fieldPaths:Object.keys(patch)},currentDocument:version?{updateTime:version}:{exists:false}}]});
          return result;
        }catch(error){if(!['FAILED_PRECONDITION','ABORTED','ALREADY_EXISTS'].includes(error.code)||attempt===4)throw error;}
      }
    },
    upcoming:async date=>{
      const rows=await call(':runQuery','POST',{structuredQuery:{from:[{collectionId:'publicBookings'}],where:{fieldFilter:{field:{fieldPath:'date'},op:'GREATER_THAN_OR_EQUAL',value:encode(date)}}}});
      return rows.filter(r=>r.document).map(r=>snapshot(r.document));
    },
    pending:async()=>{
      const rows=await call(':runQuery','POST',{structuredQuery:{from:[{collectionId:'cancellationNotifications'}],where:{fieldFilter:{field:{fieldPath:'status'},op:'IN',value:encode(['pending','retrying','sending'])}},limit:25}});
      return rows.filter(r=>r.document).map(r=>db.doc('cancellationNotifications/'+r.document.name.split('/').at(-1)));
    }
  };
  return db;
}
