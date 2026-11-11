/* Consultas de vendas compartilhadas entre telas, apenas durante esta sessão.
   Nunca persiste dados em localStorage e nunca armazena respostas de outros endpoints.
   Atualização manual ignora o cache. */
const mlshSalesSnapshots=new Map();
let mlshSalesCacheGeneration=0;
function resetSalesSnapshots(){
  mlshSalesCacheGeneration++;
  mlshSalesSnapshots.clear();
}
function salesSnapshotTtl(path){
  const query=new URLSearchParams(String(path).split('?')[1]||'');
  return query.get('today')==='1'?20000:120000;
}
async function fetchPortalSalesSnapshot(path,{force=false}={}){
  if(!/^\/api\/portal\/sales\?/.test(path))return api(path);
  const requestToken=token;
  const key=requestToken+'\n'+path;
  const current=mlshSalesSnapshots.get(key);
  if(!force&&current){
    if(current.promise)return current.promise;
    if(current.data&&Date.now()<current.expiresAt)return current.data;
  }
  // Uma atualização manual realmente cria uma nova consulta, mesmo com cache existente.
  const generation=mlshSalesCacheGeneration;
  const promise=api(path);
  const entry={promise,data:null,expiresAt:0};
  mlshSalesSnapshots.set(key,entry);
  try{
    const data=await promise;
    if(token===requestToken&&generation===mlshSalesCacheGeneration&&mlshSalesSnapshots.get(key)===entry){
      // Falhas parciais das lojas não devem permanecer em cache.
      const stores=Array.isArray(data?.stores)?data.stores:[];
      const partial=stores.some(store=>store.error||store.connected===false);
      if(partial)mlshSalesSnapshots.delete(key);
      else {entry.data=data;entry.promise=null;entry.expiresAt=Date.now()+salesSnapshotTtl(path);}
    }
    return data;
  }catch(error){
    if(mlshSalesSnapshots.get(key)===entry)mlshSalesSnapshots.delete(key);
    throw error;
  }
}
