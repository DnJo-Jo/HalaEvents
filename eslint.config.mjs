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
      // Gemini is called over REST from src/lib/ai/gemini.ts only; no vendor SDK (event.md §17.1).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@google/genai", "@google/generative-ai", "@google-cloud/vertexai"],
              message: "Call Gemini through src/lib/ai (REST adapter); no vendor SDK.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/ai/gemini.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/generativelanguage\\.googleapis\\.com/]",
          message: "Only src/lib/ai/gemini.ts may talk to the Gemini API.",
        },
        {
          selector: "TemplateElement[value.raw=/generativelanguage\\.googleapis\\.com/]",
          message: "Only src/lib/ai/gemini.ts may talk to the Gemini API.",
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
