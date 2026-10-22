import { describe, expect, it, vi } from "vitest";
import { addToShortlist } from "@/modules/marketplace/repo";
import type { SupabaseServerClient } from "@/lib/db/server";

// `authenticated` can only UPDATE the `note` column of event_shortlists, so an .upsert() (which
// updates every column on conflict) is rejected by PostgREST with 42501 even for the event owner.
function fakeDb(insertError: { code: string; message: string } | null) {
  const calls: string[] = [];
  const update = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
  const db = {
    from: () => ({
      insert: async () => {
        calls.push("insert");
        return { error: insertError };
      },
      update: (...a: unknown[]) => {
        calls.push("update");
        return (update as (...x: unknown[]) => unknown)(...a);
      },
      upsert: () => {
        calls.push("upsert");
        return { error: null };
      },
    }),
  } as unknown as SupabaseServerClient;
  return { db, calls };
}

describe("addToShortlist", () => {
  it("inserts and never upserts", async () => {
    const { db, calls } = fakeDb(null);
    await addToShortlist(db, "e", "p", "note");
    expect(calls).toEqual(["insert"]);
  });
  it("updates only the note when the provider is already shortlisted", async () => {
    const { db, calls } = fakeDb({ code: "23505", message: "duplicate" });
    await addToShortlist(db, "e", "p", "new note");
    expect(calls).toEqual(["insert", "update"]);
  });
  it("surfaces other database errors", async () => {
    const { db } = fakeDb({ code: "42501", message: "denied" });
    await expect(addToShortlist(db, "e", "p")).rejects.toBeTruthy();
  });
});
