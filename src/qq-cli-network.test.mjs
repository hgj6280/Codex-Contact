import test from 'node:test';
import assert from 'node:assert/strict';
import {createCliEnvironment,parseSystemHttpsProxy} from './qq-cli-network.mjs';

const settings='HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897';
test('macOS HTTPS proxy reaches only CLI children and local bypasses survive',async()=>{
  const env={HOME:'/home',NO_PROXY:'.internal',CODEX_REMOTE_CONTACT_QQ_MODE:'1'};
  const resolve=createCliEnvironment({platform:'darwin',readSystemProxy:async()=>settings});
  const child=await resolve(env);
  assert.equal(child.HTTPS_PROXY,'http://127.0.0.1:7897');assert.equal(child.https_proxy,child.HTTPS_PROXY);
  assert.match(child.NO_PROXY,/\.internal,localhost,127\.0\.0\.1,::1/);
  assert.equal(env.HTTPS_PROXY,undefined);assert.equal(child.CODEX_REMOTE_CONTACT_QQ_MODE,'1');
});
test('explicit child proxies and non macOS environments remain untouched',async()=>{
  for(const [platform,env] of [['darwin',{https_proxy:'http://custom:9876'}],['linux',{}]]){
    const resolve=createCliEnvironment({platform,readSystemProxy:async()=>assert.fail('unexpected system read')});
    assert.equal(await resolve(env),env);
  }
});
test('concurrent image jobs share one short proxy read and refresh after cache expiry',async()=>{
  let time=0,calls=0;
  const resolve=createCliEnvironment({platform:'darwin',now:()=>time,readSystemProxy:async()=>{calls++;return settings;}});
  await Promise.all(Array.from({length:5},()=>resolve({})));assert.equal(calls,1);
  time=30001;await resolve({});assert.equal(calls,2);
});
test('disabled, malformed or unavailable system proxies do not break spawning',async()=>{
  for(const text of ['',settings.replace('Enable : 1','Enable : 0'),settings.replace('7897','70000')])assert.equal(parseSystemHttpsProxy(text),null);
  const env={HOME:'/home'},resolve=createCliEnvironment({platform:'darwin',readSystemProxy:async()=>{throw Error('scutil unavailable');}});
  assert.equal(await resolve(env),env);
});
