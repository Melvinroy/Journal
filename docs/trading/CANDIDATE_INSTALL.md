# Brontide desktop candidate (Windows x64)

This is an **unsigned, local engineering candidate**, not a public trading release. It opens the existing Trading and Journal interface in a local browser. Broker connection and order submission remain disabled. A successful sample or automated test does not qualify it for live trading.

## Run this candidate

1. Obtain the candidate ZIP and its SHA-256 through a trusted project handoff. The manifest inside a ZIP detects accidental file changes but does not authenticate the publisher of that ZIP.
2. Extract the complete `Brontide-*` folder under your own Windows profile. Do not run an executable directly from inside the ZIP. If your normal PowerShell policy permits this unsigned local script, `& .\Install-Brontide.ps1` verifies every packaged file and copies this candidate into your user profile with a Start-menu shortcut. It does not download anything or request elevation. If the policy blocks it, stop; do not lower the policy.
3. Open **Brontide Candidate** from Start, or open `BrontideDesktop/BrontideDesktop.exe` in the extracted folder. Keep its console window open while using the local interface. The launcher opens your default browser on `127.0.0.1` using a fresh, one-use local session.
4. If Windows blocks the unsigned build, **stop**. Do not disable SmartScreen or lower PowerShell/Windows security settings. Use the reviewed source workflow until a signed build is available.
5. Close the console window to stop this candidate. The current candidate has no broker-held or application-managed orders.

No Git, Node, Python, Supabase account, IBKR password, or IBKR API installation is required to view this locked candidate. It does not modify system Python, `PATH`, the existing Brontide service, or private trading records.

## Current limits

- The browser session is short-lived and permits only a sample view. A separate local profile stores the selected Trading/Journal view; its Windows access-denial proof remains pending. Broker account binding, imported records and a single-instance launcher are not yet implemented.
- The package is unsigned. There is no trusted public download or one-command installation link yet.
- Real TWS connection, paper acceptance, historical session target amendment, submissions and live orders are outside this candidate and remain blocked by their existing gates.
- Use [the modular product plan](../trading-modular-product-plan.md) for feature scope and [operator actions](OPERATOR_ACTIONS.md) for later manual qualification.

## Build from reviewed source (contributors)

After `npm ci` and the documented private Python environment are set up, install exactly PyInstaller 6.22.3 in that build environment and run `scripts/package-windows-candidate.ps1`. The script builds the local static frontend, makes a one-folder executable and ZIP under `output/modular-candidate`, and checks that the packaged assets are present. This contributor path is not the final end-user installation process.
