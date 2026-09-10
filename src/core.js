'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const { run,get,all,id,now }=require('./db');

const MODULES={
  dashboard:'Dashboard', users:'Usuários', clients:'Clientes e Contratos', employees:'Colaboradores', schedules:'Escalas',
  finance:'Financeiro', reconciliation:'Conciliação Bancária', inventory:'Estoque', assets:'Patrimônio',
  uniforms:'Uniformes', tickets:'Chamados', reports:'Relatórios', audit:'Auditoria', settings:'Configurações'
};
const ACTIONS=['view','create','edit','delete','import','export','approve'];
function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function localDate(v=new Date()){const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))return'';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function dateBR(v){if(!v)return '-'; const s=String(v).slice(0,10); const [y,m,d]=s.split('-'); return d&&m&&y?`${d}/${m}/${y}`:s;}
function dateTimeBR(v){if(!v)return '-'; try{return new Date(v).toLocaleString('pt-BR');}catch{return String(v);}}
function num(v){let s=String(v??'').trim().replace(/[^0-9,.-]/g,'');const ci=s.lastIndexOf(','),di=s.lastIndexOf('.');if(ci>=0&&di>=0){if(ci>di)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(ci>=0)s=s.replace(',','.');else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,'');const n=Number(s);return Number.isFinite(n)?n:0;}
function bool(v){return ['1','true','on','yes','sim'].includes(String(v||'').toLowerCase())?1:0;}
function cleanCPF(v){return String(v||'').replace(/\D/g,'').slice(0,11);}
function cleanLoginId(v){
  const raw=String(v||'').trim();
  const digits=raw.replace(/\D/g,'');
  // Se o valor for um CPF digitado com ou sem pontuação, guarda somente os 11 dígitos.
  if(digits.length===11 && /^[0-9.\-\s]+$/.test(raw)) return digits;
  // IDs personalizados são case-insensitive e podem usar letras, números, ponto, hífen, _ e @.
  return raw.toLowerCase().replace(/\s+/g,'').slice(0,50);
}
function validLoginId(v){return /^[a-z0-9._@-]{3,50}$/.test(String(v||''));}
function cookieParse(str=''){const out={}; for(const p of str.split(';')){const i=p.indexOf('='); if(i>0)out[decodeURIComponent(p.slice(0,i).trim())]=decodeURIComponent(p.slice(i+1).trim());} return out;}
function randomToken(bytes=32){return crypto.randomBytes(bytes).toString('hex');}
function clientIp(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();}

function securityHeaders(res){
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}
function send(res,status,body,type='text/html; charset=utf-8'){securityHeaders(res);res.statusCode=status;res.setHeader('Content-Type',type);res.end(body);}
function redirect(res,loc){securityHeaders(res);res.statusCode=302;res.setHeader('Location',loc);res.end();}
function json(res,obj,status=200){send(res,status,JSON.stringify(obj,null,2),'application/json; charset=utf-8');}

async function readBody(req,max=20*1024*1024){
  return await new Promise((resolve,reject)=>{const chunks=[];let n=0;req.on('data',c=>{n+=c.length;if(n>max){reject(new Error('Arquivo/requisição muito grande. Limite de 20 MB.'));req.destroy();return;}chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)});
}
function parseUrlEncoded(s){const q=new URLSearchParams(s);const o={};for(const [k,v] of q){if(o[k]===undefined)o[k]=v;else if(Array.isArray(o[k]))o[k].push(v);else o[k]=[o[k],v];}return o;}
function parseMultipart(buf,contentType){
  const m=/boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType||''); if(!m)return{}; const boundary=Buffer.from('--'+(m[1]||m[2])); const out={};
  let start=buf.indexOf(boundary)+boundary.length;
  while(start>=boundary.length){ if(buf.slice(start,start+2).toString()==='--')break; if(buf.slice(start,start+2).toString()==='\r\n')start+=2; const headerEnd=buf.indexOf(Buffer.from('\r\n\r\n'),start); if(headerEnd<0)break;
    const head=buf.slice(start,headerEnd).toString('utf8'); let next=buf.indexOf(boundary,headerEnd+4); if(next<0)break; let data=buf.slice(headerEnd+4,next-2);
    const name=/name="([^"]+)"/i.exec(head)?.[1]; const filename=/filename="([^"]*)"/i.exec(head)?.[1]; const mime=/content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
    if(name){const val=filename!==undefined?{filename,path:path.basename(filename),mime:mime||'application/octet-stream',data}:data.toString('utf8'); if(out[name]===undefined)out[name]=val;else if(Array.isArray(out[name]))out[name].push(val);else out[name]=[out[name],val];}
    start=next+boundary.length;
  } return out;
}
async function parseBody(req){const b=await readBody(req);const ct=String(req.headers['content-type']||'');if(ct.includes('application/json')){try{return JSON.parse(b.toString('utf8')||'{}')}catch{return{}}}if(ct.includes('multipart/form-data'))return parseMultipart(b,ct);return parseUrlEncoded(b.toString('utf8'));}

