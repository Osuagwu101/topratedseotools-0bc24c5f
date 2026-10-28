import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const migrationName=fs.readdirSync(path.join(root,"supabase/migrations")).find(n=>n.endsWith("_phrasly_entitlement_feature_sync.sql"));
assert.ok(migrationName,"CLI-generated migration exists");
const migration=fs.readFileSync(path.join(root,"supabase/migrations",migrationName),"utf8");
const db=new PGlite();
const checks=[];
const uid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const features=async(n)=>rows("select feature_key,daily_limit,enabled from public.phrasly_oneclick_feature_grants where user_id=$1 and tool_id='phrasly' order by feature_key",[uid(n)]);
const hasAccess=async(n)=>(await rows(`select exists(
 select 1 from public.tool_access_grants where user_id=$1 and tool_slug='phrasly' and status='active' and (expires_at is null or expires_at>now())
 union all
 select 1 from public.tool_orders where user_id=$1 and tool_slug='phrasly' and status='approved' and payment_status='successful' and (expires_at is null or expires_at>now()) and (access_type is distinct from 'private' or fulfilment_status='active')
) as allowed`,[uid(n)]))[0].allowed;
async function check(name,fn){await fn();checks.push(name);console.log("PASS "+name);}
async function order(n,extra={}) {
 const data={id:"order-"+n,user_id:uid(n),tool_slug:"phrasly",status:"approved",payment_status:"successful",...extra};
 const keys=Object.keys(data);
 await db.query("insert into public.tool_orders ("+keys.join(",")+") values ("+keys.map((_,i)=>"$"+(i+1)).join(",")+")",Object.values(data));
}
async function grant(n,extra={}) {
 const data={id:"grant-"+n,user_id:uid(n),tool_slug:"phrasly",status:"active",...extra},keys=Object.keys(data);
 await db.query("insert into public.tool_access_grants ("+keys.join(",")+") values ("+keys.map((_,i)=>"$"+(i+1)).join(",")+")",Object.values(data));
}
try {
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE TABLE auth.users(id uuid primary key);
 INSERT INTO auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,100) n;
 CREATE FUNCTION auth.uid() returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 CREATE FUNCTION public.has_role(uuid,public.app_role) returns boolean language sql stable as $$select coalesce(current_setting('test.is_admin',true),'false')='true'$$;
 CREATE TABLE public.tool_access_grants(id text primary key,user_id uuid references auth.users,tool_slug text,status text,expires_at timestamptz);
 CREATE TABLE public.tool_orders(id text primary key,user_id uuid references auth.users,tool_slug text,status text,payment_status text,expires_at timestamptz,access_type text default 'shared',fulfilment_status text default 'not_required');
 CREATE TABLE public.phrasly_oneclick_feature_grants(user_id uuid references auth.users,tool_id text,feature_key text,daily_limit integer check(daily_limit>0),enabled boolean,primary key(user_id,tool_id,feature_key));
 ALTER TABLE public.phrasly_oneclick_feature_grants ENABLE ROW LEVEL SECURITY;
 CREATE TABLE public.phrasly_oneclick_activity(id bigserial primary key,user_id uuid references auth.users,event_type text);
 GRANT USAGE ON SCHEMA public,auth TO service_role,anon,authenticated;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
 -- Deliberately permissive source-table fixture: the trigger must still reject
 -- customer-supplied approvals; production source-table RLS is unchanged.
 GRANT SELECT,INSERT,UPDATE ON public.tool_orders TO authenticated;
 `);
 await order(2);
 await grant(3,{expires_at:"2000-01-01"});
 await order(4,{status:"pending",payment_status:"pending"});
 await order(5);
 await db.query("insert into public.phrasly_oneclick_feature_grants values ($1,'phrasly','humanizer',47,false)",[uid(5)]);
 await db.exec(migration);
 await check("backfill repairs both missing permissions for an existing paid entitlement",async()=>assert.deepEqual((await features(2)).map(f=>[f.daily_limit,f.enabled]),[[20,true],[20,true]]));
 await check("backfill excludes expired Admin access",async()=>assert.equal((await features(3)).length,0));
 await check("backfill excludes unpaid orders",async()=>assert.equal((await features(4)).length,0));
 await check("backfill preserves explicit revocation and custom limit",async()=>assert.deepEqual(await features(5),[{feature_key:"ai_detector",daily_limit:20,enabled:true},{feature_key:"humanizer",daily_limit:47,enabled:false}]));
 const before=await rows("select count(*)::int n from public.phrasly_oneclick_activity");
 await db.exec(migration);
 await check("migration is idempotent without duplicate permissions or audit events",async()=>assert.deepEqual(await rows("select count(*)::int n from public.phrasly_oneclick_activity"),before));
 await db.exec("set role service_role");
 await check("Admin assignment provisions both native features atomically",async()=>{await grant(10);assert.equal((await features(10)).length,2);});
 await check("direct approved paid purchase provisions both features",async()=>{await order(11);assert.equal((await features(11)).length,2);});
 await check("pending checkout has no native permissions",async()=>{await order(12,{status:"pending",payment_status:"pending"});assert.equal((await features(12)).length,0);});
 await check("payment confirmation provisions at successful approved transition",async()=>{await db.query("update public.tool_orders set status='approved',payment_status='successful' where id='order-12'");assert.equal((await features(12)).length,2);});
 await check("approval before payment does not provision",async()=>{await order(13,{payment_status:"pending"});assert.equal((await features(13)).length,0);});
 await check("later successful payment completes an already approved entitlement",async()=>{await db.query("update public.tool_orders set payment_status='successful' where id='order-13'");assert.equal((await features(13)).length,2);});
 await check("payment before approval does not provision",async()=>{await order(14,{status:"pending"});assert.equal((await features(14)).length,0);});
 await check("later approval completes a successful payment",async()=>{await db.query("update public.tool_orders set status='approved' where id='order-14'");assert.equal((await features(14)).length,2);});
 await check("private access waits for active fulfilment",async()=>{await order(15,{access_type:"private",fulfilment_status:"pending"});assert.equal((await features(15)).length,0);});
 await check("private fulfilment activation provisions both features",async()=>{await db.query("update public.tool_orders set fulfilment_status='active' where id='order-15'");assert.equal((await features(15)).length,2);});
 await check("expired purchase does not provision",async()=>{await order(16,{expires_at:"2000-01-01"});assert.equal((await features(16)).length,0);});
 await check("renewal from expired to current provisions missing permissions",async()=>{await db.query("update public.tool_orders set expires_at=now()+interval '1 month' where id='order-16'");assert.equal((await features(16)).length,2);});
 await check("revoked Admin assignment does not provision",async()=>{await grant(17,{status:"revoked"});assert.equal((await features(17)).length,0);});
 await check("Admin reactivation provisions missing permissions",async()=>{await db.query("update public.tool_access_grants set status='active' where id='grant-17'");assert.equal((await features(17)).length,2);});
 await check("unrelated tools do not acquire Phrasly permissions",async()=>{await order(18,{tool_slug:"stealthwriter"});await grant(19,{tool_slug:"chatgpt"});assert.equal((await features(18)).length+(await features(19)).length,0);});
 await check("duplicate assignments and webhook retries are idempotent",async()=>{await order(11,{id:"order-11-repeat"});await db.query("update public.tool_orders set payment_status='successful' where id='order-11'");assert.equal((await features(11)).length,2);});
 await check("Admin custom allowances and feature revocation survive renewal",async()=>{await db.query("update public.phrasly_oneclick_feature_grants set daily_limit=63,enabled=false where user_id=$1 and feature_key='humanizer'",[uid(11)]);await db.query("update public.tool_orders set expires_at=now()+interval '2 months' where id='order-11'");assert.deepEqual((await features(11)).find(f=>f.feature_key==="humanizer"),{feature_key:"humanizer",daily_limit:63,enabled:false});});
 await check("failed payments do not provision",async()=>{await order(20,{status:"pending",payment_status:"failed"});assert.equal((await features(20)).length,0);});
 await check("refunded payments do not provision",async()=>{await order(21,{payment_status:"refunded"});assert.equal((await features(21)).length,0);});
 await check("reversed payments do not provision",async()=>{await order(22,{payment_status:"reversed"});assert.equal((await features(22)).length,0);});
 await check("an invalid native grant rolls back the whole assignment",async()=>{
   await db.exec("reset role; alter table public.phrasly_oneclick_feature_grants add constraint reject_test_user check(user_id<>'"+uid(23)+"'::uuid); set role service_role");
   await assert.rejects(()=>grant(23));
   assert.equal((await rows("select id from public.tool_access_grants where user_id=$1",[uid(23)])).length,0);
   await db.exec("reset role; alter table public.phrasly_oneclick_feature_grants drop constraint reject_test_user; set role service_role");
 });
 await check("transaction rollback leaves no source assignment or native permissions",async()=>{await db.exec("begin");await grant(24);assert.equal((await features(24)).length,2);await db.exec("rollback");assert.equal((await features(24)).length,0);});
 await check("expiry removes effective access without changing permissions or counters",async()=>{await db.query("update public.tool_orders set expires_at=now()-interval '1 second' where id in ('order-11','order-11-repeat')");assert.equal(await hasAccess(11),false);assert.equal((await features(11)).length,2);});
 await check("Admin revocation removes effective access",async()=>{await db.query("update public.tool_access_grants set status='revoked' where id='grant-10'");assert.equal(await hasAccess(10),false);});
 await check("one cancelled entitlement does not override another active one",async()=>{await order(25);await grant(25);await db.query("update public.tool_orders set status='cancelled' where id='order-25'");assert.equal(await hasAccess(25),true);});
 await db.exec("reset role; set role authenticated; set test.is_admin='false'");
 await check("customer-supplied approved order cannot provision native permissions",async()=>{await order(26);await db.exec("reset role");assert.equal((await features(26)).length,0);await db.exec("set role authenticated");});
 await check("ordinary customers cannot directly create feature permissions",async()=>assert.rejects(()=>db.query("insert into public.phrasly_oneclick_feature_grants values ($1,'phrasly','humanizer',9999,true)",[uid(26)])));
 await check("authenticated Admin order writes work without direct native-table privileges",async()=>{await db.exec("set test.is_admin='true'");await order(27);await db.exec("reset role");assert.equal((await features(27)).length,2);});
 await check("internal provisioning function is hidden from anon and authenticated",async()=>{for(const role of ["anon","authenticated"]){const [r]=await rows("select has_schema_privilege($1,'phrasly_internal','USAGE') schema_access,has_function_privilege($1,'phrasly_internal.seed_entitled_features()','EXECUTE') callable",[role]);assert.equal(r.schema_access,false);assert.equal(r.callable,false);}});
 await check("only the two intended source tables have synchronization triggers",async()=>assert.deepEqual((await rows("select c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid where tgname like 'phrasly_seed_features_%' order by c.relname")).map(r=>r.relname),["tool_access_grants","tool_orders"]));
 console.log(JSON.stringify({status:"PASS",checks:checks.length,migration:migrationName,cases:checks},null,2));
}finally{await db.close();}
