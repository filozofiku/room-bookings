import {test} from 'node:test';import assert from 'node:assert/strict';
import {localMidnight,nextDate,datesToSync,fetchTrafficDay,findSiteTag,resolveCloudflareSite} from '../scripts/cloudflare-reporting.mjs';
const accountId='a'.repeat(32),siteTag='b'.repeat(32),token='private-token';
const request=data=>async()=>({ok:true,json:async()=>data});
test('local traffic boundaries cover DST days without duplicate or missing hours',()=>{
  for(const [date,hours] of [['2026-03-29',23],['2026-10-25',25],['2026-11-01',24]])assert.equal((Date.parse(localMidnight(nextDate(date)))-Date.parse(localMidnight(date)))/3600000,hours);
});
test('sync dates never predate analytics launch and have an explicit bounded lookback',()=>{
  assert.deepEqual(datesToSync({now:new Date('2026-11-15T11:00Z')}),['2026-11-15']);
  assert.throws(()=>datesToSync({days:31}),/invalid-sync-range/);
});
test('site discovery matches the actual beacon token and uses the site tag for analytics',async()=>{
  assert.equal(await findSiteTag(token,accountId,request({result:[{site_token:'dbaf5970dd9649848c810f4c245f57ad',site_tag:siteTag}]})),siteTag);
  await assert.rejects(findSiteTag(token,accountId,request({result:[]})),/not-found/);
});
test('account discovery finds the installed beacon without requiring manual account/tag setup',async()=>{
  const found=await resolveCloudflareSite({token,request:async url=>({ok:true,json:async()=>url.includes('/rum/')?{result:[{site_token:'dbaf5970dd9649848c810f4c245f57ad',site_tag:siteTag}]}:{result:[{id:accountId}]}})});
  assert.deepEqual(found,{accountId,siteTag});
});
test('traffic totals use the totals query, paths strip private parameters, and tokens never enter results',async()=>{
  let payload;
  const result=await fetchTrafficDay({token,accountId,siteTag,date:'2026-11-15',now:Date.parse('2026-11-15T12:00Z'),request:async(url,options)=>{
    assert.equal(url,'https://api.cloudflare.com/client/v4/graphql');assert.equal(options.headers.Authorization,'Bearer '+token);payload=JSON.parse(options.body);
    return {ok:true,json:async()=>({data:{viewer:{accounts:[{total:[{count:8,sum:{visits:3},avg:{sampleInterval:1}}],paths:[{count:5,dimensions:{requestPath:'/?email=private'}},{count:3,dimensions:{requestPath:'/room-bookings/#private'}}]}]}}})};
  }});
  assert.equal(result.pageViews,8);assert.equal(result.visits,3);assert.equal(result.complete,false);assert.equal(result.paths[0].path,'/');
  assert.match(payload.query,/bot:0/);assert.match(payload.query,/requestHost:"filozofiku.github.io"/);assert.doesNotMatch(JSON.stringify(result),/private-token|email=|#private/);
});
test('API and GraphQL errors do not become cached zero traffic; empty successful responses do',async()=>{
  const base={token,accountId,siteTag,date:'2026-11-15',now:Date.parse('2026-11-16T12:00Z')};
  await assert.rejects(fetchTrafficDay({...base,request:request({errors:[{message:'private upstream details'}]})}),/cloudflare-query-failed/);
  await assert.rejects(fetchTrafficDay({...base,request:request({data:{viewer:{accounts:[]}}})}),/invalid-cloudflare-response/);
  const zero=await fetchTrafficDay({...base,request:request({data:{viewer:{accounts:[{total:[],paths:[]}]}}})});assert.equal(zero.pageViews,0);assert.equal(zero.complete,true);
});
