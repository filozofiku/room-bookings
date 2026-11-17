export const WORKER_READ_LIMIT=6000;
export const WORKER_WRITE_LIMIT=1500;
export const BUDGET_KEY='FIRESTORE_BUDGET_V1';
export function quotaDay(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
const blocked=()=>Object.assign(Error('Mail worker daily database budget reached; work deferred.'),{code:'worker-budget'});
// Persist reservations before network I/O. A terminated run overcounts safely.
// Queries must have a result limit; public reference lists have bounded pages.
export function requestBudget(request,properties,{now=Date.now,readLimit=WORKER_READ_LIMIT,writeLimit=WORKER_WRITE_LIMIT}={}){
 const get=()=>{let data;try{data=JSON.parse(properties.getProperty(BUDGET_KEY)||'null');}catch{}return data?.day===quotaDay(now())?data:{day:quotaDay(now()),reads:0,writes:0};};
 const put=data=>properties.setProperty(BUDGET_KEY,JSON.stringify(data));
 const ensure=(reads=0,writes=0)=>{const data=get();if(data.reads+reads>readLimit||data.writes+writes>writeLimit)throw blocked();return data;};
 const wrapped=async(url,options={})=>{
  if(!url.startsWith('https://firestore.googleapis.com/'))return request(url,options);
  const body=options.body?JSON.parse(options.body):null;
  let reads=1,writes=0,kind='document';
  if(url.endsWith(':runQuery')){reads=body?.structuredQuery?.limit;if(!Number.isInteger(reads)||reads<1||reads>500)throw Object.assign(Error('Unbounded worker query refused'),{code:'worker-budget'});kind='query';}
  else if(url.endsWith(':commit')){writes=body?.writes?.length||0;reads=writes*3;kind='commit';}
  else if(url.includes('?pageSize=')){reads=Number(url.match(/[?&]pageSize=(\d+)/)?.[1]);if(!Number.isInteger(reads)||reads<1||reads>100)throw blocked();kind='list';}
  const data=ensure(reads,writes);data.reads+=reads;data.writes+=writes;put(data);
  const response=await request(url,options);
  const value=await response.json();
  if(response.ok&&!value.error&&!(Array.isArray(value)&&value.some(row=>row.error))&&kind!=='commit'){
   const actual=kind==='query'?Math.max(1,value.filter(row=>row.document).length):kind==='list'?Math.max(1,(value.documents||[]).length):1;
   if(actual>reads)throw blocked();
   const current=get();if(current.day===data.day){current.reads-=reads-actual;put(current);}
  }
  return {...response,json:()=>value};
 };
 return {request:wrapped,ensure,snapshot:get};
}
