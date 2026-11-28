/**
 * What the team page says when some of its people show as ids instead of names.
 *
 * A name is missing when the account's user directory did not return the person and the app holds no name for
 * them yet (data/people.ts). The message names the reason, so nobody has to guess whether people were lost:
 * membership, contact methods and paging never depend on the name.
 */

export interface NamesHint {
  title: string;
  detail: string;
}

/**
 * @param unnamed    how many people of the team have no name to show
 * @param failed     the last directory lookup failed
 * @param forbidden  …and IAM answered 403 (the viewer may not read the account's users)
 * @param reason     the error text of a failed lookup, when it is not a 403
 */
export function namesHint(unnamed: number, failed: boolean, forbidden: boolean, reason?: string): NamesHint | undefined {
  if (unnamed <= 0) return undefined;
  const who = unnamed === 1 ? "1 person shows" : `${unnamed} people show`;
  const safe = "They are still members and are paged as usual.";
  if (failed && forbidden)
    return {
      title: "Some names can't be shown",
      detail: `Your user may not read the users of this Dynatrace account (IAM answered 403), so ${who} as an id. ${safe} Ask an account admin for permission to view users.`,
    };
  if (failed)
    return {
      title: "Some names couldn't be loaded",
      detail: `Looking up names in the account's users failed${reason ? `: ${reason}` : ""}. Until it works, ${who} as an id. ${safe}`,
    };
  return {
    title: unnamed === 1 ? "1 person is not an active user of this account" : `${unnamed} people are not active users of this account`,
    detail: `The account's user list has no active user with ${unnamed === 1 ? "this id" : "these ids"}, so ${who} as an id. Remove ${unnamed === 1 ? "the person" : "them"} from the team, or ask an account admin whether the user was deactivated.`,
  };
}
