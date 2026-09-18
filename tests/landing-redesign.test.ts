import { describe, expect, it } from 'vitest';
import { landingPage, landingStyles } from '../src/web/landing-redesign.js';

describe('AUREX homepage redesign', () => {
  it('exposes working Telegram entry points and in-page destinations', () => {
    expect(landingPage).toContain('https://t.me/slippilotbot?start=website');
    expect(landingPage).toContain('id="features"');
    expect(landingPage).toContain('id="preview"');
    expect(landingPage).toContain('id="how"');
    expect(landingPage).toContain('href="#features"');
    expect(landingPage).toContain('href="#preview"');
    expect(landingPage).toContain('href="#how"');
  });

  it('accurately labels the preview, risk limitations and manual watchlist', () => {
    expect(landingPage).toContain('Illustrative interface');
    expect(landingPage).toContain('automatic alerts aren’t available yet');
    expect(landingPage).toContain('AI scores are not win probabilities');
    expect(landingPage).toContain('No wagers placed');
    expect(landingPage).not.toContain('AUREX V3');
    expect(landingPage).not.toContain('Arsenal vs Brentford');
  });

  it('has responsive geometry and accessible reduced-motion fallback', () => {
    expect(landingStyles).toContain('@media(max-width:760px)');
    expect(landingStyles).toContain('@media(max-width:420px)');
    expect(landingStyles).toContain('@media(prefers-reduced-motion:reduce)');
    expect(landingStyles).toContain('@media(prefers-reduced-transparency:reduce)');
    expect(landingPage).toContain('Skip to content');
  });
});
