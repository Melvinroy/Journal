# Catalyst reports and delivery

This package changes only Discover → Catalysts plus the app-level route from demo to the existing sign-in screen. Scans, Charts, Trading and broker integrations are unchanged. The original Catalyst package was built on `fd6e934c2085d4a1639246f2bbbd29c3525585ac`; this milestone fetched and merged source-of-truth `origin/main` at `795dc8e4345e0a73ab5f7cb40a49ed4f4f3456cf` into `codex/catalyst-reports` before making the fixes below. No push, main merge, deployment, production migration or external-task update occurred.

The pre-integration working tree is recoverable from `C:\Users\melvi\.codex\snapshots\Journal\20260910-191134` and the retained local stash named `catalyst-pre-main-integration-20260910`. Local checkpoint `84e1020` contains the original Catalyst package and local merge `ad5023a` incorporates released main.

## Verified existing flow

The signed-in ChatGPT Scheduled UI exposes three active tasks. Their prompts explicitly require finalized `Catalyst_Table_v2` output in ChatGPT, followed by separate inserts into `public.catalyst_reports` and `public.catalyst_rows` in the `trading-journal` Supabase project. The dashboard reads the invoker-security `catalyst_dashboard_rows` view, which joins reports to Table 3 rows. There are no Supabase Edge Functions or pg_cron/pg_net extensions in this project. No Catalyst producer exists in this repository's EOD service.

Observed on 10 September 2026, without saving or running tasks:

| Display type | Existing producer label | Configured recurrence | Timezone |
| --- | --- | --- | --- |
| Premarket | Premarket Catalyst Brief | Monday–Friday, 20:30 | Asia/Singapore |
| Postmarket | After-Market Catalyst Brief | Tuesday–Saturday, 08:30 | Asia/Singapore |
| Weekend Summary | Weekend Catalyst Summary | Sunday, 20:45 | Asia/Singapore |

Weekday selections and times were inspected in the task editors; the task prompts explicitly specify Singapore time. The editor does not separately expose an IANA timezone field. All tasks require holiday-format reports, so no exchange-holiday suppression is introduced. No delivery deadline was specified: the observed configuration uses a null grace period, so it tracks expected receipt without inventing a lateness deadline. The dated fallback is restricted to the verified Supabase project. Other installations have no assumed schedules.

The latest displayed task outputs confirmed Premarket persistence under `6cb70eeb-2f5c-49c2-8751-26051a48aa33` and Postmarket under `22e3316c-cf1a-4e53-8baf-038880385d82`. The Postmarket task's MD5 `0ea74805488f4538bac5c28fa5842da4` matches the actual stored `raw_report_text`. Weekend's September 6 output matches the stored header and Table 3 inventory under `42525273-7f22-4a40-9dab-66587be11b17`. This is data-lineage verification, not verification of the reports' market-news claims.

The live database had 32 reports at inspection. Latest Table 3 counts were Premarket 23, Postmarket 28, Weekend Summary 20. Weekend was already ingested: its next-session trading date is September 8 while the newest daily report is September 9. The old UI's shared date window and ticker aggregation hid it and mixed report types. Separate header/row writes also allow incomplete reports, and existing uniqueness by generated timestamp does not identify retries or corrections. An empty September 8 header and a later retry are retained as evidence; zero rows alone do not prove zero qualifying results.

## Implementation

The UI uses exact producer-label mappings, selects a report ID within a type, and paginates history and rows. A new visit defaults to the newest publication across known types. Explicit type and history choices use session storage so they survive workspace navigation and refreshes without allowing an old local preference to masquerade as Latest on a later visit. Missing selected types never fall back to another type. Raw report bodies load only for the selected report. Legacy coverage text is retained; normalized coverage dates and source attribution are used when available. Unknown types remain Unknown. Only the three individually traced legacy report IDs receive the verified producer attribution.

