# Brontide local app: recovery guide

**Current release state:** The installed Windows candidate is a **locked sample**. It shows sample Trading and Journal data. It has no broker connection, cannot place an order and does not manage a stop. The steps below do not turn it into a paper or live trading release.

## If the current sample stops working

| What you see | What to do | What it means |
| --- | --- | --- |
| The local browser session says it is locked or expired | Open **Brontide Candidate** from the Start menu again. If the app is already running, return to its existing browser window; the second launcher currently stops safely instead of opening a new session. | A fresh launch gives a new one-use browser authorization. It does not connect to IBKR or unlock orders. |
| The browser page cannot reach `127.0.0.1` | Check whether the Brontide console is still open. If it closed, launch the candidate normally. Do not use a different host or expose its port on your network. | The current app runs only on this computer and stops when its console process ends. |
| Journal shows sample trades or a saved view seems missing | Check that the page says **Sample trades**. The local profile only remembers the selected view; it has not imported your trading records. | A sample row is not evidence of a broker fill, account position or protected order. |
| An update or rollback refuses to run | Close the candidate and use `-Action List` from the extracted installer folder. Keep the original ZIP and its separately supplied hash. If the installer reports a pending copy or damaged state, preserve the files for review and stop the lifecycle change. | The installer refuses an uncertain partial copy rather than guessing which version is safe. Do not delete a pending folder or private data to force the update. |
| A profile or storage error appears | Stop using that candidate and preserve its private profile and any backup. Record the exact message and version without sharing tokens, account numbers, private paths or ledger contents publicly. | The current app must not silently create a replacement identity or claim that missing history means zero exposure. |

The newer **unpackaged source** now explicitly refuses a first launch when the profile file is missing but another private file or recorded-trade directory remains. It preserves those files for recovery instead of creating a new identity beside them. This was checked with temporary files only; the older installed sample and the owner's real storage have not been retested. Do not delete the remaining files or create a new profile to make the app open.

The newer **unpackaged source** adds **R to reopen** in the original console and a second-shortcut reopen request. A second launcher sends only a signal; the original process issues the fresh one-use browser authorization and opens the browser, without starting another engine. Isolated same-session tests passed, but this has not been built or checked in the installed candidate. If the request cannot reach the owner, use the original window or console R action. The older installed sample still refuses a second launch.

Closing the **current locked sample** cannot cancel broker orders because this candidate never creates or manages them. That statement does **not** describe a future broker-enabled Brontide release.

## If a future broker-enabled release reports a problem

These are release requirements and operator rules, **not functions enabled in the current candidate**:

1. **Connection or data becomes stale:** stop new entries. Treat displayed prices, positions, orders and protection as last-known until the exact account has been freshly reconciled. Do not interpret a missing record as a flat position.
2. **An order outcome is unknown:** do not press Submit again or use another channel to repeat it. Preserve its command identity and check the exact account's broker order and execution records before a reviewed reconciliation. An order marked pending cancellation is not confirmed cancelled; [IBKR's order-status documentation](https://interactivebrokers.github.io/tws-api/interfaceIBApi_1_1EWrapper.html) distinguishes those states.
3. **A position may be unprotected:** stop new entries, verify the exact account's position and working protection directly in TWS, and use the documented owned-campaign recovery process. Do not cancel a broker-held stop merely because Brontide is disconnected.
4. **A record or fee is missing:** keep its result marked unknown. Reconcile the ledger with authoritative executions and fee reports; do not enter a guessed zero or create a second trade to make totals appear complete.
5. **Recorded Journal history is unavailable after an account-reference error:** preserve the private profile, owner paper-account reference, exact account binding and trade ledger together. Do not create a replacement reference from a mask or move the ledger to another profile. A reviewer must establish the exact owner account and restore or reconcile the original private scope before the history is shown again. The ledger remains preserved; an unavailable view says nothing about current exposure.
   A newer source-only binding format ties the saved choice to the exact original reference digest. An older unlinked schema-1 binding or a different reference with the same visible mask stays unavailable; do not delete either file to force a fresh setup. The draft automated snapshot helper also refuses an unlinked binding, so a reviewer must arrange a protected, consistent offline copy before any migration attempt. A separately reviewed, authenticated migration must prove exact account identity and preserve any owned orders, positions and ledger before changing that state. No such migration is implemented in the installed sample.
6. **The service must be stopped or updated:** first establish whether owned positions, working orders, unresolved transmissions or application-managed rules exist. A browser lock and an operational pause are different actions. Preserve broker-held protection and use the separately reviewed shutdown/update procedure; never force an update over active management.

The [operator checklist](OPERATOR_ACTIONS.md) holds the required account, Windows storage, backup and broker checks. The [paper acceptance matrix](IBKR_PAPER_ACCEPTANCE_QC.md) holds scenario evidence and stop conditions. Neither document authorizes a blocked submission or live trade.

## What to keep for support

- Candidate version or preview identifier, exact time and a description of the action you took.
- The wording of an error and whether it came from the browser, launcher, installer or TWS.
- Whether the app showed **sample**, **last-known**, **unknown** or **freshly reconciled** information.
- For a future broker-enabled case, privately retain the exact account/environment and owned order identities for an authorized reviewer. Redact them from public issues and screenshots.

Do not post cookies, one-use launch links, passwords, API keys, raw broker callbacks, private databases or unredacted account statements. A read-only `--diagnostics` command is drafted in the **unpackaged source**. It prints fixed labels for profile and asset validity without private paths or values; the installed candidate does **not** have this command yet. Review any future report before sharing it.
