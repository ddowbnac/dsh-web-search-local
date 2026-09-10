import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The package declares `dsh.bundle.patch`, which is what makes
 * `dsh plugin --profile <name> add <package>` mount the integration
 * automatically (the dsh plugin command reconciles `dsh.profile.bundles`
 * against every dependency that declares a bundle patch). These tests pin
 * that declaration and the patch's shape so the one-command install keeps
 * working: the patch must register the plugin row, pin the `web` row, and
 * must not silently index the boot directory (the layer applies without the
 * user's say-so, so it carries no opinionated corpus default).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  files?: string[];
  exports?: Record<string, unknown>;
  dsh?: { bundle?: { patch?: string } };
};

function patchRows(): any[] {
  const rel = manifest.dsh?.bundle?.patch;
  expect(rel, 'package.json must declare dsh.bundle.patch').toBeTypeOf('string');
  const text = readFileSync(join(ROOT, rel!), 'utf8');
  const doc = Bun.YAML.parse(text);
  expect(Array.isArray(doc), 'the bundle patch must be a top-level patch list').toBe(true);
  return doc as any[];
}

describe('dsh bundle declaration (one-command install)', () => {
  test('package.json declares dsh.bundle.patch pointing at a shipped file', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
    expect(existsSync(join(ROOT, 'cordis.patch.yml'))).toBe(true);
    expect(manifest.files).toContain('cordis.patch.yml');
    // In-box convention: the patch is addressable through the package exports.
    expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml');
  });

  test('the patch inserts the plugin row named after the package', () => {
    const rows = patchRows();
    const insert = rows.find((r) => r && Array.isArray(r.insert))?.insert;
    expect(insert, 'the patch must carry an insert list').toBeDefined();
    const row = insert.find((r: any) => r.id === 'web-search-local');
    expect(row, 'the patch must insert the web-search-local row').toBeDefined();
    expect(row.name).toBe(manifest.name);
  });

  test('the patch pins the web row: searchProvider web + fetchProvider local', () => {
    const rows = patchRows();
    const web = rows.find((r) => r && r.id === 'web');
    expect(web, 'the patch must carry the web row override').toBeDefined();
    expect(web.config).toEqual({ searchProvider: 'web', fetchProvider: 'local' });
  });

  test('the auto-applied layer sets no opinionated defaults (corpusDirs stays unset)', () => {
    const rows = patchRows();
    const insert = rows.find((r) => r && Array.isArray(r.insert))?.insert;
    const row = insert.find((r: any) => r.id === 'web-search-local');
    expect(row.config?.corpusDirs, 'an auto-applied layer must not index the boot cwd by default').toBeUndefined();
    expect(row.config?.engine, 'the auto-applied layer must not force an engine choice').toBeUndefined();
  });
});
