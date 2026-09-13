// Producer-side adapter. Never imported by browser code; no credentials in arguments or output.
import { readFile } from 'node:fs/promises';
const file=process.argv[2];
const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!file||!url||!key){console.error('Usage: node scripts/ingest-catalyst.mjs report.json (requires server-side SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)');process.exit(1);}
try {
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw new Error();
  const payload=JSON.parse(await readFile(file,'utf8'));
  const response=await fetch(`${url}/rest/v1/rpc/ingest_catalyst_report`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${key}`},body:JSON.stringify({payload}),signal:AbortSignal.timeout(60000)});
  if(!response.ok){console.error(`Ingestion request failed (HTTP ${response.status}). No success confirmed; retry the identical payload.`);process.exit(1);}
  const result=await response.json();
  if(!['published','corrected','duplicate'].includes(result.status)){console.error('Report rejected. Inspect recorded ingestion diagnostics.');process.exit(1);}
  console.log(JSON.stringify({status:result.status,report_id:result.report_id,revision:result.revision}));
}catch{console.error('Ingestion could not be confirmed. Check payload and connection; retry with the same identity and revision.');process.exit(1);}
