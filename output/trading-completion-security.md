# Independent completion: dependency and security evidence

Observed September 23, 2026 (Singapore), **2026-09-22 20:37–20:38 UTC**. Repository HEAD at inspection: `b27ff02e87a8a698d3ff1137c75c8424fb1c3959`, branch `codex/trading-independent-completion`. This is a read-only dependency check, not live-readiness or application security certification.

## Separate environments

| Item | Repository | Accessible protected operator environment |
| --- | --- | --- |
| Interpreter | `C:/Users/melvi/Projects/Journal/services/eod/.venv/Scripts/python.exe` | `C:/Users/melvi/Projects/Journal-ui-refinement/services/eod/.venv/Scripts/python.exe` |
| Python | 3.11.9 | 3.11.9 |
| pip / setuptools / pip-audit | 26.2.1 / 84.0.0 / 2.10.1 | 26.2.1 / 84.0.0 / 2.10.1 |
| ibapi / protobuf | Absent / absent | 10.50.2 / 5.29.5 |
| `pip check` | Exit 0; no broken requirements | Exit 0; no broken requirements |
| `pip_audit --format json --progress-spinner off` | Audit exit 0; 56 dependency records, no reported advisories | Audit exit 1; 59 dependency records, protobuf finding below |

The operator interpreter was inspected as an accessible environment; this does not establish the identity or paths of any currently running desktop service. Runtime files were not changed. Both audits skip the editable `brontide-eod` package because it is not on PyPI. The operator audit also skips official `ibapi` 10.50.2 for that reason. Skipped source is not a security pass. Registry cache operations inherent to the audit tools do not constitute an environment install or upgrade.

Repository `npm audit --json` returned exit 0: **zero reported vulnerabilities**, 79 dependency entries. A clean repository audit does not clear the separate SDK-bearing operator environment or demonstrate absence of application vulnerabilities.

## Official SDK and supported repair

The [official IBKR download page](https://interactivebrokers.github.io/) still lists latest API 10.50 dated September 9, 2026 and stable API 10.45. Its latest Mac/Unix link is [10.50.2 archive](https://interactivebrokers.github.io/downloads/twsapi_macunix.1050.02.zip). The browser tool could not parse the ZIP content type; an independent HTTPS read downloaded the archive into memory, without installation or extraction to either checkout. Its Python setup metadata still pins **protobuf==5.29.5**. Installed operator metadata independently reports the same exact requirement.

- Archive: 11,412,955 bytes; SHA-256 `673129e5cba58c4d77bc40647265f84ea42f605eccf88fa4c1221d62d12454f3`.
- Python setup.py SHA-256: `5d221921bdfcc524704e5e8ef03ee4372e2b7332b745384fd9a0c75a8dbfe882`.
- These match the September 21 evidence. No new supported patched candidate was established, so no isolated install/validation was undertaken.

The operator audit reports **one unique advisory**, repeated twice as identical alias records: PYSEC-2026-1805 / CVE-2026-0994 / GHSA-7gcm-g887-7qv7. [Advisory details](https://github.com/advisories/GHSA-7gcm-g887-7qv7) identify affected protobuf 5.29.5 and patched versions 5.29.6 or 6.33.5. The issue concerns nested Any parsing in Python JSON conversion. Exploit reachability in Brontide was not demonstrated or waived.

**Gate remains blocked:** upgrading protobuf alone would violate the official SDK's inspected exact pin. Do not force an override or infer that the older stable SDK supports current application requirements. Require a vendor-supported compatible repair, then separately scoped isolated dependency/adapter/recovery validation before any operator runtime update.

## Scope and remaining work

Only this sanitized report was authored by this dependency review. No packages installed/upgraded, service restarted, broker endpoint called, cloud configuration changed, order submitted, approval amended, submission lock altered, or Git push/merge/deployment performed. Existing operator path/ACL, session/account, password-policy and broker acceptance gates are unaffected. No paid configuration change is implied.
