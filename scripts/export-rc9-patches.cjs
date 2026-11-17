'use strict';
// Export and re-apply the reviewed series without staging the user's Git index.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, '..', 'rc9-port-patches'));
const manifestPath = path.join(output, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc9-patch-export-'));
const run = (args, env = process.env, encoding = 'utf8') => execFileSync('git', ['-C', root, ...args], {
  env, encoding, maxBuffer: 64 * 1024 * 1024,
});
try {
  const originalObjects = path.resolve(root, run(['rev-parse', '--git-path', 'objects']).trim());
  const objects = path.join(temp, 'objects');
  fs.mkdirSync(objects);
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temp, 'export.index'),
    GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: originalObjects };
  const files = manifest.patches.flatMap(patch => patch.files);
  assert.equal(new Set(files).size, files.length, 'Patch groups must have disjoint file sets');
  for (const file of files) {
    assert.ok(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), file);
    assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
  }
  // Refuse to silently omit a new source/test file or an unrelated tracked edit.
  const changed = run(['diff', '--name-only', '-z', manifest.upstream]).split('\0').filter(Boolean);
  const untracked = run(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const file of [...changed, ...untracked])
    assert.ok(files.includes(file), 'Unassigned working-tree change: ' + file);
  run(['read-tree', manifest.upstream], env);
  run(['add', '--', ...files], env);
  const expected = run(['write-tree'], env).trim();
  for (const patch of manifest.patches) {
    const bytes = run(['diff', '--cached', '--binary', '--no-ext-diff', manifest.upstream, '--', ...patch.files], env, null);
    assert.ok(bytes.length > 0, patch.patch);
    assert.equal(path.basename(patch.patch), patch.patch);
    fs.writeFileSync(path.join(output, patch.patch), bytes);
    patch.bytes = bytes.length;
  }
  const applyEnv = { ...env, GIT_INDEX_FILE: path.join(temp, 'apply.index') };
  run(['read-tree', manifest.upstream], applyEnv);
  for (const patch of manifest.patches) {
    const file = path.join(output, patch.patch);
    run(['apply', '--cached', '--check', '--whitespace=error-all', file], applyEnv);
    run(['apply', '--cached', '--whitespace=error-all', file], applyEnv);
  }
  assert.equal(run(['write-tree'], applyEnv).trim(), expected, 'Applied patches differ from the reviewed working tree');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Verified ${manifest.patches.length} sequential patches, ${files.length} files, exact tree ${expected}.`);
  console.log('Real index and original Git object database were not modified.');
} finally {
  assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
  fs.rmSync(temp, { recursive: true, force: true });
}
