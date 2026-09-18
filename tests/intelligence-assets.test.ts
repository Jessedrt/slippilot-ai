import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const load = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('AUREX 5.2 Mini App asset integration', () => {
  it('loads valid additive intelligence script and stylesheet after existing desk assets', () => {
    const html = load('../public/app/index.html');
    const script = load('../public/app/intelligence.js');
    const styles = load('../public/app/intelligence.css');

    expect(() => new Script(script, { filename: 'intelligence.js' })).not.toThrow();
    expect(html).toContain('/app/intelligence.css?v=5.2.0');
    expect(html).toContain('/app/intelligence.js?v=5.2.0');
    expect(html).toContain('/app/nav-alignment.css?v=5.1.0');
    expect(html).toContain('/app/desk.js?v=5.0.0');
    expect(html.indexOf('nav-alignment.css')).toBeLessThan(html.indexOf('intelligence.css'));
    expect(html.indexOf('desk.js?v=5.0.0')).toBeLessThan(html.indexOf('intelligence.js'));
    expect(script).toContain('/api/miniapp/compare-markets');
    expect(script).toContain('/api/miniapp/reliability');
    expect(script).toContain('sourceFetch(input, init)');
    expect(styles).toContain('prefers-reduced-motion');
    expect(styles).toContain('prefers-reduced-transparency');
  });
});
