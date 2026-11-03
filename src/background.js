import {
  syncBlockingRulesFromStorage,
  updateBlockingConfiguration,
  applyBlockingRules,
} from "./core/blocking.js";
import {
  completePomodoroPhase,
  normalizePomodoroSettings,
  restorePomodoroState,
} from "./core/pomodoro.js";
import { getAlarmAudioUrl } from "./core/audio.js";
import { createOffscreenBridge } from "./core/offscreenBridge.js";

import { createOperationQueue } from "./core/operationQueue.js";
import {
  createFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  completeFocusSession,
  abandonFocusSession,
  startBreakSession,
  startNextFocusCycle,
  calculateRemainingSeconds,
  calculateProgressPercentage,
  getFocusBadge,
  FOCUS_STATES,
  FOCUS_PHASES,
  AMBIENT_SOUND_IDS,
} from "./core/focusSession.js";
import {
  getActiveFocusSession,
  setActiveFocusSession,
  clearActiveFocusSession,
  getFocusTemplates,
  getFocusHistory,
  appendFocusHistory,
  getFocusPreferences,
  updateFocusPreferences,
  saveFocusTemplate,
  deleteFocusTemplate,
  initializeFocusStorage,
  STORAGE_KEYS,
} from "./core/focusStorage.js";

const POMODORO_ALARM = "pomodoroTimer";
export const FOCUS_ALARM = "focusSessionTimer";
const FOCUS_PENDING_ALARM_KEY = "focusPendingAlarm";
const FOCUS_BADGE_ALARM = "focusBadgeTick";
export const FOCUS_NOTIFICATION_ID = "focusPhaseAlarm";
const TOGGLE_PAUSE_COMMAND = "toggle-focus-pause";

const DEFAULT_AMBIENT_SETTINGS = Object.freeze({
  bird: { enabled: false, volume: 50 },
  campfire: { enabled: false, volume: 50 },
  ocean_waves: { enabled: false, volume: 50 },
  rain: { enabled: false, volume: 50 },
  thunder: { enabled: false, volume: 50 },
  wind: { enabled: false, volume: 50 },
});

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function getFocusCycleRecordId(session) {
  const cycleNumber = Math.max(1, session?.cycleNumber || 1);
  return cycleNumber === 1
    ? session.id
    : `${session.id}:cycle:${cycleNumber}`;
}

function normalizeAmbientSettings(settings = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_AMBIENT_SETTINGS).map(([soundKey, defaults]) => {
      const saved = settings[soundKey] ?? {};
      return [
        soundKey,
        {
          enabled:
            typeof saved.enabled === "boolean"
              ? saved.enabled
              : defaults.enabled,
          volume: Number.isFinite(saved.volume)
            ? Math.min(100, Math.max(0, saved.volume))
            : defaults.volume,
        },
      ];
    }),
  );
}

class AmbientSoundManager {
  constructor(chromeApi, offscreenBridge) {
    this.chromeApi = chromeApi;
    this.offscreenBridge = offscreenBridge;
    this.settings = normalizeAmbientSettings();
    this.ready = this.loadSettings();
  }

  async loadSettings() {
    const result = await this.chromeApi.storage.local.get(["ambientSettings"]);
    this.settings = normalizeAmbientSettings(result.ambientSettings);

    const enabledSounds = Object.entries(this.settings).filter(
      ([, setting]) => setting.enabled,
    );
    const results = await Promise.allSettled(
      enabledSounds.map(([soundKey, setting]) =>
        this.startSound(soundKey, setting.volume),
      ),
    );

    for (const resultItem of results) {
      if (resultItem.status === "rejected") {
        console.error("Unable to restore an ambient sound:", resultItem.reason);
      }
    }
  }

  async startSound(soundKey, volume) {
    await this.offscreenBridge.send({
      type: "START_AMBIENT_SOUND",
      soundKey,
      audioUrl: this.chromeApi.runtime.getURL(`audio/${soundKey}.m4a`),
      volume: volume / 100,
    });
  }

  async stopSound(soundKey) {
    await this.offscreenBridge.send({
      type: "STOP_AMBIENT_SOUND",
      soundKey,
    });
  }

  async updateVolume(soundKey, volume) {
    await this.offscreenBridge.send({
      type: "UPDATE_AMBIENT_VOLUME",
      soundKey,
      volume: volume / 100,
    });
  }

  async updateSettings(newSettings) {
    await this.ready;
    const nextSettings = normalizeAmbientSettings({
      ...this.settings,
      ...newSettings,
    });

    for (const [soundKey, next] of Object.entries(nextSettings)) {
      const current = this.settings[soundKey];
      if (!current.enabled && next.enabled) {
        await this.startSound(soundKey, next.volume);
      } else if (current.enabled && !next.enabled) {
        await this.stopSound(soundKey);
      } else if (next.enabled && current.volume !== next.volume) {
        await this.updateVolume(soundKey, next.volume);
      }
    }

    await this.chromeApi.storage.local.set({ ambientSettings: nextSettings });
    this.settings = nextSettings;
    return { success: true, settings: nextSettings };
  }

