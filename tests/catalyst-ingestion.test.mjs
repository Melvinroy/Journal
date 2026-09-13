import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
// Only an explicitly selected disposable local database is accepted.
const enabled=process.env.CATALYST_TEST_DB==='1';
const psql=process.env.CATALYST_PSQL||'psql';
function sql(query,role='service_role'){
 const result=spawnSync(psql,['-X','-q','-t','-A','-h','127.0.0.1','-p',process.env.CATALYST_TEST_PORT||'54329','-U','postgres','-d',process.env.CATALYST_TEST_DATABASE||'postgres','-v','ON_ERROR_STOP=1'],{input:`set role ${role};\n${query}`,encoding:'utf8'});
 if(result.status!==0)throw new Error(result.stderr);
 return result.stdout.trim();
}
const row={table_number:3,row_order:1,ticker:'FIX',catalyst_event_date:'2026-09-03',catalyst_quality_direction:'A Bullish',primary_catalyst_category:'Earnings',catalyst_tags:'Fixture',catalyst_summary:'Synthetic event',sector:'Technology',theme:'Fixture',direct_sympathy_sector_move:'Direct',sympathy_related_tickers:'None',catalyst_release_session:'Premarket',reaction_date:'2026-09-03',move_already_done:'None',volume_liquidity_confirmation:'Not assessed',freshness_catalyst_age:'Same-day',source_confidence:'High',primary_source_evidence:'Synthetic fixture',trade_read:'Fixture only',risk_invalidator:'Fixture',action_priority:'High-Conviction Watch',trading_date_checked:'2026-09-03'};
const base={report_type:'Premarket',report_key:'fixture-'+Date.now(),source:'isolated-test',output_version:'Catalyst_Table_v2',revision:1,expected_revision:0,report_date:'2026-09-03',coverage_start:'2026-09-02',coverage_end:'2026-09-03',generated_at:'2026-09-03T20:30:00+08:00',published_at:'2026-09-03T12:35:00Z',raw_report_text:'Complete isolated fixture report',rows:[row]};
function ingest(payload){return JSON.parse(sql(`select public.ingest_catalyst_report('${JSON.stringify(payload).replaceAll("'","''")}'::jsonb);`));}
test('atomic ingestion, three types, duplicate retries, revision history, rejected corrections, access controls',{skip:!enabled},()=>{
 const pre=ingest(base);assert.equal(pre.status,'published');
 const post=ingest({...base,report_type:'Postmarket',rows:[]});assert.equal(post.status,'published');assert.notEqual(post.report_id,pre.report_id);
 const weekend=ingest({...base,report_type:'Weekend Summary'});assert.equal(weekend.status,'published');
 assert.equal(ingest(base).status,'duplicate');
 const corrected={...base,revision:2,expected_revision:1,rows:[{...row,catalyst_summary:'Corrected fixture'}]};
 assert.equal(ingest(corrected).status,'corrected');assert.equal(ingest(corrected).status,'duplicate');assert.equal(ingest(base).status,'duplicate');
 assert.equal(sql(`select count(*) from public.catalyst_report_revisions where report_id='${pre.report_id}';`),'2');
 assert.equal(sql(`select catalyst_summary from public.catalyst_rows where report_id='${pre.report_id}';`),'Corrected fixture');
 assert.equal(sql(`select result_count from public.catalyst_reports where id='${post.report_id}';`),'0');
 for(const payload of [{...corrected,rows:[]},{...base,report_type:'Sunday'},{...base,coverage_end:'2026-02-30'},{...base,generated_at:'2026-09-03T12:00:00'},{...base,coverage_start:'2026-09-04'},{...base,raw_report_text:''},{...base,revision:3,expected_revision:2,rows:[{...row,trading_date_checked:'2026-09-04'}]},{...base,revision:3,expected_revision:2,rows:[{...row,source_confidence:'invented'}]},{...base,rows:null}])assert.equal(ingest(payload).status,'rejected');
 assert.equal(sql(`select catalyst_summary from public.catalyst_rows where report_id='${pre.report_id}';`),'Corrected fixture');
 assert.equal(sql(`select count(*) from public.catalyst_reports where source='isolated-test' and report_key='${base.report_key}';`),'3');
 assert.equal(sql(`select count(*) from public.catalyst_dashboard_rows where report_id='${weekend.report_id}';`,'authenticated'),'1');
 assert.throws(()=>sql(`select public.ingest_catalyst_report('{}'::jsonb);`,'authenticated'),/permission denied/);
 assert.throws(()=>sql(`select * from public.catalyst_report_revisions;`,'authenticated'),/permission denied/);
 assert.throws(()=>sql(`select * from public.catalyst_reports;`,'anon'),/permission denied/);
 assert.throws(()=>sql(`delete from public.catalyst_reports where id='${pre.report_id}';`,'authenticated'),/permission denied/);
 if(process.env.CATALYST_INGESTED_FIXTURE){
   const ids=[pre.report_id,post.report_id,weekend.report_id].map(id=>`'${id}'`).join(',');
   writeFileSync(process.env.CATALYST_INGESTED_FIXTURE,sql(`select jsonb_build_object('reports',(select jsonb_agg(r) from public.catalyst_reports r where id in (${ids})),'rows',(select jsonb_agg(r) from public.catalyst_dashboard_rows r where report_id in (${ids})));`,'postgres'));
 }
});
test('simultaneous duplicate deliveries serialize into one report and one revision',{skip:!enabled},async()=>{
 const payload={...base,report_key:base.report_key+'-concurrent',rows:[]};
 const query=`set role service_role; select public.ingest_catalyst_report('${JSON.stringify(payload).replaceAll("'","''")}'::jsonb);`;
 const run=()=>new Promise((resolve,reject)=>{
   const child=spawn(psql,['-X','-q','-t','-A','-h','127.0.0.1','-p',process.env.CATALYST_TEST_PORT||'54329','-U','postgres','-d',process.env.CATALYST_TEST_DATABASE||'postgres','-v','ON_ERROR_STOP=1']);
   let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
   child.on('error',reject);child.on('close',code=>code?reject(new Error(errors)):resolve(JSON.parse(output.trim())));child.stdin.end(query);
 });
 const results=await Promise.all([run(),run()]);
 assert.deepEqual(results.map(r=>r.status).sort(),['duplicate','published']);
 assert.equal(results[0].report_id,results[1].report_id);
 assert.equal(sql(`select count(*) from public.catalyst_report_revisions where report_id='${results[0].report_id}';`),'1');
});
