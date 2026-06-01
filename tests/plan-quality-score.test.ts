#!/usr/bin/env ts-node
import * as fs from 'fs'; import * as path from 'path'; import * as os from 'os';
const TEST_DIR = path.join(os.tmpdir(), 'pqs-test');
function calc(cs:number,f:number,total:number,po:number):number{if(total===0)return 0;return Math.round((cs*0.6)+((1-f/total)*100*0.3)+(1-po/total)*100*0.1);}
interface E{date:string;pipelineId:string;feature:string;complianceScore:number;totalCheckpoints:number;failedCheckpoints:number;skippedCheckpoints:number;planOmissions:number;planQualityScore:number;}
function agg(es:E[]):any{const t=es.length;const avg=t>0?Math.round(es.reduce((s,e)=>s+e.planQualityScore,0)/t):0;const low=es.filter(e=>e.planQualityScore<70).length;return{plandescriber:{totalScores:t,avgScore:avg,lowScoreCount:low},features:{}};}
function record(path:string,e:E):any{let d:any={entries:[],aggregates:{plandescriber:{totalScores:0,avgScore:0,lowScoreCount:0},features:{}}};if(fs.existsSync(path))d=JSON.parse(fs.readFileSync(path,'utf-8'));d.entries.push(e);d.aggregates=agg(d.entries);fs.writeFileSync(path,JSON.stringify(d,null,2),'utf-8');return d;}
function query(path:string,feat:string):E[]{if(!fs.existsSync(path))return [];const d=JSON.parse(fs.readFileSync(path,'utf-8'));return d.entries.filter((e:E)=>e.feature===feat);}
function queryPd(path:string):any{if(!fs.existsSync(path))return{avg:100,low:0,total:0,exit:0};const d=JSON.parse(fs.readFileSync(path,'utf-8'));const a2=d.aggregates.plandescriber;let exit=a2.avgScore>=85?0:a2.avgScore>=70?1:2;return{avg:a2.avgScore,low:a2.lowScoreCount,total:a2.totalScores,exit};}
let p1=0,f1=0;
function t(n:string,fn:()=>void){try{fn();p1++;console.log('OK '+n);}catch(e){f1++;console.log('FAIL '+n+': '+(e instanceof Error?e.message:String(e)));}}
function a(c:boolean,m:string){if(!c)throw new Error(m);}
function ae<T>(a:T,b:T,m:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(m+': exp '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function setup(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});fs.mkdirSync(TEST_DIR,{recursive:true});}
function teardown(){if(fs.existsSync(TEST_DIR))fs.rmSync(TEST_DIR,{recursive:true});}
setup();
t('perfect score 100',()=>{ae(calc(100,0,10,0),100,'s')});
t('zero score',()=>{ae(calc(0,10,10,10),0,'s')});
t('partial score',()=>{ae(calc(85,2,10,1),84,'s')});
t('defaultQualityData',()=>{const d:any={entries:[]};d.aggregates=agg(d.entries);ae(d.aggregates.plandescriber.avgScore,0,'avg')});
t('computeAggregates single',()=>{const es:E[]=[{date:'',pipelineId:'p1',feature:'t',complianceScore:100,totalCheckpoints:10,failedCheckpoints:0,skippedCheckpoints:0,planOmissions:0,planQualityScore:100}];const a2=agg(es);ae(a2.plandescriber.totalScores,1,'t');ae(a2.plandescriber.avgScore,100,'avg');ae(a2.plandescriber.lowScoreCount,0,'low')});
t('computeAggregates low score',()=>{const es:E[]=[{date:'',pipelineId:'p1',feature:'t',complianceScore:40,totalCheckpoints:10,failedCheckpoints:8,skippedCheckpoints:0,planOmissions:5,planQualityScore:35},{date:'',pipelineId:'p2',feature:'t',complianceScore:100,totalCheckpoints:10,failedCheckpoints:0,skippedCheckpoints:0,planOmissions:0,planQualityScore:100}];const a2=agg(es);ae(a2.plandescriber.lowScoreCount,1,'one low')});
t('record and query',()=>{const fp=path.join(TEST_DIR,'s.json');const e:E={date:'2025-01-01',pipelineId:'p1',feature:'test-feat',complianceScore:85,totalCheckpoints:10,failedCheckpoints:2,skippedCheckpoints:1,planOmissions:1,planQualityScore:calc(85,2,10,1)};record(fp,e);const r=query(fp,'test-feat');a(r.length===1,'found');ae(r[0].pipelineId,'p1','pid')});
t('query empty',()=>{ae(query('/nonexistent.json','nonexistent'),[],'empty')});
t('queryPd high score',()=>{const fp=path.join(TEST_DIR,'q.json');const e:E={date:'',pipelineId:'p1',feature:'t',complianceScore:100,totalCheckpoints:10,failedCheckpoints:0,skippedCheckpoints:0,planOmissions:0,planQualityScore:95};record(fp,e);ae(queryPd(fp).exit,0,'exit 0')});
t('queryPd mid score',()=>{const fp=path.join(TEST_DIR,'q2.json');const e:E={date:'',pipelineId:'p1',feature:'t',complianceScore:70,totalCheckpoints:10,failedCheckpoints:3,skippedCheckpoints:1,planOmissions:2,planQualityScore:75};record(fp,e);ae(queryPd(fp).exit,1,'exit 1')});
t('queryPd low score',()=>{const fp=path.join(TEST_DIR,'q3.json');const e:E={date:'',pipelineId:'p1',feature:'t',complianceScore:40,totalCheckpoints:10,failedCheckpoints:8,skippedCheckpoints:0,planOmissions:5,planQualityScore:35};record(fp,e);ae(queryPd(fp).exit,2,'exit 2')});
t('queryPd missing file',()=>{const r=queryPd('/nonexistent.json');ae(r.exit,0,'exit 0');ae(r.avg,100,'default 100')});
teardown();
console.log('\n'+p1+' passed, '+f1+' failed'); if(f1>0)process.exit(1);
