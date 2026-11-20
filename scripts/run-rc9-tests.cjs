'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tests = [
  'tests/upstream-port-contracts.test.cjs',
  'tests/glass-app-build.test.cjs',
  'tests/glass-ui-contracts.test.cjs',
  'tests/supporter-license-contracts.test.cjs',
  'tests/supporter-binding.test.cjs',
  'tests/supporter-key-review.test.cjs',
  'tests/lowpower-schedule-contracts.test.cjs',
  'tests/battery-record.test.cjs',
];
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
