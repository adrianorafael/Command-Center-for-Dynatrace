import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type EscalationPolicy, type Schedule, type Team, type UserContact } from "../../domain/contracts";
import { MemoryRepository } from "../memoryRepository";
import { isRealName, missingSnapshots, referencedUids, saveNameSnapshots } from "../people";
import { KEY } from "../repository";
import { createStore } from "../store";

/** Synthetic ids in the shape of IAM user ids. */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const contact = (n: number, over: Partial<UserContact> = {}): UserContact => ({ schemaVersion: SCHEMA_VERSION, uid: uid(n), rev: 3, methods: [], rules: [], ...over });

describe("name snapshots: the app keeps the names of its people", () => {
  it("only keeps real names (not the id, not an email)", () => {
    expect(isRealName({ uid: uid(1), name: "Ana Example" })).toBe(true);
    expect(isRealName({ uid: uid(1), name: uid(1) })).toBe(false);
    expect(isRealName({ uid: uid(1), name: "ana@example.com", email: "ana@example.com" })).toBe(false);
    expect(isRealName({ uid: uid(1), name: "  " })).toBe(false);
  });

  it("collects everyone the configuration refers to", () => {
    const team = { id: "t", members: [{ uid: uid(1), role: "responder" }, { uid: uid(2), role: "admin" }] } as unknown as Team;
    const schedule = { id: "s", layers: [{ participants: [uid(2), uid(3)] }], overrides: [{ uid: uid(4) }] } as unknown as Schedule;
    const policy = {
      id: "p",
      steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: uid(5) }, { type: "schedule", scheduleId: "s" }, { type: "team", teamId: "t" }] }],
    } as unknown as EscalationPolicy;
    expect(referencedUids({ teams: [team], schedules: [schedule], policies: [policy] }).sort()).toEqual([1, 2, 3, 4, 5].map(uid));
  });

  it("finds the people whose known name is not stored yet", () => {
    const known = new Map([
      [uid(1), { uid: uid(1), name: "Ana Example" }],
      [uid(2), { uid: uid(2), name: "Bruno Sample" }],
      [uid(3), { uid: uid(3), name: uid(3) }],
    ]);
    const missing = missingSnapshots([uid(1), uid(2), uid(3), uid(4), uid(1)], [contact(1, { displayName: "Ana Example" }), contact(2, { displayName: "Old Name" })], (u) => known.get(u));
    // 1 is stored already, 3 has no real name, 4 is unknown; 2 was renamed.
    expect(missing).toEqual([{ uid: uid(2), name: "Bruno Sample" }]);
  });

  it("stores the name for someone without a contact record, and never touches existing contact methods", async () => {
    const repo = new MemoryRepository();
    const store = createStore(repo);
    const methods = [{ id: "m1", channel: "sms" as const, address: "+15550100000" }];
    await store.saveContact(contact(2, { methods, timeZone: "UTC" }));

    const written = await saveNameSnapshots(store, [
      { uid: uid(1), name: "Ana Example", email: "ana@example.com" },
      { uid: uid(2), name: "Bruno Sample" },
      { uid: uid(3), name: uid(3) },
    ]);
    expect(written).toEqual([uid(1), uid(2)]);

    const stored = await store.listContacts();
    expect(stored.find((c) => c.uid === uid(1))).toEqual({ schemaVersion: SCHEMA_VERSION, uid: uid(1), rev: 1, displayName: "Ana Example", methods: [], rules: [] });
    // Only the name changed; no email is stored anywhere.
    expect(stored.find((c) => c.uid === uid(2))).toEqual(contact(2, { methods, timeZone: "UTC", displayName: "Bruno Sample" }));
    expect(stored.some((c) => c.uid === uid(3))).toBe(false);
    expect(JSON.stringify(stored)).not.toContain("example.com");
  });

  it("writes on top of the contact as stored now, not as loaded a minute ago", async () => {
    const repo = new MemoryRepository();
    const store = createStore(repo);
    // Someone else added a contact method after this viewer's last load.
    const fresh = contact(1, { methods: [{ id: "m9", channel: "voice" as const, address: "+15550100009" }] });
    await repo.put(KEY.contact(uid(1)), fresh);
    await saveNameSnapshots(store, [{ uid: uid(1), name: "Ana Example" }]);
    expect((await store.listContacts())[0]).toEqual({ ...fresh, displayName: "Ana Example" });
    // Same name again: nothing is written.
    expect(await saveNameSnapshots(store, [{ uid: uid(1), name: "Ana Example" }])).toEqual([]);
  });

  it("a failed write never fails the save it belongs to", async () => {
    const repo = new MemoryRepository();
    const store = createStore(repo);
    repo.put = () => Promise.reject(new Error("read-only"));
    await expect(saveNameSnapshots(store, [{ uid: uid(1), name: "Ana Example" }])).resolves.toEqual([]);
  });
});
