import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Aurex white-emerald four-screen rebuild', () => {
  const entry = read('../public/app/delight.js');
  const ui = read('../public/app/aurex-rebuild.js');
  const css = read('../public/app/aurex-rebuild.css');
  const share = read('../public/app/aurex-slip-export.js');
  const html = read('../public/app/index.html');

  it('uses exactly one replacement stylesheet and compiles the new interface', () => {
    expect(entry).toContain('/app/aurex-rebuild.css?v=4.0.0');
    expect(entry).toContain("import('./aurex-rebuild.js?v=4.0.0')");
    expect(entry).toContain("import('./aurex-slip-export.js?v=1.0.0')");
    expect(entry).toContain('link.disabled = true');
    expect(entry).not.toContain('aurex-white-green.css');
    expect(entry).not.toContain('aurex-maximalist.css');
    expect(() => new Script(ui, { filename: 'aurex-rebuild.js' })).not.toThrow();
    expect(() => new Script(share, { filename: 'aurex-slip-export.js' })).not.toThrow();
  });

  it('preserves all original navigation, form, slip, provider and result elements', () => {
    for (const id of ['build', 'analyze', 'slip', 'explore']) {
      expect(html).toContain(`id="${id}-view"`);
      expect(html).toContain(`id="${id}-tab"`);
    }
    for (const id of ['build-form', 'target-odds', 'risk-mode', 'read-code-form', 'x-form', 'shot-form', 'analysis-result', 'slip-content', 'generate-code', 'pick-list', 'desk-fixtures', 'watch-items', 'history-items']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(ui).toContain("navigate('explore')");
    expect(ui).toContain("navigate('analyze')");
    expect(ui).toContain("navigate('build')");
    expect(ui).toContain('ax-fixture-search');
    expect(ui).toContain('ax-stake-input');
    expect(ui).toContain('aurex-conversation');
  });

  it('renders only provider fixtures, user history and actual stored selections', () => {
    expect(ui).not.toMatch(/\bfetch\s*\(/);
    expect(ui).not.toContain('analysisToken =');
    expect(ui).not.toContain('87/100');
    expect(ui).not.toContain('62%');
    expect(ui).toContain('No articles or predictions are invented');
    expect(ui).toContain('No bet is placed');
    expect(share).toContain("localStorage.getItem('aurex-active-slip')");
    expect(share).not.toContain('analysisToken');
    expect(share).not.toContain('initData');
  });

  it('keeps isolated static preview routing, accessible dock and reduced-motion support', () => {
    const config = JSON.parse(read('../vercel.json')) as {
      routes: Array<{ src?: string; status?: number; headers?: Record<string, string>; dest?: string }>;
    };
    expect(config.routes[0]).toEqual({ src: '/', headers: { Location: '/app/' }, status: 307 });
    expect(config.routes).toContainEqual({ src: '/.*', dest: '/api' });
    expect(ui).toContain('aria-label');
    expect(ui).toContain('aria-pressed');
    expect(css).toContain('prefers-reduced-motion:reduce');
    expect(css).toContain('prefers-reduced-transparency:reduce');
    expect(css).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(css).toContain('[hidden],.hidden');
  });
});
