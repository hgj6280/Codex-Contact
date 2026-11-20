import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {openQqCompanion} from '../src/qq-companion.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';
import {buildCompactGeminiPrompt} from '../src/qq-text-context.mjs';

// Explicit live regression, not run during startup/tests. Synthetic data only;
// no QQ send transport and no writes to the real companion database.
const directory=await mkdtemp(join(tmpdir(),'qq-companion-live-'));
const path=join(directory,'memory.sqlite');
const analyze=createGeminiRouterReply({analysis:true,maxTokens:850,timeoutMs:20000});
const reply=createGeminiRouterReply({maxTokens:300,timeoutMs:30000});
const report={startedAt:new Date().toISOString(),syntheticData:true,qqMessagesSent:0,steps:[],usage:[]};
let store;
const person={type:'group_message',groupId:'20012',senderId:'10014',senderName:'记忆测试用户'};
const options={analyze:async prompt=>{const result=await analyze(prompt);report.usage.push({stage:'memory-extraction',...result.usage});return result;}};
async function ask(text){
  const event={...person,senderName:'改名后的测试用户',text};
  const context=store.context(event),started=performance.now();
  const prompt=buildCompactGeminiPrompt({instructions:'你是狐宫静，正常简短聊天。只根据当前会话提供的可信来源回答，记不住就直说。',text,
    longTermContext:context.memory,memoryContext:context.recent,socialContext:context.social});
  const result=await reply(prompt);report.usage.push({stage:'recall-reply',...result.usage});
  return {text:result.text,promptChars:prompt.length,durationMs:performance.now()-started,recalled:context.memory};
}
try{
  store=await openQqCompanion(path,options);
  store.observe({...person,text:'我叫测试同学，我最喜欢喝草莓牛奶。'},'好呀，认识你啦。');
  store.observe({...person,text:'我和狐宫静约好了周六晚上去星河剧场跑团。'},'周六晚上见。');
  store.observe({...person,text:'我的画作第一次获奖了，真的好开心，这让我有信心继续画下去了！'},'恭喜你呀！');
  const learned=await store.flush({force:true});
  assert.ok(learned.accepted>=1,JSON.stringify(learned));
  report.steps.push({stage:'real-gemini-learning',result:learned,facts:store.list(person)});
  assert.ok(store.snapshot().affectiveMemories>=1);
  assert.ok(store.emotionState(person)?.valence>0);
  report.steps.push({stage:'affective-learning',state:store.emotionState(person),affectiveMemories:store.snapshot().affectiveMemories});
  store.close();store=await openQqCompanion(path,options);
  assert.ok(store.emotionState(person)?.valence>0);
  const emotionalAnswer=await ask('还记得我画作获奖的事吗？自然接一句就行，不要报情绪数值。');
  assert.match(emotionalAnswer.text,/画|奖|恭喜/);
  report.steps.push({stage:'emotional-episode-after-reopen',...emotionalAnswer,social:store.context({...person,text:'画作获奖'}).social});
  const answer=await ask('我最喜欢喝什么？我们约好什么时候去哪里跑团？');
  report.steps.push({stage:'reopen-and-rename-recall',...answer});
  assert.match(answer.text,/草莓/);assert.match(answer.text,/周六|星期六/);assert.match(answer.text,/星河/);
  assert.match(answer.recalled,/草莓/);assert.match(answer.recalled,/星河/);
  store.observe({...person,text:'更正一下，我现在最喜欢喝香蕉牛奶，不再是草莓牛奶了。'},'知道了，以现在的为准。');
  const corrected=await store.flush({force:true});report.steps.push({stage:'real-gemini-correction',result:corrected,facts:store.list(person)});
  assert.ok(corrected.accepted>=1,JSON.stringify(corrected));
  const correctedAnswer=await ask('我现在最喜欢喝什么？只说现在的口味。');
  assert.match(correctedAnswer.text,/香蕉/);report.steps.push({stage:'corrected-recall',...correctedAnswer});
  for(const event of [{...person,groupId:'10017'},{type:'private_message',senderId:person.senderId},{...person,senderId:'10018'}])assert.equal(store.recall({...event,text:'喜欢喝什么'}).length,0);
  report.steps.push({stage:'scope-isolation',pass:true});
  const started=performance.now();for(let i=0;i<100;i++)store.context({...person,text:'我喜欢喝什么'});
  report.localRecallMs=(performance.now()-started)/100;report.sqliteBytes=(await stat(path)).size;
  store.forget(person,'all');assert.equal(store.recall({...person,text:'喜欢喝什么'}).length,0);
  report.steps.push({stage:'forget',pass:true});report.ok=true;
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;}
finally{
  store?.close();
  const outputDir=join(homedir(),'Library','Application Support','CodexRemoteContact','runtime','verification');
  await mkdir(outputDir,{recursive:true,mode:0o700});
  const output=join(outputDir,`qq-companion-${Date.now()}.json`);
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({ok:report.ok,error:report.error,steps:report.steps,localRecallMs:report.localRecallMs,sqliteBytes:report.sqliteBytes,reportPath:output}));
  await rm(directory,{recursive:true,force:true});
}
