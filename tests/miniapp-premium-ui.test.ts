import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`../public/app/${name}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('premium.css');
const premium = read('premium.js');
const app = read('app.js');

// UI redesign must not remove existing API-driven features or their stable element IDs.
describe('premium Telegram Mini App', () => {
  it('loads the redesign assets with versioned URLs', () => {
    expect(html).toContain('/app/premium.css?v=4.0.0');
    expect(html).toContain('/app/premium.js?v=4.0.0');
    expect(css).toContain('.builder-card');
    expect(css).toContain('.bottom-nav');
  });

  it('retains form controls and every existing analysis/booking workflow', () => {
    for (const id of [
      'build-form', 'target-odds', 'risk-mode', 'count-chips', 'custom-count',
      'custom-count-button', 'generate-code', 'code-result', 'pick-list',
      'read-code-form', 'x-form', 'shot-form', 'build-tab', 'analyze-tab', 'slip-tab',
    ]) expect(html).toContain(`id="${id}"`);
    for (const route of [
      '/api/miniapp/build', '/api/miniapp/code', '/api/miniapp/read-code',
      '/api/miniapp/x-post', '/api/miniapp/screenshot',
    ]) expect(app).toContain(route);
  });

  it('keeps custom game counts and decimal odds validation intact', () => {
    expect(html).toContain('inputmode="decimal"');
    expect(html).toContain('miniapp-controls.js');
    expect(premium).toContain('customField.classList.add');
    expect(premium).toContain("riskSelect.dispatchEvent(new Event('change'");
  });

  it('provides truthful analysis and a non-staking booking confirmation', () => {
    expect(html).toContain('AI EVIDENCE SCORE');
    expect(html).toContain('not a win probability');
    expect(html).toContain('id="slip-insights"');
    expect(premium).toContain('Detailed reasoning is unavailable');
    expect(premium).toContain('No wager was submitted');
    expect(premium).toContain('navigator.share');
  });
});
