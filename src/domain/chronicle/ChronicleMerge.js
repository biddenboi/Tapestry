export function mergeChronicleText({ base = '', current = '', proposed = '' } = {}) {
  if (proposed === current) return { status: 'unchanged', value: current };
  if (current === base) return { status: 'merged', value: proposed };
  if (proposed === base) return { status: 'merged', value: current };

  const baseLines = String(base).split('\n');
  const currentLines = String(current).split('\n');
  const proposedLines = String(proposed).split('\n');
  if (baseLines.length !== currentLines.length || baseLines.length !== proposedLines.length) {
    return { status: 'conflict', value: null };
  }
  const merged = [];
  for (let index = 0; index < baseLines.length; index += 1) {
    const original = baseLines[index];
    const accepted = currentLines[index];
    const incoming = proposedLines[index];
    if (accepted !== original && incoming !== original && accepted !== incoming) {
      return { status: 'conflict', value: null };
    }
    merged.push(incoming !== original ? incoming : accepted);
  }
  return { status: 'merged', value: merged.join('\n') };
}

