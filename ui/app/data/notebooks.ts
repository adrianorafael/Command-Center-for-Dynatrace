/**
 * Dynatrace Notebooks for war rooms: list existing notebooks and create a post-mortem notebook.
 *
 * Notebooks are Document Service documents of type "notebook" (verified on a tenant: content is JSON,
 * version "7", markdown + dql sections). Scopes: document:documents:read / document:documents:write.
 * Links come from @dynatrace-sdk/navigation getDocumentLink(id).
 */
import { documentsClient } from "@dynatrace-sdk/client-document";
import { getDocumentLink } from "@dynatrace-sdk/navigation";
import { buildPostmortemNotebook } from "../domain/warrooms";
import { isDemo } from "./demoMode";

/** A notebook as linked from a war room; `url` is empty when the navigation SDK cannot build a link. */
export interface NotebookRef {
  id: string;
  name: string;
  url: string;
}

function linkFor(id: string): string {
  try {
    return getDocumentLink(id);
  } catch {
    return "";
  }
}

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

const DEMO: NotebookRef[] = [
  { id: "demo-nb-1", name: "Checkout runbook", url: "https://notebooks.example.com/checkout-runbook" },
  { id: "demo-nb-2", name: "Payments investigations", url: "https://notebooks.example.com/payments" },
];

/** Notebooks the viewer can access, optionally filtered by name (case-insensitive contains). */
export async function listNotebooks(query = ""): Promise<NotebookRef[]> {
  const q = query.trim();
  if (isDemo()) return DEMO.filter((n) => n.name.toLowerCase().includes(q.toLowerCase()));
  // Single-quoted filter values; quotes in the user's text are removed rather than escaped.
  const safe = q.replace(/['\\]/g, "").slice(0, 100);
  const filter = safe ? `type == 'notebook' and name contains '${safe}'` : "type == 'notebook'";
  const res = await documentsClient.listDocuments({ filter, pageSize: 50 });
  return res.documents.map((d) => ({ id: d.id, name: d.name, url: linkFor(d.id) }));
}

/**
 * Notebook name starts with the (first) incident number so it is easy to find later:
 * "P-26112613 · Post-mortem: Payment gateway timeouts". Max 128 characters (Document Service limit).
 */
export function postmortemNotebookName(title: string, displayIds: readonly string[]): string {
  const first = displayIds.find((d) => d.trim());
  const clean = title.replace(/^Bridge:\s*/i, "").trim() || "War room";
  return `${first ? `${first} · ` : ""}Post-mortem: ${clean}`.slice(0, 128);
}

/** Create a post-mortem notebook for a war room and return its reference. */
export async function createPostmortemNotebook(title: string, displayIds: string[]): Promise<NotebookRef> {
  const name = postmortemNotebookName(title, displayIds);
  if (isDemo()) return { id: `demo-${Date.now()}`, name, url: "https://notebooks.example.com/new-postmortem" };
  const content = new Blob([JSON.stringify(buildPostmortemNotebook(title, displayIds, uuid))], { type: "application/json" });
  const doc = await documentsClient.createDocument({ body: { name, type: "notebook", content } });
  return { id: doc.id, name: doc.name, url: linkFor(doc.id) };
}
