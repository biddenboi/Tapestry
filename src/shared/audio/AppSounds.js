const SOUND_STORAGE_KEY = 'tapestry.soundEffects.enabled';

let audioContext = null;
let masterGain = null;
let unlockInstalled = false;
const lastPlayedAt = new Map();

function hasBrowserAudio() {
  return typeof window !== 'undefined'
    && (window.AudioContext || window.webkitAudioContext);
}

export function areSoundEffectsEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setSoundEffectsEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Storage can be blocked in private windows; sounds can still run in memory.
  }
}

function getAudioContext() {
  if (!hasBrowserAudio()) return null;
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.42;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

function connectVoice(ctx, output = masterGain, filterType = null, filterFrequency = 12000) {
  const voice = ctx.createGain();
  if (filterType) {
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    voice.connect(filter);
    filter.connect(output);
  } else {
    voice.connect(output);
  }
  return voice;
}

function scheduleTone(ctx, {
  start,
  duration = 0.16,
  frequency = 440,
  endFrequency = null,
  gain = 0.18,
  type = 'sine',
  attack = 0.012,
  decay = 0.03,
  filterType = null,
  filterFrequency = 12000,
}) {
  const osc = ctx.createOscillator();
  const amp = connectVoice(ctx, masterGain, filterType, filterFrequency);
  const stopAt = start + duration;
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, frequency), start);
  if (endFrequency) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), stopAt);
  }
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(gain, start + attack);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.34), start + attack + decay);
  amp.gain.exponentialRampToValueAtTime(0.0001, stopAt);
  osc.connect(amp);
  osc.start(start);
  osc.stop(stopAt + 0.02);
}

