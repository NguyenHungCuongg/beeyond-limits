/**
 * src/core/focusStats.js
 * Pure statistics over Focus Session history plus the rolled-up daily summary.
 * History holds detailed records (90 days / 500 records); older records live only
 * in the daily summary, so every total combines both sources.
 */

import {
  FOCUS_STATES,
  calculateStreakDays,
  getLocalDateString,
  recordDateStr,
  recordFocusMinutes,
} from "./focusSession.js";

export const ABANDON_REASONS = Object.freeze([
  { id: "distracted", label: "Distracted" },
  { id: "urgent", label: "Something urgent" },
  { id: "done_early", label: "Finished early" },
  { id: "tired", label: "Too tired" },
]);

export function abandonReasonLabel(reason) {
  return (
    ABANDON_REASONS.find((item) => item.id === reason)?.label ??
    "No reason given"
  );
}

function rangeStart(days, today) {
  if (!days) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - (days - 1));
  return getLocalDateString(start);
}

export function buildDailySeries(history = [], summary = {}, days = 7, today = new Date()) {
  const series = [];
  const index = new Map();
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  cursor.setDate(cursor.getDate() - (days - 1));

  for (let i = 0; i < days; i += 1) {
    const dateStr = getLocalDateString(cursor);
    const day = summary[dateStr];
    const entry = {
      dateStr,
      completedSessions: day?.completedSessions ?? 0,
      focusMinutes: day?.focusMinutes ?? 0,
    };
    series.push(entry);
    index.set(dateStr, entry);
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const record of history) {
    if (record?.status !== FOCUS_STATES.FOCUS_COMPLETED) continue;
    const entry = index.get(recordDateStr(record));
    if (!entry) continue;
    entry.completedSessions += 1;
    entry.focusMinutes += recordFocusMinutes(record);
  }

  return series;
}

// days = null covers all time. Reasons and template minutes come from detailed history only.
export function summarizeRange(history = [], summary = {}, days = 7, today = new Date()) {
  const start = rangeStart(days, today);
  const inRange = (dateStr) => !start || dateStr >= start;

  let completedSessions = 0;
  let focusMinutes = 0;
  let abandonedSessions = 0;
  const reasons = new Map();
  const templates = new Map();

  for (const [dateStr, day] of Object.entries(summary)) {
    if (!inRange(dateStr)) continue;
    completedSessions += day.completedSessions ?? 0;
    focusMinutes += day.focusMinutes ?? 0;
    abandonedSessions += day.abandonedSessions ?? 0;
  }

  for (const record of history) {
    if (!record || !inRange(recordDateStr(record))) continue;
    if (record.status === FOCUS_STATES.FOCUS_COMPLETED) {
      const minutes = recordFocusMinutes(record);
      completedSessions += 1;
      focusMinutes += minutes;
      const templateId = record.templateId ?? null;
      templates.set(templateId, (templates.get(templateId) ?? 0) + minutes);
    } else if (record.status === FOCUS_STATES.ABANDONED) {
      abandonedSessions += 1;
      const reason = record.abandonReason || "user_stopped";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }

  const attempted = completedSessions + abandonedSessions;
  return {
    completedSessions,
    focusMinutes,
    abandonedSessions,
    completionRate: attempted ? Number((completedSessions / attempted).toFixed(2)) : 0,
    abandonReasons: [...reasons]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    templateMinutes: [...templates]
      .map(([templateId, minutes]) => ({ templateId, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

export function calculateStreakWithSummary(history = [], summary = {}, today = new Date()) {
  const rolledUpDays = Object.entries(summary)
    .filter(([, day]) => day.completedSessions > 0)
    .map(([dateStr]) => ({ status: FOCUS_STATES.FOCUS_COMPLETED, dateStr }));
  return calculateStreakDays([...history, ...rolledUpDays], today);
}