  async stopAllSounds() {
    await this.ready;
    await this.offscreenBridge.send({ type: "STOP_ALL_AMBIENT_SOUNDS" });

    const nextSettings = Object.fromEntries(
      Object.entries(this.settings).map(([soundKey, setting]) => [
        soundKey,
        { ...setting, enabled: false },
      ]),
    );
    await this.chromeApi.storage.local.set({ ambientSettings: nextSettings });
    this.settings = nextSettings;
    return { success: true, settings: nextSettings };
  }

  async testSound(soundKey, volume = 50) {
    await this.ready;
    await this.offscreenBridge.send({
      type: "TEST_AMBIENT_SOUND",
      soundKey,
      audioUrl: this.chromeApi.runtime.getURL(`audio/${soundKey}.m4a`),
      volume: Math.min(100, Math.max(0, volume)) / 100,
    });
    return { success: true };
  }
}

class BackgroundPomodoroManager {
  constructor(chromeApi, offscreenBridge) {
    this.chromeApi = chromeApi;
    this.offscreenBridge = offscreenBridge;
    this.isActive = false;
    this.isBreak = false;
    this.currentTime = 25 * 60;
    this.initialTime = 25 * 60;
    this.phaseEndsAt = null;
    this.focusTime = 25;
    this.breakTime = 5;
    this.sessionCount = 0;
    this.audioEnabled = true;
    this.completionPromise = null;
    this.ready = this.loadState();
  }

  async loadState() {
    try {
      const result = await this.chromeApi.storage.local.get([
        "pomodoroState",
        "pomodoroSettings",
      ]);
      const restored = restorePomodoroState(
        result.pomodoroState,
        result.pomodoroSettings,
      );
      Object.assign(this, restored);

      if (!this.isActive) {
        return;
      }

      if (!this.phaseEndsAt) {
        this.isActive = false;
        await this.saveState();
        return;
      }

      if (this.phaseEndsAt <= Date.now()) {
        await this.completeCurrentPhase();
        return;
      }

      await this.chromeApi.alarms.create(POMODORO_ALARM, {
        when: this.phaseEndsAt,
      });
    } catch (error) {
      console.error("Unable to restore Pomodoro state:", error);
      this.isActive = false;
      this.phaseEndsAt = null;
    }
  }

  async saveState() {
    const state = {
      isActive: this.isActive,
      isBreak: this.isBreak,
      currentTime: this.currentTime,
      initialTime: this.initialTime,
      phaseEndsAt: this.phaseEndsAt,
      sessionCount: this.sessionCount,
      lastUpdated: Date.now(),
    };

    await this.chromeApi.storage.local.set({ pomodoroState: state });
    this.chromeApi.runtime
      .sendMessage({
        type: "POMODORO_STATE_UPDATE",
        state: this.getState(),
      })
      .catch(() => {});
  }

  phaseDuration() {
    return (this.isBreak ? this.breakTime : this.focusTime) * 60;
  }

  async startTimer({ skipReady = false } = {}) {
    if (!skipReady) {
      await this.ready;
    }
    if (this.currentTime <= 0) {
      this.currentTime = this.phaseDuration();
      this.initialTime = this.currentTime;
    }

    this.isActive = true;
    this.phaseEndsAt = Date.now() + this.currentTime * 1000;
    await this.chromeApi.alarms.create(POMODORO_ALARM, {
      when: this.phaseEndsAt,
    });
    await this.saveState();
    return { success: true, state: this.getState() };
  }

  async pauseTimer() {
    await this.ready;
    if (this.phaseEndsAt) {
      this.currentTime = Math.max(
        0,
        Math.ceil((this.phaseEndsAt - Date.now()) / 1000),
      );
    }
    this.isActive = false;
    this.phaseEndsAt = null;
    await this.chromeApi.alarms.clear(POMODORO_ALARM);
    await this.saveState();
    return { success: true, state: this.getState() };
  }

  async resetTimer() {
    await this.ready;
    this.isActive = false;
    this.isBreak = false;
    this.currentTime = this.focusTime * 60;
    this.initialTime = this.currentTime;
    this.phaseEndsAt = null;
    this.sessionCount = 0;
    await this.chromeApi.alarms.clear(POMODORO_ALARM);
    await this.saveState();
    return { success: true, state: this.getState() };
  }

  async completeCurrentPhase() {
    if (this.completionPromise) {
      return this.completionPromise;
    }

    this.completionPromise = this.performPhaseCompletion().finally(() => {
      this.completionPromise = null;
    });
    return this.completionPromise;
  }

  async performPhaseCompletion() {
    await this.chromeApi.alarms.clear(POMODORO_ALARM);
    const next = completePomodoroPhase(this.getState(), {
      focusTime: this.focusTime,
      breakTime: this.breakTime,
      audioEnabled: this.audioEnabled,
    });
    Object.assign(this, next);

    const context = this.isBreak ? "break" : "focus";
    await this.startTimer({ skipReady: true });

    this.playNotification(context).catch((error) => {
      console.error("Unable to play Pomodoro notification:", error);
    });
    this.showNotification(context);

    return { success: true, state: this.getState() };
  }

  async playNotification() {
    if (!this.audioEnabled) {
      return { success: true, skipped: true };
    }

    const audioUrl = this.chromeApi.runtime.getURL(`audio/${getAlarmAudioUrl()}`);
    // One-shot chime: Pomodoro auto-advances and has no mute UI, so a looping START_ALARM would ring forever.
    return this.offscreenBridge.send({
      type: "TEST_ALARM",
      audioUrl,
    });
  }

