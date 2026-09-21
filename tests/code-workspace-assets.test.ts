import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Mini App imported-code workspace and fixture fallback assets', () => {
  it('loads the refreshed editor, schedules, and four navigation tabs', () => {
    const html = read('../public/app/index.html');
    const code = read('../public/app/code-analysis.js');
    const editor = read('../public/app/code-workspace.js');
    const schedule = read('../public/app/schedule-hints.js');
    const css = read('../public/app/code-workspace.css');
    expect(html).toContain('/app/code-analysis.js?v=6.1.0');
    expect(html).toContain('/app/watch-sync.js?v=5.3.0');
    expect(code).toContain("import './code-workspace.js?v=6.1.0'");
    expect(code).toContain("import './schedule-hints.js?v=5.4.0'");
    expect(code).toContain('/api/miniapp/import-code');
    expect(editor).toContain('/api/miniapp/code-options');
    expect(editor).toContain('action, ...extra');
    expect(editor).toContain('Trim & generate NEW code');
    expect(editor).toContain('void generate(true)');
    expect(editor).toContain("await edit('reanalyze')");
    expect(editor).toContain("api('/api/miniapp/code', data)");
    expect(editor).toContain('maximumOdds');
    expect(schedule).toContain('scheduleDay');
    expect(css).toContain('prefers-reduced-motion');
    for (const tab of ['build', 'analyze', 'slip', 'explore'])
      expect(html).toContain(`id="${tab}-tab"`);
    expect(() => new Script(editor, { filename: 'code-workspace.js' })).not.toThrow();
    expect(() => new Script(schedule, { filename: 'schedule-hints.js' })).not.toThrow();
    expect(() => new Script(code.replace(/^import .*;\n/gm, ''), { filename: 'code-analysis.js' }))
      .not.toThrow();
  });
  it('checks fresh provider odds against the user maximum before booking', () => {
    const server = read('../src/api/mini-app-routes.ts');
    expect(server).toContain('maximumOdds: z.number().finite().min(1.01)');
    expect(server).toContain('preparation.currentOdds > input.maximumOdds');
    expect(server.indexOf("status: 'target_exceeded'")).toBeLessThan(
      server.indexOf('deps.sportyBet.createBookingCode(preparation.selections)'));
  });
});
