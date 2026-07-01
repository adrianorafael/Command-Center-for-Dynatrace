// ─── Shared Problem Types ─────────────────────────────────────────────────────
// Single source of truth — imported by Problems.tsx and useProblems.ts.
// This file must NOT import from either of those files (prevents circular deps).

export type ProblemStatus = "OPEN" | "CLOSED" | "ACKNOWLEDGED" | "MAINTENANCE";

export type HistoryEventType =
  | "STARTED"
  | "ACKNOWLEDGED"
  | "UNACKNOWLEDGED"
  | "CLOSED"
  | "MAINTENANCE";

export interface HistoryEvent {
  type: HistoryEventType;
  timestamp: string;
  by: string;
}

export interface EscalationContact {
  name: string;
  phone: string;
}

export interface Problem {
  id: string;
  displayId: string;
  started: string;
  summary: string;
  rootCause: string;
  events: number;
  assignedTo: string;
  status: ProblemStatus;
  detailsUrl: string;
  history: HistoryEvent[];
  escalationContact: EscalationContact;
}

export type FilterStatus = "ALL" | ProblemStatus;
