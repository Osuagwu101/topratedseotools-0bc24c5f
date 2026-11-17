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
 const connection=new BrowserConnection();connection.importedToken=imported;
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
