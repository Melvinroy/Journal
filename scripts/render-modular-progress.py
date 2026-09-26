"""Render the full business checklist as six expandable, color-coded phases.

The Markdown checklist owns the wording and hidden progress markers. Running
this script after changing a marker keeps the HTML view complete and aligned.
"""

from __future__ import annotations

import argparse
import html
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/trading/MODULAR_PROGRESS_CHECKLIST.md"
TARGET = ROOT / "docs/trading/MODULAR_PROGRESS_CHECKLIST.html"
AUDIT = ROOT / "docs/trading/MODULAR_PROGRESS_AUDIT_DATA.json"
DISPLAY = ROOT / "docs/trading/MODULAR_PROGRESS_DISPLAY.json"
PHASE = re.compile(r"^## Phase ([1-6]) — (.+?) ([✅❌])$")
ROW = re.compile(r"^\| \*\*([1-6])\. (.+?)\*\* \| (.+?) \| (.+?) \|$")
ITEM = re.compile(r"^- ([✅❌]) (.+)$")
GROUP = re.compile(r"^### (.+)$")
MARKER = re.compile(r"\s*<!-- progress:(current|recent-[1-5]) -->$")
CURRENT_SUMMARY = re.compile(r"\*\*Blocked now: Phase ([1-6]), task ([1-6])\.(\d+) —")


def inline(value: str) -> str:
    """Render only the inline emphasis used by this controlled checklist."""
    safe = html.escape(value)
    safe = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", safe)
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", safe)


def brief(value: str) -> str:
    """Give a highlighted task a readable label without dropping its full text."""
    plain = re.sub(r"\*\*|`", "", value)
    plain = re.sub(r"^(?:Blocked|Working now|Done[^:]*|To (?:do|verify)[^:]*|Product decision|Historical evidence):\s*", "", plain)
    return plain.split(". ", 1)[0].rstrip(".") + "."


def parse(source: str) -> list[dict]:
    phases: list[dict] = []
    goals: dict[int, str] = {}
    markers: dict[str, tuple[int, int, str]] = {}
    current: dict | None = None
    for line in source.splitlines():
        if match := ROW.fullmatch(line):
            goals[int(match[1])] = match[3]
        if match := PHASE.fullmatch(line):
            current = {"number": int(match[1]), "name": match[2],
                       "status": match[3], "items": [], "groups": []}
            phases.append(current)
            continue
        if line.startswith("## "):
            current = None
            continue
        if current is not None and (match := GROUP.fullmatch(line)):
            current["groups"].append({"title": match[1],
                                      "start": len(current["items"]) + 1})
            continue
        if current is None or not (match := ITEM.fullmatch(line)):
            continue
        status, content = match.groups()
        marked = MARKER.search(content)
        marker = marked[1] if marked else None
        if marked:
            content = content[:marked.start()]
            if marker in markers:
                raise ValueError(f"Duplicate highlight: {marker}")
            markers[marker] = (current["number"], len(current["items"]) + 1, status)
        current["items"].append({"status": status, "content": content,
                                 "marker": marker})
    if [phase["number"] for phase in phases] != list(range(1, 7)):
        raise ValueError("The checklist must contain phases 1 through 6 in order.")
    if set(goals) != set(range(1, 7)):
        raise ValueError("Each phase needs its plain-English goal in the summary table.")
    expected = {"current", *(f"recent-{number}" for number in range(1, 6))}
    if set(markers) != expected:
        raise ValueError("Mark exactly one current item and five recent completed items.")
    if markers["current"][2] != "❌" or any(
            markers[f"recent-{number}"][2] != "✅" for number in range(1, 6)):
        raise ValueError("Current work must be pending and recent items must be completed.")
    summary = CURRENT_SUMMARY.search(source)
    if summary is None or (int(summary[1]), int(summary[2]), int(summary[3])) != (
            markers["current"][0], markers["current"][0], markers["current"][1]):
        raise ValueError("The plain-English current-task line must match the yellow item.")
    for phase in phases:
        phase["goal"] = goals[phase["number"]]
        starts = [group["start"] for group in phase["groups"]]
        if not starts or starts[0] != 1 or starts != sorted(set(starts)) or (
                starts[-1] > len(phase["items"])):
            raise ValueError(f"Phase {phase['number']} needs nonempty ordered task groups.")
    return phases


OWNER_LABELS = {"Agent": "Codex", "User": "You", "Vendor": "Vendor", "Policy/support": "Policy/support"}


