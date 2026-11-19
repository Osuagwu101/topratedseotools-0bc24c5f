import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

// Run the real server validators/handlers against a fake database; no payments or customer data change.
function fixture({ superAdmin = true, authorized = true, policy = { file_threshold: 20, restriction_enabled: true, trigger_mode: 'files' } } = {}) {
  const calls = [];
  const db = {
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const query = {
        select() { return query; },
        eq(key, value) { call.filters.push([key, value]); return query; },
        order() { return query; },
        in() { return query; },
        range(from, to) { call.range = [from, to]; return query; },
        maybeSingle() { return query; },
        insert() { return query; },
        then(resolve, reject) {
          const data = table === 'user_roles' ? (authorized ? { is_active: true, is_super_admin: superAdmin } : null)
            : table === 'admin_accounts' ? { user_id: 'admin' }
            : table === 'turnitin_postpaid_billing_settings' ? policy : [];
          return Promise.resolve({ data, count: 73, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: 'postpaid', error: null }; },
  };
  const createServerFn = () => ({ middleware() { return this; }, inputValidator(validate) { this.validate = validate; return this; },
    handler(handler) { const validate = this.validate; return (input) => handler({ data: validate(input), context: { userId: 'admin', supabase: db } }); } });
  let source = readFileSync(new URL('../src/lib/turnitin-postpaid.functions.ts', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '')
    .replaceAll('await import("@/integrations/supabase/client.server")', '({ supabaseAdmin: fakeDb })');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll('export const ', 'const ');
  const api = new Function('createServerFn', 'requireSupabaseAuth', 'z', 'fakeDb', `${js}\nreturn { adminSetTurnitinPostpaidStatus, adminGetCustomerTurnitinHistory, adminGetCustomerPostpaidCharges };`)(createServerFn, {}, z, db);
  return { ...api, calls };
}
const userId = '12345678-1234-4234-8234-123456789abc';
const enable = { userId, enabled: true, rateNgn: 2300, reason: 'Agreed customer threshold', fileThreshold: 20 };

test('enable requires a threshold and a saved matching enforced policy', async () => {
  const f = fixture();
  await assert.rejects(f.adminSetTurnitinPostpaidStatus({ ...enable, fileThreshold: undefined }), /threshold/);
  assert.equal(f.calls.some(c => c.rpc), false);
  for (const policy of [null, { file_threshold: 10, restriction_enabled: true, trigger_mode: 'files' },
    { file_threshold: 20, restriction_enabled: false, trigger_mode: 'files' },
    { file_threshold: 20, restriction_enabled: true, trigger_mode: 'monthly' }]) {
    const bad = fixture({ policy });
    await assert.rejects(bad.adminSetTurnitinPostpaidStatus(enable), /threshold/);
    assert.equal(bad.calls.some(c => c.rpc), false);
  }
});
test('valid threshold enables postpaid; disabling needs no threshold', async () => {
  const f = fixture();
  assert.equal((await f.adminSetTurnitinPostpaidStatus(enable)).billingMode, 'postpaid');
  assert.equal(f.calls.find(c => c.rpc).args._enabled, true);
  const d = fixture();
  await d.adminSetTurnitinPostpaidStatus({ ...enable, enabled: false, rateNgn: null, fileThreshold: undefined });
  assert.equal(d.calls.find(c => c.rpc).args._enabled, false);
});
test('ordinary admin cannot enable postpaid', async () => {
  const f = fixture({ superAdmin: false });
  await assert.rejects(f.adminSetTurnitinPostpaidStatus(enable), /Super Admin/);
  assert.equal(f.calls.some(c => c.rpc), false);
});
for (const endpoint of ['adminGetCustomerTurnitinHistory', 'adminGetCustomerPostpaidCharges']) {
  test(`${endpoint} paginates every allowed page size and scopes to the customer`, async () => {
    for (const pageSize of [10,25,50]) {
      const f = fixture();
      const result = await f[endpoint]({ userId, page: 2, pageSize });
      const call = f.calls.find(c => c.range);
      assert.deepEqual(call.range, [2 * pageSize, 3 * pageSize - 1]);
      assert.ok(call.filters.some(([k,v]) => k === 'user_id' && v === userId));
      assert.equal(result.total, 73);
    }
  });
  test(`${endpoint} rejects invalid pagination and unauthorized access`, async () => {
    for (const input of [{ page: -1, pageSize: 10 }, { page: 0, pageSize: 100 }, { page: 0.5, pageSize: 25 }])
      await assert.rejects(async () => fixture()[endpoint]({ userId, ...input }));
    const f = fixture({ authorized: false });
    await assert.rejects(f[endpoint]({ userId, page: 0, pageSize: 10 }), /Forbidden/);
    assert.equal(f.calls.some(c => c.range), false);
  });
}
