import test from 'node:test';
import assert from 'node:assert/strict';
import {transferClipboard,CLIPBOARD_LIMIT} from './qq-remote-clipboard.mjs';
const read=async()=>JSON.stringify({kind:'snowluma',profile:'qq-contact'});
test('Chinese, emoji and shell-like text use stdin on the fixed clipboard tool',async()=>{
 const text='狐宫静，你好呀！🦊\n$(touch /tmp/never) `echo nope`';let called=false;
 const r=await transferClipboard('set',text,{read,run:async(file,args,input)=>{
  called=true;assert.equal(file,'/opt/homebrew/bin/docker');assert.equal(input,text);
  assert.equal(args.includes(text),false);assert.ok(args.includes('codex-contact-snowluma'));assert.ok(args.includes('UTF8_STRING'));assert.equal(args.includes('sh'),false);return '';
 }});assert.ok(called&&r.ok);
});
test('read preserves exact multiline Unicode and rejects excessive data',async()=>{
 const text='中文\n第二行 🦊';assert.deepEqual(await transferClipboard('get','',{read,run:async()=>text}),{ok:true,text});
 await assert.rejects(transferClipboard('get','',{read,run:async()=>'x'.repeat(CLIPBOARD_LIMIT+1)}),/64KB/);
});
test('invalid operations, sizes and unrelated engines never run a process',async()=>{
 const run=()=>assert.fail('no process allowed');
 for(const [op,text]of [['delete',''],['set','\0'],['set','中'.repeat(CLIPBOARD_LIMIT)]])await assert.rejects(transferClipboard(op,text,{read,run}));
 for(const config of [{kind:'native'},{kind:'snowluma',profile:'other'}])await assert.rejects(transferClipboard('get','',{read:async()=>JSON.stringify(config),run}),/未使用/);
});