function createSession(res,req,userId){
  const sid=randomToken(32), csrf=randomToken(24), t=new Date(), exp=new Date(t.getTime()+10*60*60*1000);
  run('DELETE FROM sessions WHERE expires_at < :n',{n:t.toISOString()});
  run('INSERT INTO sessions(id,user_id,csrf_token,ip,user_agent,created_at,expires_at) VALUES(:id,:uid,:csrf,:ip,:ua,:c,:e)',{id:sid,uid:userId,csrf,ip:clientIp(req),ua:String(req.headers['user-agent']||'').slice(0,500),c:t.toISOString(),e:exp.toISOString()});
  const secure=String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https'?'; Secure':''; res.setHeader('Set-Cookie',`sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=36000${secure}`); return sid;
}
function destroySession(req,res){const sid=cookieParse(req.headers.cookie||'').sid;if(sid)run('DELETE FROM sessions WHERE id=:id',{id:sid});res.setHeader('Set-Cookie','sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');}
function loadAuth(req){
  const sid=cookieParse(req.headers.cookie||'').sid;if(!sid)return null; const s=get(`SELECT s.*,u.name,u.cpf,u.email,u.role,u.organization_id,u.active,u.must_change_password,o.name organization_name
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN organizations o ON o.id=u.organization_id WHERE s.id=:sid AND s.expires_at>:n`,{sid,n:now()});
  if(!s||!Number(s.active))return null; const perms={}; for(const p of all('SELECT * FROM user_permissions WHERE user_id=:u',{u:s.user_id}))perms[p.module]=p;
  return {session:s,user:{id:s.user_id,name:s.name,cpf:s.cpf,email:s.email,role:s.role,organization_id:s.organization_id,organization_name:s.organization_name,must_change_password:Number(s.must_change_password)},permissions:perms};
}
function isAdmin(ctx){return !!ctx&&['SUPERADMIN','ADMIN'].includes(ctx.user.role);}
function can(ctx,module,action='view'){if(!ctx)return false;if(action==='delete')return isAdmin(ctx);if(ctx.user.role==='SUPERADMIN'||ctx.user.role==='ADMIN')return true;const p=ctx.permissions[module];return !!p&&Number(p['can_'+action])===1;}
function requireAuth(ctx,res){if(!ctx){redirect(res,'/login');return false}return true;}
function requirePerm(ctx,res,module,action='view'){if(!requireAuth(ctx,res))return false;if(!can(ctx,module,action)){send(res,403,errorPage('Acesso negado',action==='delete'?'Exclusões permanentes são restritas a administradores.':'Seu usuário não possui permissão para esta operação.'));return false}return true;}
function requireAdmin(ctx,res){if(!requireAuth(ctx,res))return false;if(!isAdmin(ctx)){send(res,403,errorPage('Operação restrita','Esta operação crítica é exclusiva de ADMIN ou SUPERADMIN.'));return false}return true;}
function csrfOk(ctx,body){return !!ctx&&!!body&&String(body._csrf||'')===String(ctx.session.csrf_token||'');}

function audit(ctx,req,action,entity,entityId,before,after){
  run(`INSERT INTO audit_logs(id,organization_id,user_id,user_name,user_cpf,action,entity,entity_id,before_json,after_json,ip,user_agent,created_at)
  VALUES(:id,:org,:uid,:un,:cpf,:a,:e,:eid,:b,:af,:ip,:ua,:t)`,{id:id(),org:ctx?.user?.organization_id||null,uid:ctx?.user?.id||null,un:ctx?.user?.name||'Sistema',cpf:ctx?.user?.cpf||'',a:action,e:entity,eid:entityId||null,b:before?JSON.stringify(before):null,af:after?JSON.stringify(after):null,ip:clientIp(req),ua:String(req.headers['user-agent']||'').slice(0,500),t:now()});
}
function loginAllowed(key){const cutoff=Date.now()-15*60*1000;run('DELETE FROM login_attempts WHERE occurred_at<:c',{c:cutoff});return Number(get('SELECT COUNT(*) c FROM login_attempts WHERE key=:k AND occurred_at>=:c',{k:key,c:cutoff}).c)<20;}
function recordLoginFailure(key){run('INSERT INTO login_attempts(key,occurred_at) VALUES(:k,:t)',{k:key,t:Date.now()});}

