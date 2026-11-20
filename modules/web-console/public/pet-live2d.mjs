let app=null,model=null,mood='idle',until=0,speaking=false;
const base='/live2d/';
const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('缺少 Live2D 运行库：'+src.split('/').at(-1)));document.head.append(s);});
export async function startLive2d(button,onStatus){
  try{
    const probe=await fetch(base+'vendor/live2dcubismcore.min.js',{method:'HEAD'});if(!probe.ok)throw Error('模型已导入；等待 Cubism Core 运行库许可确认');
    await load(base+'vendor/live2dcubismcore.min.js');await load(base+'vendor/pixi.min.js');await load(base+'vendor/unsafe-eval.min.js');await load(base+'vendor/cubism4.min.js');
    app=new PIXI.Application({width:128,height:148,resolution:Math.min(devicePixelRatio||1,2),backgroundAlpha:0,antialias:false,autoStart:false});app.ticker.maxFPS=15;
    app.ticker.remove(app.render,app);let painted=false;
    model=await PIXI.live2d.Live2DModel.from(base+'fox/model.model3.json',{autoInteract:false,autoUpdate:false});model.anchor.set(.5,.5);app.stage.addChild(model);
    app.ticker.add(()=>{try{model.update(app.ticker.deltaMS);app.render();if(!painted){painted=true;onStatus('Live2D 已加载 · 15 FPS');}}catch(e){app.stop();app.view.remove();model=null;button.querySelector('img')?.removeAttribute('hidden');onStatus('Live2D 绘制失败，已恢复立绘：'+e.message);}});
    const ratio=Math.min(124/model.width,142/model.height);model.scale.set(ratio);model.position.set(64,74);
    app.view.style.cssText='width:128px;height:148px;display:block';button.append(app.view);const image=button.querySelector('img');if(image)image.hidden=true;
    const ids=new Set(await fetch(base+'fox/parameters.json').then(r=>r.json())),core=model.internalModel.coreModel,set=(id,v)=>{if(ids.has(id))core.setParameterValueById(id,v);};
    model.internalModel.on('beforeModelUpdate',()=>{const t=performance.now()/1000,active=performance.now()<until;
      set('ParamBreath',(Math.sin(t*1.5)+1)/2);set('ParamEyeLOpen',t%4.5<.12?0:1);set('ParamEyeROpen',t%4.5<.12?0:1);
      set('ParamMouthOpenY',speaking?Math.max(0,Math.sin(t*12))*.7:0);
      set('ParamAngleY',active&&mood==='nod'?Math.sin(t*7)*15:Math.sin(t)*2);set('ParamAngleX',active&&mood==='shake'?Math.sin(t*7)*18:Math.sin(t*.7)*3);
      set('ParamEyeLSmile',active&&mood==='happy'?1:0);set('ParamEyeRSmile',active&&mood==='happy'?1:0);set('ParamMouthForm',active&&mood==='happy'?1:0);
      set('ParamCheek',active&&mood==='shy'?1:0);set('ParamFaceAngry',active&&mood==='angry'?1:0);
    });
    button.addEventListener('pointermove',e=>{const r=button.getBoundingClientRect();model.focus((e.clientX-r.left)/r.width*2-1,(e.clientY-r.top)/r.height*2-1);},{passive:true});
    const visibility=()=>{if(document.hidden)app.stop();else app.start();};document.addEventListener('visibilitychange',visibility);visibility();
    window.addEventListener('pagehide',()=>{app?.stop();app?.destroy(true,{children:true,texture:true,baseTexture:true});app=null;},{once:true});
    if(!painted)onStatus('Live2D 正在绘制…');return true;
  }catch(e){app?.destroy(true,{children:true,texture:true,baseTexture:true});app=null;model=null;button.querySelector('img')?.removeAttribute('hidden');onStatus(e.message);return false;}
}
export function petAction(action){if(!model||!['happy','shy','angry','nod','shake'].includes(action))return false;mood=action;until=performance.now()+2200;return true;}
export function setSpeaking(value){speaking=Boolean(value);}
