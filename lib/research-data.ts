// Only completed reads are reused. Abort signals still cancel obsolete work.
const cache=new Map<string,{expires:number;value:unknown}>();
let generation=0;
export function clearResearchCache(){generation++;cache.clear();}
export async function getResearchJson<T>(path:string,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  const hit=cache.get(path);
  if(hit&&hit.expires>Date.now())return hit.value as T;
  const revision=generation;
  const response=await fetch(path,{signal,cache:"no-store",credentials:"omit"});
  if(!response.ok)throw new Error(response.status===503?"Research evidence unavailable. Retry after checking the local service.":`Research request failed (${response.status}).`);
  const value=await response.json();signal.throwIfAborted();
  if(revision===generation){cache.delete(path);cache.set(path,{expires:Date.now()+300000,value});while(cache.size>64)cache.delete(cache.keys().next().value!);}
  return value as T;
}
