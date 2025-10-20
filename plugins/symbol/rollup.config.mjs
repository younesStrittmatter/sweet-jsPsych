import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import { terser } from "rollup-plugin-terser";

/** @type {import('rollup').RollupOptions[]} */
export default [
  // ESM
  {
    input: "src/index.ts",
    external: ["jspsych"],
    output: { file: "dist/index.js", format: "es", sourcemap: true },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: "./tsconfig.json", outputToFilesystem: true })
    ]
  },

  // CJS
  {
    input: "src/index.ts",
    external: ["jspsych"],
    output: { file: "dist/index.cjs", format: "cjs", exports: "auto", sourcemap: true },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: "./tsconfig.json", outputToFilesystem: true })
    ]
  },

  // IIFE (browser CDN) — exposes global `jsPsychSymbol`
  {
    input: "src/index.ts",
    external: ["jspsych"],
    output: {
      file: "dist/index.browser.min.js",
      format: "iife",
      name: "jsPsychSymbol",
      globals: { jspsych: "jsPsych" },
      sourcemap: false
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: "./tsconfig.json", outputToFilesystem: true }),
      terser()
    ]
  }
];
