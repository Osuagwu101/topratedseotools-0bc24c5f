import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserConnection } from '../browser-transport/relay.mjs';
const imported='imported-test-only-'.repeat(10);
const native='refreshed-test-only-'.repeat(10);
test('browser command timeout falls back to imported session for upstream verification',async()=>{
 const connection=new BrowserConnection();connection.importedToken=imported;
 connection.call=async()=>{throw Error('browser command timeout')};
 assert.equal(await connection.browserToken(),imported);
});
test('successful native refresh takes precedence',async()=>{
 const connection=new BrowserConnection();connection.importedToken=native;
 connection.call=async()=>({result:{value:native}});
 assert.equal(await connection.browserToken(),native);
});
test('missing native token uses imported session',async()=>{
 const connection=new BrowserConnection();connection.importedToken=imported;
 connection.call=async()=>({exceptionDetails:{text:'Missing token'}});
 assert.equal(await connection.browserToken(),imported);
});
test('refresh failure without imported credentials fails closed',async()=>{
 const connection=new BrowserConnection();connection.call=async()=>{throw Error('timeout')};
 await assert.rejects(connection.browserToken(),/session expired/);
});

test('relay redaction never treats a missing cookie as an empty secret',async()=>{
 const connection=new BrowserConnection();connection.ready=async()=>{};
 connection.browserToken=async()=>imported;
 let expression='';connection.call=async(method,input)=>{expression=input.expression;return {}};
 const req={};const res={headersSent:false,on(){},writeHead(){},end(){}};
 await connection.relay({url:'https://quillbot.com/api/auth/get-account-details',method:'POST',headers:{}},req,res);
 for(const job of connection.jobs.values())job.fail();
 assert.match(expression,/new Set\(secrets\)\]\.filter\(value=>typeof value==='string' && value.length>=12\)/);
});
