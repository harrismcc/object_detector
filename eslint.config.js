import tseslint from "typescript-eslint";
import noHardcodedColors from "./eslint-rules/no-hardcoded-colors.js";

export default tseslint.config(
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    extends: [tseslint.configs.base],
    plugins: {
      custom: {
        rules: {
          "no-hardcoded-colors": noHardcodedColors,
        },
      },
    },
    rules: {
      "custom/no-hardcoded-colors": "error",
    },
  },
  {
    ignores: ["node_modules", "dist", ".next"],
  },
);
