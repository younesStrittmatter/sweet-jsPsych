// plugins/rsvp/rollup.config.mjs
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import { terser } from "rollup-plugin-terser";

export default {
  input: "src/index.ts",
  output: [
    { file: "dist/index.js", format: "esm", sourcemap: true },
    { file: "dist/index.cjs", format: "cjs", sourcemap: true },
    {
      file: "dist/index.browser.min.js",
      format: "iife",
      name: "jsPsychRsvp",
      globals: { jspsych: "jsPsych" },
      plugins: [terser()],
    },
  ],
  external: ["jspsych"],
  plugins: [
    resolve({ extensions: [".js", ".ts"] }),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json" }),
  ],
  onwarn(warning, warn) {
    if (warning.code === "CIRCULAR_DEPENDENCY") return;
    warn(warning);
  },
};
