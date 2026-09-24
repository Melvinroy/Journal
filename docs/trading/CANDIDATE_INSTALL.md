# Brontide desktop candidate (Windows x64)

This is an **unsigned, local engineering candidate**, not a public trading release. It opens the existing Trading and Journal interface in a local browser. Broker connection and order submission remain disabled. A successful sample or automated test does not qualify it for live trading.

## Run this candidate

1. Obtain the candidate ZIP and its SHA-256 through a trusted project handoff. The manifest inside a ZIP detects accidental file changes but does not authenticate the publisher of that ZIP.
2. Extract the complete `Brontide-*` folder under your own Windows profile. Do not run an executable directly from inside the ZIP. If your normal PowerShell policy permits this unsigned local script, `& .\Install-Brontide.ps1 -Action Install` verifies every packaged file and installs this candidate under `%LOCALAPPDATA%\Programs\Brontide`, with a Start-menu shortcut. It does not download anything or request elevation. If the policy blocks it, stop; do not lower the policy.
3. Open **Brontide Candidate** from Start, or open `BrontideDesktop/BrontideDesktop.exe` in the extracted folder. Keep its console window open while using the local interface. The launcher opens your default browser on `127.0.0.1` using a fresh, one-use local session.
4. If Windows blocks the unsigned build, **stop**. Do not disable SmartScreen or lower PowerShell/Windows security settings. Use the reviewed source workflow until a signed build is available.
5. Close the console window to stop this candidate before an update, rollback, or uninstall. The current candidate has no broker-held or application-managed orders. A second launch of this build stops with an already-running message; close the first instance before launching again.

No Git, Node, Python, Supabase account, IBKR password, or IBKR API installation is required to view this locked candidate. It does not modify system Python, `PATH`, the existing Brontide service, or private trading records.

## Current limits

- The browser session is short-lived and permits only a sample view. A separate local profile stores the selected Connect/Trading/Journal view; its Windows access-denial proof remains pending. Broker account binding and imported records are not implemented.
- The package is unsigned. There is no trusted public download or one-command installation link yet.
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

The installer records the active candidate in `%LOCALAPPDATA%\Programs\Brontide\installation.json`. A failed or interrupted copy can leave an inactive version or pending directory requiring operator review. Do not delete those by guessing from a path. The shortcut and active record are checked on the next run, and a mismatch stops changes. This is a local candidate mechanism, not a signed updater or an unattended auto-update service. A future release needs independently tested interrupted-update recovery, clean-machine behavior, Windows access protection, signing, and a supported broker-data migration process.

## Build from reviewed source (contributors)

After `npm ci` and the documented private Python environment are set up, use an audited build toolchain and install exactly PyInstaller 6.22.3 in that build environment before running `scripts/package-windows-candidate.ps1`. The September 24 isolated build environment used pip 26.2.1 and setuptools 84.0.0; its advisory audit reported no known issues after replacing older bootstrap versions. That result does not audit the local project itself or authenticate a future installer. The script builds the local static frontend, makes a one-folder executable and ZIP under `output/modular-candidate`, and checks that the packaged assets are present. This contributor path is not the final end-user installation process.

The isolated lifecycle fixture check is `powershell.exe -NoProfile -File scripts/test-windows-candidate-lifecycle.ps1` from the repository root. It uses `rustc` to compile a tiny no-op Windows executable, creates a fresh per-user test installation, checks install/update/rollback/uninstall and fail-closed cases, then removes only that test installation. The fixture is **not** evidence that a real packaged candidate passed a clean-machine install or that private data migration is safe.
