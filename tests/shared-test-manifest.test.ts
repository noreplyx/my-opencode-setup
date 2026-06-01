#!/usr/bin/env ts-node
import * as fs from 'fs'; import * as path from 'path'; import * as os from 'os';
const TEST_DIR = path.join(os.tmpdir(), 'stm-test');
type TS='pending'|'running'|'passed'|'failed'; type OS='pending'|'running'|'completed'|'failed';
type TA='qa'|'browser-tester'; type TT='logic'|'ui'|'integration'|'security-regression';
interface TE{testType:TT;testFile:string;agent:TA;status:TS;result?:'pass'|'fail';startedAt?:string;completedAt?:string;}
interface TM{mv:number;feature:string;createdAt:string;planManifest:string;status:OS;entries:TE[];agents:Record<string,TS>;startedAt?:string;}
function gen(manifestPath:string,feature:string):TM{const m:TM={mv:1,feature,createdAt:new Date().toISOString(),planManifest:manifestPath,status:'pending',entries:[],agents:{qa:'pending','browser-tester':'pending'}};return m;}
function complete(m:TM,tt:string,tf:string,r:'pass'|'fail'):TM{const e=m.entries.find(x=>x.testType===tt&&x.testFile===tf);if(e){e.status=r==='pass'?'passed':'failed';e.result=r;e.completedAt=new Date().toISOString();}return m;}
function checkStatus(m:TM):{status:OS}{const allDone=m.entries.every(e=>e.status==='passed'||e.status==='failed');const anyFail=m.entries.some(e=>e.status==='failed');let s:OS;if(m.entries.length===0)s='pending';else if(allDone)s=anyFail?'failed':'completed';else if(m.entries.some(e=>e.status==='running'))s='running';else s='pending';return{status:s};}
function startAgent(m:TM,agent:string):TM{if(agent==='qa'||agent==='browser-tester'){m.agents[agent]='running';for(const e of m.entries){if(e.agent===agent&&e.status==='pending'){e.status='running';e.startedAt=new Date().toISOString();}}}return m;}
function clean(p:string):boolean{if(fs.existsSync(p)){fs.rmSync(p);return true;}return false;}
let p=0,f=0;
function t(n:string,fn:()=>void){try{fn();p++;console.log('OK '+n);}catch(e){f++;console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});fs.mkdirSync(TEST_DIR,{recursive:true});}
function teardown(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});}
setup();
t('generate creates manifest',()=>{const m=gen('/plan.json','test');ae(m.mv,1,'v');ae(m.feature,'test','f');ae(m.status,'pending','s')});
t('checkStatus pending',()=>{const m=gen('/p.json','t');ae(checkStatus(m).status,'pending','s')});
t('checkStatus completed',()=>{const m=gen('/p.json','t');m.entries.push({testType:'logic',testFile:'a.ts',agent:'qa',status:'passed',result:'pass'});ae(checkStatus(m).status,'completed','s')});
t('checkStatus failed',()=>{const m=gen('/p.json','t');m.entries.push({testType:'logic',testFile:'a.ts',agent:'qa',status:'failed',result:'fail'});ae(checkStatus(m).status,'failed','s')});
t('startAgent',()=>{const m=gen('/p.json','t');m.entries.push({testType:'logic',testFile:'a.ts',agent:'qa',status:'pending'});startAgent(m,'qa');ae(m.agents.qa,'running','s');ae(m.entries[0].status,'running','e')});
t('complete pass',()=>{const m=gen('/p.json','t');m.entries.push({testType:'logic',testFile:'a.ts',agent:'qa',status:'running'});complete(m,'logic','a.ts','pass');ae(m.entries[0].status,'passed','s')});
t('complete fail',()=>{const m=gen('/p.json','t');m.entries.push({testType:'logic',testFile:'a.ts',agent:'qa',status:'running'});complete(m,'logic','a.ts','fail');ae(m.entries[0].status,'failed','s')});
t('clean existing file',()=>{const fp=path.join(TEST_DIR,'f.yaml');fs.writeFileSync(fp,'x','utf-8');a(clean(fp),'removed');a(!fs.existsSync(fp),'gone')});
t('clean nonexistent',()=>{a(!clean('/nonexistent/f.yaml'),'not removed')});
teardown();
console.log('\n'+p+' passed, '+f+' failed'); if(f>0)process.exit(1);
