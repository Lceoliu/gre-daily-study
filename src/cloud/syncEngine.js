import { mergeFirstSync, normalizeSyncData } from "../studyState.js";

export const SYNC_TABLE = "study_items";
const META_PREFIX = "gre-daily-study-sync-v1:";
const PULL_PAGE_SIZE = 1000;
const PUSH_BATCH_SIZE = 400;
// Rows committed slightly out of order can carry an older server timestamp than the
// cursor, so every incremental pull re-reads a short window. Re-applying is idempotent.
const PULL_OVERLAP_MS = 5 * 60 * 1000;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// 53-bit string hash (cyrb53): keeps change-detection metadata small in localStorage.
function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function fingerprint(data) {
  return hashString(stableStringify(data));
}

function timeOf(value) {
  return Date.parse(value || 0) || 0;
}

function emptyMeta(userId) {
  return { version: 1, userId, initialized: false, cursor: null, observed: {}, versions: {}, pending: {}, lastSyncedAt: null };
}

export function loadSyncMeta(storage, userId) {
  try {
    const parsed = JSON.parse(storage.getItem(META_PREFIX + userId) || "null");
    if (parsed?.version === 1 && parsed.userId === userId) return { ...emptyMeta(userId), ...parsed };
  } catch {
    // Corrupt metadata only costs a fresh merge with the account copy.
  }
  return emptyMeta(userId);
}

export function createSupabaseRemote(client, userId) {
  return {
    async pull(since) {
      const rows = [];
      for (let from = 0; ; from += PULL_PAGE_SIZE) {
        let query = client
          .from(SYNC_TABLE)
          .select("kind,item_id,data,client_updated_at,updated_at,deleted")
          .eq("user_id", userId)
          .order("updated_at", { ascending: true })
          .order("kind", { ascending: true })
          .order("item_id", { ascending: true })
          .range(from, from + PULL_PAGE_SIZE - 1);
        if (since) query = query.gt("updated_at", since);
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...data);
        if (data.length < PULL_PAGE_SIZE) return rows;
      }
    },
    async push(items) {
      for (let start = 0; start < items.length; start += PUSH_BATCH_SIZE) {
        const { error } = await client.rpc("push_study_items", { items: items.slice(start, start + PUSH_BATCH_SIZE) });
        if (error) throw error;
      }
    },
  };
}

