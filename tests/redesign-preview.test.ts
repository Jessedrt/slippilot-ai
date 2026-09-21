import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('isolated Aurex redesign', () => {
  it('loads one coherent skin and does not load rejected preview modules', () => {
    const enhancement = read('../public/app/delight.js');
    const skin = read('../public/app/aurex-reset.css');
    expect(enhancement).toContain('/app/aurex-reset.css?v=3.0.0');
    for (const rejected of ['redesign-preview.css', 'redesign-layout-fixes.css', 'fluid-intelligence.css', 'fluid-layout-patch.css', "import('./redesign-preview.js", "import('./fluid-intelligence.js"])
      expect(enhancement).not.toContain(rejected);
    for (const view of ['#build-view', '#analyze-view', '#slip-view', '#explore-view'])
      expect(skin).toContain(view);
    expect(skin).toContain('prefers-reduced-motion');
    expect(enhancement).not.toContain('fetch(');
    expect(() => new Script(enhancement, { filename: 'delight.js' })).not.toThrow();
  });

  it('preserves build, analyze, editing and navigation entrypoints', () => {
    const html = read('../public/app/index.html');
    const code = read('../public/app/code-analysis.js');
    for (const id of ['build-form', 'read-code-form', 'slip-view', 'explore-view', 'generate-code'])
      expect(html).toContain(`id="${id}"`);
    expect(code).toContain("import './conversation-editor.js?v=7.0.0'");
    expect(code).toContain("import './code-workspace.js?v=6.2.0'");
  });
});