function scheduleNoise(ctx, {
  start,
  duration = 0.12,
  gain = 0.12,
  filterType = 'highpass',
  filterFrequency = 1800,
}) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / length);
  }
  const source = ctx.createBufferSource();
  const amp = connectVoice(ctx, masterGain, filterType, filterFrequency);
  source.buffer = buffer;
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(amp);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function playPattern(ctx, soundName, volume, themeId) {
  const now = ctx.currentTime + 0.018;
  const pack = describeThemeSound(themeId, soundName);
  const gain = Math.max(0, Math.min(1.8, Number(volume || 1)));
  const tone = (options) => scheduleTone(ctx, {
    ...options,
    start: now + ((options.start ?? now) - now) * pack.time,
    duration: (options.duration ?? 0.16) * pack.time,
    frequency: (options.frequency ?? 440) * pack.pitch,
    endFrequency: options.endFrequency ? options.endFrequency * pack.pitch : null,
    type: options.type === 'sine' ? pack.secondaryWaveform : pack.waveform,
    filterFrequency: Math.min(options.filterFrequency ?? pack.filter, pack.filter),
    gain: (options.gain ?? 0.18) * gain * pack.gain,
  });
  const noise = (options) => scheduleNoise(ctx, {
    ...options,
    start: now + ((options.start ?? now) - now) * pack.time,
    duration: (options.duration ?? 0.12) * pack.time,
    filterFrequency: Math.min(options.filterFrequency ?? pack.filter, pack.filter),
    gain: (options.gain ?? 0.12) * gain * pack.noise,
  });

  switch (soundName) {
    case 'panel-open':
      tone({ start: now, frequency: 510, endFrequency: 720, duration: 0.07, gain: 0.10, type: 'triangle' });
      tone({ start: now + 0.055, frequency: 760, duration: 0.09, gain: 0.075, type: 'sine' });
      break;
    case 'panel-close':
      tone({ start: now, frequency: 420, endFrequency: 260, duration: 0.12, gain: 0.08, type: 'triangle' });
      break;
    case 'lobby-open':
      tone({ start: now, frequency: 294, duration: 0.09, gain: 0.07, type: 'triangle', filterType: 'bandpass', filterFrequency: 880 });
      tone({ start: now + 0.055, frequency: 587, duration: 0.10, gain: 0.07, type: 'square', filterType: 'bandpass', filterFrequency: 1600 });
      tone({ start: now + 0.12, frequency: 880, duration: 0.11, gain: 0.055, type: 'triangle', filterType: 'bandpass', filterFrequency: 2200 });
      break;
    case 'timer-start':
      tone({ start: now, frequency: 330, duration: 0.09, gain: 0.11, type: 'triangle' });
      tone({ start: now + 0.085, frequency: 495, duration: 0.12, gain: 0.10, type: 'triangle' });
      break;
    case 'add':
      tone({ start: now, frequency: 360, endFrequency: 540, duration: 0.08, gain: 0.085, type: 'triangle' });
      tone({ start: now + 0.058, frequency: 720, duration: 0.09, gain: 0.07, type: 'sine' });
      break;
    case 'upvote':
      tone({ start: now, frequency: 520, endFrequency: 1040, duration: 0.105, gain: 0.075, type: 'triangle' });
      tone({ start: now + 0.055, frequency: 1320, duration: 0.065, gain: 0.045, type: 'sine' });
      break;
    case 'downvote':
      tone({ start: now, frequency: 440, endFrequency: 220, duration: 0.12, gain: 0.065, type: 'triangle', filterType: 'lowpass', filterFrequency: 900 });
      break;
    case 'comment':
      tone({ start: now, frequency: 420, duration: 0.075, gain: 0.075, type: 'triangle' });
      tone({ start: now + 0.058, frequency: 560, duration: 0.075, gain: 0.055, type: 'triangle' });
      noise({ start: now + 0.02, duration: 0.055, gain: 0.018, filterType: 'bandpass', filterFrequency: 2600 });
      break;
    case 'task-complete':
      tone({ start: now, frequency: 392, duration: 0.13, gain: 0.13, type: 'triangle' });
      tone({ start: now + 0.075, frequency: 587, duration: 0.16, gain: 0.12, type: 'triangle' });
      tone({ start: now + 0.15, frequency: 784, duration: 0.20, gain: 0.10, type: 'sine' });
      noise({ start: now + 0.02, duration: 0.08, gain: 0.035 });
      break;
    case 'roll':
      [740, 880, 1040, 1320, 1760].forEach((frequency, index) => {
        tone({ start: now + index * 0.038, frequency, duration: 0.065, gain: 0.05, type: index % 2 ? 'square' : 'triangle', filterType: 'bandpass', filterFrequency: frequency * 1.8 });
      });
      noise({ start: now + 0.03, duration: 0.16, gain: 0.025, filterFrequency: 3600 });
      break;
    case 'coins':
      tone({ start: now, frequency: 1180, duration: 0.07, gain: 0.08, type: 'square', filterType: 'bandpass', filterFrequency: 2200 });
      tone({ start: now + 0.052, frequency: 1540, duration: 0.08, gain: 0.07, type: 'triangle', filterType: 'bandpass', filterFrequency: 2800 });
      noise({ start: now + 0.03, duration: 0.05, gain: 0.035, filterFrequency: 3400 });
      break;
    case 'contribution':
      tone({ start: now, frequency: 220, endFrequency: 330, duration: 0.16, gain: 0.10, type: 'sine' });
      tone({ start: now + 0.08, frequency: 440, duration: 0.18, gain: 0.085, type: 'triangle' });
      tone({ start: now + 0.17, frequency: 660, duration: 0.18, gain: 0.075, type: 'sine' });
      break;
    case 'achievement':
      [660, 880, 1180, 1760].forEach((frequency, index) => {
        tone({ start: now + index * 0.045, frequency, duration: 0.14, gain: 0.075, type: index % 2 ? 'triangle' : 'sine' });
      });
      noise({ start: now + 0.05, duration: 0.18, gain: 0.04, filterFrequency: 5200 });
      break;
    case 'purchase':
      tone({ start: now, frequency: 164, duration: 0.12, gain: 0.12, type: 'sine' });
      tone({ start: now + 0.055, frequency: 1320, duration: 0.07, gain: 0.08, type: 'square', filterType: 'bandpass', filterFrequency: 2600 });
      tone({ start: now + 0.12, frequency: 1760, duration: 0.09, gain: 0.065, type: 'triangle', filterType: 'bandpass', filterFrequency: 3400 });
      break;
    case 'matchmaking':
      tone({ start: now, frequency: 740, duration: 0.07, gain: 0.06, type: 'square', filterType: 'bandpass', filterFrequency: 1800 });
      tone({ start: now + 0.11, frequency: 988, duration: 0.07, gain: 0.055, type: 'square', filterType: 'bandpass', filterFrequency: 2400 });
      tone({ start: now + 0.22, frequency: 740, duration: 0.09, gain: 0.05, type: 'triangle', filterType: 'bandpass', filterFrequency: 1900 });
      break;
    case 'match-start':
      tone({ start: now, frequency: 392, duration: 0.08, gain: 0.08, type: 'square', filterType: 'bandpass', filterFrequency: 1200 });
      tone({ start: now + 0.07, frequency: 784, duration: 0.10, gain: 0.085, type: 'triangle', filterType: 'bandpass', filterFrequency: 2200 });
      tone({ start: now + 0.16, frequency: 1175, duration: 0.13, gain: 0.07, type: 'square', filterType: 'bandpass', filterFrequency: 3200 });
      noise({ start: now + 0.015, duration: 0.08, gain: 0.02, filterType: 'highpass', filterFrequency: 3000 });
      break;
    case 'match-event':
      tone({ start: now, frequency: 880, duration: 0.055, gain: 0.052, type: 'square', filterType: 'bandpass', filterFrequency: 2400 });
      tone({ start: now + 0.062, frequency: 1175, duration: 0.075, gain: 0.045, type: 'triangle', filterType: 'bandpass', filterFrequency: 3200 });
      break;
    case 'victory':
      [523, 659, 784, 1046].forEach((frequency, index) => {
        tone({ start: now + index * 0.075, frequency, duration: 0.18, gain: 0.10, type: 'triangle' });
      });
      tone({ start: now + 0.31, frequency: 1318, duration: 0.25, gain: 0.075, type: 'sine' });
      break;
    case 'defeat':
      tone({ start: now, frequency: 392, endFrequency: 196, duration: 0.34, gain: 0.12, type: 'triangle', filterType: 'lowpass', filterFrequency: 800 });
      tone({ start: now + 0.11, frequency: 247, endFrequency: 123, duration: 0.32, gain: 0.08, type: 'sine' });
      break;
    case 'warning':
      tone({ start: now, frequency: 220, duration: 0.13, gain: 0.10, type: 'sawtooth', filterType: 'lowpass', filterFrequency: 760 });
      tone({ start: now + 0.12, frequency: 196, duration: 0.14, gain: 0.09, type: 'sawtooth', filterType: 'lowpass', filterFrequency: 680 });
      break;
    case 'feed-post':
      tone({ start: now, frequency: 494, duration: 0.1, gain: 0.09, type: 'triangle' });
      tone({ start: now + 0.065, frequency: 740, duration: 0.14, gain: 0.08, type: 'sine' });
      break;
    case 'dojo-start':
      tone({ start: now, frequency: 146, endFrequency: 293, duration: 0.2, gain: 0.12, type: 'triangle' });
      tone({ start: now + 0.12, frequency: 439, duration: 0.18, gain: 0.08, type: 'sine' });
      break;
    case 'success':
      tone({ start: now, frequency: 520, duration: 0.08, gain: 0.08, type: 'triangle' });
      tone({ start: now + 0.07, frequency: 780, duration: 0.12, gain: 0.07, type: 'sine' });
      break;
    case 'theme-preview':
      pack.signature.forEach((frequency, index) => {
        tone({
          start: now + index * 0.055,
          frequency: frequency / pack.pitch,
          duration: index === pack.signature.length - 1 ? 0.18 : 0.09,
          gain: 0.075 - index * 0.006,
          type: index % 2 ? 'sine' : 'triangle',
        });
      });
      break;
    default:
      tone({ start: now, frequency: 640, duration: 0.09, gain: 0.06, type: 'sine' });
      break;
  }
}

