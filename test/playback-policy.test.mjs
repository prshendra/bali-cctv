import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackLimit, playerKeysToStop } from '../dist/playback-policy.js';

test('compact playback allows only one player and keeps the requested target', () => {
  assert.equal(playbackLimit(true), 1);
  assert.deepEqual(playerKeysToStop(['cam-a', 'cam-b'], 'cam-b', playbackLimit(true)), ['cam-a']);
});

test('a new compact target releases every existing player', () => {
  assert.deepEqual(playerKeysToStop(['cam-a', 'cam-b'], 'focus', playbackLimit(true)), ['cam-a', 'cam-b']);
});

test('desktop playback keeps the existing batch behavior', () => {
  assert.equal(playbackLimit(false), Infinity);
  assert.deepEqual(playerKeysToStop(['cam-a', 'cam-b'], 'cam-c', playbackLimit(false)), []);
});
