import test from "node:test";
import assert from "node:assert/strict";

import {
  createOffscreenAudioController,
  createOffscreenMessageHandler,
  getAlarmAudioUrl,
} from "../src/core/audio.js";

class FakeAudio {
  static failNextPlay = false;
  static played = [];

  constructor(url = "") {
    this.src = url;
    this.currentTime = 0;
    this.volume = 1;
    this.loop = false;
    this.paused = true;
    this.onended = null;
    this.onerror = null;
  }

  async play() {
    if (FakeAudio.failNextPlay) {
      FakeAudio.failNextPlay = false;
      throw new Error("playback blocked");
    }

    this.paused = false;
    FakeAudio.played.push(this.src);
    if (!this.loop) {
      queueMicrotask(() => this.onended?.());
    }
  }

  pause() {
    this.paused = true;
  }
}

test("getAlarmAudioUrl returns alarm audio file", () => {
  assert.equal(getAlarmAudioUrl(), "pomodoro_alarm.m4a");
});

test("offscreen handler handles START_ALARM and loops it", async () => {
  FakeAudio.played = [];
  const controller = createOffscreenAudioController({ AudioCtor: FakeAudio });
  const handleMessage = createOffscreenMessageHandler(controller);

  const response = await handleMessage({
    type: "START_ALARM",
    audioUrl: "alarm.m4a",
    target: "offscreen",
  });

  assert.deepEqual(response, { success: true });
  assert.deepEqual(FakeAudio.played, ["alarm.m4a"]);
});

test("offscreen handler plays test alarms once without looping", async () => {
  FakeAudio.played = [];
  const controller = createOffscreenAudioController({ AudioCtor: FakeAudio });
  const handleMessage = createOffscreenMessageHandler(controller);

  const response = await handleMessage({
    type: "TEST_ALARM",
    audioUrl: "alarm.m4a",
    target: "offscreen",
  });

  assert.deepEqual(response, { success: true });
  assert.deepEqual(FakeAudio.played, ["alarm.m4a"]);
});

test("offscreen handler reports playback failures instead of fake success", async () => {
  FakeAudio.failNextPlay = true;
  const controller = createOffscreenAudioController({ AudioCtor: FakeAudio });
  const handleMessage = createOffscreenMessageHandler(controller);

  const response = await handleMessage({
    type: "START_AMBIENT_SOUND",
    soundKey: "rain",
    audioUrl: "rain.m4a",
    volume: 0.5,
    target: "offscreen",
  });

  assert.equal(response.success, false);
  assert.match(response.error, /playback blocked/);
});

test("re-starting an already playing ambient sound does not restart it", async () => {
  FakeAudio.played = [];
  const controller = createOffscreenAudioController({ AudioCtor: FakeAudio });

  await controller.startAmbientSound("rain", "rain.m4a", 0.5);
  await controller.startAmbientSound("rain", "rain.m4a", 0.2);
  assert.deepEqual(FakeAudio.played, ["rain.m4a"]);

  controller.stopAmbientSound("rain");
  await controller.startAmbientSound("rain", "rain.m4a", 0.5);
  assert.deepEqual(FakeAudio.played, ["rain.m4a", "rain.m4a"]);
});

test("offscreen handler rejects unknown messages", async () => {
  const controller = createOffscreenAudioController({ AudioCtor: FakeAudio });
  const handleMessage = createOffscreenMessageHandler(controller);
  const response = await handleMessage({
    type: "UNKNOWN",
    target: "offscreen",
  });

  assert.equal(response.success, false);
  assert.match(response.error, /Unknown message type/);
});
