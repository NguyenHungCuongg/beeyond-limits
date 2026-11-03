import React from "react";
import DailyQuote from "../components/DailyQuote";
import QuickTools from "../components/QuickTools";
import TodayFocusStats from "../components/TodayFocusStats";
import SavedSessionCard from "../components/SavedSessionCard";
import { Play } from "../components/Icons";

function HomeSkeleton() {
  return (
    <div className="min-h-screen bg-canvas p-5 pb-20 animate-pulse">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div className="space-y-2">
            <div className="h-8 w-32 bg-ink/20 rounded"></div>
            <div className="h-8 w-24 bg-ink/20 rounded"></div>
          </div>
          <div className="space-y-2 flex flex-col items-end">
            <div className="h-4 w-16 bg-ink/20 rounded"></div>
            <div className="h-6 w-20 bg-ink/20 rounded"></div>
          </div>
        </div>
        <div className="h-40 w-full bg-ink/20 brutal-border mb-8"></div>
        <div className="h-24 w-full bg-ink/20 brutal-border mb-3"></div>
        <div className="h-24 w-full bg-ink/20 brutal-border mb-8"></div>
        <div className="grid grid-cols-4 gap-2 mb-8">
          <div className="h-20 bg-ink/20 brutal-border"></div>
          <div className="h-20 bg-ink/20 brutal-border"></div>
          <div className="h-20 bg-ink/20 brutal-border"></div>
          <div className="h-20 bg-ink/20 brutal-border"></div>
        </div>
      </div>
    </div>
  );
}

function Home({ onNavigate, onStartFocus, focusSession }) {
  if (focusSession.isLoading) {
    return <HomeSkeleton />;
  }

  if (focusSession.error) {
    return (
      <div className="min-h-screen bg-canvas p-5 pb-20 flex flex-col items-center justify-center text-center">
        <div className="max-w-xs bg-paper brutal-border brutal-shadow p-5">
          <h2 className="font-display text-2xl uppercase text-crimson mb-2">
            Error Loading
          </h2>
          <p className="font-mono text-xs mb-4 text-ink/80">
            {focusSession.error}
          </p>
          <button
            onClick={() => focusSession.refresh()}
            className="w-full bg-mustard brutal-border font-mono text-xs font-bold uppercase py-2 hover:bg-ink hover:text-mustard transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeSession = focusSession.activeSession;
  const templates = focusSession.templates || [];
  const history = focusSession.history || [];

  return (
    <div className="min-h-screen bg-canvas p-5 pb-20 overflow-auto">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="font-display text-4xl uppercase tracking-wide leading-none text-ink">
              Beeyond
              <br />
              Limits
            </h1>
            <p className="font-mono text-[10px] font-bold mt-1 text-ink/60 uppercase">
              Your focus companion
            </p>
          </div>
          <TodayFocusStats
            history={history}
            dailySummary={focusSession.dailySummary}
            dailyGoalMinutes={focusSession.preferences?.dailyGoalMinutes}
            onOpenStats={() => onNavigate("stats")}
          />
        </div>

        {/* Primary Action Hero */}
        {activeSession ? (
          <div className="w-full mb-8 bg-emerald text-paper brutal-border brutal-shadow p-5 flex flex-col">
            <p className="font-mono text-xs font-bold uppercase mb-3">
              Session in progress
            </p>
            <h2 className="font-display text-3xl uppercase leading-tight mb-5 break-words line-clamp-2">
              {activeSession.goal?.text ||
                (activeSession.phase === "break"
                  ? "Take a break"
                  : "Focused work")}
            </h2>
            <button
              type="button"
              onClick={() => {
                if (activeSession.status.endsWith("_completed")) {
                  onNavigate("focus-complete");
                } else {
                  onNavigate("focus-active");
                }
              }}
              className="w-full bg-paper text-ink brutal-border font-display text-xl uppercase py-3 hover:bg-canvas transition-colors active:translate-y-[2px] active:shadow-none"
            >
              Return to session
            </button>
          </div>
        ) : (
          <div className="w-full mb-8 flex flex-col items-center">
            <div className="w-full bg-canvas text-ink brutal-border brutal-shadow p-6 text-center mb-4 border-2 border-ink">
              <h2 className="font-display text-3xl uppercase mb-2">
                Ready to focus?
              </h2>
              <p className="font-mono text-xs font-bold uppercase text-ink/80">
                Set the space. Do the work.
              </p>
            </div>
            {onStartFocus && (
              <button
                type="button"
                onClick={() => onStartFocus()}
                className="w-full bg-mustard text-ink brutal-border brutal-shadow font-display text-2xl uppercase py-4 flex items-center justify-center gap-3 hover:bg-ink hover:text-mustard transition-colors active:translate-y-[4px] active:shadow-none"
              >
                <Play size={20} /> Start Focus Session
              </button>
            )}
          </div>
        )}

        {/* Saved Sessions */}
        <div className="mb-8">
          <div className="flex justify-between items-end mb-3">
            <span className="font-mono text-xs font-bold uppercase">
              Saved Sessions
            </span>
            <button
              onClick={() => onNavigate("saved-sessions")}
              className="font-mono text-[10px] font-bold uppercase hover:underline"
            >
              Manage &gt;
            </button>
          </div>
          {templates.length > 0 ? (
            <div className="space-y-3">
              {templates.slice(0, 2).map((t) => (
                <SavedSessionCard
                  key={t.id}
                  template={t}
                  onStart={onStartFocus}
                />
              ))}
            </div>
          ) : (
            <div className="bg-paper border-2 border-ink border-dashed p-4 text-center">
              <p className="font-mono text-xs text-ink/60 uppercase">
                No saved sessions. Save a setup after starting a session.
              </p>
            </div>
          )}
        </div>

        {/* Quick Tools */}
        <QuickTools onNavigate={onNavigate} activeSession={activeSession} />

        {/* Daily Quote */}
        <DailyQuote />
      </div>
    </div>
  );
}

export default Home;
