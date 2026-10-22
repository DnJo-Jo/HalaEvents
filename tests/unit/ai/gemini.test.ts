import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generate } from "@/lib/ai/client";
import { createGeminiProvider, toGeminiSchema } from "@/lib/ai/gemini";
import type { ProviderRequest } from "@/lib/ai/types";

// The Gemini REST adapter against a fake fetch (recorded requests, canned responses). No network.

const KEY = "AIza-test-key-not-real";

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answer = (text: string, finishReason = "STOP") =>
  json(200, {
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
    modelVersion: "gemini-test-001",
  });

const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  pipeline: "plan",
  system: "sys",
  messages: [{ role: "user", content: "hello" }],
  jsonSchema: {
    type: "object",
    properties: { a: { type: "string", pattern: "^x$", maxLength: 3 } },
    additionalProperties: false,
  },
  temperature: 0.2,
  maxOutputTokens: 100,
  signal: AbortSignal.timeout(5000),
  context: null,
  ...over,
});

describe("Gemini REST adapter", () => {
  it("sends structured-output requests with the key in a header, never in the URL", async () => {
    const f = fakeFetch(() => answer('{"a":"x"}'));
    const g = createGeminiProvider({ apiKey: KEY, model: "gemini-2.5-flash", fetchImpl: f.fn });
    const r = await g.generate(req());
    expect(r).toEqual({
      ok: true,
      text: '{"a":"x"}',
      model: "gemini-test-001",
      usage: { inputTokens: 120, outputTokens: 40 },
    });
    const { url, init, body } = f.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 100,
      },
    });
    // Unsupported JSON-schema keywords are stripped (Zod still enforces them on the response).
    expect((body.generationConfig as { responseJsonSchema: unknown }).responseJsonSchema).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    });
  });

  it("refuses model names that could alter the request path", () => {
    for (const model of ["../secrets", "gemini/flash", "", "Gemini Flash"]) {
      expect(() => createGeminiProvider({ apiKey: KEY, model, fetchImpl: fetch })).toThrow();
    }
  });

  it.each([
    [
      429,
      {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" }],
        },
      },
      { code: "rate_limited", retryAfterSeconds: 17 },
    ],
    [404, { error: { code: 404, status: "NOT_FOUND" } }, { code: "model_unavailable" }],
    [403, { error: { code: 403, status: "PERMISSION_DENIED" } }, { code: "not_configured" }],
    [
      400,
      { error: { code: 400, status: "INVALID_ARGUMENT" } },
      { code: "provider_error", retryable: false },
    ],
    [
      503,
      { error: { code: 503, status: "UNAVAILABLE" } },
      { code: "provider_error", retryable: true },
    ],
  ])("maps HTTP %i to %o", async (status, body, expected) => {
    const f = fakeFetch(() => json(status, body));
    const r = await createGeminiProvider({
      apiKey: KEY,
      model: "gemini-x",
      fetchImpl: f.fn,
    }).generate(req());
    expect(r).toMatchObject({ ok: false, ...expected });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("maps network failures, aborts and truncated or blocked answers", async () => {
    const make = (respond: () => Response | Promise<Response>) =>
      createGeminiProvider({ apiKey: KEY, model: "gemini-x", fetchImpl: fakeFetch(respond).fn });
    expect(
      await make(() => Promise.reject(new TypeError("fetch failed"))).generate(req()),
    ).toMatchObject({ code: "network", retryable: true });
    expect(
      await make(() =>
        Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })),
      ).generate(req()),
    ).toMatchObject({ code: "timeout", retryable: true });
    expect(await make(() => answer('{"a":', "MAX_TOKENS")).generate(req())).toMatchObject({
      code: "invalid_output",
    });
    expect(
      await make(() => json(200, { promptFeedback: { blockReason: "SAFETY" } })).generate(req()),
    ).toMatchObject({ code: "provider_error" });
    expect(
      await make(() => new Response("<html>oops</html>", { status: 200 })).generate(req()),
    ).toMatchObject({ code: "provider_error" });
  });

  it("works end to end with the shared client: malformed answer → repair → valid data", async () => {
    let n = 0;
    const f = fakeFetch(() => answer(n++ === 0 ? '{"a": 5}' : '{"a":"x"}'));
    const g = createGeminiProvider({ apiKey: KEY, model: "gemini-x", fetchImpl: f.fn });
    const r = await generate(g, {
      pipeline: "plan",
      system: "s",
      prompt: "p",
      schema: z.object({ a: z.string() }),
    });
    expect(r).toMatchObject({
      ok: true,
      data: { a: "x" },
      attempts: 2,
      usage: { inputTokens: 240, outputTokens: 80 },
    });
    expect(f.calls[1].body.contents).toHaveLength(3); // prompt, previous answer, repair request
  });

  it("schema sanitizer keeps nested structure", () => {
    expect(
      toGeminiSchema({
        type: "array",
        items: { anyOf: [{ type: "string", minLength: 1 }, { type: "number" }] },
        maxItems: 2,
      }),
    ).toEqual({
      type: "array",
      items: { anyOf: [{ type: "string" }, { type: "number" }] },
      maxItems: 2,
    });
  });
});