  async testNotification() {
    const audioUrl = this.chromeApi.runtime.getURL(`audio/${getAlarmAudioUrl()}`);
    return this.offscreenBridge.send({
      type: "TEST_ALARM",
      audioUrl,
    });
  }

  showNotification(context) {
    const startingBreak = context === "break";
    this.chromeApi.notifications
      .create({
        type: "basic",
        iconUrl: "images/icon32.png",
        title: startingBreak
          ? "Great job! Time for a break! 🎉"
          : "Break's over! Ready to focus? 💪",
        message: startingBreak
          ? `Take a ${this.breakTime} minute break.`
          : `Time for a ${this.focusTime} minute focus session.`,
      })
      .catch((error) => {
        console.error("Unable to show Pomodoro notification:", error);
      });
  }

  async updateSettings(settings) {
    await this.ready;
    const normalized = normalizePomodoroSettings({
      focusTime:
        settings.focusTime === undefined ? this.focusTime : settings.focusTime,
      breakTime:
        settings.breakTime === undefined ? this.breakTime : settings.breakTime,
      audioEnabled:
        settings.audioEnabled === undefined
          ? this.audioEnabled
          : settings.audioEnabled,
    });

    const focusChanged = normalized.focusTime !== this.focusTime;
    const breakChanged = normalized.breakTime !== this.breakTime;
    Object.assign(this, normalized);

    if (
      !this.isActive &&
      ((!this.isBreak && focusChanged) || (this.isBreak && breakChanged))
    ) {
      this.currentTime = this.phaseDuration();
      this.initialTime = this.currentTime;
    }

    await this.chromeApi.storage.local.set({ pomodoroSettings: normalized });
    await this.saveState();
    return { success: true, state: this.getState() };
  }

  getState() {
    let currentTime = this.currentTime;
    if (this.isActive && this.phaseEndsAt) {
      currentTime = Math.max(
        0,
        Math.ceil((this.phaseEndsAt - Date.now()) / 1000),
      );
    }

    return {
      isActive: this.isActive,
      isBreak: this.isBreak,
      currentTime,
      initialTime: this.initialTime,
      phaseEndsAt: this.phaseEndsAt,
      sessionCount: this.sessionCount,
      focusTime: this.focusTime,
      breakTime: this.breakTime,
      audioEnabled: this.audioEnabled,
    };
  }
}

export class FocusSessionManager {
  constructor(chromeApi, ambientManager, offscreenBridge) {
    this.chromeApi = chromeApi;
    this.ambientManager = ambientManager;
    this.offscreenBridge = offscreenBridge;
    this.completionPromise = null;
    this.badgeQueue = createOperationQueue();
    this.ready = this.loadState();
  }

  async applySessionBlocker(enabled, blockedUrls) {
    if (!this.chromeApi.declarativeNetRequest?.getDynamicRules) {
      return { success: true, skipped: true };
    }

    const result = await blockerOperationQueue.run(() =>
      applyBlockingRules(
        this.chromeApi.declarativeNetRequest,
        enabled,
        blockedUrls,
      ),
    );
    return { success: true, ...result };
  }

  async stopSessionAmbient() {
    if (
      this.ambientManager?.stopAllSounds &&
      this.chromeApi.runtime?.getContexts &&
      this.chromeApi.offscreen?.createDocument
    ) {
      await this.ambientManager.stopAllSounds();
    }
  }

  async startSessionAmbient(ambientSound) {
    if (
      !ambientSound?.enabled ||
      !this.ambientManager?.updateSettings ||
      !this.chromeApi.runtime?.getContexts ||
      !this.chromeApi.offscreen?.createDocument
    ) {
      return;
    }

    await this.ambientManager.updateSettings(
      Object.fromEntries(
        AMBIENT_SOUND_IDS.map((soundId) => [
          soundId,
          {
            enabled: Boolean(
              ambientSound.sounds?.[soundId]?.enabled ??
              ambientSound.soundId === soundId,
            ),
            volume:
              ambientSound.sounds?.[soundId]?.volume ??
              ambientSound.volume ??
              50,
          },
        ]),
      ),
    );
  }

  async restoreEnvironment(session) {
    // Stored quick tool config is the truth: it includes edits saved while the session owned blocking.
    if (this.chromeApi.declarativeNetRequest?.getDynamicRules) {
      await blockerOperationQueue.run(() =>
        syncBlockingRulesFromStorage(this.chromeApi),
      );
    }

    const previous = session?.preSessionState;
    if (!previous) {
      return;
    }

    if (
      previous.ambientSettings &&
      this.ambientManager?.updateSettings &&
      this.chromeApi.runtime?.getContexts &&
      this.chromeApi.offscreen?.createDocument
    ) {
      await this.ambientManager.updateSettings(previous.ambientSettings);
    } else {
      await this.stopSessionAmbient();
    }
  }

  async captureEnvironmentState() {
    const data = await this.chromeApi.storage.local.get([
      "ambientSettings",
      "pomodoroState",
    ]);

    return {
      ambientSettings:
        data.ambientSettings && typeof data.ambientSettings === "object"
          ? data.ambientSettings
          : null,
      pomodoroActive: Boolean(data.pomodoroState?.isActive),
    };
  }

