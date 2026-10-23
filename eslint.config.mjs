import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Server actions have fixed (prevState, formData) signatures; "_"-prefixed args are intentional.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Planning is deterministic (playbook engine, event.md §17): no external AI SDK may be added.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@google/genai",
                "@google/generative-ai",
                "@google-cloud/vertexai",
                "@anthropic-ai/*",
                "openai",
                "groq-sdk",
              ],
              message: "Planning uses the playbook engine; no external AI SDK.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
