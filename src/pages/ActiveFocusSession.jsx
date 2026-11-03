import { useEffect, useState, useRef } from "react";
import {
  Ban,
  Home,
  Pause,
  Play,
  ShieldCheck,
  Headphones,
} from "../components/Icons";
import { FOCUS_PHASES, FOCUS_STATES } from "../core/focusSession.js";
import { getFocusEnvironmentIndicators } from "../core/focusEnvironmentStatus.js";
import ConfirmDialog from "../components/ConfirmDialog";
import { ABANDON_REASONS } from "../core/focusStats.js";

function getRemainingSeconds(session, now = Date.now()) {
  if (!session) return 0;
  if (
    session.status === FOCUS_STATES.PAUSED_FOCUS ||
    session.status === FOCUS_STATES.PAUSED_BREAK
  ) {
    return Math.max(0, Math.ceil(session.remainingSeconds || 0));
  }
  if (session.phaseEndsAt) {
    return Math.max(0, Math.ceil((session.phaseEndsAt - now) / 1000));
  }
  return 0;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return (
    minutes.toString().padStart(2, "0") +
    ":" +
    seconds.toString().padStart(2, "0")
  );
}

function ActiveFocusSession({ onNavigate, onStartFocus, focusSession }) {
  const session = focusSession.activeSession;
  const [now, setNow] = useState(Date.now());
  const [showConfirm, setShowConfirm] = useState(false);
  const [stopReason, setStopReason] = useState(null);
  const stopBtnRef = useRef(null);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const isPaused =
    session?.status === FOCUS_STATES.PAUSED_FOCUS ||
    session?.status === FOCUS_STATES.PAUSED_BREAK;
  const isBreak = session?.phase === FOCUS_PHASES.BREAK;
  const isComplete =
    session?.status === FOCUS_STATES.FOCUS_COMPLETED ||
    session?.status === FOCUS_STATES.BREAK_COMPLETED;

  useEffect(() => {
    if (isComplete) {
      onNavigate("focus-complete");
    }
  }, [isComplete, onNavigate]);

  if (!session) {
    return (
      <div className="bg-canvas min-h-screen text-ink p-5 flex flex-col justify-center">
        <h1 className="font-display text-5xl uppercase">No active session</h1>
        <button
          type="button"
          onClick={onStartFocus}
          className="mt-5 bg-mustard brutal-border brutal-shadow font-display text-xl uppercase py-3"
        >
          Start a session
        </button>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="bg-canvas min-h-screen text-ink p-5 flex items-center justify-center">
        <p className="font-mono text-xl font-bold uppercase">Loading...</p>
      </div>
    );
  }

  const remaining = getRemainingSeconds(session, now);
  const goal = session.goal?.text || "Focused work";
  const environmentIndicators = getFocusEnvironmentIndicators(session);

  async function togglePause() {
    try {
      if (isPaused) {
        await focusSession.resumeSession(session.id);
      } else {
        await focusSession.pauseSession(session.id);
      }
    } catch {
      // Error is rendered by the shared hook.
    }
  }

  async function handleStopEarly() {
    try {
      await focusSession.abandonSession(session.id, stopReason ?? "user_stopped");
      onNavigate("home");
    } catch {
      setShowConfirm(false); // keep on recoverable state
    }
  }

  async function handleSkipBreak() {
    try {
      await focusSession.skipBreak(session.id);
      onNavigate("home");
    } catch {
      // Error handled by hook
    }
  }

  return (
    <div className="bg-canvas min-h-screen text-ink p-5 pb-20">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-5">
          <p className="font-mono text-xs font-bold uppercase flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${isPaused ? "bg-mustard" : isBreak ? "bg-sapphire" : "bg-emerald"}`}
            ></span>
            {isBreak ? "Break" : "Focus Session"} •{" "}
            {isPaused ? "Paused" : "Active"}
          </p>
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className="font-mono text-xs font-bold uppercase flex items-center gap-1 hover:underline"
          >
            <Home size={14} /> Home
          </button>
        </div>

        <h1 className="font-display text-4xl uppercase leading-none mb-8 break-words line-clamp-3">
          {isBreak ? "Take a break" : goal}
        </h1>

        <div className="bg-paper brutal-border brutal-shadow w-full aspect-square max-w-xs mx-auto flex flex-col items-center justify-center mb-8">
          <div
            role="timer"
            aria-label={formatTime(remaining) + " remaining"}
            className="font-display text-7xl tabular-nums tracking-tighter"
          >
            {formatTime(remaining)}
          </div>
          <p className="font-mono text-xs font-bold uppercase mt-2">
            {isBreak ? "Break Time" : isPaused ? "Paused" : "Focus Time"}
          </p>
        </div>

        {environmentIndicators.length > 0 && (
          <div
            role="status"
            aria-label="Active session environment"
            className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs font-bold uppercase"
          >
            {environmentIndicators.map((indicator) => (
              <span key={indicator.type} className="flex items-center gap-2">
                {indicator.type === "blocker" ? (
                  <ShieldCheck size={14} className="text-emerald" />
                ) : (
                  <Headphones size={14} className="text-emerald" />
                )}
                {indicator.text}
              </span>
            ))}
          </div>
        )}

        {focusSession.error && (
          <div
            role="alert"
            className="brutal-border bg-crimson text-paper p-3 font-mono text-xs mb-6"
          >
            {focusSession.error}
          </div>
        )}

        <button
          type="button"
          disabled={focusSession.isBusy}
          onClick={togglePause}
          className={`w-full brutal-border brutal-shadow font-display text-2xl uppercase py-4 flex items-center justify-center gap-2 mb-4 transition-colors disabled:opacity-50 ${
            isPaused
              ? "bg-emerald text-paper hover:bg-ink"
              : "bg-mustard text-ink hover:bg-ink hover:text-mustard"
          }`}
        >
          {isPaused ? <Play size={22} /> : <Pause size={22} />}
          {isPaused ? "Resume" : "Pause"}
        </button>

        {!isBreak ? (
          <button
            ref={stopBtnRef}
            type="button"
            onClick={() => {
              setStopReason(null);
              setShowConfirm(true);
            }}
            disabled={focusSession.isBusy}
            className="w-full bg-paper text-crimson brutal-border-light font-mono font-bold uppercase py-3 flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-crimson hover:text-paper transition-colors"
          >
            <Ban size={15} /> Stop Early
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSkipBreak}
            disabled={focusSession.isBusy}
            className="w-full bg-paper text-ink brutal-border-light font-mono font-bold uppercase py-3 flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-canvas transition-colors"
          >
            Skip Break
          </button>
        )}
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Stop Session?"
          message="This session will be recorded as abandoned and will not count towards your completed progress."
          confirmText="Stop Session"
          cancelText="Keep Focusing"
          onConfirm={handleStopEarly}
          onCancel={() => setShowConfirm(false)}
          focusTriggerRef={stopBtnRef}
        >
          <fieldset className="mb-6">
            <legend className="font-mono text-xs font-bold uppercase mb-2">
              Why are you stopping? (optional)
            </legend>
            <div className="flex flex-wrap gap-2">
              {ABANDON_REASONS.map((reason) => {
                const selected = stopReason === reason.id;
                return (
                  <button
                    key={reason.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setStopReason(selected ? null : reason.id)}
                    className={`brutal-border font-mono text-xs font-bold uppercase px-2 py-1 transition-colors ${
                      selected ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-canvas"
                    }`}
                  >
                    {reason.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </ConfirmDialog>
      )}
    </div>
  );
}

export default ActiveFocusSession;
