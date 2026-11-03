import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aggregateDailyProgress, FOCUS_STATES } from "../core/focusSession.js";
import { createFocusSessionClient } from "../core/focusSessionClient.js";

const EMPTY_STATE = Object.freeze({
  activeSession: null,
  pendingAlarm: null,
  templates: [],
  history: [],
  dailySummary: {},
  preferences: null,
});

function getRuntimeApi() {
  return globalThis.chrome?.runtime ?? null;
}

export function useFocusSession() {
  const clientRef = useRef(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState(null);

  if (!clientRef.current) {
    clientRef.current = createFocusSessionClient(getRuntimeApi());
  }

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setIsLoading(true);
    }

    try {
      const next = await clientRef.current.getState();
      if (mountedRef.current) {
        setState({
          activeSession: next.activeSession ?? null,
          pendingAlarm: next.pendingAlarm ?? null,
          templates: Array.isArray(next.templates) ? next.templates : [],
          history: Array.isArray(next.history) ? next.history : [],
          dailySummary:
            next.dailySummary && typeof next.dailySummary === "object"
              ? next.dailySummary
              : {},
          preferences: next.preferences ?? null,
        });
        setError(null);
      }
      return next;
    } catch (nextError) {
      if (mountedRef.current) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
      throw nextError;
    } finally {
      if (!silent && mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh().catch(() => {});

    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const runtimeApi = getRuntimeApi();
    if (!runtimeApi?.onMessage?.addListener) {
      return undefined;
    }

    const handleMessage = (message) => {
      if (
        message?.type !== "FOCUS_STATE_UPDATE" &&
        message?.type !== "FOCUS_SESSION_STATE_UPDATE"
      ) {
        return;
      }

      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          activeSession: message.activeSession ?? null,
        }));
      }

      void refresh({ silent: true }).catch(() => {});
    };

    runtimeApi.onMessage.addListener(handleMessage);
    return () => {
      runtimeApi.onMessage.removeListener?.(handleMessage);
    };
  }, [refresh]);

  const activeStatus = state.activeSession?.status;
  useEffect(() => {
    if (
      activeStatus !== FOCUS_STATES.ACTIVE_FOCUS &&
      activeStatus !== FOCUS_STATES.PAUSED_FOCUS &&
      activeStatus !== FOCUS_STATES.ACTIVE_BREAK &&
      activeStatus !== FOCUS_STATES.PAUSED_BREAK
    ) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      void refresh({ silent: true }).catch(() => {});
    }, 1000);

    return () => clearInterval(intervalId);
  }, [activeStatus, refresh]);

  const runCommand = useCallback(
    async (action, operation) => {
      setBusyAction(action);
      setError(null);

      try {
        const response = await operation();
        await refresh({ silent: true });
        return response;
      } catch (nextError) {
        if (mountedRef.current) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
        throw nextError;
      } finally {
        if (mountedRef.current) {
          setBusyAction(null);
        }
      }
    },
    [refresh],
  );

  const progress = useMemo(
    () => aggregateDailyProgress(state.history),
    [state.history],
  );

  return {
    ...state,
    progress,
    isLoading,
    busyAction,
    error,
    isBusy: busyAction !== null,
    refresh,
    clearError: () => setError(null),
    startSession: (config) =>
      runCommand("start", () => clientRef.current.startSession(config)),
    pauseSession: (runtimeId) =>
      runCommand("pause", () => clientRef.current.pauseSession(runtimeId)),
    resumeSession: (runtimeId) =>
      runCommand("resume", () => clientRef.current.resumeSession(runtimeId)),
    abandonSession: (runtimeId, reason) =>
      runCommand("abandon", () =>
        clientRef.current.abandonSession(runtimeId, reason),
      ),
    startBreak: (runtimeId, durationMinutes) =>
      runCommand("break", () =>
        clientRef.current.startBreak(runtimeId, durationMinutes),
      ),
    startNextCycle: (runtimeId) =>
      runCommand("next-cycle", () =>
        clientRef.current.startNextCycle(runtimeId),
      ),
    skipBreak: (runtimeId) =>
      runCommand("skip-break", () => clientRef.current.skipBreak(runtimeId)),
    updatePreferences: (preferences) =>
      runCommand("preferences", () =>
        clientRef.current.updatePreferences(preferences),
      ),
    saveTemplate: (template) =>
      runCommand("save-template", () =>
        clientRef.current.saveTemplate(template),
      ),
    updateTemplate: (template) =>
      runCommand("update-template", () =>
        clientRef.current.updateTemplate(template),
      ),
    duplicateTemplate: (templateId) =>
      runCommand("duplicate-template", () =>
        clientRef.current.duplicateTemplate(templateId),
      ),
    deleteTemplate: (templateId) =>
      runCommand("delete-template", () =>
        clientRef.current.deleteTemplate(templateId),
      ),
    testAmbientSound: (soundKey, volume) =>
      clientRef.current.testAmbientSound(soundKey, volume),
    completeTask: (taskId) =>
      runCommand("complete-task", () => clientRef.current.completeTask(taskId)),
    finishSession: (runtimeId) =>
      runCommand("finish-session", () =>
        clientRef.current.skipBreak(runtimeId),
      ),
    stopAlarm: () =>
      runCommand("stop-alarm", () => clientRef.current.stopAlarm()),
  };
}
