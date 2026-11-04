/**
 * src/core/focusStorage.js
 * Storage accessors & schema persistence for Focus Sessions in chrome.storage.local.
 */

import {
  DEFAULT_TEMPLATES,
  DEFAULT_FOCUS_SETTINGS,
  normalizeFocusConfig,
  pruneHistoryRecords,
  rollupHistoryRecords,
  isDuplicateCompletion,
  clamp,
  FOCUS_BOUNDS,
} from "./focusSession.js";

export const STORAGE_KEYS = Object.freeze({
  ACTIVE_SESSION: "activeFocusSession",
  TEMPLATES: "focusSessionTemplates",
  HISTORY: "focusSessionHistory",
  DAILY_SUMMARY: "focusSessionDailySummary",
  PREFERENCES: "focusSessionPreferences",
});

export function createOperationQueue() {
  let currentPromise = Promise.resolve();
  return function enqueue(fn) {
    const next = currentPromise.then(
      () => fn(),
      () => fn()
    );
    currentPromise = next.catch(() => {});
    return next;
  };
}

const defaultQueue = createOperationQueue();

function getStorage(chromeStorageApi) {
  const api = chromeStorageApi?.storage?.local || chromeStorageApi || globalThis.chrome?.storage?.local;
  if (!api || typeof api.get !== "function" || typeof api.set !== "function") {
    throw new Error("Chrome storage API is unavailable");
  }
  return api;
}

export async function getActiveFocusSession(chromeStorageApi) {
  const storage = getStorage(chromeStorageApi);
  const data = await storage.get([STORAGE_KEYS.ACTIVE_SESSION]);
  return data[STORAGE_KEYS.ACTIVE_SESSION] ?? null;
}

export async function setActiveFocusSession(session, chromeStorageApi) {
  return defaultQueue(async () => {
    const storage = getStorage(chromeStorageApi);
    await storage.set({ [STORAGE_KEYS.ACTIVE_SESSION]: session });
    return session;
  });
}

export async function clearActiveFocusSession(chromeStorageApi) {
  return defaultQueue(async () => {
    const storage = getStorage(chromeStorageApi);
    if (typeof storage.remove === "function") {
      await storage.remove(STORAGE_KEYS.ACTIVE_SESSION);
    } else {
      await storage.set({ [STORAGE_KEYS.ACTIVE_SESSION]: null });
    }
    return true;
  });
}

export async function getFocusTemplates(chromeStorageApi) {
  const storage = getStorage(chromeStorageApi);
  const data = await storage.get([STORAGE_KEYS.TEMPLATES]);
  const templates = data[STORAGE_KEYS.TEMPLATES];
  if (!Array.isArray(templates)) return DEFAULT_TEMPLATES;
  return templates.filter((t) => t && typeof t === "object" && t.id);
}

export async function saveFocusTemplate(template, chromeStorageApi) {
  return defaultQueue(async () => {
    const storage = getStorage(chromeStorageApi);
    const rawTemplates = await getFocusTemplates(chromeStorageApi);
    const currentTemplates = rawTemplates.filter((t) => t && typeof t === "object" && t.id);

    const rawName = typeof template?.name === "string" ? template.name.trim() : "Untitled Template";
    const name = (rawName.slice(0, FOCUS_BOUNDS.MAX_TEMPLATE_NAME_LENGTH) || "Untitled Template");

    const normalizedConfig = normalizeFocusConfig(template);
    const now = Date.now();

    let templateId = template?.id;
    const existingTemplate = templateId ? currentTemplates.find((t) => t.id === templateId) : null;

    let savedTemplate;

    if (existingTemplate) {
      savedTemplate = {
        ...existingTemplate,
        name,
        focusDuration: normalizedConfig.focusDuration,
        breakDuration: normalizedConfig.breakDuration,
        goal: normalizedConfig.goal,
        blocker: normalizedConfig.blocker,
        ambientSound: normalizedConfig.ambientSound,
        updatedAt: now,
      };
    } else {
      templateId = templateId || `template_${now}_${Math.random().toString(36).slice(2, 7)}`;
      savedTemplate = {
        id: templateId,
        name,
        focusDuration: normalizedConfig.focusDuration,
        breakDuration: normalizedConfig.breakDuration,
        goal: normalizedConfig.goal,
        blocker: normalizedConfig.blocker,
        ambientSound: normalizedConfig.ambientSound,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      };
    }

    const firstIdx = currentTemplates.findIndex((t) => t.id === templateId);
    const sanitizedTemplates = currentTemplates.filter((t) => t.id !== templateId);
    let updatedTemplates;
    if (firstIdx !== -1) {
      updatedTemplates = [...sanitizedTemplates];
      updatedTemplates.splice(firstIdx, 0, savedTemplate);
    } else {
      updatedTemplates = [...sanitizedTemplates, savedTemplate];
    }

    await storage.set({ [STORAGE_KEYS.TEMPLATES]: updatedTemplates });
    return savedTemplate;
  });
}

