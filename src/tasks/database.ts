import { createStore } from '../../research/chatgpt-tasks/result-model.mjs';
import type { TaskState } from './types.js';
export const TASK_DATABASE = 'vaiwl-start-chatgpt-tasks';
export function initialState(): TaskState {
  return {version:1,generation:0,model:createStore(),principal:null,catalog:{},coverage:{},sourceEvidence:{},
    settings:{enabled:false,automatic:true,showWidget:true,preview:true,selections:{}},
    sync:{status:'never',attemptedAt:null,succeededAt:null,code:null,mode:null}};
}
export class TaskDatabase {
  private opening: Promise<IDBDatabase> | null = null;
  private open(): Promise<IDBDatabase> {
    return this.opening ||= new Promise((resolve,reject) => {
      const r=indexedDB.open(TASK_DATABASE,1);
      r.onupgradeneeded=()=>r.result.createObjectStore('state');
      r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();this.opening=null;};resolve(r.result);};
      r.onerror=()=>{this.opening=null;reject(r.error);};
    });
  }
  async read(): Promise<TaskState> {
    const db=await this.open(); return new Promise((resolve,reject)=>{
      const r=db.transaction('state').objectStore('state').get('current');
      r.onsuccess=()=>resolve(r.result || initialState());r.onerror=()=>reject(r.error);
    });
  }
  async update(change: (state: TaskState) => TaskState): Promise<TaskState> {
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('state','readwrite'), store=tx.objectStore('state');let result:TaskState;
      const r=store.get('current');r.onsuccess=()=>{try {result=change(r.result || initialState());store.put(result,'current');}catch(e){tx.abort();reject(e);}};
      tx.oncomplete=()=>resolve(result!);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('CACHE_WRITE_FAILED'));
    });
  }
}
