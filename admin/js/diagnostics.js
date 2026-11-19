/* Diagnósticos administrativos, somente leitura. */
const adminDiagnosticsPage = (() => {
  const cards=[
    ["api","API","Conferência da disponibilidade do backend"],
    ["database","Banco de dados","Consulta de leitura ao banco de dados"],
    ["mercadolivre","Mercado Livre","Contas cadastradas, sem validar tokens"],
    ["bling","Bling","Conexões cadastradas, sem validar tokens"],
    ["devices","Dispositivos","Dispositivos registrados no banco"],
    ["shopee","Shopee","Não existe verificação de conexão implementada"],
    ["websocket","WebSocket","Não há consulta individual de conexão disponível"]
  ];
  function render(){
    const content=document.getElementById("content");
    if(!content)return;
    const cardMarkup=cards.map(c=>
      '<article class="diag-card">'+
      '<div class="diag-card-top"><h3>'+c[1]+'</h3><span class="diag-tag" data-diag-status="'+c[0]+'">Não verificado</span></div>'+
      '<div class="diag-main" data-diag-value="'+c[0]+'">Aguardando consulta</div>'+
      '<p class="diag-info">'+c[2]+'</p></article>').join("");
    content.innerHTML='<section id="adminDiagnostics">'+
      '<div class="diag-header"><div><div class="diag-kicker">ML SH SUPPORT · ADMINISTRADOR</div>'+
      '<h2>Diagnóstico do sistema</h2><p class="diag-subtitle">Saúde das integrações e serviços, somente leitura. Sem exportação ou cópia de dados.</p></div>'+
      '<button type="button" id="adminDiagRefresh" class="diag-button">Verificar agora</button></div>'+
      '<div class="diag-notice">A consulta verifica API, banco e registros de integrações. <strong>Conta cadastrada não significa token válido ou sincronização funcionando.</strong> Nenhum segredo é exibido.</div>'+
      '<div class="diag-grid">'+cardMarkup+'</div>'+
      '<div class="diag-footer"><strong>Última verificação:</strong> <span id="adminDiagTime">Nunca</span>'+
      '<div class="diag-message" id="adminDiagMessage" role="status" aria-live="polite" style="margin-top:7px">Clique em Verificar agora. Não há consultas automáticas.</div></div></section>';
    content.querySelector("#adminDiagRefresh").addEventListener("click",check);
    check();
  }
  function put(id,value,label,state){
    const root=document.getElementById("adminDiagnostics");
    if(!root)return;
    const v=root.querySelector('[data-diag-value="'+id+'"]');
    const s=root.querySelector('[data-diag-status="'+id+'"]');
    if(v)v.textContent=String(value);
    if(s){s.textContent=label;s.dataset.state=state||"unknown";}
  }
  async function check(){
    const root=document.getElementById("adminDiagnostics");
    if(!root)return;
    const button=root.querySelector("#adminDiagRefresh");
    if(button.disabled)return;
    button.disabled=true;button.textContent="Verificando...";
    root.querySelector("#adminDiagMessage").textContent="Consultando informações do servidor...";
    delete root.querySelector("#adminDiagMessage").dataset.error;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const res=await apiFetch("/api/admin/diagnostics",{signal:controller.signal});
      if(!res)return;
      if(!res.ok)throw new Error("Falha HTTP "+res.status);
      const data=await res.json();
      if(!data.ok)throw new Error("Falha na resposta");
      const ok=value=>value?.status==="ok";
      put("api",ok(data.api)?"Respondendo":"Indisponível",ok(data.api)?"Normal":"Atenção",ok(data.api)?"ok":"error");
      put("database",ok(data.database)?"Consulta OK":"Falha na consulta",ok(data.database)?"Normal":"Atenção",ok(data.database)?"ok":"error");
      const account=(item,label)=>{
        if(!item||item.status!=="ok")return ["Indisponível","Atenção","error"];
        return [String(item.registeredAccounts??0)+" "+label,"Cadastradas","unknown"];
      };
      put("mercadolivre",...account(data.integrations?.mercadolivre,"conta(s)"));
      put("bling",...account(data.integrations?.bling,"conexão(ões)"));
      const devices=data.devices;
      put("devices",ok(devices)?String(devices.registered??0)+" registrado(s)":"Indisponível",
        ok(devices)?"Consultado":"Atenção",ok(devices)?"ok":"error");
      put("shopee","Não monitorado","Não verificado","unknown");
      put("websocket","Não monitorado","Não verificado","unknown");
      const last=root.querySelector("#adminDiagTime");
      if(last)last.textContent=data.checkedAt?new Date(data.checkedAt).toLocaleString("pt-BR"):"Agora";
      root.querySelector("#adminDiagMessage").textContent="Consulta concluída. Registros cadastrados não comprovam tokens válidos.";
    }catch(error){
      if(document.getElementById("adminDiagnostics")){
        const msg=root.querySelector("#adminDiagMessage");
        msg.textContent=error.name==="AbortError"?"Tempo limite da consulta excedido.":"Não foi possível completar a consulta.";
        msg.dataset.error="true";
      }
    }finally{
      clearTimeout(timeout);
      if(document.getElementById("adminDiagnostics")){
        button.disabled=false;button.textContent="Verificar novamente";
      }
    }
  }
  return {render};
})();