import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),db=new PGlite(),checks=[];
const user='00000000-0000-4000-8000-000000000001';
const rows=async sql=>(await db.query(sql)).rows;
const attempt=async feature=>(await db.query('select * from public.phrasly_oneclick_count_attempt($1,$2)',[user,feature])).rows[0];
const migration=fs.readFileSync(path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_phrasly_user_usage_limits.sql'))),'utf8');
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values ('"+user+"');");
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261026080000_phrasly_aws_oneclick_phase3.sql'),'utf8'));
 await db.exec(`insert into public.phrasly_oneclick_feature_grants values ('${user}','phrasly','humanizer',2,true),('${user}','phrasly','ai_detector',7,false);`);
 await db.exec(migration);
 await check('new flag defaults to finite and retains numeric cap and revocation',async()=>assert.deepEqual(await rows('select daily_limit,enabled,is_unlimited from public.phrasly_oneclick_feature_grants order by feature_key'),[{daily_limit:7,enabled:false,is_unlimited:false},{daily_limit:2,enabled:true,is_unlimited:false}]));
 await check('finite requests count and stop exactly at the configured cap',async()=>{assert.equal((await attempt('humanizer')).allowed,true);assert.equal((await attempt('humanizer')).used,2);const r=await attempt('humanizer');assert.equal(r.allowed,false);assert.equal(r.used,2);assert.equal(r.daily_limit,2);assert.ok(r.resets_in>0&&r.resets_in<=86400);});
 await db.exec("update public.phrasly_oneclick_feature_grants set is_unlimited=true where feature_key='humanizer'");
 await check('removing the cap permits usage above the old cap and still records attempts',async()=>{for(let i=0;i<12;i++){const r=await attempt('humanizer');assert.equal(r.allowed,true);assert.equal(r.daily_limit,null);}assert.equal((await attempt('humanizer')).used,15);});
 await check('reapplying the additive migration preserves Admin settings and usage',async()=>{await db.exec(migration);assert.equal((await rows("select is_unlimited from public.phrasly_oneclick_feature_grants where feature_key='humanizer'"))[0].is_unlimited,true);assert.equal((await rows('select used from public.phrasly_oneclick_daily_usage'))[0].used,15);});
 await db.exec("update public.phrasly_oneclick_feature_grants set is_unlimited=false,daily_limit=16 where feature_key='humanizer'");
 await check('adding or editing a limit uses the existing daily count',async()=>{assert.equal((await attempt('humanizer')).allowed,true);assert.equal((await attempt('humanizer')).allowed,false);});
 await db.exec("update public.phrasly_oneclick_feature_grants set is_unlimited=true where feature_key='ai_detector'");
 await check('unlimited does not reactivate a revoked feature',async()=>{await assert.rejects(attempt('ai_detector'),/no_access/);});
 await check('invalid or null feature is rejected',async()=>{await assert.rejects(attempt('other'),/bad_feature/);await assert.rejects(attempt(null),/bad_feature/);});
 await check('missing grants are rejected',async()=>{await assert.rejects(attempt('default'),/no_access/);});
 await check('anonymous and customer roles cannot invoke the counter or change limits',async()=>{for(const role of ['anon','authenticated']){assert.equal((await rows(`select has_function_privilege('${role}','public.phrasly_oneclick_count_attempt(uuid,text)','EXECUTE') ok`))[0].ok,false);assert.equal((await rows(`select has_table_privilege('${role}','public.phrasly_oneclick_feature_grants','UPDATE') ok`))[0].ok,false);}});
 await check('only the service role can execute and the counter has a fixed search path',async()=>{assert.equal((await rows("select has_function_privilege('service_role','public.phrasly_oneclick_count_attempt(uuid,text)','EXECUTE') ok"))[0].ok,true);assert.ok((await rows("select proconfig from pg_proc where proname='phrasly_oneclick_count_attempt'"))[0].proconfig.includes('search_path=""'));});
 console.log(JSON.stringify({status:'PASS',checks:checks.length}));
}finally{await db.close();}
