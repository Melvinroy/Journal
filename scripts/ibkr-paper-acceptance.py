"""Read-only Brontide paper acceptance preflight and evidence CLI.

This command has no order submission, modification, or cancellation operation.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

from brontide_eod.ibkr_acceptance import (
    AcceptanceEvidenceStore,
    load_acceptance_manifest,
    read_only_preflight,
    select_batch,
    ticket_digest,
)
from brontide_eod.ibkr_tws import PaperSafetyError


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "docs" / "trading" / "IBKR_PAPER_ACCEPTANCE_PACKAGE.json"


def current_source_identity() -> str:
    expression = "import {getPreviewIdentity} from './scripts/preview-identity.mjs'; console.log(getPreviewIdentity().identifier)"
    result = subprocess.run(
        ["node", "--input-type=module", "-e", expression], cwd=ROOT,
        check=False, capture_output=True, text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise PaperSafetyError("The current preview source identity could not be calculated.")
    return result.stdout.strip().splitlines()[-1]


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise PaperSafetyError("The requested local JSON input is unreadable.") from exc


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    subcommands = value.add_subparsers(dest="command", required=True)

    digest = subcommands.add_parser("digest", help="Print the immutable digest for one batch.")
    digest.add_argument("--batch", required=True)

    preflight = subcommands.add_parser("preflight", help="Run current-source and read-only broker checks.")
    preflight.add_argument("--batch", required=True)
    preflight.add_argument("--base-url", default="http://127.0.0.1:8765")
    preflight.add_argument("--approval", type=Path)
    preflight.add_argument("--persist-intents", action="store_true")
    preflight.add_argument("--output", type=Path)

    record = subcommands.add_parser("record", help="Append one timestamped callback/reconciliation event to a private ledger.")
    record.add_argument("--event", type=Path, required=True)
    record.add_argument("--state", type=Path, required=True)

    report = subcommands.add_parser("report", help="Write a masked per-scenario report from a private ledger.")
    report.add_argument("--batch", required=True)
    report.add_argument("--state", type=Path, required=True)
    report.add_argument("--output", type=Path)
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "record":
            event = read_json(args.event)
            AcceptanceEvidenceStore(args.state).append(event)
            print("PASS evidence: one immutable event persisted privately; broker identifiers were not printed.")
            return 0
        manifest = load_acceptance_manifest(args.manifest)
        batch = select_batch(manifest, args.batch)
        if args.command == "digest":
            print(json.dumps({"batchId": args.batch, "ticketDigest": ticket_digest(batch)}, sort_keys=True))
            return 0
        if args.command == "report":
            result = AcceptanceEvidenceStore(args.state).masked_report(args.batch)
            if args.output:
                write_json(args.output, result)
                print(f"PASS report: masked evidence written to {args.output}.")
            else:
                print(json.dumps(result, indent=2, sort_keys=True))
            return 0
        source_identity = current_source_identity()
        approval = read_json(args.approval) if args.approval else None
        result = read_only_preflight(
            manifest, batch, base_url=args.base_url,
            current_source_identity=source_identity, approval=approval,
            persist_intents=args.persist_intents,
        )
        if args.output:
            write_json(args.output, result)
        print(json.dumps(result, indent=2, sort_keys=True))
        statuses = {item["status"] for item in result["tickets"]}
        if "blocked" in statuses:
            return 2
        if "pending-session" in statuses:
            return 3
        return 0
    except PaperSafetyError as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