function flashUrl(path,msg,type='ok'){return `${path}${path.includes('?')?'&':'?'}msg=${encodeURIComponent(msg)}&mt=${encodeURIComponent(type)}`;}
function errorPage(title,message){return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>${esc(title)}</title></head><body class="login-bg"><main class="login-card"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a class="btn" href="/">Voltar</a></p></main></body></html>`;}
function statusContract(endDate,renewal,active=1){
  if(!Number(active)||renewal==='CANCELLED')return {key:'closed',label:'Encerrado / inativo',class:'muted',days:null};
  const today=new Date();today.setHours(0,0,0,0);const end=new Date(String(endDate)+'T00:00:00');const days=Number.isNaN(end.getTime())?null:Math.ceil((end-today)/86400000);
  if(renewal==='AWAITING_RENEWAL'){
    if(days!==null&&days<0)return {key:'await',label:`Aguardando renovação · vencido há ${Math.abs(days)} dia(s)`,class:'danger',days};
    return {key:'await',label:days!==null?`Aguardando renovação · ${days} dia(s) para o fim`:'Aguardando renovação',class:'warn',days};
  }
  if(renewal==='RENEWED')return{key:'renewed',label:'Renovado',class:'ok',days};
  if(days===null)return{key:'unknown',label:'Vigência inválida',class:'warn',days:null};
  if(days<0)return{key:'expired',label:`Vencido há ${Math.abs(days)} dia(s)`,class:'danger',days};
  if(days===0)return{key:'4',label:'Vence hoje',class:'danger',days};
  if(days<=4)return{key:'4',label:`Vence em ${days} dia(s)`,class:'danger',days};
  if(days<=30)return{key:'30',label:`Vence em ${days} dias`,class:'warn',days};
  if(days<=90)return{key:'90',label:`Vence em ${days} dias`,class:'info',days};
  return{key:'ok',label:`Vigente · ${days} dias restantes`,class:'ok',days};
}

function normDate(v){const raw=String(v??'').trim();if(!raw)return null;if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10);let m=/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(raw);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(/^\d+(?:\.\d+)?$/.test(raw)){const serial=Number(raw);if(serial>20000&&serial<80000){const d=new Date(Date.UTC(1899,11,30)+Math.floor(serial)*86400000);return d.toISOString().slice(0,10);}}return raw.slice(0,10);}

function daysBetween(a,b){if(!a||!b)return null;return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);}

function parseCSV(text){
  text=String(text||'').replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0]||'';const sep=(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?';':',';const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'){if(q&&n==='"'){cell+='"';i++}else q=!q;}else if(c===sep&&!q){row.push(cell.trim());cell='';}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell.trim());cell='';if(row.some(x=>x!==''))rows.push(row);row=[];}else cell+=c;}
  if(cell||row.length){row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row)} if(!rows.length)return[];const h=rows.shift().map(x=>x.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''));return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));
}
function csvEncode(rows,headers){const sep=';';const e=v=>`"${String(v??'').replace(/"/g,'""')}"`;return '\uFEFF'+[headers.map(h=>e(h.label)).join(sep),...rows.map(r=>headers.map(h=>e(typeof h.value==='function'?h.value(r):r[h.value])).join(sep))].join('\r\n');}
function parseOFX(text){
  const out=[];const blocks=String(text||'').match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi)||[];
  const val=(b,t)=>{const m=new RegExp(`<${t}>([^<\\r\\n]+)`,'i').exec(b);return m?m[1].trim():''};
  for(const b of blocks){const raw=val(b,'DTPOSTED');const d=raw?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:'';const amount=Number(String(val(b,'TRNAMT')).replace(',','.'));if(d&&Number.isFinite(amount))out.push({tx_date:d,amount,description:val(b,'MEMO')||val(b,'NAME')||'Movimento OFX',document_number:val(b,'CHECKNUM'),external_id:val(b,'FITID')});}
  return out;
}
function simplePDF(title,lines){
  const escp=s=>String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');let y=800;let stream=`BT /F1 16 Tf 50 ${y} Td (${escp(title)}) Tj ET\n`;y-=30;
  for(const line of lines){const txt=String(line).replace(/[^\x20-\x7EÀ-ÿ]/g,' ');stream+=`BT /F1 9 Tf 50 ${y} Td (${escp(txt.slice(0,110))}) Tj ET\n`;y-=14;if(y<45)break;}
  const objects=[];objects[1]='<< /Type /Catalog /Pages 2 0 R >>';objects[2]='<< /Type /Pages /Kids [3 0 R] /Count 1 >>';objects[3]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';objects[4]=`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}endstream`;objects[5]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let pdf='%PDF-1.4\n';const offs=[0];for(let i=1;i<objects.length;i++){offs[i]=Buffer.byteLength(pdf,'latin1');pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf,'latin1');pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let i=1;i<objects.length;i++)pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \n';pdf+=`trailer << /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(pdf,'latin1');
}


function unzipEntries(buf){
  const sigEOCD=0x06054b50,sigCD=0x02014b50,sigLocal=0x04034b50;let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){if(buf.readUInt32LE(i)===sigEOCD){eocd=i;break}}if(eocd<0)throw new Error('Arquivo XLSX/ZIP inválido.');const count=buf.readUInt16LE(eocd+10),cdOffset=buf.readUInt32LE(eocd+16);const out={};let pos=cdOffset;for(let n=0;n<count&&pos+46<=buf.length;n++){if(buf.readUInt32LE(pos)!==sigCD)break;const method=buf.readUInt16LE(pos+10),csize=buf.readUInt32LE(pos+20),usize=buf.readUInt32LE(pos+24),fnl=buf.readUInt16LE(pos+28),exl=buf.readUInt16LE(pos+30),coml=buf.readUInt16LE(pos+32),local=buf.readUInt32LE(pos+42),name=buf.slice(pos+46,pos+46+fnl).toString('utf8');if(buf.readUInt32LE(local)!==sigLocal)throw new Error('XLSX corrompido.');const lfn=buf.readUInt16LE(local+26),lex=buf.readUInt16LE(local+28),start=local+30+lfn+lex,data=buf.slice(start,start+csize);out[name]=method===0?data:method===8?require('zlib').inflateRawSync(data):Buffer.alloc(0);pos+=46+fnl+exl+coml;}return out;
}
function xmlUnescape(s){return String(s||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}
function parseXLSX(buf){
  const z=unzipEntries(buf),sheet=(z['xl/worksheets/sheet1.xml']||Object.entries(z).find(([k])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k))?.[1]);if(!sheet)throw new Error('Planilha XLSX sem primeira aba reconhecível.');let shared=[];if(z['xl/sharedStrings.xml']){const xml=z['xl/sharedStrings.xml'].toString('utf8');shared=[...xml.matchAll(/<si[\s>][\s\S]*?<\/si>/g)].map(m=>xmlUnescape([...m[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join('')))}const xml=sheet.toString('utf8'),rows=[];for(const rm of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)){const arr=[];for(const cm of rm[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)){const attrs=cm[1],body=cm[2],ref=/\br="([A-Z]+)\d+"/.exec(attrs)?.[1]||'A',type=/\bt="([^"]+)"/.exec(attrs)?.[1]||'',idx=[...ref].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;let v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]??'';if(type==='s')v=shared[Number(v)]??'';else if(type==='inlineStr')v=xmlUnescape([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(''));else v=xmlUnescape(v);arr[idx]=v;}rows.push(arr.map(x=>x??''));}if(!rows.length)return[];const h=rows.shift().map(x=>String(x).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''));return rows.filter(r=>r.some(x=>String(x).trim()!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));
}
let crcTable=null;function crc32(buf){if(!crcTable){crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0})}let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function zipStore(files){let offset=0;const locals=[],centrals=[];for(const [name,content] of Object.entries(files)){const n=Buffer.from(name),d=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8'),crc=crc32(d);const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(0,6);lh.writeUInt16LE(0,8);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(d.length,18);lh.writeUInt32LE(d.length,22);lh.writeUInt16LE(n.length,26);const local=Buffer.concat([lh,n,d]);locals.push(local);const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(d.length,20);ch.writeUInt32LE(d.length,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(offset,42);centrals.push(Buffer.concat([ch,n]));offset+=local.length;}const cd=Buffer.concat(centrals),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(centrals.length,8);e.writeUInt16LE(centrals.length,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,e]);}
function xlsxEncode(rows,headers){const xe=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};const data=[headers.map(h=>h.label),...rows.map(r=>headers.map(h=>typeof h.value==='function'?h.value(r):r[h.value]))];const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>`<c r="${col(ci)}${ri+1}" t="inlineStr"><is><t>${xe(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;return zipStore({'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>','_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml':sheet});}

module.exports={MODULES,ACTIONS,esc,money,localDate,dateBR,dateTimeBR,num,bool,cleanCPF,cleanLoginId,validLoginId,cookieParse,randomToken,clientIp,send,redirect,json,readBody,parseBody,createSession,destroySession,loadAuth,isAdmin,can,requireAuth,requirePerm,requireAdmin,csrfOk,audit,loginAllowed,recordLoginFailure,flashUrl,errorPage,statusContract,normDate,daysBetween,parseCSV,csvEncode,parseXLSX,xlsxEncode,parseOFX,simplePDF,zipStore};