The demo URL itself was the cause of the fictional September data: `?demo=1` deliberately bypasses authentication and loads isolated fixtures. Current main also has a local-workspace build mode that bypasses cloud sign-in for local Trading development. The review preview is now started without that mode, and a persistent, responsive Demo data banner exposes **Leave demo and sign in** from every workspace. It removes the demo query and reaches the existing Supabase email/password screen. Demo fixtures never execute the authenticated query path.

Leadership now follows the producer's A+/A/B classification and original row order; the earlier calculated 10–100 score was removed. Cards show the stored catalyst and trade read. Inventory and ticker detail preserve every structured Table 3 field and safe HTTP(S) evidence links. The Full report tab renders `raw_report_text` as inert text, including content outside ticker rows. When a legacy record has no original text, the UI says it is unavailable and shows only separately stored summary fields; it never reconstructs a report from rows. New RPC payloads must include a non-empty original report body.

Report publication, scheduler execution, generation and ingestion remain separate. `catalyst_delivery_status` returns the latest observation per type/stage, while `catalyst_delivery_events` retains history. A missing receipt never establishes a scheduler failure. Dated task observations are labeled separately from live telemetry. UTC-minute recurrence evaluation handles Singapore date boundaries and DST gaps/folds. A legacy receipt after an expected run is labeled as received with unverified run linkage; its run identity is not guessed.

The dashboard's theme panel is anchored to the selected report. `Selected report` uses every classified row in that report. `1D`, `3D`, `1W`, and `2W` mean 1, 3, 5, and 10 completed U.S. market sessions ending at the selected report's covered session; the checked-in U.S. holiday rule matches the repository's EOD calendar logic. The range never reads a report published or received after the selected report's reliable as-of timestamp. Publication is preferred, with receipt used and labeled only when publication is absent.

Theme counts use unique tickers per normalized theme and keep bullish and bearish classifications separate on one shared scale. For the same ticker and theme, the most recent explicitly ordered classification wins; a newer neutral or unclassified result removes the earlier directional contribution. Equal-order contradictions are excluded as ambiguous. Weekend rows use their row-level event or reaction date in broader ranges, and undated weekend items are excluded and counted. Legacy Weekend reports without structured coverage cannot establish a broader session anchor, so the UI reports that limitation instead of inferring dates from prose or report timing. Catalog and row reads remain bounded and paginated, and range responses are discarded when the selection changes.

The additive migration bootstraps the optional existing feed on a fresh database and upgrades an existing one without rewriting legacy records or ownership policies. The browser remains read-only. The RPC is SECURITY INVOKER and executable only by `service_role`; existing authenticated read access and RLS are retained. Revisions are service-only. Diagnostics accept a fixed set of readable summaries instead of raw exceptions or credentials.

## Producer contract, ready for later authorized rollout

Apply `supabase/migrations/20260910092603_catalyst_report_delivery.sql` to the intended development environment before using `ingest_catalyst_report`. This task did not apply it to the connected remote project. Replace the tasks' two-step persistence instructions with one RPC call only in a separately authorized external update; keep all research, TSV formatting, recurrence, timezone and holiday requirements unchanged.

Verified rollout target and existing task identifiers:

| Item | Identifier |
| --- | --- |
| Supabase project | `trading-journal` / `fsccmouzyfgcpqlmcngu` |
| Migration | `20260910092603_catalyst_report_delivery.sql` |
| RPC | `public.ingest_catalyst_report(payload jsonb)` |
| Premarket task | `6a19db055948819191d329ec05e1d57a` |
| Postmarket task | `6a19db0f038c8191ab5cda18d309b500` |
| Weekend task | `6a1a3f163aec81919c45c6eb61c32deb` |

The exact external change is: apply the additive migration first, then replace each of those three tasks' separate report-header and row inserts with one call to the RPC using the finalized report's stable identity, explicit type, U.S. coverage dates, offset-bearing generation/publication timestamps, full `raw_report_text`, and complete rows. Keep the three task schedules and research/report-generation instructions unchanged. Update the existing tasks in place; do not create parallel tasks.

