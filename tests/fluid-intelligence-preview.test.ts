import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Aurex fluid-intelligence visual preview', () => {
  it('is isolated to the preview entrypoint, compiles and includes all four screens', () => {
    const entry = read('../public/app/delight.js');
    const ui = read('../public/app/fluid-intelligence.js');
    const skin = read('../public/app/fluid-intelligence.css');
    expect(entry).toContain('/app/fluid-intelligence.css?v=2.0.0');
    expect(entry).toContain("import('./fluid-intelligence.js?v=2.0.0')");
    expect(() => new Script(ui, { filename: 'fluid-intelligence.js' })).not.toThrow();
    for (const id of ['#build-view', '#analyze-view', '#slip-view', '#explore-view']) {
      expect(ui + skin).toContain(id);
    }
    for (const id of ['#build-form', '#read-code-form', '#target-odds', '#slip-count']) {
      expect(ui).toContain(id);
    }
  });

  it('retains the provider-backed flows rather than rendering fictitious picks or results', () => {
    const ui = read('../public/app/fluid-intelligence.js');
    const html = read('../public/app/index.html');
    expect(ui).not.toMatch(/\bfetch\s*\(/);
    expect(ui).not.toContain('analysisToken =');
    expect(ui).not.toContain('62%');
    expect(ui).not.toContain('87/100');
    expect(ui).toContain('No selections yet');
    for (const id of ['read-code-form', 'generate-code', 'pick-list', 'explore-view'])
      expect(html).toContain(`id="${id}"`);
  });

  it('keeps accessible navigation and reduced-motion visual support', () => {
    const ui = read('../public/app/fluid-intelligence.js');
    const skin = read('../public/app/fluid-intelligence.css');
    expect(ui).toContain('aria-label');
    expect(ui).toContain("view('slip')");
    expect(skin).toContain('prefers-reduced-motion:reduce');
    expect(skin).toContain('prefers-reduced-transparency:reduce');
    expect(skin).toContain('repeat(4,minmax(0,1fr))');
  });
});
