import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailySeries,
  summarizeRange,
  calculateStreakWithSummary,
} from "../src/core/focusStats.js";
import { FOCUS_STATES } from "../src/core/focusSession.js";

const TODAY = new Date(2026, 10, 4, 12);
const completed = (dateStr, minutes, extra = {}) => ({
  status: FOCUS_STATES.FOCUS_COMPLETED,
  dateStr,
  focusDurationMinutes: minutes,
  ...extra,
});
const abandoned = (dateStr, reason, extra = {}) => ({
  status: FOCUS_STATES.ABANDONED,
  dateStr,
  abandonReason: reason,
  actualFocusSeconds: 300,
  ...extra,
});

test("buildDailySeries fills every day oldest first and merges both sources", () => {
  const series = buildDailySeries(
    [completed("2026-11-04", 25), completed("2026-11-04", 50), completed("2026-11-02", 25)],
    { "2026-11-02": { completedSessions: 1, focusMinutes: 30, abandonedSessions: 0 } },
    3,
    TODAY,
  );

  assert.deepEqual(series, [
    { dateStr: "2026-11-02", completedSessions: 2, focusMinutes: 55 },
    { dateStr: "2026-11-03", completedSessions: 0, focusMinutes: 0 },
    { dateStr: "2026-11-04", completedSessions: 2, focusMinutes: 75 },
  ]);
});

test("summarizeRange counts only days inside the range", () => {
  const stats = summarizeRange(
    [
      completed("2026-11-04", 25, { templateId: "t1" }),
      completed("2026-11-03", 50, { templateId: "t1" }),
      completed("2026-11-03", 25),
      abandoned("2026-11-04", "distracted"),
      abandoned("2026-11-03", "distracted"),
      abandoned("2026-11-02", "tired"),
      completed("2026-10-01", 25, { templateId: "t2" }),
    ],
    { "2026-11-01": { completedSessions: 2, focusMinutes: 40, abandonedSessions: 1 } },
    4,
    TODAY,
  );

  assert.equal(stats.completedSessions, 5);
  assert.equal(stats.focusMinutes, 140);
  assert.equal(stats.abandonedSessions, 4);
  assert.equal(stats.completionRate, 0.56);
  assert.deepEqual(stats.abandonReasons, [
    { reason: "distracted", count: 2 },
    { reason: "tired", count: 1 },
  ]);
  assert.deepEqual(stats.templateMinutes, [
    { templateId: "t1", minutes: 75 },
    { templateId: null, minutes: 25 },
  ]);
});

test("summarizeRange with no day limit covers all time", () => {
  const stats = summarizeRange(
    [completed("2026-10-01", 25)],
    { "2025-01-01": { completedSessions: 3, focusMinutes: 90, abandonedSessions: 0 } },
    null,
    TODAY,
  );
  assert.equal(stats.completedSessions, 4);
  assert.equal(stats.focusMinutes, 115);
});

test("summarizeRange treats a missing reason as user_stopped", () => {
  const stats = summarizeRange([abandoned("2026-11-04", undefined)], {}, 7, TODAY);
  assert.deepEqual(stats.abandonReasons, [{ reason: "user_stopped", count: 1 }]);
});

test("calculateStreakWithSummary counts days that were already rolled up", () => {
  const streak = calculateStreakWithSummary(
    [completed("2026-11-04", 25)],
    {
      "2026-11-03": { completedSessions: 1, focusMinutes: 25, abandonedSessions: 0 },
      "2026-11-02": { completedSessions: 0, focusMinutes: 0, abandonedSessions: 2 },
    },
    TODAY,
  );
  assert.equal(streak, 2);
});