def owner_label(owner: str) -> str:
    if owner not in OWNER_LABELS:
        raise ValueError(f"Unknown task owner: {owner!r}")
    return OWNER_LABELS[owner]


def load_audit(phases: list[dict]) -> dict:
    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    pending = {f"{phase['number']}.{index}" for phase in phases
               for index, item in enumerate(phase["items"], 1) if item["status"] == "❌"}
    if set(audit["pending"]) != pending:
        raise ValueError(f"Audit pending IDs differ: missing={pending - set(audit['pending'])}, extra={set(audit['pending']) - pending}")
    if set(audit["phase_readiness"]) != {str(n) for n in range(1, 7)}:
        raise ValueError("Audit needs readiness for all six phases.")
    required = {"assessment", "evidence", "blocker", "owner", "next_action", "acceptance", "category"}
    completed = {f"{phase['number']}.{index}" for phase in phases
                 for index, item in enumerate(phase["items"], 1) if item["status"] == "✅"}
    overrides = audit.get("completed", {})
    if not isinstance(overrides, dict) or not set(overrides).issubset(completed):
        raise ValueError("Completed evidence must refer only to completed task IDs.")
    for item_id, entry in {**audit["pending"], **overrides}.items():
        if set(entry) != required or any(not entry[field] for field in required):
            raise ValueError(f"Incomplete audit record for {item_id}.")
        owner_label(entry["owner"])
    return audit


def completed_audit(phase: int, index: int, content: str) -> dict:
    if phase == 1 or (phase == 5 and index == 1) or "Done in design review" in content:
        return {"assessment": "Scoped decision or document is recorded; later delivery gates remain open.",
                "evidence": "design", "blocker": "No blocker to this scoped result.",
                "owner": "Agent", "next_action": "Carry this decision into later qualification."}
    if phase == 6 and index == 1:
        return {"assessment": "Two historical round trips were observed; F protection failed and the current app is unqualified.",
                "evidence": "broker verified (historical)", "blocker": "Separate submission policy and fresh acceptance.",
                "owner": "User", "next_action": "Retain history and requalify protection only after authorization."}
    installed = ((phase == 2 and index in {1, 6}) or
                 (phase == 3 and index in {1, 3}))
    source = "source checks" in content or "source tests" in content
    evidence = "installed verified (older sample)" if installed else (
        "source implemented" if source else "automated tests")
    return {"assessment": "Scoped component result is retained; it does not close the installed or broker journey.",
            "evidence": evidence,
            "blocker": "Current-source qualification and pending phase gates.",
            "owner": "Agent", "next_action": "Retain this result and recheck it in the integrated candidate."}


def load_display(phases: list[dict]) -> dict:
    display = json.loads(DISPLAY.read_text(encoding="utf-8"))["tasks"]
    expected = {f"{p['number']}.{i}" for p in phases for i, _ in enumerate(p["items"], 1)}
    if set(display) != expected:
        raise ValueError("Display summaries must cover exactly the original task IDs.")
    for p in phases:
        for i, item in enumerate(p["items"], 1):
            entry = display[f"{p['number']}.{i}"]
            required = {"title", "assessment", "blocker", "next_action"} if item["status"] == "❌" else {"title"}
            valid_keys = set(entry) == required or (item["status"] == "✅" and set(entry) == {"title", "assessment", "blocker", "next_action"})
            if not valid_keys or any(not isinstance(v, str) or not v.strip() for v in entry.values()):
                raise ValueError(f"Invalid display summary for {p['number']}.{i}")
    return display


def compact_feedback(entry: dict) -> dict:
    if entry["evidence"] == "design":
        return {"assessment": "Decision recorded", "blocker": "None for this decision",
                "next_action": "Carry into implementation"}
    if entry["evidence"] == "broker verified (historical)":
        return {"assessment": "Historical only; F protection failed", "blocker": "Policy and fresh acceptance",
                "next_action": "Requalify after authorization"}
    assessment = {"installed verified (older sample)": "Older installed sample checked",
                  "source implemented": "Implemented in source",
                  "automated tests": "Scoped tests passed"}[entry["evidence"]]
    return {"assessment": assessment, "blocker": "Current qualification pending",
            "next_action": "Recheck integrated candidate"}


