import assert from 'node:assert/strict'
import test from 'node:test'
import { bumpVersion, compareVersions, isVersion, recommendedBump, versionOptions } from '../src/lib/release-flow.ts'

test('recommends the bump from conventional commits', () => {
  assert.equal(recommendedBump(['fix: a', 'chore: b']), 'patch')
  assert.equal(recommendedBump(['fix: a', 'feat(ui): b']), 'minor')
  assert.equal(recommendedBump(['feat: a', 'refactor!: b']), 'major')
  assert.equal(recommendedBump([]), 'patch')
})

test('builds version options with a single recommendation', () => {
  const options = versionOptions('0.3.1', ['feat: x'])
  assert.deepEqual(options.map(o => o.version), ['0.3.2', '0.4.0', '1.0.0'])
  assert.deepEqual(options.filter(o => o.recommended).map(o => o.bump), ['minor'])
})

test('validates and compares versions', () => {
  assert.equal(bumpVersion('1.9.9', 'patch'), '1.9.10')
  assert.ok(isVersion('1.2.3') && !isVersion('1.2') && !isVersion('1.2.3-beta'))
  assert.ok(compareVersions('0.4.0', '0.3.9') > 0 && compareVersions('1.0.0', '1.0.0') === 0)
})
