#!/usr/bin/env ts-node
import*as fs from'fs';import*as path from'path';import*as os from'os';import*as crypto from'crypto';
const TD=path.join(os.tmpdir(),'ch-test');
const HC=[{f:'context-summary',m:true},{f:'artifacts',m:true},{f:'clear-objective',m:true},{f:'constraints',m:false},{f:'expected-output',m:true},{f:'evidence-requirements',m:false}];
function check(agent:string,text:string):any{const miss:string[]=[];let pass=0,fail=0;for(const i of HC){const found=text.toLowerCase().includes(i.f.replace(/-/g,' '))||text.toLowerCase().includes(i.f.toLowerCase());if(found)pass++;else if(i.m){fail++;miss.push(i.f);}}return{agent,passed:pass,failed:fail,missing:miss,complete:fail===0,total:HC.length};}
function hash(c:string):string{return crypto.createHash('sha256').update(c,'utf-8').digest('hex');}
function xp(text:string):string[]{const ps:string[]=[];const rx=/(\x60([^\x60]+)\x60|"([^"]+)")/g;let m;while((m=rx.exec(text))!==null){const p=m[2]||m[3];if(p&&!p.startsWith('http')&&!p.startsWith('#'))ps.push(p);}return ps;}
function gen(a:string):string{return '## Hand-off to '+a+'\n\n### Context Summary\n\n### Clear Objective\n\n### Expected Output';}
function score(r:any):any{const s=r.total>0?Math.round((r.passed/r.total)*100):0;const g=s>=80?'good':s>=50?'fair':'poor';return{score:s,grade:g};}
let pp=0,ff=0;
function t(n:string,fn:()=>void){try{fn();pp++;console.log('OK '+n);}catch(e){ff++;console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});fs.mkdirSync(TD,{recursive:true});}function teardown(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});}
setup();
t('complete handoff',()=>{const r=check('impl','Context summary: done. Artifacts: file.ts. Clear objective: do X. Expected output: code');a(r.complete,'c');ae(r.failed,0,'0')});
t('incomplete handoff',()=>{const r=check('impl','Do thing');a(!r.complete,'inc');a(r.failed>0,'fail')});
t('empty handoff',()=>{a(!check('f','').complete,'inc')});
t('hash length',()=>{ae(hash('x').length,64,'64')});
t('hash consistent',()=>{ae(hash('t'),hash('t'),'same')});
t('hash different',()=>{a(hash('a')!==hash('b'),'diff')});
t('extract paths',()=>{const r=xp('See \x60src/main.ts\x60 and \x60src/utils.ts\x60');ae(r.length,2,'2');a(r.includes('src/main.ts'),'main')});
t('extract ignores URLs',()=>{ae(xp('\x60https://x.com\x60').length,0,'0')});
t('template generated',()=>{const r=gen('qa');a(r.includes('Hand-off to qa'),'name');a(r.includes('Context Summary'),'ctx')});
t('score perfect',()=>{const r=score({total:6,passed:6});ae(r.score,100,'100');ae(r.grade,'good','good')});
t('score partial',()=>{const r=score({total:6,passed:3});ae(r.score,50,'50');ae(r.grade,'fair','fair')});
teardown();
console.log(''+pp+' passed, '+ff+' failed');if(ff>0)process.exit(1);