Partial rollout is compatible: the migration preserves the legacy columns and dashboard view, and the dashboard falls back to the legacy column set while the migration is absent. If RPC rollout fails, restore the affected task's prior persistence instructions while retaining the additive schema and immutable revision data. Do not drop the migration tables or delete accepted reports as rollback. After all three tasks use the RPC, verify one naturally scheduled run per type from task output to RPC result, revision/event rows, report checksum and authenticated dashboard rendering before treating the flow as live end to end.

Call `public.ingest_catalyst_report(payload jsonb)` using the producer's existing privileged Supabase connector, or `node scripts/ingest-catalyst.mjs report.json` with server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never place a privileged key in `NEXT_PUBLIC_*` or browser code. The adapter reports only the safe status, report ID and revision.

```json
{
  "report_type": "Weekend Summary",
  "report_key": "stable-producer-report-identity",
  "source": "ChatGPT scheduled catalyst report",
  "revision": 1,
  "expected_revision": 0,
  "report_date": "2026-09-08",
  "coverage_start": "2026-09-03",
  "coverage_end": "2026-09-06",
  "generated_at": "2026-09-06T20:49:00+08:00",
  "published_at": "2026-09-06T21:01:00+08:00",
  "scheduled_for": "2026-09-06T20:45:00+08:00",
  "output_version": "Catalyst_Table_v2",
  "coverage_window": "Explicit producer coverage description",
  "market_session_focus": "Weekend / Pre-Week Watch",
  "market_summary": "Explicitly empty fixture; not market content",
  "themes_summary": "",
  "best_focus": "",
  "raw_report_text": "Exact finalized report text",
  "rows": []
}
```

Use only `Premarket`, `Postmarket`, or `Weekend Summary` at ingestion. Storage retains the existing exact producer labels for compatibility. Each row has `table_number`, positive `row_order`, and the existing 21 snake_case fields; `trading_date_checked` must equal `report_date`. Do not send row IDs, report IDs or created timestamps. Existing category/grade/session constraints remain authoritative. Table 1/2 tickers must also be in Table 3. `rows: []` is an explicit published zero-result report, not a missing payload.

Keep `(source, report_type, report_key)` stable across retries and corrections; never derive type solely from timestamps. An identical revision replay returns `duplicate`, including delayed retries of a previously superseded revision. A correction increments revision and names the current `expected_revision`; stale or conflicting corrections are rejected. Concurrent deliveries serialize by report identity. Each accepted revision stores the complete immutable payload; the current report ID stays stable and only its current rows change atomically. No other type or report is replaced. Malformed corrections roll back all report/row writes and record a sanitized ingestion failure. Existing legacy reports are never automatically merged into a new identity.

`published_at` means producer publication, `generated_at` means report generation, and database `created_at`/revision `received_at` mean receipt. All timestamps require offsets. `scheduled_for` must be supplied from actual scheduler run identity, not inferred from report dates. Report date may represent the next U.S. trading session; coverage dates need not equal it.

Populate schedule metadata only from observed configuration. Optional scheduler/generation event writers can insert authenticated producer observations into `catalyst_delivery_events`; retain stage and actual observation/run timestamps. Never write a scheduler-failure event merely because no report arrived. These external telemetry writers and the persistence-instruction change are not deployed by this package.

## Verification commands

`node --test tests/*.test.mjs` runs the current checkout's unit/regression suite. The PostgreSQL test deliberately skips unless `CATALYST_TEST_DB=1`; it only connects to loopback, never a remote database. Use a disposable local PostgreSQL database and the migration. For upgrade testing, first apply `tests/fixtures/catalyst-legacy-schema.sql` and insert a legacy sentinel, then apply the migration. Set `CATALYST_PSQL`, `CATALYST_TEST_PORT`, and `CATALYST_TEST_DATABASE` as needed. Tests retain isolated fixture records in this disposable database.

