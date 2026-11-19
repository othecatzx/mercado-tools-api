/* Saúde das integrações dentro das Configurações do portal. Sem ações de copiar. */
window.mlshIntegrationHealth = (() => {
  const markup=()=>
    '<section class="panel mlsh-integrations-health" id="mlshIntegrationsHealth" aria-label="Saúde das integrações">'+
      '<div class="panel-head"><div><div class="eyebrow">SISTEMA</div><h3>Saúde das integrações</h3><p class="small muted">Consulte o estado do portal e as integrações cadastradas.</p></div>'+
      '<button type="button" class="btn btn-primary" id="mlshIntegrationsRefresh">Verificar agora</button></div>'+
      '<div class="mlsh-health-items">'+
      '<div class="mlsh-health-item"><strong>Portal e API</strong><span data-hl="api">Não verificado</span></div>'+
      '<div class="mlsh-health-item"><strong>Mercado Livre</strong><span data-hl="ml">Não verificado</span></div>'+
      '<div class="mlsh-health-item"><strong>Bling</strong><span data-hl="bling">Não verificado</span></div>'+
      '<div class="mlsh-health-item"><strong>Shopee</strong><span data-hl="shopee">Não monitorado</span></div>'+
      '</div>'+
      '<p class="small muted" id="mlshHealthTime" aria-live="polite">Ainda não verificado.</p>'+
      '<p class="small muted">Contas cadastradas não significam tokens válidos. O diagnóstico técnico está disponível apenas em /admin.</p>'+
    '</section>';
  function init({api,dashboard}){
    const root=document.getElementById("mlshIntegrationsHealth");
    if(!root)return;
    const put=(key,text,kind)=>{
      const el=root.querySelector('[data-hl="'+key+'"]');
      if(el){el.textContent=text;el.dataset.state=kind||"neutral";}
    };
    const button=root.querySelector("#mlshIntegrationsRefresh");
    let running=false;
    button.addEventListener("click",async()=>{
      if(running)return;
      running=true;button.disabled=true;button.textContent="Verificando...";
      put("api","Consultando...");
      put("ml","Consultando...");
      put("bling","Consultando...");
      try{
        // Reutilizar autenticação e controle de sessão existentes no portal.
        const [result,db]=await Promise.all([
          api("/api/portal/me"),
          api("/api/portal/dashboard")
        ]);
        if(!root.isConnected)return;
        put("api",result?.user&&db?.ok?"Respondendo":"Não verificado",result?.user&&db?.ok?"ok":"neutral");
        // O dashboard informa apenas se existe conta ML vinculada, NÃO valida token.
        put("ml",db.ml_connected===true?"Conta vinculada":db.ml_connected===false?"Sem conta vinculada":"Não verificado",
          db.ml_connected===true?"ok":"neutral");
      }catch{
        if(root.isConnected){put("api","Falha de conexão","error");put("ml","Não verificado");}
      }
      try{
        const data=await api("/api/portal/bling/connections");
        if(!root.isConnected)return;
        const connections=Array.isArray(data?.connections)?data.connections:null;
        put("bling",connections?connections.length+" conexão(ões) cadastrada(s)":"Não verificado",
          connections?"ok":"neutral");
      }catch{
        if(root.isConnected)put("bling","Não verificado");
      }finally{
        if(root.isConnected){
          root.querySelector("#mlshHealthTime").textContent="Última consulta: "+new Date().toLocaleString("pt-BR");
          button.textContent="Verificar novamente";button.disabled=false;
        }
        running=false;
      }
    });
  }
  return {markup,init};
})();