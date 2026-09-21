import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
describe('isolated Aurex redesign', () => {
  it('loads one complete visual system and does not load rejected skins', () => {
    const enhancement = read('../public/app/delight.js');
    const skin = read('../public/app/aurex-rebuild.css');
    const ui = read('../public/app/aurex-rebuild.js');
    expect(enhancement).toContain('/app/aurex-rebuild.css?v=4.0.0');
    expect(enhancement).toContain("import('./aurex-rebuild.js?v=4.0.0')");
    expect(enhancement).toContain('link.disabled = true');
    for (const rejected of ['aurex-reset.css', 'aurex-white-green.css', 'aurex-maximalist.css', 'redesign-preview.css', 'fluid-intelligence.css', "import('./redesign-preview.js", "import('./fluid-intelligence.js"])
      expect(enhancement).not.toContain(rejected);
    for (const component of ['.hero-copy', '.tool-grid', '.slip-summary', '.desk-panel', '.bottom-nav'])
      expect(skin).toContain(component);
    for (const id of ['#build-view', '#analyze-view', '#slip-view', '#explore-view'])
      expect(ui).toContain(id);
    expect(skin).toContain('prefers-reduced-motion');
    expect(enhancement).not.toContain('fetch(');
    expect(() => new Script(enhancement, { filename: 'delight.js' })).not.toThrow();
    expect(() => new Script(ui, { filename: 'aurex-rebuild.js' })).not.toThrow();
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
