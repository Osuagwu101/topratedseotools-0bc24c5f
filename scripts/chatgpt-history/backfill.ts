// Run on the server with its existing private environment. Counts only; no transcript logging.
import {supabaseAdmin} from '../../src/integrations/supabase/client.server';
import {backupChatGptAccount} from '../../src/lib/chatgpt-history-backup.server';
const db=supabaseAdmin as any;
const {data,error}=await db.from('chatgpt_provider_accounts').select('account_key,encrypted_payload,status');
if(error)throw Error('Could not read ChatGPT provider accounts.');
let failed=0;
for(const row of data??[]) {
 if(row.status!=='stored'||!row.encrypted_payload)continue;
 const result=await backupChatGptAccount(row.account_key,row.encrypted_payload);
 console.log(JSON.stringify(result));failed+=result.failed;
}
if(failed)process.exitCode=1;
