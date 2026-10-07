// Shared shapes for everything the app persists per learner. The cloud sync layer
// stores each entry as one item ({ kind, itemId, data }), so every normalizer here
// must be deterministic: the same input always yields the same object.

export const SYNC_KINDS = ["word", "response", "mark", "draft", "setting"];

function isoOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function laterIso(left, right) {
  if (!left) return right || "";
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function normalizeWordState(value) {
  return { mastered: Boolean(value?.mastered), saved: Boolean(value?.saved) };
}

export function normalizePracticeResponse(value) {
  const response = value && typeof value === "object" ? value : {};
  const selectedByBlank = response.selectedByBlank && typeof response.selectedByBlank === "object"
    ? Object.fromEntries(Object.entries(response.selectedByBlank).filter(([blank, label]) => typeof blank === "string" && typeof label === "string"))
    : {};
  const attemptCount = Number.isInteger(response.attemptCount) && response.attemptCount > 0 ? response.attemptCount : 0;
  const lastCorrect = typeof response.lastCorrect === "boolean" ? response.lastCorrect : null;
  const lastAttemptAt = isoOrEmpty(response.lastAttemptAt);
  // Responses saved before the wrong-question book existed only know their latest result.
  const legacyWrong = response.wrongCount === undefined && attemptCount > 0 && lastCorrect === false;

  return {
    responseRevision: response.responseRevision ?? 1,
    selectedLabels: Array.isArray(response.selectedLabels) ? response.selectedLabels.filter((label) => typeof label === "string") : [],
    selectedByBlank,
    selectedSentence: typeof response.selectedSentence === "string" ? response.selectedSentence : "",
    checked: Boolean(response.checked),
    attemptCount,
    lastCorrect,
    completedAt: isoOrEmpty(response.completedAt),
    lastAttemptAt,
    wrongCount: legacyWrong ? 1 : Number.isInteger(response.wrongCount) && response.wrongCount > 0 ? response.wrongCount : 0,
    lastWrongAt: legacyWrong ? lastAttemptAt : isoOrEmpty(response.lastWrongAt),
    wrongClearedAt: isoOrEmpty(response.wrongClearedAt),
  };
}

export function normalizeMark(value) {
  return { markedAt: isoOrEmpty(value?.markedAt) };
}

export function isInWrongBook(response) {
  if (!response || response.wrongCount <= 0) return false;
  if (!response.wrongClearedAt) return true;
  return Date.parse(response.lastWrongAt || 0) > Date.parse(response.wrongClearedAt);
}

export function normalizeSyncData(kind, data) {
  switch (kind) {
    case "word":
      return normalizeWordState(data);
    case "response":
      return normalizePracticeResponse(data);
    case "mark":
      return normalizeMark(data);
    case "draft":
      return { text: typeof data?.text === "string" ? data.text : "" };
    case "setting":
      return { value: data?.value ?? null };
    default:
      return data ?? null;
  }
}

// Flattens app state into sync items keyed by "kind:itemId".
export function collectSyncItems({ progress, responses, marks, drafts, settings }) {
  const items = new Map();
  const add = (kind, itemId, data) => items.set(`${kind}:${itemId}`, { kind, itemId, data: normalizeSyncData(kind, data) });
  Object.entries(progress || {}).forEach(([id, value]) => add("word", id, value));
  Object.entries(responses || {}).forEach(([id, value]) => add("response", id, value));
  Object.entries(marks || {}).forEach(([id, value]) => add("mark", id, value));
  Object.entries(drafts || {}).forEach(([id, text]) => add("draft", id, { text }));
  Object.entries(settings || {}).forEach(([id, value]) => {
    if (value !== undefined && value !== null && value !== "") add("setting", id, { value });
  });
  return items;
}

// Combines a device's pre-existing local item with the account's copy the first time
// the device signs in, so neither side silently loses progress.
export function mergeFirstSync(kind, local, remote) {
  switch (kind) {
    case "word":
      return { mastered: local.mastered || remote.mastered, saved: local.saved || remote.saved };
    case "response": {
      const localTime = Date.parse(local.lastAttemptAt || 0) || 0;
      const remoteTime = Date.parse(remote.lastAttemptAt || 0) || 0;
      const base = localTime > remoteTime ? local : remote;
      return {
        ...base,
        wrongCount: Math.max(local.wrongCount, remote.wrongCount),
        lastWrongAt: laterIso(local.lastWrongAt, remote.lastWrongAt),
        wrongClearedAt: laterIso(local.wrongClearedAt, remote.wrongClearedAt),
      };
    }
    case "mark":
      return { markedAt: [local.markedAt, remote.markedAt].filter(Boolean).sort()[0] || "" };
    case "draft":
      return local.text.trim().length > remote.text.trim().length ? local : remote;
    default:
      return remote;
  }
}

// Applies sync changes of one kind to a { id: value } map; returns the same object when untouched.
export function applyKindChanges(map, changes, kind, toValue = (data) => data) {
  const relevant = changes.filter((change) => change.kind === kind);
  if (!relevant.length) return map;
  const next = { ...map };
  for (const change of relevant) {
    if (change.data === null) delete next[change.itemId];
    else next[change.itemId] = toValue(change.data);
  }
  return next;
}

export function applySyncChanges(snapshot, changes) {
  return {
    progress: applyKindChanges(snapshot.progress, changes, "word"),
    responses: applyKindChanges(snapshot.responses, changes, "response"),
    marks: applyKindChanges(snapshot.marks, changes, "mark"),
    drafts: applyKindChanges(snapshot.drafts, changes, "draft", (data) => data.text),
    settings: applyKindChanges(snapshot.settings, changes, "setting", (data) => data.value),
  };
}
