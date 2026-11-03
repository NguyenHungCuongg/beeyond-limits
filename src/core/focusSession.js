/**
 * src/core/focusSession.js
 * Pure domain model & state transition engine for Focus Sessions.
 * Contains no side-effects or browser API calls.
 */

import { sanitizeBlockedUrls } from "./blocking.js";

export const FOCUS_STATES = Object.freeze({
  IDLE: "idle",
  ACTIVE_FOCUS: "active_focus",
  PAUSED_FOCUS: "paused_focus",
  FOCUS_COMPLETED: "focus_completed",
  ACTIVE_BREAK: "active_break",
  PAUSED_BREAK: "paused_break",
  BREAK_COMPLETED: "break_completed",
  ABANDONED: "abandoned",
});

export const FOCUS_PHASES = Object.freeze({
  FOCUS: "focus",
  BREAK: "break",
});

export const FOCUS_BOUNDS = Object.freeze({
  MIN_FOCUS_MINUTES: 5,
  MAX_FOCUS_MINUTES: 120,
  DEFAULT_FOCUS_MINUTES: 25,
  MIN_BREAK_MINUTES: 1,
  MAX_BREAK_MINUTES: 30,
  DEFAULT_BREAK_MINUTES: 5,
  MAX_GOAL_LENGTH: 120,
  MAX_TEMPLATE_NAME_LENGTH: 40,
  MAX_HISTORY_DAYS: 90,
  MAX_HISTORY_RECORDS: 500,
});

export const AMBIENT_SOUND_IDS = Object.freeze([
  "bird",
  "campfire",
  "ocean_waves",
  "rain",
  "thunder",
  "wind",
]);

export const DEFAULT_FOCUS_SETTINGS = Object.freeze({
  focusDuration: FOCUS_BOUNDS.DEFAULT_FOCUS_MINUTES,
  breakDuration: FOCUS_BOUNDS.DEFAULT_BREAK_MINUTES,
  blockerEnabled: true,
  blocker: Object.freeze({ enabled: true, blockedUrls: [] }),
  ambientSound: Object.freeze({
    enabled: false,
    soundId: null,
    volume: 50,
    sounds: Object.freeze({}),
  }),
});

export const DEFAULT_TEMPLATES = Object.freeze([]);

