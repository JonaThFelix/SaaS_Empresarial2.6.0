(()=>{
  document.addEventListener('click',e=>{
    const a=e.target.closest('[data-confirm]');
    if(a&&!confirm(a.dataset.confirm||'Confirmar operação?'))e.preventDefault();
  });

  document.querySelectorAll('[data-money]').forEach(el=>el.addEventListener('blur',()=>{
    el.value=el.value.replace(/[^0-9,.-]/g,'');
  }));

  const form=document.querySelector('.client-form');
  if(!form)return;

  const doc=form.querySelector('[name="document"]');
  const btn=form.querySelector('[data-cnpj-lookup]');
  const status=form.querySelector('[data-cnpj-status]');
  if(!doc||!btn||!status)return;

  let lastLookup='';
  let timer=null;
  const clean=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,14);
  const setStatus=(text,kind='')=>{
    status.textContent=text||'';
    status.className=`cnpj-status ${kind||'muted'}`;
  };
  const field=name=>form.querySelector(`[name="${name}"]`);
  const set=(name,value)=>{
    const el=field(name);
    if(!el||value===undefined||value===null||value==='')return;
    el.value=String(value);
  };
  const dateISO=v=>{
    if(!v)return '';
    const s=String(v).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
    const m=s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if(m)return `${m[3]}-${m[2]}-${m[1]}`;
    const d=new Date(s);
    return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
  };
  const fill=d=>{
    set('document',d.cnpj);
    set('legal_name',d.legal_name);
    set('trade_name',d.trade_name);
    set('email',d.email);
    set('phone',d.phone);
    set('address',d.address);
    set('address_number',d.address_number);
    set('complement',d.complement);
    set('neighborhood',d.neighborhood);
    set('zip_code',d.zip_code);
    set('city',d.city);
    set('state',d.state);
    set('cnpj_status',d.status);
    set('cnpj_status_date',dateISO(d.status_date));
    set('opening_date',dateISO(d.opening_date));
    set('cnae_code',d.cnae_code);
    set('cnae_description',d.cnae_description);
    set('legal_nature',d.legal_nature);
    set('capital_social',Number(d.capital_social||0).toFixed(2));
    set('cnpj_lookup_source',d.source||'');
    set('cnpj_lookup_at',new Date().toISOString());
  };
  async function lookup(force=false){
    const cnpj=clean(doc.value);
    if(cnpj.length!==14){
      if(force)setStatus('Informe um CNPJ completo com 14 posições.','err');
      return;
    }
    if(!force&&cnpj===lastLookup)return;
    lastLookup=cnpj;
    btn.disabled=true;
    setStatus('Validando e consultando o CNPJ...','loading');
    try{
      const resp=await fetch(`/api/cnpj/${encodeURIComponent(cnpj)}`,{headers:{Accept:'application/json'},credentials:'same-origin'});
      const body=await resp.json().catch(()=>({}));
      if(!resp.ok||!body.ok)throw new Error(body.error||`Consulta indisponível (HTTP ${resp.status}).`);
      fill(body.data||{});
      const source=body.data?.source||'fonte cadastral';
      const cadastral=String(body.data?.status||'').trim();
      const active=/ATIVA/i.test(cadastral);
      setStatus(`Dados preenchidos automaticamente · ${source}${cadastral?` · Situação: ${cadastral}`:''}`,cadastral&&!active?'warn':'ok');
    }catch(err){
      lastLookup='';
      setStatus(err?.message||'Não foi possível consultar o CNPJ. Você ainda pode preencher os dados manualmente.','err');
    }finally{
      btn.disabled=false;
    }
  }

  btn.addEventListener('click',()=>lookup(true));
  doc.addEventListener('blur',()=>lookup(false));
  doc.addEventListener('paste',()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>lookup(false),120);
  });
  doc.addEventListener('input',()=>{
    const c=clean(doc.value);
    if(c.length===14){
      clearTimeout(timer);
      timer=setTimeout(()=>lookup(false),500);
    }else{
      lastLookup='';
      setStatus('');
    }
  });
})();
