const express=require('express');
const session=require('express-session');
const helmet=require('helmet');
const Database=require('better-sqlite3');
const fs=require('fs');
const path=require('path');
const app=express(), prod=process.env.NODE_ENV==='production';
const password=process.env.ADMIN_PASSWORD;
const secret=process.env.SESSION_SECRET||(prod?null:'local-only-change-me');
const dbPath=process.env.DATABASE_PATH||path.join(__dirname,'data','menu.sqlite');
if(prod&&(!password||!secret)){console.error('Set ADMIN_PASSWORD and SESSION_SECRET');process.exit(1)}
fs.mkdirSync(path.dirname(dbPath),{recursive:true});
const db=new Database(dbPath); db.pragma('journal_mode=WAL');
db.exec(`CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY,name TEXT UNIQUE,sort_order INTEGER DEFAULT 0,enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY,category_id INTEGER REFERENCES categories(id),name TEXT NOT NULL,price_text TEXT DEFAULT '',description TEXT DEFAULT '',popup_enabled INTEGER DEFAULT 0,sort_order INTEGER DEFAULT 0,enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
if(db.prepare('SELECT COUNT(*) n FROM categories').get().n===0){
 const addC=db.prepare('INSERT INTO categories(name,sort_order) VALUES(?,?)'),addS=db.prepare('INSERT INTO services(category_id,name,price_text,sort_order) VALUES(?,?,?,?)');
 const seed=[
 ['FLUID CHANGES',[['Conventional Oil Change','From $120'],['Full Synthetic Oil Change','From $140'],['European Oil Change','From $190'],['Brake Fluid Flush','From $140'],['Coolant Replacement','From $150'],['Differential Fluid','From $150'],['Transfer Case Fluid','From $150'],['Transmission Fluid Change','From $180']]],
 ['INSPECTION',[['Brake Inspection','$60'],['Suspension Inspection','$60'],['Exhaust Inspection','No Charge'],['Battery Inspection','$40'],['Multi-Point Inspection','From $120'],['Pre-Purchase Inspection','From $200'],['MTO Safety Inspection','From $150']]],
 ['DIAGNOSTIC',[['Computer Scan + Report','From $60'],['Noise Diagnostic','From $120'],['Warning Light Diagnostic','From $180'],['A/C Diagnostic','From $180'],['Fluid Leak Diagnostic','From $120'],['No Start Diagnostic','From $120'],['Other Diagnostic','From $120']]],
 ['TIRES & WHEELS',[['Seasonal Tire Change','From $70'],['Mount & Balance','From $40 / tire'],['Wheel Alignment','From $100'],['Road Force Balance','From $120'],['Tire Repair','From $50'],['Tire Rotation','From $40'],['TPMS Reprogram','From $45']]],
 ['MAINTENANCE',[['Engine Air Filter','From $49'],['Cabin Air Filter','From $66'],['Wiper Blades','$25 / each'],['Brake Service','From $120 / axle'],['Spark Plug Replacement','Ask Us'],['Battery Replacement','Ask Us'],['Windshield Replacement','Ask Us'],['Rubberized Undercoating','From $350']]]];
 const tx=db.transaction(()=>{seed.forEach((c,i)=>{let id=addC.run(c[0],i).lastInsertRowid;c[1].forEach((s,j)=>addS.run(id,s[0],s[1],j))});const q=db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)');[['labor_rate','$120/hr'],['website','LEVELAUTO.COM'],['address','2212 KINGSTON ROAD • SCARBOROUGH'],['phone','(647) 436-5940'],['footer_line','AUTO REPAIR • TIRES • DIAGNOSTICS • MAINTENANCE']].forEach(x=>q.run(...x))});tx();
}
app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],scriptSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"]}}}));
app.use(express.json({limit:'100kb'}));app.use(session({name:'levelauto.sid',secret,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:prod,maxAge:8*60*60*1000}}));
app.use(express.static(path.join(__dirname,'public')));
function admin(req,res,next){if(req.session?.isAdmin)return next();res.status(401).json({error:'Login required'})}
function menu(){const cats=db.prepare('SELECT id,name,sort_order FROM categories WHERE enabled=1 ORDER BY sort_order,id').all(),services=db.prepare('SELECT * FROM services WHERE enabled=1 ORDER BY sort_order,id').all(),settings=Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(x=>[x.key,x.value]));return{categories:cats.map(c=>({...c,services:services.filter(s=>s.category_id===c.id).map(s=>({...s,popup_enabled:!!s.popup_enabled}))})),settings}}
app.get('/health',(_,r)=>r.json({ok:true,service:'levelauto-menu'}));app.get('/api/menu',(_,r)=>r.json(menu()));
app.get('/api/admin/session',(q,r)=>r.json({authenticated:!!q.session?.isAdmin}));
app.post('/api/admin/login',(q,r)=>{if(!password)return r.status(503).json({error:'Admin password not configured'});if(String(q.body.password||'')!==password)return r.status(401).json({error:'Incorrect password'});q.session.isAdmin=true;r.json({ok:true})});
app.post('/api/admin/logout',admin,(q,r)=>q.session.destroy(()=>r.json({ok:true})));
app.get('/api/admin/menu',admin,(_,r)=>r.json(menu()));
app.put('/api/admin/services/:id',admin,(q,r)=>{const b=q.body,id=Number(q.params.id),name=String(b.name||'').trim(),price=String(b.price_text||'').trim(),description=String(b.description||'').trim();if(!Number.isInteger(id)||!name||name.length>120||price.length>80||description.length>2000)return r.status(400).json({error:'Invalid field values'});const x=db.prepare('UPDATE services SET name=?,price_text=?,description=?,popup_enabled=? WHERE id=?').run(name,price,description,b.popup_enabled?1:0,id);if(!x.changes)return r.status(404).json({error:'Service not found'});r.json({ok:true})});
app.post('/api/admin/services',admin,(q,r)=>{const b=q.body,id=Number(b.category_id),name=String(b.name||'').trim();if(!Number.isInteger(id)||!name)return r.status(400).json({error:'Category and service name required'});const max=db.prepare('SELECT COALESCE(MAX(sort_order),-1) n FROM services WHERE category_id=?').get(id).n;const x=db.prepare('INSERT INTO services(category_id,name,price_text,description,popup_enabled,sort_order) VALUES(?,?,?,?,?,?)').run(id,name,String(b.price_text||''),String(b.description||''),b.popup_enabled?1:0,max+1);r.status(201).json({ok:true,id:x.lastInsertRowid})});
app.delete('/api/admin/services/:id',admin,(q,r)=>{const x=db.prepare('DELETE FROM services WHERE id=?').run(Number(q.params.id));if(!x.changes)return r.status(404).json({error:'Not found'});r.json({ok:true})});
app.put('/api/admin/settings',admin,(q,r)=>{const up=db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');for(const k of ['labor_rate','website','address','phone','footer_line'])if(q.body[k]!==undefined)up.run(k,String(q.body[k]).slice(0,200));r.json({ok:true})});
app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('LEVEL AUTO menu web service ready'));