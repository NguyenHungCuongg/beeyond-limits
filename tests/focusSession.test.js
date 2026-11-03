import test from "node:test";
import assert from "node:assert/strict";

import {
  FOCUS_STATES,
  FOCUS_PHASES,
  FOCUS_BOUNDS,
  DEFAULT_FOCUS_SETTINGS,
  DEFAULT_TEMPLATES,
  AMBIENT_SOUND_IDS,
  normalizeFocusConfig,
  createFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  calculateRemainingSeconds,
  getFocusBadge,
  calculateProgressPercentage,
  isSessionExpired,
  completeFocusSession,
  abandonFocusSession,
  startBreakSession,
  startNextFocusCycle,
  aggregateDailyProgress,
  calculateStreakDays,
  pruneHistoryRecords,
  isDuplicateCompletion,
} from "../src/core/focusSession.js";

// ==========================================
// Suite 1: Enums & Default Configurations
// ==========================================

test("FOCUS_STATES contains all 8 required states and is frozen", () => {
  assert.equal(Object.isFrozen(FOCUS_STATES), true);
  assert.equal(FOCUS_STATES.IDLE, "idle");
  assert.equal(FOCUS_STATES.ACTIVE_FOCUS, "active_focus");
  assert.equal(FOCUS_STATES.PAUSED_FOCUS, "paused_focus");
  assert.equal(FOCUS_STATES.FOCUS_COMPLETED, "focus_completed");
  assert.equal(FOCUS_STATES.ACTIVE_BREAK, "active_break");
  assert.equal(FOCUS_STATES.PAUSED_BREAK, "paused_break");
  assert.equal(FOCUS_STATES.BREAK_COMPLETED, "break_completed");
  assert.equal(FOCUS_STATES.ABANDONED, "abandoned");
});

test("FOCUS_PHASES contains focus and break, and is frozen", () => {
  assert.equal(Object.isFrozen(FOCUS_PHASES), true);
  assert.equal(FOCUS_PHASES.FOCUS, "focus");
  assert.equal(FOCUS_PHASES.BREAK, "break");
});

test("ambient sound IDs match the files exposed by the extension", () => {
  assert.deepEqual(AMBIENT_SOUND_IDS, [
    "bird",
    "campfire",
    "ocean_waves",
    "rain",
    "thunder",
    "wind",
  ]);
});

test("FOCUS_BOUNDS has accurate constraints and is frozen", () => {
  assert.equal(Object.isFrozen(FOCUS_BOUNDS), true);
  assert.equal(FOCUS_BOUNDS.MIN_FOCUS_MINUTES, 5);
  assert.equal(FOCUS_BOUNDS.MAX_FOCUS_MINUTES, 120);
  assert.equal(FOCUS_BOUNDS.DEFAULT_FOCUS_MINUTES, 25);
  assert.equal(FOCUS_BOUNDS.MIN_BREAK_MINUTES, 1);
  assert.equal(FOCUS_BOUNDS.MAX_BREAK_MINUTES, 30);
  assert.equal(FOCUS_BOUNDS.DEFAULT_BREAK_MINUTES, 5);
  assert.equal(FOCUS_BOUNDS.MAX_GOAL_LENGTH, 120);
  assert.equal(FOCUS_BOUNDS.MAX_TEMPLATE_NAME_LENGTH, 40);
  assert.equal(FOCUS_BOUNDS.MAX_HISTORY_DAYS, 90);
  assert.equal(FOCUS_BOUNDS.MAX_HISTORY_RECORDS, 500);
});

test("DEFAULT_FOCUS_SETTINGS has standard defaults", () => {
  assert.equal(DEFAULT_FOCUS_SETTINGS.focusDuration, 25);
  assert.equal(DEFAULT_FOCUS_SETTINGS.breakDuration, 5);
  assert.equal(DEFAULT_FOCUS_SETTINGS.blockerEnabled, true);
  assert.equal(DEFAULT_FOCUS_SETTINGS.ambientSound.enabled, false);
  assert.equal(DEFAULT_FOCUS_SETTINGS.ambientSound.soundId, null);
  assert.equal(DEFAULT_FOCUS_SETTINGS.ambientSound.volume, 50);
});

