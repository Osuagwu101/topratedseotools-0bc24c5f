import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
export class WriterStore{
 constructor(path,now=()=>Date.now()){this.now=now;this.db=new DatabaseSync(path);fs.chmodSync(path,0o600);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS limits(user TEXT PRIMARY KEY, daily INTEGER NOT NULL DEFAULT 25); CREATE TABLE IF NOT EXISTS usage(user TEXT,day TEXT,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user,day));');this.db.exec('CREATE TABLE IF NOT EXISTS history(user TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,fingerprint TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(user,id),UNIQUE(user,fingerprint)); CREATE INDEX IF NOT EXISTS qb_history_owner_date ON history(user,created);');this.db.exec('CREATE TABLE IF NOT EXISTS pending_usage(id TEXT PRIMARY KEY,user TEXT NOT NULL,day TEXT NOT NULL);');this.operations=new Map();}
 saveHistory(user,payload,fingerprint){this.db.prepare('INSERT OR IGNORE INTO history(user,id,payload,fingerprint,created) VALUES (?,?,?,?,?)').run(user,randomUUID(),payload,fingerprint,new Date().toISOString());}
 history(user){return this.db.prepare('SELECT id,payload,created FROM history WHERE user=? ORDER BY created DESC LIMIT 50').all(user);}
 day(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date(this.now()));}
 status(user){return {daily_limit:this.db.prepare('SELECT daily FROM limits WHERE user=?').get(user)?.daily??25,used:this.db.prepare('SELECT count FROM usage WHERE user=? AND day=?').get(user,this.day())?.count??0,reset_timezone:'Africa/Lagos'};}
 setLimit(user,daily){if(!/^[0-9a-f-]{36}$/i.test(user)||!Number.isInteger(daily)||daily<0||daily>10000)throw Error('Invalid limit');this.db.prepare('INSERT INTO limits(user,daily) VALUES (?,?) ON CONFLICT(user) DO UPDATE SET daily=excluded.daily').run(user,daily);}
 recoverAbandoned(){this.db.exec('BEGIN IMMEDIATE');try{for(const row of this.db.prepare('SELECT user,day FROM pending_usage').all())this.db.prepare('UPDATE usage SET count=max(0,count-1) WHERE user=? AND day=?').run(row.user,row.day);this.db.exec('DELETE FROM pending_usage; COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 reserve(user,input){const day=this.day(),id=randomUUID();this.db.exec('BEGIN IMMEDIATE');try{const s=this.status(user);if(s.used>=s.daily_limit){this.db.exec('ROLLBACK');return null;}this.db.prepare('INSERT INTO usage(user,day,count) VALUES (?,?,1) ON CONFLICT(user,day) DO UPDATE SET count=count+1').run(user,day);this.db.prepare('INSERT INTO pending_usage(id,user,day) VALUES (?,?,?)').run(id,user,day);this.db.exec('COMMIT');}catch(e){try{this.db.exec('ROLLBACK')}catch{}throw e;}
 for(const [key,v] of this.operations)if(v.expires<this.now())this.operations.delete(key);
 this.operations.set(id,{user,input,day,expires:this.now()+120000,seen:new Set(),outputs:new Set(),calls:0,mode:null});return id;}
 validate(user,id,text,mode){const op=this.operations.get(id);if(!op||op.user!==user||op.expires<this.now()||typeof text!=='string'||!op.input.includes(text))return false;if(op.mode!==null&&op.mode!==mode)return false;op.mode=mode;const key=mode+':'+text;if(op.seen.has(key))return false;op.seen.add(key);return true;}
 recordOutput(user,id,data){const op=this.operations.get(id);if(!op||op.user!==user)return;const visit=(value,key='')=>{if(typeof value==='string'&&/^(?:alt|text|para|paraphrase|output|sent)$/.test(key))op.outputs.add(value);else if(Array.isArray(value))value.forEach(v=>visit(v,key));else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))visit(v,k);};visit(data);if(op.outputs.size)this.db.prepare('DELETE FROM pending_usage WHERE id=? AND user=?').run(id,user);}
 helper(user,id,path,data){const op=this.operations.get(id);if(!op||op.user!==user||op.expires<this.now()||++op.calls>3000)return false;
 if(path.endsWith('/single-flip'))return typeof data.text==='string'&&op.input.includes(data.text)&&op.outputs.has(data.alt)&&String(op.mode).endsWith('/'+data.mode);
 if(path.endsWith('/chunker'))return op.outputs.has(data.text)||op.input.includes(data.text);
 if(path.endsWith('/paraphrase-thesaurus'))return Array.isArray(data.phrases)&&data.phrases.every(p=>typeof p==='string'&&[...op.outputs].some(text=>text.includes(p)));
 return false;
 }
 authorize(user,id){const op=this.operations.get(id);return !!op&&op.user===user&&op.expires>this.now();}
 fail(user,id){const op=this.operations.get(id);if(op?.user===user && op.outputs.size===0)this.refund(user,id);}
 refund(user,id){const op=this.operations.get(id);if(op?.user!==user)return;this.db.exec('BEGIN IMMEDIATE');try{const pending=this.db.prepare('SELECT day FROM pending_usage WHERE id=? AND user=?').get(id,user);if(pending){this.db.prepare('UPDATE usage SET count=max(0,count-1) WHERE user=? AND day=?').run(user,pending.day);this.db.prepare('DELETE FROM pending_usage WHERE id=? AND user=?').run(id,user);}this.db.exec('COMMIT');this.operations.delete(id);}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
