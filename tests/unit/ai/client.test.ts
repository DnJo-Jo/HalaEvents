import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AI_LIMITS, generate, jsonSchemaFor } from "@/lib/ai/client";
import type { AiLogEntry } from "@/lib/ai/log";
import { createMockProvider } from "@/lib/ai/mock";
import type { AiProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";

// All tests here use scripted in-memory providers. No network, no Gemini key.

const Schema = z.object({ items: z.array(z.string().min(1)).max(3) });

function scripted(
  results: (ProviderResult | ((req: ProviderRequest) => Promise<ProviderResult>))[],
) {
  const calls: ProviderRequest[] = [];
  const provider: AiProvider = {
    name: "gemini",
    model: "test-model",
    isMock: false,
    async generate(req) {
      calls.push(structuredClone({ ...req, signal: undefined }) as unknown as ProviderRequest);
      const next = results.shift();
      if (!next) throw new Error("unexpected extra call");
      return typeof next === "function" ? next(req) : next;
    },
  };
  return { provider, calls };
}
const ok = (text: string): ProviderResult => ({
  ok: true,
  text,
  model: "test-model-001",
  usage: { inputTokens: 10, outputTokens: 5 },
});
const base = {
  pipeline: "plan" as const,
  system: "system",
  prompt: "prompt",
  schema: Schema,
  sleep: async () => {},
};

describe("generate()", () => {
  it("returns validated data on the first valid answer", async () => {
    const { provider, calls } = scripted([ok('{"items":["a"]}')]);
    const r = await generate(provider, base);
    expect(r).toMatchObject({
      ok: true,
      data: { items: ["a"] },
      attempts: 1,
      model: "test-model-001",
    });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(calls[0].jsonSchema).toMatchObject({ type: "object" });
  });

  it("repairs malformed JSON once, quoting the error, then succeeds", async () => {
    const { provider, calls } = scripted([ok("not json"), ok('{"items":["b"]}')]);
    const r = await generate(provider, base);
    expect(r).toMatchObject({ ok: true, data: { items: ["b"] }, attempts: 2 });
    expect(calls[1].messages.at(-1)?.content).toContain("not valid JSON");
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it("repairs schema violations and business-rule errors, then gives up: invalid data is never returned", async () => {
    const { provider, calls } = scripted([
      ok('{"items":["a","b","c","d"]}'),
      ok('{"items":["x"]}'),
    ]);
    const r = await generate(provider, {
      ...base,
      validate: (d) => (d.items.includes("x") ? ["x is not allowed"] : []),
    });
    expect(r).toMatchObject({ ok: false, error: { code: "invalid_output" }, attempts: 2 });
    expect(calls[1].messages.at(-1)?.content).toMatch(/items/);
    expect("data" in r).toBe(false);
  });

  it("strips markdown code fences around JSON", async () => {
    const { provider } = scripted([ok('```json\n{"items":["a"]}\n```')]);
    expect((await generate(provider, base)).ok).toBe(true);
  });

  it("retries a transient failure once, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const { provider } = scripted([
      { ok: false, code: "provider_error", message: "503", retryable: true },
      ok('{"items":["a"]}'),
    ]);
    const r = await generate(provider, { ...base, sleep });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(AI_LIMITS.backoffMs);
  });

  it("stops after one transient retry (no retry loops)", async () => {
    const { provider, calls } = scripted([
      { ok: false, code: "network", message: "down", retryable: true },
      { ok: false, code: "network", message: "down", retryable: true },
    ]);
    const r = await generate(provider, base);
    expect(r).toMatchObject({ ok: false, error: { code: "network" }, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it("never retries a quota / rate-limit error and passes on the retry delay", async () => {
    const { provider, calls } = scripted([
      { ok: false, code: "rate_limited", message: "quota", retryAfterSeconds: 30 },
    ]);
    const r = await generate(provider, base);
    expect(r).toMatchObject({
      ok: false,
      error: { code: "rate_limited", retryAfterSeconds: 30 },
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it("does not retry non-transient errors (model unavailable, bad request)", async () => {
    for (const code of ["model_unavailable", "not_configured", "provider_error"] as const) {
      const { provider, calls } = scripted([{ ok: false, code, message: code }]);
      expect((await generate(provider, base)).ok).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it("enforces the timeout with an AbortSignal and retries once", async () => {
    const hang = (req: ProviderRequest) =>
      new Promise<ProviderResult>((resolve) =>
        req.signal.addEventListener("abort", () =>
          resolve({ ok: false, code: "timeout", message: "timed out", retryable: true }),
        ),
      );
    const { provider, calls } = scripted([hang, hang]);
    const started = Date.now();
    const r = await generate(provider, { ...base, timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, error: { code: "timeout" }, attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("turns a throwing provider into a provider_error", async () => {
    const provider: AiProvider = {
      name: "gemini",
      model: "m",
      isMock: false,
      generate: async () => {
        throw new Error("boom with secret sk-123");
      },
    };
    const r = await generate(provider, base);
    expect(r).toMatchObject({ ok: false, error: { code: "provider_error" } });
    expect(JSON.stringify(r)).not.toContain("sk-123");
  });

  it("makes at most AI_LIMITS.maxAttempts calls even when every failure differs", async () => {
    const { provider, calls } = scripted([
      { ok: false, code: "timeout", message: "t", retryable: true },
      ok("garbage"),
      ok("still garbage"),
    ]);
    const r = await generate(provider, base);
    expect(r.ok).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(AI_LIMITS.maxAttempts);
  });

  it("logs ids, timings and outcomes, but never prompts, answers or keys", async () => {
    const entries: AiLogEntry[] = [];
    const { provider } = scripted([ok("nope"), ok('{"items":["fine"]}')]);
    await generate(provider, {
      ...base,
      system: "SYSTEM-SECRET-PROMPT",
      prompt: "attendee jane@example.test GEMINI_API_KEY=AIza-secret",
      requestId: "req-1",
      logger: (e) => entries.push(e),
    });
    expect(entries.map((e) => e.outcome)).toEqual(["repair", "ok"]);
    expect(entries[0]).toMatchObject({
      requestId: "req-1",
      pipeline: "plan",
      provider: "gemini",
      attempt: 1,
    });
    const logged = JSON.stringify(entries);
    for (const secret of ["SYSTEM-SECRET", "jane@", "AIza", "fine"])
      expect(logged).not.toContain(secret);
  });

  it("caches the JSON schema per Zod schema", () => {
    expect(jsonSchemaFor(Schema)).toBe(jsonSchemaFor(Schema));
    expect(jsonSchemaFor(Schema)).not.toHaveProperty("$schema");
  });
});

describe("mock provider", () => {
  it("is deterministic and flagged as mock", async () => {
    const mock = createMockProvider({ plan: (ctx) => ({ items: [(ctx as { v: string }).v] }) });
    const a = await generate(mock, { ...base, context: { v: "same" } });
    const b = await generate(mock, { ...base, context: { v: "same" } });
    expect(a).toMatchObject({ ok: true, data: { items: ["same"] } });
    expect(b).toMatchObject({ ok: true, data: { items: ["same"] } });
    expect(mock.isMock).toBe(true);
  });

  it("reports a missing fixture instead of inventing output", async () => {
    const r = await generate(createMockProvider({}), base);
    expect(r).toMatchObject({ ok: false, error: { code: "not_configured" } });
  });
});