test("DEFAULT_TEMPLATES starts empty and is frozen", () => {
  assert.deepEqual(DEFAULT_TEMPLATES, []);
  assert.equal(Object.isFrozen(DEFAULT_TEMPLATES), true);
});

// ==========================================
// Suite 2: Configuration Normalization
// ==========================================

test("normalizeFocusConfig preserves valid custom values", () => {
  const input = {
    focusDuration: 50,
    breakDuration: 10,
    goal: { text: "  Build Feature X  ", taskId: 101 },
    blocker: { enabled: true, presetId: "strict" },
    ambientSound: { enabled: true, soundId: "rain", volume: 75 },
  };
  const normalized = normalizeFocusConfig(input);

  assert.equal(normalized.focusDuration, 50);
  assert.equal(normalized.breakDuration, 10);
  assert.equal(normalized.goal.text, "Build Feature X");
  assert.equal(normalized.goal.taskId, 101);
  assert.equal(normalized.goal.type, "task");
  assert.equal(normalized.blocker.enabled, true);
  assert.equal(normalized.blocker.presetId, "strict");
  assert.equal(normalized.ambientSound.enabled, true);
  assert.equal(normalized.ambientSound.soundId, "rain");
  assert.equal(normalized.ambientSound.volume, 75);
});

test("normalizeFocusConfig preserves a multi-sound ambient mix", () => {
  const normalized = normalizeFocusConfig({
    ambientSound: {
      enabled: true,
      sounds: {
        rain: { enabled: true, volume: 70 },
        thunder: { enabled: true, volume: 20 },
        wind: { enabled: false, volume: 999 },
      },
    },
  });

  assert.equal(normalized.ambientSound.enabled, true);
  assert.deepEqual(normalized.ambientSound.sounds.rain, {
    enabled: true,
    volume: 70,
  });
  assert.deepEqual(normalized.ambientSound.sounds.thunder, {
    enabled: true,
    volume: 20,
  });
  assert.equal(normalized.ambientSound.sounds.wind.volume, 100);
});


test("normalizeFocusConfig keeps a configured mix when ambient audio is toggled off", () => {
  const normalized = normalizeFocusConfig({
    ambientSound: {
      enabled: false,
      sounds: {
        rain: { enabled: true, volume: 70 },
        thunder: { enabled: true, volume: 20 },
      },
    },
  });

  assert.equal(normalized.ambientSound.enabled, false);
  assert.equal(normalized.ambientSound.sounds.rain.enabled, true);
  assert.equal(normalized.ambientSound.sounds.thunder.enabled, true);
});
test("normalizeFocusConfig clamps out-of-bounds durations", () => {
  assert.equal(normalizeFocusConfig({ focusDuration: 2 }).focusDuration, 5);
  assert.equal(normalizeFocusConfig({ focusDuration: 200 }).focusDuration, 120);
  assert.equal(
    normalizeFocusConfig({ focusDuration: "invalid" }).focusDuration,
    25,
  );

  assert.equal(normalizeFocusConfig({ breakDuration: 0 }).breakDuration, 1);
  assert.equal(normalizeFocusConfig({ breakDuration: 60 }).breakDuration, 30);
  assert.equal(normalizeFocusConfig({ breakDuration: null }).breakDuration, 5);
});

test("normalizeFocusConfig truncates long goal text and categorizes type", () => {
  const longText = "A".repeat(150);
  const normalizedTextOnly = normalizeFocusConfig({ goal: { text: longText } });
  assert.equal(normalizedTextOnly.goal.text.length, 120);
  assert.equal(normalizedTextOnly.goal.type, "text");

  const normalizedTask = normalizeFocusConfig({
    goal: { text: "Task Goal", taskId: "task_12" },
  });
  assert.equal(normalizedTask.goal.type, "task");
  assert.equal(normalizedTask.goal.taskId, "task_12");
});