  async loadState() {
    try {
      await initializeFocusStorage(this.chromeApi);
      const activeSession = await getActiveFocusSession(this.chromeApi);
      if (!activeSession) {
        return;
      }

      if (
        activeSession.status === FOCUS_STATES.ACTIVE_FOCUS ||
        activeSession.status === FOCUS_STATES.ACTIVE_BREAK
      ) {
        const now = Date.now();
        if (activeSession.phaseEndsAt && activeSession.phaseEndsAt <= now) {
          await this.completeCurrentPhase();
        } else if (activeSession.phaseEndsAt) {
          await this.chromeApi.alarms.create(FOCUS_ALARM, {
            when: activeSession.phaseEndsAt,
          });
        }
      }
    } catch (error) {
      console.error("Unable to restore Focus Session state:", error);
    }
  }

  async getState() {
    await this.ready;
    const [rawActive, templates, history, preferences, pendingResult] = await Promise.all([
      getActiveFocusSession(this.chromeApi),
      getFocusTemplates(this.chromeApi),
      getFocusHistory(this.chromeApi),
      getFocusPreferences(this.chromeApi),
      this.chromeApi.storage.local.get([FOCUS_PENDING_ALARM_KEY]),
    ]);

    let activeSession = rawActive;
    if (activeSession) {
      const now = Date.now();
      activeSession = {
        ...activeSession,
        remainingSeconds: calculateRemainingSeconds(activeSession, now),
        progressPercentage: calculateProgressPercentage(activeSession, now),
      };
    }

    return {
      success: true,
      activeSession,
      templates,
      history,
      preferences,
      pendingAlarm: pendingResult[FOCUS_PENDING_ALARM_KEY] ?? null,
    };
  }

  async startSession(payload = {}) {
    await this.ready;
    if (await getActiveFocusSession(this.chromeApi)) {
      return { success: false, error: "A Focus Session is already running" };
    }
    const inputConfig = payload.config || payload || {};
    const config = {
      templateId: inputConfig.templateId,
      focusDuration: inputConfig.durationMinutes ?? inputConfig.focusDuration,
      breakDuration: inputConfig.breakDuration,
      goal:
        inputConfig.goal ??
        (inputConfig.taskId !== undefined || inputConfig.taskText !== undefined
          ? {
              type: inputConfig.taskId ? "task" : "text",
              taskId: inputConfig.taskId,
              text: inputConfig.taskText || "",
            }
          : undefined),
      blocker:
        inputConfig.blocker ??
        (inputConfig.blockerEnabled !== undefined
          ? { enabled: inputConfig.blockerEnabled }
          : undefined),
      ambientSound:
        inputConfig.ambientSound ??
        (inputConfig.soundTrack
          ? { enabled: true, soundId: inputConfig.soundTrack }
          : undefined),
      preSessionState: inputConfig.preSessionState,
    };

    const environment = await this.captureEnvironmentState();
    if (environment.pomodoroActive) {
      return {
        success: false,
        error: "Cannot start Focus Session while Pomodoro is active",
      };
    }
    config.preSessionState = environment;

    const session = createFocusSession(config, Date.now());
    await setActiveFocusSession(session, this.chromeApi);

    try {
      await this.applySessionBlocker(
        session.snapshot.blocker.enabled,
        session.snapshot.blocker.blockedUrls,
      );
      await this.stopSessionAmbient();
      await this.startSessionAmbient(session.snapshot.ambientSound);
      await this.chromeApi.alarms.create(FOCUS_ALARM, {
        when: session.phaseEndsAt,
      });

      this.broadcastStateUpdate(session);
      return { success: true, activeSession: session };
    } catch (error) {
      await this.chromeApi.alarms.clear(FOCUS_ALARM).catch(() => {});
      await clearActiveFocusSession(this.chromeApi).catch(() => {});
      await this.restoreEnvironment(session).catch(() => {});
      throw error;
    }
  }

  async pauseSession(payload = {}) {
    await this.ready;
    const session = await getActiveFocusSession(this.chromeApi);
    if (!session) {
      return { success: false, error: "No active focus session found" };
    }
    if (payload.runtimeId && session.id !== payload.runtimeId) {
      return { success: false, error: "Session runtime ID mismatch" };
    }

    const updated = pauseFocusSession(session, Date.now());
    await this.chromeApi.alarms.clear(FOCUS_ALARM);
    await setActiveFocusSession(updated, this.chromeApi);
    await this.stopSessionAmbient();

    this.broadcastStateUpdate(updated);
    return { success: true, activeSession: updated };
  }

  async resumeSession(payload = {}) {
    await this.ready;
    const session = await getActiveFocusSession(this.chromeApi);
    if (!session) {
      return { success: false, error: "No active focus session found" };
    }
    if (payload.runtimeId && session.id !== payload.runtimeId) {
      return { success: false, error: "Session runtime ID mismatch" };
    }

    const updated = resumeFocusSession(session, Date.now());
    await setActiveFocusSession(updated, this.chromeApi);
    if (updated.phaseEndsAt) {
      await this.chromeApi.alarms.create(FOCUS_ALARM, {
        when: updated.phaseEndsAt,
      });
    }
    await this.startSessionAmbient(
      updated.status === FOCUS_STATES.ACTIVE_FOCUS &&
        updated.phase === FOCUS_PHASES.FOCUS
        ? updated.snapshot?.ambientSound
        : null,
    );

    this.broadcastStateUpdate(updated);
    return { success: true, activeSession: updated };
  }

