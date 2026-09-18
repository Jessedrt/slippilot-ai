import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AUREX 5.3 Mini App regression smoke checks', () => {
  it('ships the new watch controls and retains all prior Mini App modules', () => {
    const html = readFileSync('public/app/index.html', 'utf8');
    for (const asset of [
      '/app/app.js?v=3.0.4', '/app/desk.js?v=5.0.0',
      '/app/intelligence.js?v=5.2.0', '/app/watch-sync.js?v=5.3.0',
      '/app/watch-sync.css?v=5.3.0', '/app/nav-alignment.css?v=5.1.0',
    ]) expect(html).toContain(asset);
    for (const tab of ['build-tab', 'analyze-tab', 'slip-tab', 'explore-tab']) {
      expect(html).toContain(`id="${tab}"`);
    }
    expect(html).toContain('id="build-form"');
    expect(html).toContain('id="generate-code"');
    expect(html).toContain('id="watch-items"');
  });
  it('has valid JavaScript and keeps Telegram alert delivery on the server', () => {
    const js = readFileSync('public/app/watch-sync.js', 'utf8');
    expect(js).toContain('/api/miniapp/watch/');
    expect(js).toContain('quietStart');
    expect(js).not.toContain('sendMessage');
    expect(() => execFileSync(process.execPath, ['--check', 'public/app/watch-sync.js'])).not.toThrow();
  });
});
