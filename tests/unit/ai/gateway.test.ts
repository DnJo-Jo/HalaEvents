// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createCloudflareProvider } from "@/lib/ai/cloudflare";
import { aiSetup, generateJson, parseOutput, type AiSetup } from "@/lib/ai/gateway";
import { parseServerEnv } from "@/lib/env.server";

// The AI gateway and the Cloudflare adapter with a fake `fetch`. No network: every test injects
// the fetch implementation, and a global spy fails the file if anything else calls the real one.

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "test-token-not-real";
const MODEL = "@cf/test/model-1";
const Out = z.object({ answer: z.string(), n: z.number() });

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const ok = (response: unknown, usage = { prompt_tokens: 120, completion_tokens: 30 }) =>
  json(200, { success: true, errors: [], result: { response, usage } });

function setup(fetchImpl: typeof fetch, limits: Partial<AiSetup["limits"]> = {}): AiSetup {
  return {
    provider: createCloudflareProvider(
      { accountId: ACCOUNT, apiToken: TOKEN, model: MODEL },
      fetchImpl,
    ),
    limits: { maxOutputTokens: 500, maxInputChars: 2000, timeoutMs: 5000, ...limits },
    planStrategy: "full",
  };
}
const req = { system: "Return JSON.", user: "Question", schema: Out };

describe("Cloudflare adapter request", () => {
  it("posts one chat request with JSON mode, token limit and bearer auth", async () => {
    const f = vi.fn<typeof fetch>(async () => ok({ answer: "yes", n: 1 }));
    const r = await generateJson(setup(f), req);
    expect(r).toMatchObject({ ok: true, data: { answer: "yes", n: 1 } });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init?.body));
    expect(body.messages).toEqual([
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Question" },
    ]);
    expect(body.max_tokens).toBe(500);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.properties).toHaveProperty("answer");
    expect(body.response_format.json_schema).not.toHaveProperty("$schema");
    expect(String(init?.body)).not.toContain(TOKEN);
  });

  it("records usage and latency, and accepts a string response with a code fence", async () => {
    const f = vi.fn<typeof fetch>(async () => ok('```json\n{"answer":"a","n":2}\n```'));
    const r = await generateJson(setup(f), req);
    expect(r.ok).toBe(true);
    expect(r.meta).toMatchObject({
      provider: "cloudflare",
      model: MODEL,
      requests: 1,
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    expect(r.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("failures: one request, never retried, mapped to a code", () => {
  it.each([
    [
      "auth",
      json(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] }),
      "auth_failed",
    ],
    ["forbidden", json(403, { success: false, errors: [] }), "auth_failed"],
    [
      "quota 429",
      json(429, { success: false, errors: [] }, { "retry-after": "60" }),
      "rate_limited",
    ],
    [
      "daily allocation",
      json(400, {
        success: false,
        errors: [
          { code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" },
        ],
      }),
      "rate_limited",
    ],
    [
      "unknown model",
      json(400, { success: false, errors: [{ code: 5007, message: "No such model" }] }),
      "model_unavailable",
    ],
    ["404", json(404, "not found"), "model_unavailable"],
    [
      "JSON mode unmet",
      json(400, { success: false, errors: [{ message: "JSON Mode couldn't be met" }] }),
      "invalid_output",
    ],
    ["server error", json(500, "oops"), "provider_error"],
    ["gateway timeout", json(504, ""), "timeout"],
    ["success:false 200", json(200, { success: false, errors: [] }), "provider_error"],
    ["unreadable 200", json(200, "<html>"), "provider_error"],
  ] as const)("%s", async (_name, response, code) => {
    const f = vi.fn<typeof fetch>(async () => response.clone());
    const r = await generateJson(setup(f), req);
    expect(r).toMatchObject({ ok: false, code });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("passes on Retry-After for quota errors", async () => {
    const f = vi.fn<typeof fetch>(async () =>
      json(429, { success: false }, { "retry-after": "60" }),
    );
    expect((await generateJson(setup(f), req)).meta.retryAfterSeconds).toBe(60);
  });

  it("maps timeouts and network errors", async () => {
    const timeout = vi.fn<typeof fetch>(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await generateJson(setup(timeout), req)).toMatchObject({ ok: false, code: "timeout" });
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await generateJson(setup(down), req)).toMatchObject({
      ok: false,
      code: "provider_error",
    });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized responses", async () => {
    const f = vi.fn<typeof fetch>(async () => ok("x".repeat(300 * 1024)));
    expect(await generateJson(setup(f), req)).toMatchObject({ ok: false, code: "provider_error" });
  });
});

describe("output validation", () => {
  it("malformed JSON, schema failures and business-check failures are invalid_output, with one request", async () => {
    for (const [response, check] of [
      ["{not json", undefined],
      [{ answer: "x" }, undefined],
      [{ answer: "x", n: 1 }, () => ["n must be 2"]],
    ] as const) {
      const f = vi.fn<typeof fetch>(async () => ok(response));
      const r = await generateJson(setup(f), { ...req, check });
      expect(r).toMatchObject({ ok: false, code: "invalid_output" });
      expect(r.meta.validationErrors).toBeGreaterThan(0);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("parseOutput never returns validation text (it may echo model output)", () => {
    expect(parseOutput('{"answer":1}', Out)).toEqual({ ok: false, errors: 2 });
  });

  it("refuses an over-long prompt without sending anything", async () => {
    const f = vi.fn<typeof fetch>();
    const r = await generateJson(setup(f, { maxInputChars: 100 }), {
      ...req,
      user: "x".repeat(200),
    });
    expect(r).toMatchObject({ ok: false, code: "input_too_large", meta: { requests: 0 } });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("configuration", () => {
  it("AI is off by default and the setup never calls the provider", () => {
    const f = vi.fn<typeof fetch>();
    expect(aiSetup(parseServerEnv({}), f)).toBeNull();
    const s = aiSetup(
      parseServerEnv({
        AI_PROVIDER: "cloudflare",
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        CLOUDFLARE_API_TOKEN: TOKEN,
        AI_PLAN_MODEL: MODEL,
      }),
      f,
    );
    expect(s?.provider).toMatchObject({ id: "cloudflare", model: MODEL });
    expect(s?.limits).toEqual({ maxOutputTokens: 4096, maxInputChars: 14000, timeoutMs: 45000 });
    expect(s?.planStrategy).toBe("full");
    expect(f).not.toHaveBeenCalled();
  });

  it("cloudflare mode needs account id, token and model; errors name variables, never values", () => {
    let message = "";
    try {
      parseServerEnv({ AI_PROVIDER: "cloudflare", CLOUDFLARE_API_TOKEN: TOKEN });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/CLOUDFLARE_ACCOUNT_ID: required when AI_PROVIDER=cloudflare/);
    expect(message).toMatch(/AI_PLAN_MODEL: required/);
    expect(message).not.toContain(TOKEN);
    expect(() => parseServerEnv({ CLOUDFLARE_ACCOUNT_ID: "not-an-id" })).toThrow(/32-character/);
    expect(() => parseServerEnv({ AI_PLAN_MAX_OUTPUT_TOKENS: "99999" })).toThrow(
      /AI_PLAN_MAX_OUTPUT_TOKENS/,
    );
  });
});
