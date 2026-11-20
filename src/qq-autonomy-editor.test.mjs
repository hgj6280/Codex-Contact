import test from 'node:test';
import assert from 'node:assert/strict';
import {bindAutonomyEditor} from '../modules/web-console/public/autonomy-editor.mjs';
test('editor preserves edits and captures conversation target before the user switches chats',async()=>{
  const fields=new Map(),keys=['enabled','contextualReplies','friendRequests','privateMessages','moderation','save','conversation','controllers','status','target','interval','limit','mute','log','reload'];
  for(const k of keys)fields.set(k,{disabled:false,value:'',checked:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});
  const root={querySelector:s=>fields.get(s.match(/data-autonomy-([^\]]+)/)[1]),querySelectorAll:()=>keys.filter(k=>!['save','status','target','log','reload'].includes(k)).map(k=>fields.get(k))};
  let selected='20012',writes=[];
  let config={enabled:true,contextualReplies:true,friendRequests:true,privateMessages:true,moderation:true,controllers:['10014'],disabledConversations:[],minIntervalSeconds:90,maxPerHour:6,maxMuteMinutes:10,revision:'initial',recentActions:[]};
  const editor=bindAutonomyEditor({root,selected:()=>selected,api:async(_p,body)=>{if(body){writes.push(body);config={...config,...body,revision:'new'};}return structuredClone(config);}});
  await editor.load();assert.equal(fields.get('contextualReplies').checked,true);fields.get('contextualReplies').checked=false;fields.get('contextualReplies').listeners.change();assert.equal(fields.get('conversation').checked,true);fields.get('conversation').checked=false;fields.get('conversation').listeners.change();
  selected='10017';await editor.load();assert.equal(fields.get('conversation').checked,false);
  await fields.get('save').onclick();assert.equal(writes[0].conversation.id,'20012');assert.equal(writes[0].conversation.enabled,false);assert.deepEqual(writes[0].controllers,['10014']);
  assert.equal(writes[0].contextualReplies,false);
  assert.match(fields.get('status').textContent,/已保存/);
});
