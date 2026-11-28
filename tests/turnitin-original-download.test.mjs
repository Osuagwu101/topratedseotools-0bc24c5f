import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTurnitinOriginalDownload } from '../src/lib/turnitin-original-download.server.ts';

const userId = 'owner', jobId = 'check';
function setup(overrides = {}, options = {}) {
  const job = { id: jobId, user_id: userId, original_filename: 'My original.docx', source_storage_bucket: 'turnitin-source', source_storage_path: `${userId}/${jobId}/source.docx`, history_deleted_at: null, ...overrides };
  const filters = {};
  const calls = [];
  const query = { select() { return this; }, eq(k,v) { filters[k]=v; return this; }, is(k,v) { filters[k]=v; return this; }, async maybeSingle() { return { data: options.missing ? null : job, error: options.dbError ? {} : null }; } };
  const db = { from(table) { assert.equal(table, 'turnitin_jobs'); return query; } };
  const admin = { storage: { from(bucket) { return { async createSignedUrl(path, expiry, download) { calls.push({bucket,path,expiry,download}); return options.storageError ? { error: {} } : { data: { signedUrl: 'https://storage.example.test/signed-private-original' } }; } }; } } };
  return { db, admin, filters, calls };
}

test('original attachment uses owned private source, original filename and 60-second expiry', async () => {
  for (const ext of ['pdf','doc','docx']) {
    const s = setup({ original_filename: `Original file.${ext}`, source_storage_path: `${userId}/${jobId}/source.${ext}` });
    const result = await prepareTurnitinOriginalDownload(s.db,s.admin,userId,jobId);
    assert.equal(result.filename, `Original file.${ext}`);
    assert.deepEqual(s.filters, { id: jobId, user_id: userId, history_deleted_at: null });
    assert.deepEqual(s.calls, [{bucket:'turnitin-source', path:`${userId}/${jobId}/source.${ext}`, expiry:60, download:{download:`Original file.${ext}`}}]);
  }
});

test('original download does not require report completion or available credits', async () => {
  for (const status of ['uploading','queued','processing','completed','failed']) {
    const s = setup({ status, credit_state: 'none' });
    await prepareTurnitinOriginalDownload(s.db,s.admin,userId,jobId);
    assert.equal(s.calls.length,1);
  }
});

test('missing, foreign and deleted submissions cannot produce a link', async () => {
  for (const [row,options] of [[{}, {missing:true}], [{user_id:'another-customer'},{}], [{history_deleted_at:'2026-11-28'},{}], [{source_storage_bucket:'another-bucket'},{}], [{source_storage_path:'another-customer/check/source.docx'},{}], [{source_storage_path:null},{}], [{}, {dbError:true}]]) {
    const s = setup(row,options);
    await assert.rejects(prepareTurnitinOriginalDownload(s.db,s.admin,userId,jobId));
    assert.equal(s.calls.length,0);
  }
});

test('missing stored originals give a clear error, and unsafe filename characters are removed', async () => {
  const missing = setup({}, {storageError:true});
  await assert.rejects(prepareTurnitinOriginalDownload(missing.db,missing.admin,userId,jobId), /original file is unavailable/);
  const s = setup({original_filename:'bad/name\r\n.docx'});
  const result = await prepareTurnitinOriginalDownload(s.db,s.admin,userId,jobId);
  assert.equal(result.filename,'bad_name__.docx');
});
