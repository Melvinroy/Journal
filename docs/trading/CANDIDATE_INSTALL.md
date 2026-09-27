# Brontide desktop candidate (Windows x64)

This is an **unsigned, local engineering candidate**, not a public trading release. It opens the existing Trading and Journal interface in a local browser. Broker connection and order submission remain disabled. A successful sample or automated test does not qualify it for live trading.

## Run this candidate

1. Obtain the candidate ZIP and its SHA-256 through a trusted project handoff. The manifest inside a ZIP detects accidental file changes but does not authenticate the publisher of that ZIP.
2. Extract the complete `Brontide-*` folder under your own Windows profile. Do not run an executable directly from inside the ZIP. If your normal PowerShell policy permits this unsigned local script, `& .\Install-Brontide.ps1 -Action Install` verifies every packaged file and installs this candidate under `%LOCALAPPDATA%\Programs\Brontide`, with a Start-menu shortcut. It does not download anything or request elevation. If the policy blocks it, stop; do not lower the policy.
3. Open **Brontide Candidate** from Start, or open `BrontideDesktop/BrontideDesktop.exe` in the extracted folder. Keep its console window open while using the local interface. The launcher opens your default browser on `127.0.0.1` using a fresh, one-use local session.
4. If Windows blocks the unsigned build, **stop**. Do not disable SmartScreen or lower PowerShell/Windows security settings. Use the reviewed source workflow until a signed build is available.
5. Close the console window to stop this candidate before an update, rollback, or uninstall. The current candidate has no broker-held or application-managed orders. A second launch of this build stops with an already-running message; close the first instance before launching again.

No Git, Node, Python, Supabase account, IBKR password, or IBKR API installation is required to view this locked candidate. It does not modify system Python, `PATH`, the existing Brontide service, or private trading records.

## If something goes wrong

- **Browser session locked or expired:** if the original console displays **Press R**, press R there to open a fresh one-use browser authorization. The newer unpackaged source also lets a second shortcut ask the owning process to reopen the browser. It now refuses that request if the private profile is missing or changed; do not recreate the profile to force a window. The older installed sample has neither feature; use its existing browser window or stop it before launching again.
- **Browser cannot reach `127.0.0.1`:** check whether the Brontide console is still open; relaunch normally if it closed. Do not expose the local port on another network interface.
- **Journal data looks unfamiliar:** this build shows **sample trades**, not your broker history. A missing sample row does not establish that a broker account is flat.
- **Update, rollback or install reports a pending copy or damaged state:** stop the lifecycle change, preserve the original ZIP and installation files, and use read-only `-Action List`. Do not delete a pending folder or private data to force a retry.
- **Profile/storage error:** preserve the exact message and private files for review. Do not publish tokens, account identifiers, private paths or ledger contents in an issue.

The current candidate never creates broker orders. A later broker-enabled release needs a separate shutdown, uncertainty and protection procedure; do not apply this sample's behavior to active trading.

## Current limits

- The browser session is short-lived and permits only a sample view. A separate local profile stores the selected Connect/Trading/Journal view; its Windows access-denial proof remains pending. Broker account binding and imported records are not implemented.
- The package is unsigned. There is no trusted public download or one-command installation link yet.
- The installed sample still stops a second launcher. Newer unpackaged source uses a one-bit Windows event created only by the instance-lock owner. The second launcher cannot read a port or authorization token; it merely asks the owner to mint and open a new browser session. Isolated same-session and fail-closed tests pass. A new packaged install, account/session separation and direct browser behavior remain unverified.
- Real TWS connection, paper acceptance, historical session target amendment, submissions and live orders are outside this candidate and remain blocked by their existing gates.
- Use [the modular product plan](../trading-modular-product-plan.md) for feature scope and [operator actions](OPERATOR_ACTIONS.md) for later manual qualification.

## Versioned candidate lifecycle

Run these commands from a **normal, non-elevated** PowerShell window after extracting the candidate ZIP. Close every `BrontideDesktop.exe` process first. The package manifest and every listed file are checked before install or activation. The manifest is unsigned, so these checks detect changes against that manifest but do **not** authenticate its publisher. Keep the original ZIP and its independently supplied SHA-256.

```powershell
# In the newly extracted candidate folder:
& .\Install-Brontide.ps1 -Action Update

# From an extracted candidate folder, inspect versions already installed:
& .\Install-Brontide.ps1 -Action List

# Supply an exact folder name returned by List; this does not fetch old versions:
& .\Install-Brontide.ps1 -Action Rollback -TargetFolder 'candidate-1.0.0-0123456789ab'

# Remove only lifecycle-managed candidate binaries and the owned shortcut:
& .\Install-Brontide.ps1 -Action Uninstall
```

