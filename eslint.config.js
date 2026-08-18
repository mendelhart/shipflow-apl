import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  {
    // Widened from components+pages: src/domain, src/lib, src/hooks, src/utils
    // and src/api were never linted at all, which is a lot of the code that
    // documents and labels are built from.
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    // src/lib was excluded and is where emailDocs, aiClient and the label
    // builders live. Only the vendored shadcn components stay out.
    ignores: ["src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      // `...pluginJs.configs.recommended` above is overwritten by this `rules`
      // object, so no-undef was never actually on. A missing import is then a
      // bare global: Rollup does not complain, the build succeeds, and the page
      // dies at runtime with "X is not defined". That is exactly how a missing
      // `groupPosByShipMonth` import shipped to production.
      "no-undef": "error",
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
