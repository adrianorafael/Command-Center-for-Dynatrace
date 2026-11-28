/**
 * Name snapshots: the app's own copy of each person's display name.
 *
 * The account's user directory (IAM) is where names come from, but the app must still say who its people are when
 * the directory cannot be asked: the viewer may not read users, a lookup can fail, a person can leave the account.
 * So the name is kept on the person's contact record (`UserContact.displayName`), next to their contact methods.
 * No email is stored.
 *
 * When they are written: only as part of a save the person triggers in the UI (adding people, saving a schedule,
 * a policy, a contact…), never from the periodic refresh. App State has no compare-and-set, so a background
 * writer could overwrite contact methods someone is saving at that moment. For the same reason every write
 * re-reads the contact right before it and changes nothing but the name.
 */
import { SCHEMA_VERSION, type DirectoryUser, type EscalationPolicy, type Schedule, type Team, type UserContact } from "../domain/contracts";
import { KEY, type Store } from "./repository";

/** A name worth keeping: not empty, not the id itself, and not an email (IAM users without a name show their email). */
export function isRealName(u: Pick<DirectoryUser, "uid" | "name" | "email">): boolean {
  const name = u.name?.trim();
  return !!name && name !== u.uid && name !== u.email && !name.includes("@");
}

/** Every person the configuration refers to: team members, schedule participants and overrides, policy targets. */
export function referencedUids(cfg: { teams: readonly Team[]; schedules: readonly Schedule[]; policies: readonly EscalationPolicy[] }): string[] {
  const uids = new Set<string>();
  cfg.teams.forEach((t) => t.members.forEach((m) => uids.add(m.uid)));
  cfg.schedules.forEach((s) => {
    s.layers.forEach((l) => l.participants.forEach((u) => uids.add(u)));
    s.overrides.forEach((o) => uids.add(o.uid));
  });
  cfg.policies.forEach((p) => p.steps.forEach((st) => st.targets.forEach((t) => t.type === "user" && t.uid && uids.add(t.uid))));
  return [...uids];
}

/**
 * The people among `uids` whose known name is not the stored one yet. `nameOf` is what the UI knows right now
 * (directory results); `contacts` is what App State held at the last load.
 */
export function missingSnapshots(
  uids: readonly string[],
  contacts: readonly UserContact[],
  nameOf: (uid: string) => DirectoryUser | undefined,
): DirectoryUser[] {
  const stored = new Map(contacts.map((c) => [c.uid, c.displayName]));
  const out: DirectoryUser[] = [];
  for (const uid of new Set(uids)) {
    const u = nameOf(uid);
    if (u && isRealName(u) && stored.get(uid) !== u.name.trim()) out.push(u);
  }
  return out;
}

/**
 * Writes the names (see header). A person without a contact record gets one with no contact methods. Best effort:
 * a failed write is skipped, so it can never fail the save it belongs to. Returns the uids written.
 */
export async function saveNameSnapshots(store: Store, people: readonly DirectoryUser[]): Promise<string[]> {
  const written: string[] = [];
  for (const u of people) {
    if (!isRealName(u)) continue;
    const name = u.name.trim();
    try {
      // Fresh read: the copy in memory can be a minute old, and only the name may change here.
      const current = (await store.repo.get<UserContact>(KEY.contact(u.uid)))?.value;
      if (current?.displayName === name) continue;
      await store.saveContact(current ? { ...current, displayName: name } : { schemaVersion: SCHEMA_VERSION, uid: u.uid, rev: 1, displayName: name, methods: [], rules: [] });
      written.push(u.uid);
    } catch {
      // Read-only viewer or a transient error: the name stays live-only until the next save.
    }
  }
  return written;
}
