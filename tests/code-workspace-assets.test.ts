import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Mini App imported-code workspace and fixture fallback assets', () => {
  it('loads the score-ranked editor and chat commands without affecting navigation', () => {
    const html = read('../public/app/index.html');
    const code = read('../public/app/code-analysis.js');
    const editor = read('../public/app/code-workspace.js');
    const chat = read('../public/app/conversation-editor.js');
    const commands = read('../public/app/chat-edit-commands.js');
    const ranker = read('../public/app/score-trim.js');
    const schedule = read('../public/app/schedule-hints.js');
    const css = read('../public/app/conversation-editor.css');
    expect(html).toContain('/app/code-analysis.js?v=7.0.0');
    expect(html).toContain('/app/watch-sync.js?v=5.3.0');
    expect(code).toContain("import './score-trim.js?v=6.2.0'");
    expect(code).toContain("import './code-workspace.js?v=6.2.0'");
    expect(code).toContain("import './chat-edit-commands.js?v=7.0.0'");
    expect(code).toContain("import './conversation-editor.js?v=7.0.0'");
    expect(code).toContain('/api/miniapp/import-code');
    expect(editor).toContain('/api/miniapp/code-options');
    expect(editor).toContain('Rank, trim & generate code');
    expect(editor).not.toContain('Enter target odds, e.g. 40');
    expect(chat).toContain("api('/api/miniapp/code', body)");
    expect(chat).toContain("api('/api/miniapp/edit-slip'");
    expect(chat).toContain("api('/api/miniapp/code-options'");
    expect(chat).toContain("action: 'choose'");
    expect(chat).toContain('analysisToken: slip.analysisToken');
    expect(chat).toContain('maximumOdds: desiredOdds');
    expect(chat).toContain("error.data?.status === 'target_exceeded'");
    expect(chat).toContain("error.data?.status !== 'odds_changed'");
    expect(chat).toContain('splitEven(snapshot(), count)');
    expect(chat).not.toContain("localStorage.setItem('telegram");
    expect(commands).toContain('AurexChatCommands');
    expect(ranker).toContain('rankByScore');
    expect(schedule).toContain('scheduleDay');
    expect(css).toContain('prefers-reduced-motion');
    for (const tab of ['build', 'analyze', 'slip', 'explore'])
      expect(html).toContain(`id="${tab}-tab"`);
    for (const [name, source] of [
      ['code-workspace', editor],
      ['conversation-editor', chat],
      ['chat-edit-commands', commands],
      ['score-trim', ranker],
      ['schedule-hints', schedule],
    ] as const)
      expect(() => new Script(source, { filename: `${name}.js` })).not.toThrow();
    expect(
      () => new Script(code.replace(/^import .*;\n/gm, ''), { filename: 'code-analysis.js' }),
    ).not.toThrow();
  });
  it('enforces refreshed odds limits before code creation', () => {
    const server = read('../src/api/mini-app-routes.ts');
    expect(server).toContain('maximumOdds: z.number().finite().min(1.01)');
    expect(server).toContain('preparation.currentOdds > input.maximumOdds');
    expect(server.indexOf("status: 'target_exceeded'")).toBeLessThan(
      server.indexOf('.createCode('),
    );
  });
});
