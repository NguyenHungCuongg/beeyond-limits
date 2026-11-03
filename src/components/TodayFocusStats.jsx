import React, { useMemo } from "react";
import { aggregateDailyProgress, calculateStreakDays } from "../core/focusSession.js";

function TodayFocusStats({ history = [] }) {
  const stats = useMemo(() => aggregateDailyProgress(history), [history]);
  const streak = useMemo(() => calculateStreakDays(history), [history]);

  return (
    <div className="flex flex-col items-end justify-center">
      <div className="font-mono text-xs font-bold uppercase text-ink">
        {stats.completedSessions} Today
      </div>
      <div className="font-display text-2xl uppercase text-ink leading-none">
        {stats.focusMinutes} Min
      </div>
      {streak > 0 && (
        <div className="mt-1 bg-mustard border-2 border-ink px-1.5 font-mono text-[10px] font-bold uppercase text-ink">
          {streak}-day streak
        </div>
      )}
    </div>
  );
}

export default TodayFocusStats;
