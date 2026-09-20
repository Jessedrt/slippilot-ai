import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('public/app/booking-recovery.js', 'utf8');
const boot = readFileSync('public/app/miniapp-controls.js', 'utf8');

describe('unavailable SportyBet selection recovery', () => {
  it('loads the recovery UI and binds only to a server-reported code failure', () => {
    expect(boot).toContain("import './booking-recovery.js?v=5.7.0'");
    expect(source).toContain("startsWith('Market unavailable: #')");
    expect(source).toContain("textContent !== 'Code not created'");
    expect(source).toContain('selection.homeTeam');
    expect(source).toContain('selection.selectionName');
  });

  it('requires explicit confirmation and reanalysis before trying any new code', () => {
    expect(source).toContain('window.confirm(');
    expect(source).toContain('sort((a, b) => b - a)');
    expect(source).toContain('remove.click()');
    expect(source).toContain("document.querySelector('#reanalyze-slip')");
    expect(source).not.toContain('/api/miniapp/code');
    expect(source).not.toContain('createBookingCode');
    expect(source).not.toContain('placeWager');
  });
});
