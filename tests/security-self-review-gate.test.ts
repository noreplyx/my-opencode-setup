#!/usr/bin/env ts-node
import * as fs from 'fs'; import * as path from 'path'; import * as os from 'os'; import * as crypto from 'crypto';
const TEST_DIR = path.join(os.tmpdir(), 'ssr-test');
function parse(a:string[]):any{const r:any={mode:'unknown'};const checkCtxArg=a.find(x=>x.startsWith('--check-context'));if(checkCtxArg){r.contextPath=checkCtxArg.split('=')[1]||'';r.mode='check-context'};if(a.includes('--enforce'))r.mode='enforce';if(a.includes('--report'))r.mode='report';if(a.includes('--dry-run'))r.dryRun=true;const c=(a.find(x=>x.startsWith('--check-context='))||'').split('=')[1];if(c)r.contextPath=c;const p=(a.find(x=>x.startsWith('--pipeline-id='))||'').split('=')[1];if(p)r.pipelineId=p;return r;}
function parseCtx(c:string):any{c=c.replace(/\r\n/g,'\n');const m=c.match(/^---\s*\n([\s\S]*?)\n---/);if(!m)return null;const r:any={};for(const l of m[1].split('\n')){const t=l.trim();if(!t||t.startsWith('#')||t.startsWith('-'))continue;const ci=t.indexOf(':');if(ci===-1)continue;r[t.slice(0,ci).trim()]=t.slice(ci+1).trim().replace(/^"(.*)"$/,"$1");}return r;}
function checkSR(ctx:any):any{const i=ctx.agentOutputs?.implementor;if(!i)return{passed:false,failures:['Not run'],block:false,details:[]};const d:any[]=[];const fl:string[]=[];const sr=i.selfReview;const ssr=i.securitySelfReview;let pass=true;if(sr){const c={check:'srPassed',exp:true,act:sr.securitySelfReviewPassed,passed:sr.securitySelfReviewPassed===true};d.push(c);if(!c.passed){pass=false;fl.push(c.check);}}if(ssr){const c={check:'ssrPassed',exp:true,act:ssr.passed,passed:ssr.passed===true};d.push(c);if(!c.passed){pass=false;fl.push(c.check);}}return{passed:pass,failures:fl,block:!pass,details:d};}
let p=0,f=0;
function t(n:string,fn:()=>void){try{fn();p++;console.log('OK '+n);}catch(e){f++;console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});fs.mkdirSync(TEST_DIR,{recursive:true});}
function teardown(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});}
setup();
t('parseArgs check-context',()=>{const r=parse(['--check-context=ctx.md']);ae(r.mode,'check-context','m');ae(r.contextPath,'ctx.md','p')});
t('parseArgs enforce',()=>{const r=parse(['--enforce','--pipeline-id=p1']);ae(r.mode,'enforce','m');ae(r.pipelineId,'p1','p')});
t('parseArgs dry run',()=>{const r=parse(['--enforce','--dry-run']);a(r.dryRun,'dry')});
t('parseCtx valid',()=>{const r=parseCtx('---\npipelineId: p1\ncurrentStep: implementor\n---');a(r!==null,'p');ae(r.pipelineId,'p1','pid')});
t('parseCtx no fm',()=>{a(parseCtx('text')===null,'null')});
t('checkSR passes',()=>{const ctx={agentOutputs:{implementor:{status:'completed',selfReview:{securitySelfReviewPassed:true,securityItemsPassed:12,securityItemsTotal:12},securitySelfReview:{passed:true}}}};const r=checkSR(ctx);a(r.passed,'pass');a(!r.block,'not blocked')});
t('checkSR fails missing',()=>{const ctx={agentOutputs:{implementor:{status:'completed',selfReview:{securitySelfReviewPassed:false}}}};const r=checkSR(ctx);a(!r.passed,'fail');a(r.block,'blocked')});
t('checkSR not run',()=>{const r=checkSR({agentOutputs:{}});a(!r.passed,'fail');a(r.failures.includes('Not run'),'msg')});
t('file write/read test',()=>{const fp=path.join(TEST_DIR,'test.json');fs.writeFileSync(fp,JSON.stringify({a:1}),'utf-8');const d=JSON.parse(fs.readFileSync(fp,'utf-8'));ae(d.a,1,'v')});
teardown();
console.log('\n'+p+' passed, '+f+' failed'); if(f>0)process.exit(1);
