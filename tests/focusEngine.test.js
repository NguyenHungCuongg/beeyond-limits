import test from "node:test";
import assert from "node:assert/strict";

let serialTail = Promise.resolve();

const serialTest = (name, fn) =>
  test(name, async (...args) => {
    const previous = serialTail;
    let release;
    serialTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn(...args);
    } finally {
      release();
    }
  });

function createMockChrome(initialStorage = {}) {
  const storageState = { ...initialStorage };
  const alarmsCreated = [];
  const alarmsCleared = [];
  const notificationsCreated = [];
  const notificationButtonListeners = [];
  const notificationClickListeners = [];
  const notificationsCleared = [];
  const badgeTexts = [];
  const tabsCreated = [];
  const popupsOpened = [];
  const broadcastMessages = [];
  const messageListeners = [];
  const alarmListeners = [];
  const startupListeners = [];
  const installedListeners = [];
  const dynamicRules = [];

  const chromeMock = {
    alarms: {
      onAlarm: {
        addListener(listener) {
          alarmListeners.push(listener);
        },
      },
      async create(name, alarmInfo) {
        alarmsCreated.push({ name, alarmInfo });
      },
      async clear(name) {
        alarmsCleared.push(name);
        return true;
      },
    },
    declarativeNetRequest: {
      async getDynamicRules() {
        return [...dynamicRules];
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        for (const ruleId of removeRuleIds) {
          const index = dynamicRules.findIndex((rule) => rule.id === ruleId);
          if (index >= 0) dynamicRules.splice(index, 1);
        }
        dynamicRules.push(...addRules);
      },
    },
    notifications: {
      onButtonClicked: {
        addListener(listener) {
          notificationButtonListeners.push(listener);
        },
      },
      onClicked: {
        addListener(listener) {
          notificationClickListeners.push(listener);
        },
      },
      async create(...args) {
        notificationsCreated.push(args.at(-1));
        return "notification_id";
      },
      async clear(id) {
        notificationsCleared.push(id);
        return true;
      },
    },
    offscreen: {
      async createDocument() {},
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      async getContexts() {
        return [];
      },
      async sendMessage(msg) {
        broadcastMessages.push(msg);
        if (msg.target === "offscreen") {
          return { success: true, ready: true };
        }
        return { success: true };
      },
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        },
      },
      onStartup: {
        addListener(listener) {
          startupListeners.push(listener);
        },
      },
      onInstalled: {
        addListener(listener) {
          installedListeners.push(listener);
        },
      },
    },
    action: {
      async setBadgeText({ text }) {
        badgeTexts.push(text);
      },
      async openPopup() {
        popupsOpened.push(true);
      },
    },
    tabs: {
      async create(details) {
        tabsCreated.push(details);
        return { id: tabsCreated.length };
      },
    },
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys
                .filter((key) => key in storageState)
                .map((key) => [key, storageState[key]]),
            );
          }
          if (typeof keys === "string") {
            return keys in storageState ? { [keys]: storageState[keys] } : {};
          }
          return { ...storageState };
        },
        async set(values) {
          Object.assign(storageState, values);
        },
        async remove(keys) {
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            delete storageState[k];
          }
        },
      },
    },
  };

  return {
    chromeMock,
    storageState,
    alarmsCreated,
    alarmsCleared,
    notificationsCreated,
    notificationButtonListeners,
    notificationClickListeners,
    notificationsCleared,
    badgeTexts,
    tabsCreated,
    popupsOpened,
    broadcastMessages,
    messageListeners,
    alarmListeners,
    startupListeners,
    installedListeners,
    dynamicRules,
  };
}

