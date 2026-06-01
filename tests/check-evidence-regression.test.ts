#!/usr/bin/env ts-node
import*as fs from'fs';import*as path from'path';import*as os from'os';import*as crypto from'crypto';
const TD=path.join(os.tmpdir(),'cer-test');
function hash(s:string):string{return crypto.createHash('sha256').update(s,'utf-8').digest('hex');}
type S='still_valid'|'invalidated'|'file_deleted'|'file_modified_claim_holds'|'unverifiable';
interface E{pipelineId:string;source:string;originalContentHash:string|null;method:string;}
function classify(e:E,cur:string|null,exists:boolean):S{if(!exists)return'file_deleted';if(cur===null)return'unverifiable';if(cur===e.originalContentHash)return'still_valid';if(e.method==='grep'||e.method==='read')return'file_modified_claim_holds';return'invalidated';}
function recheck(e:E):any{const ex=fs.existsSync(e.source);let cur=null;if(ex)try{cur=hash(fs.readFileSync(e.source,'utf-8'));}catch{}const s=classify(e,cur,ex);return{status:s,confidence:s==='still_valid'||s==='file_deleted'?1.0:s==='file_modified_claim_holds'?0.7:0.5,currentHash:cur};}
function extract(ad:string):E[]{const cf=path.join(ad,'agent-context.md');if(!fs.existsSync(cf))return[];const c=fs.readFileSync(cf,'utf-8');return[{pipelineId:path.basename(ad),source:cf,originalContentHash:hash(c),method:'read'}];}
let pp=0,ff=0;
function t(n:string,fn:()=>void){try{fn();pp++;console.log('OK '+n);}catch(e){ff++;console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});fs.mkdirSync(TD,{recursive:true});}function teardown(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});}
setup();
t('classify deleted',()=>{ae(classify({pipelineId:'',source:'',originalContentHash:'abc',method:'read'},null,false),'file_deleted','del')});
t('classify valid',()=>{ae(classify({pipelineId:'',source:'',originalContentHash:'abc',method:'read'},'abc',true),'still_valid','v')});
t('classify modified holds',()=>{ae(classify({pipelineId:'',source:'',originalContentHash:'abc',method:'grep'},'def',true),'file_modified_claim_holds','h')});
t('classify invalidated',()=>{ae(classify({pipelineId:'',source:'',originalContentHash:'abc',method:'stat'},'def',true),'invalidated','i')});
t('recheck unchanged',()=>{const fp=path.join(TD,'f.ts');fs.writeFileSync(fp,'x','utf-8');const h=hash('x');const r=recheck({pipelineId:'p1',source:fp,originalContentHash:h,method:'read'});ae(r.status,'still_valid','v');ae(r.confidence,1.0,'c')});
t('recheck deleted',()=>{const r=recheck({pipelineId:'p1',source:'/nonexistent/x.ts',originalContentHash:'abc',method:'read'});ae(r.status,'file_deleted','del')});
t('extract evidence',()=>{const ad=path.join(TD,'arch');fs.mkdirSync(ad,{recursive:true});fs.writeFileSync(path.join(ad,'agent-context.md'),'---\nid: p1\n---\nbody','utf-8');const r=extract(ad);a(r.length===1,'1');a(r[0].originalContentHash!==null,'hash')});
t('extract no file',()=>{ae(extract(TD+'/empty'),[],'empty')});
t('file write/read',()=>{const fp=path.join(TD,'test.json');fs.writeFileSync(fp,JSON.stringify({a:1}),'utf-8');ae(JSON.parse(fs.readFileSync(fp,'utf-8')).a,1,'v')});
teardown();
console.log(''+pp+' passed, '+ff+' failed');if(ff>0)process.exit(1);
