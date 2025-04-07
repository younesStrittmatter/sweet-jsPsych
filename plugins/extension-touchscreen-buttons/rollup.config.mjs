import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';

export default {
  input: 'index.js',
  output: {
    file: 'dist/index.js',
    format: 'esm', // or 'umd' if you want browser/global compatibility
    sourcemap: true
  },
  plugins: [commonjs(), terser()]
};