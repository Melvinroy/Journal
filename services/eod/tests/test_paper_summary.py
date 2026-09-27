"""Chronological cost basis must not let a later fill rewrite an earlier exit."""

import pytest
from brontide_eod.paper_domain import summarize


def fill(effect, quantity, price, second, *, commission=0):
    return {"effect": effect, "quantity": quantity, "price": price,
            "commission": commission,
            "occurredAt": f"2026-09-24T10:00:{second:02d}Z"}


def campaign(direction, executions):
    return {"ticket": {"direction": direction, "stopPrice":
            98 if direction == "Long" else 102}, "executions": executions}


@pytest.mark.parametrize("direction,first_exit,later_entry,expected_open", [
    ("Long", 102, 110, 110),
    ("Short", 98, 90, 90),
])
def test_later_entry_does_not_reprice_an_earlier_realized_exit(
    direction, first_exit, later_entry, expected_open,
):
    ordered = [fill("entry", 1, 100, 1), fill("exit", 1, first_exit, 2),
               fill("entry", 1, later_entry, 3)]
    for callbacks in (ordered, [ordered[2], ordered[0], ordered[1]]):
        result = summarize(campaign(direction, callbacks))
        assert result["entered"] == 2
        assert result["exited"] == 1
        assert result["openQuantity"] == 1
        assert result["averageEntry"] == expected_open
        assert result["grossRealized"] == 2
        assert result["netRealized"] == 2
        assert result["entryAfterExit"] is True


def test_same_instant_entry_and_exit_cannot_invent_cost_basis():
    executions = [fill("entry", 1, 100, 1), fill("entry", 1, 110, 2),
                  fill("exit", 1, 102, 2)]
    result = summarize(campaign("Long", executions))
    assert result["accountingComplete"] is False
    assert result["openQuantity"] == 1
    assert result["grossRealized"] is None
    assert result["netRealized"] is None
    assert result["averageEntry"] is None


def test_same_instant_entry_and_exit_with_existing_inventory_needs_protection_review():
    executions = [fill("entry", 1, 100, 1), fill("exit", 1, 102, 2),
                  fill("entry", 1, 100, 2)]
    result = summarize(campaign("Long", executions))
    assert result["accountingComplete"] is True
    assert result["grossRealized"] == 2
    assert result["entryAfterExit"] is True


def test_missing_clock_on_interleaved_fills_keeps_accounting_unknown():
    executions = [fill("entry", 1, 100, 1), fill("exit", 1, 102, 2),
                  fill("entry", 1, 110, 3)]
    executions[2]["occurredAt"] = ""
    result = summarize(campaign("Long", executions))
    assert result["accountingComplete"] is False
    assert result["grossRealized"] is None
    assert result["netRealized"] is None
    reordered = [executions[0], executions[2], executions[1]]
    assert summarize(campaign("Long", reordered))["accountingComplete"] is False
