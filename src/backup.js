'use strict';
const fs=require('fs');const path=require('path');const {db}=require('./db');const {zipStore}=require('./core');
const root=path.join(__dirname,'..'),dir=path.join(root,'backups');fs.mkdirSync(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),sqlite=path.join(dir,`tmp-${stamp}.sqlite`),safe=sqlite.replace(/'/g,"''");
db.exec(`VACUUM INTO '${safe}'`);
const files={'data/central-gestao.sqlite':fs.readFileSync(sqlite),'LEIA-ME-RESTAURACAO.txt':Buffer.from('Backup completo da Central de Gestao v2.6.0. Contem banco SQLite e documentos anexados. Para restaurar: pare a Central, substitua data\\central-gestao.sqlite e recoloque a pasta uploads preservando sua estrutura.','utf8')};
function walk(base,rel=''){if(!fs.existsSync(base))return;for(const ent of fs.readdirSync(base,{withFileTypes:true})){const abs=path.join(base,ent.name),r=path.join(rel,ent.name);if(ent.isDirectory())walk(abs,r);else if(ent.isFile()&&ent.name!=='.gitkeep')files['uploads/'+r.replace(/\\/g,'/')]=fs.readFileSync(abs);}}
walk(path.join(root,'uploads'));
const name=`backup-completo-${stamp}.zip`,out=path.join(dir,name);fs.writeFileSync(out,zipStore(files));try{fs.unlinkSync(sqlite)}catch{}
console.log(out);
