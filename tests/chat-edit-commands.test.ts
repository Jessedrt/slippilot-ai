import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../public/app/chat-edit-commands.js', import.meta.url), 'utf8');
const context = createContext({});
new Script(source).runInContext(context);
const commands = context.AurexChatCommands as {
  parse: (text: string) => Record<string, unknown>;
  splitEven: (picks: Array<{ eventId: string; odds: number; confidence: number }>, count: number) =>
    Array<Array<{ eventId: string; odds: number; confidence: number }>> | null;
};
const result = (text: string) => JSON.parse(JSON.stringify(commands.parse(text))) as Record<string, unknown>;

describe('natural-language booking-code edits', () => {
  it('parses arbitrary odds targets without assuming a 40 odds default', () => {
    for (const [text, target] of [['Trim to 10 odds', 10], ['give me 25 odds', 25],
      ['reduce this slip to 2.5 odds', 2.5], ['trim to 100', 100]] as const)
      expect(result(text)).toMatchObject({ action: 'target', target });
  });
  it('distinguishes specific replacement, numbered removal and weakest games', () => {
    expect(result('Change game 2 to over 1.5')).toMatchObject({
      action: 'change', index: 2, requestedMarket: 'over 1.5',
    });
    expect(result('Remove game 3')).toMatchObject({ action: 'remove', index: 3 });
    expect(result('Remove 2 weakest games')).toMatchObject({ action: 'weakest', count: 2 });
    expect(result('Remove weakest')).toMatchObject({ action: 'weakest', count: 1 });
    expect(result('Split this ticket into 2 parts')).toMatchObject({ action: 'split', count: 2 });
    expect(result('Generate code')).toMatchObject({ action: 'generate' });
  });
  it('does not misinterpret combining or bookmaker conversion as available actions', () => {
    expect(result('Convert this code to Bet9ja')).toMatchObject({ action: 'unsupported' });
    expect(result('Combine these two slips')).toMatchObject({ action: 'unsupported' });
  });
  it('splits real selections evenly without duplication and refuses invalid group counts', () => {
    const picks = Array.from({ length: 7 }, (_value, index) => ({
      eventId: `match-${index}`, odds: 1.2 + index / 10, confidence: 75 - index,
    }));
    const groups = commands.splitEven(picks, 3)!;
    expect(groups.map((group) => group.length).sort()).toEqual([2, 2, 3]);
    const ids = groups.flatMap((group) => group.map((pick) => pick.eventId));
    expect(new Set(ids).size).toBe(picks.length);
    expect(ids.sort()).toEqual(picks.map((pick) => pick.eventId).sort());
    expect(commands.splitEven(picks, 1)).toBeNull();
    expect(commands.splitEven(picks, 8)).toBeNull();
    expect(commands.splitEven(picks, 2.5)).toBeNull();
  });
});