serialTest(
  "SW Startup & Hydration: re-registers active alarm if phase ends in future",
  async () => {
    const futureTime = Date.now() + 600000;
    const initialSession = {
      id: "session_test_1",
      schemaVersion: 1,
      phase: "focus",
      status: "active_focus",
      startedAt: Date.now() - 300000,
      phaseStartedAt: Date.now() - 300000,
      phaseEndsAt: futureTime,
      durationSeconds: 900,
      remainingSeconds: 600,
      completedAt: null,
      abandonedAt: null,
      abandonReason: null,
      snapshot: { focusDuration: 15, breakDuration: 3 },
    };

    const mock = createMockChrome({
      activeFocusSession: initialSession,
    });

    globalThis.chrome = mock.chromeMock;

    const bg = await import(`../src/background.js?test_startup1=${Date.now()}`);
    await bg.focusManager.ready;

    assert.equal(mock.alarmsCreated.length, 1);
    assert.equal(mock.alarmsCreated[0].name, "focusSessionTimer");
    assert.equal(mock.alarmsCreated[0].alarmInfo.when, futureTime);

    delete globalThis.chrome;
  },
);

serialTest(
  "SW Startup keeps the session blocklist after focus completion",
  async () => {
    const initialSession = {
      id: "session_focus_complete",
      schemaVersion: 1,
      phase: "focus",
      status: "focus_completed",
      startedAt: Date.now() - 1500000,
      phaseStartedAt: Date.now() - 1500000,
      phaseEndsAt: null,
      durationSeconds: 1500,
      remainingSeconds: 0,
      completedAt: Date.now(),
      snapshot: {
        focusDuration: 25,
        breakDuration: 5,
        blocker: {
          enabled: true,
          blockedUrls: [{ id: "youtube", url: "youtube.com" }],
        },
      },
    };
    const mock = createMockChrome({
      activeFocusSession: initialSession,
      isBlocking: true,
      blockedUrls: [{ id: "facebook", url: "facebook.com" }],
    });
    globalThis.chrome = mock.chromeMock;

    const bg = await import(
      `../src/background.js?test_focus_complete=${Date.now()}`
    );
    await bg.focusManager.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(mock.dynamicRules.length, 1);
    assert.deepEqual(mock.dynamicRules[0].condition.requestDomains, [
      "youtube.com",
    ]);

    delete globalThis.chrome;
  },
);

serialTest(
  "SW Startup & Hydration: catches up expired alarm if phase ends in past",
  async () => {
    const pastTime = Date.now() - 5000;
    const initialSession = {
      id: "session_test_expired",
      schemaVersion: 1,
      phase: "focus",
      status: "active_focus",
      startedAt: pastTime - 1500000,
      phaseStartedAt: pastTime - 1500000,
      phaseEndsAt: pastTime,
      durationSeconds: 1500,
      remainingSeconds: 0,
      completedAt: null,
      abandonedAt: null,
      abandonReason: null,
      snapshot: { focusDuration: 25, breakDuration: 5 },
    };

    const mock = createMockChrome({
      activeFocusSession: initialSession,
    });

    globalThis.chrome = mock.chromeMock;

    const bg = await import(`../src/background.js?test_startup2=${Date.now()}`);
    await bg.focusManager.ready;

    const history = mock.storageState.focusSessionHistory || [];
    assert.equal(history.length, 1);
    assert.equal(history[0].runtimeId, "session_test_expired");
    assert.equal(history[0].status, "focus_completed");
    assert.equal(mock.notificationsCreated.length, 0);

    delete globalThis.chrome;
  },
);

