import { describe, expect, it, vi } from 'vitest';
import type { SportyBetEvent } from '../src/sportybet/contracts.js';
import { WatchService, fixtureChanges, isQuiet, readWatchState,
  type TelegramSender, type WatchState, type WatchStore } from '../src/watch/watch-service.js';

const now = new Date('2026-09-18T10:00:00Z');
const fixture = (status: SportyBetEvent['status'] = 'scheduled', startsAt = '2026-09-18T19:00:00Z'): SportyBetEvent => ({
  providerEventId: 'event-1', homeTeam: 'Home', awayTeam: 'Away', league: 'Test League', startsAt: new Date(startsAt), status,
});
class MemoryStore implements WatchStore {
  data = new Map<string, WatchState>();
  get(id: string): Promise<WatchState> {
    return Promise.resolve(structuredClone(this.data.get(id) || readWatchState(null)));
  }
  async change(id: string, fn: (state: WatchState) => WatchState): Promise<WatchState> {
    const updated = fn(await this.get(id));
    this.data.set(id, structuredClone(updated));
    return structuredClone(updated);
  }
  enabledUsers(limit: number): Promise<string[]> {
    return Promise.resolve([...this.data].filter(([, state]) => state.enabled).slice(0, limit).map(([id]) => id));
  }
}
class FakeSender implements TelegramSender {
  messages: Array<{ id: string; text: string }> = [];
  fail = false;
  send(id: string, text: string): Promise<void> {
    if (this.fail) return Promise.reject(new Error('simulated Telegram outage'));
    this.messages.push({ id, text });
    return Promise.resolve();
  }
}
function setup() {
  const store = new MemoryStore();
  const sender = new FakeSender();
  let actual: SportyBetEvent | null = fixture();
  let providerFails = false;
  const provider = { getEvent: vi.fn((id: string) =>
    providerFails ? Promise.reject(new Error('provider offline')) : Promise.resolve(id === 'event-1' ? actual : null)) };
  const service = new WatchService(store, provider, sender, true);
  return { service, store, sender, provider, setFixture: (next: SportyBetEvent | null) => { actual = next; },
    failProvider: () => { providerFails = true; } };
}

describe('AUREX 5.3 watchlist and notification engine', () => {
  it('never generates a cancellation or alert from missing provider data', async () => {
    const env = setup();
    await env.service.toggle('42', 'event-1', 'football', true);
    await env.service.settings('42', true, null, null);
    await env.service.check('42', true, now); // first subscription baseline
    env.setFixture(null);
    const result = await env.service.check('42', true, now);
    expect(result.unavailable).toBe(1);
    expect((await env.service.state('42')).items[0]?.status).toBe('scheduled');
    expect(env.sender.messages).toHaveLength(0);
  });
  it('synchronizes durable per-Telegram-user state without cross-account data leaks', async () => {
    const env = setup();
    const subscribed = await env.service.toggle('42', 'event-1', 'football', true);
    expect(subscribed.items[0]).toMatchObject({ homeTeam: 'Home', status: 'scheduled', muted: false });
    expect((await new WatchService(env.store, env.provider, env.sender, true).state('42')).items).toHaveLength(1);
    expect((await env.service.state('43')).items).toHaveLength(0);
    expect((await env.service.state('42')).enabled).toBe(false);
    await env.service.toggle('42', 'event-1', 'football', false);
    expect((await env.service.state('42')).items).toHaveLength(0);
  });
  it('rejects unverified fixture imports rather than accepting invented teams', async () => {
    const env = setup();
    await expect(env.service.toggle('42', 'not-real', 'football', true)).rejects.toThrow('verifiable');
    expect((await env.service.state('42')).items).toHaveLength(0);
  });
  it('sends only opted-in verified status changes, with a baseline and no duplicate messages', async () => {
    const env = setup();
    await env.service.toggle('42', 'event-1', 'football', true);
    await env.service.check('42', true, now); // opt-out
    expect(env.sender.messages).toHaveLength(0);
    await env.service.settings('42', true, null, null);
    env.setFixture(fixture('live'));
    await env.service.monitor(now); // establish fresh opt-in baseline
    expect(env.sender.messages).toHaveLength(0);
    env.setFixture(fixture('cancelled'));
    const result = await env.service.monitor(new Date('2026-09-18T10:10:00Z'));
    expect(result.changed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(env.sender.messages).toHaveLength(1);
    expect(env.sender.messages[0]?.text).toContain('live → cancelled');
    await env.service.monitor(new Date('2026-09-18T10:11:00Z'));
    expect(env.sender.messages).toHaveLength(1);
  });
  it('honors mute and quiet hours, and retries a failed Telegram send later', async () => {
    const env = setup();
    await env.service.toggle('42', 'event-1', 'football', true);
    await env.service.settings('42', true, '23:00', '00:00');
    await env.service.monitor(new Date('2026-09-18T21:00:00Z')); // baseline at 22:00 WAT
    env.setFixture(fixture('live'));
    await env.service.monitor(new Date('2026-09-18T22:30:00Z')); // 23:30 WAT, quiet
    expect(env.sender.messages).toHaveLength(0);
    env.sender.fail = true;
    await env.service.monitor(new Date('2026-09-18T23:30:00Z')); // 00:30 WAT
    expect(env.sender.messages).toHaveLength(0);
    expect((await env.service.state('42')).items[0]?.lastError).toContain('delivery failed');
    env.sender.fail = false;
    await env.service.monitor(new Date('2026-09-18T23:35:00Z'));
    expect(env.sender.messages).toHaveLength(1);
    await env.service.mute('42', 'event-1', true);
    env.setFixture(fixture('cancelled'));
    await env.service.monitor(new Date('2026-09-18T23:36:00Z'));
    expect(env.sender.messages).toHaveLength(1);
    await env.service.settings('42', false, null, null);
    expect((await env.service.state('42')).enabled).toBe(false);
  });
  it('handles Lagos overnight quiet windows and includes no fabricated injury or AI statements', () => {
    const state = { ...readWatchState(null), quietStart: '22:00', quietEnd: '07:00' };
    expect(isQuiet(state, new Date('2026-09-18T22:30:00Z'))).toBe(true);
    expect(isQuiet(state, new Date('2026-09-18T10:00:00Z'))).toBe(false);
    const changed = fixtureChanges({ id: 'event-1', sport: 'football', homeTeam: 'Home', awayTeam: 'Away',
      league: 'Test', status: 'scheduled', startsAt: fixture().startsAt.toISOString(),
      observedAt: now.toISOString(), muted: false }, fixture('live'), now.toISOString());
    expect(changed?.message).toContain('SportyBet feed');
    expect(changed?.message).not.toMatch(/injury|lineup|guarantee/i);
  });
});
