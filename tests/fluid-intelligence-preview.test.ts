import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Aurex emerald maximalist preview', () => {
  it('loads the approved design only through the preview entrypoint and has all four screens', () => {
    const entry = read('../public/app/delight.js');
    const ui = read('../public/app/aurex-white-green.js');
    const share = read('../public/app/aurex-slip-export.js');
    const skin = read('../public/app/aurex-white-green.css');
    const maximalist = read('../public/app/aurex-maximalist.css');
    const html = read('../public/app/index.html');
    expect(entry).toContain('/app/aurex-white-green.css?v=1.0.0');
    expect(entry).toContain('/app/aurex-maximalist.css?v=1.0.0');
    expect(entry).toContain("import('./aurex-white-green.js?v=1.0.0')");
    expect(entry).toContain("import('./aurex-slip-export.js?v=1.0.0')");
    expect(entry).not.toContain('/app/fluid-intelligence.css');
    expect(() => new Script(ui, { filename: 'aurex-white-green.js' })).not.toThrow();
    expect(() => new Script(share, { filename: 'aurex-slip-export.js' })).not.toThrow();
    for (const id of ['build', 'analyze', 'slip', 'explore']) {
      expect(html).toContain(`id="${id}-view"`);
      expect(html).toContain(`id="${id}-tab"`);
    }
    expect(skin + maximalist).toContain('.bottom-nav');
  });

  it('uses actual slip data and existing provider-backed controls rather than fabricated outcomes', () => {
    const ui = read('../public/app/aurex-white-green.js');
    const share = read('../public/app/aurex-slip-export.js');
    const html = read('../public/app/index.html');
    expect(ui + share).not.toMatch(/\bfetch\s*\(/);
    expect(share).toContain("localStorage.getItem('aurex-active-slip')");
    expect(share).not.toContain('analysisToken');
    expect(share).not.toContain('initData');
    for (const id of ['build-form', 'read-code-form', 'generate-code', 'pick-list', 'desk-fixtures']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('links the preview home to static UI, keeps API routing, and supports accessibility', () => {
    const config = JSON.parse(read('../vercel.json')) as {
      routes: Array<{ src?: string; status?: number; headers?: Record<string, string>; dest?: string }>;
    };
    const ui = read('../public/app/aurex-white-green.js');
    const share = read('../public/app/aurex-slip-export.js');
    const skin = read('../public/app/aurex-white-green.css');
    expect(config.routes[0]).toEqual({ src: '/', headers: { Location: '/app/' }, status: 307 });
    expect(config.routes).toContainEqual({ src: '/.*', dest: '/api' });
    expect(ui + share).toContain('aria-label');
    expect(share).toContain("button.type='button'");
    expect(skin).toContain('prefers-reduced-motion:reduce');
  });
});
