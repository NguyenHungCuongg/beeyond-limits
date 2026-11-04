import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_KEYS,
  createOperationQueue,
  getActiveFocusSession,
  setActiveFocusSession,
  clearActiveFocusSession,
  getFocusTemplates,
  saveFocusTemplate,
  deleteFocusTemplate,
  getFocusHistory,
  getFocusDailySummary,
  appendFocusHistory,
  getFocusPreferences,
  updateFocusPreferences,
  initializeFocusStorage,
} from "../src/core/focusStorage.js";

import {
  DEFAULT_TEMPLATES,
  DEFAULT_FOCUS_SETTINGS,
  FOCUS_STATES,
} from "../src/core/focusSession.js";

/**
 * Mock Chrome Storage API helper for testing.
 * Supports get, set, remove, and internal inspection.
 */
function createMockStorage(initialData = {}) {
  const store = new Map(Object.entries(initialData));

  return {
    async get(keys) {
      if (keys === null || keys === undefined) {
        return Object.fromEntries(store.entries());
      }
      if (typeof keys === "string") {
        return store.has(keys) ? { [keys]: store.get(keys) } : {};
      }
      if (Array.isArray(keys)) {
        const result = {};
        for (const k of keys) {
          if (store.has(k)) result[k] = store.get(k);
        }
        return result;
      }
      if (typeof keys === "object") {
        const result = {};
        for (const [k, defaultVal] of Object.entries(keys)) {
          result[k] = store.has(k) ? store.get(k) : defaultVal;
        }
        return result;
      }
      return {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, v);
      }
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        store.delete(k);
      }
    },
    _getRaw(key) {
      return store.get(key);
    },
    _has(key) {
      return store.has(key);
    },
  };
}

// ==========================================
// Suite 1: Storage Constants
// ==========================================

test("STORAGE_KEYS contains required keys and is frozen", () => {
  assert.equal(Object.isFrozen(STORAGE_KEYS), true);
  assert.equal(STORAGE_KEYS.ACTIVE_SESSION, "activeFocusSession");
  assert.equal(STORAGE_KEYS.TEMPLATES, "focusSessionTemplates");
  assert.equal(STORAGE_KEYS.HISTORY, "focusSessionHistory");
  assert.equal(STORAGE_KEYS.PREFERENCES, "focusSessionPreferences");
});

// ==========================================
// Suite 2: Storage Initialization & Default Seeding
// ==========================================

test("initializeFocusStorage populates empty storage with defaults without throwing", async () => {
  const mockStorage = createMockStorage();
  const state = await initializeFocusStorage(mockStorage);

  assert.equal(state.activeFocusSession, null);
  assert.deepEqual(state.focusSessionTemplates, DEFAULT_TEMPLATES);
  assert.deepEqual(state.focusSessionHistory, []);
  assert.deepEqual(state.focusSessionPreferences, DEFAULT_FOCUS_SETTINGS);

  // Check stored values directly
  assert.deepEqual(mockStorage._getRaw(STORAGE_KEYS.TEMPLATES), DEFAULT_TEMPLATES);
  assert.deepEqual(mockStorage._getRaw(STORAGE_KEYS.HISTORY), []);
  assert.deepEqual(mockStorage._getRaw(STORAGE_KEYS.PREFERENCES), DEFAULT_FOCUS_SETTINGS);
});

test("initializeFocusStorage preserves existing user templates and custom preferences", async () => {
  const customTemplate = { id: "custom_1", name: "Custom 1", focusDuration: 35, blocker: { enabled: true, blockedUrls: [] } };
  const customPrefs = { focusDuration: 40, breakDuration: 8, blockerEnabled: false, blocker: { enabled: false, blockedUrls: [] }, ambientSound: { enabled: true, soundId: "rain", volume: 80 } };
  const customHistory = [{ id: "h1", runtimeId: "session_1", status: FOCUS_STATES.FOCUS_COMPLETED }];

  const mockStorage = createMockStorage({
    [STORAGE_KEYS.TEMPLATES]: [customTemplate],
    [STORAGE_KEYS.PREFERENCES]: customPrefs,
    [STORAGE_KEYS.HISTORY]: customHistory,
  });

  const state = await initializeFocusStorage(mockStorage);

  assert.deepEqual(state.focusSessionTemplates, [customTemplate]);
  assert.deepEqual(state.focusSessionPreferences, customPrefs);
  assert.deepEqual(state.focusSessionHistory, customHistory);
});

