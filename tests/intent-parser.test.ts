import { describe, expect, it } from 'vitest';
import { IntentParser, deterministicParse } from '../src/ai/intent-parser.js';

describe('intent parsing', () => {
  it('recognizes fresh sports research requests', () => {
    expect(deterministicParse('Check team news for Arsenal').action).toBe('research');
    expect(deterministicParse('Any injuries in this game?').action).toBe('research');
    expect(deterministicParse('Refresh news').action).toBe('research');
  });

  it('recognizes source follow-ups', () => {
    expect(deterministicParse('Show sources').action).toBe('show_sources');
  });

  it('parses sport, game count, target odds and confidence', () => {
    expect(
      deterministicParse('Give me 7 football games around 10 odds with at least 70% confidence'),
    ).toMatchObject({
      action: 'discover',
      sport: 'football',
      gameCount: 7,
      targetOdds: 10,
      minimumConfidence: 70,
    });
  });

  it('parses a game range separately from target odds', () => {
    expect(
      deterministicParse('Give me between 5 and 8 basketball games and target 6 odds'),
    ).toMatchObject({
      sport: 'basketball',
      minimumGameCount: 5,
      maximumGameCount: 8,
      targetOdds: 6,
    });
  });

  it('parses modification and split instructions', () => {
    expect(deterministicParse('Remove the weakest two')).toMatchObject({
      action: 'modify_slip',
      modification: { operation: 'remove', count: 2 },
    });
    expect(deterministicParse('Split this ticket into 3')).toMatchObject({
      action: 'split_slip',
      splitCount: 3,
    });
  });

  it('falls back if structured AI output is invalid or unavailable', async () => {
    const invalid = new IntentParser({ parse: () => Promise.resolve({ action: 'impossible' }) });
    const failing = new IntentParser({ parse: () => Promise.reject(new Error('AI down')) });
    await expect(invalid.parse('Give me 5 games')).resolves.toMatchObject({ gameCount: 5 });
    await expect(failing.parse('Give me 8 basketball games')).resolves.toMatchObject({
      gameCount: 8,
      sport: 'basketball',
    });
  });
});
