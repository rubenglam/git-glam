import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReleaseNotes } from '../src/lib/release-notes.ts'

test('parses generated release notes into sections', () => {
  const sections = parseReleaseNotes('### Novedades\n- a\n- b\n\n### Correcciones\n- c')
  assert.deepEqual(sections, [{ title: 'Novedades', items: ['a', 'b'] }, { title: 'Correcciones', items: ['c'] }])
})

test('keeps plain text and ignores empty notes', () => {
  assert.deepEqual(parseReleaseNotes('Sin cambios'), [{ title: '', items: ['Sin cambios'] }])
  assert.deepEqual(parseReleaseNotes(''), [])
  assert.deepEqual(parseReleaseNotes(undefined), [])
})