test("normalizeFocusConfig clamps ambient sound volume and handles missing soundId", () => {
  const quiet = normalizeFocusConfig({
    ambientSound: { enabled: true, soundId: "rain", volume: -20 },
  });
  assert.equal(quiet.ambientSound.volume, 0);

  const loud = normalizeFocusConfig({
    ambientSound: { enabled: true, soundId: "rain", volume: 150 },
  });
  assert.equal(loud.ambientSound.volume, 100);

  const noSoundId = normalizeFocusConfig({
    ambientSound: { enabled: true, soundId: null },
  });
  assert.equal(noSoundId.ambientSound.enabled, false);
  assert.equal(noSoundId.ambientSound.soundId, null);
});

test("normalizeFocusConfig disables unsupported ambient sound IDs", () => {
  const normalized = normalizeFocusConfig({
    ambientSound: { enabled: true, soundId: "coffee" },
  });

  assert.equal(normalized.ambientSound.enabled, false);
  assert.equal(normalized.ambientSound.soundId, null);
  assert.equal(normalized.ambientSound.volume, 50);
  assert.equal(
    Object.values(normalized.ambientSound.sounds).every((sound) => !sound.enabled),
    true,
  );
});

// ==========================================
// Suite 3: Session Creation
// ==========================================

test("createFocusSession produces initial active session", () => {
  const now = 1722081000000;
  const config = { focusDuration: 25, goal: { text: "Write tests" } };
  const session = createFocusSession(config, now);

  assert.match(session.id, /^session_1722081000000_/);
  assert.equal(session.schemaVersion, 1);
  assert.equal(session.phase, FOCUS_PHASES.FOCUS);
  assert.equal(session.status, FOCUS_STATES.ACTIVE_FOCUS);
  assert.equal(session.startedAt, now);
  assert.equal(session.phaseStartedAt, now);
  assert.equal(session.durationSeconds, 1500);
  assert.equal(session.remainingSeconds, 1500);
  assert.equal(session.phaseEndsAt, now + 1500 * 1000);
  assert.equal(session.completedAt, null);
  assert.equal(session.abandonedAt, null);
  assert.equal(session.abandonReason, null);
});

test("createFocusSession creates immutable snapshot", () => {
  const config = { focusDuration: 30, goal: { text: "Initial" } };
  const session = createFocusSession(config);

  config.focusDuration = 99;
  config.goal.text = "Mutated";

  assert.equal(session.snapshot.focusDuration, 30);
  assert.equal(session.snapshot.goal.text, "Initial");
});

// ==========================================
// Suite 4: State Machine Transitions (Pause & Resume)
// ==========================================

test("pauseFocusSession pauses active focus session", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 25 }, now);
  // phaseEndsAt is 1000000 + 1500000 = 2500000

  const pauseTime = 1500000; // 500s elapsed, 1000s remaining
  const paused = pauseFocusSession(session, pauseTime);

  assert.equal(paused.status, FOCUS_STATES.PAUSED_FOCUS);
  assert.equal(paused.phaseEndsAt, null);
  assert.equal(paused.remainingSeconds, 1000);
});

test("resumeFocusSession resumes paused focus session", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 25 }, now);
  const paused = pauseFocusSession(session, 1500000); // 1000s remaining

  const resumeTime = 3000000;
  const resumed = resumeFocusSession(paused, resumeTime);

  assert.equal(resumed.status, FOCUS_STATES.ACTIVE_FOCUS);
  assert.equal(resumed.remainingSeconds, 1000);
  assert.equal(resumed.phaseEndsAt, resumeTime + 1000 * 1000);
});

test("pause and resume work correctly for break sessions", () => {
  const now = 1000000;
  const completed = completeFocusSession(
    createFocusSession({}, now),
    now + 1500000,
  );
  const breakSession = startBreakSession(completed, 5, now + 1500000); // 300s break

  const pausedBreak = pauseFocusSession(breakSession, now + 1600000); // 100s elapsed, 200s remaining
  assert.equal(pausedBreak.status, FOCUS_STATES.PAUSED_BREAK);
  assert.equal(pausedBreak.phaseEndsAt, null);
  assert.equal(pausedBreak.remainingSeconds, 200);

  const resumedBreak = resumeFocusSession(pausedBreak, now + 2000000);
  assert.equal(resumedBreak.status, FOCUS_STATES.ACTIVE_BREAK);
  assert.equal(resumedBreak.phaseEndsAt, now + 2000000 + 200000);
});