export function playAppSound(soundName = 'notification', options = {}) {
  if (!areSoundEffectsEnabled() || !soundName) return false;
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return false;
  const nowMs = Date.now();
  const throttleMs = Number(options.throttleMs ?? 85);
  const last = lastPlayedAt.get(soundName) || 0;
  if (!options.force && nowMs - last < throttleMs) return false;
  lastPlayedAt.set(soundName, nowMs);
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  playPattern(ctx, soundName, options.volume ?? 1, options.themeId || getActiveThemeIdFromDocument());
  return true;
}

export function installSoundEffectUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return () => {};
  unlockInstalled = true;
  const unlock = () => {
    if (!areSoundEffectsEnabled()) return;
    const ctx = getAudioContext();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
  return () => {
    window.removeEventListener('pointerdown', unlock, { capture: true });
    window.removeEventListener('keydown', unlock, { capture: true });
    unlockInstalled = false;
  };
}

export function soundForRewardItems(items = [], options = {}) {
  const source = options.source || '';
  const kind = options.kind || '';
  const labels = (items || [])
    .map((item) => String(item?.label || item?.unit || item?.kind || '').toLowerCase())
    .join(' ');
  const kinds = new Set((items || []).map((item) => item?.kind).filter(Boolean));

  if (source === 'shop') return 'purchase';
  if (source === 'feed' || kind === 'post') return 'feed-post';
  if (source === 'task-results' || source === 'task-session' || source === 'quick-checklist') return 'task-complete';
  if (source === 'match-end') return null;
  if (labels.includes('reward roll') || labels.includes('bonus coins')) return 'roll';
  if (labels.includes('achievement')) return 'achievement';
  if (labels.includes('unlocked')) return 'achievement';
  if (kinds.has('achievement')) return 'achievement';
  if (kinds.has('event-penalty') || kind === 'error' || kind === 'warning') return 'warning';
  if (kinds.has('contribution')) return 'contribution';
  if (kinds.has('coins')) return 'coins';
  if (kinds.has('points')) return 'task-complete';
  if (kind === 'success') return 'success';
  return 'notification';
}
import {
  describeThemeSound,
  getActiveThemeIdFromDocument,
} from './ThemeSoundPacks.js';
