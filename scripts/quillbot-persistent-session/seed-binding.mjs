/** Run from the dedicated runtime once, before the owner signs in. Never prints secrets. */
import {db} from './db.mjs';
import {decryptQuillBotSession} from '../src/lib/quillbot-session.server.ts';
import {syncBrowserSession} from '../browser-transport/browser-fetch.mjs';
const {data,error}=await db.from('quillbot_provider_accounts').select('status,encrypted_payload').eq('account_key','account_1').single();
if(error||data?.status!=='stored'||!data.encrypted_payload)throw Error('Save an authorized QuillBot account in Admin first.');
const state=JSON.parse(decryptQuillBotSession(data.encrypted_payload));
await syncBrowserSession(state,data.encrypted_payload);
console.log('Assigned account binding initialized. Owner sign-in and real renewal verification are still required.');