test("initializeFocusStorage seeds legacy Focus preferences from the manual blocklist once", async () => {
  const manualBlocklist = [{ id: "youtube", url: "youtube.com" }];
  const legacyPreferences = {
    focusDuration: 50,
    blockerEnabled: true,
    blocker: { enabled: true },
  };
  const mockStorage = createMockStorage({
    blockedUrls: manualBlocklist,
    isBlocking: true,
    [STORAGE_KEYS.PREFERENCES]: legacyPreferences,
    [STORAGE_KEYS.TEMPLATES]: [{ id: "legacy-template", blocker: { enabled: true } }],
    [STORAGE_KEYS.HISTORY]: [],
  });

  await initializeFocusStorage(mockStorage);

  assert.deepEqual(
    mockStorage._getRaw(STORAGE_KEYS.PREFERENCES).blocker.blockedUrls,
    manualBlocklist,
  );
  assert.deepEqual(mockStorage._getRaw("blockedUrls"), manualBlocklist);
});

test("initializeFocusStorage does not overwrite an existing active session", async () => {
  const activeSession = { id: "session_existing", status: FOCUS_STATES.ACTIVE_FOCUS };
  const mockStorage = createMockStorage({
    [STORAGE_KEYS.ACTIVE_SESSION]: activeSession,
  });

  const state = await initializeFocusStorage(mockStorage);
  assert.deepEqual(state.activeFocusSession, activeSession);
  assert.deepEqual(mockStorage._getRaw(STORAGE_KEYS.ACTIVE_SESSION), activeSession);
});

// ==========================================
// Suite 3: Active Session Persistence (CRUD)
// ==========================================

test("getActiveFocusSession returns null when storage is uninitialized", async () => {
  const mockStorage = createMockStorage();
  const session = await getActiveFocusSession(mockStorage);
  assert.equal(session, null);
});

test("setActiveFocusSession persists runtime session object", async () => {
  const mockStorage = createMockStorage();
  const session = { id: "session_123", status: FOCUS_STATES.ACTIVE_FOCUS, focusDuration: 25 };

  const saved = await setActiveFocusSession(session, mockStorage);
  assert.deepEqual(saved, session);
  assert.deepEqual(mockStorage._getRaw(STORAGE_KEYS.ACTIVE_SESSION), session);

  const fetched = await getActiveFocusSession(mockStorage);
  assert.deepEqual(fetched, session);
});

test("clearActiveFocusSession removes active session from storage", async () => {
  const session = { id: "session_123", status: FOCUS_STATES.ACTIVE_FOCUS };
  const mockStorage = createMockStorage({
    [STORAGE_KEYS.ACTIVE_SESSION]: session,
  });

  const result = await clearActiveFocusSession(mockStorage);
  assert.equal(result, true);
  assert.equal(mockStorage._has(STORAGE_KEYS.ACTIVE_SESSION), false);
  assert.equal(await getActiveFocusSession(mockStorage), null);
});

// ==========================================
// Suite 4: Focus Templates Access & Mutations
// ==========================================

test("getFocusTemplates returns DEFAULT_TEMPLATES when storage is empty", async () => {
  const mockStorage = createMockStorage();
  const templates = await getFocusTemplates(mockStorage);
  assert.deepEqual(templates, DEFAULT_TEMPLATES);
});

test("saveFocusTemplate creates a new template with generated ID when ID is omitted", async () => {
  const mockStorage = createMockStorage();
  const newTemplateData = {
    name: "Study Session",
    focusDuration: 45,
    breakDuration: 10,
  };

  const saved = await saveFocusTemplate(newTemplateData, mockStorage);

  assert.ok(saved.id.startsWith("template_"));
  assert.equal(saved.name, "Study Session");
  assert.equal(saved.focusDuration, 45);
  assert.equal(saved.breakDuration, 10);
  assert.equal(saved.isDefault, false);
  assert.ok(typeof saved.createdAt === "number");
  assert.ok(typeof saved.updatedAt === "number");

  const templatesInStorage = await getFocusTemplates(mockStorage);
  assert.equal(templatesInStorage.length, DEFAULT_TEMPLATES.length + 1);
});

