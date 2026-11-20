import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserConnection,parseFirebaseAuth,firebaseSeedScript,NUDGE_INTERVAL_MS} from './relay.mjs';
const key='firebase:authUser:AIzaSyTestKey_abcdef123:[DEFAULT]';
const value={uid:'u1',stsTokenManager:{refreshToken:'r'.repeat(40),accessToken:'a'}};
test('sign-in record validation',()=>{
  assert.equal(parseFirebaseAuth(JSON.stringify({key,value})).store,'indexedDB');
  assert.equal(parseFirebaseAuth({store:'localStorage',key,value:JSON.stringify(value)}).store,'localStorage');
  assert.throws(()=>parseFirebaseAuth({key:'firebase:authUser:x',value}));
  assert.throws(()=>parseFirebaseAuth({key,value:{stsTokenManager:{}}}));
  assert.match(firebaseSeedScript(parseFirebaseAuth({key,value}),false),/firebaseLocalStorageDb/);
});
test('stale-login nudge reseeds without overwriting, reloads, and is rate-limited',async()=>{
  const b=new BrowserConnection();const calls=[];
  b.ready=async()=>{};b.reset=()=>{};
  b.call=async(method,params)=>{calls.push([method,params?.expression?.includes('false)')?'keep':'']);return {result:{value:'present'}};};
  assert.equal(await b.nudgeRenewal(),false,'no record, no nudge');
  b.importedFirebase=parseFirebaseAuth({key,value});
  assert.equal(await b.nudgeRenewal(1e12),true);
  assert.deepEqual(calls.map(c=>c[0]),['Runtime.evaluate','Page.reload']);
  assert.equal(calls[0][1],'keep','never overwrites a record the page may have refreshed');
  assert.equal(await b.nudgeRenewal(1e12+NUDGE_INTERVAL_MS-1),false,'rate-limited');
  b.jobs.set('x',{});assert.equal(await b.nudgeRenewal(1e12+NUDGE_INTERVAL_MS*2),false,'never during writer requests');
});