export async function deleteFocusTemplate(templateId, chromeStorageApi) {
  return defaultQueue(async () => {
    const storage = getStorage(chromeStorageApi);
    const currentTemplates = await getFocusTemplates(chromeStorageApi);

    const validTemplates = currentTemplates.filter((t) => t && typeof t === "object" && t.id);
    const exists = validTemplates.some((t) => t.id === templateId);

    if (!exists) {
      return false;
    }

    const filtered = validTemplates.filter((t) => t.id !== templateId);

    await storage.set({ [STORAGE_KEYS.TEMPLATES]: filtered });
    return true;
  });
}

export async function getFocusHistory(chromeStorageApi) {
  const storage = getStorage(chromeStorageApi);
  const data = await storage.get([STORAGE_KEYS.HISTORY]);
  const history = data[STORAGE_KEYS.HISTORY];
  return Array.isArray(history) ? history : [];
}

export async function appendFocusHistory(historyRecord, chromeStorageApi) {
  return defaultQueue(async () => {
    const storage = getStorage(chromeStorageApi);
    const currentHistory = await getFocusHistory(chromeStorageApi);

    if (!historyRecord || typeof historyRecord !== "object" || Array.isArray(historyRecord)) {
      return currentHistory;
    }

    const runtimeId = historyRecord.runtimeId || historyRecord.id;
    if (runtimeId && isDuplicateCompletion(currentHistory, runtimeId)) {
      return currentHistory;
    }

    const now = Date.now();
    const recordTime = historyRecord.completedAt || historyRecord.abandonedAt || historyRecord.startedAt || now;
    const d = new Date(recordTime);
    const dateStr =
      historyRecord.dateStr ||
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const enrichedRecord = {
      ...historyRecord,
      id: historyRecord.id || `history_${runtimeId || now}`,
      runtimeId: runtimeId || null,
      dateStr,
    };

    const updatedHistory = [...currentHistory, enrichedRecord];
    const pruned = pruneHistoryRecords(updatedHistory, 90, 500, now);

    // Spec §7: fold records that fall out of history into per-day totals before dropping them.
    const kept = new Set(pruned);
    const dropped = updatedHistory.filter((record) => !kept.has(record));
    const updates = { [STORAGE_KEYS.HISTORY]: pruned };
    if (dropped.length > 0) {
      // ponytail: one entry per day, kept forever (~50 bytes/day); cap it if storage ever matters.
      updates[STORAGE_KEYS.DAILY_SUMMARY] = rollupHistoryRecords(
        await getFocusDailySummary(chromeStorageApi),
        dropped,
      );
    }

    await storage.set(updates);
    return pruned;
  });
}

export async function getFocusDailySummary(chromeStorageApi) {
  const storage = getStorage(chromeStorageApi);
  const data = await storage.get([STORAGE_KEYS.DAILY_SUMMARY]);
  const summary = data[STORAGE_KEYS.DAILY_SUMMARY];
  return summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {};
}

export async function getFocusPreferences(chromeStorageApi) {
  const storage = getStorage(chromeStorageApi);
  const data = await storage.get([STORAGE_KEYS.PREFERENCES]);
  const storedPrefs = data[STORAGE_KEYS.PREFERENCES];

  if (storedPrefs && typeof storedPrefs === "object" && !Array.isArray(storedPrefs)) {
    const rawAmbient = storedPrefs.ambientSound;
    const validAmbient = rawAmbient && typeof rawAmbient === "object" && !Array.isArray(rawAmbient) ? rawAmbient : {};

    return {
      ...DEFAULT_FOCUS_SETTINGS,
      ...storedPrefs,
      ambientSound: {
        ...DEFAULT_FOCUS_SETTINGS.ambientSound,
        ...validAmbient,
      },
    };
  }

  return DEFAULT_FOCUS_SETTINGS;
}

