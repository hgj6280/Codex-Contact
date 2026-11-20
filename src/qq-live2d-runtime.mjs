import {access,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
export function live2dRuntime({root,fetchImpl=fetch}){
  const core=join(root,'vendor/live2dcubismcore.min.js'),exists=path=>access(path).then(()=>true,()=>false);
  async function status(){return {modelReady:await exists(join(root,'fox/model.model3.json')),coreReady:await exists(core),fps:15,textureSize:2048,licenseUrl:'https://www.live2d.com/en/sdk/download/web/'};}
  async function install(licenseAccepted){
    if(licenseAccepted!==true)throw Error('请先由本人确认官方 SDK 软件许可');
    const url='https://cubism.live2d.com/sdk-web/core/05/live2dcubismcore.min.js',r=await fetchImpl(url,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!r.ok)throw Error('官方运行库下载失败');const js=await r.text();
    if(js.length<10000||js.length>3*1024*1024||!js.includes('Live2DCubismCore'))throw Error('官方运行库内容验证失败');
    await mkdir(join(root,'vendor'),{recursive:true});await writeFile(core+'.new',js);await rename(core+'.new',core);await writeFile(join(root,'core-license-acceptance.json'),JSON.stringify({acceptedAt:new Date().toISOString(),source:url,terms:'https://www.live2d.com/en/sdk/download/web/'}));return status();
  }return {status,install};
}