serialTest(
  "Focus Session applies every enabled sound in its ambient mix",
  async () => {
    const mock = createMockChrome();
    globalThis.chrome = mock.chromeMock;
    const bg = await import(
      `../src/background.js?test_ambient_mix=${Date.now()}`
    );
    mock.chromeMock.runtime.getContexts = async () => [];
    mock.chromeMock.offscreen = {
      async createDocument() {},
    };
    const calls = [];
    const ambientManager = {
      async stopAllSounds() {
        calls.push({ type: "stop" });
      },
      async updateSettings(settings) {
        calls.push({ type: "update", settings });
      },
    };
    const offscreenBridge = {
      send: async () => {},
    };
    const manager = new bg.FocusSessionManager(mock.chromeMock, ambientManager, offscreenBridge);

    await manager.startSession({
      config: {
        ambientSound: {
          enabled: true,
          sounds: {
            bird: { enabled: true, volume: 35 },
            ocean_waves: { enabled: true, volume: 65 },
            rain: { enabled: true, volume: 70 },
            thunder: { enabled: true, volume: 20 },
          },
        },
      },
    });

    const mixUpdate = calls.find((call) => call.type === "update");
    assert.deepEqual(mixUpdate.settings.bird, {
      enabled: true,
      volume: 35,
    });
    assert.deepEqual(mixUpdate.settings.ocean_waves, {
      enabled: true,
      volume: 65,
    });
    assert.deepEqual(mixUpdate.settings.rain, { enabled: true, volume: 70 });
    assert.deepEqual(mixUpdate.settings.thunder, {
      enabled: true,
      volume: 20,
    });
    assert.deepEqual(mixUpdate.settings.campfire, {
      enabled: false,
      volume: 50,
    });

    delete globalThis.chrome;
  },
);

serialTest(
  "Focus Session stops its alarm through the shared offscreen bridge",
  async () => {
    const mock = createMockChrome();
    globalThis.chrome = mock.chromeMock;
    const bg = await import(
      `../src/background.js?test_focus_stop_alarm=${Date.now()}`
    );
    const messages = [];
    const manager = new bg.FocusSessionManager(
      mock.chromeMock,
      { stopAllSounds: async () => {} },
      {
        async send(message) {
          messages.push(message);
          return { success: true };
        },
      },
    );

    const response = await manager.stopAlarm();

    assert.deepEqual(response, { success: true });
    assert.deepEqual(messages, [{ type: "STOP_ALARM" }]);

    delete globalThis.chrome;
  },
);