def audit_html(entry: dict) -> str:
    fields = [("Assessment", entry["assessment"]), ("Evidence level", entry["evidence"]),
              ("Blocker", entry["blocker"]), ("Owner", owner_label(entry["owner"])),
              ("Next action", entry["next_action"])]
    if entry.get("acceptance"):
        fields.append(("Acceptance criteria", entry["acceptance"]))
    return '<dl class="audit">' + ''.join(
        f'<div><dt>{label}</dt><dd>{html.escape(value)}</dd></div>' for label, value in fields
    ) + '</dl>'


def render(phases: list[dict], audit: dict) -> str:
    display = load_display(phases)
    cards = []
    for phase in phases:
        number, items = phase["number"], phase["items"]
        completed = sum(item["status"] == "✅" for item in items)
        remaining = {"Codex": 0, "You": 0, "External": 0}
        for index, item in enumerate(items, 1):
            if item["status"] == "❌":
                owner = owner_label(audit["pending"][f"{number}.{index}"]["owner"])
                remaining[owner if owner in {"Codex", "You"} else "External"] += 1
        count = f'<span class="count-part done">✓ {"Complete · " if completed == len(items) else ""}{completed}/{len(items)}{" complete" if completed != len(items) else ""}</span>'
        if completed != len(items):
            count += (f'<span class="count-part pending">× {remaining["Codex"]} Codex</span>'
                      f'<span class="count-part attention">! {remaining["You"]} You</span>')
            if remaining["External"]:
                count += f'<span class="count-part pending">× {remaining["External"]} External</span>'
        groups = []
        for gi, group in enumerate(phase["groups"], 1):
            end = phase["groups"][gi]["start"] - 1 if gi < len(phase["groups"]) else len(items)
            rows = []
            for index in range(group["start"], end + 1):
                item = items[index-1]
                item_id, anchor = f"{number}.{index}", f"item-{number}-{index}"
                done = item["status"] == "✅"
                feedback = audit.get("completed", {}).get(item_id) or completed_audit(number, index, item["content"]) if done else audit["pending"][item_id]
                summary = compact_feedback(feedback) if done and "assessment" not in display[item_id] else display[item_id]
                owner = owner_label(feedback["owner"])
                your_action = not done and owner == "You"
                status = "Complete" if done else "Pending"
                status_label = "Complete" if done else "Your action" if your_action else "Not complete"
                symbol = "✓" if done else "!" if your_action else "×"
                status_class = "done" if done else "attention" if your_action else "pending"
                waiting = '<span class="waiting-note">Waiting on prerequisites</span>' if your_action else ''
                rows.append(
                    f'<tr class="task-row" id="{anchor}" data-status="{status.lower()}" data-owner="{owner}">'
                    f'<th scope="row" class="task"><div class="task-meta"><a class="task-id" href="#{anchor}">{item_id}</a>'
                    f'<span class="status {status_class}"><span class="status-symbol" aria-hidden="true">{symbol}</span>{status_label}</span></div>'
                    f'<span class="task-title">{html.escape(display[item_id]["title"])}</span></th>'
                    + ''.join(f'<td data-label="{label}">{waiting if label == "Blocker" else ""}{html.escape(value)}</td>' for label, value in (
                        ("Assessment", summary["assessment"]), ("Blocker", summary["blocker"]),
                        ("Owner", owner), ("Next action", summary["next_action"])))
                    + f'<td class="toggle-cell"><button type="button" class="row-toggle" '
                    f'aria-expanded="false" aria-controls="detail-{anchor}" aria-label="Details for task {item_id}">'
                    '<span class="toggle-text">Details</span><span class="toggle-chevron" aria-hidden="true">⌄</span></button></td></tr>'
                    f'<tr class="detail-row" id="detail-{anchor}" hidden><td colspan="6">'
                    f'<div class="detail-content"><section aria-label="Original task {item_id}">'
                    f'<h4>Task {item_id} · Full explanation</h4><p class="original">{inline(item["content"])}</p>'
                    f'</section><section aria-label="Audit feedback for task {item_id}"><h4>Audit feedback</h4>'
                    f'{audit_html(feedback)}</section></div></td></tr>')
            groups.append(f'<tbody id="group-{number}-{gi}"><tr class="group-row"><th colspan="6" scope="colgroup">'
                          f'{html.escape(group["title"])}</th></tr>' + ''.join(rows) + '</tbody>')
        cards.append(
            f'<details class="phase" id="phase-{number}"><summary>'
            f'<span class="phase-number">{number:02d}</span><span class="phase-title"><span>Phase {number}</span>'
            f'{html.escape(phase["name"])}</span><span class="phase-count {"complete" if completed == len(items) else ""}">{count}</span>'
            '<span class="phase-chevron" aria-hidden="true">⌄</span></summary>'
            f'<div class="phase-body"><div class="phase-context"><p>{html.escape(phase["goal"])}</p>'
            f'<p><strong>Readiness:</strong> {html.escape(audit["phase_readiness"][str(number)])}</p></div>'
            f'<table aria-label="Phase {number} tasks"><colgroup><col class="task-col"><col class="assessment-col">'
            '<col class="blocker-col"><col class="owner-col"><col class="action-col"><col class="details-col"></colgroup>'
            '<thead><tr><th scope="col">Task</th><th scope="col">Assessment</th><th scope="col">Blocker</th>'
            '<th scope="col">Owner</th><th scope="col">Next action</th><th scope="col">Details</th></tr></thead>'
            + ''.join(groups) + '</table></div></details>')
    fingerprint = hashlib.sha256(b"\0".join(p.read_bytes() for p in (SOURCE, AUDIT, DISPLAY, Path(__file__)))).hexdigest()
    return TEMPLATE.replace("{{CARDS}}", "\n".join(cards)).replace("{{CHECKED}}", html.escape(audit["checked"])).replace(
        "{{SOURCE}}", html.escape(audit["source"])).replace("{{FINGERPRINT}}", fingerprint)


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="checklist-render-id" content="{{FINGERPRINT}}">
<title>Brontide | Project progress</title>
<style>
:root { color-scheme: light; font-family: "Segoe UI", system-ui, sans-serif; font-size: 100%; color: #23332f; background: #f3f5f2; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 1480px; margin: auto; padding: 40px 32px 32px; }
header { margin-bottom: 28px; }
.eyebrow { display: flex; align-items: center; gap: 8px; font-size: .75rem; font-weight: 700; letter-spacing: .14em; color: #456556; text-transform: uppercase; }
.brand-mark { width: 10px; height: 10px; border-radius: 3px; background: #24664f; }
h1 { font-size: clamp(1.8rem, 3.5vw, 2.6rem); font-weight: 650; letter-spacing: -.04em; margin: 10px 0; }
.header-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 24px; color: #52635c; }
.header-meta p { margin: 0; line-height: 1.5; }
.date { font-size: .875rem; }
.phase { background: #fff; border: 1px solid #d9e1da; border-radius: 12px; margin: 10px 0; }
.phase > summary { list-style: none; display: grid; grid-template-columns: 40px minmax(0,1fr) auto 24px; gap: 16px; align-items: center; cursor: pointer; padding: 18px 22px; border-radius: 12px; }
.phase > summary::-webkit-details-marker { display: none; }
.phase > summary:hover { background: #f8faf7; }
.phase-number { color: #4d6d5d; font-size: 1.125rem; font-variant-numeric: tabular-nums; }
.phase-title { display: flex; align-items: baseline; gap: 14px; font-weight: 650; font-size: 1.0625rem; }
.phase-title > span { font-size: .875rem; font-weight: 400; color: #596b62; white-space: nowrap; }
.phase-count { color: #52645a; font-size: .875rem; font-variant-numeric: tabular-nums; display: flex; flex-wrap: wrap; gap: 5px 12px; align-items: center; }
.count-part { white-space: nowrap; }
.count-part + .count-part { border-left: 1px solid #d9e1da; padding-left: 12px; }
.phase-count.complete { color: #256148; background: #eaf3ec; border-radius: 6px; padding: 5px 9px; }
.phase-chevron { text-align: center; font-size: 1.2rem; transition: transform .15s; }
.phase[open] > summary .phase-chevron { transform: rotate(180deg); }
.phase[open] > summary { border-bottom: 1px solid #dfe6df; border-radius: 12px 12px 0 0; }
.phase-context { padding: 14px 22px; color: #58665e; font-size: .875rem; line-height: 1.5; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 32px; background: #fafbf8; }
.phase-context p { margin: 0; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; text-align: left; font-size: 1rem; line-height: 1.4; }
.task-col { width: 25%; } .assessment-col { width: 19%; } .blocker-col { width: 17%; }
.owner-col { width: 8%; } .action-col { width: 23%; } .details-col { width: 8%; }
thead th { color: #5c6b62; font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; padding: 11px 14px; border-bottom: 1px solid #dfe6df; font-weight: 650; }
thead th:first-child { padding-left: 22px; }
.group-row th { padding: 9px 22px; background: #f4f7f2; color: #4f6355; font-size: .8125rem; font-weight: 600; border-bottom: 1px solid #e3e9e1; }
.task-row > * { padding: 12px 14px; vertical-align: top; border-bottom: 1px solid #e8ece6; overflow-wrap: anywhere; }
.task-row:hover { background: #fbfcfa; }
.task-row .task { padding-left: 22px; font-weight: 500; }
.task-meta { display: flex; gap: 9px; align-items: center; margin-bottom: 4px; font-size: .75rem; }
.task-id { color: #52675b; text-decoration: none; font-variant-numeric: tabular-nums; }
.task-id:hover { text-decoration: underline; }
.status { font-size: .75rem; display: inline-flex; align-items: center; gap: 5px; }
.status-symbol { font-size: 1rem; font-weight: 800; line-height: 1; min-width: .65em; text-align: center; }
.done { color: #337250; } .pending { color: #59635d; } .attention { color: #865a16; }
.waiting-note { display: block; font-size: .75rem; color: #865a16; margin-bottom: 4px; line-height: 1.35; }
.status-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin-top: 16px; }
.status-legend .status { font-size: .875rem; }
.legend-note { margin: 6px 0 0; font-size: .8125rem; color: #596b62; line-height: 1.5; }
.task-title { display: block; }
button { font: inherit; }
.row-toggle { border: 0; background: transparent; padding: 4px 0; color: #24664f; font-size: .875rem; cursor: pointer; display: inline-flex; gap: 5px; align-items: center; min-height: 32px; }
.row-toggle[aria-expanded="true"] .toggle-chevron { transform: rotate(180deg); }
.row-toggle:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid #246bba; outline-offset: 3px; border-radius: 3px; }
.phase > summary:focus-visible { outline-offset: -4px; }
.detail-row > td { padding: 0; }
.detail-content { background: #f6f8f4; border-bottom: 1px solid #dae3d7; padding: 20px 22px 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
h4 { font-size: .875rem; margin: 0 0 10px; font-weight: 650; color: #3e5748; }
.original { margin: 0; line-height: 1.6; }
.audit { margin: 0; font-size: .9375rem; line-height: 1.5; }
.audit > div { display: grid; grid-template-columns: minmax(0,7rem) minmax(0,1fr); gap: 10px; margin-bottom: 8px; overflow-wrap: anywhere; }
.audit dt { font-weight: 600; color: #4a5f50; }
.audit dd { margin: 0; overflow-wrap: anywhere; }
code { overflow-wrap: anywhere; }
.task-row:target { background: #edf4e9; outline: 2px solid #91ab84; outline-offset: -2px; }
tr, tbody { scroll-margin-top: 16px; }
[hidden] { display: none !important; }
footer { color: #667369; margin-top: 22px; font-size: .8125rem; line-height: 1.6; }
footer p { margin: 8px 0; }
footer summary { cursor: pointer; width: fit-content; }
@media (max-width: 75em) {
  .phase > summary { grid-template-columns: 32px minmax(0,1fr) 24px; gap: 7px 14px; }
  .phase-number { grid-row: 1/3; }
  .phase-count { grid-column: 2; justify-self: start; }
  .phase-chevron { grid-column: 3; grid-row: 1/3; }
}
@media (min-width: 52.001em) and (max-width: 75em) {
  main { padding-left: 16px; padding-right: 16px; }
  .task-row > *, thead th { padding-left: 8px; padding-right: 8px; }
  .task-row .task, thead th:first-child { padding-left: 14px; }
  .task-col { width: 24%; } .assessment-col { width: 20%; }
  .blocker-col { width: 16%; } .owner-col { width: 9%; }
  .row-toggle .toggle-chevron { display: none; }
}
@media (max-width: 52em) {
  main { padding: 28px 20px; }
  table, tbody, .task-row, .detail-row, .detail-row > td { display: block; width: 100%; }
  colgroup, thead { display: none; }
  .task-row { display: grid; grid-template-columns: 1fr 1fr; padding: 14px 20px; gap: 12px 24px; border-bottom: 1px solid #e3e9e1; }
  .task-row > * { padding: 0; border: 0; }
  .task-row .task { padding: 0; grid-column: 1/-1; }
  .task-meta { display: inline-flex; margin: 0 10px 0 0; }
  .task-title { display: inline; }
  .task-row td[data-label]::before { content: attr(data-label); display: block; font-size: .75rem; font-weight: 600; color: #667369; margin-bottom: 3px; }
  .group-row { display: block; } .group-row th { display: block; padding: 9px 20px; }
  .toggle-cell { grid-column: 1/-1; }
  .row-toggle { min-height: 36px; }
  .detail-content { gap: 22px; }
}
@media (max-width: 37.5em) {
  main { padding: 24px 12px; }
  header { margin-bottom: 22px; padding: 0 4px; }
  .header-meta { gap: 8px; }
  .phase > summary { grid-template-columns: 28px minmax(0,1fr) 18px; gap: 6px 10px; padding: 14px; }
  .phase-title { display: block; font-size: 1rem; }
  .phase-title > span { display: block; font-size: .75rem; margin-bottom: 3px; }
  .phase-number { grid-row: 1/3; align-self: start; padding-top: 3px; font-size: 1rem; }
  .phase-count { grid-column: 2; font-size: .8125rem; justify-self: start; }
  .phase-chevron { grid-column: 3; grid-row: 1/3; }
  .phase-context { grid-template-columns: 1fr; padding: 14px; gap: 8px; }
  .task-row { padding: 14px; gap: 12px 16px; }
  .task-meta { display: flex; margin: 0 0 5px; }
  .task-title { display: block; }
  .detail-content { grid-template-columns: 1fr; padding: 18px 14px; }
  .audit > div { display: block; margin-bottom: 12px; }
  .audit dt { margin-bottom: 3px; }
  .group-row th { padding: 9px 14px; }
}
@media (max-width: 20em) { .task-row { grid-template-columns: minmax(0,1fr); } }
@media (prefers-reduced-motion: reduce) { .phase-chevron { transition: none; } }
@media print {
  details:not([open]) > .phase-body, .detail-row[hidden] { display: block !important; }
  .row-toggle, .phase-chevron { display: none; }
}
</style>
</head>
<body>
<main>
<header>
<div class="eyebrow"><span class="brand-mark" aria-hidden="true"></span>Brontide / Windows app</div>
<h1>Project progress</h1>
<div class="header-meta"><p>Six phases. Open a phase to explore its tasks.</p><p class="date">Audit checked {{CHECKED}}</p></div>
<div class="status-legend" aria-label="Task status legend">
<span class="status done"><span class="status-symbol" aria-hidden="true">✓</span>Complete</span>
<span class="status pending"><span class="status-symbol" aria-hidden="true">×</span>Not complete</span>
<span class="status attention"><span class="status-symbol" aria-hidden="true">!</span>Your action or review</span>
</div>
<p class="legend-note">! marks your responsibility, including tasks waiting on prerequisites. Check the blocker before taking action. External means vendor or policy/support.</p>
</header>
{{CARDS}}
<footer>
<p>Complete means the stated task scope is done. Installed-app, broker and release readiness are assessed separately.</p>
<details><summary>About this checklist</summary><p>Private progress snapshot. Full explanations and audit feedback are available in each task’s details.</p><p>Audit source: {{SOURCE}}.</p></details>
</footer>
</main>
<script>
(() => {
  function setExpanded(button, expanded) {
    const detail = document.getElementById(button.getAttribute('aria-controls'));
    button.setAttribute('aria-expanded', String(expanded));
    button.querySelector('.toggle-text').textContent = expanded ? 'Close' : 'Details';
    detail.hidden = !expanded;
  }
  document.querySelectorAll('.row-toggle').forEach(button => {
    button.addEventListener('click', () => setExpanded(button, button.getAttribute('aria-expanded') !== 'true'));
  });
  function revealHash() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const phase = target.closest('details.phase');
    if (phase) phase.open = true;
    if (target.matches('.task-row')) setExpanded(target.querySelector('.row-toggle'), true);
    requestAnimationFrame(() => target.scrollIntoView({block: 'start'}));
  }
  window.addEventListener('hashchange', revealHash);
  document.querySelectorAll('.task-id').forEach(link => link.addEventListener('click', () => {
    if (link.hash === location.hash) revealHash();
  }));
  revealHash();
})();
</script>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the HTML needs regeneration")
    arguments = parser.parse_args()
    phases = parse(SOURCE.read_text(encoding="utf-8"))
    rendered = render(phases, load_audit(phases))
    if arguments.check:
        if not TARGET.is_file() or TARGET.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Progress page differs from its source and display summaries.")
        print("Progress page matches all 114 tasks, audit feedback and compact summaries.")
    else:
        TARGET.write_text(rendered, encoding="utf-8")
        print(f"Rendered {TARGET}")


if __name__ == "__main__":
    main()
