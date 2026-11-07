import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff } from '../src/lib/diff-parse.ts'

const patch = [
  ' a.ts | 2 +-', ' 1 file changed', '',
  'diff --git a/a.ts b/a.ts', 'index 1..2 100644', '--- a/a.ts', '+++ b/a.ts',
  '@@ -3,2 +3,2 @@ function f() {', ' keep', '-old', '+new', '\\ No newline at end of file', '',
].join('\n')

test('drops the stat preamble and numbers lines from the hunk header', () => {
  const [file, ...rest] = parseDiff(patch)
  assert.equal(rest.length, 0)
  assert.equal(file.path, 'a.ts')
  assert.deepEqual([file.added, file.deleted], [1, 1])
  assert.deepEqual(file.lines.map(line => [line.type, line.oldNo, line.newNo]), [['hunk', undefined, undefined], ['ctx', 3, 3], ['del', 4, undefined], ['add', undefined, 4], ['note', undefined, undefined]])
  assert.equal(file.lines[0].text, 'function f() {')
})

test('uses the old path for deleted files and records binary notes', () => {
  const [deleted, binary] = parseDiff('diff --git a/x.ts b/x.ts\ndeleted file mode 100644\n--- a/x.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\ndiff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n')
  assert.equal(deleted.path, 'x.ts')
  assert.deepEqual(deleted.notes, ['Archivo eliminado'])
  assert.deepEqual(binary.notes, ['Archivo binario'])
})

test('hunks carry their index and original header for staging', () => {
  const [file] = parseDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@ one\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d\n')
  assert.equal(file.hunks, 2)
  assert.deepEqual(file.lines.filter(line => line.type === 'hunk').map(line => [line.index, line.header]), [[0, '@@ -1,1 +1,1 @@ one'], [1, '@@ -9,1 +9,1 @@']])
})
