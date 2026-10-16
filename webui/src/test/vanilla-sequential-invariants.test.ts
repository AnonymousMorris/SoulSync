import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The classic sequential engine remains live after Auto Sync UI retirement. */
const CORE = readFileSync(resolve(__dirname, '../../static/core.js'), 'utf8');

function syncNextBody(): string {
  const start = CORE.indexOf('    async syncNext() {');
  expect(start, 'syncNext should exist').toBeGreaterThan(-1);
  const end = CORE.indexOf('\n    }', start);
  expect(end, 'syncNext should be a complete method').toBeGreaterThan(start);
  return CORE.slice(start, end);
}

describe('cancelling a sequential sync stays silent', () => {
  // A pending syncNext timeout can fire after cancel has emptied the queue.
  it('bails out of syncNext once the run is no longer running', () => {
    expect(syncNextBody()).toContain('if (!this.isRunning) return;');
  });

  it('bails BEFORE the completion branch, not after', () => {
    const body = syncNextBody();
    const guard = body.indexOf('if (!this.isRunning) return;');
    const done = body.indexOf('if (this.currentIndex >= this.queue.length)');
    expect(guard).toBeGreaterThan(-1);
    expect(done, 'the completion branch should still be there').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(done);
  });

  it('cancel still clears the state the guard keys off', () => {
    const start = CORE.indexOf('    cancel() {');
    const body = CORE.slice(start, CORE.indexOf('\n    }', start));
    expect(body).toContain('if (!this.isRunning) return;');
    expect(body).toContain('this.isRunning = false;');
  });
});
