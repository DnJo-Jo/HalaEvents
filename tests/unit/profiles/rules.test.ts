import { describe, expect, it } from "vitest";
import { canTransition } from "@/modules/events/rules";
import { CreateEventInput } from "@/modules/events/schemas";
import {
  canAdminTransition,
  profileGateRedirect,
  requiredRoleForProviderKind,
} from "@/modules/profiles/rules";
import { ProviderProfileInput, OnboardingInput } from "@/modules/profiles/schemas";

describe("profileGateRedirect", () => {
  it("sends inactive or missing profiles to /account-status", () => {
    expect(profileGateRedirect(null)).toBe("/account-status");
    expect(profileGateRedirect({ account_status: "suspended", onboarded_at: "x" })).toBe(
      "/account-status",
    );
  });
  it("sends active, not-onboarded members to /onboarding", () => {
    expect(profileGateRedirect({ account_status: "active", onboarded_at: null })).toBe(
      "/onboarding",
    );
  });
  it("lets onboarded active members through", () => {
    expect(
      profileGateRedirect({ account_status: "active", onboarded_at: "2026-10-21" }),
    ).toBeNull();
  });
});

describe("provider rules", () => {
  it("only admins' allowed transitions pass; no path from draft straight to verified", () => {
    expect(canAdminTransition("submitted", "verified")).toBe(true);
    expect(canAdminTransition("draft", "verified")).toBe(false);
    expect(canAdminTransition("rejected", "verified")).toBe(false);
  });
  it("maps provider kind to the required account role", () => {
    expect(requiredRoleForProviderKind("venue")).toBe("venue_provider");
    expect(requiredRoleForProviderKind("service")).toBe("service_provider");
  });
  it("validates kind/category consistency and ranges", () => {
    expect(
      ProviderProfileInput.safeParse({ kind: "venue", category: "catering", name: "X Hall" })
        .success,
    ).toBe(false);
    expect(
      ProviderProfileInput.safeParse({
        kind: "service",
        category: "av",
        name: "AV Co",
        minCapacity: 10,
        maxCapacity: 5,
      }).success,
    ).toBe(false);
    expect(
      ProviderProfileInput.safeParse({ kind: "venue", category: "venue", name: "X Hall" }).success,
    ).toBe(true);
  });
});

describe("OnboardingInput", () => {
  it("requires at least one role and de-duplicates", () => {
    expect(OnboardingInput.safeParse({ displayName: "Sam", roles: [] }).success).toBe(false);
    const ok = OnboardingInput.safeParse({ displayName: "Sam", roles: ["organizer", "organizer"] });
    expect(ok.success && ok.data.roles).toEqual(["organizer"]);
  });
  it("treats an empty phone as absent and validates a provided one", () => {
    const ok = OnboardingInput.safeParse({ displayName: "Sam", phone: "  ", roles: ["organizer"] });
    expect(ok.success && ok.data.phone).toBeUndefined();
    expect(
      OnboardingInput.safeParse({ displayName: "Sam", phone: "call me", roles: ["organizer"] })
        .success,
    ).toBe(false);
  });
});

describe("events", () => {
  it("transition table follows event.md §4", () => {
    expect(canTransition("draft", "planning")).toBe(true);
    expect(canTransition("draft", "live")).toBe(false);
    expect(canTransition("ready", "planning")).toBe(true);
    expect(canTransition("cancelled", "draft")).toBe(false);
  });
  it("CreateEventInput enforces order, capacity and timezone", () => {
    const base = {
      name: "Campus Hack",
      startsAt: "2026-12-01T09:00:00+04:00",
      endsAt: "2026-12-02T18:00:00+04:00",
      capacity: 100,
    };
    expect(CreateEventInput.safeParse(base).success).toBe(true);
    expect(CreateEventInput.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
    expect(CreateEventInput.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(CreateEventInput.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
  });
});
