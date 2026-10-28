/** Build the Admin customer card using the application's existing locked Vite toolchain. */
import {build} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const out=path.join(root,"public/phrasly-assets");
await build({
 configFile:false,root,publicDir:false,plugins:[react()],
 resolve:{alias:{"@":path.join(root,"src")}},
 define:{"import.meta.env":JSON.stringify({VITE_SUPABASE_URL:"https://vuhnvsejdszfvwicflbb.supabase.co",VITE_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_qACYapb1FmF5eAfeG9wEPw_KYGrmAa6",PROD:true,DEV:false}),"process.env.NODE_ENV":JSON.stringify("production")},
 build:{outDir:out,emptyOutDir:false,minify:true,sourcemap:false,target:"es2022",
  lib:{entry:{"admin-customer-controls-v1":path.join(root,"src/components/admin/PhraslyCustomerControlsEntry.tsx")},formats:["es"],fileName:(_format,name)=>name+".js"}}
});
fs.copyFileSync(path.join(root,"src/lib/phrasly-extension/admin-customer-controls-bootstrap.js"),path.join(out,"admin-customer-controls-bootstrap-v1.js"));
