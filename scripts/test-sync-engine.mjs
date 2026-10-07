// Simulates several devices syncing through an in-memory server that follows the same
// last-write-wins rule as public.push_study_items. Run: node scripts/test-sync-engine.mjs
import assert from "node:assert/strict";
import { createSyncEngine } from "../src/cloud/syncEngine.js";
import { applySyncChanges, collectSyncItems, normalizePracticeResponse } from "../src/studyState.js";

function createServer() {
  const rows = new Map();
  let clock = Date.parse("2026-10-07T00:00:00Z");
  let offline = false;
  const tick = () => new Date((clock += 1000)).toISOString().replace("Z", "+00:00");
  return {
    rows,
    setOffline(value) {
      offline = value;
    },
    remote() {
      return {
        async pull(since) {
          if (offline) throw new TypeError("Failed to fetch");
          return [...rows.values()]
            .filter((row) => !since || Date.parse(row.updated_at) > Date.parse(since))
            .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
            .map((row) => structuredClone(row));
        },
        async push(items) {
          if (offline) throw new TypeError("Failed to fetch");
          for (const item of items) {
            const key = `${item.kind}:${item.item_id}`;
            const existing = rows.get(key);
            if (existing && Date.parse(existing.client_updated_at) >= Date.parse(item.client_updated_at)) continue;
            rows.set(key, { ...structuredClone(item), updated_at: tick() });
          }
        },
      };
    },
  };
}

function createStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

let deviceClock = Date.parse("2026-10-07T08:00:00Z");
const deviceNow = () => new Date((deviceClock += 1000)).toISOString();

function createDevice(server, initial = {}) {
  const device = {
    state: { progress: {}, responses: {}, marks: {}, drafts: {}, settings: {}, ...structuredClone(initial) },
    storage: createStorage(),
  };
  device.engine = createSyncEngine({
    userId: "user-1",
    remote: server.remote(),
    storage: device.storage,
    now: deviceNow,
    adapter: {
      collect: () => collectSyncItems(device.state),
      apply: (changes) => {
        device.state = applySyncChanges(device.state, changes);
      },
    },
  });
  device.edit = (mutate) => {
    mutate(device.state);
    device.engine.noteLocalChanges();
  };
  return device;
}

const server = createServer();

// 1. A device with existing local progress signs in first: everything uploads.
const phone = createDevice(server, {
  progress: { w1: { mastered: true, saved: false }, w2: { mastered: false, saved: true } },
  responses: { q1: normalizePracticeResponse({ attemptCount: 1, lastCorrect: false, lastAttemptAt: "2026-10-01T10:00:00Z" }) },
  settings: { startDate: "2026-09-20" },
});
await phone.engine.sync();
assert.equal(server.rows.size, 4);
assert.equal(server.rows.get("response:q1").data.wrongCount, 1, "legacy wrong answers enter the wrong-question book");
assert.equal(phone.engine.pendingCount, 0);

// 2. A fresh laptop signs in and receives everything.
const laptop = createDevice(server);
await laptop.engine.sync();
assert.deepEqual(laptop.state.progress, phone.state.progress);
assert.equal(laptop.state.settings.startDate, "2026-09-20");
assert.equal(laptop.engine.pendingCount, 0, "a clean download queues nothing");

// 3. Edits travel both ways; marks and drafts included.
laptop.edit((state) => {
  state.progress = { ...state.progress, w3: { mastered: true, saved: true } };
  state.marks = { ...state.marks, q9: { markedAt: "2026-10-07T08:30:00Z" } };
  state.drafts = { ...state.drafts, issue1: "Draft on laptop" };
});
await laptop.engine.sync();
await phone.engine.sync();
assert.deepEqual(phone.state.progress.w3, { mastered: true, saved: true });
assert.ok(phone.state.marks.q9);
assert.equal(phone.state.drafts.issue1, "Draft on laptop");