serialTest(
  "Focus phase completion waits for alarm startup before a mute can run",
  async () => {
    const mock = createMockChrome();
    globalThis.chrome = mock.chromeMock;
    const bg = await import(
      `../src/background.js?test_focus_alarm_order=${Date.now()}`
    );
    let releaseAlarm;
    const alarmStarted = new Promise((resolve) => {
      releaseAlarm = resolve;
    });
    const offscreenBridge = {
      async send(message) {
        if (message.type === "START_ALARM") {
          return alarmStarted;
        }
        return { success: true };
      },
    };
    const manager = new bg.FocusSessionManager(
      mock.chromeMock,
      {
        stopAllSounds: async () => {},
        updateSettings: async () => {},
      },
      offscreenBridge,
    );
    await manager.startSession({
      config: {
        focusDuration: 25,
        ambientSound: { enabled: false },
      },
    });

    let completionSettled = false;
    const completion = manager.completeCurrentPhase().then(() => {
      completionSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(completionSettled, false);

    releaseAlarm({ success: true });
    await completion;
    delete globalThis.chrome;
  },
);

serialTest("Pomodoro cannot start while a Focus Session exists", async () => {
  const mock = createMockChrome({
    activeFocusSession: {
      id: "session_locks_pomodoro",
      schemaVersion: 1,
      phase: "focus",
      status: "active_focus",
      startedAt: Date.now(),
      phaseStartedAt: Date.now(),
      phaseEndsAt: Date.now() + 600000,
      durationSeconds: 600,
      remainingSeconds: 600,
      snapshot: { focusDuration: 10, breakDuration: 2 },
    },
  });
  globalThis.chrome = mock.chromeMock;

  await import(`../src/background.js?test_pomodoro_lock=${Date.now()}`);
  const listener = mock.messageListeners[0];
  const response = await new Promise((resolve) => {
    const keepAlive = listener({ type: "POMODORO_START" }, {}, resolve);
    assert.equal(keepAlive, true);
  });

  assert.equal(response.success, false);
  assert.match(response.error, /Focus Session/i);
  assert.equal(
    mock.alarmsCreated.some(
      ({ name, alarmName }) => (name ?? alarmName) === "pomodoroTimer",
    ),
    false,
  );

  delete globalThis.chrome;
});

serialTest(
  "Message Handlers: handles FOCUS_GET_STATE, FOCUS_START_SESSION, FOCUS_PAUSE_SESSION, FOCUS_RESUME_SESSION, FOCUS_ABANDON_SESSION, FOCUS_START_BREAK, FOCUS_SKIP_BREAK, FOCUS_UPDATE_PREFERENCES",
  async () => {
    const mock = createMockChrome();
    globalThis.chrome = mock.chromeMock;

    await import(`../src/background.js?test_msg=${Date.now()}`);
    assert.equal(mock.messageListeners.length, 1);
    const listener = mock.messageListeners[0];

    const dispatch = (message) =>
      new Promise((resolve) => {
        const keepAlive = listener(message, {}, resolve);
        assert.equal(keepAlive, true);
      });

    // 1. FOCUS_GET_STATE
    const stateRes = await dispatch({ type: "FOCUS_GET_STATE" });
    assert.equal(stateRes.success, true);
    assert.equal(stateRes.activeSession, null);
    assert.ok(Array.isArray(stateRes.templates));
    assert.ok(Array.isArray(stateRes.history));

    // 2. FOCUS_START_SESSION
    const startRes = await dispatch({
      type: "FOCUS_START_SESSION",
      focusDuration: 25,
      breakDuration: 5,
      goal: { type: "text", text: "Write unit tests" },
      blocker: {
        enabled: true,
        blockedUrls: [{ id: "youtube", url: "youtube.com" }],
      },
    });
    assert.equal(startRes.success, true);
    assert.ok(startRes.activeSession);
    assert.equal(startRes.activeSession.status, "active_focus");
    assert.deepEqual(mock.dynamicRules[0].condition.requestDomains, [
      "youtube.com",
    ]);
    const runtimeId = startRes.activeSession.id;

    // 3. FOCUS_PAUSE_SESSION
    const pauseRes = await dispatch({
      type: "FOCUS_PAUSE_SESSION",
      runtimeId,
    });
    assert.equal(pauseRes.success, true);
    assert.equal(pauseRes.activeSession.status, "paused_focus");
    assert.ok(mock.alarmsCleared.includes("focusSessionTimer"));

    // 4. FOCUS_RESUME_SESSION
    const resumeRes = await dispatch({
      type: "FOCUS_RESUME_SESSION",
      runtimeId,
    });
    assert.equal(resumeRes.success, true);
    assert.equal(resumeRes.activeSession.status, "active_focus");

    // 5. FOCUS_ABANDON_SESSION
    const abandonRes = await dispatch({
      type: "FOCUS_ABANDON_SESSION",
      runtimeId,
      reason: "interrupted",
    });
    assert.equal(abandonRes.success, true);
    assert.equal(abandonRes.activeSession, null);
    const abandonHistory = mock.storageState.focusSessionHistory;
    assert.equal(abandonHistory.length, 1);
    assert.equal(abandonHistory[0].runtimeId, runtimeId);
    assert.equal(abandonHistory[0].status, "abandoned");

    // Start new session for Break testing
    const start2Res = await dispatch({
      type: "FOCUS_START_SESSION",
      focusDuration: 15,
    });
    const runtimeId2 = start2Res.activeSession.id;

    // Complete session via alarm
    mock.alarmListeners[0]({ name: "focusSessionTimer" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 6. FOCUS_START_BREAK
    const breakRes = await dispatch({
      type: "FOCUS_START_BREAK",
      runtimeId: runtimeId2,
      durationMinutes: 5,
    });
    assert.equal(breakRes.success, true);
    assert.equal(breakRes.activeSession.status, "active_break");

    // 7. FOCUS_SKIP_BREAK
    const skipRes = await dispatch({
      type: "FOCUS_SKIP_BREAK",
      runtimeId: runtimeId2,
    });
    assert.equal(skipRes.success, true);
    assert.equal(skipRes.activeSession, null);

    // 8. FOCUS_UPDATE_PREFERENCES
    const prefRes = await dispatch({
      type: "FOCUS_UPDATE_PREFERENCES",
      preferences: { focusDuration: 30, breakDuration: 10 },
    });
    assert.equal(prefRes.success, true);
    assert.equal(prefRes.preferences.focusDuration, 30);
    assert.equal(prefRes.preferences.breakDuration, 10);

    const templateRes = await Promise.race([
      dispatch({
        type: "FOCUS_SESSION_TEMPLATE_UPDATE",
        template: {
          id: "template_quick_25",
          name: "Pomodoro 25",
          focusDuration: 25,
          breakDuration: 5,
          blocker: {
            enabled: true,
            blockedUrls: [{ id: "youtube", url: "youtube.com" }],
          },
        },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Template update did not receive a response")),
          50,
        ),
      ),
    ]);
    assert.equal(templateRes.success, true);
    assert.deepEqual(
      templateRes.template.blocker.blockedUrls.map(({ id, url }) => ({
        id,
        url,
      })),
      [{ id: "youtube", url: "youtube.com" }],
    );

    delete globalThis.chrome;
  },
);

serialTest(
  "Alarm Triggers & Single-Flight Completion: opens alarm popup and is idempotent",
  async () => {
    const session = {
      id: "session_alarm_test",
      schemaVersion: 1,
      phase: "focus",
      status: "active_focus",
      startedAt: Date.now() - 1500000,
      phaseStartedAt: Date.now() - 1500000,
      phaseEndsAt: Date.now() - 100,
      durationSeconds: 1500,
      remainingSeconds: 0,
      completedAt: null,
      abandonedAt: null,
      abandonReason: null,
      snapshot: { focusDuration: 25, breakDuration: 5 },
    };

    const mock = createMockChrome({
      activeFocusSession: session,
    });

    globalThis.chrome = mock.chromeMock;

    const bg = await import(`../src/background.js?test_alarm=${Date.now()}`);
    await bg.focusManager.ready;

    // Trigger completion twice simultaneously
    const p1 = bg.focusManager.completeCurrentPhase();
    const p2 = bg.focusManager.completeCurrentPhase();
    const [res1, res2] = await Promise.all([p1, p2]);

    assert.equal(res1, res2);
    assert.equal(res1.success, true);
    assert.equal(res1.activeSession.status, "focus_completed");

    const history = mock.storageState.focusSessionHistory || [];
    assert.equal(history.length, 1);
    assert.equal(history[0].runtimeId, "session_alarm_test");
    assert.equal(mock.storageState.focusPendingAlarm.sessionId, session.id);
    assert.equal(mock.notificationsCreated.length, 0);
    assert.ok(mock.popupsOpened.length >= 1);
    assert.equal(mock.badgeTexts.at(-1), "!");


    // Attempting another completion after promise resolved should be idempotent via isDuplicateCompletion
    await bg.focusManager.completeCurrentPhase();
    const historyAfter = mock.storageState.focusSessionHistory || [];
    assert.equal(historyAfter.length, 1);

    delete globalThis.chrome;
  },
);

serialTest(
  "Focus Session repeats work after break and records every work cycle",
  async () => {
    const mock = createMockChrome();
    globalThis.chrome = mock.chromeMock;
    const bg = await import(
      `../src/background.js?test_continuous_cycles=${Date.now()}`
    );
    await bg.focusManager.ready;

    const started = await bg.focusManager.startSession({
      config: {
        focusDuration: 5,
        breakDuration: 1,
        blocker: {
          enabled: true,
          blockedUrls: [{ id: "youtube", url: "youtube.com" }],
        },
        ambientSound: { enabled: false },
      },
    });
    const runtimeId = started.activeSession.id;

    await bg.focusManager.completeCurrentPhase();
    await bg.focusManager.startBreak({ runtimeId });
    await bg.focusManager.completeCurrentPhase();

    const nextCycle = await bg.focusManager.startNextCycle({ runtimeId });

    assert.equal(nextCycle.success, true);
    assert.equal(nextCycle.activeSession.id, runtimeId);
    assert.equal(nextCycle.activeSession.cycleNumber, 2);
    assert.equal(nextCycle.activeSession.status, "active_focus");
    assert.deepEqual(mock.dynamicRules[0].condition.requestDomains, [
      "youtube.com",
    ]);

    await bg.focusManager.completeCurrentPhase();

    const history = mock.storageState.focusSessionHistory;
    assert.equal(history.length, 2);
    assert.equal(new Set(history.map((record) => record.runtimeId)).size, 2);
    const cycleNumbers = history.map((record) => record.cycleNumber).sort();
    assert.deepEqual(cycleNumbers, [1, 2]);

    delete globalThis.chrome;
  },
);

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function sendToBackground(mock, message) {
  return new Promise((resolve) => mock.messageListeners[0](message, {}, resolve));
}

function runningSession(overrides = {}) {
  return {
    id: "session_running",
    schemaVersion: 1,
    phase: "focus",
    status: "active_focus",
    startedAt: Date.now(),
    phaseStartedAt: Date.now(),
    phaseEndsAt: Date.now() + 600000,
    durationSeconds: 600,
    remainingSeconds: 600,
    snapshot: {
      focusDuration: 10,
      breakDuration: 2,
      blocker: { enabled: true, blockedUrls: [{ id: "reddit.com", url: "reddit.com" }] },
    },
    ...overrides,
  };
}

const blockedDomains = (mock) =>
  mock.dynamicRules.flatMap((rule) => rule.condition.requestDomains);

serialTest("Pomodoro phase completion plays a one-shot chime, not the looping alarm", async () => {
  const mock = createMockChrome({
    pomodoroState: {
      isActive: true,
      isBreak: false,
      currentTime: 0,
      initialTime: 1500,
      phaseEndsAt: Date.now() - 1000,
      sessionCount: 0,
    },
  });
  globalThis.chrome = mock.chromeMock;
  await import(`../src/background.js?test_pomodoro_chime=${Date.now()}`);
  await settle();

  const alarmMessages = mock.broadcastMessages
    .filter((m) => m.target === "offscreen" && m.type.endsWith("_ALARM"))
    .map((m) => m.type);
  assert.deepEqual(alarmMessages, ["TEST_ALARM"]);

  delete globalThis.chrome;
});

serialTest("Website Blocker edits during a Focus Session apply only after it ends", async () => {
  const mock = createMockChrome({ activeFocusSession: runningSession() });
  globalThis.chrome = mock.chromeMock;
  const bg = await import(`../src/background.js?test_blocker_owner=${Date.now()}`);
  await settle();
  assert.deepEqual(blockedDomains(mock), ["reddit.com"]);

  const response = await sendToBackground(mock, {
    type: "UPDATE_BLOCKING_RULES",
    isBlocking: true,
    blockedUrls: [{ id: 1, url: "youtube.com" }],
  });
  assert.equal(response.success, true);
  assert.equal(mock.storageState.blockedUrls[0].url, "youtube.com");
  assert.deepEqual(blockedDomains(mock), ["reddit.com"]);

  await bg.focusManager.abandonSession();
  assert.deepEqual(blockedDomains(mock), ["youtube.com"]);

  delete globalThis.chrome;
});

serialTest("Starting a Focus Session while one is running is refused", async () => {
  const mock = createMockChrome({ activeFocusSession: runningSession() });
  globalThis.chrome = mock.chromeMock;
  const bg = await import(`../src/background.js?test_single_session=${Date.now()}`);

  const response = await bg.focusManager.startSession({ config: { focusDuration: 25 } });

  assert.equal(response.success, false);
  assert.equal(mock.storageState.activeFocusSession.id, "session_running");

  delete globalThis.chrome;
});

serialTest("Browser restart during a break keeps sites unblocked, like a live break", async () => {
  const mock = createMockChrome({
    activeFocusSession: runningSession({ phase: "break", status: "active_break" }),
    isBlocking: true,
    blockedUrls: [{ id: 1, url: "youtube.com" }],
  });
  globalThis.chrome = mock.chromeMock;
  await import(`../src/background.js?test_break_startup=${Date.now()}`);
  await settle();

  assert.deepEqual(blockedDomains(mock), []);

  delete globalThis.chrome;
});
