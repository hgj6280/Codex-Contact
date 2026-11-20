import {parseVideoUrl,extractVideoSources} from './qq-video-input.mjs';
export const qqVideoTools=[
  {name:'video_submit',description:'提交当前消息或实际引用中的单个公开视频；身份与回群由适配器绑定',parameters:{url:'当前消息内的视频 URL',style:'brief|normal|detailed|conclusion|steps'}},
  {name:'video_status',description:'查询当前会话的视频任务状态',parameters:{id:'任务编号或前8位'}},
  {name:'video_read',description:'读取当前会话的视频结果和带时间点正文',parameters:{id:'任务编号或前8位'}},
  {name:'video_cancel',description:'取消当前发送者自己的视频任务',parameters:{id:'任务编号或前8位'}},
  {name:'video_ask',description:'从当前会话指定视频的真实正文回答追问',parameters:{id:'任务编号或前8位',question:'当前问题'}}
];
export async function invokeVideoTool(jobs,event,name,args={}){
  if(!qqVideoTools.some(t=>t.name===name))throw Error('视频工具不存在');
  if(Object.keys(args).some(k=>!['url','style','id','question'].includes(k)))throw Error('视频工具不能接收群号、账号、路径、命令或回群目标');
  if(name==='video_submit'){
    const source=parseVideoUrl(args.url),available=extractVideoSources(event);
    if(!available.some(s=>s.url===source.url))throw Error('视频地址必须来自当前实际消息或合法引用');
    if(!['brief','normal','detailed','conclusion','steps',undefined].includes(args.style))throw Error('总结要求无效');return jobs.submit(event,source,args.style||'normal');
  }
  if(!args.id)throw Error('请提供任务编号');const job=jobs.lookup(event,String(args.id));if(!job)throw Error('当前会话没有唯一匹配的任务');
  if(name==='video_ask')return jobs.answer(event,job.id,args.question);
  if(name==='video_status')return job;
  if(name==='video_read'){const row=jobs.get(job.id);return {task:job,content:row.content||null,summary:row.summary||null};}
  return jobs.handle({...event,text:`/视频 取消 ${job.id}`});
}
export async function handleVideoApi(req,res,{jobs,isLocalRequest,bind,readBody,sendJson,acknowledge}){
  const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/api/qq/videos'))return false;
  if(!isLocalRequest(req)||req.headers['sec-fetch-site']==='cross-site'){sendJson(res,403,{error:'仅允许本机管理视频任务'});return true;}
  if(!jobs){sendJson(res,503,{error:'视频模块未启动，普通聊天正常运行'});return true;}
  try{
    if(url.pathname==='/api/qq/videos/settings'){sendJson(res,200,req.method==='POST'?jobs.setting(await readBody(req,8192)):jobs.snapshot());return true;}
    if(url.pathname==='/api/qq/videos/tools'&&req.method==='GET'){sendJson(res,200,{tools:qqVideoTools});return true;}
    const body=req.method==='POST'?await readBody(req,16384):{},event=await bind(String(body.conversationId||url.searchParams.get('conversationId')||''));
    if(url.pathname==='/api/qq/videos/jobs'&&req.method==='GET'){sendJson(res,200,{tasks:jobs.list(event)});return true;}
    if(url.pathname==='/api/qq/videos/tools'&&req.method==='POST'){
      // Local operator test/tool calls still bind a fresh QQ account and current
      // authorized room. No model-provided sender, message ID or destination.
      event.text=String(body.input?.url||'');const action=await invokeVideoTool(jobs,event,body.name,body.input);
      if(action.afterSend&&action.reply&&acknowledge){const delivery=await acknowledge(event,action.reply,{requestId:crypto.randomUUID()});action.ackDelivery=delivery;if(delivery.ok)await action.afterSend(delivery);}
      sendJson(res,200,{...action,afterSend:undefined});return true;
    }
    sendJson(res,404,{error:'视频接口不存在'});
  }catch(e){sendJson(res,400,{error:e.message});}return true;
}
