export function slug(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '') || 'item';
}
const notePath = (item, release) => `docs/releases/v${release}/${slug(item.text)}.md`;
export function buildDesignPrompt(item, release) {
  return `Read AGENTS.md first. Design only; no code.\nKind: ${item.kind}\nItem: ${item.text}\nWhy: ${item.why}\nReplaces or deletes: ${item.replaces || '(none)'}\nWrite ${notePath(item, release)} using docs/releases/TEMPLATE.md. Include Estimate (minutes): ${item.estimateMinutes ?? '(whole minutes needed)'}. `;
}
export function buildBuildPrompt(window) {
  const notes = window.items.filter((item) => item.step !== 'design').map((item) => `- ${item.text}: ${notePath(item, window.release)}`).join('\n');
  return `Build Tapestry on branch release/v${window.release}. Read AGENTS.md first.\nBuild only these approved notes:\n${notes || '(none yet)'}\nMake one commit per item, run npm test, and list the hand checks.`;
}
