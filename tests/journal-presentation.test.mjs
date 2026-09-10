import assert from "node:assert/strict";
import test from "node:test";

import {
  journalSemanticClass,
  journalSemanticTone,
} from "../lib/journal-presentation.ts";

test("Journal semantic presentation distinguishes result and availability states", () => {
  assert.equal(journalSemanticTone(125), "positive");
  assert.equal(journalSemanticTone(-25), "negative");
  assert.equal(journalSemanticTone(0), "neutral");
  assert.equal(journalSemanticTone(null), "unavailable");
  assert.equal(journalSemanticTone(40, false), "unavailable");
  assert.equal(journalSemanticClass("unavailable"), "journal-semantic-unavailable");
});
