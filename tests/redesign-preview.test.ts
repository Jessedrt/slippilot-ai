import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('isolated Aurex full-redesign preview', () => {
  it('loads the new preview skin through a presentation-only entrypoint', () => {
    const enhancement = read('../public/app/delight.js');
    const preview = read('../public/app/redesign-preview.js');
    const skin = read('../public/app/redesign-preview.css');
    const fixes = read('../public/app/redesign-layout-fixes.css');
    expect(enhancement).toContain('/app/redesign-preview.css?v=1.0.0');
    expect(enhancement).toContain('/app/redesign-layout-fixes.css?v=1.0.1');
    expect(enhancement).toContain("import('./redesign-preview.js?v=1.0.0')");
    expect(preview).toContain('DESIGN PREVIEW');
    expect(preview).toContain("document.querySelector(`#${name}-tab`)?.click()");
    expect(preview).not.toContain('fetch(');
    expect(preview).not.toContain('analysisToken =');
    expect(skin).toContain('body.aurex-redesign .app-shell #build-view.active');
    expect(skin).toContain('body.aurex-redesign .app-shell #explore-view.active');
    expect(fixes).toContain('position: fixed');
    expect(() => new Script(preview, { filename: 'redesign-preview.js' })).not.toThrow();
  });

  it('retains existing build, analyze, slip, explore and code-edit entrypoints', () => {
    const html = read('../public/app/index.html');
    const code = read('../public/app/code-analysis.js');
    for (const id of ['build-form', 'read-code-form', 'slip-view', 'explore-view'])
      expect(html).toContain(`id="${id}"`);
    expect(code).toContain("import './conversation-editor.js?v=7.0.0'");
    expect(code).toContain("import './code-workspace.js?v=6.2.0'");
  });
});
