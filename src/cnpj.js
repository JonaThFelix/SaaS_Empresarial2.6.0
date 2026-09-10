'use strict';

let serproToken={value:'',expiresAt:0};

function cleanCNPJ(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,14);}
function cnpjShapeOk(v){const s=cleanCNPJ(v);return /^[A-Z0-9]{12}[0-9]{2}$/.test(s);}
function charValue(ch){return ch.charCodeAt(0)-48;}
function calcDV(base){
  const weights=base.length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
  const sum=[...base].reduce((acc,ch,i)=>acc+charValue(ch)*weights[i],0);
  const rem=sum%11;
  return rem<2?0:11-rem;
}
function validCNPJ(v){
  const s=cleanCNPJ(v);if(!cnpjShapeOk(s))return false;
  if(/^([0-9])\1{13}$/.test(s))return false;
  const d1=calcDV(s.slice(0,12));const d2=calcDV(s.slice(0,12)+d1);
  return s.slice(-2)===`${d1}${d2}`;
}
function fetchWithTimeout(url,opts={},timeoutMs=10000){
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  return fetch(url,{...opts,signal:ctrl.signal}).finally(()=>clearTimeout(timer));
}
async function jsonOrError(resp){
  let body=null;try{body=await resp.json()}catch{}
  if(!resp.ok){const msg=body?.message||body?.mensagem||body?.error_description||body?.error||`HTTP ${resp.status}`;const e=new Error(String(msg));e.status=resp.status;throw e;}
  return body||{};
}
async function serproAccessToken(){
  const key=String(process.env.SERPRO_CNPJ_CONSUMER_KEY||'').trim();const secret=String(process.env.SERPRO_CNPJ_CONSUMER_SECRET||'').trim();
  if(!key||!secret)return null;
  if(serproToken.value&&Date.now()<serproToken.expiresAt-60000)return serproToken.value;
  const auth=Buffer.from(`${key}:${secret}`,'utf8').toString('base64');
  const resp=await fetchWithTimeout('https://gateway.apiserpro.serpro.gov.br/token',{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:'grant_type=client_credentials'},12000);
  const data=await jsonOrError(resp);if(!data.access_token)throw new Error('SERPRO não retornou token de acesso.');
  serproToken={value:data.access_token,expiresAt:Date.now()+Number(data.expires_in||3300)*1000};return serproToken.value;
}
function statusTextFromSerpro(s){
  const code=String(s?.codigo??'');const map={'1':'ATIVA','2':'SUSPENSA','3':'INAPTA','4':'BAIXADA','8':'BAIXADA','9':'NULA'};return map[code]||s?.descricao||s?.motivo||code||'';
}
function normalizeSerpro(d,cnpj){
  const e=d.endereco||{};const mun=typeof e.municipio==='object'?e.municipio?.descricao:e.municipio;const phones=Array.isArray(d.telefones)?d.telefones:Array.isArray(d.telefone)?d.telefone:[];const phone=phones[0]?`${phones[0].ddd||''}${phones[0].numero||''}`:'';
  return {cnpj:cleanCNPJ(d.ni||d.cnpj||cnpj),legal_name:d.nome_empresarial||d.nomeEmpresarial||'',trade_name:d.nome_fantasia||d.nomeFantasia||'',status:statusTextFromSerpro(d.situacao_cadastral||d.situacaoCadastral),status_date:d.situacao_cadastral?.data||d.situacaoCadastral?.data||'',opening_date:d.data_abertura||d.dataAbertura||'',cnae_code:d.cnae_principal?.codigo||d.cnaePrincipal?.codigo||'',cnae_description:d.cnae_principal?.descricao||d.cnaePrincipal?.descricao||'',legal_nature:d.natureza_juridica?.descricao||d.naturezaJuridica?.descricao||'',address:[e.tipoLogradouro,e.logradouro].filter(Boolean).join(' ').trim()||e.logradouro||'',address_number:e.numero||'',complement:e.complemento||'',neighborhood:e.bairro||'',zip_code:String(e.cep||'').replace(/\D/g,''),city:mun||'',state:e.uf||'',email:d.correio_eletronico||d.correioEletronico||'',phone,capital_social:(Number(d.capital_social??d.capitalSocial??0)||0)/100,source:'SERPRO / Receita Federal',official:true};
}
function normalizeBrasilAPI(d,cnpj){
  return {cnpj:cleanCNPJ(d.cnpj||cnpj),legal_name:d.razao_social||d.nome_empresarial||'',trade_name:d.nome_fantasia||'',status:d.descricao_situacao_cadastral||String(d.situacao_cadastral||''),status_date:d.data_situacao_cadastral||'',opening_date:d.data_inicio_atividade||'',cnae_code:String(d.cnae_fiscal||''),cnae_description:d.cnae_fiscal_descricao||'',legal_nature:d.natureza_juridica||'',address:[d.descricao_tipo_de_logradouro,d.logradouro].filter(Boolean).join(' ').trim()||d.logradouro||'',address_number:d.numero||'',complement:d.complemento||'',neighborhood:d.bairro||'',zip_code:String(d.cep||'').replace(/\D/g,''),city:d.municipio||'',state:d.uf||'',email:d.email||'',phone:d.ddd_telefone_1||d.ddd_telefone_2||'',capital_social:Number(d.capital_social||0)||0,source:'BrasilAPI / dados públicos da Receita Federal',official:false};
}
async function lookupCNPJ(v){
  const cnpj=cleanCNPJ(v);if(!cnpjShapeOk(cnpj))throw new Error('CNPJ deve ter 14 posições; as 12 primeiras podem ter letras/números e as 2 últimas devem ser dígitos.');if(!validCNPJ(cnpj))throw new Error('CNPJ inválido: os dígitos verificadores não conferem.');
  const key=String(process.env.SERPRO_CNPJ_CONSUMER_KEY||'').trim();const secret=String(process.env.SERPRO_CNPJ_CONSUMER_SECRET||'').trim();
  if(key&&secret){
    const token=await serproAccessToken();const base=String(process.env.SERPRO_CNPJ_BASE_URL||'https://gateway.apiserpro.serpro.gov.br/consulta-cnpj-df/v2/basica').replace(/\/$/,'');
    const data=await jsonOrError(await fetchWithTimeout(`${base}/${encodeURIComponent(cnpj)}`,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`}},12000));return normalizeSerpro(data,cnpj);
  }
  const data=await jsonOrError(await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`,{headers:{Accept:'application/json','User-Agent':'CentralGestao/2.1'}},12000));return normalizeBrasilAPI(data,cnpj);
}
module.exports={cleanCNPJ,cnpjShapeOk,validCNPJ,lookupCNPJ,calcDV};
