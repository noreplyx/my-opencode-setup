#!/usr/bin/env ts-node
import * as fs from 'fs'; import * as path from 'path'; import * as os from 'os'; import * as crypto from 'crypto';
const TEST_DIR = path.join(os.tmpdir(), 'ar-test');
function hash(p:string,f:string,ts:string):string{return crypto.createHash('sha256').update(p+':'+f+':'+ts,'utf-8').digest('hex').slice(0,12);}
function parse(a:string[]):any{const r:any={};r.pipelineId=(a.find(x=>x.startsWith('--pipeline-id='))||'').split('=')[1];r.feature=(a.find(x=>x.startsWith('--feature='))||'').split('=')[1];r.dryRun=a.includes('--dry-run');r.check=a.includes('--check');r.restore=a.includes('--restore');r.status=a.includes('--status');return r;}
function check(mon:string,pid:string,th:number):any{const fp=path.join(mon,pid+'.json');if(!fs.existsSync(fp))return{needed:false,consecutive:0,threshold:th,msg:'No data'};const d=JSON.parse(fs.readFileSync(fp,'utf-8'));return{needed:d.consecutiveFailures>=th,consecutive:d.consecutiveFailures,threshold:th,msg:d.consecutiveFailures+' fail'};}
function record(rd:string,pid:string,feat:string,dr:boolean):any{if(!fs.existsSync(rd))fs.mkdirSync(rd,{recursive:true});const r={pipelineId:pid,timestamp:new Date().toISOString(),fromSha:'abc',toSha:'def',feature:feat,dryRun:dr,hash:hash(pid,feat,Date.now().toString())};if(!dr){fs.writeFileSync(path.join(rd,pid+'.json'),JSON.stringify(r,null,2),'utf-8');}return r;}
function getSt(rd:string,pid:string):any{const fp=path.join(rd,pid+'.json');if(!fs.existsSync(fp))return{exists:false};return{exists:true,record:JSON.parse(fs.readFileSync(fp,'utf-8'))};}
let p=0,f=0;
function t(n:string,fn:()=>void){try{fn();p++;console.log('OK '+n);}catch(e){f++;console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});fs.mkdirSync(TEST_DIR,{recursive:true});}
function teardown(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});}
setup();
t('hash length',()=>{ae(hash('p1','f','t1').length,12,'len')});
t('hash consistent',()=>{ae(hash('p1','f','t1'),hash('p1','f','t1'),'same')});
t('hash different',()=>{a(hash('p1','f','t1')!==hash('p2','f','t1'),'different')});
t('parse args',()=>{const r=parse(['--pipeline-id=p1','--feature=t','--dry-run']);ae(r.pipelineId,'p1','pid');ae(r.feature,'t','feat');a(r.dryRun,'dry')});
t('parse check mode',()=>{const r=parse(['--check','--pipeline-id=p1']);a(r.check,'check')});
t('check needed when failures>=thresh',()=>{const md=path.join(TEST_DIR,'mon');fs.mkdirSync(md,{recursive:true});fs.writeFileSync(path.join(md,'p1.json'),JSON.stringify({pipelineId:'p1',status:'failed',consecutiveFailures:5,gates:{}}),'utf-8');const r=check(md,'p1',3);a(r.needed,'needed');ae(r.consecutive,5,'fail')});
t('check not needed when below',()=>{const md=path.join(TEST_DIR,'mon2');fs.mkdirSync(md,{recursive:true});fs.writeFileSync(path.join(md,'p2.json'),JSON.stringify({pipelineId:'p2',status:'running',consecutiveFailures:1,gates:{}}),'utf-8');a(!check(md,'p2',3).needed,'not needed')});
t('check no data',()=>{a(!check('/nonexistent','p3',3).needed,'not needed')});
t('record creates file',()=>{const rd=path.join(TEST_DIR,'rb');const r=record(rd,'p1','feat',false);a(fs.existsSync(path.join(rd,'p1.json')),'exists');ae(r.pipelineId,'p1','pid')});
t('record dry run',()=>{const rd=path.join(TEST_DIR,'rb2');const r=record(rd,'p_dry','t',true);a(!fs.existsSync(path.join(rd,'p_dry.json')),'no file');a(r.dryRun,'dry')});
t('getStatus finds',()=>{const rd=path.join(TEST_DIR,'rb3');record(rd,'p1','t',false);const s=getSt(rd,'p1');a(s.exists,'exists');ae(s.record.pipelineId,'p1','pid')});
t('getStatus not found',()=>{a(!getSt(TEST_DIR,'p_none').exists,'not exists')});
teardown();
console.log('\n'+p+' passed, '+f+' failed'); if(f>0)process.exit(1);
