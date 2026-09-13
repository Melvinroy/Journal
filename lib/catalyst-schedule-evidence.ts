import type { Schedule } from "./catalyst-reports";
// Read-only observation of the three ChatGPT task editors, 10 September 2026.
// Scoped to the verified project; this is not a live scheduler API or a default for other installations.
export const CATALYST_PROJECT_URL="https://fsccmouzyfgcpqlmcngu.supabase.co";
export const VERIFIED_REPORT_SOURCES: Record<string,string> = {
  "6cb70eeb-2f5c-49c2-8751-26051a48aa33":"ChatGPT · Premarket Catalyst Brief (producer output verified 10 Sep 2026)",
  "22e3316c-cf1a-4e53-8baf-038880385d82":"ChatGPT · After-Market Catalyst Brief (producer ID and payload checksum verified 10 Sep 2026)",
  "42525273-7f22-4a40-9dab-66587be11b17":"ChatGPT · Weekend Catalyst Summary (producer header and inventory verified 10 Sep 2026)",
};
export const OBSERVED_SCHEDULES: Schedule[] = [
  {report_type:"Premarket",timezone:"Asia/Singapore",weekdays:[1,2,3,4,5],local_time:"20:30",grace_minutes:null,effective_from:"2026-09-10T09:37:18Z",evidence:"ChatGPT task editor and prompt observed 10 Sep 2026: Monday–Friday 20:30 Singapore time. Delivery deadline not specified.",last_observed_result:"Last observed output: 9 Sep report · persistence confirmed by producer. Run completion timestamp not exposed."},
  {report_type:"Postmarket",timezone:"Asia/Singapore",weekdays:[2,3,4,5,6],local_time:"08:30",grace_minutes:null,effective_from:"2026-09-10T09:37:18Z",evidence:"ChatGPT task editor and prompt observed 10 Sep 2026: Tuesday–Saturday 08:30 Singapore time. Delivery deadline not specified.",last_observed_result:"Last observed output: 10 Sep morning · persistence ID/checksum matched. Run completion timestamp not exposed."},
  {report_type:"Weekend Summary",timezone:"Asia/Singapore",weekdays:[7],local_time:"20:45",grace_minutes:null,effective_from:"2026-09-10T09:37:18Z",evidence:"ChatGPT task editor and prompt observed 10 Sep 2026: Sunday 20:45 Singapore time. Delivery deadline not specified.",last_observed_result:"Last observed output: Sunday 6 Sep, 21:01 SGT · producer reported persistence completed."},
];
