import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const pending=new Map();
export function saveJsonAtomic(path,value){
  const body=JSON.stringify(value),previous=pending.get(path)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{await mkdir(dirname(path),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,body,{mode:0o600});await rename(temp,path);});
  pending.set(path,work);work.finally(()=>{if(pending.get(path)===work)pending.delete(path);}).catch(()=>{});return work;
}
