import {isLocalTextProvider} from './qq-local-model.mjs';
// Social planning follows the selected text provider; a dead cloud route cannot
// disable local proactive chat. Existing host limits/ACLs still decide every send.
export function createSocialAnalysis({provider,localReply,remoteReply,remoteModel='ag/gemini-3.8-flash',ledger,noteAvailable=()=>{},noteUnavailable=()=>{}}){
 return async (prompt,{maxTokens=450}={})=>{
  const local=isLocalTextProvider(provider()),tracker=ledger.start(local?'local-qwen35-4b':remoteModel,{role:'social',prompt});
  try{
   const result=await (local?localReply(prompt,{maxTokens,priority:'background'}):remoteReply(prompt)),u=result.usage;
   tracker.observe?.({first:result.localTiming?.firstOutputAt,last:result.localTiming?.lastOutputAt??Date.now()});
   if(!local)noteAvailable();
   if(u?.available)tracker.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:u.prompt_tokens,output_tokens:u.completion_tokens,cached_input_tokens:u.prompt_tokens_details?.cached_tokens||0}})+'\n');
   await tracker.finish('completed');return result;
  }catch(e){if(!local)noteUnavailable(e);await tracker.finish('failed');throw e;}
 };
}
