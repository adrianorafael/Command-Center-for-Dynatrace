import React, { useEffect, useRef, useState } from "react";
import { Select } from "@dynatrace/strato-components/forms";
import { Avatar } from "@dynatrace/strato-components/content";
import type { DirectoryUser } from "../domain/contracts";
import { searchDirectory } from "../hooks/domain";
import { useAppData } from "../hooks/AppDataContext";
import { initials } from "./format";
import { FieldError } from "./FieldHint";

const MIN_CHARS = 3;
export const FORBIDDEN =
  "User search is unavailable (IAM returned 403). Check that your user belongs to the Dynatrace account that owns this environment and may view users; ask your account admin.";

/** IAM answered 403 "User not authorized" (cause depends on account setup). */
export function isForbidden(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const status = (e as { response?: { status?: unknown }; status?: unknown }).response?.status ?? (e as { status?: unknown }).status;
  const msg = e instanceof Error ? e.message : "";
  return status === 403 || /\b403\b|not authorized|forbidden/i.test(msg);
}

/**
 * Tenant IAM user type-ahead (DESIGN §6.5). Server-side search (≥3 chars), debounced 300 ms,
 * stale responses ignored. In demo mode the directory is the synthetic demo list.
 * Emails show only inside this picker, never in tables, logs or toasts.
 */
export const UserPicker = ({
  value,
  onChange,
  exclude = [],
  name = "user",
  disabled,
  ariaLabel = "Search tenant users",
  suggested = [],
}: {
  value: string | null;
  onChange: (uid: string | null, user?: DirectoryUser) => void;
  exclude?: string[];
  name?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** User ids offered before the person types (for example the schedule's participants). */
  suggested?: string[];
}) => {
  const { users, userName, rememberUsers } = useAppData();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchDirectory(query)
        .then((r) => {
          if (mine !== seq.current) return;
          setResults(r);
          setError(undefined);
        })
        .catch((e: unknown) => {
          if (mine !== seq.current) return;
          setResults([]);
          setError(isForbidden(e) ? FORBIDDEN : e instanceof Error ? e.message : "Search failed");
        })
        .finally(() => mine === seq.current && setLoading(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const typing = q.trim().length >= MIN_CHARS;
  const suggestions: DirectoryUser[] = typing ? [] : [...new Set(suggested)].map((uid) => users.get(uid) ?? { uid, name: userName(uid) });
  const visible = (typing ? results : suggestions).filter((u) => !exclude.includes(u.uid));
  // Keep the selected user as an option so the trigger can show its name.
  const selectedKnown = value && !visible.some((u) => u.uid === value) ? (users.get(value) ?? { uid: value, name: userName(value) }) : undefined;
  const options = selectedKnown ? [selectedKnown, ...visible] : visible;

  return (
    <>
    <Select
      name={name}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(uid) => {
        const user = options.find((u) => u.uid === uid);
        if (user) rememberUsers([user]);
        onChange(uid, user);
      }}
    >
      <Select.Filter value={q} onChange={setQ} disableFiltering />
      <Select.Content loading={loading}>
        {options.map((u) => (
          <Select.Option key={u.uid} value={u.uid} textValue={`${u.name} ${u.email ?? ""}`}>
            <Select.Prefix>
              <Avatar size="small" abbreviation={initials(u.name)} />
            </Select.Prefix>
            {u.email ? `${u.name} · ${u.email}` : u.name}
          </Select.Option>
        ))}
      </Select.Content>
      <Select.EmptyState>
        {error === FORBIDDEN ? "User search is unavailable (IAM returned 403)" : error ? `Couldn't search users: ${error}` : q.trim().length < MIN_CHARS ? "Type at least 3 characters" : "No users found"}
      </Select.EmptyState>
    </Select>
    {error === FORBIDDEN && <FieldError>{FORBIDDEN}</FieldError>}
    </>
  );
};