test("pauseFocusSession and resumeFocusSession ignore invalid state transitions", () => {
  const idleSession = { status: FOCUS_STATES.IDLE };
  assert.deepEqual(pauseFocusSession(idleSession), idleSession);
  assert.deepEqual(resumeFocusSession(idleSession), idleSession);

  const completedSession = { status: FOCUS_STATES.FOCUS_COMPLETED };
  assert.deepEqual(pauseFocusSession(completedSession), completedSession);

  const activeSession = createFocusSession();
  assert.deepEqual(resumeFocusSession(activeSession), activeSession);
});

// ==========================================
// Suite 5: Calculation Helpers
// ==========================================

test("calculateRemainingSeconds returns accurate countdown", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 10 }, now); // 600s
  // phaseEndsAt = 1600000

  assert.equal(calculateRemainingSeconds(session, 1000000), 600);
  assert.equal(calculateRemainingSeconds(session, 1300000), 300);
  assert.equal(calculateRemainingSeconds(session, 1599500), 1); // Math.ceil(0.5)
  assert.equal(calculateRemainingSeconds(session, 1600000), 0);
  assert.equal(calculateRemainingSeconds(session, 1700000), 0); // No negative values

  const paused = pauseFocusSession(session, 1300000); // remaining 300s
  assert.equal(calculateRemainingSeconds(paused, 9999999), 300); // invariant to current time

  assert.equal(calculateRemainingSeconds(null), 0);
});

test("calculateProgressPercentage computes bounds and progress", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 10 }, now); // 600s

  assert.equal(calculateProgressPercentage(session, 1000000), 0);
  assert.equal(calculateProgressPercentage(session, 1300000), 50); // 300s / 600s = 50%
  assert.equal(calculateProgressPercentage(session, 1600000), 100);

  const completed = completeFocusSession(session, 1600000);
  assert.equal(calculateProgressPercentage(completed), 100);

  const abandoned = abandonFocusSession(session, "test", 1300000);
  assert.equal(calculateProgressPercentage(abandoned), 100);

  assert.equal(calculateProgressPercentage(null), 0);
});

test("isSessionExpired detects phase expiry accurately", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 10 }, now); // 600s, ends at 1600000

  assert.equal(isSessionExpired(session, 1599999), false);
  assert.equal(isSessionExpired(session, 1600000), true);
  assert.equal(isSessionExpired(session, 1600001), true);

  const paused = pauseFocusSession(session, 1300000);
  assert.equal(isSessionExpired(paused, 2000000), false);
});

// ==========================================
// Suite 6: Focus Completion & Idempotency
// ==========================================

test("completeFocusSession completes focus phase", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 25 }, now);

  const completedTime = 2500000;
  const completed = completeFocusSession(session, completedTime);

  assert.equal(completed.status, FOCUS_STATES.FOCUS_COMPLETED);
  assert.equal(completed.completedAt, completedTime);
  assert.equal(completed.phaseEndsAt, null);
  assert.equal(completed.remainingSeconds, 0);
});

test("completeFocusSession is idempotent", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 25 }, now);
  const completedFirst = completeFocusSession(session, 2500000);

  // Call complete standard second time with different timestamp
  const completedSecond = completeFocusSession(completedFirst, 9999999);

  assert.equal(completedSecond.completedAt, 2500000); // Unchanged
  assert.deepEqual(completedSecond, completedFirst);
});

// ==========================================
// Suite 7: Break Session Flow
// ==========================================

