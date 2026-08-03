import {
  CONTEXT_AUDIENCE,
  CONTEXT_SOURCE,
  CONTEXT_STATUS,
  PROFILE_CONTEXT_AUDIENCES,
  PROFILE_CONTEXT_ITEM_TYPES,
  PROFILE_CONTEXT_LIMITS,
  PROFILE_CONTEXT_SENSITIVITIES,
} from './Contracts.js';

const AUTOMATIC_INFERENCE_PATTERN = /\b(stress(?:ed)?|burnout|burned out|depress(?:ed|ion)?|anxious|anxiety|manic|lazy|unmotivated|avoidant|personality|mental health)\b/i;

function boundedText(value, maximum = PROFILE_CONTEXT_LIMITS.textLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

export function containsProhibitedAutomaticInference(value) {
  return AUTOMATIC_INFERENCE_PATTERN.test(String(value || ''));
}

export function validateProfileContextItem(raw = {}) {
  const type = String(raw.type || '');
  const source = raw.source === CONTEXT_SOURCE.derived ? CONTEXT_SOURCE.derived : CONTEXT_SOURCE.manual;
  const text = boundedText(raw.text);
  const audience = PROFILE_CONTEXT_AUDIENCES.includes(raw.audience)
    ? raw.audience
    : CONTEXT_AUDIENCE.private;
  const sensitivity = PROFILE_CONTEXT_SENSITIVITIES.includes(raw.sensitivity)
    ? raw.sensitivity
    : 'low';
  const status = Object.values(CONTEXT_STATUS).includes(raw.status)
    ? raw.status
    : CONTEXT_STATUS.active;
  const errors = [];
  if (!PROFILE_CONTEXT_ITEM_TYPES.includes(type)) errors.push('Unsupported context type.');
  if (!text) errors.push('Context text is required.');
  if (source === CONTEXT_SOURCE.derived && containsProhibitedAutomaticInference(text)) {
    errors.push('Automatic context cannot infer mental health, personality, or emotional state.');
  }
  if (audience === CONTEXT_AUDIENCE.selected
      && (!Array.isArray(raw.recipientIds) || raw.recipientIds.length === 0)) {
    errors.push('Selected sharing requires at least one recipient.');
  }
  return {
    ok: errors.length === 0,
    errors,
    value: {
      ...raw,
      type,
      text,
      detail: boundedText(raw.detail, PROFILE_CONTEXT_LIMITS.noteLength) || null,
      audience,
      sensitivity,
      source,
      status,
      recipientIds: [...new Set((raw.recipientIds || [])
        .map((value) => String(value || ''))
        .filter(Boolean))]
        .slice(0, PROFILE_CONTEXT_LIMITS.selectedRecipients),
      tentative: raw.tentative === true,
    },
  };
}

export function assertValidProfileContextItem(raw = {}) {
  const result = validateProfileContextItem(raw);
  if (!result.ok) {
    const error = new TypeError(result.errors.join(' '));
    error.code = 'invalid-profile-context';
    throw error;
  }
  return result.value;
}

