import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../public/app/glass-depth.css', import.meta.url), 'utf8');
const watchCss = readFileSync(new URL('../public/app/watch-sync.css', import.meta.url), 'utf8');

describe('AUREX layered glass material', () => {
  it('loads after the existing app styles without changing the four-tab dock geometry', () => {
    expect(watchCss.startsWith("@import url('/app/glass-depth.css?v=5.6.0');")).toBe(true);
    expect(css).toContain('.app-shell .bottom-nav .glass-indicator');
    expect(css).toContain('-webkit-backdrop-filter: blur(38px) saturate(195%);');
    expect(css).toContain('.app-shell .segmented input:checked + span');
    expect(css).toContain('.app-shell .builder-card');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).not.toMatch(/\.app-shell \.bottom-nav\s*\{[^}]*\b(?:width|height|grid-template-columns|transform)\s*:/);
    expect(css).not.toMatch(/\.app-shell \.bottom-nav \.glass-indicator\s*\{[^}]*\btransform\s*:/);
  });
});
