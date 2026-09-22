# PR #10 diagnostic follow-up

## Purpose and limitation
The unchanged Phase 2 head failed two Windows CI runs on initial browser navigation with ERR_NO_BUFFER_SPACE, in different tests. Six isolated local repetitions passed. Root cause remains unresolved; the available CI artifacts lack resource measurements. This patch supplies that missing evidence and does not claim a socket-resource fix.

## Scoped changes
- CI opt-in Windows resource snapshots before browser tests and at the first failed/timed-out/interrupted test.
- At most two bounded collections; 15-second outer deadline, 256-KiB output cap.
- Sanitized memory, process-tree and aggregate TCP data. No command lines, secrets, remote addresses or response bodies. Root process includes its parent PID for ancestry.
- One fixed loopback HEAD probe only at first failure, with 3-second timeout and no proxy, credentials or redirects.
- Original assertions, one worker, zero retries, baseline comparisons and test outcome remain intact.

## Focused evidence
- Three Node diagnostic unit tests passed.
- Two intentionally failing Playwright smoke cases retained exit 1 and original errors; exactly two snapshot files were created (baseline and first failure). This is controlled negative evidence, not a regression-suite failure.
- Windows PowerShell baseline smoke passed. Full-suite baseline snapshot subsequently contained resource data and no collection errors, with no baseline HTTP probe.
- Independent read-only review found no blocking correctness/privacy issue.

## Release boundary
No new remote run, push or merge has occurred for these changes. The replacement commit needs exact-SHA approval before pushing. PR #10 can merge only after required Windows checks pass; a recurrent failure requires diagnosis of the new measurements, not retries until green. Pages remains disabled. No application changes, broker connection, service cutover or submission unlock.

## Full verification
`npm run verify` passed all five stages in 770.1 seconds with diagnostic collection opted in: 207 Node passed / 2 skipped; 278 backend passed / 4 skipped / 2 existing warnings; TypeScript passed; 70 browser passed / 3 skipped; production build passed. No screenshot baselines changed. Both formerly affected journeys passed in this complete local run. Logs and baseline resource evidence remain under output/ci-diagnostics-verify*. This is local evidence, not the required remote CI result.

The pre-existing next-env.d.ts change was restored byte-for-byte after the build and is excluded from the commit. No rendered application behaviour changed, so no new frontend visual signoff is claimed for this diagnostic-only package.
