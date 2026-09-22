import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync('public/app/app.js', 'utf8');
const html = readFileSync('public/app/index.html', 'utf8');
const css = readFileSync('public/app/aurex-rebuild.css', 'utf8');
const codeAnalysis = readFileSync('public/app/code-analysis.js', 'utf8');

describe('Mini App build and booking-code experience', () => {
  it('prevents duplicate builds and provides an explicit cancellable loading state', () => {
    expect(html).toContain('id="cancel-build"');
    expect(html).toContain('id="loading-elapsed"');
    expect(app).toContain('if (activeBuild) return;');
    expect(app).toContain('activeBuild?.abort()');
    expect(app).toContain("event.currentTarget.setAttribute('aria-busy', 'true')");
    expect(app).toContain('Analysis cancelled.');
  });

  it('distinguishes Telegram safe areas and reduced-motion loading behavior', () => {
    expect(css).toContain('--tg-content-safe-area-inset-top');
    expect(css).toContain('--tg-safe-area-inset-bottom');
    expect(css).toContain('@media(prefers-reduced-motion:reduce)');
  });

  it('uses the provider-backed code import instead of the old count-only echo handler', () => {
    expect(app).not.toContain("api('/api/miniapp/read-code'");
    expect(codeAnalysis).toContain("fetch('/api/miniapp/import-code'");
    expect(codeAnalysis).toContain('A complete provider-backed analysis was not returned');
  });

  it('labels bookmaker odds, statistics and AI research separately', () => {
    expect(app).toContain('SportyBet odds');
    expect(app).toContain('statistical projection');
    expect(app).toContain('AI research review:');
    expect(app).toContain('verifiedStatisticsSource');
    expect(app).toContain('evidence ·');
  });
});