  async abandonSession(payload = {}) {
    await this.ready;
    const session = await getActiveFocusSession(this.chromeApi);
    if (!session) {
      return { success: false, error: "No active focus session found" };
    }
    if (payload.runtimeId && session.id !== payload.runtimeId) {
      return { success: false, error: "Session runtime ID mismatch" };
    }

    const reason = payload.reason || "user_stopped";
    const now = Date.now();
    const updated = abandonFocusSession(session, reason, now);

    await this.chromeApi.alarms.clear(FOCUS_ALARM);
    const cycleRecordId = getFocusCycleRecordId(updated);

    const historyRecord = {
      id: cycleRecordId,
      runtimeId: cycleRecordId,
      cycleNumber: Math.max(1, updated.cycleNumber || 1),
      status: FOCUS_STATES.ABANDONED,
      focusDurationMinutes:
        updated.snapshot?.focusDuration ||
        Math.round((updated.durationSeconds || 0) / 60),
      actualFocusSeconds: Math.max(
        0,
        Math.round((now - (updated.phaseStartedAt || updated.startedAt)) / 1000),
      ),
      startedAt: updated.phaseStartedAt || updated.startedAt,
      abandonedAt: updated.abandonedAt || now,
      abandonReason: reason,
      goal: updated.goal,
      templateId: updated.templateId,
    };

    await appendFocusHistory(historyRecord, this.chromeApi);
    await this.stopSessionAmbient();
    await this.restoreEnvironment(updated);
    await clearActiveFocusSession(this.chromeApi);

    this.broadcastStateUpdate(null);
    return { success: true, activeSession: null };
  }

  async startBreak(payload = {}) {
    await this.ready;
    const session = await getActiveFocusSession(this.chromeApi);
    if (!session) {
      return { success: false, error: "No session found to start break" };
    }
    if (payload.runtimeId && session.id !== payload.runtimeId) {
      return { success: false, error: "Session runtime ID mismatch" };
    }
    if (
      session.status !== FOCUS_STATES.FOCUS_COMPLETED &&
      session.status !== FOCUS_STATES.BREAK_COMPLETED
    ) {
      return { success: false, error: "Session is not ready for a break" };
    }

    await this.applySessionBlocker(false, []);
    await this.stopSessionAmbient();

    const durationMinutes = payload.durationMinutes ?? payload.breakDuration;
    const breakSession = startBreakSession(
      session,
      durationMinutes,
      Date.now(),
    );

    await setActiveFocusSession(breakSession, this.chromeApi);
    if (breakSession.phaseEndsAt) {
      await this.chromeApi.alarms.create(FOCUS_ALARM, {
        when: breakSession.phaseEndsAt,
      });
    }

    this.broadcastStateUpdate(breakSession);
    return { success: true, activeSession: breakSession };
  }

  async startNextCycle(payload = {}) {
    await this.ready;
    const session = await getActiveFocusSession(this.chromeApi);
    if (!session) {
      return { success: false, error: "No completed break found" };
    }
    if (payload.runtimeId && session.id !== payload.runtimeId) {
      return { success: false, error: "Session runtime ID mismatch" };
    }
    if (session.status !== FOCUS_STATES.BREAK_COMPLETED) {
      return {
        success: false,
        error: "Break must be completed before continuing focus",
      };
    }

    await this.stopAlarm();
    const nextCycle = startNextFocusCycle(session, Date.now());

    try {
      await this.applySessionBlocker(
        nextCycle.snapshot?.blocker?.enabled,
        nextCycle.snapshot?.blocker?.blockedUrls ?? [],
      );
      await this.stopSessionAmbient();
      await this.startSessionAmbient(nextCycle.snapshot?.ambientSound);
      await this.chromeApi.alarms.create(FOCUS_ALARM, {
        when: nextCycle.phaseEndsAt,
      });
      await setActiveFocusSession(nextCycle, this.chromeApi);

      this.broadcastStateUpdate(nextCycle);
      return { success: true, activeSession: nextCycle };
    } catch (error) {
      await this.chromeApi.alarms.clear(FOCUS_ALARM).catch(() => {});
      await this.applySessionBlocker(false, []).catch(() => {});
      await this.stopSessionAmbient().catch(() => {});
      throw error;
    }
  }

  async skipBreak(payload = {}) {
    await this.ready;
    const session = await getActiveFocusSession(this.chromeApi);
    if (payload.runtimeId && session && session.id !== payload.runtimeId) {
      return { success: false, error: "Session runtime ID mismatch" };
    }
    if (
      session &&
      ![
        FOCUS_STATES.FOCUS_COMPLETED,
        FOCUS_STATES.ACTIVE_BREAK,
        FOCUS_STATES.PAUSED_BREAK,
        FOCUS_STATES.BREAK_COMPLETED,
      ].includes(session.status)
    ) {
      return { success: false, error: "Session is still in focus" };
    }

    await this.chromeApi.alarms.clear(FOCUS_ALARM);
    await this.restoreEnvironment(session);
    await clearActiveFocusSession(this.chromeApi);

    this.broadcastStateUpdate(null);
    return { success: true, activeSession: null };
  }

