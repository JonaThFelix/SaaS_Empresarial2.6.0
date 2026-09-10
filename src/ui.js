'use strict';
const {esc,money,dateBR,dateTimeBR,can,MODULES}=require('./core');
const MENU=[
 ['dashboard','/','⌂','Dashboard'],['clients','/clientes','◫','Clientes'],['employees','/colaboradores','♙','Colaboradores'],['schedules','/escalas','▤','Escalas'],
 ['finance','/financeiro','R$','Financeiro'],['reconciliation','/conciliacao','⇄','Conciliação'],['inventory','/estoque','▦','Estoque'],
 ['assets','/patrimonio','◆','Patrimônio'],['uniforms','/uniformes','♜','Uniformes'],['tickets','/chamados','☏','Chamados'],
 ['reports','/relatorios','▥','Relatórios'],['audit','/auditoria','◎','Auditoria'],['users','/usuarios','♟','Usuários'],['settings','/configuracoes','⚙','Configurações']
];

// Ajuda contextual centralizada. Ela aparece somente nos campos que podem gerar
// dúvida operacional; campos autoexplicativos (nome, telefone etc.) ficam limpos.
const HELP_BY_NAME={
  competence_date:'Competência é o período ao qual a receita ou despesa pertence. Não é, necessariamente, a data de vencimento ou de pagamento.',
  due_date:'Informe a data limite prevista para pagamento ou recebimento.',
  movement_date:'Informe a data em que a operação realmente ocorreu. No financeiro, é a data em que o dinheiro entrou ou saiu da conta.',
  tx_date:'Data que aparece no extrato bancário para esta movimentação.',
  bank_account_id:'Escolha a conta bancária efetivamente envolvida. Essa informação é usada na conciliação por banco.',
  opening_balance:'Saldo existente na conta na data em que ela começou a ser controlada pela Central.',
  entry_id:'Use quando ainda não existe uma baixa: escolha o lançamento em aberto que corresponde à linha do extrato.',
  payment_id:'Use quando a baixa já foi registrada no Financeiro e você quer ligá-la à linha correspondente do extrato.',
  payment_method:'Informe como a movimentação ocorreu, por exemplo PIX, TED, boleto, cartão, dinheiro ou débito automático.',
  document_number:'Número que ajuda a rastrear a operação: NF, boleto, comprovante, documento bancário ou referência interna.',
  renewal_status:'Use “Aguardando renovação” enquanto a decisão não estiver concluída. Ao renovar pelo botão próprio, a versão antiga é preservada no histórico.',
  uniform_exchange_days:'Quantidade padrão de dias entre uma entrega de fardamento e a próxima troca prevista naquele contrato.',
  headcount:'Quantidade de profissionais que o posto precisa ter no dimensionamento. A escala compara esse número com as pessoas efetivamente alocadas.',
  work_pattern:'Regra usada para projetar os dias de trabalho do colaborador, como 12x36, 24x72, 6x1 ou 5x2.',
  day_parity:'Para 12x36, informe PAR ou ÍMPAR quando a operação segue o número do dia do mês. Se usar ciclo real, deixe automático e informe a data-base do ciclo.',
  cycle_anchor_date:'Primeiro dia conhecido do ciclo do colaborador. A Central usa essa data como referência para projetar os próximos plantões.',
  allocation_role:'Informe o papel operacional nesta alocação: titular, ferista, reserva, rendição ou cobertura.',
  relief_employee_id:'Colaborador normalmente previsto para render/cobrir este titular em férias, folgas ou ausências.',
  covers_employee_id:'Use para indicar de quem este colaborador é rendição ou cobertura habitual.',
  shift_regime:'Descreva a escala ou detalhes complementares que não estejam representados apenas pelo ciclo selecionado.',
  schedule_details:'Informe horário, intervalo ou regra operacional relevante para entender o funcionamento do posto.',
  absence_type:'Escolha o motivo da indisponibilidade. O período informado será considerado automaticamente na escala.',
  absence_id:'Vincule à ausência/férias que originou a necessidade de substituição, quando houver.',
  substitute_employee_id:'Pessoa que efetivamente assumirá o posto durante o período de substituição.',
  replacement_type:'Indique por que a substituição existe, por exemplo férias, afastamento, rendição ou cobertura emergencial.',
  current_stock:'Quantidade física disponível antes de iniciar as movimentações deste item na Central.',
  minimum_stock:'Quando o saldo chegar ou ficar abaixo deste número, o item deve ser tratado como ponto de reposição.',
  movement_type:'Escolha o fato real ocorrido. Entradas aumentam o saldo; saídas/entregas diminuem; devoluções retornam material ao estoque.',
  quantity:'Informe a quantidade referente apenas a esta operação, não o saldo total do item.',
  sku:'Código interno usado para identificar o item de forma única, se sua empresa utilizar catálogo/SKU.',
  patrimony_code:'Etiqueta ou número patrimonial único usado pela empresa para rastrear este bem.',
  serial_number:'Número de série fornecido pelo fabricante, quando existir.',
  allocated_at:'Data em que o bem/material saiu da guarda do estoque e passou para o colaborador, cliente ou posto informado.',
  returned_at:'Data em que o item voltou fisicamente para a empresa ou deixou de ficar sob responsabilidade do destinatário.',
  condition_out:'Registre o estado físico no momento da entrega, para comparação quando houver devolução.',
  condition_return:'Registre o estado físico em que o item retornou. Isso ajuda a apurar dano, perda ou necessidade de manutenção.',
  next_exchange_date:'Data prevista para a próxima substituição da peça. Quando aplicável, a Central pode calculá-la a partir do prazo do contrato.',
  reajust_index:'Regra prevista no contrato para atualização de preço, por exemplo IPCA, CCT, repactuação por planilha de custos ou percentual negociado.',
  cct_name:'Identifique a Convenção/Acordo Coletivo ou instrumento que fundamenta a repactuação.',
  cct_reference:'Número, ano ou referência que permita localizar exatamente o instrumento coletivo utilizado.',
  cct_base_date:'Data-base da categoria utilizada como marco para reajuste dos componentes vinculados à CCT.',
  financial_effective_date:'Data a partir da qual o novo valor produz efeito financeiro, inclusive para cálculo de diferenças retroativas.',
  retroactive_until_date:'Data final até a qual a Central calculará a diferença retroativa entre o valor antigo e o novo.',
  signed_date:'Data em que o reajuste/aditivo foi formalmente aprovado ou assinado. Pode ser diferente da data de efeito financeiro.',
  base_monthly_value:'Valor mensal que vigorava antes do reajuste/repactuação e que será usado como base da comparação.',
  new_monthly_value:'Novo valor mensal aprovado ou proposto após o reajuste/repactuação.',
  retroactive_amount_final:'Valor retroativo que será efetivamente considerado/cobrado. A Central sugere um cálculo, mas este campo permanece editável.',
  measurement_value_final:'Valor final da medição/faturamento mensal após o reajuste. Pode ser ajustado conforme a medição real do período.',
  calculation_notes:'Registre premissas, percentuais, parcelas, CCT, memória de cálculo ou justificativa que permita reconstruir o valor no futuro.',
  expiration_date:'Data em que o documento deixa de ser válido, quando houver. É usada para gerar alertas de vencimento.',
  reference_date:'Data principal do documento, como assinatura, emissão, assembleia ou vigência, conforme o tipo de anexo.',
  document_type:'Classifique o arquivo para facilitar pesquisa e alertas: contrato, aditivo, apólice, ata, CCT etc.',
  cnpj_lookup_source:'Fonte usada na última consulta automática do CNPJ.',
  cnpj_lookup_at:'Data e hora da última consulta automática dos dados cadastrais.',
  active:'Desativar preserva o histórico e impede uso futuro do cadastro sem destruí-lo.',
  closed_at:'Data em que o contrato, posto ou registro deixou de estar operacionalmente ativo.',
  closure_reason:'Explique por que foi encerrado/desativado. Essa informação permanece no histórico e na auditoria.'
};
const HELP_BY_LABEL=[
  [/retroativo/i,'Valor referente à diferença de preço de períodos anteriores. Confira a data de efeito financeiro e a regra contratual antes de confirmar.'],
  [/medição/i,'Valor que será usado como referência de faturamento/medição. Ajuste quando a medição real do mês for diferente do valor mensal cheio.'],
  [/data-base/i,'Marco temporal utilizado pela regra informada. Em CCT, normalmente corresponde à data-base da categoria.'],
  [/rende \/ cobre/i,'Informe o titular ou profissional que esta pessoa costuma substituir/render.'],
  [/ferista \/ reserva/i,'Informe a pessoa prevista como primeira opção de cobertura desta alocação.'],
  [/par \/ ímpar/i,'Usado principalmente em 12x36 para definir se o plantão ocorre nos dias pares ou ímpares do calendário.'],
  [/saldo inicial/i,'Informe o saldo existente antes da primeira movimentação que será registrada na Central.'],
  [/competência/i,'Período contábil/gerencial ao qual o lançamento pertence; pode ser diferente da data de pagamento.'],
  [/efeito financeiro/i,'Data a partir da qual o novo preço passa a gerar diferença financeira.'],
  [/prazo de troca/i,'Número de dias usado para projetar quando o colaborador deverá receber nova peça.']
];
function helpFor(name,label,opts={}){
  if(opts.help===false)return'';
  if(opts.help)return String(opts.help);
  if(HELP_BY_NAME[name])return HELP_BY_NAME[name];
  const found=HELP_BY_LABEL.find(([re])=>re.test(String(label||'')));
  return found?found[1]:'';
}
function helpHtml(name,label,opts={}){const h=helpFor(name,label,opts);return h?`<small class="field-help"><span class="help-dot">i</span>${esc(h)}</small>`:'';}
function csrf(ctx){return `<input type="hidden" name="_csrf" value="${esc(ctx?.session?.csrf_token||'')}">`;}
function layout(ctx,title,content,current='/',opts={}){
 const nav=MENU.filter(([m])=>can(ctx,m,'view')).map(([m,href,ic,label])=>`<a class="nav-item ${current===href||current.startsWith(href+'/')?'active':''}" href="${href}"><span class="nav-ic">${ic}</span><span>${label}</span></a>`).join('');
 const msg=opts.msg?`<div class="alert ${opts.mt==='err'?'danger':opts.mt==='warn'?'warn':'ok'}">${esc(opts.msg)}</div>`:'';
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)} · Central de Gestão</title><link rel="stylesheet" href="/app.css"></head><body>
 <div class="app-shell"><aside class="sidebar" id="sidebar"><div class="brand"><div class="brand-mark">CG</div><div><b>Central de Gestão</b><small>${esc(ctx.user.organization_name)}</small></div></div><nav>${nav}</nav><div class="sidebar-foot"><div class="avatar">${esc((ctx.user.name||'U').slice(0,1).toUpperCase())}</div><div class="who"><b>${esc(ctx.user.name)}</b><small>${esc(ctx.user.role)}</small></div><a class="logout" href="/logout" title="Sair">↪</a></div></aside>
 <main class="main"><header class="topbar"><button class="menu-btn" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button><div><h1>${esc(title)}</h1>${opts.subtitle?`<p>${esc(opts.subtitle)}</p>`:''}</div><div class="top-actions">${opts.actions||''}</div></header><div class="content">${msg}${content}</div></main></div><script src="/app.js"></script></body></html>`;
}
function loginPage(msg='') {return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login · Central de Gestão</title><link rel="stylesheet" href="/app.css"></head><body class="login-bg"><main class="login-card"><div class="login-logo">CG</div><h1>Central de Gestão Empresarial</h1><p class="muted">Acesso seguro ao ambiente de gestão.</p>${msg?`<div class="alert danger">${esc(msg)}</div>`:''}<form method="post" action="/login"><label>CPF ou ID de acesso</label><input name="cpf" autocomplete="username" placeholder="Ex.: 123.456.789-00 ou financeiro01" required autofocus><label>Senha</label><input type="password" name="password" autocomplete="current-password" required><button class="btn primary full" type="submit">Entrar</button></form><small class="login-help">O administrador define quais módulos cada usuário pode acessar.</small></main></body></html>`;}
function card(title,value,sub='',cls=''){return `<div class="kpi ${cls}"><span>${esc(title)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;}
function table(headers,rows,empty='Nenhum registro encontrado.'){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;}
function input(name,label,value='',opts={}){const type=opts.type||'text';const req=opts.required?'required':'';const min=opts.min!==undefined?`min="${opts.min}"`:'';const max=opts.max!==undefined?`max="${opts.max}"`:'';const step=opts.step?`step="${opts.step}"`:'';const ph=opts.placeholder?`placeholder="${esc(opts.placeholder)}"`:'';const h=helpFor(name,label,opts);const title=h?`title="${esc(h)}"`:'';return `<label class="field"><span>${esc(label)}${opts.required?' *':''}${h?` <span class="field-help-icon" title="${esc(h)}">?</span>`:''}</span><input type="${type}" name="${esc(name)}" value="${esc(value??'')}" ${req} ${min} ${max} ${step} ${ph} ${title}>${helpHtml(name,label,opts)}</label>`;}
function textarea(name,label,value='',opts={}){const h=helpFor(name,label,opts);return `<label class="field span2"><span>${esc(label)}${h?` <span class="field-help-icon" title="${esc(h)}">?</span>`:''}</span><textarea name="${esc(name)}" rows="${opts.rows||3}" ${h?`title="${esc(h)}"`:''}>${esc(value??'')}</textarea>${helpHtml(name,label,opts)}</label>`;}
function select(name,label,value,items,opts={}){const h=helpFor(name,label,opts);return `<label class="field"><span>${esc(label)}${opts.required?' *':''}${h?` <span class="field-help-icon" title="${esc(h)}">?</span>`:''}</span><select name="${esc(name)}" ${opts.required?'required':''} ${h?`title="${esc(h)}"`:''}>${opts.blank===false?'':`<option value="">${esc(opts.blankLabel||'Selecione')}</option>`}${items.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(value??'')?'selected':''}>${esc(l)}</option>`).join('')}</select>${helpHtml(name,label,opts)}</label>`;}
function check(name,label,checked=false,opts={}){return `<label class="check"><input type="checkbox" name="${esc(name)}" value="1" ${checked?'checked':''}><span>${esc(label)}</span>${helpHtml(name,label,opts)}</label>`;}
function badge(text,cls=''){return `<span class="badge ${cls}">${esc(text)}</span>`;}
function panel(title,body,actions=''){return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>${actions}</div>${body}</section>`;}
function collapsible(title,body,opts={}){const count=opts.count!==undefined?`<span class="collapse-count">${esc(opts.count)}</span>`:'';const actions=opts.actions?`<div class="collapse-actions">${opts.actions}</div>`:'';return `<details class="panel collapsible-panel" ${opts.open?'open':''}><summary><div class="collapse-title"><span class="collapse-chevron">›</span><h2>${esc(title)}</h2>${count}</div><span class="collapse-hint">Clique para mostrar/recolher</span></summary>${actions}<div class="collapse-body">${body}</div></details>`;}
function formGrid(body,buttons=''){return `<div class="form-grid">${body}</div>${buttons?`<div class="form-actions">${buttons}</div>`:''}`;}
module.exports={layout,loginPage,csrf,card,table,input,textarea,select,check,badge,panel,collapsible,formGrid,helpFor,helpHtml,money,dateBR,dateTimeBR};