Set `CATALYST_INGESTED_FIXTURE` to a private local JSON path when running `tests/catalyst-ingestion.test.mjs` to export exactly the tested reports for browser replay. `CATALYST_LIVE_FIXTURE` optionally points to a private read-only snapshot with `reports` and `rows` arrays. Neither export belongs in Git.

Run `npx playwright test --config=playwright.catalyst.config.ts` for fixture verification. The config owns a dedicated server on port 3018 with a fake public Supabase origin and refuses to reuse another process. It shuts that server down after the run, so fixture environment values cannot contaminate the normal authenticated preview on port 3017. The browser tests intercept the fake origin; they never send privileged credentials or writes to Supabase.

The normal preview is `http://127.0.0.1:3017/?demo=1`, Discover → Catalysts. Demo-only `catalystFixture=missing`, `late`, and `failure` query parameters exercise isolated delivery states. The production feed ignores these parameters. `npm run build` verifies the repository's static-export path. No deployment follows.

Limitations: the read-only real-data browser test is a replay of actual Supabase query results, not an authenticated browser session against the live project. Local SQL verification uses PostgreSQL 16.8; the connected managed project is PostgreSQL 17.6 and was inspected read-only. External tasks still use their original separate inserts until an authorized rollout changes their persistence instructions. Exact Premarket/Postmarket execution completion timestamps and continuous scheduler telemetry are not exposed by the inspected UI. Physical-device, Safari and Firefox testing are not included.

## Current milestone evidence, 10 September 2026

- Source of truth: released main `795dc8e4345e0a73ab5f7cb40a49ed4f4f3456cf` is an ancestor of this branch. Preview identity and final local commit are recorded in the milestone handoff after verification.
- Focused automated checks: the six report/schedule tests pass; the fresh PostgreSQL 16.8 migration and both ingestion tests pass; the legacy-schema upgrade preserves a Weekend sentinel ID, raw text and null legacy revision; all seven Catalyst Playwright scenarios pass, including a failed-row request with unavailable metrics and retained full text. The full repository `npm run verify` passes all five stages: 181 Node tests with 2 intentional local-database skips, 135 EOD tests, TypeScript, all 30 browser regressions, and the production build.
- Live compatibility repair: the authenticated browser returned PostgreSQL `42703` because the legacy production table lacks `report_key`. Catalog fallback succeeded, but selected-report detail repeated the enhanced-only query and stopped before reading the existing `catalyst_dashboard_rows` view. Detail loading now retries with verified legacy columns, preserves full report text independently, and reads rows through the existing authenticated view. Direct live verification reconciled Premarket 2026-09-10 at 20 rows, Postmarket 2026-09-09 at 28 rows and Weekend Summary 2026-09-08 at 20 rows with database counts. A browser-level row-request interruption showed unavailable metrics, compact retry, retained Weekend full text, and recovery to 20 rows.
- Direct browser: Chrome showed the current preview identity, the responsive Demo data banner, Discover → Catalysts desktop inventory, exact type/history controls, the full-report body and honest legacy-unavailable state. Leaving demo visibly reached the existing Supabase sign-in form without credentials. Automated 1440×900 and 390×844 captures cover responsive and keyboard/error states; they are fixture/captured-data checks, not live end-to-end proof.
- Real-data evidence remains the traced producer outputs and read-only Supabase capture described above: 23 Premarket, 28 Postmarket and 20 Weekend rows at that observation, with exact report IDs and the Postmarket checksum match. Counts are observations, not fixed expectations. The currently inspected scheduled-task page confirms the three tasks remain active and provides the IDs recorded in the rollout table.
- Scope: main integration preserved released Scans, Charts and Trading. This milestone adds the app-level demo exit/sign-in route, Catalyst report/full-text UI and focused tests. No push, main merge, deployment, production migration or task edit occurred.

Remaining rollout requires explicit authorization to apply the named migration and update the three named tasks, followed by a user-completed live sign-in for the final authenticated production-path observation. Continuous scheduler execution telemetry remains unavailable; the dashboard therefore keeps it distinct as `Not observable`.