test("startBreakSession starts active break from focus completed", () => {
  const now = 1000000;
  const session = createFocusSession(
    { focusDuration: 25, breakDuration: 5 },
    now,
  );
  const completed = completeFocusSession(session, 2500000);

  const breakStartTime = 2505000;
  const breakSession = startBreakSession(completed, null, breakStartTime);

  assert.equal(breakSession.phase, FOCUS_PHASES.BREAK);
  assert.equal(breakSession.status, FOCUS_STATES.ACTIVE_BREAK);
  assert.equal(breakSession.durationSeconds, 300);
  assert.equal(breakSession.remainingSeconds, 300);
  assert.equal(breakSession.phaseStartedAt, breakStartTime);
  assert.equal(breakSession.phaseEndsAt, breakStartTime + 300 * 1000);
});

test("startBreakSession allows custom break duration override and clamps it", () => {
  const completed = completeFocusSession(createFocusSession({}));
  const customBreak = startBreakSession(completed, 15);
  assert.equal(customBreak.durationSeconds, 900);

  const clampedBreak = startBreakSession(completed, 99);
  assert.equal(clampedBreak.durationSeconds, 1800); // MAX_BREAK_MINUTES is 30
});

test("startBreakSession ignores invalid base session state", () => {
  const activeFocus = createFocusSession();
  assert.deepEqual(startBreakSession(activeFocus), activeFocus);
});

test("startNextFocusCycle reuses the snapshot after a completed break", () => {
  const initial = createFocusSession(
    {
      focusDuration: 50,
      breakDuration: 10,
      blocker: { enabled: true, blockedUrls: ["youtube.com"] },
      ambientSound: { enabled: true, soundId: "rain", volume: 65 },
    },
    1000000,
  );
  const completedFocus = completeFocusSession(initial, 4000000);
  const activeBreak = startBreakSession(completedFocus, null, 4000000);
  const completedBreak = completeFocusSession(activeBreak, 4600000);

  const nextFocus = startNextFocusCycle(completedBreak, 5000000);

  assert.equal(nextFocus.id, initial.id);
  assert.equal(nextFocus.cycleNumber, 2);
  assert.equal(nextFocus.phase, FOCUS_PHASES.FOCUS);
  assert.equal(nextFocus.status, FOCUS_STATES.ACTIVE_FOCUS);
  assert.equal(nextFocus.durationSeconds, 3000);
  assert.equal(nextFocus.remainingSeconds, 3000);
  assert.equal(nextFocus.phaseStartedAt, 5000000);
  assert.equal(nextFocus.phaseEndsAt, 8000000);
  assert.equal(nextFocus.completedAt, null);
  assert.deepEqual(nextFocus.snapshot, initial.snapshot);
});

test("startNextFocusCycle ignores sessions whose break is not completed", () => {
  const activeFocus = createFocusSession({}, 1000000);
  const completedFocus = completeFocusSession(activeFocus, 2500000);
  const activeBreak = startBreakSession(completedFocus, null, 2500000);

  assert.deepEqual(startNextFocusCycle(activeFocus, 3000000), activeFocus);
  assert.deepEqual(
    startNextFocusCycle(completedFocus, 3000000),
    completedFocus,
  );
  assert.deepEqual(startNextFocusCycle(activeBreak, 3000000), activeBreak);
});

// ==========================================
// Suite 8: Abandonment Flow
// ==========================================

test("abandonFocusSession marks active session as abandoned", () => {
  const now = 1000000;
  const session = createFocusSession({ focusDuration: 25 }, now);

  const abandonTime = 1200000;
  const abandoned = abandonFocusSession(session, "distracted", abandonTime);

  assert.equal(abandoned.status, FOCUS_STATES.ABANDONED);
  assert.equal(abandoned.abandonedAt, abandonTime);
  assert.equal(abandoned.abandonReason, "distracted");
  assert.equal(abandoned.phaseEndsAt, null);
});

test("abandonFocusSession cannot abandon already completed session", () => {
  const completed = completeFocusSession(createFocusSession());
  assert.deepEqual(abandonFocusSession(completed, "too late"), completed);
});

// ==========================================
// Suite 9: Daily Progress Aggregation & Streak Calculation
// ==========================================

