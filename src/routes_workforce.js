'use strict';
const {run,get,all,id,now,transaction}=require('./db');
const C=require('./core');
const U=require('./ui');
const S=require('./schedule');

const WORK_PATTERNS=[['12X36','12x36'],['24X72','24x72'],['6X1','6x1'],['5X2','5x2 (segunda a sexta)'],['DAILY','Diário'],['CUSTOM','Personalizado / conforme observação']];
const PARITIES=[['NONE','Não se aplica'],['EVEN','Par'],['ODD','Ímpar']];
const SHIFT_PERIODS=[['DAY','Diurno / dia'],['NIGHT','Noturno / noite'],['OTHER','Outro / 24h / personalizado']];
const ALLOCATION_ROLES=[['TITULAR','Titular'],['FERISTA','Ferista'],['RESERVE','Reserva'],['RELIEF','Rendição'],['COVERAGE','Cobertura']];
const ABSENCE_TYPES=[['VACATION','Férias'],['LEAVE','Afastamento'],['MEDICAL','Atestado / licença médica'],['TRAINING','Treinamento'],['OTHER','Outra indisponibilidade']];
const REPLACEMENT_TYPES=[['VACATION','Cobertura de férias'],['LEAVE','Cobertura de afastamento'],['MEDICAL','Cobertura médica'],['RELIEF','Rendição'],['FERISTA','Ferista'],['COVERAGE','Cobertura operacional']];

function suggestContractNumber(value,nextVersion){
  const v=String(value||'').trim();
  const m=v.match(/^(.*?)(\d+)$/);
  if(m)return `${m[1]}${Number(m[2])+1}`;
  return v?`${v}-R${nextVersion}`:`VERSAO-${nextVersion}`;
}
function optionsEmployees(o,exclude=''){
  return all(`SELECT id,name,role_name,status FROM employees WHERE organization_id=:o AND id<>:x ORDER BY status='ACTIVE' DESC,name`,{o,x:exclude||'__none__'}).map(e=>[e.id,`${e.name}${e.role_name?' · '+e.role_name:''}${e.status!=='ACTIVE'?` · ${e.status}`:''}`]);
}
function allocationFields(ctx,c,a={},o){
  const posts=all('SELECT id,post_name FROM contract_posts WHERE contract_id=:c AND organization_id=:o ORDER BY active DESC,post_name',{c:c.id,o}).map(x=>[x.id,x.post_name]);
  const employees=optionsEmployees(o,a.employee_id||'');
  return U.select('post_id','Posto',a.post_id||'',posts)+
    U.select('allocation_role','Tipo de alocação',a.allocation_role||'TITULAR',ALLOCATION_ROLES,{blank:false})+
    U.select('work_pattern','Regime / ciclo',a.work_pattern||a.shift_regime||'12X36',WORK_PATTERNS,{blank:false,help:'Escolha a jornada/ciclo. No 12x36, informe também obrigatoriamente a paridade e se o plantão é diurno ou noturno.'})+
    U.select('shift_period','Turno operacional',a.shift_period||S.inferShiftPeriod(a)||'DAY',SHIFT_PERIODS,{blank:false,help:'Define em qual equipe o colaborador aparecerá na escala: Diurno/Dia, Noturno/Noite ou Outro. Em 12x36 isso forma Dia Par, Dia Ímpar, Noite Par ou Noite Ímpar.'})+
    U.select('day_parity','Paridade do plantão',a.day_parity||'NONE',PARITIES,{blank:false,help:'No 12x36 escolha obrigatoriamente Par ou Ímpar. A combinação com o turno gera: Dia Par, Dia Ímpar, Noite Par ou Noite Ímpar.'})+
    U.input('cycle_anchor_date','Data-base do ciclo',a.cycle_anchor_date||a.start_date||'',{type:'date'})+
    U.input('shift_start','Início do turno',a.shift_start||'',{type:'time',help:'Horário real de entrada. Ex.: 07:00 no diurno ou 19:00 no noturno.'})+
    U.input('shift_end','Fim do turno',a.shift_end||'',{type:'time'})+
    U.input('shift_regime','Descrição complementar da escala',a.shift_regime||'')+
    U.select('relief_employee_id','Ferista / reserva padrão',a.relief_employee_id||'',employees,{blankLabel:'Nenhum'})+
    U.select('covers_employee_id','Rende / cobre normalmente quem?',a.covers_employee_id||'',employees,{blankLabel:'Ninguém específico'})+
    U.input('start_date','Início da alocação',a.start_date||C.localDate(),{type:'date',required:true})+
    U.input('end_date','Fim previsto',a.end_date||'',{type:'date'})+
    U.textarea('notes','Observações operacionais',a.notes||'',{rows:4});
}
function allocationScheduleError(b){
  const wp=String(b.work_pattern||'').toUpperCase();
  const period=String(b.shift_period||'').toUpperCase();
  const parity=String(b.day_parity||'').toUpperCase();
  if(!['DAY','NIGHT','OTHER'].includes(period))return 'Informe o turno operacional (Diurno, Noturno ou Outro).';
  if(wp==='12X36'){
    if(!['DAY','NIGHT'].includes(period))return 'No regime 12x36, selecione se o plantão é Diurno ou Noturno.';
    if(!['EVEN','ODD'].includes(parity))return 'No regime 12x36, selecione obrigatoriamente se o plantão é Par ou Ímpar.';
  }
  return '';
}

