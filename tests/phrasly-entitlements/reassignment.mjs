import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {PGlite} from '@electric-sql/pglite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),db=new PGlite(),checks=[];
const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const sql=fs.readFileSync(path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_phrasly_reassignment_feature_restore.sql'))),'utf8');
const rows=async(q,args=[])=>(await db.query(q,args)).rows;
const state=()=>rows('select feature_key,daily_limit,enabled,is_unlimited from public.phrasly_oneclick_feature_grants where user_id=$1 order by feature_key',[uid]);
const enabled=async()=>assert.ok((await state()).every(f=>f.enabled&&f.is_unlimited));
const revoke=()=>db.query('update public.phrasly_oneclick_feature_grants set enabled=false where user_id=$1',[uid]);
const disabled=async()=>assert.ok((await state()).every(f=>!f.enabled));
const order=(id,extra='')=>db.query(`insert into public.tool_orders(id,user_id,tool_slug,status,payment_status${extra?',expires_at':''}) values($1,$2,'phrasly','approved','successful'${extra?",'2000-01-01'":''})`,[id,uid]);
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create type public.app_role as enum('admin','user');create table auth.users(id uuid primary key);insert into auth.users values('${uid}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select '${uid}'::uuid$$;create function public.has_role(uuid,public.app_role) returns boolean language sql stable as $$select coalesce(current_setting('test.is_admin',true),'false')='true'$$;
 create table public.tool_access_grants(id text primary key,user_id uuid,tool_slug text,status text,expires_at timestamptz);
 create table public.tool_orders(id text primary key,user_id uuid,tool_slug text,status text,payment_status text,expires_at timestamptz,access_type text default 'shared',fulfilment_status text default 'not_required');
 create table public.phrasly_oneclick_feature_grants(user_id uuid,tool_id text,feature_key text,daily_limit integer,enabled boolean,is_unlimited boolean default false,primary key(user_id,tool_id,feature_key));alter table public.phrasly_oneclick_feature_grants enable row level security;
 create table public.phrasly_oneclick_activity(id bigserial primary key,user_id uuid,event_type text);
 create table public.phrasly_oneclick_daily_usage(user_id uuid,used integer);insert into public.phrasly_oneclick_daily_usage values('${uid}',7);
 grant usage on schema public,auth to anon,authenticated,service_role;grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;grant select,insert,update on public.tool_orders to authenticated;`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261027071059_phrasly_entitlement_feature_sync.sql'),'utf8'));
 await db.exec(sql);await db.exec('set role service_role');
 await check('new paid assignment provisions unlimited Humanizer and AI Detector',async()=>{await order('initial');assert.equal((await state()).length,2);await enabled();});
 await check('new assignment after revocation restores both existing permissions',async()=>{await revoke();await db.query('update public.phrasly_oneclick_feature_grants set daily_limit=63 where user_id=$1',[uid]);await order('reassignment');await enabled();assert.ok((await state()).every(f=>f.daily_limit===63));assert.equal((await rows('select used from public.phrasly_oneclick_daily_usage'))[0].used,7);});
 await check('same-source webhook retry does not undo explicit revocation',async()=>{await revoke();await db.exec("update public.tool_orders set payment_status='successful',status='approved' where id='reassignment'");await disabled();});
 await check('pending checkout cannot restore revoked access',async()=>{await db.query("insert into public.tool_orders values('pending',$1,'phrasly','pending','pending',null,'shared','not_required')",[uid]);await disabled();});
 await check('payment and approval transition restores access',async()=>{await db.exec("update public.tool_orders set status='approved',payment_status='successful' where id='pending'");await enabled();});
 await check('expired assignment does not restore access until renewed',async()=>{await revoke();await order('expired','yes');await disabled();await db.exec("update public.tool_orders set expires_at=now()+interval '1 month' where id='expired'");await enabled();});
 await check('private assignment waits for active fulfilment',async()=>{await revoke();await db.query("insert into public.tool_orders values('private',$1,'phrasly','approved','successful',null,'private','pending')",[uid]);await disabled();await db.exec("update public.tool_orders set fulfilment_status='active' where id='private'");await enabled();});
 await check('reactivated Admin grant restores permissions',async()=>{await revoke();await db.query("insert into public.tool_access_grants values('admin-grant',$1,'phrasly','revoked',null)",[uid]);await disabled();await db.exec("update public.tool_access_grants set status='active' where id='admin-grant'");await enabled();});
 await check('unrelated tools and users keep their permissions',async()=>{await revoke();await db.query("insert into public.phrasly_oneclick_feature_grants values($1,'phrasly','humanizer',47,false,false)",[other]);await db.query("insert into public.tool_access_grants values('other-tool',$1,'stealthwriter','active',null)",[uid]);await disabled();assert.equal((await rows('select enabled from public.phrasly_oneclick_feature_grants where user_id=$1',[other]))[0].enabled,false);});
 await check('reapplying the migration preserves existing revoked access',async()=>{await db.exec('reset role');await db.exec(sql);await disabled();});
 await check('ordinary customers cannot provision or reactivate permissions',async()=>{await db.exec("set role authenticated;set test.is_admin='false'");await order('untrusted');await db.exec('reset role');await disabled();});
 await check('authorized Admin assignment reactivates permissions',async()=>{await db.exec("set role authenticated;set test.is_admin='true'");await order('admin');await db.exec('reset role');await enabled();});
 await check('trigger remains private with fixed search path',async()=>{for(const role of ['anon','authenticated'])assert.equal((await rows("select has_function_privilege($1,'phrasly_internal.seed_entitled_features()','execute') ok",[role]))[0].ok,false);assert.ok((await rows("select proconfig from pg_proc where oid='phrasly_internal.seed_entitled_features()'::regprocedure"))[0].proconfig.includes('search_path=""'));});
 await check('source records and usage totals are preserved by provisioning',async()=>{assert.equal((await rows("select status,payment_status from public.tool_orders where id='initial'"))[0].status,'approved');assert.equal((await rows('select used from public.phrasly_oneclick_daily_usage'))[0].used,7);});
 console.log(JSON.stringify({status:'PASS',checks:checks.length,cases:checks}));
}finally{await db.close();}
