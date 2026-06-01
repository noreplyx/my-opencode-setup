#!/usr/bin/env ts-node
import*as fs from'fs';import*as path from'path';import*as os from'os';
const TD=path.join(os.tmpdir(),'car-test');
function pa(a:string[]):any{
  return{agents:(a.find(x=>x.startsWith('--agents='))||'').split('=')[1],
         type:(a.find(x=>x.startsWith('--pipeline-type='))||'').split('=')[1]};
}
function pta(p:string):string[]{
  const m:Record<string,string[]>={full:['finder','plandescriber','implementor','fixer','qa','verifier','documentor'],
    quick:['plandescriber','implementor','qa','verifier'],
    'fixer-only':['fixer','qa','verifier'],
    'parallel-feature':['finder','plandescriber','implementor','merge-coordinator','integrator','qa','verifier'],
    tdd:['plandescriber','qa','implementor','verifier']};
  return m[p]||[];
}
function rac(d:string,a:string):any{
  const fp=path.join(d,'agents/subagent/'+a+'.md');
  if(!fs.existsSync(fp))return{exists:false};
  const c=fs.readFileSync(fp,'utf-8');
  const m=c.match(/^---\s*\n([\s\S]*?)\n---/);
  if(!m)return{exists:true,config:{}};
  const r:any={};
  for(const l of m[1].split('\n')){
    const t=l.trim();if(!t||t.startsWith('#')||t.startsWith('-'))continue;
    const ci=t.indexOf(':');if(ci===-1)continue;
    r[t.slice(0,ci).trim()]=t.slice(ci+1).trim();
  }
  return{exists:true,config:r};
}
let pp=0,ff=0;
function t(n:string,fn:()=>void){try{fn();pp++;console.log('OK '+n);}catch(e){ff++;console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});fs.mkdirSync(path.join(TD,'agents/subagent'),{recursive:true});}
function teardown(){if(fs.existsSync(TD))fs.rmSync(TD,{recursive:true});}
setup();
t('parse agents',()=>{ae(pa(['--agents=a,b']).agents,'a,b','a')});
t('parse type',()=>{ae(pa(['--pipeline-type=full']).type,'full','t')});
t('full pipeline',()=>{const r=pta('full');a(r.includes('finder'),'finder');a(r.includes('documentor'),'doc');ae(r.length,7,'7')});
t('parallel pipeline',()=>{const r=pta('parallel-feature');a(r.includes('merge-coordinator'),'mc');a(r.includes('integrator'),'int')});
t('tdd pipeline',()=>{const r=pta('tdd');ae(r[0],'plandescriber','f');ae(r[1],'qa','qa2')});
t('unknown pipeline',()=>{ae(pta('unknown'),[],'empty')});
t('read config found',()=>{
  const ag=path.join(TD,'agents/subagent');const fp=path.join(ag,'ta.md');
  fs.writeFileSync(fp,'---\nmode: subagent\ntemperature: 0.1\n---\nbody','utf-8');
  const r=rac(TD,'ta');a(r.exists,'exists');ae(r.config.mode,'subagent','mode');
});
t('read config not found',()=>{const r=rac(TD,'nx');a(!r.exists,'nf')});
t('read config no frontmatter',()=>{
  const ag=path.join(TD,'agents/subagent');const fp=path.join(ag,'nf.md');
  fs.writeFileSync(fp,'text','utf-8');const r=rac(TD,'nf');a(r.exists,'exists');
});
teardown();
console.log(''+pp+' passed, '+ff+' failed');if(ff>0)process.exit(1);
