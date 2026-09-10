'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'central-gestao.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;`);

function now(){ return new Date().toISOString(); }
function id(){ return crypto.randomUUID(); }
function run(sql, params={}) { return db.prepare(sql).run(params); }
function get(sql, params={}) { return db.prepare(sql).get(params); }
function all(sql, params={}) { return db.prepare(sql).all(params); }
function exec(sql){ return db.exec(sql); }
function transaction(fn){
  db.exec('BEGIN IMMEDIATE');
  try { const out=fn(); db.exec('COMMIT'); return out; }
  catch(e){ try{db.exec('ROLLBACK')}catch{} throw e; }
}

function initSchema(){
  db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT, email TEXT, phone TEXT, address TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cpf TEXT NOT NULL, name TEXT NOT NULL, email TEXT, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('SUPERADMIN','ADMIN','USER')),
  active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(organization_id, cpf)
);
CREATE TABLE IF NOT EXISTS user_permissions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, module TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 0, can_create INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0, can_delete INTEGER NOT NULL DEFAULT 0,
  can_import INTEGER NOT NULL DEFAULT 0, can_export INTEGER NOT NULL DEFAULT 0,
  can_approve INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,module)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL, ip TEXT, user_agent TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(key, occurred_at);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  registration TEXT, cpf TEXT, name TEXT NOT NULL, role_name TEXT, admission_date TEXT, dismissal_date TEXT,
  phone TEXT, email TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees(organization_id);
CREATE INDEX IF NOT EXISTS idx_employees_org_cpf ON employees(organization_id,cpf);
CREATE INDEX IF NOT EXISTS idx_employees_org_registration_ci ON employees(organization_id,lower(trim(registration)));

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT, legal_name TEXT NOT NULL, trade_name TEXT, document TEXT, email TEXT, phone TEXT,
  address TEXT, address_number TEXT, complement TEXT, neighborhood TEXT, zip_code TEXT, city TEXT, state TEXT,
  cnpj_status TEXT, cnpj_status_date TEXT, cnae_code TEXT, cnae_description TEXT, legal_nature TEXT,
  opening_date TEXT, capital_social REAL NOT NULL DEFAULT 0, cnpj_lookup_source TEXT, cnpj_lookup_at TEXT,
  active INTEGER NOT NULL DEFAULT 1, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contract_number TEXT, description TEXT, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  renewal_status TEXT NOT NULL DEFAULT 'ACTIVE', monthly_value REAL NOT NULL DEFAULT 0,
  uniform_exchange_days INTEGER NOT NULL DEFAULT 180, manager_name TEXT, manager_phone TEXT,
  billing_day INTEGER, reajust_index TEXT, last_reajust_date TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, archived_at TEXT, closed_at TEXT, closure_reason TEXT,
  series_id TEXT, version_number INTEGER NOT NULL DEFAULT 1,
  previous_contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
  renewed_at TEXT, renewal_note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contracts_org_end ON contracts(organization_id,end_date);

CREATE TABLE IF NOT EXISTS contract_renewals (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL, previous_contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  new_contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  renewal_number INTEGER NOT NULL, renewed_at TEXT NOT NULL, effective_from TEXT NOT NULL,
  previous_number TEXT, new_number TEXT, previous_start_date TEXT, previous_end_date TEXT,
  new_start_date TEXT, new_end_date TEXT, previous_monthly_value REAL, new_monthly_value REAL,
  note TEXT, copied_posts INTEGER NOT NULL DEFAULT 0, copied_allocations INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_renewals_series ON contract_renewals(organization_id,series_id,renewal_number);

CREATE TABLE IF NOT EXISTS contract_posts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, post_name TEXT NOT NULL,
  post_type TEXT, headcount INTEGER NOT NULL DEFAULT 1, day_headcount INTEGER NOT NULL DEFAULT 0, night_headcount INTEGER NOT NULL DEFAULT 0, day_even_headcount INTEGER NOT NULL DEFAULT 0, day_odd_headcount INTEGER NOT NULL DEFAULT 0, night_even_headcount INTEGER NOT NULL DEFAULT 0, night_odd_headcount INTEGER NOT NULL DEFAULT 0, shift_regime TEXT, schedule_details TEXT,
  armed INTEGER NOT NULL DEFAULT 0, weapon_type TEXT, weapon_quantity INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, ended_at TEXT, active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_allocations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES contract_posts(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL, end_date TEXT, shift_regime TEXT, active INTEGER NOT NULL DEFAULT 1,
  work_pattern TEXT NOT NULL DEFAULT 'CUSTOM', day_parity TEXT NOT NULL DEFAULT '', shift_period TEXT NOT NULL DEFAULT '',
  cycle_anchor_date TEXT, shift_start TEXT, shift_end TEXT,
  allocation_role TEXT NOT NULL DEFAULT 'TITULAR',
  relief_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  covers_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_allocations_contract ON employee_allocations(organization_id,contract_id,active);
CREATE INDEX IF NOT EXISTS idx_allocations_employee_period ON employee_allocations(organization_id,employee_id,start_date,end_date);

CREATE TABLE IF NOT EXISTS employee_absences (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  absence_type TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  reason TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_absences_employee_period ON employee_absences(organization_id,employee_id,start_date,end_date,active);

CREATE TABLE IF NOT EXISTS schedule_replacements (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES contract_posts(id) ON DELETE SET NULL,
  original_allocation_id TEXT REFERENCES employee_allocations(id) ON DELETE SET NULL,
  absent_employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  substitute_employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  absence_id TEXT REFERENCES employee_absences(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  replacement_type TEXT NOT NULL DEFAULT 'COVERAGE',
  shift_start TEXT, shift_end TEXT, reason TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replacements_contract_period ON schedule_replacements(organization_id,contract_id,start_date,end_date,active);

CREATE TABLE IF NOT EXISTS finance_categories (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'BOTH', active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, bank_name TEXT, agency TEXT, account_number TEXT, pix_key TEXT,
  opening_balance REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL, description TEXT NOT NULL,
  category_id TEXT REFERENCES finance_categories(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, supplier_name TEXT, document_number TEXT,
  issue_date TEXT, due_date TEXT NOT NULL, competence_date TEXT, amount REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0, payment_date TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
  payment_method TEXT, bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  notes TEXT, imported INTEGER NOT NULL DEFAULT 0, import_batch TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_financial_due ON financial_entries(organization_id,due_date,status);
CREATE TABLE IF NOT EXISTS financial_payments (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  financial_entry_id TEXT NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  movement_date TEXT NOT NULL, amount REAL NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  payment_method TEXT, document_number TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, reconciled INTEGER NOT NULL DEFAULT 0,
  bank_transaction_id TEXT,
  source TEXT NOT NULL DEFAULT 'FINANCE',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_at TEXT, reversal_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_payments ON financial_payments(organization_id,bank_account_id,movement_date,reconciled,active);
CREATE INDEX IF NOT EXISTS idx_fin_pay_entry ON financial_payments(organization_id,financial_entry_id,active);
CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  tx_date TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, document_number TEXT,
  external_id TEXT, imported INTEGER NOT NULL DEFAULT 0, import_batch TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0, financial_entry_id TEXT REFERENCES financial_entries(id) ON DELETE SET NULL,
  financial_payment_id TEXT REFERENCES financial_payments(id) ON DELETE SET NULL, movement_origin TEXT NOT NULL DEFAULT 'STATEMENT',
  notes TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_tx ON bank_transactions(organization_id,bank_account_id,tx_date,reconciled);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku TEXT, name TEXT NOT NULL, category TEXT, unit TEXT NOT NULL DEFAULT 'UN', minimum_stock REAL NOT NULL DEFAULT 0,
  current_stock REAL NOT NULL DEFAULT 0, unit_cost REAL NOT NULL DEFAULT 0, location TEXT,
  serial_control INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE, movement_type TEXT NOT NULL,
  quantity REAL NOT NULL, unit_cost REAL, client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL, employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  reference TEXT, notes TEXT, occurred_at TEXT NOT NULL, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patrimony_code TEXT, asset_type TEXT NOT NULL, name TEXT NOT NULL, brand TEXT, model TEXT,
  serial_number TEXT, plate TEXT, acquisition_date TEXT, acquisition_value REAL, warranty_end_date TEXT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_allocations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL, allocated_at TEXT NOT NULL, returned_at TEXT,
  condition_out TEXT, condition_return TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_maintenances (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, opened_at TEXT NOT NULL, closed_at TEXT,
  supplier TEXT, description TEXT NOT NULL, cost REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'OPEN',
  next_maintenance_date TEXT, notes TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uniform_catalog (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku TEXT, name TEXT NOT NULL, size TEXT, unit TEXT NOT NULL DEFAULT 'UN', current_stock REAL NOT NULL DEFAULT 0,
  minimum_stock REAL NOT NULL DEFAULT 0, unit_cost REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uniform_movements (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uniform_id TEXT NOT NULL REFERENCES uniform_catalog(id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL, contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL, quantity REAL NOT NULL, movement_date TEXT NOT NULL, next_exchange_date TEXT,
  reason TEXT, condition_note TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uniform_next ON uniform_movements(organization_id,next_exchange_date);


CREATE TABLE IF NOT EXISTS contract_documents (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL DEFAULT 'OTHER', title TEXT NOT NULL,
  reference_date TEXT, expiration_date TEXT, notes TEXT,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT, uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_documents_contract ON contract_documents(organization_id,contract_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_documents_expiration ON contract_documents(organization_id,expiration_date);

CREATE TABLE IF NOT EXISTS contract_adjustments (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  previous_contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
  adjustment_type TEXT NOT NULL DEFAULT 'REPACTUATION', title TEXT,
  base_monthly_value REAL NOT NULL DEFAULT 0, new_monthly_value REAL NOT NULL DEFAULT 0,
  monthly_difference REAL NOT NULL DEFAULT 0, percentage REAL NOT NULL DEFAULT 0,
  cct_name TEXT, cct_reference TEXT, cct_base_date TEXT,
  signed_date TEXT, financial_effective_date TEXT, retroactive_until_date TEXT,
  retroactive_days INTEGER NOT NULL DEFAULT 0,
  retroactive_amount_calculated REAL NOT NULL DEFAULT 0, retroactive_amount_final REAL NOT NULL DEFAULT 0,
  measurement_value_calculated REAL NOT NULL DEFAULT 0, measurement_value_final REAL NOT NULL DEFAULT 0,
  calculation_method TEXT NOT NULL DEFAULT 'PRO_RATA_30', notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_adjustments_series ON contract_adjustments(organization_id,series_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_adjustments_contract ON contract_adjustments(organization_id,contract_id,created_at DESC);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, ticket_type TEXT NOT NULL DEFAULT 'SUPPORT', title TEXT NOT NULL, description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM', status TEXT NOT NULL DEFAULT 'OPEN',
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL, requester_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL, due_at TEXT, closed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(organization_id,number)
);
CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, user_name TEXT, user_cpf TEXT,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, before_json TEXT, after_json TEXT,
  ip TEXT, user_agent TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org_date ON audit_logs(organization_id,created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT,
  PRIMARY KEY(organization_id,key)
);
  `);
}


