export function getAlarmAudioUrl() {
  return "pomodoro_alarm.m4a";
}

export function createOffscreenAudioController({
  AudioCtor = globalThis.Audio,
  setTimeoutFn = globalThis.setTimeout,
} = {}) {
  if (typeof AudioCtor !== "function") {
    throw new Error("Audio API is unavailable");
  }

  const ambientSounds = new Map();
  let alarmAudio = null;

  function clampVolume(volume, fallback = 0.5) {
    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : fallback;
  }

  function stopAudio(audio) {
    audio.pause();
    audio.currentTime = 0;
  }

  async function startAlarm(audioUrl, volume = 0.7) {
    if (!audioUrl) throw new Error("Alarm audio URL is required");

    if (alarmAudio) {
      stopAudio(alarmAudio);
    }

    alarmAudio = new AudioCtor(audioUrl);
    alarmAudio.loop = true;
    alarmAudio.volume = clampVolume(volume, 0.7);

    try {
      await alarmAudio.play();
    } catch (error) {
      alarmAudio = null;
      throw error;
    }
  }

  async function testAlarm(audioUrl, volume = 0.7) {
    if (!audioUrl) throw new Error("Alarm audio URL is required");

    const audio = new AudioCtor(audioUrl);
    audio.loop = false;
    audio.volume = clampVolume(volume, 0.7);

    try {
      await audio.play();
    } catch (error) {
      stopAudio(audio);
      throw error;
    }
  }

  function stopAlarm() {
    if (alarmAudio) {
      stopAudio(alarmAudio);
      alarmAudio = null;
    }
  }

  async function startAmbientSound(soundKey, audioUrl, volume) {
    if (!soundKey || !audioUrl) {
      throw new Error("Sound key and audio URL are required");
    }

    const existing = ambientSounds.get(soundKey);
    // Every service worker wake-up re-sends START for enabled sounds; keep a playing loop instead of restarting it.
    if (existing && !existing.paused) {
      existing.volume = clampVolume(volume);
      return;
    }
    if (existing) {
      stopAudio(existing);
    }

    const audio = new AudioCtor(audioUrl);
    audio.loop = true;
    audio.volume = clampVolume(volume);
    ambientSounds.set(soundKey, audio);

    try {
      await audio.play();
    } catch (error) {
      ambientSounds.delete(soundKey);
      stopAudio(audio);
      throw error;
    }
  }

  function stopAmbientSound(soundKey) {
    const audio = ambientSounds.get(soundKey);
    if (audio) {
      stopAudio(audio);
      ambientSounds.delete(soundKey);
    }
  }

  function updateAmbientVolume(soundKey, volume) {
    const audio = ambientSounds.get(soundKey);
    if (!audio) {
      throw new Error(`Ambient sound is not active: ${soundKey}`);
    }
    audio.volume = clampVolume(volume);
  }

  function stopAllAmbientSounds() {
    for (const audio of ambientSounds.values()) {
      stopAudio(audio);
    }
    ambientSounds.clear();
  }

  async function testAmbientSound(audioUrl, volume) {
    const audio = new AudioCtor(audioUrl);
    audio.loop = false;
    audio.volume = clampVolume(volume);
    await audio.play();
    setTimeoutFn(() => stopAudio(audio), 3000);
  }

  return {
    startAlarm,
    testAlarm,
    stopAlarm,
    startAmbientSound,
    stopAmbientSound,
    stopAllAmbientSounds,
    testAmbientSound,
    updateAmbientVolume,
  };
}

export function createOffscreenMessageHandler(controller) {
  return async function handleOffscreenMessage(message) {
    try {
      switch (message.type) {
        case "PING_OFFSCREEN":
          return { success: true, ready: true };
        case "START_ALARM":
          await controller.startAlarm(message.audioUrl, message.volume);
          return { success: true };
        case "TEST_ALARM":
          await controller.testAlarm(message.audioUrl, message.volume);
          return { success: true };
        case "STOP_ALARM":
          controller.stopAlarm();
          return { success: true };
        case "START_AMBIENT_SOUND":
          await controller.startAmbientSound(
            message.soundKey,
            message.audioUrl,
            message.volume,
          );
          return { success: true };
        case "STOP_AMBIENT_SOUND":
          controller.stopAmbientSound(message.soundKey);
          return { success: true };
        case "UPDATE_AMBIENT_VOLUME":
          controller.updateAmbientVolume(message.soundKey, message.volume);
          return { success: true };
        case "STOP_ALL_AMBIENT_SOUNDS":
          controller.stopAllAmbientSounds();
          return { success: true };
        case "TEST_AMBIENT_SOUND":
          await controller.testAmbientSound(message.audioUrl, message.volume);
          return { success: true };
        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
