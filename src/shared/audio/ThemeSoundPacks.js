import { DEFAULT_THEME_ID, resolveThemeId, THEME_IDS } from '../../domain/themes/ThemeRegistry.js';

export const SOUND_CUES = Object.freeze([
  'panel-open', 'panel-close', 'lobby-open', 'timer-start', 'add', 'upvote', 'downvote',
  'comment', 'task-complete', 'roll', 'coins', 'contribution', 'achievement', 'purchase',
  'matchmaking', 'match-start', 'match-event', 'victory', 'defeat', 'warning', 'feed-post',
  'dojo-start', 'success', 'notification', 'theme-preview',
]);

const pack = (definition) => Object.freeze(definition);

export const THEME_SOUND_PACKS = Object.freeze({
  minimalist: pack({ waveform: 'triangle', secondaryWaveform: 'sine', pitch: 0.96, time: 0.74, gain: 0.72, noise: 0.44, filter: 5200, signature: [330, 494, 659] }),
  obsidian: pack({ waveform: 'sine', secondaryWaveform: 'triangle', pitch: 0.72, time: 1.18, gain: 0.78, noise: 0.22, filter: 2100, signature: [196, 294, 440] }),
  old_windows: pack({ waveform: 'square', secondaryWaveform: 'square', pitch: 1.08, time: 0.62, gain: 0.62, noise: 0.08, filter: 2700, signature: [523, 659, 784] }),
  kawaii: pack({ waveform: 'sine', secondaryWaveform: 'triangle', pitch: 1.42, time: 0.82, gain: 0.68, noise: 0.16, filter: 6400, signature: [784, 1046, 1318] }),
  gamification: pack({ waveform: 'sawtooth', secondaryWaveform: 'triangle', pitch: 0.88, time: 1.12, gain: 0.82, noise: 0.56, filter: 3300, signature: [262, 392, 523, 784] }),
  pixelated: pack({ waveform: 'square', secondaryWaveform: 'square', pitch: 1.26, time: 0.48, gain: 0.58, noise: 0.02, filter: 3900, signature: [659, 988, 1318] }),
  dreamcore: pack({ waveform: 'sine', secondaryWaveform: 'sine', pitch: 1.12, time: 1.72, gain: 0.50, noise: 0.12, filter: 4800, signature: [440, 659, 932, 1318] }),
  minimalist_light: pack({ waveform: 'triangle', secondaryWaveform: 'sine', pitch: 1.16, time: 0.68, gain: 0.58, noise: 0.22, filter: 7200, signature: [587, 880, 1175] }),
  mature_beige: pack({ waveform: 'triangle', secondaryWaveform: 'sine', pitch: 0.82, time: 1.04, gain: 0.62, noise: 0.30, filter: 2600, signature: [247, 370, 554] }),
  solarpunk: pack({ waveform: 'sine', secondaryWaveform: 'triangle', pitch: 1.04, time: 1.08, gain: 0.62, noise: 0.18, filter: 5600, signature: [392, 587, 784] }),
  frutiger_aero: pack({ waveform: 'sine', secondaryWaveform: 'sine', pitch: 1.24, time: 0.92, gain: 0.60, noise: 0.10, filter: 6800, signature: [523, 784, 1046] }),
  blueprint: pack({ waveform: 'square', secondaryWaveform: 'triangle', pitch: 0.94, time: 0.68, gain: 0.58, noise: 0.05, filter: 4400, signature: [294, 440, 659] }),
  editorial_noir: pack({ waveform: 'triangle', secondaryWaveform: 'sawtooth', pitch: 0.78, time: 1.22, gain: 0.68, noise: 0.32, filter: 2400, signature: [220, 330, 494] }),
  northstar: pack({ waveform: 'sine', secondaryWaveform: 'triangle', pitch: 1.08, time: 1.36, gain: 0.60, noise: 0.08, filter: 6100, signature: [330, 554, 831, 1109] }),
  atelier: pack({ waveform: 'triangle', secondaryWaveform: 'sine', pitch: 0.86, time: 0.96, gain: 0.66, noise: 0.24, filter: 3200, signature: [262, 349, 523, 698] }),
  memory_palace: pack({ waveform: 'sine', secondaryWaveform: 'sine', pitch: 0.92, time: 1.84, gain: 0.54, noise: 0.10, filter: 4100, signature: [247, 415, 622, 932] }),
  commons: pack({ waveform: 'triangle', secondaryWaveform: 'sawtooth', pitch: 1.14, time: 1.02, gain: 0.64, noise: 0.14, filter: 5700, signature: [349, 523, 698, 1047] }),
});

export function getActiveThemeIdFromDocument() {
  if (typeof document === 'undefined') return DEFAULT_THEME_ID;
  return resolveThemeId(document.documentElement?.getAttribute('data-theme'));
}

export function getThemeSoundPack(themeId) {
  return THEME_SOUND_PACKS[resolveThemeId(themeId)] || THEME_SOUND_PACKS[DEFAULT_THEME_ID];
}

export function describeThemeSound(themeId, cue = 'notification') {
  const resolvedTheme = resolveThemeId(themeId);
  const resolvedCue = SOUND_CUES.includes(cue) ? cue : 'notification';
  const definition = getThemeSoundPack(resolvedTheme);
  return Object.freeze({
    themeId: resolvedTheme,
    cue: resolvedCue,
    ...definition,
    fingerprint: `${resolvedTheme}:${resolvedCue}:${definition.waveform}:${definition.pitch}:${definition.time}:${definition.signature.join('-')}`,
  });
}

export function validateThemeSoundPacks() {
  return THEME_IDS.every((id) => {
    const definition = THEME_SOUND_PACKS[id];
    return definition
      && definition.signature.length >= 3
      && definition.gain > 0 && definition.gain <= 1
      && definition.time > 0 && definition.time <= 2;
  });
}