test("saveFocusTemplate updates existing template when ID matches (collision handling)", async () => {
  const mockStorage = createMockStorage();
  const original = await saveFocusTemplate(
    {
      name: "Original Session",
      focusDuration: 25,
      breakDuration: 5,
    },
    mockStorage,
  );
  const targetId = original.id;

  const updatedData = {
    id: targetId,
    name: "Updated Pomodoro 25",
    focusDuration: 30,
  };

  const saved = await saveFocusTemplate(updatedData, mockStorage);

  assert.equal(saved.id, targetId);
  assert.equal(saved.name, "Updated Pomodoro 25");
  assert.equal(saved.focusDuration, 30);

  const updatedTemplates = await getFocusTemplates(mockStorage);
  assert.equal(updatedTemplates.length, 1);
  assert.equal(updatedTemplates[0].name, "Updated Pomodoro 25");
  assert.equal(updatedTemplates[0].focusDuration, 30);
});

test("saveFocusTemplate normalizes name length and clamps duration bounds", async () => {
  const mockStorage = createMockStorage();
  const longName = "A".repeat(60); // Max is 40 chars

  const input = {
    name: longName,
    focusDuration: 200, // Clamped to 120
    breakDuration: 0, // Clamped to 1
  };

  const saved = await saveFocusTemplate(input, mockStorage);

  assert.equal(saved.name.length, 40);
  assert.equal(saved.focusDuration, 120);
  assert.equal(saved.breakDuration, 1);
});

test("deleteFocusTemplate removes a user-created template and returns true", async () => {
  const mockStorage = createMockStorage();
  const saved = await saveFocusTemplate(
    {
      name: "Session to delete",
      focusDuration: 25,
      breakDuration: 5,
    },
    mockStorage,
  );
  const deleteId = saved.id;

  const result = await deleteFocusTemplate(deleteId, mockStorage);
  assert.equal(result, true);

  const remaining = await getFocusTemplates(mockStorage);
  assert.equal(remaining.length, 0);
  assert.equal(remaining.some((t) => t.id === deleteId), false);
});

test("deleteFocusTemplate returns false when template ID does not exist", async () => {
  const mockStorage = createMockStorage();
  const result = await deleteFocusTemplate("non_existent_id", mockStorage);
  assert.equal(result, false);
});

// ==========================================
// Suite 5: Focus History & Auto-Pruning
// ==========================================

test("getFocusHistory returns empty array when uninitialized", async () => {
  const mockStorage = createMockStorage();
  const history = await getFocusHistory(mockStorage);
  assert.deepEqual(history, []);
});

test("appendFocusHistory adds history record and auto-generates dateStr if missing", async (t) => {
  // Pin the clock so the fixed record date never ages past the 90-day prune window.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-27T12:00:00Z") });
  const mockStorage = createMockStorage();
  const record = {
    runtimeId: "session_1722086400000_abc",
    status: FOCUS_STATES.FOCUS_COMPLETED,
    focusDurationMinutes: 25,
    actualFocusSeconds: 1500,
    completedAt: new Date("2026-07-27T10:00:00Z").getTime(),
  };

  const updatedHistory = await appendFocusHistory(record, mockStorage);

  assert.equal(updatedHistory.length, 1);
  assert.equal(updatedHistory[0].runtimeId, "session_1722086400000_abc");
  assert.equal(updatedHistory[0].dateStr, "2026-07-27");
  assert.ok(updatedHistory[0].id.startsWith("history_"));
});

test("appendFocusHistory ignores duplicate completion records with same runtimeId (idempotency)", async () => {
  const mockStorage = createMockStorage();
  const now = Date.now();
  const record1 = {
    runtimeId: "session_123",
    status: FOCUS_STATES.FOCUS_COMPLETED,
    focusDurationMinutes: 25,
    completedAt: now,
  };

  await appendFocusHistory(record1, mockStorage);

  const duplicateRecord = {
    runtimeId: "session_123",
    status: FOCUS_STATES.FOCUS_COMPLETED,
    focusDurationMinutes: 25,
    completedAt: now + 1000,
  };

  const result = await appendFocusHistory(duplicateRecord, mockStorage);

  assert.equal(result.length, 1);
  assert.equal(result[0].completedAt, now);
});

