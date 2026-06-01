#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';
const TEST_DIR = "C:/Users/Tanut/AppData/Local/Temp/opencode/tmp-test-transition";
type AgentName = 'orchestrator'|'finder'|'plandescriber'|'implementor'|'fixer'|'qa'|'verifier'|'merge-coordinator'|'integrator'|'browser-tester'|'documentor'|'security-scan'|'pre-flight';
interface V { valid: boolean; from: string; to: string; message: string; exitCode: number; }
interface MC { id: string; step?: string; description?: string; status?: string; }
interface PM { checkpoints?: MC[]; phases?: Array<{ name?: string; checkpoints?: MC[] }>; [key: string]: unknown; }
const VT: Record<string, string[]> = {
  finder: ['plandescriber','orchestrator'], plandescriber: ['implementor','orchestrator'],
  implementor: ['merge-coordinator','integrator','orchestrator','fixer'],
  'merge-coordinator': ['integrator','implementor','orchestrator'], integrator: ['orchestrator'],
  fixer: ['qa','verifier','orchestrator'], qa: ['fixer','verifier','orchestrator'],
  verifier: ['fixer','documentor','orchestrator'], documentor: ['orchestrator'],
  'security-scan': ['qa','orchestrator'], 'browser-tester': ['fixer','qa','orchestrator'],
  orchestrator: ['finder','plandescriber','implementor','fixer','qa','verifier','documentor','merge-coordinator','integrator','security-scan','browser-tester'],
  'pre-flight': ['finder','plandescriber','implementor'],
};
const agents: AgentName[] = ['orchestrator','finder','plandescriber','implementor','fixer','qa','verifier','merge-coordinator','integrator','browser-tester','documentor','security-scan','pre-flight'];
function vt(from: string, to: string): V {
  const nf=from.trim().toLowerCase(), nt=to.trim().toLowerCase();
  if (!(nf in VT)) return {valid:false,from:nf,to:nt,message:'Unknown',exitCode:2};
  const a=VT[nf];
  if (a.includes(nt)) return {valid:true,from:nf,to:nt,message:'Valid',exitCode:0};
  return {valid:false,from:nf,to:nt,message:'Invalid',exitCode:1};
}
function extract(s: string): string | null {
  const l=s.toLowerCase().trim();
  if (agents.includes(l as AgentName)) return l;
  for (const a of agents) { if (l.endsWith('-'+a)||l.endsWith('_'+a)) return a; }
  for (const a of agents) { if (l.includes(a)) return a; }
  return null;
}
function yamlScalar(v: string): unknown {
  const t=v.trim(); if(t==='null'||t==='~') return null; if(t==='true') return true; if(t==='false') return false;
  let u=t; if(u.length>=2&&u[0]==='"') u=u.slice(1,-1);
  if(/^-?\d+(\.\d+)?$/.test(u)){const n=Number(u);if(!isNaN(n))return n;} return u;
}
function yamlFront(c: string): Record<string, unknown> | null {
  c=c.replace(/\r\n/g,'\n'); const m=c.match(/^---\s*\n([\s\S]*?)\n---/); if(!m) return null;
  const r: Record<string, unknown>={}; for(const l of m[1].split('\n')){const t=l.trim();if(!t||t.startsWith('#')||t.startsWith('-')) continue; const ci=t.indexOf(':');if(ci===-1) continue; r[t.slice(0,ci).trim()]=yamlScalar(t.slice(ci+1).trim());} return r;
}
function findCP(id: string, m: PM): MC | undefined {
  if(Array.isArray(m.checkpoints)){const f=m.checkpoints.find(c=>c.id===id);if(f)return f;}
  if(Array.isArray(m.phases)){for(const p of m.phases){if(Array.isArray(p.checkpoints)){const f=p.checkpoints.find(c=>c.id===id);if(f)return f;}}}
  return undefined;
}
function expMat(f: 'json'|'yaml'): string {
  if(f==='json') return JSON.stringify(VT,null,2);
  const l:string[]=['# Pipeline State Transition Matrix',''];
  for(const[k,v]of Object.entries(VT)){l.push(k+':');for(const t of v)l.push('  - '+t);l.push('');}
  return l.join('\n');
}
let passed=0,failed=0;
function t(name:string,fn:()=>void){try{fn();passed++;console.log('  OK '+name);}catch(e){failed++;console.log('  FAIL '+name+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': expected '+JSON.stringify(b)+', got '+JSON.stringify(a));}
function grp(n:string){console.log('\n'+n);}
function setup(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});fs.mkdirSync(TEST_DIR,{recursive:true});}
function teardown(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});}
setup();
grp('validateTransition');
t('finder to plandescriber valid',()=>{const r=vt('finder','plandescriber');a(r.valid,'valid');ae(r.exitCode,0,'exit')});
t('implementor to finder invalid',()=>{const r=vt('implementor','finder');a(!r.valid,'invalid');ae(r.exitCode,1,'exit')});
t('unknown from-step',()=>{const r=vt('unknown','finder');a(!r.valid,'invalid');ae(r.exitCode,2,'exit')});
t('case insensitive',()=>{a(vt('FINDER','PLANDESCRIBER').valid,'ci')});
t('orchestrator to agents',()=>{for (const ag of agents) { if (ag !== 'orchestrator' && ag !== 'pre-flight')a(vt('orchestrator', ag).valid, 'orchestrator->' + ag);}});
grp('extractAgentStep');
t('direct',()=>{ae(extract('implementor'),'implementor','direct')});
t('hyphen suffix',()=>{ae(extract('CP-003-implementor'),'implementor','suffix')});
t('underscore suffix',()=>{ae(extract('CP_003_fixer'),'fixer','uscore')});
t('contains',()=>{ae(extract('verify-fixer-result'),'fixer','contains')});
t('no match',()=>{a(extract('no-match')===null,'null')});
grp('parseYamlScalar');
t('booleans',()=>{ae(yamlScalar('true'),true,'true');ae(yamlScalar('false'),false,'false')});
t('null',()=>{ae(yamlScalar('null'),null,'null')});
t('numbers',()=>{ae(yamlScalar('42'),42,'int');ae(yamlScalar('3.14'),3.14,'float')});
t('strings',()=>{ae(yamlScalar('hello'),'hello','plain')});
grp('yamlFrontmatter');
t('valid',()=>{const r=yamlFront('---\na: 1\nb: hello\n---\nbody');a(r!==null,'parsed');ae(r!.a,1,'a');ae(r!.b,'hello','b')});
t('no frontmatter',()=>{a(yamlFront('text')===null,'null')});
grp('findCheckpointInManifest');
t('found top',()=>{const cp=findCP('C1',{checkpoints:[{id:'C1',step:'i'}]});a(cp!==undefined,'found');ae(cp!.id,'C1','id')});
t('found phase',()=>{const cp=findCP('C2',{phases:[{name:'P1',checkpoints:[{id:'C2'}]}]});a(cp!==undefined,'found')});
t('not found',()=>{const cp=findCP('C99',{checkpoints:[{id:'C1'}]});a(cp===undefined,'nf')});
grp('exportMatrix');
t('json',()=>{const j=expMat('json');const p=JSON.parse(j);a(Array.isArray(p.finder),'array');a(p.finder.includes('plandescriber'),'tgt')});
t('yaml',()=>{const y=expMat('yaml');a(y.includes('Pipeline'),'header');a(y.includes('finder:'),'key')});
teardown();
console.log('\nResults: '+passed+' passed, '+failed+' failed, '+(passed+failed)+' total');
if(failed>0) process.exit(1);
