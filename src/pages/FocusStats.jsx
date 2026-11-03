import { useMemo, useState } from "react";
import { ChevronLeft } from "../components/Icons";
import { FOCUS_BOUNDS } from "../core/focusSession.js";
import {
  abandonReasonLabel,
  buildDailySeries,
  calculateStreakWithSummary,
  summarizeRange,
} from "../core/focusStats.js";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

function formatDay(dateStr, options) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", options);
}

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function StatTile({ label, value }) {
  return (
    <div className="bg-paper brutal-border p-3 text-center">
      <div className="font-display text-3xl leading-none text-ink">{value}</div>
      <div className="font-mono text-[10px] font-bold uppercase mt-1 text-ink/70">{label}</div>
    </div>
  );
}

function BarList({ title, rows, emptyText }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <section className="bg-paper brutal-border brutal-shadow-sm p-4 mb-6">
      <h2 className="font-mono text-xs font-bold uppercase mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="font-mono text-xs text-ink/60 uppercase">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex justify-between font-mono text-xs font-bold uppercase mb-1">
                <span className="truncate pr-2">{row.label}</span>
                <span>{row.display}</span>
              </div>
              <div className="h-3 border-2 border-ink bg-canvas" aria-hidden="true">
                <div className="h-full bg-sapphire" style={{ width: `${(row.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DailyChart({ series, goalMinutes }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const max = Math.max(goalMinutes, ...series.map((day) => day.focusMinutes), 1);
  const shown = series[activeIndex ?? series.length - 1];
  const isWeek = series.length <= 7;
  const labelEvery = isWeek ? 1 : 7;

  return (
    <section className="bg-paper brutal-border brutal-shadow-sm p-4 mb-6">
      <h2 className="font-mono text-xs font-bold uppercase mb-1">Focus minutes per day</h2>
      <p className="font-mono text-xs mb-4 text-ink/80" aria-live="polite">
        {formatDay(shown.dateStr, { weekday: "short", month: "short", day: "numeric" })}
        {" · "}
        <strong>{shown.focusMinutes} min</strong>
        {" · "}
        {shown.completedSessions} sessions
      </p>

      <div className="relative h-32" onMouseLeave={() => setActiveIndex(null)}>
        <div
          className="absolute inset-x-0 border-t-2 border-dashed border-crimson pointer-events-none z-10"
          style={{ bottom: `${(goalMinutes / max) * 100}%` }}
        >
          <span className="absolute right-0 -top-5 bg-paper px-1 font-mono text-[10px] font-bold uppercase">
            Goal {goalMinutes}
          </span>
        </div>
        <div className={`flex items-end h-full border-b-2 border-ink ${isWeek ? "gap-2" : "gap-[2px]"}`}>
          {series.map((day, index) => (
            <button
              key={day.dateStr}
              type="button"
              aria-label={`${formatDay(day.dateStr, { weekday: "long", month: "long", day: "numeric" })}: ${day.focusMinutes} minutes, ${day.completedSessions} sessions`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              className="flex-1 h-full flex items-end focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span
                className={`block w-full ${index === (activeIndex ?? series.length - 1) ? "bg-mustard border-2 border-ink" : "bg-ink"}`}
                style={{
                  height: day.focusMinutes ? `max(3px, ${(day.focusMinutes / max) * 100}%)` : 0,
                }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className={`flex mt-1 ${isWeek ? "gap-2" : "gap-[2px]"}`} aria-hidden="true">
        {series.map((day, index) => (
          <span key={day.dateStr} className="flex-1 font-mono text-[10px] font-bold uppercase text-center overflow-visible whitespace-nowrap">
            {(series.length - 1 - index) % labelEvery === 0
              ? formatDay(day.dateStr, isWeek ? { weekday: "narrow" } : { month: "numeric", day: "numeric" })
              : ""}
          </span>
        ))}
      </div>
    </section>
  );
}

function DailyGoalEditor({ goalMinutes, onSave, isBusy }) {
  const [value, setValue] = useState(String(goalMinutes));
  const parsed = Number(value);
  const isValid =
    Number.isInteger(parsed) &&
    parsed >= FOCUS_BOUNDS.MIN_DAILY_GOAL_MINUTES &&
    parsed <= FOCUS_BOUNDS.MAX_DAILY_GOAL_MINUTES;

  return (
    <form
      className="bg-paper brutal-border brutal-shadow-sm p-4 mb-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid) onSave(parsed);
      }}
    >
      <label htmlFor="daily-goal" className="font-mono text-xs font-bold uppercase block mb-2">
        Daily goal (minutes)
      </label>
      <div className="flex gap-2">
        <input
          id="daily-goal"
          type="number"
          inputMode="numeric"
          min={FOCUS_BOUNDS.MIN_DAILY_GOAL_MINUTES}
          max={FOCUS_BOUNDS.MAX_DAILY_GOAL_MINUTES}
          step={5}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="flex-1 brutal-border bg-canvas px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-ink"
        />
        <button
          type="submit"
          disabled={!isValid || parsed === goalMinutes || isBusy}
          className="bg-emerald text-paper brutal-border px-4 font-mono font-bold uppercase text-xs hover:bg-ink transition-colors disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {!isValid && (
        <p className="font-mono text-[10px] font-bold uppercase text-crimson mt-2">
          Between {FOCUS_BOUNDS.MIN_DAILY_GOAL_MINUTES} and {FOCUS_BOUNDS.MAX_DAILY_GOAL_MINUTES} minutes
        </p>
      )}
    </form>
  );
}

export default function FocusStats({ onNavigate, focusSession }) {
  const [days, setDays] = useState(7);
  const history = focusSession.history;
  const summary = focusSession.dailySummary;
  const goalMinutes =
    focusSession.preferences?.dailyGoalMinutes ?? FOCUS_BOUNDS.DEFAULT_DAILY_GOAL_MINUTES;

  const series = useMemo(() => buildDailySeries(history, summary, days), [history, summary, days]);
  const range = useMemo(() => summarizeRange(history, summary, days), [history, summary, days]);
  const allTime = useMemo(() => summarizeRange(history, summary, null), [history, summary]);
  const streak = useMemo(() => calculateStreakWithSummary(history, summary), [history, summary]);
  const goalDays = series.filter((day) => day.focusMinutes >= goalMinutes).length;

  const templateNames = new Map(focusSession.templates.map((t) => [t.id, t.name]));
  const templateRows = range.templateMinutes.map((row) => ({
    key: row.templateId ?? "quick",
    label: row.templateId ? templateNames.get(row.templateId) ?? "Deleted template" : "Quick session",
    value: row.minutes,
    display: formatMinutes(row.minutes),
  }));
  const reasonRows = range.abandonReasons.map((row) => ({
    key: row.reason,
    label: abandonReasonLabel(row.reason),
    value: row.count,
    display: `${row.count}×`,
  }));

  return (
    <div className="bg-canvas min-h-screen text-ink p-5 pb-20">
      <div className="max-w-md mx-auto">
        <button
          type="button"
          onClick={() => onNavigate("home")}
          className="flex items-center gap-1.5 font-mono font-bold uppercase hover:opacity-70 transition-opacity mb-4"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <h1 className="font-display text-5xl uppercase leading-none mb-5">Stats</h1>

        <div className="flex mb-5" role="group" aria-label="Time range">
          {RANGES.map((option, index) => (
            <button
              key={option.days}
              type="button"
              aria-pressed={days === option.days}
              onClick={() => setDays(option.days)}
              className={`brutal-border font-mono font-bold uppercase text-xs py-2 px-3 ${index === 0 ? "border-r-0" : ""} ${
                days === option.days ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-canvas"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatTile label="Focus time" value={formatMinutes(range.focusMinutes)} />
          <StatTile label="Sessions done" value={range.completedSessions} />
          <StatTile
            label="Completion rate"
            value={range.completedSessions + range.abandonedSessions ? `${Math.round(range.completionRate * 100)}%` : "—"}
          />
          <StatTile label={`Goal met · ${days}d`} value={`${goalDays}/${days}`} />
        </div>

        <DailyChart key={days} series={series} goalMinutes={goalMinutes} />

        <DailyGoalEditor
          key={goalMinutes}
          goalMinutes={goalMinutes}
          isBusy={focusSession.isBusy}
          onSave={(dailyGoalMinutes) =>
            focusSession.updatePreferences({ dailyGoalMinutes }).catch(() => {})
          }
        />

        <BarList title="Minutes by template" rows={templateRows} emptyText="No completed sessions in this range" />
        <BarList title="Why sessions stopped" rows={reasonRows} emptyText="No sessions stopped early" />

        <p className="font-mono text-[10px] font-bold uppercase text-ink/60 text-center">
          All time: {allTime.completedSessions} sessions · {formatMinutes(allTime.focusMinutes)} · {streak}-day streak
        </p>
      </div>
    </div>
  );
}