// adapter.collect() returns Map<"kind:itemId", { kind, itemId, data }> of normalized local items.
// adapter.apply(changes) writes [{ kind, itemId, data | null }] back into app state (null = delete).
export function createSyncEngine({ userId, remote, adapter, storage = window.localStorage, now = () => new Date().toISOString() }) {
  const meta = loadSyncMeta(storage, userId);
  let running = null;
  let rerun = false;

  const persist = () => {
    try {
      storage.setItem(META_PREFIX + userId, JSON.stringify(meta));
    } catch {
      // Storage full or blocked: pending changes stay in memory for this session.
    }
  };

  const queue = (key, item, data, deleted, timestamp) => {
    meta.versions[key] = timestamp;
    meta.pending[key] = { kind: item.kind, item_id: item.itemId, data: deleted ? {} : data, deleted, client_updated_at: timestamp };
  };

  const splitKey = (key) => {
    const index = key.indexOf(":");
    return { kind: key.slice(0, index), itemId: key.slice(index + 1) };
  };

  function noteLocalChanges() {
    if (!meta.initialized) return 0;
    const items = adapter.collect();
    const timestamp = now();
    let changed = 0;
    for (const [key, item] of items) {
      const print = fingerprint(item.data);
      if (meta.observed[key] === print) continue;
      meta.observed[key] = print;
      queue(key, item, item.data, false, timestamp);
      changed += 1;
    }
    for (const key of Object.keys(meta.observed)) {
      if (items.has(key)) continue;
      delete meta.observed[key];
      queue(key, splitKey(key), null, true, timestamp);
      changed += 1;
    }
    if (changed) persist();
    return changed;
  }

  function advanceCursor(rows) {
    for (const row of rows) {
      if (!meta.cursor || timeOf(row.updated_at) > timeOf(meta.cursor)) meta.cursor = row.updated_at;
    }
  }

  async function firstMerge() {
    const rows = await remote.pull(null);
    const local = adapter.collect();
    const timestamp = now();
    const changes = [];
    const seen = new Set();

    for (const row of rows) {
      const key = `${row.kind}:${row.item_id}`;
      seen.add(key);
      const localItem = local.get(key);
      const remoteData = row.deleted ? null : normalizeSyncData(row.kind, row.data);

      if (!localItem) {
        meta.versions[key] = row.client_updated_at;
        if (remoteData) {
          meta.observed[key] = fingerprint(remoteData);
          changes.push({ kind: row.kind, itemId: row.item_id, data: remoteData });
        }
        continue;
      }
      if (!remoteData) {
        meta.observed[key] = fingerprint(localItem.data);
        queue(key, localItem, localItem.data, false, timestamp);
        continue;
      }

      const merged = normalizeSyncData(row.kind, mergeFirstSync(row.kind, localItem.data, remoteData));
      const mergedPrint = fingerprint(merged);
      if (mergedPrint !== fingerprint(localItem.data)) changes.push({ kind: row.kind, itemId: row.item_id, data: merged });
      meta.observed[key] = mergedPrint;
      if (mergedPrint !== fingerprint(remoteData)) queue(key, localItem, merged, false, timestamp);
      else meta.versions[key] = row.client_updated_at;
    }

    for (const [key, item] of local) {
      if (seen.has(key)) continue;
      meta.observed[key] = fingerprint(item.data);
      queue(key, item, item.data, false, timestamp);
    }

    if (changes.length) adapter.apply(changes);
    advanceCursor(rows);
    meta.initialized = true;
    persist();
  }

  async function pullChanges() {
    const since = meta.cursor ? new Date(timeOf(meta.cursor) - PULL_OVERLAP_MS).toISOString() : null;
    const rows = await remote.pull(since);
    const changes = [];

    for (const row of rows) {
      const key = `${row.kind}:${row.item_id}`;
      const remoteTime = timeOf(row.client_updated_at);
      const pending = meta.pending[key];
      if (pending) {
        if (timeOf(pending.client_updated_at) >= remoteTime) continue;
        delete meta.pending[key];
      } else if (meta.versions[key] && timeOf(meta.versions[key]) >= remoteTime) {
        continue;
      }

      meta.versions[key] = row.client_updated_at;
      if (row.deleted) {
        delete meta.observed[key];
        changes.push({ kind: row.kind, itemId: row.item_id, data: null });
      } else {
        const data = normalizeSyncData(row.kind, row.data);
        meta.observed[key] = fingerprint(data);
        changes.push({ kind: row.kind, itemId: row.item_id, data });
      }
    }

    if (changes.length) adapter.apply(changes);
    advanceCursor(rows);
    persist();
    return changes.length;
  }

  async function pushPending() {
    const batch = Object.entries(meta.pending);
    if (!batch.length) return 0;
    await remote.push(batch.map(([, item]) => item));
    for (const [key, item] of batch) {
      // A newer local edit made while the request was in flight stays queued.
      if (meta.pending[key]?.client_updated_at === item.client_updated_at) delete meta.pending[key];
    }
    persist();
    return batch.length;
  }

  async function runOnce() {
    if (!meta.initialized) {
      await firstMerge();
    } else {
      noteLocalChanges();
      await pullChanges();
    }
    const pushed = await pushPending();
    meta.lastSyncedAt = now();
    persist();
    return { pushed };
  }

  // Single-flight: overlapping requests collapse into one follow-up run.
  async function sync() {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        let result = await runOnce();
        while (rerun) {
          rerun = false;
          result = await runOnce();
        }
        return result;
      } finally {
        running = null;
        rerun = false;
      }
    })();
    return running;
  }

  return {
    sync,
    noteLocalChanges,
    get initialized() {
      return meta.initialized;
    },
    get pendingCount() {
      return Object.keys(meta.pending).length;
    },
    get lastSyncedAt() {
      return meta.lastSyncedAt;
    },
  };
}