function ensureColumn(table,column,definition){
  const cols=all(`PRAGMA table_info(${table})`).map(x=>x.name);
  if(!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
function migrateSchema(){
  const clientCols={
    address_number:'TEXT',complement:'TEXT',neighborhood:'TEXT',zip_code:'TEXT',
    cnpj_status:'TEXT',cnpj_status_date:'TEXT',cnae_code:'TEXT',cnae_description:'TEXT',
    legal_nature:'TEXT',opening_date:'TEXT',capital_social:'REAL NOT NULL DEFAULT 0',
    cnpj_lookup_source:'TEXT',cnpj_lookup_at:'TEXT'
  };
  for(const [c,d] of Object.entries(clientCols))ensureColumn('clients',c,d);
  ensureColumn('contracts','active','INTEGER NOT NULL DEFAULT 1');
  ensureColumn('contracts','archived_at','TEXT');
  ensureColumn('contracts','closed_at','TEXT');
  ensureColumn('contracts','closure_reason','TEXT');
  ensureColumn('contracts','series_id','TEXT');
  ensureColumn('contracts','version_number','INTEGER NOT NULL DEFAULT 1');
  ensureColumn('contracts','previous_contract_id','TEXT REFERENCES contracts(id) ON DELETE SET NULL');
  ensureColumn('contracts','renewed_at','TEXT');
  ensureColumn('contracts','renewal_note','TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_contracts_series ON contracts(organization_id,series_id,version_number)');
  ensureColumn('contract_posts','active','INTEGER NOT NULL DEFAULT 1');
  ensureColumn('contract_posts','day_headcount','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('contract_posts','night_headcount','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('contract_posts','day_even_headcount','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('contract_posts','day_odd_headcount','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('contract_posts','night_even_headcount','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('contract_posts','night_odd_headcount','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('employee_allocations','work_pattern',"TEXT NOT NULL DEFAULT 'CUSTOM'");
  ensureColumn('employee_allocations','day_parity',"TEXT NOT NULL DEFAULT ''");
  ensureColumn('employee_allocations','shift_period',"TEXT NOT NULL DEFAULT ''");
  ensureColumn('employee_allocations','cycle_anchor_date','TEXT');
  ensureColumn('employee_allocations','shift_start','TEXT');
  ensureColumn('employee_allocations','shift_end','TEXT');
  ensureColumn('employee_allocations','allocation_role',"TEXT NOT NULL DEFAULT 'TITULAR'");
  ensureColumn('employee_allocations','relief_employee_id','TEXT REFERENCES employees(id) ON DELETE SET NULL');
  ensureColumn('employee_allocations','covers_employee_id','TEXT REFERENCES employees(id) ON DELETE SET NULL');
  // Preenche a classificação de turno dos vínculos antigos sem alterar a escala histórica.
  run(`UPDATE employee_allocations SET shift_period=CASE
    WHEN lower(COALESCE(shift_regime,'')) LIKE '%noturn%' THEN 'NIGHT'
    WHEN lower(COALESCE(shift_regime,'')) LIKE '%noite%' THEN 'NIGHT'
    WHEN shift_start<>'' AND (substr(shift_start,1,2)>='18' OR substr(shift_start,1,2)<'06') THEN 'NIGHT'
    WHEN shift_start<>'' THEN 'DAY'
    ELSE 'OTHER' END
    WHERE shift_period IS NULL OR shift_period=''`);
  // v2.6: matrícula e CPF de colaborador são identificadores únicos por empresa.
  // Triggers são usados em vez de uma migração destrutiva: mesmo que uma base antiga já
  // contenha duplicidades, novos cadastros/alterações passam a ser bloqueados até a correção.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_employee_registration_unique_insert
    BEFORE INSERT ON employees
    WHEN trim(COALESCE(NEW.registration,''))<>'' AND EXISTS (
      SELECT 1 FROM employees e WHERE e.organization_id=NEW.organization_id
        AND lower(trim(COALESCE(e.registration,'')))=lower(trim(NEW.registration))
    )
    BEGIN SELECT RAISE(ABORT,'MATRICULA_DUPLICADA'); END;
    CREATE TRIGGER IF NOT EXISTS trg_employee_registration_unique_update
    BEFORE UPDATE OF registration,organization_id ON employees
    WHEN trim(COALESCE(NEW.registration,''))<>'' AND EXISTS (
      SELECT 1 FROM employees e WHERE e.organization_id=NEW.organization_id AND e.id<>NEW.id
        AND lower(trim(COALESCE(e.registration,'')))=lower(trim(NEW.registration))
    )
    BEGIN SELECT RAISE(ABORT,'MATRICULA_DUPLICADA'); END;
    CREATE TRIGGER IF NOT EXISTS trg_employee_cpf_unique_insert
    BEFORE INSERT ON employees
    WHEN trim(COALESCE(NEW.cpf,''))<>'' AND EXISTS (
      SELECT 1 FROM employees e WHERE e.organization_id=NEW.organization_id
        AND trim(COALESCE(e.cpf,''))=trim(NEW.cpf)
    )
    BEGIN SELECT RAISE(ABORT,'CPF_DUPLICADO'); END;
    CREATE TRIGGER IF NOT EXISTS trg_employee_cpf_unique_update
    BEFORE UPDATE OF cpf,organization_id ON employees
    WHEN trim(COALESCE(NEW.cpf,''))<>'' AND EXISTS (
      SELECT 1 FROM employees e WHERE e.organization_id=NEW.organization_id AND e.id<>NEW.id
        AND trim(COALESCE(e.cpf,''))=trim(NEW.cpf)
    )
    BEGIN SELECT RAISE(ABORT,'CPF_DUPLICADO'); END;
  `);

  ensureColumn('bank_accounts','notes','TEXT');
  ensureColumn('bank_transactions','financial_payment_id','TEXT REFERENCES financial_payments(id) ON DELETE SET NULL');
  ensureColumn('bank_transactions','movement_origin',"TEXT NOT NULL DEFAULT 'STATEMENT'");

  // Cada contrato existente passa a ser a versão 1 de sua própria série.
  run(`UPDATE contracts SET series_id=id WHERE series_id IS NULL OR series_id=''`);
  run(`UPDATE contracts SET version_number=1 WHERE version_number IS NULL OR version_number<1`);

  // Converte baixas antigas (v2.1 e anteriores) em movimentos financeiros explícitos,
  // para que apareçam na conciliação por banco e data sem perder histórico.
  const legacy=all(`SELECT f.* FROM financial_entries f
    WHERE f.paid_amount>0 AND NOT EXISTS (
      SELECT 1 FROM financial_payments p WHERE p.financial_entry_id=f.id AND p.active=1
    )`);
  for(const f of legacy){
    const pid=id(), t=now(), d=f.payment_date||f.due_date||String(t).slice(0,10);
    run(`INSERT INTO financial_payments(id,organization_id,financial_entry_id,movement_date,amount,bank_account_id,payment_method,document_number,notes,active,reconciled,source,created_by,created_at,updated_at)
      VALUES(:id,:o,:e,:d,:a,:b,:pm,:doc,:notes,1,0,'LEGACY',:u,:t,:t)`,{
      id:pid,o:f.organization_id,e:f.id,d,a:Number(f.paid_amount||0),b:f.bank_account_id||null,
      pm:f.payment_method||'',doc:f.document_number||'',notes:'Baixa migrada automaticamente da versão anterior.',u:f.created_by||null,t
    });
    const tx=get(`SELECT id FROM bank_transactions WHERE organization_id=:o AND financial_entry_id=:e AND reconciled=1 ORDER BY tx_date DESC LIMIT 1`,{o:f.organization_id,e:f.id});
    if(tx){
      run('UPDATE financial_payments SET reconciled=1,bank_transaction_id=:tx WHERE id=:id',{tx:tx.id,id:pid});
      run('UPDATE bank_transactions SET financial_payment_id=:p WHERE id=:id',{p:pid,id:tx.id});
    }
  }

  // v2.4: cria uma linha-base para saldos antigos que nasceram diretamente no cadastro.
  // Isso permite editar/excluir movimentos e recalcular o saldo sem perder o estoque inicial histórico.
  for(const u of all(`SELECT * FROM uniform_catalog WHERE NOT EXISTS (SELECT 1 FROM uniform_movements m WHERE m.uniform_id=uniform_catalog.id AND m.movement_type='ADJUSTMENT')`)){
    const ms=all(`SELECT * FROM uniform_movements WHERE uniform_id=:id AND organization_id=:o ORDER BY movement_date,created_at`,{id:u.id,o:u.organization_id});
    let net=0;for(const m of ms){const q=Number(m.quantity||0);if(['PURCHASE','RETURN'].includes(m.movement_type))net+=Math.abs(q);else if(['DELIVERY','LOSS','EXCHANGE'].includes(m.movement_type))net-=Math.abs(q);}
    const baseline=Number(u.current_stock||0)-net;if(Math.abs(baseline)>0.000001){const t=u.created_at||now(),d=String(t).slice(0,10)||String(now()).slice(0,10);run(`INSERT INTO uniform_movements(id,organization_id,uniform_id,movement_type,quantity,movement_date,reason,condition_note,created_at) VALUES(:id,:o,:u,'ADJUSTMENT',:q,:d,'SALDO INICIAL','Linha-base criada automaticamente na migração v2.4 para preservar o saldo anterior.',:t)`,{id:id(),o:u.organization_id,u:u.id,q:baseline,d,t});}
  }
  for(const i of all(`SELECT * FROM inventory_items WHERE NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.item_id=inventory_items.id AND m.movement_type='ADJUSTMENT')`)){
    const ms=all(`SELECT * FROM inventory_movements WHERE item_id=:id AND organization_id=:o ORDER BY occurred_at,created_at`,{id:i.id,o:i.organization_id});let net=0;for(const m of ms){const q=Number(m.quantity||0);if(['IN','RETURN'].includes(m.movement_type))net+=Math.abs(q);else if(m.movement_type==='OUT')net-=Math.abs(q);}const baseline=Number(i.current_stock||0)-net;if(Math.abs(baseline)>0.000001){const t=i.created_at||now();run(`INSERT INTO inventory_movements(id,organization_id,item_id,movement_type,quantity,unit_cost,reference,notes,occurred_at,created_at) VALUES(:id,:o,:item,'ADJUSTMENT',:q,:cost,'SALDO INICIAL','Linha-base criada automaticamente na migração v2.4.',:t,:t)`,{id:id(),o:i.organization_id,item:i.id,q:baseline,cost:Number(i.unit_cost||0),t});}
  }
}

function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored){
  try{
    const [alg,salt,hash]=String(stored).split('$'); if(alg!=='scrypt') return false;
    const got=crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(got, Buffer.from(hash,'hex'));
  }catch{return false;}
}

function seed(){
  const count=get('SELECT COUNT(*) AS c FROM organizations').c;
  if(Number(count)>0) return;
  const orgId=id(), userId=id(), t=now();
  transaction(()=>{
    run(`INSERT INTO organizations(id,name,document,active,created_at,updated_at) VALUES(:id,:name,'',1,:t,:t)`,{id:orgId,name:'Minha Empresa',t});
    run(`INSERT INTO users(id,organization_id,cpf,name,email,password_hash,role,active,must_change_password,created_at,updated_at)
         VALUES(:id,:org,:cpf,:name,:email,:hash,'SUPERADMIN',1,1,:t,:t)`,{
      id:userId,org:orgId,cpf:'00000000000',name:'Administrador Geral',email:'admin@local',hash:hashPassword('Admin@123'),t
    });
    for(const [name,type] of [['Receitas de contratos','RECEIVABLE'],['Fornecedores','PAYABLE'],['Folha e pessoal','PAYABLE'],['Impostos','PAYABLE'],['Outros','BOTH']]){
      run('INSERT INTO finance_categories(id,organization_id,name,type,active) VALUES(:id,:org,:name,:type,1)',{id:id(),org:orgId,name,type});
    }
  });
}

initSchema(); migrateSchema(); seed();
module.exports={db,DB_PATH,run,get,all,exec,transaction,id,now,hashPassword,verifyPassword};
