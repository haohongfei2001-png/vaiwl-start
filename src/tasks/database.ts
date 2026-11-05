import { createStore } from '../../research/chatgpt-tasks/result-model.mjs';
import { listComplete, projectTasks } from './state.js';
import type { TaskCachedSnapshot, TaskControlState, TaskState } from './types.js';
export const TASK_DATABASE = 'vaiwl-start-chatgpt-tasks';
const SNAPSHOT = 'snapshot-v1', CONTROL = 'control-v1';
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
  private async readProjection<T>(key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('state').objectStore('state').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async readSnapshot(): Promise<TaskCachedSnapshot> {
    const cached = await this.readProjection<TaskCachedSnapshot>(SNAPSHOT);
    if (cached) return cached;
    // One-time hydration of pre-existing installations; never reset their records.
    await this.update(state => state);
    return (await this.readProjection<TaskCachedSnapshot>(SNAPSHOT))!;
  }
  async readControl(): Promise<TaskControlState> {
    const cached = await this.readProjection<TaskControlState>(CONTROL);
    if (cached) return cached;
    await this.update(state => state);
    return (await this.readProjection<TaskControlState>(CONTROL))!;
  }
  async update(change: (state: TaskState) => TaskState): Promise<TaskState> {
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('state','readwrite'), store=tx.objectStore('state');let result:TaskState;
      const r=store.get('current');r.onsuccess=()=>{
        const state: TaskState = r.result || initialState();
        const previousModel = state.model;
        const signature = presentationSignature(state);
        const cached = store.get(SNAPSHOT);
        cached.onsuccess = () => { try {
          result=change(state);
          const oldView = cached.result as TaskCachedSnapshot | undefined;
          // Identity/status heartbeats do not repeatedly parse every saved AI body.
          const tasks = oldView && previousModel === result.model && signature === presentationSignature(result)
            ? oldView.tasks : projectTasks(result);
          const snapshot: TaskCachedSnapshot = { generation: result.generation, settings: result.settings,
            principal: result.principal, tasks, sync: result.sync,
            completeList: listComplete(result, result.sync.attemptedAt || undefined) };
          const { model: _model, sourceEvidence: _evidence, ...control } = result;
          // Same transaction is the privacy boundary: a newly observed account can
          // never coexist with the previous account's displayed projection.
          store.put(result,'current');
          store.put(snapshot, SNAPSHOT);
          store.put(control, CONTROL);
        } catch(e) { tx.abort(); reject(e); } };
      };
      tx.oncomplete=()=>resolve(result!);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('CACHE_WRITE_FAILED'));
    });
  }
}
function presentationSignature(state: TaskState): string {
  return JSON.stringify([state.principal, state.generation, state.settings, state.catalog]);
}
