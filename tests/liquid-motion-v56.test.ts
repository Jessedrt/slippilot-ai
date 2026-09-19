import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../public/app/${path}`, import.meta.url), 'utf8');

describe('AUREX compact liquid glass and motion', () => {
  it('loads the new stylesheet after earlier CSS and initializes the lens once', () => {
    const css = read('watch-sync.css');
    const js = read('glass-feel.js');
    expect(css).toContain("@import url('/app/liquid-motion-v56.css?v=5.6.0');");
    expect(js).toContain("import './liquid-motion-v56.js?v=5.6.0';");
    expect(css.indexOf('@import')).toBeLessThan(css.indexOf('.watch53 {'));
  });

  it('keeps radios as the source of truth and tracks async sports and resizing', () => {
    const code = read('liquid-motion-v56.js');
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain("input[name=\"sport\"]:checked");
    expect(code).toContain("addEventListener('change', schedule)");
    expect(code).toContain('new MutationObserver(schedule)');
    expect(code).toContain('new ResizeObserver(schedule)');
    expect(code).not.toContain('.click()');
    expect(code).not.toContain('preventDefault()');
  });

  it('preserves compact four-column dock, focus and accessibility fallbacks', () => {
    const css = read('liquid-motion-v56.css');
    const alignment = read('nav-alignment.css');
    expect(alignment).toContain('repeat(4, minmax(0, 1fr))');
    expect(css).not.toContain('grid-template-columns:');
    expect(css).toContain('overflow: visible;');
    expect(css).toContain('.segmented label:focus-within span');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))');
  });
});