test("aggregateDailyProgress calculates totals for specified date", () => {
  const history = [
    {
      id: "h1",
      dateStr: "2026-07-27",
      status: FOCUS_STATES.FOCUS_COMPLETED,
      focusDurationMinutes: 25,
    },
    {
      id: "h2",
      dateStr: "2026-07-27",
      status: FOCUS_STATES.FOCUS_COMPLETED,
      focusDurationMinutes: 50,
    },
    {
      id: "h3",
      dateStr: "2026-07-27",
      status: FOCUS_STATES.ABANDONED,
      focusDurationMinutes: 25,
    },
    {
      id: "h4",
      dateStr: "2026-07-27",
      status: FOCUS_STATES.BREAK_COMPLETED,
      focusDurationMinutes: 5,
    },
    {
      id: "h5",
      dateStr: "2026-07-26",
      status: FOCUS_STATES.FOCUS_COMPLETED,
      focusDurationMinutes: 25,
    },
  ];

  const result = aggregateDailyProgress(history, "2026-07-27");

  assert.equal(result.dateStr, "2026-07-27");
  assert.equal(result.completedSessions, 2);
  assert.equal(result.focusMinutes, 75);
  assert.equal(result.abandonedSessions, 1);
  assert.equal(result.completionRate, 0.67);
});

test("calculateStreakDays computes consecutive daily completion streak", () => {
  const history = [
    { dateStr: "2026-07-27", status: FOCUS_STATES.FOCUS_COMPLETED },
    { dateStr: "2026-07-26", status: FOCUS_STATES.FOCUS_COMPLETED },
    { dateStr: "2026-07-25", status: FOCUS_STATES.FOCUS_COMPLETED },
    { dateStr: "2026-07-23", status: FOCUS_STATES.FOCUS_COMPLETED }, // Gap on 24th
  ];

  assert.equal(calculateStreakDays(history, "2026-07-27"), 3);
  assert.equal(calculateStreakDays(history, "2026-07-23"), 1);
  assert.equal(calculateStreakDays([], "2026-07-27"), 0);
});

// ==========================================
// Suite 10: History Retention & Duplicate Check
// ==========================================

test("pruneHistoryRecords filters old records and truncates limit", () => {
  const now = new Date("2026-07-27T12:00:00Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const history = [];
  // 100 records within 90 days, 20 records older than 90 days
  for (let i = 0; i < 120; i++) {
    history.push({
      id: `h_${i}`,
      startedAt: now - i * dayMs,
      status: FOCUS_STATES.FOCUS_COMPLETED,
    });
  }

  const pruned = pruneHistoryRecords(history, 90, 50, now);
  assert.equal(pruned.length, 50); // truncated to maxRecords = 50
  assert.equal(
    pruned.every((r) => r.startedAt >= now - 90 * dayMs),
    true,
  );
});

test("isDuplicateCompletion identifies existing completed runtime IDs", () => {
  const history = [
    { runtimeId: "session_123", status: FOCUS_STATES.FOCUS_COMPLETED },
    { runtimeId: "session_456", status: FOCUS_STATES.ABANDONED },
  ];

  assert.equal(isDuplicateCompletion(history, "session_123"), true);
  assert.equal(isDuplicateCompletion(history, "session_456"), false);
  assert.equal(isDuplicateCompletion(history, "session_789"), false);
});

// ==========================================
// Suite 11: Iteration 2 Bug Fix Tests
// ==========================================

test("Iteration 2: calculateStreakDays preserves active streak across midnight when today has no completed sessions", () => {
  const history = [
    { dateStr: "2026-07-26", status: FOCUS_STATES.FOCUS_COMPLETED },
    { dateStr: "2026-07-25", status: FOCUS_STATES.FOCUS_COMPLETED },
    { dateStr: "2026-07-23", status: FOCUS_STATES.FOCUS_COMPLETED },
  ];

  // Today is 2026-07-27, which has no completed session. Yesterday (2026-07-26) has completed sessions.
  assert.equal(calculateStreakDays(history, "2026-07-27"), 2);
});

test("Iteration 2: pruneHistoryRecords extracts timestamps from completedAt and abandonedAt", () => {
  const now = new Date("2026-07-27T12:00:00Z").getTime();
  const history = [
    { id: "h1", completedAt: now - 1000, status: FOCUS_STATES.FOCUS_COMPLETED },
    { id: "h2", abandonedAt: now - 5000, status: FOCUS_STATES.ABANDONED },
    {
      id: "h3",
      completedAt: now - 1000 * 24 * 60 * 60 * 100,
      status: FOCUS_STATES.FOCUS_COMPLETED,
    }, // 100 days old
  ];

  const pruned = pruneHistoryRecords(history, 90, 50, now);
  assert.equal(pruned.length, 2);
  assert.equal(pruned[0].id, "h1");
  assert.equal(pruned[1].id, "h2");
});

test("Iteration 2: completeFocusSession guards against transitioning ABANDONED session", () => {
  const abandonedSession = {
    id: "session_abandoned",
    status: FOCUS_STATES.ABANDONED,
    phase: FOCUS_PHASES.FOCUS,
    abandonedAt: 1000000,
    abandonReason: "user_stopped",
    completedAt: null,
  };

  const result = completeFocusSession(abandonedSession, 2000000);
  assert.equal(result.status, FOCUS_STATES.ABANDONED);
  assert.equal(result.completedAt, null);
  assert.deepEqual(result, abandonedSession);
});

test("Iteration 2: aggregateDailyProgress and calculateStreakDays use local date string formatting by default", () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const localTodayStr = `${year}-${month}-${day}`;

  const history = [
    {
      dateStr: localTodayStr,
      status: FOCUS_STATES.FOCUS_COMPLETED,
      focusDurationMinutes: 25,
    },
  ];

  const progress = aggregateDailyProgress(history);
  assert.equal(progress.dateStr, localTodayStr);
  assert.equal(progress.completedSessions, 1);

  const streak = calculateStreakDays(history);
  assert.equal(streak, 1);
});

