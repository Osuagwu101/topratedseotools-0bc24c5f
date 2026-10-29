/** Normalize Admin paste formats without accepting cookies for another site. */
export function parsePhraslySessionInput(input:unknown):Record<string,unknown>[] {
 const invalid=()=>{throw new Error("bad_cookie_json");};
 let value:any=input;
 if(typeof value==="string") {
  const text=value.trim();
  if(!text||text.length>200000)return invalid();
  try{value=JSON.parse(text);}catch{
   // Plain session values and browser Cookie headers are both supported.
   if(text.startsWith("[")||text.startsWith("{"))return invalid();
   if(text.startsWith("session=")) {
    value=text.split(";").filter(part=>part.trim()).map(part=>{
     const equal=part.indexOf("=");
     if(equal<1)return invalid();
     return {name:part.slice(0,equal).trim(),value:part.slice(equal+1).trim(),domain:"phrasly.ai",path:"/",secure:true};
    });
   }else value=text;
  }
 }
 if(typeof value==="string") {
  if(!/^[A-Za-z0-9._~+/%=\-]+$/.test(value)||value.length>64000)return invalid();
  value=[{name:"session",value,domain:"phrasly.ai",path:"/",secure:true}];
 }
 if(value&&!Array.isArray(value)&&typeof value==="object") {
  if(Array.isArray(value.cookies))value=value.cookies;
  else if(Array.isArray(value.authenticated_cookies))value=value.authenticated_cookies;
  else if(value.name==="session")value=[value];
  else return invalid();
 }
 if(!Array.isArray(value)||!value.length||value.length>100||JSON.stringify(value).length>200000)return invalid();
 if(!value.every(c=>c&&typeof c.name==="string"&&/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name)&&typeof c.value==="string"&&c.value.length<=64000&&!/[\r\n\x00]/.test(c.value)&&typeof c.domain==="string"&&/^(?:[a-z0-9-]+\.)*phrasly\.ai$/i.test(c.domain.replace(/^\./,""))&&(!c.path||(typeof c.path==="string"&&c.path.startsWith("/")&&!/[\r\n\x00]/.test(c.path)))))return invalid();
 const sessions=value.filter(c=>c.name==="session"&&c.value.length>0&&c.domain.replace(/^\./,"").toLowerCase()==="phrasly.ai"&&(c.path||"/")==="/");
 if(!sessions.length)throw new Error("missing_login_cookie");
 if(new Set(sessions.map(c=>c.value)).size!==1)throw new Error("ambiguous_login_cookies");
 // Identical login values are safe to collapse; conflicting identities are never guessed.
 const selected=sessions.find(c=>c.hostOnly===true)||sessions[0];
 value=[...value.filter(c=>c.name!=="session"),selected];
 return value.map(c=>({...c,domain:c.domain.toLowerCase(),path:c.path||"/"}));
}