function updateCurrentEmployeeStatus(o,employeeId){
  const today=C.localDate();
  const current=get(`SELECT * FROM employee_absences WHERE organization_id=:o AND employee_id=:e AND active=1 AND start_date<=:d AND (end_date IS NULL OR end_date='' OR end_date>=:d) ORDER BY start_date DESC LIMIT 1`,{o,e:employeeId,d:today});
  const status=current?(current.absence_type==='VACATION'?'VACATION':'LEAVE'):'ACTIVE';
  run(`UPDATE employees SET status=:s,updated_at=:t WHERE id=:e AND organization_id=:o AND status<>'INACTIVE'`,{s:status,t:now(),e:employeeId,o});
}

module.exports=function(r){
  // Renovação versionada: cria um novo contrato e preserva a versão anterior.
  r.get('/contratos/:id/renovar',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;
    const o=ctx.user.organization_id;
    const c=get(`SELECT co.*,cl.legal_name,cl.trade_name FROM contracts co JOIN clients cl ON cl.id=co.client_id WHERE co.id=:id AND co.organization_id=:o`,{id:p.id,o});
    if(!c)return C.send(res,404,C.errorPage('Contrato não encontrado',''));
    const child=get('SELECT id,contract_number FROM contracts WHERE previous_contract_id=:id AND organization_id=:o ORDER BY version_number DESC LIMIT 1',{id:c.id,o});
    if(child)return C.redirect(res,C.flashUrl(`/contratos/${c.id}`,`Este contrato já foi renovado para ${child.contract_number||'uma nova versão'}.`,'warn'));
    const series=c.series_id||c.id;
    const maxv=Number(get('SELECT COALESCE(MAX(version_number),1) v FROM contracts WHERE organization_id=:o AND series_id=:s',{o,s:series}).v||1);
    const nextv=maxv+1;
    const start=S.addDays(c.end_date,1)||C.localDate();
    const duration=Math.max(0,S.daysDiff(c.start_date,c.end_date));
    const end=S.addDays(start,duration);
    const preview=`<div class="grid">${U.card('Versão atual',`V${c.version_number||1}`)}${U.card('Contrato atual',C.esc(c.contract_number||'Sem número'))}${U.card('Vigência atual',`${U.dateBR(c.start_date)} → ${U.dateBR(c.end_date)}`)}${U.card('Valor atual',U.money(c.monthly_value))}</div><div class="alert warn"><b>Renovação não sobrescreve o contrato antigo.</b> Será criada uma nova versão. O contrato atual, seus valores, postos, alocações e histórico continuarão consultáveis.</div>`;
    const form=`<form method="post" action="/contratos/${c.id}/renovar">${U.csrf(ctx)}${U.formGrid(
      U.input('contract_number','Novo número do contrato',suggestContractNumber(c.contract_number,nextv),{required:true})+
      U.input('start_date','Nova vigência - início',start,{type:'date',required:true})+
      U.input('end_date','Nova vigência - fim',end,{type:'date',required:true})+
      U.input('monthly_value','Novo valor mensal',c.monthly_value,{type:'number',step:'0.01',min:0})+
      U.input('uniform_exchange_days','Prazo de troca de fardamento (dias)',c.uniform_exchange_days||180,{type:'number',min:1})+
      U.input('billing_day','Dia de faturamento',c.billing_day||'',{type:'number',min:1})+
      U.input('reajust_index','Índice / regra de reajuste',c.reajust_index||'')+
      U.input('last_reajust_date','Data do reajuste',C.localDate(),{type:'date'})+
      U.input('manager_name','Gestor / responsável no cliente',c.manager_name||'')+
      U.input('manager_phone','Contato do gestor',c.manager_phone||'')+
      U.textarea('description','Escopo / descrição da nova versão',c.description||'',{rows:4})+
      U.textarea('renewal_note','Observação da renovação','Renovação contratual',{rows:3})+
      `<div class="field span2"><span>O que levar para a nova versão?</span>${U.check('copy_posts','Copiar postos e dimensionamento atuais',true)}${U.check('copy_allocations','Transferir as alocações ativas para os postos copiados',true)}</div>`+
      U.textarea('notes','Observações do novo contrato',c.notes||'',{rows:3}),
      `<a class="btn" href="/contratos/${c.id}">Cancelar</a><button class="btn primary" data-confirm="Criar a nova versão e preservar este contrato como histórico?">Renovar e criar nova versão</button>`
    )}</form>`;
    C.send(res,200,U.layout(ctx,'Renovar contrato',preview+U.panel(`${c.trade_name||c.legal_name} · nova versão V${nextv}`,form),'/clientes',{msg:q.msg,mt:q.mt}));
  });

  r.post('/contratos/:id/renovar',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;
    const b=await C.parseBody(req); if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,c=get('SELECT * FROM contracts WHERE id=:id AND organization_id=:o',{id:p.id,o});
    if(!c)return C.send(res,404,C.errorPage('Contrato não encontrado',''));
    const child=get('SELECT id,contract_number FROM contracts WHERE previous_contract_id=:id AND organization_id=:o LIMIT 1',{id:c.id,o});
    if(child)return C.redirect(res,C.flashUrl(`/contratos/${c.id}`,`Este contrato já possui uma renovação: ${child.contract_number||child.id}.`,'warn'));
    if(!b.start_date||!b.end_date||b.end_date<b.start_date)return C.redirect(res,C.flashUrl(`/contratos/${c.id}/renovar`,'Informe uma nova vigência válida.','err'));
    const series=c.series_id||c.id;
    const nextv=Number(get('SELECT COALESCE(MAX(version_number),1)+1 v FROM contracts WHERE organization_id=:o AND series_id=:s',{o,s:series}).v||2);
    const newId=id(),eventId=id(),t=now(),copyAlloc=C.bool(b.copy_allocations),copyPosts=C.bool(b.copy_posts)||copyAlloc;
    const postMap=new Map(),allocationMap=new Map();
    transaction(()=>{
      run(`INSERT INTO contracts(id,organization_id,client_id,contract_number,description,start_date,end_date,renewal_status,monthly_value,uniform_exchange_days,manager_name,manager_phone,billing_day,reajust_index,last_reajust_date,notes,active,series_id,version_number,previous_contract_id,created_at,updated_at)
        VALUES(:id,:o,:cl,:num,:desc,:start,:end,'ACTIVE',:value,:days,:mn,:mp,:bd,:ri,:lr,:notes,1,:series,:v,:prev,:t,:t)`,{
        id:newId,o,cl:c.client_id,num:String(b.contract_number||'').trim(),desc:b.description||'',start:b.start_date,end:b.end_date,value:C.num(b.monthly_value),days:Number(b.uniform_exchange_days||180),mn:b.manager_name||'',mp:b.manager_phone||'',bd:b.billing_day?Number(b.billing_day):null,ri:b.reajust_index||'',lr:b.last_reajust_date||null,notes:b.notes||'',series,v:nextv,prev:c.id,t
      });
      const oldPosts=all('SELECT * FROM contract_posts WHERE contract_id=:id AND organization_id=:o',{id:c.id,o});
      if(copyPosts){
        for(const x of oldPosts.filter(x=>Number(x.active))){
          const np=id();postMap.set(x.id,np);
          run(`INSERT INTO contract_posts(id,organization_id,contract_id,post_name,post_type,headcount,day_headcount,night_headcount,day_even_headcount,day_odd_headcount,night_even_headcount,night_odd_headcount,shift_regime,schedule_details,armed,weapon_type,weapon_quantity,started_at,ended_at,active,notes,created_at,updated_at)
            VALUES(:id,:o,:c,:n,:type,:hc,:dh,:nh,:dep,:dop,:nep,:nop,:sr,:sd,:a,:wt,:wq,:s,NULL,1,:notes,:t,:t)`,{id:np,o,c:newId,n:x.post_name,type:x.post_type||'',hc:Number(x.headcount||1),dh:Number(x.day_headcount||0),nh:Number(x.night_headcount||0),dep:Number(x.day_even_headcount||0),dop:Number(x.day_odd_headcount||0),nep:Number(x.night_even_headcount||0),nop:Number(x.night_odd_headcount||0),sr:x.shift_regime||'',sd:x.schedule_details||'',a:Number(x.armed||0),wt:x.weapon_type||'',wq:Number(x.weapon_quantity||0),s:b.start_date,notes:x.notes||'',t});
        }
      }
      const oldAllocs=all(`SELECT * FROM employee_allocations WHERE contract_id=:id AND organization_id=:o AND active=1 AND (end_date IS NULL OR end_date='' OR end_date>=:start)`,{id:c.id,o,start:b.start_date});
      if(copyAlloc){
        for(const a of oldAllocs){
          const na=id();allocationMap.set(a.id,na);
          const carriedEnd=a.end_date&&a.end_date>=b.start_date?(a.end_date>b.end_date?b.end_date:a.end_date):null;
          run(`INSERT INTO employee_allocations(id,organization_id,employee_id,contract_id,post_id,start_date,end_date,shift_regime,active,work_pattern,day_parity,shift_period,cycle_anchor_date,shift_start,shift_end,allocation_role,relief_employee_id,covers_employee_id,notes,created_at,updated_at)
            VALUES(:id,:o,:e,:c,:p,:start,:end,:shift,1,:wp,:par,:period,:anchor,:ss,:se,:role,:relief,:covers,:notes,:t,:t)`,{id:na,o,e:a.employee_id,c:newId,p:a.post_id?(postMap.get(a.post_id)||null):null,start:b.start_date,end:carriedEnd,shift:a.shift_regime||'',wp:a.work_pattern||'CUSTOM',par:a.day_parity||'',period:a.shift_period||S.inferShiftPeriod(a),anchor:a.cycle_anchor_date||b.start_date,ss:a.shift_start||'',se:a.shift_end||'',role:a.allocation_role||'TITULAR',relief:a.relief_employee_id||null,covers:a.covers_employee_id||null,notes:a.notes||'',t});
        }
      }
      if(copyAlloc){
        const oldReps=all(`SELECT * FROM schedule_replacements WHERE contract_id=:c AND organization_id=:o AND end_date>=:start`,{c:c.id,o,start:b.start_date});
        for(const x of oldReps){
          const mapped=allocationMap.get(x.original_allocation_id);if(!mapped)continue;
          const nr=id(),ns=x.start_date>b.start_date?x.start_date:b.start_date;
          if(x.end_date<ns)continue;
          run(`INSERT INTO schedule_replacements(id,organization_id,contract_id,post_id,original_allocation_id,absent_employee_id,substitute_employee_id,absence_id,start_date,end_date,replacement_type,shift_start,shift_end,reason,notes,active,created_by,created_at,updated_at) VALUES(:id,:o,:c,:p,:a,:absent,:sub,:absence,:s,:e,:type,:ss,:se,:r,:notes,1,:by,:t,:t)`,{id:nr,o,c:newId,p:x.post_id?(postMap.get(x.post_id)||null):null,a:mapped,absent:x.absent_employee_id,sub:x.substitute_employee_id,absence:x.absence_id||null,s:ns,e:x.end_date,type:x.replacement_type||'COVERAGE',ss:x.shift_start||'',se:x.shift_end||'',r:x.reason||'',notes:x.notes||'',by:ctx.user.id,t});
        }
      }
      run(`UPDATE schedule_replacements SET active=0,end_date=CASE WHEN end_date>:d THEN :d ELSE end_date END,updated_at=:t WHERE contract_id=:id AND organization_id=:o`,{d:c.end_date,t,id:c.id,o});
      run(`UPDATE employee_allocations SET active=0,end_date=CASE WHEN end_date IS NULL OR end_date>:d THEN :d ELSE end_date END,updated_at=:t WHERE contract_id=:id AND organization_id=:o AND active=1`,{d:c.end_date,t,id:c.id,o});
      run(`UPDATE contract_posts SET active=0,ended_at=CASE WHEN ended_at IS NULL OR ended_at>:d THEN :d ELSE ended_at END,updated_at=:t WHERE contract_id=:id AND organization_id=:o AND active=1`,{d:c.end_date,t,id:c.id,o});
      run(`UPDATE contracts SET active=0,renewal_status='RENEWED',renewed_at=:t,renewal_note=:note,closed_at=:d,closure_reason='Renovado para nova versão',updated_at=:t WHERE id=:id AND organization_id=:o`,{t,note:b.renewal_note||'',d:c.end_date,id:c.id,o});
      run(`INSERT INTO contract_renewals(id,organization_id,client_id,series_id,previous_contract_id,new_contract_id,renewal_number,renewed_at,effective_from,previous_number,new_number,previous_start_date,previous_end_date,new_start_date,new_end_date,previous_monthly_value,new_monthly_value,note,copied_posts,copied_allocations,created_by,created_at)
        VALUES(:id,:o,:cl,:series,:prev,:new,:n,:at,:eff,:pn,:nn,:ps,:pe,:ns,:ne,:pv,:nv,:note,:cp,:ca,:by,:t)`,{id:eventId,o,cl:c.client_id,series,prev:c.id,new:newId,n:nextv-1,at:t,eff:b.start_date,pn:c.contract_number||'',nn:String(b.contract_number||''),ps:c.start_date,pe:c.end_date,ns:b.start_date,ne:b.end_date,pv:Number(c.monthly_value||0),nv:C.num(b.monthly_value),note:b.renewal_note||'',cp:copyPosts,ca:copyAlloc,by:ctx.user.id,t});
    });
    C.audit(ctx,req,'RENEW','contracts',c.id,{contract_number:c.contract_number,start_date:c.start_date,end_date:c.end_date,monthly_value:c.monthly_value},{new_contract_id:newId,new_contract_number:b.contract_number,start_date:b.start_date,end_date:b.end_date,monthly_value:C.num(b.monthly_value),version:nextv});
    C.redirect(res,C.flashUrl(`/contratos/${newId}`,`Contrato renovado. Nova versão V${nextv} criada sem apagar a versão anterior.`));
  });

  // Edição detalhada de alocação.
  r.get('/alocacoes/:id/editar',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;
    const o=ctx.user.organization_id,a=get(`SELECT ea.*,e.name employee_name,co.contract_number,co.client_id,cl.trade_name,cl.legal_name FROM employee_allocations ea JOIN employees e ON e.id=ea.employee_id JOIN contracts co ON co.id=ea.contract_id JOIN clients cl ON cl.id=co.client_id WHERE ea.id=:id AND ea.organization_id=:o`,{id:p.id,o});
    if(!a)return C.send(res,404,C.errorPage('Alocação não encontrada',''));
    const c=get('SELECT * FROM contracts WHERE id=:id AND organization_id=:o',{id:a.contract_id,o});
    const form=`<form method="post" action="/alocacoes/${a.id}">${U.csrf(ctx)}${U.formGrid(allocationFields(ctx,c,a,o),`<a class="btn" href="/contratos/${c.id}">Cancelar</a><button class="btn primary">Salvar alocação</button>`)}</form>`;
    const subs=all(`SELECT sr.*,s.name substitute_name FROM schedule_replacements sr JOIN employees s ON s.id=sr.substitute_employee_id WHERE sr.original_allocation_id=:a AND sr.organization_id=:o ORDER BY sr.start_date DESC`,{a:a.id,o}).map(x=>`<tr><td>${U.dateBR(x.start_date)} → ${U.dateBR(x.end_date)}</td><td>${C.esc(x.substitute_name)}</td><td>${C.esc(x.replacement_type)}</td><td>${x.active?U.badge('Ativa','ok'):U.badge('Encerrada','muted')}</td><td><div class="row-actions"><a class="btn sm" href="/substituicoes/${x.id}/editar">Editar</a>${x.active?`<form method="post" action="/substituicoes/${x.id}/encerrar">${U.csrf(ctx)}<button class="btn sm">Encerrar</button></form>`:''}</div></td></tr>`);
    C.send(res,200,U.layout(ctx,'Editar alocação',U.panel(`${a.employee_name} · ${a.trade_name||a.legal_name}`,form)+U.panel('Coberturas / substituições vinculadas',U.table(['Período','Substituto','Tipo','Status','Ações'],subs)),'/clientes',{msg:q.msg,mt:q.mt,actions:`<a class="btn" href="/alocacoes/${a.id}/substituir">Criar substituição</a>${C.isAdmin(ctx)?`<form method="post" action="/alocacoes/${a.id}/excluir" style="display:inline">${U.csrf(ctx)}<button class="btn danger" data-confirm="Excluir definitivamente esta alocação?">Excluir alocação</button></form>`:''}`}));
  });

  r.post('/alocacoes/:id',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;
    const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,a=get('SELECT * FROM employee_allocations WHERE id=:id AND organization_id=:o',{id:p.id,o});
    if(!a)return C.send(res,404,C.errorPage('Alocação não encontrada',''));
    const parent=get('SELECT renewal_status FROM contracts WHERE id=:id AND organization_id=:o',{id:a.contract_id,o});
    if(parent?.renewal_status==='RENEWED'&&!C.isAdmin(ctx))return C.redirect(res,C.flashUrl(`/contratos/${a.contract_id}`,'Esta alocação pertence a uma versão histórica renovada. Somente ADMIN pode corrigir o registro histórico.','warn'));
    if(!b.start_date||b.end_date&&b.end_date<b.start_date)return C.redirect(res,C.flashUrl(`/alocacoes/${a.id}/editar`,'Período inválido.','err'));
    const scheduleErr=allocationScheduleError(b);if(scheduleErr)return C.redirect(res,C.flashUrl(`/alocacoes/${a.id}/editar`,scheduleErr,'err'));
    const post=b.post_id?get('SELECT * FROM contract_posts WHERE id=:id AND contract_id=:c AND organization_id=:o',{id:b.post_id,c:a.contract_id,o}):null;
    if(b.post_id&&!post)return C.redirect(res,C.flashUrl(`/alocacoes/${a.id}/editar`,'O posto selecionado não pertence a este contrato.','err'));
    const before={...a};
    run(`UPDATE employee_allocations SET post_id=:p,start_date=:s,end_date=:e,shift_regime=:shift,work_pattern=:wp,day_parity=:par,shift_period=:period,cycle_anchor_date=:anchor,shift_start=:ss,shift_end=:se,allocation_role=:role,relief_employee_id=:relief,covers_employee_id=:covers,notes=:notes,active=:active,updated_at=:t WHERE id=:id AND organization_id=:o`,{p:b.post_id||null,s:b.start_date,e:b.end_date||null,shift:b.shift_regime||'',wp:b.work_pattern||'CUSTOM',par:b.day_parity==='NONE'?'':(b.day_parity||''),period:b.shift_period||S.inferShiftPeriod(b),anchor:b.cycle_anchor_date||b.start_date,ss:b.shift_start||'',se:b.shift_end||'',role:b.allocation_role||'TITULAR',relief:b.relief_employee_id&&b.relief_employee_id!==a.employee_id?b.relief_employee_id:null,covers:b.covers_employee_id&&b.covers_employee_id!==a.employee_id?b.covers_employee_id:null,notes:b.notes||'',active:b.end_date&&b.end_date<C.localDate()?0:1,t:now(),id:a.id,o});
    C.audit(ctx,req,'UPDATE','employee_allocations',a.id,before,{post_id:b.post_id,work_pattern:b.work_pattern,day_parity:b.day_parity,shift_period:b.shift_period,allocation_role:b.allocation_role,start_date:b.start_date,end_date:b.end_date});
    C.redirect(res,C.flashUrl(`/alocacoes/${a.id}/editar`,'Alocação atualizada.'));
  });

  // Férias, afastamentos e indisponibilidades com histórico.
  r.get('/colaboradores/:id/afastamento/novo',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'employees','edit'))return;
    const e=get('SELECT * FROM employees WHERE id=:id AND organization_id=:o',{id:p.id,o:ctx.user.organization_id});
    if(!e)return C.send(res,404,C.errorPage('Colaborador não encontrado',''));
    const f=`<form method="post" action="/colaboradores/${e.id}/afastamentos">${U.csrf(ctx)}${U.formGrid(U.select('absence_type','Tipo','VACATION',ABSENCE_TYPES,{blank:false})+U.input('start_date','Início',C.localDate(),{type:'date',required:true})+U.input('end_date','Fim','',{type:'date'})+U.input('reason','Motivo / referência','')+U.textarea('notes','Observações','',{rows:4}),`<a class="btn" href="/colaboradores/${e.id}/editar">Cancelar</a><button class="btn primary">Registrar período</button>`)}</form>`;
    C.send(res,200,U.layout(ctx,'Férias / afastamento',U.panel(e.name,f),'/colaboradores',{msg:q.msg,mt:q.mt}));
  });

  r.post('/colaboradores/:id/afastamentos',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'employees','edit'))return;
    const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,e=get('SELECT * FROM employees WHERE id=:id AND organization_id=:o',{id:p.id,o});if(!e)return C.send(res,404,C.errorPage('Colaborador não encontrado',''));
    if(!b.start_date||b.end_date&&b.end_date<b.start_date)return C.redirect(res,C.flashUrl(`/colaboradores/${e.id}/afastamento/novo`,'Período inválido.','err'));
    const type=ABSENCE_TYPES.some(x=>x[0]===b.absence_type)?b.absence_type:'OTHER',aid=id(),t=now();
    run(`INSERT INTO employee_absences(id,organization_id,employee_id,absence_type,start_date,end_date,reason,notes,active,created_by,created_at,updated_at) VALUES(:id,:o,:e,:type,:s,:end,:r,:notes,1,:by,:t,:t)`,{id:aid,o,e:e.id,type,s:b.start_date,end:b.end_date||null,r:b.reason||'',notes:b.notes||'',by:ctx.user.id,t});
    updateCurrentEmployeeStatus(o,e.id);
    C.audit(ctx,req,'ABSENCE_CREATE','employee_absences',aid,null,{employee:e.name,type,start_date:b.start_date,end_date:b.end_date||null});
    C.redirect(res,C.flashUrl(`/colaboradores/${e.id}/editar`,'Período de férias/afastamento registrado. A escala passa a considerar esse período automaticamente.'));
  });

  r.get('/afastamentos/:id/editar',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'employees','edit'))return;
    const o=ctx.user.organization_id,a=get(`SELECT ea.*,e.name employee_name FROM employee_absences ea JOIN employees e ON e.id=ea.employee_id WHERE ea.id=:id AND ea.organization_id=:o`,{id:p.id,o});
    if(!a)return C.send(res,404,C.errorPage('Período não encontrado',''));
    const f=`<form method="post" action="/afastamentos/${a.id}">${U.csrf(ctx)}${U.formGrid(U.select('absence_type','Tipo',a.absence_type,ABSENCE_TYPES,{blank:false})+U.input('start_date','Início',a.start_date,{type:'date',required:true})+U.input('end_date','Fim',a.end_date||'',{type:'date'})+U.input('reason','Motivo / referência',a.reason||'')+U.textarea('notes','Observações',a.notes||'',{rows:4}),`<a class="btn" href="/colaboradores/${a.employee_id}/editar">Cancelar</a><button class="btn primary">Salvar período</button>`)}</form>`;
    C.send(res,200,U.layout(ctx,'Editar férias / afastamento',U.panel(a.employee_name,f),'/colaboradores',{msg:q.msg,mt:q.mt}));
  });

  r.post('/afastamentos/:id',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'employees','edit'))return;const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,a=get('SELECT * FROM employee_absences WHERE id=:id AND organization_id=:o',{id:p.id,o});if(!a)return C.send(res,404,C.errorPage('Período não encontrado',''));
    if(!b.start_date||b.end_date&&b.end_date<b.start_date)return C.redirect(res,C.flashUrl(`/afastamentos/${a.id}/editar`,'Período inválido.','err'));
    const type=ABSENCE_TYPES.some(x=>x[0]===b.absence_type)?b.absence_type:'OTHER',before={...a};
    run(`UPDATE employee_absences SET absence_type=:type,start_date=:s,end_date=:e,reason=:r,notes=:n,active=1,updated_at=:t WHERE id=:id AND organization_id=:o`,{type,s:b.start_date,e:b.end_date||null,r:b.reason||'',n:b.notes||'',t:now(),id:a.id,o});
    updateCurrentEmployeeStatus(o,a.employee_id);C.audit(ctx,req,'ABSENCE_UPDATE','employee_absences',a.id,before,{absence_type:type,start_date:b.start_date,end_date:b.end_date||null,reason:b.reason||''});
    C.redirect(res,C.flashUrl(`/colaboradores/${a.employee_id}/editar`,'Período atualizado. A projeção da escala foi recalculada.'));
  });

  r.post('/afastamentos/:id/encerrar',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'employees','edit'))return;
    const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,a=get('SELECT * FROM employee_absences WHERE id=:id AND organization_id=:o',{id:p.id,o});if(!a)return C.redirect(res,'/colaboradores');
    run(`UPDATE employee_absences SET active=0,end_date=CASE WHEN end_date IS NULL OR end_date='' OR end_date>:d THEN :d ELSE end_date END,updated_at=:t WHERE id=:id`,{d:C.localDate(),t:now(),id:a.id});updateCurrentEmployeeStatus(o,a.employee_id);C.audit(ctx,req,'ABSENCE_END','employee_absences',a.id,a,{active:0,end_date:a.end_date||C.localDate()});C.redirect(res,C.flashUrl(`/colaboradores/${a.employee_id}/editar`,'Período encerrado.'));
  });

  r.post('/afastamentos/:id/excluir',async(req,res,ctx,q,p)=>{
    if(!C.requireAdmin(ctx,res))return;const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,a=get('SELECT * FROM employee_absences WHERE id=:id AND organization_id=:o',{id:p.id,o});if(!a)return C.redirect(res,'/colaboradores');
    const used=Number(get('SELECT COUNT(*) c FROM schedule_replacements WHERE absence_id=:id AND organization_id=:o',{id:a.id,o}).c);if(used)return C.redirect(res,C.flashUrl(`/colaboradores/${a.employee_id}/editar`,'Esse afastamento possui substituição vinculada e não pode ser excluído. Encerre-o para preservar o histórico.','warn'));
    run('DELETE FROM employee_absences WHERE id=:id',{id:a.id});updateCurrentEmployeeStatus(o,a.employee_id);C.audit(ctx,req,'DELETE','employee_absences',a.id,a,null);C.redirect(res,C.flashUrl(`/colaboradores/${a.employee_id}/editar`,'Período excluído.'));
  });

  // Substituição/cobertura vinculada à alocação e, opcionalmente, a um afastamento.
  r.get('/alocacoes/:id/substituir',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;
    const o=ctx.user.organization_id,a=get(`SELECT ea.*,e.name employee_name,co.contract_number,cl.trade_name,cl.legal_name,cp.post_name FROM employee_allocations ea JOIN employees e ON e.id=ea.employee_id JOIN contracts co ON co.id=ea.contract_id JOIN clients cl ON cl.id=co.client_id LEFT JOIN contract_posts cp ON cp.id=ea.post_id WHERE ea.id=:id AND ea.organization_id=:o`,{id:p.id,o});if(!a)return C.send(res,404,C.errorPage('Alocação não encontrada',''));
    const abs=all(`SELECT id,absence_type,start_date,end_date,reason FROM employee_absences WHERE organization_id=:o AND employee_id=:e AND active=1 ORDER BY start_date DESC`,{o,e:a.employee_id});
    const absOpts=abs.map(x=>[x.id,`${S.absenceLabel(x.absence_type)} · ${U.dateBR(x.start_date)} → ${U.dateBR(x.end_date)}`]);
    const current=abs.find(x=>S.within(C.localDate(),x.start_date,x.end_date))||abs[0];
    const emps=optionsEmployees(o,a.employee_id).filter(([eid])=>eid!==a.employee_id);
    const f=`<div class="alert warn"><b>O titular não é removido da escala histórica.</b> A substituição fica ligada ao período e mostra quem cobriu quem.</div><form method="post" action="/alocacoes/${a.id}/substituicoes">${U.csrf(ctx)}${U.formGrid(U.select('substitute_employee_id','Colaborador substituto','',emps,{required:true})+U.select('absence_id','Férias / afastamento vinculado',current?.id||'',absOpts,{blankLabel:'Sem afastamento específico'})+U.select('replacement_type','Tipo de cobertura',current?.absence_type||'COVERAGE',REPLACEMENT_TYPES,{blank:false})+U.input('start_date','Início',current?.start_date||C.localDate(),{type:'date',required:true})+U.input('end_date','Fim',current?.end_date||C.localDate(),{type:'date',required:true})+U.input('shift_start','Início do turno',a.shift_start||'',{type:'time'})+U.input('shift_end','Fim do turno',a.shift_end||'',{type:'time'})+U.input('reason','Motivo',current?.reason||'')+U.textarea('notes','Observações','',{rows:4}),`<a class="btn" href="/alocacoes/${a.id}/editar">Cancelar</a><button class="btn primary">Registrar substituição</button>`)}</form>`;
    C.send(res,200,U.layout(ctx,'Substituir colaborador',U.panel(`${a.employee_name} · ${a.post_name||a.contract_number}`,f),'/clientes',{msg:q.msg,mt:q.mt}));
  });

  r.post('/alocacoes/:id/substituicoes',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,a=get('SELECT * FROM employee_allocations WHERE id=:id AND organization_id=:o',{id:p.id,o});if(!a)return C.send(res,404,C.errorPage('Alocação não encontrada',''));
    const sub=get('SELECT * FROM employees WHERE id=:id AND organization_id=:o',{id:b.substitute_employee_id,o});if(!sub||sub.id===a.employee_id)return C.redirect(res,C.flashUrl(`/alocacoes/${a.id}/substituir`,'Selecione um substituto válido.','err'));
    if(!b.start_date||!b.end_date||b.end_date<b.start_date)return C.redirect(res,C.flashUrl(`/alocacoes/${a.id}/substituir`,'Período de substituição inválido.','err'));
    let absence=null;if(b.absence_id)absence=get('SELECT * FROM employee_absences WHERE id=:id AND employee_id=:e AND organization_id=:o',{id:b.absence_id,e:a.employee_id,o});
    const rid=id(),t=now();run(`INSERT INTO schedule_replacements(id,organization_id,contract_id,post_id,original_allocation_id,absent_employee_id,substitute_employee_id,absence_id,start_date,end_date,replacement_type,shift_start,shift_end,reason,notes,active,created_by,created_at,updated_at) VALUES(:id,:o,:c,:p,:a,:absent,:sub,:absence,:s,:e,:type,:ss,:se,:r,:notes,1,:by,:t,:t)`,{id:rid,o,c:a.contract_id,p:a.post_id||null,a:a.id,absent:a.employee_id,sub:sub.id,absence:absence?.id||null,s:b.start_date,e:b.end_date,type:b.replacement_type||'COVERAGE',ss:b.shift_start||a.shift_start||'',se:b.shift_end||a.shift_end||'',r:b.reason||'',notes:b.notes||'',by:ctx.user.id,t});
    const conflicts=Number(get(`SELECT COUNT(*) c FROM employee_allocations WHERE organization_id=:o AND employee_id=:e AND active=1 AND start_date<=:end AND (end_date IS NULL OR end_date='' OR end_date>=:start)`,{o,e:sub.id,start:b.start_date,end:b.end_date}).c)+Number(get(`SELECT COUNT(*) c FROM schedule_replacements WHERE organization_id=:o AND substitute_employee_id=:e AND active=1 AND id<>:id AND start_date<=:end AND end_date>=:start`,{o,e:sub.id,id:rid,start:b.start_date,end:b.end_date}).c);
    C.audit(ctx,req,'REPLACEMENT_CREATE','schedule_replacements',rid,null,{allocation_id:a.id,absent_employee_id:a.employee_id,substitute_employee_id:sub.id,start_date:b.start_date,end_date:b.end_date});
    C.redirect(res,C.flashUrl(`/alocacoes/${a.id}/editar`,conflicts?`Substituição registrada. Atenção: o substituto possui ${conflicts} vínculo(s) que se sobrepõem ao período; confira a escala.`:'Substituição registrada e já considerada na escala.',conflicts?'warn':''));
  });

  r.get('/substituicoes/:id/editar',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;
    const o=ctx.user.organization_id,x=get(`SELECT sr.*,e.name absent_name,s.name substitute_name,co.contract_number,cp.post_name FROM schedule_replacements sr JOIN employees e ON e.id=sr.absent_employee_id JOIN employees s ON s.id=sr.substitute_employee_id JOIN contracts co ON co.id=sr.contract_id LEFT JOIN contract_posts cp ON cp.id=sr.post_id WHERE sr.id=:id AND sr.organization_id=:o`,{id:p.id,o});
    if(!x)return C.send(res,404,C.errorPage('Substituição não encontrada',''));
    const emps=optionsEmployees(o,x.absent_employee_id).filter(([eid])=>eid!==x.absent_employee_id);
    const abs=all(`SELECT id,absence_type,start_date,end_date,reason FROM employee_absences WHERE organization_id=:o AND employee_id=:e ORDER BY start_date DESC`,{o,e:x.absent_employee_id}).map(a=>[a.id,`${S.absenceLabel(a.absence_type)} · ${U.dateBR(a.start_date)} → ${U.dateBR(a.end_date)}`]);
    const f=`<div class="alert warn"><b>Editar não apaga o histórico.</b> A alteração fica registrada na auditoria e a escala é recalculada imediatamente.</div><form method="post" action="/substituicoes/${x.id}">${U.csrf(ctx)}${U.formGrid(U.select('substitute_employee_id','Colaborador substituto',x.substitute_employee_id,emps,{required:true})+U.select('absence_id','Férias / afastamento vinculado',x.absence_id||'',abs,{blankLabel:'Sem afastamento específico'})+U.select('replacement_type','Tipo de cobertura',x.replacement_type||'COVERAGE',REPLACEMENT_TYPES,{blank:false})+U.input('start_date','Início',x.start_date,{type:'date',required:true})+U.input('end_date','Fim',x.end_date,{type:'date',required:true})+U.input('shift_start','Início do turno',x.shift_start||'',{type:'time'})+U.input('shift_end','Fim do turno',x.shift_end||'',{type:'time'})+U.input('reason','Motivo',x.reason||'')+U.textarea('notes','Observações',x.notes||'',{rows:4}),`<a class="btn" href="/alocacoes/${x.original_allocation_id}/editar">Cancelar</a><button class="btn primary">Salvar substituição</button>`)}</form>`;
    C.send(res,200,U.layout(ctx,'Editar substituição',U.panel(`${x.absent_name} · ${x.post_name||x.contract_number}`,f),'/clientes',{msg:q.msg,mt:q.mt}));
  });

  r.post('/substituicoes/:id',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,x=get('SELECT * FROM schedule_replacements WHERE id=:id AND organization_id=:o',{id:p.id,o});if(!x)return C.send(res,404,C.errorPage('Substituição não encontrada',''));
    const sub=get('SELECT * FROM employees WHERE id=:id AND organization_id=:o',{id:b.substitute_employee_id,o});if(!sub||sub.id===x.absent_employee_id)return C.redirect(res,C.flashUrl(`/substituicoes/${x.id}/editar`,'Selecione um substituto válido.','err'));
    if(!b.start_date||!b.end_date||b.end_date<b.start_date)return C.redirect(res,C.flashUrl(`/substituicoes/${x.id}/editar`,'Período inválido.','err'));
    let absence=null;if(b.absence_id)absence=get('SELECT * FROM employee_absences WHERE id=:id AND employee_id=:e AND organization_id=:o',{id:b.absence_id,e:x.absent_employee_id,o});const before={...x};
    run(`UPDATE schedule_replacements SET substitute_employee_id=:sub,absence_id=:absence,start_date=:s,end_date=:e,replacement_type=:type,shift_start=:ss,shift_end=:se,reason=:r,notes=:n,active=1,updated_at=:t WHERE id=:id AND organization_id=:o`,{sub:sub.id,absence:absence?.id||null,s:b.start_date,e:b.end_date,type:b.replacement_type||'COVERAGE',ss:b.shift_start||'',se:b.shift_end||'',r:b.reason||'',n:b.notes||'',t:now(),id:x.id,o});
    const conflicts=Number(get(`SELECT COUNT(*) c FROM employee_allocations WHERE organization_id=:o AND employee_id=:e AND active=1 AND start_date<=:end AND (end_date IS NULL OR end_date='' OR end_date>=:start)`,{o,e:sub.id,start:b.start_date,end:b.end_date}).c)+Number(get(`SELECT COUNT(*) c FROM schedule_replacements WHERE organization_id=:o AND substitute_employee_id=:e AND active=1 AND id<>:id AND start_date<=:end AND end_date>=:start`,{o,e:sub.id,id:x.id,start:b.start_date,end:b.end_date}).c);
    C.audit(ctx,req,'REPLACEMENT_UPDATE','schedule_replacements',x.id,before,{substitute_employee_id:sub.id,start_date:b.start_date,end_date:b.end_date,replacement_type:b.replacement_type});
    C.redirect(res,C.flashUrl(`/alocacoes/${x.original_allocation_id}/editar`,conflicts?`Substituição atualizada. Atenção: há ${conflicts} vínculo(s) do substituto sobrepostos ao período.`:'Substituição atualizada e refletida na escala.',conflicts?'warn':''));
  });

  r.post('/substituicoes/:id/encerrar',async(req,res,ctx,q,p)=>{
    if(!C.requirePerm(ctx,res,'clients','edit'))return;const b=await C.parseBody(req);if(!C.csrfOk(ctx,b))return C.send(res,403,C.errorPage('Sessão inválida',''));
    const o=ctx.user.organization_id,x=get('SELECT * FROM schedule_replacements WHERE id=:id AND organization_id=:o',{id:p.id,o});if(!x)return C.redirect(res,'/escalas');run('UPDATE schedule_replacements SET active=0,end_date=CASE WHEN end_date>:d THEN :d ELSE end_date END,updated_at=:t WHERE id=:id',{d:C.localDate(),t:now(),id:x.id});C.audit(ctx,req,'REPLACEMENT_END','schedule_replacements',x.id,x,{active:0});C.redirect(res,C.flashUrl(`/alocacoes/${x.original_allocation_id}/editar`,'Substituição encerrada.'));
  });
};
