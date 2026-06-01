#!/usr/bin/env ts-node
import * as fs from'fs';import*as path from'path';import*as os from'os';
const TD=path.join(os.tmpdir(),'pd-test');
interface M{mv:string|number;checkpoints?:Array<{id:string;target?:string;filesModified?:string[]}>;phases?:Array<{name:string;checkpoints?:Array<{id:string;target?:string}>}>}
function xta(m:M):string[]{const s=new Set<string>();
if(m.checkpoints)for(const c of m.checkpoints){if(c.target)s.add(c.target);if(c.filesModified)for(const f of c.filesModified)s.add(f);}
if(m.phases)for(const p of m.phases)if(p.checkpoints)for(const c of p.checkpoints){if(c.target)s.add(c.target);}
return Array.from(s).sort();}
function synth(m:M):{r:string;phases:any[]}{const all=xta(m);if(all.length===0)return{r:'SINGLE_FILE',phases:[]};
const ps:any[]=[];if(m.phases&&m.phases.length>0){for(let i=0;i<m.phases.length;i++){const mp=m.phases[i];const f:string[]=[];if(mp.checkpoints)for(const c of mp.checkpoints)if(c.target)f.push(c.target);ps.push({files:f.length?f:[mp.name],mode:i===0?'PARALLEL':'SEQUENTIAL'});}}
else if(m.checkpoints&&m.checkpoints.length>0){ps.push({files:all,mode:'PARALLEL'});}
return{r:ps.length<=1?(all.length===1?'SINGLE_FILE':'PARALLEL'):'HYBRID',phases:ps};}
let p=0,f=0;
function t(n:string,fn:()=>void){try{fn();p++;console.log('OK '+n);}catch(e){console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});fs.mkdirSync(TD,{recursive:true});} function teardown(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});}
setup();
t('single file SINGLE_FILE',()=>{ae(synth({mv:1,checkpoints:[{id:'C1',target:'a.ts'}]}).r,'SINGLE_FILE','r')});
t('multi file PARALLEL',()=>{ae(synth({mv:1,checkpoints:[{id:'C1',target:'a.ts'},{id:'C2',target:'b.ts'}]}).r,'PARALLEL','r')});
t('multi phase HYBRID',()=>{ae(synth({mv:1,phases:[{name:'P1',checkpoints:[{id:'C1',target:'a.ts'}]},{name:'P2',checkpoints:[{id:'C2',target:'b.ts'}]}]}).r,'HYBRID','r')});
t('empty SINGLE_FILE',()=>{ae(synth({mv:1}).r,'SINGLE_FILE','r')});
t('extractAll basic',()=>{ae(xta({mv:1,checkpoints:[{id:'C1',target:'a.ts'}]}),['a.ts'],'r')});
t('extractAll filesModified',()=>{ae(xta({mv:1,checkpoints:[{id:'C1',filesModified:['a.ts']}]}),['a.ts'],'r')});
t('extractAll phases',()=>{ae(xta({mv:1,phases:[{name:'P1',checkpoints:[{id:'C1',target:'c.ts'}]}]}),['c.ts'],'r')});
t('extractAll dedup',()=>{ae(xta({mv:1,checkpoints:[{id:'C1',target:'a.ts'},{id:'C2',target:'a.ts'}]}),['a.ts'],'r')});
t('extractAll empty',()=>{ae(xta({mv:1}),[],'empty')});
teardown();
console.log(''+p+' passed, '+f+' failed'); if(f>0)process.exit(1);
