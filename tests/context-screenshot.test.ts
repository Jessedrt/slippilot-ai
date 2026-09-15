import { describe, expect, it } from 'vitest';
import { normalizeScreenshotExtraction } from '../src/ai/screenshot-normalizer.js';
import { InMemoryConversationStore } from '../src/services/conversation-store.js';

describe('conversation context', () => {
  it('stores and clears per-user state', async () => {
    const store = new InMemoryConversationStore();
    await store.set('42', { currentSlipId: 'slip-1', lastSport: 'football', preferences: {} });
    await expect(store.get('42')).resolves.toMatchObject({ currentSlipId: 'slip-1' });
    await store.clear('42');
    await expect(store.get('42')).resolves.toEqual({ preferences: {} });
  });
});

describe('screenshot normalization', () => {
  it('normalizes whitespace and reports uncertain fields', () => {
    const result = normalizeScreenshotExtraction({
      items: [{ homeTeam: ' Arsenal  ', awayTeam: '  Chelsea', confidence: 0.6 }],
    });
    expect(result.items[0]).toMatchObject({
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      uncertainFields: ['teams', 'market', 'selection'],
    });
  });
});
