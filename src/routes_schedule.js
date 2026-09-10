'use strict';
const {get,all}=require('./db');
const C=require('./core');
const U=require('./ui');
const S=require('./schedule');

const SHIFT_KEYS=['DAY','NIGHT','OTHER'];
function shiftName(k){return k==='DAY'?'Diurno':k==='NIGHT'?'Noturno':'Outro / não definido';}
function shiftIcon(k){return k==='DAY'?'☀':k==='NIGHT'?'☾':'◌';}
function postDimension(p){
  const dep=Math.max(0,Number(p.day_even_headcount||0)),dop=Math.max(0,Number(p.day_odd_headcount||0)),nep=Math.max(0,Number(p.night_even_headcount||0)),nop=Math.max(0,Number(p.night_odd_headcount||0));
  const paritySplit=dep+dop+nep+nop>0;
  const day=paritySplit?dep+dop:Math.max(0,Number(p.day_headcount||0));
  const night=paritySplit?nep+nop:Math.max(0,Number(p.night_headcount||0));
  const split=day+night>0;
  return {paritySplit,split,dep,dop,nep,nop,day,night,teamTotal:split?day+night:Math.max(0,Number(p.headcount||0))};
}
function postTargets(p,date){
  const dim=postDimension(p);
  if(dim.paritySplit){
    const d=S.utcDate(date),even=d?d.getUTCDate()%2===0:false;
    const DAY=even?dim.dep:dim.dop,NIGHT=even?dim.nep:dim.nop;
    return {...dim,DAY,NIGHT,OTHER:0,total:DAY+NIGHT,parity:even?'EVEN':'ODD'};
  }
  if(dim.split)return {...dim,DAY:dim.day,NIGHT:dim.night,OTHER:0,total:dim.day+dim.night,parity:''};
  const total=Math.max(0,Number(p.headcount||0));return {...dim,DAY:0,NIGHT:0,OTHER:total,total,parity:''};
}
function build(o,c,start,end){
  const posts=all('SELECT * FROM contract_posts WHERE contract_id=:c AND organization_id=:o ORDER BY post_name',{c:c.id,o});
  const allocs=all(`SELECT ea.*,e.name employee_name,e.role_name,e.status employee_status,cp.post_name,cp.post_type,rel.name relief_name,cov.name covers_name
    FROM employee_allocations ea JOIN employees e ON e.id=ea.employee_id
    LEFT JOIN contract_posts cp ON cp.id=ea.post_id
    LEFT JOIN employees rel ON rel.id=ea.relief_employee_id LEFT JOIN employees cov ON cov.id=ea.covers_employee_id
    WHERE ea.contract_id=:c AND ea.organization_id=:o AND ea.start_date<=:end AND (ea.end_date IS NULL OR ea.end_date='' OR ea.end_date>=:start)
    ORDER BY cp.post_name,e.name`,{c:c.id,o,start,end});
  const absences=all(`SELECT a.*,e.name employee_name FROM employee_absences a JOIN employees e ON e.id=a.employee_id WHERE a.organization_id=:o AND a.start_date<=:end AND (a.end_date IS NULL OR a.end_date='' OR a.end_date>=:start)`,{o,start,end});
  const replacements=all(`SELECT sr.*,s.name substitute_name,s.status substitute_status FROM schedule_replacements sr JOIN employees s ON s.id=sr.substitute_employee_id WHERE sr.organization_id=:o AND sr.contract_id=:c AND sr.start_date<=:end AND sr.end_date>=:start`,{o,c:c.id,start,end});
  const rows=[];let uncovered=0,covered=0,scheduled=0;
  for(let d=start;d<=end;d=S.addDays(d,1)){
    const dayAllocs=allocs.filter(a=>S.scheduledOn(a,d));
    for(const a of dayAllocs){
      const absence=absences.find(x=>x.employee_id===a.employee_id&&S.within(d,x.start_date,x.end_date));
      const rep=replacements.find(x=>x.original_allocation_id===a.id&&S.within(d,x.start_date,x.end_date));
      const absent=!!absence || (d===C.localDate()&&a.employee_status!=='ACTIVE');
      const status=absence?S.absenceLabel(absence.absence_type):absent?a.employee_status:'Escalado';
      const subAbsence=rep?absences.find(x=>x.employee_id===rep.substitute_employee_id&&S.within(d,x.start_date,x.end_date)):null;
      const subUnavailable=!!rep&&(!!subAbsence||(d===C.localDate()&&rep.substitute_status!=='ACTIVE'));
      const isCovered=!absent||(!!rep&&!subUnavailable);scheduled++;if(isCovered)covered++;else uncovered++;
      rows.push({date:d,post_id:a.post_id||'',post_name:a.post_name||'Sem posto',post_type:a.post_type||'',employee_id:a.employee_id,employee_name:a.employee_name,role:S.roleLabel(a.allocation_role),pattern:S.patternLabel(a),shift:[a.shift_start,a.shift_end].filter(Boolean).join(' → '),shift_period:S.inferShiftPeriod(a),status,absent,isCovered,substitute:rep?.substitute_name||'',replacement_type:rep?.replacement_type||'',substitute_unavailable:subUnavailable,substitute_status:subAbsence?S.absenceLabel(subAbsence.absence_type):(subUnavailable?rep.substitute_status:''),relief:a.relief_name||'',covers:a.covers_name||'',allocation_id:a.id});
    }
    // Completa vagas conforme o dimensionamento do posto. Quando o posto possui efetivo
    // diurno/noturno, as vagas são criadas dentro do turno correto.
    for(const p of posts.filter(x=>activePostOn(x,d))){
      const targets=postTargets(p,d);
      const current=rows.filter(x=>x.date===d&&x.post_id===p.id&&x.allocation_id);
      if(targets.split){
        for(const period of ['DAY','NIGHT']){
          const count=current.filter(x=>x.shift_period===period).length;
          for(let i=count;i<targets[period];i++){
            uncovered++;rows.push({date:d,post_id:p.id,post_name:p.post_name,post_type:p.post_type||'',employee_id:'',employee_name:'VAGA / COBERTURA NÃO DEFINIDA',role:'-',pattern:p.shift_regime||'-',shift:p.schedule_details||'',shift_period:period,status:'Descoberto',absent:true,isCovered:false,substitute:'',replacement_type:'',relief:'',covers:'',allocation_id:''});
          }
        }
      }else{
        const count=current.length,target=targets.total;
        for(let i=count;i<target;i++){
          uncovered++;rows.push({date:d,post_id:p.id,post_name:p.post_name,post_type:p.post_type||'',employee_id:'',employee_name:'VAGA / COBERTURA NÃO DEFINIDA',role:'-',pattern:p.shift_regime||'-',shift:p.schedule_details||'',shift_period:'OTHER',status:'Descoberto',absent:true,isCovered:false,substitute:'',replacement_type:'',relief:'',covers:'',allocation_id:''});
        }
      }
    }
  }
  return {rows,posts,allocs,absences,replacements,summary:{scheduled,covered,uncovered}};
}
function weekday(date,long=false){return new Date(date+'T12:00:00').toLocaleDateString('pt-BR',{weekday:long?'long':'short'}).replace('.','');}
function datesBetween(start,end){const out=[];for(let d=start;d<=end;d=S.addDays(d,1))out.push(d);return out;}
function activePostOn(p,date){return Number(p.active)||S.within(date,p.started_at,p.ended_at);}
function groupPostDay(data,date,p){
  const rows=data.rows.filter(x=>x.date===date&&x.post_id===p.id),targets=postTargets(p,date);
  const groups={};
  for(const k of SHIFT_KEYS){
    const rs=rows.filter(x=>x.shift_period===k),people=rs.filter(x=>x.allocation_id);
    const target=targets.split?targets[k]:(k==='OTHER'?targets.total:0);
    const uncovered=rs.filter(x=>!x.isCovered).length,covered=rs.filter(x=>x.isCovered).length;
    const occurrences=[];
    for(const x of people)if(x.absent){
      if(x.substitute&&!x.substitute_unavailable)occurrences.push(`${x.employee_name}: ${x.status} → coberto por ${x.substitute}`);
      else if(x.substitute&&x.substitute_unavailable)occurrences.push(`${x.employee_name}: ${x.status}; substituto ${x.substitute} indisponível (${x.substitute_status})`);
      else occurrences.push(`${x.employee_name}: ${x.status} sem substituto`);
    }
    groups[k]={key:k,rows:rs,people,target,uncovered,covered,occurrences};
  }
  const uncovered=rows.filter(x=>!x.isCovered).length,covered=rows.filter(x=>x.isCovered).length;
  return {date,post:p,rows,groups,targets,target:targets.total,uncovered,covered,occurrences:SHIFT_KEYS.flatMap(k=>groups[k].occurrences)};
}
function personHtml(x,compact=false){
  const link=x.allocation_id?`<a href="/alocacoes/${x.allocation_id}/editar"><b>${C.esc(x.employee_name)}</b></a>`:`<b>${C.esc(x.employee_name)}</b>`;
  const meta=[x.pattern,x.shift].filter(Boolean).join(' · ');
  let status='';
  if(x.absent){
    status=x.substitute&&!x.substitute_unavailable?`<span class="roster-note warn-text">${C.esc(x.status)} → ${C.esc(x.substitute)}</span>`:`<span class="roster-note danger-text">${C.esc(x.status)}${x.substitute?` · substituto indisponível: ${C.esc(x.substitute)}`:''}</span>`;
  }else if(x.relief&&!compact)status=`<span class="roster-note">Ferista/reserva: ${C.esc(x.relief)}</span>`;
  if(x.covers&&!compact)status+=`<span class="roster-note">Rende/cobre: ${C.esc(x.covers)}</span>`;
  return `<div class="roster-person ${x.absent?'has-issue':''}">${link}<small>${C.esc(meta||x.role||'-')}</small>${status}</div>`;
}
function shiftGroupHtml(g,{compact=false,configured=true}={}){
  const people=g.people.map(x=>personHtml(x,compact)).join('');
  const missing=g.rows.filter(x=>!x.allocation_id).length;
  const targetText=configured?`${g.people.length}/${g.target}`:`${g.people.length}`;
  const cls=g.key==='DAY'?'day':g.key==='NIGHT'?'night':'other';
  return `<div class="shift-box ${cls}"><div class="shift-box-head"><span>${shiftIcon(g.key)} ${shiftName(g.key)}</span><small>${configured?`alocados ${targetText}`:`${targetText} alocado(s)`}</small></div>${people||'<div class="shift-empty">Nenhum profissional neste turno.</div>'}${missing?`<div class="roster-vacancy">⚠ ${missing} vaga(s) sem cobertura</div>`:''}</div>`;
}
function groupedView(data,start,end){
  const dates=datesBetween(start,end);let html='<div class="schedule-sheet">';
  for(const d of dates){
    const posts=data.posts.filter(p=>activePostOn(p,d));
    html+=`<div class="schedule-day-block"><div class="schedule-date-title"><b>${U.dateBR(d)}</b><span>${C.esc(weekday(d,true))}</span></div><div class="table-wrap"><table class="schedule-daily-table"><thead><tr><th>Posto / local</th><th>☀ Equipe diurna</th><th>☾ Equipe noturna</th><th>Outros / ocorrências</th><th class="center">Cobertura</th></tr></thead><tbody>`;
    for(const p of posts){
      const g=groupPostDay(data,d,p),configured=g.targets.split;
      const other=g.groups.OTHER;
      const occ=g.occurrences.length?g.occurrences.map(x=>`<div class="schedule-occurrence">${C.esc(x)}</div>`).join(''):'<span class="muted">Sem ocorrência registrada.</span>';
      const coverage=g.uncovered?`${U.badge(`${g.uncovered} descoberta(s)`,'danger')}<small>${g.covered}/${g.target} posições cobertas</small>`:`${U.badge('Completa','ok')}<small>${g.covered}/${g.target} posições cobertas</small>`;
      const splitInfo=configured?`<small>Previsto neste dia: ☀ ${g.targets.DAY} · ☾ ${g.targets.NIGHT} · ${g.targets.paritySplit?(g.targets.parity==='EVEN'?'dia par':'dia ímpar'):'turnos fixos'}</small><small>Equipe cadastrada no posto: ${g.targets.teamTotal}</small>`:`<small>Previsto total: ${g.target} · <b>divisão dia/noite não configurada</b></small>`;
      const otherHtml=other.people.length||other.rows.length?shiftGroupHtml(other,{compact:true,configured:!configured}):'';
      html+=`<tr class="${g.uncovered?'schedule-row-alert':''}"><td><b>${C.esc(p.post_name)}</b>${p.post_type?`<small>${C.esc(p.post_type)}</small>`:''}${splitInfo}${p.schedule_details?`<small>${C.esc(p.schedule_details)}</small>`:''}</td><td>${shiftGroupHtml(g.groups.DAY,{configured})}</td><td>${shiftGroupHtml(g.groups.NIGHT,{configured})}</td><td>${otherHtml}${occ}</td><td class="center schedule-coverage">${coverage}</td></tr>`;
    }
    if(!posts.length)html+='<tr><td colspan="5" class="empty">Nenhum posto ativo nesta data.</td></tr>';
    html+='</tbody></table></div></div>';
  }
  return html+'</div>';
}
function matrixShiftSection(g,configured){
  if(!g.rows.length&&!g.target)return'';
  const cls=g.key==='DAY'?'day':g.key==='NIGHT'?'night':'other';
  const people=g.people.map(x=>{
    if(x.absent&&x.substitute&&!x.substitute_unavailable)return `<div class="matrix-person warn"><span>${C.esc(x.employee_name)}</span><small>${C.esc(x.status)} → ${C.esc(x.substitute)}</small></div>`;
    if(x.absent)return `<div class="matrix-person danger"><span>${C.esc(x.employee_name)}</span><small>${C.esc(x.status)}</small></div>`;
    return `<div class="matrix-person"><span>${C.esc(x.employee_name)}</span><small>${C.esc(x.pattern||x.role||'')}</small></div>`;
  }).join('');
  const missing=g.rows.filter(x=>!x.allocation_id).length;
  return `<div class="matrix-shift-section ${cls}"><div class="matrix-shift-head"><b>${shiftIcon(g.key)} ${shiftName(g.key)}</b><small>${configured?`${g.people.length}/${g.target}`:`${g.people.length}`}</small></div>${people||'<span class="muted">—</span>'}${missing?`<div class="matrix-vacancy">⚠ ${missing} vaga(s)</div>`:''}</div>`;
}
function matrixCell(data,date,p){
  const g=groupPostDay(data,date,p),configured=g.targets.split;
  if(!g.rows.length)return '<span class="muted">—</span>';
  return `<div class="matrix-shifts">${matrixShiftSection(g.groups.DAY,configured)}${matrixShiftSection(g.groups.NIGHT,configured)}${matrixShiftSection(g.groups.OTHER,!configured)}</div>`;
}
function matrixView(data,start,end){
  const dates=datesBetween(start,end),months=[];
  for(const d of dates){const key=d.slice(0,7);let m=months.find(x=>x.key===key);if(!m){m={key,dates:[]};months.push(m)}m.dates.push(d)}
  return months.map(m=>{
    const label=new Date(m.key+'-15T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    const activePosts=data.posts.filter(p=>m.dates.some(d=>activePostOn(p,d)));
    const head=m.dates.map(d=>`<th class="matrix-date"><b>${d.slice(8,10)}</b><small>${C.esc(weekday(d))}</small></th>`).join('');
    const rows=activePosts.map(p=>{const dim=postDimension(p);return `<tr><th class="matrix-post"><b>${C.esc(p.post_name)}</b><small>${C.esc(p.post_type||'')}</small>${dim.paritySplit?`<small>DP ${dim.dep} · DI ${dim.dop} · NP ${dim.nep} · NI ${dim.nop}</small><small>Equipe total: ${dim.teamTotal}</small>`:dim.split?`<small>☀ ${dim.day} · ☾ ${dim.night} · Total ${dim.teamTotal}</small>`:`<small>Previsto: ${dim.teamTotal} · sem divisão por turno</small>`}</th>${m.dates.map(d=>`<td class="matrix-cell ${groupPostDay(data,d,p).uncovered?'has-gap':''}">${activePostOn(p,d)?matrixCell(data,d,p):'<span class="muted">—</span>'}</td>`).join('')}</tr>`}).join('');
    return `<section class="panel schedule-month"><div class="panel-head"><h2>${C.esc(label.charAt(0).toUpperCase()+label.slice(1))}</h2><span class="muted">Postos nas linhas · datas nas colunas · cada célula separa Dia e Noite</span></div><div class="table-wrap matrix-wrap"><table class="schedule-matrix"><thead><tr><th class="matrix-post">Posto / local</th>${head}</tr></thead><tbody>${rows||`<tr><td class="empty">Nenhum posto no período.</td></tr>`}</tbody></table></div></section>`;
  }).join('');
}
function teamText(g){return g.people.map(x=>x.absent&&x.substitute&&!x.substitute_unavailable?`${x.employee_name} (${x.status} → ${x.substitute})`:x.absent?`${x.employee_name} (${x.status})`:`${x.employee_name} [${x.pattern}]`).join(' | ');}
function groupedCsvRows(data,start,end){
  const out=[];
  for(const d of datesBetween(start,end))for(const p of data.posts.filter(x=>activePostOn(x,d))){
    const g=groupPostDay(data,d,p);
    out.push({date:d,weekday:weekday(d,true),post:p.post_name,post_type:p.post_type||'',team_total:g.targets.teamTotal,target:g.target,day_target:g.targets.split?g.targets.DAY:'',night_target:g.targets.split?g.targets.NIGHT:'',day_team:teamText(g.groups.DAY),night_team:teamText(g.groups.NIGHT),other_team:teamText(g.groups.OTHER),occurrences:g.occurrences.join(' | '),uncovered:g.uncovered,coverage:g.uncovered?'DESCOBERTO':'COBERTO'});
  }
  return out;
}

module.exports=function(r){
  r.get('/escalas',async(req,res,ctx,q)=>{
    if(!C.requirePerm(ctx,res,'schedules'))return;
    const o=ctx.user.organization_id;
    const contracts=all(`SELECT co.id,co.contract_number,co.start_date,co.end_date,co.active,cl.trade_name,cl.legal_name FROM contracts co JOIN clients cl ON cl.id=co.client_id WHERE co.organization_id=:o ORDER BY co.active DESC,co.end_date DESC`,{o});
    const opts=contracts.map(x=>[x.id,`${x.trade_name||x.legal_name} · ${x.contract_number||'Sem número'} · ${U.dateBR(x.start_date)}–${U.dateBR(x.end_date)}`]);
    const cid=q.contract_id||contracts.find(x=>Number(x.active))?.id||contracts[0]?.id||'';
    const c=cid?contracts.find(x=>x.id===cid):null;
    if(!c){const f=`<form class="filters"><select name="contract_id"><option value="">Nenhum contrato cadastrado</option></select></form>`;return C.send(res,200,U.layout(ctx,'Escalas',U.panel('Escala operacional',f),'/escalas',{msg:q.msg,mt:q.mt}));}
    let start=C.normDate(q.start)||((C.localDate()>=c.start_date&&C.localDate()<=c.end_date)?C.localDate():c.start_date);
    let end=C.normDate(q.end)||S.addDays(start,30);if(end>c.end_date)end=c.end_date;if(start<c.start_date)start=c.start_date;if(end<start)end=start;
    let capped=false;if(S.daysDiff(start,end)>1095){end=S.addDays(start,1095);capped=true;}
    const view=q.view==='daily'?'daily':'matrix',data=build(o,c,start,end),base=`contract_id=${encodeURIComponent(c.id)}&start=${start}&end=${end}`;
    const filters=`<form class="filters schedule-filters" method="get" action="/escalas">${U.select('contract_id','Contrato',c.id,opts,{blank:false,help:'Escolha o contrato cuja operação deseja projetar. A escala considera somente postos, alocações e vigência deste contrato.'})}${U.input('start','De',start,{type:'date',help:'Primeiro dia que aparecerá na escala. Deve estar dentro da vigência do contrato.'})}${U.input('end','Até',end,{type:'date',help:'Último dia da projeção. Use “Toda a vigência” para preencher automaticamente o período completo do contrato.'})}<input type="hidden" name="view" value="${view}"><button class="btn primary">Gerar escala</button><a class="btn" href="/escalas?contract_id=${c.id}&start=${c.start_date}&end=${c.end_date}&view=${view}">Toda a vigência</a><a class="btn" href="/escalas/exportar.csv?${base}">Exportar planilha CSV</a></form>`;
    const tabs=`<div class="schedule-view-tabs"><a class="btn ${view==='matrix'?'primary':''}" href="/escalas?${base}&view=matrix">▦ Matriz por posto/turno</a><a class="btn ${view==='daily'?'primary':''}" href="/escalas?${base}&view=daily">▤ Quadro diário por turno</a></div>`;
    const gaps=data.rows.filter(x=>!x.isCovered).length;
    const alerts=gaps?`<div class="alert danger"><b>Atenção:</b> há ${gaps} posição(ões)/dia sem cobertura no período. A análise considera separadamente os turnos diurno e noturno quando o posto possui dimensionamento por turno.</div>`:`<div class="alert ok"><b>Período coberto:</b> não foi detectada posição descoberta com base no dimensionamento, turnos, alocações e substituições cadastradas.</div>`;
    const unsplit=data.posts.filter(p=>{const t=postDimension(p);return !t.split&&Number(p.headcount||0)>0}).length;
    const splitWarn=unsplit?`<div class="alert warn"><b>${unsplit} posto(s) ainda sem divisão Dia/Noite.</b> Edite o posto e informe “Efetivo diurno” e “Efetivo noturno” para obter a separação e a conferência de cobertura por turno.</div>`:'';
    const note=capped?`<div class="alert warn">A visualização foi limitada a 1.096 dias por segurança. Ajuste o intervalo para consultar períodos adicionais.</div>`:'';
    const explain=`<div class="alert info"><b>Como ler a v2.6:</b> cada linha continua representando apenas um posto. Dentro de cada data, a equipe é separada em <b>☀ Diurno</b> e <b>☾ Noturno</b>. No 12x36 o nome de cada profissional informa também <b>Dia Par, Dia Ímpar, Noite Par ou Noite Ímpar</b>. Assim um posto 24h com 4 vigilantes pode ser dimensionado como 2 de dia + 2 de noite sem repetir uma linha por pessoa.</div>`;
    const sheet=view==='matrix'?matrixView(data,start,end):U.panel('Escala por data, posto e turno',groupedView(data,start,end));
    const body=`<div class="grid">${U.card('Período',`${U.dateBR(start)} → ${U.dateBR(end)}`)}${U.card('Postos',data.posts.length)}${U.card('Plantões cobertos',data.summary.covered)}${U.card('Posições descobertas',data.summary.uncovered)}</div>${note}${alerts}${splitWarn}${explain}${U.panel('Filtros da escala',filters+tabs)}${sheet}`;
    C.send(res,200,U.layout(ctx,'Escalas',body,'/escalas',{msg:q.msg,mt:q.mt,subtitle:'Matriz operacional por posto, dia/noite e paridade do 12x36'}));
  });

  r.get('/escalas/exportar.csv',async(req,res,ctx,q)=>{
    if(!C.requirePerm(ctx,res,'schedules','export'))return;
    const o=ctx.user.organization_id,c=get('SELECT * FROM contracts WHERE id=:id AND organization_id=:o',{id:q.contract_id,o});if(!c)return C.send(res,404,C.errorPage('Contrato não encontrado',''));
    let start=C.normDate(q.start)||c.start_date,end=C.normDate(q.end)||c.end_date;if(start<c.start_date)start=c.start_date;if(end>c.end_date)end=c.end_date;if(S.daysDiff(start,end)>1095)end=S.addDays(start,1095);
    const data=build(o,c,start,end),grouped=groupedCsvRows(data,start,end);const headers=[
      {label:'Data',value:x=>C.dateBR(x.date)},{label:'Dia',value:'weekday'},{label:'Posto / local',value:'post'},{label:'Tipo do posto',value:'post_type'},
      {label:'Equipe total cadastrada',value:'team_total'},{label:'Posições previstas no dia',value:'target'},{label:'Previsto diurno',value:'day_target'},{label:'Equipe diurna',value:'day_team'},{label:'Previsto noturno',value:'night_target'},{label:'Equipe noturna',value:'night_team'},{label:'Outros / não definidos',value:'other_team'},{label:'Ocorrências / substituições',value:'occurrences'},{label:'Posições descobertas',value:'uncovered'},{label:'Cobertura',value:'coverage'}
    ];const csv=C.csvEncode(grouped,headers);
    res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="escala-turnos-${String(c.contract_number||'contrato').replace(/[^A-Za-z0-9_-]+/g,'-')}.csv"`);res.end(csv);
  });
};