test("Iteration 2: normalizeFocusConfig handles and trims string inputs for config.goal", () => {
  const config = { goal: "  Finish writing report  " };
  const normalized = normalizeFocusConfig(config);

  assert.equal(normalized.goal.type, "text");
  assert.equal(normalized.goal.text, "Finish writing report");
  assert.equal(normalized.goal.taskId, null);
});

test("Iteration 2: isDuplicateCompletion checks both r.runtimeId and r.id", () => {
  const history = [
    { id: "session_by_id", status: FOCUS_STATES.FOCUS_COMPLETED },
    {
      runtimeId: "session_by_runtime_id",
      status: FOCUS_STATES.FOCUS_COMPLETED,
    },
  ];

  assert.equal(isDuplicateCompletion(history, "session_by_id"), true);
  assert.equal(isDuplicateCompletion(history, "session_by_runtime_id"), true);
  assert.equal(isDuplicateCompletion(history, "session_unknown"), false);
});

test("getFocusBadge shows minutes left while focusing", () => {
  const now = 1_000_000;
  const session = createFocusSession({ focusDuration: 25 }, now);
  assert.deepEqual(getFocusBadge(session, false, now + 61_000), {
    text: "24m",
    color: "#eeba0b",
    textColor: "#0d0c0c",
  });
});

test("getFocusBadge uses the break color during a break", () => {
  const now = 1_000_000;
  const session = startBreakSession(
    completeFocusSession(createFocusSession({ breakDuration: 5 }, now), now),
    5,
    now,
  );
  assert.equal(getFocusBadge(session, false, now).text, "5m");
  assert.equal(getFocusBadge(session, false, now).color, "#1e3a8a");
});

test("getFocusBadge marks paused sessions and pending alarms", () => {
  const now = 1_000_000;
  const paused = pauseFocusSession(createFocusSession({}, now), now);
  assert.equal(getFocusBadge(paused, false, now).text, "❚❚");
  assert.equal(getFocusBadge(paused, true, now).text, "!");
});

test("getFocusBadge is empty without a running session", () => {
  assert.equal(getFocusBadge(null).text, "");
  const completed = completeFocusSession(createFocusSession({}, 0), 0);
  assert.equal(getFocusBadge(completed).text, "");
});