`Update` accepts an equal-or-newer semantic version with a different source commit, retains the previous version, checks the package and the executable's read-only profile-schema command, then changes the active shortcut. `Rollback` only activates an already installed, verified version with compatible data schemas. An unknown, damaged, or newer profile schema blocks activation; it is never silently reset. `Uninstall` preserves `%LOCALAPPDATA%\BrontideStandalone` and any private trading data, and does not touch an unrelated Brontide shortcut. It does not remove older legacy folders that were installed before lifecycle state existed; those need separate inspection.

**Broker-data update gate:** this installer and package manifest currently accept `storeSchema = 0` for the locked sample. The source-only prepared paper ledger has SQLite `user_version = 1`. The newer, **unpackaged** executable source makes its read-only `--check-profile-schema` preflight refuse a private recorded-ledger directory and malformed known setup files. It also refuses a saved paper-account choice that lacks or conflicts with its exact owner reference. Isolated tests preserve the original bytes on refusal and accept valid unbound or linked setup without a ledger. A first launch in that source refuses to create a fresh identity beside other surviving private files if `profile.json` is missing. The older installed `d488631e` candidate predates these guards. This check does **not** validate or migrate the paper ledger, or prove flat positions, cleared orders and complete accounting. Before packaging a broker-enabled version, add a reviewed store-version transition and a consistent owner-scoped backup/restore procedure, then test downgrade refusal, unresolved commands and active exposure against an installed candidate. Do not relabel schema 0 as compatible with the recorded ledger.

The newer source's read-only `--diagnostics` summary uses the same locked-sample compatibility check. If recorded trade data or an unrecognized private file/folder is present, it reports only `unavailable-or-incompatible` rather than a misleading compatible label; it never prints private contents or paths. Two temporary-profile regressions proved the unknown-file/folder case and preservation of its bytes. This summary has not been checked in a rebuilt executable.

The installer records the active candidate in `%LOCALAPPDATA%\Programs\Brontide\installation.json`. A failed or interrupted copy can leave an inactive version or pending directory requiring operator review. Do not delete those by guessing from a path. The shortcut and active record are checked on the next run, and a mismatch stops changes. This is a local candidate mechanism, not a signed updater or an unattended auto-update service. A future release needs independently tested interrupted-update recovery, clean-machine behavior, Windows access protection, signing, and a supported broker-data migration process.

If `.candidate-pending-*` remains in the managed install root after an interrupted copy, `Install`, `Update`, `Rollback` and `Uninstall` now stop before changing the active version. `List` remains read-only. Preserve the pending item, the original ZIP and the installation state for review; do not delete the item or repeat an update by guessing which files are safe. The isolated lifecycle fixture verifies this refusal and preservation, but it does not prove recovery from an actual power loss or disk-full event.

Lifecycle changes also take a share-exclusive per-installation lock file in the owning user's `%LOCALAPPDATA%\Programs` directory. A simultaneous installer command fails before changing state; closing or crashing the process releases the Windows file handle. The lock file itself is retained. The fixture checks held-lock collisions in the same process and a separate PowerShell process, but the current candidate has not been tested through a real interrupted update or on a second Windows login session.

## Build from reviewed source (contributors)

After `npm ci` and the documented private Python environment are set up, use an audited build toolchain and install exactly PyInstaller 6.22.3 in that build environment before running `scripts/package-windows-candidate.ps1`. The September 24 isolated build environment used pip 26.2.1 and setuptools 84.0.0; its advisory audit reported no known issues after replacing older bootstrap versions. That result does not audit the local project itself or authenticate a future installer. The script builds the local static frontend, makes a one-folder executable and ZIP under `output/modular-candidate`, and checks that the packaged assets are present. A later source change also makes packaging reject known cloud-auth code signatures in the exported assets; the installed `d488631e` candidate fails that new check and must not be represented as a cloud-code-free build. This contributor path is not the final end-user installation process.

The isolated lifecycle fixture check is `powershell.exe -NoProfile -File scripts/test-windows-candidate-lifecycle.ps1` from the repository root. It uses `rustc` to compile a tiny no-op Windows executable, creates a fresh per-user test installation, checks install/update/rollback/uninstall and fail-closed cases, then removes only that test installation. The fixture is **not** evidence that a real packaged candidate passed a clean-machine install or that private data migration is safe.
