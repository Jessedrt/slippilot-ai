import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const diagnostics = readFileSync('public/app/provider-diagnostics-ui.js', 'utf8');
const recovery = readFileSync('public/app/booking-recovery.js', 'utf8');
const bootstrap = readFileSync('public/app/miniapp-controls.js', 'utf8');

describe('Mini App provider diagnostics controls', () => {
  it('loads connection diagnostics through the existing Mini App controls', () => {
    expect(bootstrap).toContain("import './booking-recovery.js");
    expect(recovery).toContain("import './provider-diagnostics-ui.js'");
    expect(diagnostics).toContain("document.querySelector('#build-error')");
    expect(diagnostics).toContain('Check API connection');
    expect(diagnostics).toContain('Test selected sport fixture coverage');
  });

  it('only requests status after a user click with Telegram init data', () => {
    expect(diagnostics).toContain("button.addEventListener('click', async () => {");
    expect(diagnostics).toContain('window.Telegram?.WebApp?.initData');
    expect(diagnostics).toContain("fetch('/api/miniapp/provider-status'");
    expect(diagnostics).toContain("fetch('/api/miniapp/provider-coverage'");
    expect(diagnostics).toContain("'x-telegram-init-data': initData");
    expect(diagnostics).toContain("cache: 'no-store'");
    expect(diagnostics).not.toContain('API_SPORTS_KEY');
    expect(diagnostics).not.toContain('/api/miniapp/code');
  });

  it('labels access separately from analysis activation and never inserts response HTML', () => {
    expect(diagnostics).toContain('product.analysisEnabled === true');
    expect(diagnostics).toContain('output.textContent =');
    expect(diagnostics).not.toContain('output.innerHTML');
    expect(diagnostics).toContain(
      'Connection, activation, fixture identity, statistics and selection approval are separate checks.',
    );
    expect(diagnostics).toContain('product.operational?.fixtureRetrieval');
    expect(diagnostics).toContain('product.dataRightsConfirmed === true');
  });
});
