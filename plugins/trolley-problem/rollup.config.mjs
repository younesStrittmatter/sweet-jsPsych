import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import { terser } from 'rollup-plugin-terser';

export default {
  input: 'src/index.ts', // Your plugin's entry point
  output: [
    {
      file: 'dist/index.browser.min.js',
      format: 'iife', // Immediately Invoked Function Expression for browser compatibility
      name: 'jsPsychTrolleyProblem', // Global variable for the plugin
      plugins: [terser()] // Minify the output
    },
    {
      file: 'dist/index.js',
      format: 'es', // ES module for modern bundlers
    },
    {
      file: 'dist/index.cjs',
      format: 'cjs', // CommonJS module
    },
  ],
  plugins: [
    resolve(), // Resolve node_modules dependencies
    commonjs(), // Convert CommonJS to ES Modules
    typescript() // Compile TypeScript
  ]
};