test("appendFocusHistory prunes records older than 90 days or exceeding 500 entries", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-27T12:00:00Z") });
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Pre-seed storage with history items
  const initialHistory = [];
  for (let i = 0; i < 520; i++) {
    initialHistory.push({
      id: `h_${i}`,
      runtimeId: `session_${i}`,
      status: FOCUS_STATES.FOCUS_COMPLETED,
      completedAt: now - (i + 1) * (dayMs / 10), // spread out timestamps, all older than now
    });
  }

  const mockStorage = createMockStorage({
    [STORAGE_KEYS.HISTORY]: initialHistory,
  });

  const newRecord = {
    runtimeId: "session_new",
    status: FOCUS_STATES.FOCUS_COMPLETED,
    completedAt: now,
  };

  const updatedHistory = await appendFocusHistory(newRecord, mockStorage);

  assert.ok(updatedHistory.length <= 500);
  assert.equal(updatedHistory[0].runtimeId, "session_new");
});

// ==========================================
// Suite 6: Preferences Persistence & Merging
// ==========================================

test("getFocusPreferences returns DEFAULT_FOCUS_SETTINGS when uninitialized", async () => {
  const mockStorage = createMockStorage();
  const prefs = await getFocusPreferences(mockStorage);
  assert.deepEqual(prefs, DEFAULT_FOCUS_SETTINGS);
});

test("updateFocusPreferences merges partial updates into existing preferences", async () => {
  const mockStorage = createMockStorage();
  const update = {
    focusDuration: 50,
    ambientSound: { enabled: true, soundId: "rain" },
  };

  const updated = await updateFocusPreferences(update, mockStorage);

  assert.equal(updated.focusDuration, 50);
  assert.equal(updated.breakDuration, DEFAULT_FOCUS_SETTINGS.breakDuration);
  assert.equal(updated.blockerEnabled, DEFAULT_FOCUS_SETTINGS.blockerEnabled);
  assert.equal(updated.ambientSound.enabled, true);
  assert.equal(updated.ambientSound.soundId, "rain");
  assert.equal(updated.ambientSound.volume, 50);
});

test("updateFocusPreferences preserves the session blocklist during unrelated updates", async () => {
  const sessionBlocklist = [{ id: "youtube", url: "youtube.com" }];
  const mockStorage = createMockStorage({
    [STORAGE_KEYS.PREFERENCES]: {
      ...DEFAULT_FOCUS_SETTINGS,
      blocker: { enabled: true, blockedUrls: sessionBlocklist },
    },
  });

  const updated = await updateFocusPreferences(
    { focusDuration: 50 },
    mockStorage,
  );

  assert.deepEqual(updated.blocker.blockedUrls.map(({ id, url }) => ({ id, url })), sessionBlocklist);
  assert.deepEqual(
    mockStorage._getRaw(STORAGE_KEYS.PREFERENCES).blocker.blockedUrls.map(({ id, url }) => ({ id, url })),
    sessionBlocklist,
  );
});

test("updateFocusPreferences clamps out-of-bound duration and volume settings", async () => {
  const mockStorage = createMockStorage();
  const invalidUpdate = {
    focusDuration: 500, // Clamped to 120
    breakDuration: -10, // Clamped to 1
    ambientSound: { enabled: true, soundId: "rain", volume: 150 }, // Clamped to 100
  };

  const updated = await updateFocusPreferences(invalidUpdate, mockStorage);

  assert.equal(updated.focusDuration, 120);
  assert.equal(updated.breakDuration, 1);
  assert.equal(updated.ambientSound.volume, 100);
});

// ==========================================
// Suite 7: API Safety & Dependency Injection Edge Cases
// ==========================================