export async function updateFocusPreferences(newPreferences, chromeStorageApi) {
  return defaultQueue(async () => {
    const storage = getStorage(chromeStorageApi);
    const currentPrefs = await getFocusPreferences(chromeStorageApi);

    const merged = {
      ...currentPrefs,
      ...newPreferences,
      ambientSound: {
        ...currentPrefs.ambientSound,
        ...(newPreferences?.ambientSound || {}),
      },
      blocker: {
        ...currentPrefs.blocker,
        ...(newPreferences?.blocker || {}),
      },
    };

    const normalizedConfig = normalizeFocusConfig(merged);

    const updatedPrefs = {
      focusDuration: normalizedConfig.focusDuration,
      breakDuration: normalizedConfig.breakDuration,
      blockerEnabled: normalizedConfig.blocker.enabled,
      dailyGoalMinutes: clamp(
        merged.dailyGoalMinutes,
        FOCUS_BOUNDS.MIN_DAILY_GOAL_MINUTES,
        FOCUS_BOUNDS.MAX_DAILY_GOAL_MINUTES,
        FOCUS_BOUNDS.DEFAULT_DAILY_GOAL_MINUTES,
      ),
      blocker: normalizedConfig.blocker,
      ambientSound: normalizedConfig.ambientSound,
    };

    await storage.set({ [STORAGE_KEYS.PREFERENCES]: updatedPrefs });
    return updatedPrefs;
  });
}

export async function initializeFocusStorage(chromeStorageApi) {
  return defaultQueue(async () => {
    const storage = getStorage(chromeStorageApi);
    const data = await storage.get([
      STORAGE_KEYS.ACTIVE_SESSION,
      STORAGE_KEYS.TEMPLATES,
      STORAGE_KEYS.HISTORY,
      STORAGE_KEYS.PREFERENCES,
      "blockedUrls",
    ]);

    const updates = {};
    const initialBlockedUrls = Array.isArray(data.blockedUrls) ? data.blockedUrls : [];

    if (data[STORAGE_KEYS.ACTIVE_SESSION] === undefined) {
      data[STORAGE_KEYS.ACTIVE_SESSION] = null;
    }

    if (!Array.isArray(data[STORAGE_KEYS.TEMPLATES])) {
      const templates = DEFAULT_TEMPLATES.map(t => ({
        ...t,
        blocker: { ...t.blocker, blockedUrls: initialBlockedUrls }
      }));
      updates[STORAGE_KEYS.TEMPLATES] = templates;
      data[STORAGE_KEYS.TEMPLATES] = templates;
    }

    if (!Array.isArray(data[STORAGE_KEYS.HISTORY])) {
      updates[STORAGE_KEYS.HISTORY] = [];
      data[STORAGE_KEYS.HISTORY] = [];
    }

    if (Array.isArray(data[STORAGE_KEYS.TEMPLATES])) {
      const templates = data[STORAGE_KEYS.TEMPLATES].map((template) => {
        if (Array.isArray(template?.blocker?.blockedUrls)) {
          return template;
        }
        return {
          ...template,
          blocker: {
            enabled: template?.blocker?.enabled ?? true,
            ...template?.blocker,
            blockedUrls: initialBlockedUrls,
          },
        };
      });
      if (templates.some((template, index) => template !== data[STORAGE_KEYS.TEMPLATES][index])) {
        updates[STORAGE_KEYS.TEMPLATES] = templates;
        data[STORAGE_KEYS.TEMPLATES] = templates;
      }
    }

    if (!data[STORAGE_KEYS.PREFERENCES] || typeof data[STORAGE_KEYS.PREFERENCES] !== "object" || Array.isArray(data[STORAGE_KEYS.PREFERENCES])) {
      const prefs = {
        ...DEFAULT_FOCUS_SETTINGS,
        blocker: { ...DEFAULT_FOCUS_SETTINGS.blocker, blockedUrls: initialBlockedUrls }
      };
      updates[STORAGE_KEYS.PREFERENCES] = prefs;
      data[STORAGE_KEYS.PREFERENCES] = prefs;
    } else if (!Array.isArray(data[STORAGE_KEYS.PREFERENCES].blocker?.blockedUrls)) {
      const existingPreferences = data[STORAGE_KEYS.PREFERENCES];
      const prefs = {
        ...existingPreferences,
        blocker: {
          ...DEFAULT_FOCUS_SETTINGS.blocker,
          enabled:
            existingPreferences.blocker?.enabled ??
            existingPreferences.blockerEnabled ??
            DEFAULT_FOCUS_SETTINGS.blocker.enabled,
          ...existingPreferences.blocker,
          blockedUrls: initialBlockedUrls,
        },
      };
      updates[STORAGE_KEYS.PREFERENCES] = prefs;
      data[STORAGE_KEYS.PREFERENCES] = prefs;
    }

    if (Object.keys(updates).length > 0) {
      await storage.set(updates);
    }

    return {
      activeFocusSession: data[STORAGE_KEYS.ACTIVE_SESSION] ?? null,
      focusSessionTemplates: data[STORAGE_KEYS.TEMPLATES],
      focusSessionHistory: data[STORAGE_KEYS.HISTORY],
      focusSessionPreferences: data[STORAGE_KEYS.PREFERENCES],
    };
  });
}