// 4. Pulling one's own uploads is not treated as a remote change.
const rowsBefore = server.rows.get("word:w3").updated_at;
await laptop.engine.sync();
assert.equal(laptop.engine.pendingCount, 0);
assert.equal(server.rows.get("word:w3").updated_at, rowsBefore);

// 5. Conflicting edits: the later edit wins on every device.
phone.edit((state) => {
  state.progress = { ...state.progress, w1: { mastered: false, saved: false } };
});
laptop.edit((state) => {
  state.progress = { ...state.progress, w1: { mastered: true, saved: true } };
});
await laptop.engine.sync();
await phone.engine.sync();
await laptop.engine.sync();
assert.deepEqual(phone.state.progress.w1, { mastered: true, saved: true });
assert.deepEqual(laptop.state.progress.w1, { mastered: true, saved: true });

// 6. Deletions (unmarking a question) propagate.
phone.edit((state) => {
  const { q9: _removed, ...rest } = state.marks;
  state.marks = rest;
});
await phone.engine.sync();
await laptop.engine.sync();
assert.equal(laptop.state.marks.q9, undefined);
assert.equal(server.rows.get("mark:q9").deleted, true);

// 7. Offline edits stay queued (and survive a reload) until the network returns.
server.setOffline(true);
phone.edit((state) => {
  state.progress = { ...state.progress, w4: { mastered: false, saved: true } };
});
await assert.rejects(phone.engine.sync());
assert.equal(phone.engine.pendingCount, 1);
const reloadedPhone = createDevice(server, phone.state);
reloadedPhone.storage = phone.storage;
const reloadedEngine = createSyncEngine({
  userId: "user-1",
  remote: server.remote(),
  storage: phone.storage,
  now: deviceNow,
  adapter: { collect: () => collectSyncItems(reloadedPhone.state), apply: (changes) => { reloadedPhone.state = applySyncChanges(reloadedPhone.state, changes); } },
});
assert.equal(reloadedEngine.pendingCount, 1, "pending edits persist in storage");
server.setOffline(false);
await reloadedEngine.sync();
await laptop.engine.sync();
assert.deepEqual(laptop.state.progress.w4, { mastered: false, saved: true });

// 8. A device that studied offline before ever signing in merges instead of overwriting.
const tablet = createDevice(server, {
  progress: { w2: { mastered: true, saved: false }, w5: { mastered: true, saved: false } },
  responses: { q1: normalizePracticeResponse({ attemptCount: 3, lastCorrect: true, lastAttemptAt: "2026-10-06T10:00:00Z", wrongCount: 0 }) },
  drafts: { issue1: "short" },
});
await tablet.engine.sync();
assert.deepEqual(tablet.state.progress.w2, { mastered: true, saved: true }, "flags from both sides are kept");
assert.equal(tablet.state.responses.q1.attemptCount, 3, "the more recent attempt wins");
assert.equal(tablet.state.responses.q1.wrongCount, 1, "wrong-question history is not lost");
assert.equal(tablet.state.drafts.issue1, "Draft on laptop", "the longer draft is kept");
await laptop.engine.sync();
assert.deepEqual(laptop.state.progress.w5, { mastered: true, saved: false });
assert.deepEqual(laptop.state.progress.w2, { mastered: true, saved: true });

// 9. All devices converge to the server copy.
await phone.engine.sync();
await reloadedEngine.sync();
const serverView = Object.fromEntries([...server.rows.values()].filter((row) => !row.deleted).map((row) => [`${row.kind}:${row.item_id}`, row.data]));
for (const [name, state] of [["laptop", laptop.state], ["tablet", tablet.state], ["phone", reloadedPhone.state]]) {
  const local = Object.fromEntries([...collectSyncItems(state)].map(([key, item]) => [key, item.data]));
  assert.deepEqual(local, serverView, `${name} converged`);
}

console.log(`sync engine: all scenarios passed (${server.rows.size} server rows)`);