function clamp(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function getLocalDateString(dateInput = new Date()) {
  let d;
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, dNum] = dateInput.split("-").map(Number);
    d = new Date(y, m - 1, dNum);
  } else if (dateInput instanceof Date) {
    d = dateInput;
  } else if (
    typeof dateInput === "number" ||
    (typeof dateInput === "string" && dateInput)
  ) {
    d = new Date(dateInput);
  } else {
    d = new Date();
  }
  if (isNaN(d.getTime())) {
    d = new Date();
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeFocusConfig(config = {}) {
  const focusDuration = clamp(
    config.focusDuration,
    FOCUS_BOUNDS.MIN_FOCUS_MINUTES,
    FOCUS_BOUNDS.MAX_FOCUS_MINUTES,
    FOCUS_BOUNDS.DEFAULT_FOCUS_MINUTES,
  );

  const breakDuration = clamp(
    config.breakDuration,
    FOCUS_BOUNDS.MIN_BREAK_MINUTES,
    FOCUS_BOUNDS.MAX_BREAK_MINUTES,
    FOCUS_BOUNDS.DEFAULT_BREAK_MINUTES,
  );

  let rawGoalText = "";
  let taskId = null;

  if (typeof config.goal === "string") {
    rawGoalText = config.goal.trim();
  } else if (config.goal && typeof config.goal === "object") {
    if (typeof config.goal.text === "string") {
      rawGoalText = config.goal.text.trim();
    }
    if (config.goal.taskId !== undefined && config.goal.taskId !== null) {
      taskId = config.goal.taskId;
    }
  }

  const goalText = rawGoalText.slice(0, FOCUS_BOUNDS.MAX_GOAL_LENGTH);
  const goalType = taskId !== null ? "task" : "text";

  const blockerEnabled = Boolean(
    config.blocker?.enabled ?? config.blockerEnabled ?? true,
  );
  const presetId =
    typeof config.blocker?.presetId === "string"
      ? config.blocker.presetId
      : "default";

  const blockedUrls = Array.isArray(config.blocker?.blockedUrls)
    ? sanitizeBlockedUrls(config.blocker.blockedUrls)
    : [];

  const soundEnabled = Boolean(config.ambientSound?.enabled ?? false);
  const legacySoundId =
    typeof config.ambientSound?.soundId === "string"
      ? config.ambientSound.soundId
      : null;
  const validLegacySoundId = AMBIENT_SOUND_IDS.includes(legacySoundId)
    ? legacySoundId
    : null;
  const rawSounds =
    config.ambientSound?.sounds &&
    typeof config.ambientSound.sounds === "object" &&
    !Array.isArray(config.ambientSound.sounds)
      ? config.ambientSound.sounds
      : {};
  const sounds = Object.fromEntries(
    AMBIENT_SOUND_IDS.map((id) => {
      const rawSound = rawSounds[id];
      const usesLegacySound =
        !Object.keys(rawSounds).length && validLegacySoundId === id;
      return [
        id,
        {
          enabled: Boolean(rawSound?.enabled ?? usesLegacySound),
          volume: clamp(
            rawSound?.volume ??
              (usesLegacySound ? config.ambientSound?.volume : 50),
            0,
            100,
            50,
          ),
        },
      ];
    }),
  );
  const primarySoundId =
    AMBIENT_SOUND_IDS.find((id) => sounds[id].enabled) ?? null;
  const volume = primarySoundId ? sounds[primarySoundId].volume : 50;

  return {
    focusDuration,
    breakDuration,
    goal: { type: goalType, text: goalText, taskId },
    blocker: { enabled: blockerEnabled, presetId, blockedUrls },
    ambientSound: {
      enabled: soundEnabled && Boolean(primarySoundId),
      soundId: primarySoundId,
      volume,
      sounds,
    },
  };
}

export function createFocusSession(config = {}, nowTimestamp = Date.now()) {
  const normalized = normalizeFocusConfig(config);
  const durationSeconds = normalized.focusDuration * 60;
  const randomSuffix = Math.random().toString(36).slice(2, 7);
  const runtimeId = `session_${nowTimestamp}_${randomSuffix}`;

  return {
    id: runtimeId,
    schemaVersion: 1,
    templateId: config.templateId || null,
    snapshot: JSON.parse(JSON.stringify(normalized)),
    goal: normalized.goal,
    cycleNumber: 1,
    phase: FOCUS_PHASES.FOCUS,
    status: FOCUS_STATES.ACTIVE_FOCUS,
    startedAt: nowTimestamp,
    phaseStartedAt: nowTimestamp,
    phaseEndsAt: nowTimestamp + durationSeconds * 1000,
    durationSeconds,
    remainingSeconds: durationSeconds,
    completedAt: null,
    abandonedAt: null,
    abandonReason: null,
    preSessionState: config.preSessionState || null,
  };
}

export function calculateRemainingSeconds(session, nowTimestamp = Date.now()) {
  if (!session || typeof session !== "object") return 0;

  if (
    session.status === FOCUS_STATES.PAUSED_FOCUS ||
    session.status === FOCUS_STATES.PAUSED_BREAK
  ) {
    return Math.max(0, Math.ceil(session.remainingSeconds || 0));
  }

  if (
    session.status === FOCUS_STATES.ACTIVE_FOCUS ||
    session.status === FOCUS_STATES.ACTIVE_BREAK
  ) {
    if (!session.phaseEndsAt) return 0;
    const diffMs = session.phaseEndsAt - nowTimestamp;
    return Math.max(0, Math.ceil(diffMs / 1000));
  }

  return 0;
}

export function getFocusBadge(session, hasPendingAlarm = false, nowTimestamp = Date.now()) {
  if (hasPendingAlarm) return { text: "!", color: "#9e1414", textColor: "#ffffff" };

  const minutesLeft = () =>
    `${Math.ceil(calculateRemainingSeconds(session, nowTimestamp) / 60)}m`;

  switch (session?.status) {
    case FOCUS_STATES.ACTIVE_FOCUS:
      return { text: minutesLeft(), color: "#eeba0b", textColor: "#0d0c0c" };
    case FOCUS_STATES.ACTIVE_BREAK:
      return { text: minutesLeft(), color: "#1e3a8a", textColor: "#ffffff" };
    case FOCUS_STATES.PAUSED_FOCUS:
    case FOCUS_STATES.PAUSED_BREAK:
      return { text: "❚❚", color: "#0d0c0c", textColor: "#ffffff" };
    default:
      return { text: "", color: null, textColor: null };
  }
}

export function calculateProgressPercentage(
  session,
  nowTimestamp = Date.now(),
) {
  if (!session || typeof session !== "object") return 0;

  if (
    session.status === FOCUS_STATES.FOCUS_COMPLETED ||
    session.status === FOCUS_STATES.BREAK_COMPLETED
  ) {
    return 100;
  }

  if (session.status === FOCUS_STATES.ABANDONED) {
    return 100;
  }

  const total = session.durationSeconds || 0;
  if (total <= 0) return 0;

  const remaining = calculateRemainingSeconds(session, nowTimestamp);
  const elapsed = total - remaining;
  const pct = (elapsed / total) * 100;

  return Math.min(100, Math.max(0, Number(pct.toFixed(1))));
}

export function isSessionExpired(session, nowTimestamp = Date.now()) {
  if (!session || typeof session !== "object") return false;
  if (
    session.status !== FOCUS_STATES.ACTIVE_FOCUS &&
    session.status !== FOCUS_STATES.ACTIVE_BREAK
  ) {
    return false;
  }
  return session.phaseEndsAt !== null && nowTimestamp >= session.phaseEndsAt;
}

export function pauseFocusSession(session, nowTimestamp = Date.now()) {
  if (!session || typeof session !== "object") return session;
  if (
    session.status !== FOCUS_STATES.ACTIVE_FOCUS &&
    session.status !== FOCUS_STATES.ACTIVE_BREAK
  ) {
    return session;
  }

  const remainingSeconds = calculateRemainingSeconds(session, nowTimestamp);
  const isFocus = session.phase === FOCUS_PHASES.FOCUS;

  return {
    ...session,
    status: isFocus ? FOCUS_STATES.PAUSED_FOCUS : FOCUS_STATES.PAUSED_BREAK,
    phaseEndsAt: null,
    remainingSeconds,
  };
}

export function resumeFocusSession(session, nowTimestamp = Date.now()) {
  if (!session || typeof session !== "object") return session;
  if (
    session.status !== FOCUS_STATES.PAUSED_FOCUS &&
    session.status !== FOCUS_STATES.PAUSED_BREAK
  ) {
    return session;
  }

  const remainingSeconds = Math.max(0, session.remainingSeconds || 0);
  const isFocus = session.phase === FOCUS_PHASES.FOCUS;

  return {
    ...session,
    status: isFocus ? FOCUS_STATES.ACTIVE_FOCUS : FOCUS_STATES.ACTIVE_BREAK,
    phaseEndsAt: nowTimestamp + remainingSeconds * 1000,
  };
}

export function completeFocusSession(session, nowTimestamp = Date.now()) {
  if (!session || typeof session !== "object") return session;

  const validStates = [
    FOCUS_STATES.ACTIVE_FOCUS,
    FOCUS_STATES.PAUSED_FOCUS,
    FOCUS_STATES.ACTIVE_BREAK,
    FOCUS_STATES.PAUSED_BREAK,
  ];

  if (!validStates.includes(session.status)) {
    return session;
  }

  const isFocus = session.phase === FOCUS_PHASES.FOCUS;

  return {
    ...session,
    status: isFocus
      ? FOCUS_STATES.FOCUS_COMPLETED
      : FOCUS_STATES.BREAK_COMPLETED,
    completedAt: isFocus
      ? session.completedAt || nowTimestamp
      : session.completedAt,
    phaseEndsAt: null,
    remainingSeconds: 0,
  };
}

export function abandonFocusSession(
  session,
  reason = "user_stopped",
  nowTimestamp = Date.now(),
) {
  if (!session || typeof session !== "object") return session;

  if (
    session.status === FOCUS_STATES.FOCUS_COMPLETED ||
    session.status === FOCUS_STATES.BREAK_COMPLETED
  ) {
    return session;
  }

  return {
    ...session,
    status: FOCUS_STATES.ABANDONED,
    abandonedAt: nowTimestamp,
    abandonReason: reason || "user_stopped",
    phaseEndsAt: null,
  };
}

export function startBreakSession(
  session,
  durationMinutes = null,
  nowTimestamp = Date.now(),
) {
  if (!session || typeof session !== "object") return session;

  if (
    session.status !== FOCUS_STATES.FOCUS_COMPLETED &&
    session.status !== FOCUS_STATES.BREAK_COMPLETED
  ) {
    return session;
  }

  const breakMins = clamp(
    durationMinutes ?? session.snapshot?.breakDuration,
    FOCUS_BOUNDS.MIN_BREAK_MINUTES,
    FOCUS_BOUNDS.MAX_BREAK_MINUTES,
    FOCUS_BOUNDS.DEFAULT_BREAK_MINUTES,
  );

  const durationSeconds = breakMins * 60;

  return {
    ...session,
    phase: FOCUS_PHASES.BREAK,
    status: FOCUS_STATES.ACTIVE_BREAK,
    durationSeconds,
    remainingSeconds: durationSeconds,
    phaseStartedAt: nowTimestamp,
    phaseEndsAt: nowTimestamp + durationSeconds * 1000,
  };
}

export function startNextFocusCycle(session, nowTimestamp = Date.now()) {
  if (
    !session ||
    typeof session !== "object" ||
    session.status !== FOCUS_STATES.BREAK_COMPLETED
  ) {
    return session;
  }

  const focusMinutes = clamp(
    session.snapshot?.focusDuration,
    FOCUS_BOUNDS.MIN_FOCUS_MINUTES,
    FOCUS_BOUNDS.MAX_FOCUS_MINUTES,
    FOCUS_BOUNDS.DEFAULT_FOCUS_MINUTES,
  );
  const durationSeconds = focusMinutes * 60;

  return {
    ...session,
    cycleNumber: Math.max(1, session.cycleNumber || 1) + 1,
    phase: FOCUS_PHASES.FOCUS,
    status: FOCUS_STATES.ACTIVE_FOCUS,
    durationSeconds,
    remainingSeconds: durationSeconds,
    phaseStartedAt: nowTimestamp,
    phaseEndsAt: nowTimestamp + durationSeconds * 1000,
    completedAt: null,
  };
}

export function aggregateDailyProgress(
  historyRecords = [],
  targetDateStr = null,
) {
  const dateKey = getLocalDateString(targetDateStr);

  const records = Array.isArray(historyRecords) ? historyRecords : [];
  const daysRecords = records.filter((r) => r && r.dateStr === dateKey);

  let completedSessions = 0;
  let focusMinutes = 0;
  let abandonedSessions = 0;

  for (const record of daysRecords) {
    if (record.status === FOCUS_STATES.FOCUS_COMPLETED) {
      completedSessions += 1;
      focusMinutes +=
        record.focusDurationMinutes ||
        Math.round((record.actualFocusSeconds || 0) / 60);
    } else if (record.status === FOCUS_STATES.ABANDONED) {
      abandonedSessions += 1;
    }
  }

  const totalAttempted = completedSessions + abandonedSessions;
  const completionRate =
    totalAttempted > 0
      ? Number((completedSessions / totalAttempted).toFixed(2))
      : 0;

  return {
    dateStr: dateKey,
    completedSessions,
    focusMinutes,
    abandonedSessions,
    completionRate,
  };
}

export function calculateStreakDays(
  historyRecords = [],
  referenceDateStr = null,
) {
  if (!Array.isArray(historyRecords) || historyRecords.length === 0) return 0;

  const datesWithCompletions = new Set(
    historyRecords
      .filter(
        (r) => r && r.status === FOCUS_STATES.FOCUS_COMPLETED && r.dateStr,
      )
      .map((r) => r.dateStr),
  );

  let curr;
  if (
    typeof referenceDateStr === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(referenceDateStr)
  ) {
    const [y, m, d] = referenceDateStr.split("-").map(Number);
    curr = new Date(y, m - 1, d);
  } else if (referenceDateStr instanceof Date) {
    curr = new Date(referenceDateStr.getTime());
  } else if (referenceDateStr) {
    curr = new Date(referenceDateStr);
  } else {
    curr = new Date();
  }
  if (isNaN(curr.getTime())) {
    curr = new Date();
  }

  const todayStr = getLocalDateString(curr);

  if (!datesWithCompletions.has(todayStr)) {
    // If today has no completed sessions, check if yesterday had completed sessions
    curr.setDate(curr.getDate() - 1);
    const yesterdayStr = getLocalDateString(curr);
    if (!datesWithCompletions.has(yesterdayStr)) {
      return 0;
    }
  }

  let streak = 0;
  while (true) {
    const dateStr = getLocalDateString(curr);
    if (datesWithCompletions.has(dateStr)) {
      streak += 1;
      curr.setDate(curr.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export function pruneHistoryRecords(
  historyRecords = [],
  maxDays = 90,
  maxRecords = 500,
  nowTimestamp = Date.now(),
) {
  if (!Array.isArray(historyRecords)) return [];

  const cutoffMs = nowTimestamp - maxDays * 24 * 60 * 60 * 1000;

  const validRecords = historyRecords.filter((r) => {
    if (!r) return false;
    const recordTime =
      r.completedAt || r.abandonedAt || r.endedAt || r.startedAt || 0;
    return recordTime >= cutoffMs;
  });

  validRecords.sort((a, b) => {
    const timeA =
      a.completedAt || a.abandonedAt || a.endedAt || a.startedAt || 0;
    const timeB =
      b.completedAt || b.abandonedAt || b.endedAt || b.startedAt || 0;
    return timeB - timeA;
  });

  return validRecords.slice(0, maxRecords);
}

export function isDuplicateCompletion(historyRecords = [], runtimeId) {
  if (!Array.isArray(historyRecords) || !runtimeId) return false;
  return historyRecords.some(
    (r) =>
      r &&
      (r.runtimeId === runtimeId || r.id === runtimeId) &&
      r.status === FOCUS_STATES.FOCUS_COMPLETED,
  );
}
