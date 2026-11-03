import React, { useMemo } from "react";
import { aggregateDailyProgress, FOCUS_BOUNDS } from "../core/focusSession.js";
import { calculateStreakWithSummary } from "../core/focusStats.js";

function TodayFocusStats({
  history = [],
  dailySummary = {},
  dailyGoalMinutes = FOCUS_BOUNDS.DEFAULT_DAILY_GOAL_MINUTES,
  onOpenStats,
}) {
  const stats = useMemo(() => aggregateDailyProgress(history), [history]);
  const streak = useMemo(
    () => calculateStreakWithSummary(history, dailySummary),
    [history, dailySummary],
  );
  const goalPercent = Math.min(100, Math.round((stats.focusMinutes / dailyGoalMinutes) * 100));

  return (
    <button
      type="button"
      onClick={onOpenStats}
      aria-label={`Today: ${stats.completedSessions} sessions, ${stats.focusMinutes} of ${dailyGoalMinutes} minute goal. Open stats`}
      className="flex flex-col items-end justify-center text-right p-1 -m-1 hover:bg-paper focus-visible:outline-[3px] focus-visible:outline-ink transition-colors"
    >
      <span className="font-mono text-xs font-bold uppercase text-ink">
        {stats.completedSessions} Today
      </span>
      <span className="font-display text-2xl uppercase text-ink leading-none">
        {stats.focusMinutes}
        <span className="font-mono text-xs font-bold"> / {dailyGoalMinutes} Min</span>
      </span>
      <span className="mt-1 w-24 h-2 border-2 border-ink bg-paper" aria-hidden="true">
        <span className="block h-full bg-emerald" style={{ width: `${goalPercent}%` }} />
      </span>
      {streak > 0 && (
        <span className="mt-1 bg-mustard border-2 border-ink px-1.5 font-mono text-[10px] font-bold uppercase text-ink">
          {streak}-day streak
        </span>
      )}
      <span className="mt-1 font-mono text-[10px] font-bold uppercase underline">
        Stats &gt;
      </span>
    </button>
  );
}

export default TodayFocusStats;