  async togglePause() {
    await this.ready;
    const session = await getActiveFocusSession(this.chromeApi);
    switch (session?.status) {
      case FOCUS_STATES.ACTIVE_FOCUS:
      case FOCUS_STATES.ACTIVE_BREAK:
        return this.pauseSession({ runtimeId: session.id });
      case FOCUS_STATES.PAUSED_FOCUS:
      case FOCUS_STATES.PAUSED_BREAK:
        return this.resumeSession({ runtimeId: session.id });
      default:
        return { success: false, error: "No running Focus Session to pause" };
    }
  }

  async updatePreferences(payload = {}) {
    await this.ready;
    const prefsToUpdate = payload.preferences || payload;
    const updated = await updateFocusPreferences(prefsToUpdate, this.chromeApi);
    return { success: true, preferences: updated };
  }

  async completeCurrentPhase() {
    if (this.completionPromise) {
      return this.completionPromise;
    }

    this.completionPromise = this.performPhaseCompletion().finally(() => {
      this.completionPromise = null;
    });
    return this.completionPromise;
  }

  async performPhaseCompletion() {
    await this.chromeApi.alarms.clear(FOCUS_ALARM);
    const session = await getActiveFocusSession(this.chromeApi);
    if (!session) {
      return { success: false, error: "No active session to complete" };
    }

    const now = Date.now();
    const completedSession = completeFocusSession(session, now);
    await this.stopSessionAmbient();

    if (session.phase === FOCUS_PHASES.FOCUS) {
      const cycleRecordId = getFocusCycleRecordId(completedSession);
      const historyRecord = {
        id: cycleRecordId,
        runtimeId: cycleRecordId,
        cycleNumber: Math.max(1, completedSession.cycleNumber || 1),
        status: FOCUS_STATES.FOCUS_COMPLETED,
        focusDurationMinutes: completedSession.snapshot?.focusDuration || 25,
        actualFocusSeconds:
          completedSession.durationSeconds ||
          (completedSession.snapshot?.focusDuration || 25) * 60,
        startedAt:
          completedSession.phaseStartedAt || completedSession.startedAt,
        completedAt: completedSession.completedAt || now,
        goal: completedSession.goal,
        templateId: completedSession.templateId,
      };

      await appendFocusHistory(historyRecord, this.chromeApi);
      await setActiveFocusSession(completedSession, this.chromeApi);
      await this.setPendingAlarm(completedSession, "focus");

    } else {
      await setActiveFocusSession(completedSession, this.chromeApi);
      await this.setPendingAlarm(completedSession, "break");
    }

    this.openAlarmSurface(completedSession);
    this.broadcastStateUpdate(completedSession);

    const audioUrl = this.chromeApi.runtime.getURL(`audio/${getAlarmAudioUrl()}`);
    try {
      await this.offscreenBridge.send({
        type: "START_ALARM",
        audioUrl,
      });
    } catch (error) {
      console.error("Unable to play Focus alarm:", error);
    }

    return { success: true, activeSession: completedSession };
  }

  async stopAlarm() {
    await this.ready;
    await this.offscreenBridge.send({ type: "STOP_ALARM" });
    await this.clearPendingAlarm();
    return { success: true };
  }

  async setPendingAlarm(session, phase) {
    await this.chromeApi.storage.local.set({
      [FOCUS_PENDING_ALARM_KEY]: {
        sessionId: session.id,
        phase,
        createdAt: Date.now(),
      },
    });
    await this.refreshBadge();
  }

  async clearPendingAlarm() {
    await this.chromeApi.storage.local.remove(FOCUS_PENDING_ALARM_KEY);
    await this.chromeApi.notifications
      ?.clear?.(FOCUS_NOTIFICATION_ID)
      ?.catch?.(() => {});
    await this.refreshBadge();
  }

  refreshBadge() {
    return this.badgeQueue.run(async () => {
      const action = this.chromeApi.action;
      if (!action?.setBadgeText) return;
      const data = await this.chromeApi.storage.local.get([
        STORAGE_KEYS.ACTIVE_SESSION,
        FOCUS_PENDING_ALARM_KEY,
      ]);
      const session = data[STORAGE_KEYS.ACTIVE_SESSION] ?? null;
      const hasPendingAlarm = Boolean(data[FOCUS_PENDING_ALARM_KEY]);
      const badge = getFocusBadge(session, hasPendingAlarm);

      await action.setBadgeText({ text: badge.text });
      if (badge.color) {
        await action.setBadgeBackgroundColor?.({ color: badge.color });
        await action.setBadgeTextColor?.({ color: badge.textColor });
      }

      const isRunning =
        session?.status === FOCUS_STATES.ACTIVE_FOCUS ||
        session?.status === FOCUS_STATES.ACTIVE_BREAK;
      // ponytail: 30s tick (Chrome's minimum alarm period), so the badge can lag the real countdown by up to 30s.
      if (isRunning && !hasPendingAlarm) {
        await this.chromeApi.alarms.create(FOCUS_BADGE_ALARM, {
          periodInMinutes: 0.5,
        });
      } else {
        await this.chromeApi.alarms.clear(FOCUS_BADGE_ALARM);
      }
    });
  }

