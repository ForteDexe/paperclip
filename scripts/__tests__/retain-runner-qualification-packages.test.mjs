import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { retainRunnerQualificationPackages } from '../retain-runner-qualification-packages.mjs';

test('retention preserves public archives and the runner package', () => {
  const root = mkdtempSync(join(tmpdir(), 'qualification-retention-test-'));
  const sourceRevision = '1'.repeat(40), releaseVersion = '0.0.0-qualification.test';
  const put = (relative, content) => {
    const file = join(root, relative); mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content); return file;
  };
  const json = (relative, value) => put(relative, JSON.stringify(value));
  try {
    json('server/dist/build-info.json', { commit: sourceRevision });
    json('packages/outpost-runner/package.json', { name: '@outpost/outpost-runner', version: '0.0.0', private: true, files: ['dist'] });
    put('packages/outpost-runner/dist/index.js', 'export const runner = true;\n');
    const publicArchives = ['@outpost/server', '@outpost/cli', '@outpost/plugin-sdk'].map((name, i) => ({ name, file: put(`public-${i}.tgz`, `unchanged archive ${name}`) }));
    const output = join(root, 'retained');
    const result = retainRunnerQualificationPackages({ repo: root, output, sourceRevision, releaseVersion, publicArchives });
    assert.equal(result.archives.length, 4);
    for (const archive of result.archives) assert.equal(createHash('sha256').update(readFileSync(join(output, archive.file))).digest('hex'), archive.sha256);
    for (const archive of publicArchives) assert.deepEqual(readFileSync(join(output, basename(archive.file))), readFileSync(archive.file));
    assert.throws(() => retainRunnerQualificationPackages({ repo: root, output, sourceRevision, releaseVersion, publicArchives }), /Never replace/);
    assert.throws(() => retainRunnerQualificationPackages({ repo: root, output: join(root, 'wrong-source'), sourceRevision: '2'.repeat(40), releaseVersion, publicArchives }));
    assert.equal(existsSync(join(root, 'wrong-source')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
