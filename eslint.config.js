// ESLint flat config. Cannot be executed in this environment yet — the npm
// registry is unreachable, so eslint/@typescript-eslint are not installed
// (see README "Known limitations"). Kept here so `npm run lint` works as
// soon as install is possible, and so the sim-restriction rule is reviewable
// now rather than only described in prose.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// Hard rule from the Engine Architecture doc: packages/sim must never touch
// window/document/Date.now/performance.now/Math.random, or any transcendental
// Math.* function — only the fixed-point/LUT module may produce those values,
// and that module is generated offline (scripts/generate-trig-lut.mjs), not
// at sim runtime.
const simRestrictedGlobals = [
  {
    selector: "MemberExpression[object.name='window']",
    message: 'packages/sim must not reference window (determinism).',
  },
  {
    selector: "MemberExpression[object.name='document']",
    message: 'packages/sim must not reference document (determinism).',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'packages/sim must not call Date.now() (determinism). Use the tick counter.',
  },
  {
    selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']",
    message: 'packages/sim must not call performance.now() (determinism).',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'packages/sim must not call Math.random() (determinism). Use math/prng.ts.',
  },
  {
    selector:
      "CallExpression[callee.object.name='Math'][callee.property.name=/^(sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|pow|sqrt|cbrt|sinh|cosh|tanh)$/]",
    message:
      'packages/sim must not call transcendental Math.* (determinism). Use math/fixed.ts LUT-based trig/sqrt, or the offline generator for new tables.',
  },
];

export default [
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Scoped override: only packages/sim gets the determinism restriction.
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...simRestrictedGlobals],
    },
  },
  {
    // The offline LUT generator is explicitly exempt: it is the one place
    // allowed to call Math.sin/Math.cos, and it lives outside packages/sim.
    files: ['scripts/generate-trig-lut.mjs'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
