/**
 * [CONST] Constitution Principle II (task T063).
 *
 * "Clearing cached video MUST NOT be able to reach unpublished work. The
 *  separation MUST hold by construction, not by careful coding."
 *
 * "By construction" is the operative phrase, and it is why this test reads
 * SOURCE rather than calling functions. A behavioural test could only show that
 * clearing the cache does not currently touch the database. That is a statement
 * about today's implementation, and the next edit invalidates it silently.
 *
 * What the principle demands is that it CANNOT — that the capability is absent.
 * So the assertion is about the module graph: videoCache has no path to the
 * database or the queue, and therefore no edit inside it can lose authored work.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8');

/**
 * Strip comments before matching.
 *
 * These modules document what they deliberately do NOT do — queue.ts explains at
 * length that there is no clear(), no prune(), and no expiry. Grepping the raw
 * text finds those words in the prose and "fails" on the comment that exists to
 * prevent the very thing being checked for. Assert against code only.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Every module path imported by a source file. */
function importsOf(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

describe('videoCache cannot reach authored work [CONST]', () => {
  const raw = read('data/cache/videoCache.ts');
  const source = stripComments(raw);
  const imports = importsOf(source);

  it('imports nothing from the database layer', () => {
    const offenders = imports.filter(
      (i) => i.includes('data/db') || i.includes('/db/repositories') || i.includes('expo-sqlite'),
    );
    expect(offenders).toEqual([]);
  });

  it('imports nothing from the sync queue', () => {
    const offenders = imports.filter(
      (i) => i.includes('data/sync') || i.includes('queue') || i.includes('syncEngine'),
    );
    expect(offenders).toEqual([]);
  });

  it('only depends on the filesystem', () => {
    // If this list ever needs widening, stop and ask what the cache is doing
    // that requires a new dependency — that is the conversation this test exists
    // to force.
    expect(imports).toEqual(['expo-file-system/legacy']);
  });

  it('mentions no SQL', () => {
    expect(source).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE FROM|pending_saves|video_metadata)\b/);
  });

  it('exposes clearing functions that take only a folder id', () => {
    // clearFolder(folderId) / clearAll() — nothing that could name a save.
    expect(source).toMatch(/export async function clearFolder\(folderId: string\)/);
    expect(source).toMatch(/export async function clearAll\(\)/);
  });
});

describe('the reverse direction is allowed', () => {
  it('callers may clear the cache and update the db separately', () => {
    // The folder screen does both, in that order. That is fine: the CALLER is
    // allowed to know about both. What must never exist is a path from inside
    // the cache module into the database.
    const screen = readFileSync(
      join(__dirname, '..', '..', 'app', 'folder', '[folderId].tsx'),
      'utf8',
    );
    expect(screen).toMatch(/videoCache\.clearFolder/);
    expect(screen).toMatch(/videos\.clearCachedPaths/);
  });
});

describe('the pending-save queue has no discard-on-failure path [Principle II]', () => {
  const queueSource = stripComments(read('data/sync/queue.ts'));
  const repoSource = stripComments(read('data/db/repositories.ts'));

  it('exposes exactly two exits: resolve (success) and discard (user)', () => {
    expect(queueSource).toMatch(/export const resolve/);
    expect(queueSource).toMatch(/export const discard/);
  });

  it('has no bulk-clear, prune, or expiry', () => {
    // Each of these would be a way for authored work to leave the queue without
    // either succeeding or the user asking.
    for (const forbidden of [/export .*\bclear\b/, /\bprune\b/, /\bexpire\b/, /\bdropOlderThan\b/]) {
      expect(queueSource).not.toMatch(forbidden);
    }
  });

  it('recordFailure does not delete', () => {
    const fn = repoSource.slice(repoSource.indexOf('async recordFailure'));
    const body = fn.slice(0, fn.indexOf('},'));
    expect(body).not.toMatch(/DELETE/);
    expect(body).toMatch(/UPDATE pending_saves/);
  });
});