test("accessors throw descriptive error if chromeStorageApi is missing", async () => {
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;

  try {
    await assert.rejects(
      async () => getActiveFocusSession(null),
      { message: "Chrome storage API is unavailable" }
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("accessors function correctly with injected mock storage", async () => {
  const mockStorage = createMockStorage();
  const prefs = await updateFocusPreferences({ focusDuration: 30 }, mockStorage);
  assert.equal(prefs.focusDuration, 30);
  assert.equal((await getFocusPreferences(mockStorage)).focusDuration, 30);
});

// ==========================================
// Suite 8: Iteration 2 Fixes Verification
// ==========================================

test("createOperationQueue executes operations sequentially in FIFO order", async () => {
  const queue = createOperationQueue();
  const executionOrder = [];

  const task1 = queue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    executionOrder.push("task1");
    return "result1";
  });

  const task2 = queue(async () => {
    executionOrder.push("task2");
    return "result2";
  });

  const [res1, res2] = await Promise.all([task1, task2]);

  assert.deepEqual(executionOrder, ["task1", "task2"]);
  assert.equal(res1, "result1");
  assert.equal(res2, "result2");
});

test("async operation queue prevents race conditions during concurrent mutative template saves", async () => {
  const mockStorage = createMockStorage();
  await initializeFocusStorage(mockStorage);

  const p1 = saveFocusTemplate({ id: "concurrent_1", name: "Concurrent 1", focusDuration: 25 }, mockStorage);
  const p2 = saveFocusTemplate({ id: "concurrent_2", name: "Concurrent 2", focusDuration: 30 }, mockStorage);
  const p3 = saveFocusTemplate({ id: "concurrent_3", name: "Concurrent 3", focusDuration: 35 }, mockStorage);

  await Promise.all([p1, p2, p3]);

  const templates = await getFocusTemplates(mockStorage);
  assert.equal(templates.some((t) => t.id === "concurrent_1"), true);
  assert.equal(templates.some((t) => t.id === "concurrent_2"), true);
  assert.equal(templates.some((t) => t.id === "concurrent_3"), true);
});

test("saveFocusTemplate and deleteFocusTemplate handle null and corrupted array elements gracefully without throwing", async () => {
  const mockStorage = createMockStorage({
    [STORAGE_KEYS.TEMPLATES]: [
      null,
      undefined,
      "corrupted_primitive",
      { invalidObjectWithoutId: true },
      { id: "valid_tmpl_1", name: "Valid 1", focusDuration: 25 },
    ],
  });

  // saveFocusTemplate must not crash when encountering null/corrupted elements
  const saved = await saveFocusTemplate({ id: "valid_tmpl_2", name: "Valid 2", focusDuration: 30 }, mockStorage);
  assert.equal(saved.id, "valid_tmpl_2");

  const templatesAfterSave = await getFocusTemplates(mockStorage);
  assert.equal(templatesAfterSave.some((t) => t.id === "valid_tmpl_1"), true);
  assert.equal(templatesAfterSave.some((t) => t.id === "valid_tmpl_2"), true);

  // deleteFocusTemplate must not crash when encountering null/corrupted elements
  const deleteResult = await deleteFocusTemplate("valid_tmpl_1", mockStorage);
  assert.equal(deleteResult, true);

  const templatesAfterDelete = await getFocusTemplates(mockStorage);
  assert.equal(templatesAfterDelete.some((t) => t.id === "valid_tmpl_1"), false);
  assert.equal(templatesAfterDelete.some((t) => t.id === "valid_tmpl_2"), true);
});

test("getFocusPreferences returns DEFAULT_FOCUS_SETTINGS when stored preferences is an Array or non-object to prevent key pollution", async () => {
  const mockStorageArray = createMockStorage({
    [STORAGE_KEYS.PREFERENCES]: ["invalid_array_entry_1", "invalid_array_entry_2"],
  });

  const prefsFromArray = await getFocusPreferences(mockStorageArray);
  assert.deepEqual(prefsFromArray, DEFAULT_FOCUS_SETTINGS);
  assert.equal(Object.prototype.hasOwnProperty.call(prefsFromArray, "0"), false);

  const mockStoragePrimitive = createMockStorage({
    [STORAGE_KEYS.PREFERENCES]: "corrupted_string_preference",
  });

  const prefsFromPrimitive = await getFocusPreferences(mockStoragePrimitive);
  assert.deepEqual(prefsFromPrimitive, DEFAULT_FOCUS_SETTINGS);
});

test("saveFocusTemplate deduplicates existing templates with matching ID leaving zero duplicate IDs", async () => {
  const mockStorage = createMockStorage({
    [STORAGE_KEYS.TEMPLATES]: [
      { id: "dup_target", name: "Duplicate Entry 1", focusDuration: 20 },
      { id: "dup_target", name: "Duplicate Entry 2", focusDuration: 25 },
      { id: "unique_tmpl", name: "Unique Template", focusDuration: 50 },
    ],
  });

  const saved = await saveFocusTemplate({ id: "dup_target", name: "Deduplicated Output", focusDuration: 40 }, mockStorage);

  assert.equal(saved.id, "dup_target");
  assert.equal(saved.name, "Deduplicated Output");

  const templates = await getFocusTemplates(mockStorage);
  const matching = templates.filter((t) => t.id === "dup_target");

  assert.equal(matching.length, 1);
  assert.equal(matching[0].name, "Deduplicated Output");
  assert.equal(matching[0].focusDuration, 40);
  assert.equal(templates.some((t) => t.id === "unique_tmpl"), true);
});

// ==========================================
// Suite 9: Iteration 3 Fixes Verification
// ==========================================

test("getFocusPreferences prevents key pollution when ambientSound is an Array or string primitive", async () => {
  const mockStorageArray = createMockStorage({
    [STORAGE_KEYS.PREFERENCES]: {
      focusDuration: 25,
      ambientSound: ["rain", 80],
    },
  });

  const prefsArray = await getFocusPreferences(mockStorageArray);
  assert.equal(Object.prototype.hasOwnProperty.call(prefsArray.ambientSound, "0"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(prefsArray.ambientSound, "1"), false);

  const mockStorageString = createMockStorage({
    [STORAGE_KEYS.PREFERENCES]: {
      focusDuration: 25,
      ambientSound: "rain_string",
    },
  });

  const prefsString = await getFocusPreferences(mockStorageString);
  assert.equal(Object.prototype.hasOwnProperty.call(prefsString.ambientSound, "0"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(prefsString.ambientSound, "1"), false);
});

test("appendFocusHistory rejects Array inputs without polluting history storage", async () => {
  const mockStorage = createMockStorage();
  const result = await appendFocusHistory(["invalid", "record"], mockStorage);
  assert.deepEqual(result, []);
  assert.deepEqual(await getFocusHistory(mockStorage), []);
});

test("getFocusTemplates filters out null and corrupted elements before returning templates to callers", async () => {
  const mockStorage = createMockStorage({
    [STORAGE_KEYS.TEMPLATES]: [null, undefined, "corrupted", { name: "no_id" }, { id: "valid_1", name: "Valid" }],
  });

  const templates = await getFocusTemplates(mockStorage);
  assert.equal(templates.length, 1);
  assert.equal(templates[0].id, "valid_1");
});


test("appendFocusHistory rolls pruned records into the daily summary", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-27T12:00:00Z") });
  const old = {
    id: "old",
    runtimeId: "old",
    status: FOCUS_STATES.FOCUS_COMPLETED,
    focusDurationMinutes: 25,
    completedAt: new Date("2026-03-01T10:00:00Z").getTime(),
    dateStr: "2026-03-01",
  };
  const mockStorage = createMockStorage({ [STORAGE_KEYS.HISTORY]: [old] });

  const history = await appendFocusHistory(
    {
      runtimeId: "new",
      status: FOCUS_STATES.FOCUS_COMPLETED,
      focusDurationMinutes: 50,
      completedAt: new Date("2026-07-27T10:00:00Z").getTime(),
    },
    mockStorage,
  );

  assert.deepEqual(history.map((r) => r.runtimeId), ["new"]);
  assert.deepEqual(await getFocusDailySummary(mockStorage), {
    "2026-03-01": { completedSessions: 1, focusMinutes: 25, abandonedSessions: 0 },
  });
});

test("getFocusDailySummary returns an empty object when uninitialized", async () => {
  assert.deepEqual(await getFocusDailySummary(createMockStorage()), {});
});

test("updateFocusPreferences stores a clamped daily goal", async () => {
  const mockStorage = createMockStorage();
  assert.equal((await getFocusPreferences(mockStorage)).dailyGoalMinutes, 100);
  const updated = await updateFocusPreferences({ dailyGoalMinutes: 5000 }, mockStorage);
  assert.equal(updated.dailyGoalMinutes, 600);
  const kept = await updateFocusPreferences({ focusDuration: 30 }, mockStorage);
  assert.equal(kept.dailyGoalMinutes, 600);
});
