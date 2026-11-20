import {bindTrace} from './qq-observability.mjs';
export const QQ_IMAGE_CONCURRENCY = 5;
export const QQ_IMAGE_QUEUE_LIMIT = 30;

// One shared ceiling for QQ events and local previews, covering the complete
// reference -> generation -> validation -> repair lifecycle, not individual calls.
export function createImageScheduler({concurrency=QQ_IMAGE_CONCURRENCY,limit=QQ_IMAGE_QUEUE_LIMIT}={}) {
  const pending=[];let active=0;
  function pump(){
    while(active<concurrency && pending.length){
      const job=pending.shift();active++;
      Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{active--;pump();});
    }
  }
  return {
    get active(){return active;},get waiting(){return pending.length;},get concurrency(){return concurrency;},
    run(task){
      if(active+pending.length>=limit)return Promise.reject(Object.assign(new Error('生图队列已满，请稍后再试。'),{code:'IMAGE_QUEUE_FULL'}));
      return new Promise((resolve,reject)=>{pending.push({task:bindTrace(task),resolve,reject});pump();});
    }
  };
}
