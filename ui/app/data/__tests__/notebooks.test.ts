import { describe, expect, it, vi } from "vitest";

vi.mock("@dynatrace-sdk/client-document", () => ({ documentsClient: {} }));
vi.mock("@dynatrace-sdk/navigation", () => ({ getDocumentLink: (id: string) => `/doc/${id}` }));

import { postmortemNotebookName } from "../notebooks";

describe("post-mortem notebook name", () => {
  it("starts with the first incident number", () => {
    expect(postmortemNotebookName("Bridge: Payment gateway timeouts", ["P-26112613", "P-26112614"])).toBe(
      "P-26112613 · Post-mortem: Payment gateway timeouts",
    );
  });
  it("works without incidents and stays within 128 characters", () => {
    expect(postmortemNotebookName("Outage", [])).toBe("Post-mortem: Outage");
    expect(postmortemNotebookName("x".repeat(300), ["P-1"]).length).toBe(128);
  });
});
