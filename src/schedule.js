'use strict';
function isoDate(v){return String(v||'').slice(0,10);}
function utcDate(v){const s=isoDate(v);const [y,m,d]=s.split('-').map(Number);return y&&m&&d?new Date(Date.UTC(y,m-1,d)):null;}
function addDays(v,n){const d=utcDate(v);if(!d)return'';d.setUTCDate(d.getUTCDate()+Number(n||0));return d.toISOString().slice(0,10);}
function daysDiff(a,b){const x=utcDate(a),y=utcDate(b);if(!x||!y)return 0;return Math.round((y-x)/86400000);}
function within(date,start,end){const d=isoDate(date);return !!d && (!start||d>=isoDate(start)) && (!end||d<=isoDate(end));}
function scheduledOn(a,date){
  if(!within(date,a.start_date,a.end_date))return false;
  const d=utcDate(date);if(!d)return false;
  const pattern=String(a.work_pattern||a.shift_regime||'CUSTOM').toUpperCase().replace(/\s/g,'');
  const parity=String(a.day_parity||'').toUpperCase();
  const anchor=isoDate(a.cycle_anchor_date||a.start_date);
  const diff=daysDiff(anchor,date);
  if(pattern.includes('12X36')){
    // PAR/ÍMPAR define o dia do calendário. Sem paridade (dados legados),
    // a data-base mantém a sequência histórica de 48 horas entre plantões.
    if(parity==='EVEN')return d.getUTCDate()%2===0;
    if(parity==='ODD')return d.getUTCDate()%2===1;
    return diff>=0&&diff%2===0;
  }
  if(pattern.includes('24X72'))return diff>=0&&diff%4===0;
  if(pattern==='6X1'||pattern.includes('6X1'))return diff>=0&&diff%7!==6;
  if(pattern==='5X2'||pattern.includes('5X2')){const wd=d.getUTCDay();return wd>=1&&wd<=5;}
  if(pattern==='DAILY'||pattern==='DIARIO'||pattern==='DIÁRIO')return true;
  if(parity==='EVEN')return d.getUTCDate()%2===0;
  if(parity==='ODD')return d.getUTCDate()%2===1;
  return true;
}
function inferShiftPeriod(a){
  const explicit=String(a?.shift_period||'').toUpperCase();
  if(['DAY','NIGHT','OTHER'].includes(explicit))return explicit;
  const raw=String(a?.shift_start||'').trim();
  const h=Number(raw.split(':')[0]);
  if(Number.isFinite(h)){if(h>=18||h<6)return'NIGHT';return'DAY';}
  const text=String(a?.shift_regime||'').toLowerCase();
  if(/noit|noturn/.test(text))return'NIGHT';
  if(/diurn|manh|dia/.test(text))return'DAY';
  return'OTHER';
}
function shiftLabel(a){const p=inferShiftPeriod(a);return p==='DAY'?'Diurno':p==='NIGHT'?'Noturno':'Outro / misto';}
function patternLabel(a){
  const p=String(a.work_pattern||a.shift_regime||'CUSTOM').toUpperCase();
  const par=a.day_parity==='EVEN'?'par':a.day_parity==='ODD'?'ímpar':'';
  const shift=inferShiftPeriod(a);
  if(p.includes('12X36')&&par){return `12x36 · ${shift==='NIGHT'?'Noite':'Dia'} ${par}`;}
  const parText=par?` · dia ${par}`:'';
  const shiftText=shift==='DAY'?' · diurno':shift==='NIGHT'?' · noturno':'';
  return `${p}${shiftText}${parText}`;
}
function absenceLabel(type){return ({VACATION:'Férias',LEAVE:'Afastado',MEDICAL:'Atestado/licença médica',TRAINING:'Treinamento',OTHER:'Indisponível'})[String(type||'').toUpperCase()]||String(type||'Indisponível');}
function roleLabel(role){return ({TITULAR:'Titular',FERISTA:'Ferista',RESERVE:'Reserva',COVERAGE:'Cobertura',RELIEF:'Rendição'})[String(role||'').toUpperCase()]||String(role||'Titular');}
module.exports={isoDate,utcDate,addDays,daysDiff,within,scheduledOn,inferShiftPeriod,shiftLabel,patternLabel,absenceLabel,roleLabel};
