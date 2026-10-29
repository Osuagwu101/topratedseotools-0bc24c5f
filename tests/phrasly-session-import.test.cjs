const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const js=ts.transpileModule(fs.readFileSync('src/lib/phrasly-extension/session-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const box={exports:{}};vm.runInNewContext(js,box);const parse=box.exports.parsePhraslySessionInput;
const c={name:'session',value:'SYNTHETIC',domain:'.phrasly.ai',path:'/'};
test('single and raw login formats accepted',()=>{for(const x of [[c],JSON.stringify([c]),'SYNTHETIC',{cookies:[c]},{authenticated_cookies:[c]}])assert.equal(parse(x).filter(c=>c.name==='session').length,1);});
test('full AWS array preserved byte for byte through parsing',()=>{const input=[c,{...c,domain:'phrasly.ai',hostOnly:true,expirationDate:2000000000},{name:'theme',value:'',domain:'phrasly.ai',path:'/legacy',sameSite:'no_restriction'}];assert.equal(JSON.stringify(parse(input)),JSON.stringify(input));});
test('foreign domains and malformed values rejected',()=>{for(const x of [[{...c,domain:'evilphrasly.ai'}],[{...c,value:'bad\nvalue'}],'{bad',[]])assert.throws(()=>parse(x),/bad_cookie_json/);});