  openAlarmSurface(session) {
    if (!this.chromeApi.action?.openPopup) return;
    this.chromeApi.action.openPopup().catch((error) => {
      // openPopup() needs a focused Chrome window; otherwise fall back to a system notification.
      console.warn("Unable to open Focus alarm popup:", error);
      this.showAlarmNotification(session);
    });
  }

  showAlarmNotification(session) {
    const isFocus = session?.phase === FOCUS_PHASES.FOCUS;
    this.chromeApi.notifications
      ?.create(FOCUS_NOTIFICATION_ID, {
        type: "basic",
        iconUrl: "images/icon128.png",
        title: isFocus ? "Focus complete!" : "Break is over",
        message: isFocus
          ? `${session.snapshot?.focusDuration || 25} minutes done. Open Beeyond Limits to start your break.`
          : "Open Beeyond Limits to start your next focus cycle.",
        buttons: [{ title: "Mute alarm" }],
        requireInteraction: true,
      })
      .catch((error) => {
        console.error("Unable to show Focus alarm notification:", error);
      });
  }

  async saveTemplate(inputTemplate) {
    if (!inputTemplate || typeof inputTemplate !== "object") {
      throw new Error("Invalid template");
    }

    const template = await saveFocusTemplate(inputTemplate, this.chromeApi);
    this.broadcastStateUpdate(null);
    return { success: true, template };
  }

  async updateTemplate(inputTemplate) {
    if (!inputTemplate?.id) {
      throw new Error("Template ID is required");
    }
    return this.saveTemplate(inputTemplate);
  }

  async duplicateTemplate(templateId) {
    const templates = await getFocusTemplates(this.chromeApi);
    const existing = templates.find((template) => template.id === templateId);
    if (!existing) {
      throw new Error("Template not found");
    }

    return this.saveTemplate({
      ...existing,
      id: undefined,
      name: `${existing.name} (Copy)`,
      isDefault: false,
    });
  }

  async deleteTemplate(templateId) {
    if (!templateId) {
      throw new Error("Template ID is required");
    }

    const deleted = await deleteFocusTemplate(templateId, this.chromeApi);
    if (!deleted) {
      throw new Error("Template not found");
    }
    this.broadcastStateUpdate(null);
    return { success: true };
  }

  broadcastStateUpdate(activeSession) {
    this.refreshBadge().catch((error) => {
      console.error("Unable to update badge:", error);
    });
    if (!this.chromeApi.runtime?.sendMessage) return;
    const now = Date.now();
    const sessionPayload = activeSession
      ? {
          ...activeSession,
          remainingSeconds: calculateRemainingSeconds(activeSession, now),
          progressPercentage: calculateProgressPercentage(activeSession, now),
        }
      : null;

    this.chromeApi.runtime
      .sendMessage({
        type: "FOCUS_STATE_UPDATE",
        activeSession: sessionPayload,
      })
      .catch(() => {});
  }
}

const chromeApi = globalThis.chrome;
const offscreenBridge = createOffscreenBridge(chromeApi);
const ambientManager = new AmbientSoundManager(chromeApi, offscreenBridge);
const pomodoroManager = new BackgroundPomodoroManager(
  chromeApi,
  offscreenBridge,
);
export const focusManager = new FocusSessionManager(chromeApi, ambientManager, offscreenBridge);

const blockerOperationQueue = createOperationQueue();
const pomodoroOperationQueue = createOperationQueue();
const ambientOperationQueue = createOperationQueue();
const focusOperationQueue = createOperationQueue();


function respond(sendResponse, operation) {
  Promise.resolve(operation)
    .then((result) => sendResponse(result ?? { success: true }))
    .catch((error) => {
      console.error("Background operation failed:", error);
      sendResponse({ success: false, error: errorMessage(error) });
    });
  return true;
}

chromeApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POMODORO_ALARM) {
    pomodoroOperationQueue
      .run(() => pomodoroManager.completeCurrentPhase())
      .catch((error) => {
        console.error("Unable to complete Pomodoro phase:", error);
      });
  } else if (alarm.name === FOCUS_BADGE_ALARM) {
    focusManager.refreshBadge().catch(() => {});
  } else if (alarm.name === FOCUS_ALARM) {
    focusOperationQueue
      .run(() => focusManager.completeCurrentPhase())
      .catch((error) => {
        console.error("Unable to complete Focus phase:", error);
      });
  }
});

chromeApi.notifications?.onButtonClicked?.addListener((notificationId) => {
  if (notificationId !== FOCUS_NOTIFICATION_ID) return;
  focusOperationQueue.run(() => focusManager.stopAlarm()).catch((error) => {
    console.error("Unable to mute Focus alarm:", error);
  });
});

chromeApi.notifications?.onClicked?.addListener((notificationId) => {
  if (notificationId !== FOCUS_NOTIFICATION_ID) return;
  chromeApi.action?.openPopup?.().catch(() => {});
});

chromeApi.commands?.onCommand?.addListener((command) => {
  if (command !== TOGGLE_PAUSE_COMMAND) return;
  focusOperationQueue.run(() => focusManager.togglePause()).catch((error) => {
    console.error("Unable to toggle Focus Session pause:", error);
  });
});

chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target === "offscreen") {
    return false;
  }

  switch (message.type) {
    case "UPDATE_BLOCKING_RULES":
      return respond(
        sendResponse,
        blockerOperationQueue.run(async () =>
          updateBlockingConfiguration(
            chromeApi,
            message.isBlocking,
            message.blockedUrls,
            // ADR-001: a running session owns the rules; just save the quick tool config for after it ends.
            { applyRules: !(await getActiveFocusSession(chromeApi)) },
          ),
        ),
      );
    case "FOCUS_STOP_ALARM":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.stopAlarm()),
      );
    case "POMODORO_START":
      return respond(
        sendResponse,
        pomodoroOperationQueue.run(async () => {
          const activeFocusSession = await getActiveFocusSession(chromeApi);
          if (activeFocusSession) {
            return {
              success: false,
              error: "Pomodoro is locked while a Focus Session is running",
            };
          }
          return pomodoroManager.startTimer();
        }),
      );
    case "POMODORO_PAUSE":
      return respond(
        sendResponse,
        pomodoroOperationQueue.run(() => pomodoroManager.pauseTimer()),
      );
    case "POMODORO_RESET":
      return respond(
        sendResponse,
        pomodoroOperationQueue.run(() => pomodoroManager.resetTimer()),
      );
    case "POMODORO_UPDATE_SETTINGS":
      return respond(
        sendResponse,
        pomodoroOperationQueue.run(() =>
          pomodoroManager.updateSettings(message.settings ?? {}),
        ),
      );
    case "POMODORO_GET_STATE":
      return respond(
        sendResponse,
        pomodoroOperationQueue.run(() =>
          pomodoroManager.ready.then(() => ({
            success: true,
            state: pomodoroManager.getState(),
          })),
        ),
      );
    case "POMODORO_TEST_AUDIO":
      return respond(
        sendResponse,
        pomodoroManager.ready.then(() =>
          pomodoroManager.testNotification(),
        ),
      );
    case "AMBIENT_UPDATE_SETTINGS":
      return respond(
        sendResponse,
        ambientOperationQueue.run(() =>
          ambientManager.updateSettings(message.settings ?? {}),
        ),
      );
    case "AMBIENT_TEST_SOUND":
      return respond(
        sendResponse,
        ambientManager.testSound(message.soundKey, message.volume),
      );
    case "AMBIENT_STOP_ALL":
      return respond(
        sendResponse,
        ambientOperationQueue.run(() => ambientManager.stopAllSounds()),
      );
    case "FOCUS_GET_STATE":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.getState()),
      );
    case "FOCUS_START_SESSION":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.startSession(message)),
      );
    case "FOCUS_PAUSE_SESSION":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.pauseSession(message)),
      );
    case "FOCUS_RESUME_SESSION":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.resumeSession(message)),
      );
    case "FOCUS_ABANDON_SESSION":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.abandonSession(message)),
      );
    case "FOCUS_START_BREAK":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.startBreak(message)),
      );
    case "FOCUS_START_NEXT_CYCLE":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.startNextCycle(message)),
      );
    case "FOCUS_SKIP_BREAK":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.skipBreak(message)),
      );
    case "FOCUS_UPDATE_PREFERENCES":
      return respond(
        sendResponse,
        focusOperationQueue.run(() => focusManager.updatePreferences(message)),
      );
    case "FOCUS_SESSION_TEMPLATE_SAVE":
      return respond(
        sendResponse,
        focusOperationQueue.run(() =>
          focusManager.saveTemplate(message.template),
        ),
      );
    case "FOCUS_SESSION_TEMPLATE_UPDATE":
      return respond(
        sendResponse,
        focusOperationQueue.run(() =>
          focusManager.updateTemplate(message.template),
        ),
      );
    case "FOCUS_SESSION_TEMPLATE_DUPLICATE":
      return respond(
        sendResponse,
        focusOperationQueue.run(() =>
          focusManager.duplicateTemplate(message.templateId),
        ),
      );
    case "FOCUS_SESSION_TEMPLATE_DELETE":
      return respond(
        sendResponse,
        focusOperationQueue.run(() =>
          focusManager.deleteTemplate(message.templateId),
        ),
      );
    default:
      return false;
  }
});

async function synchronizeStartup() {
  try {
    await focusOperationQueue.run(() => focusManager.ready);
    if (chromeApi.declarativeNetRequest?.getDynamicRules) {
      const state = await focusManager.getState();
      const session = state.activeSession;
      if (session) {
        // Breaks run unblocked, same as startBreak().
        await focusManager.applySessionBlocker(
          session.phase === FOCUS_PHASES.FOCUS &&
            Boolean(session.snapshot?.blocker?.enabled),
          session.snapshot?.blocker?.blockedUrls ?? [],
        );
      } else {
        await blockerOperationQueue.run(() =>
          syncBlockingRulesFromStorage(chromeApi),
        );
      }
    }
    await focusManager.refreshBadge();
  } catch (error) {
    console.error("Unable to synchronize startup:", error);
  }
}

chromeApi.runtime.onStartup.addListener(synchronizeStartup);
chromeApi.runtime.onInstalled.addListener(synchronizeStartup);
synchronizeStartup();
