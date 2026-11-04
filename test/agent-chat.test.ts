import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { parseAgentLine, agentArgs, runAgent } from '../electron/agent-chat.ts'

test('stream-json lines become UI events', () => {
  assert.deepEqual(parseAgentLine('{"type":"system","subtype":"init","session_id":"abc-12345"}'), { type: 'session', sessionId: 'abc-12345' })
  assert.deepEqual(parseAgentLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}'), { type: 'delta', text: 'hi' })
  assert.deepEqual(parseAgentLine('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.js"}}]}}'), { type: 'tools', tools: [{ name: 'Read', detail: 'a.js' }] })
  assert.deepEqual(parseAgentLine('{"type":"result","result":"ok","is_error":false,"session_id":"abc-12345","modelUsage":{"m":{"contextWindow":1000000}}}'), { type: 'done', text: 'ok', error: false, sessionId: 'abc-12345', contextWindow: 1000000 })
  assert.deepEqual(parseAgentLine('{"type":"assistant","message":{"content":[],"usage":{"input_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":5,"output_tokens":20}}}'), { type: 'tools', tools: [], tokens: 135 })
  assert.equal(parseAgentLine('not json'), null)
})

test('read mode restricts tools and resume reuses the session', () => {
  assert.ok(agentArgs({ mode: 'read' }).includes('--allowed-tools'))
  assert.ok(agentArgs({ mode: 'edit' }).includes('acceptEdits'))
  assert.deepEqual(agentArgs({ sessionId: 's-1234567' }).slice(-2), ['--resume', 's-1234567'])
})

test('runAgent streams events and validates input', () => {
  assert.throws(() => runAgent('/x', { prompt: '  ' }, () => {}), /prompt/)
  assert.throws(() => runAgent('/x', { prompt: 'a', sessionId: '--bad' }, () => {}), /Sesión/)
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { end() {} }), kill() {} })
  const events: any[] = []
  runAgent('/x', { prompt: 'hola' }, event => events.push(event), () => child)
  child.stdout.emit('data', '{"type":"result","result":"fin"}\n')
  child.emit('close', 0)
  assert.deepEqual(events.map(event => event.type), ['done'])
})
