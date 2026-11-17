/** Stores only health metadata. Provider credentials stay in the native profile. */
export function tokenExpiry(token){try{const exp=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).exp;return Number.isFinite(exp)?exp*1000:null;}catch{return null;}}
export class SessionRenewalMonitor {
 constructor(check,{now=()=>Date.now(),onChange=()=>{}}={}){this.check=check;this.now=now;this.onChange=onChange;this.running=null;this.state={status:'unchecked',checkedAt:null,expiresAt:null,renewedBeyondImported:false};}
 tick(){if(this.running)return this.running;this.running=this.run().finally(()=>this.running=null);return this.running;}
 async run(){let state;try{const result=await this.check();const valid=result.source==='native'&&result.matchesAssignedAccount===true&&Number.isFinite(result.expiresAt)&&result.expiresAt>this.now()+60000;state={status:valid?'healthy':'needs_sign_in',checkedAt:new Date(this.now()).toISOString(),expiresAt:Number.isFinite(result.expiresAt)?new Date(result.expiresAt).toISOString():null,renewedBeyondImported:valid&&Number.isFinite(result.importedExpiresAt)&&result.expiresAt>result.importedExpiresAt+60000};}catch{state={status:'needs_sign_in',checkedAt:new Date(this.now()).toISOString(),expiresAt:null,renewedBeyondImported:false};}this.state=state;this.onChange({...state});return {...state};}
}
