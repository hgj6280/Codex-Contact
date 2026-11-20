// Reuse the normal route's health state, but never its tool-enabled fallback.
// Transcripts can only reach these text-only requests or the isolated CLI args.
export function createVideoModelRouter({primary,codex,selection,primaryRoute}){
  return async(prompt,options={})=>{
    options.signal?.throwIfAborted();
    const selected=selection();
    if(!selected.gemini)return codex(prompt,{...options,model:selected.model});
    const fallback=()=>{options.signal?.throwIfAborted();return codex(prompt,{...options,model:'gpt-6-luna'});};
    if(!primaryRoute.snapshot().canTryPrimary)return fallback();
    try{const result=await primary(prompt,options);options.signal?.throwIfAborted();primaryRoute.noteAvailable();return result;}
    catch(error){options.signal?.throwIfAborted();if(!primaryRoute.noteUnavailable(error))throw error;return fallback();}
  };
}
export function buildVideoModelArgs({model,reasoningEffort='low',fastMode=false,cwd,outputPath}){
  // In addition to read-only sandboxing, remove tools that could read files,
  // execute commands, spawn other agents, access apps, browse or generate media.
  return ['exec','--ephemeral','--ignore-user-config','--ignore-rules','--skip-git-repo-check',
    ...['shell_tool','unified_exec','image_generation','view_image','apps','enable_mcp_apps','skill_search','multi_agent','multi_agent_v2','code_mode','code_mode_host','mcp_2026_07_28','codex_apps_mcp_2026_07_28','plugins','remote_plugin','browser_use','browser_use_external','browser_use_full_cdp_access','computer_use','in_app_browser','memories','chronicle','workspace_dependencies','artifact','goals','sleep_tool'].flatMap(name=>['--disable',name]),
    '--enable','skip_host_skill_discovery',
    '--json','-s','read-only','-m',model,'-c','web_search="disabled"','-c','mcp_servers={}','-c','project_doc_max_bytes=0','-c','suppress_unstable_features_warning=true','-c',`model_reasoning_effort="${reasoningEffort}"`,
    ...(fastMode?['-c','features.fast_mode=true','-c','service_tier="fast"']:[]),'-C',cwd,'-o',outputPath,'-'];
}
