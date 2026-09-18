import type { Prisma, PrismaClient } from '@prisma/client';
import type { SportyBetProvider, SportyBetEvent } from '../sportybet/contracts.js';
import type { Sport } from '../types/domain.js';

export type WatchItem = {
  id: string; sport: Sport; league: string; homeTeam: string; awayTeam: string;
  startsAt: string; status: SportyBetEvent['status']; observedAt: string; muted: boolean;
  baselinePending?: boolean; pending?: { key: string; message: string; since: string; leaseUntil?: number };
  lastError?: string;
};
export type WatchState = {
  enabled: boolean; quietStart: string | null; quietEnd: string | null;
  items: WatchItem[]; lastCheckedAt: string | null;
};
const key = 'aurexWatch53';
const defaultState = (): WatchState => ({ enabled: false, quietStart: null, quietEnd: null, items: [], lastCheckedAt: null });
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validStatus = (value: unknown): value is WatchItem['status'] =>
  value === 'scheduled' || value === 'live' || value === 'finished' || value === 'cancelled';
export function readWatchState(value: unknown): WatchState {
  if (!object(value)) return defaultState();
  const raw = object(value[key]) ? value[key] : {};
  const entries = Array.isArray(raw.items) ? raw.items : [];
  const items: WatchItem[] = entries.filter((item): item is WatchItem =>
    object(item) && typeof item.id === 'string' && typeof item.homeTeam === 'string' &&
    typeof item.awayTeam === 'string' && typeof item.startsAt === 'string' &&
    (item.sport === 'football' || item.sport === 'basketball') && validStatus(item.status),
  ).slice(0, 24);
  return {
    enabled: raw.enabled === true,
    quietStart: typeof raw.quietStart === 'string' ? raw.quietStart : null,
    quietEnd: typeof raw.quietEnd === 'string' ? raw.quietEnd : null,
    items, lastCheckedAt: typeof raw.lastCheckedAt === 'string' ? raw.lastCheckedAt : null,
  };
}
export function isQuiet(state: WatchState, now: Date): boolean {
  if (!state.quietStart || !state.quietEnd || state.quietStart === state.quietEnd) return false;
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const start = state.quietStart; const end = state.quietEnd;
  return start < end ? clock >= start && clock < end : clock >= start || clock < end;
}
export function fixtureChanges(previous: WatchItem, current: SportyBetEvent, observedAt: string):
  { key: string; message: string; since: string } | null {
  const startsAt = current.startsAt.toISOString();
  const changes: string[] = [];
  if (previous.status !== current.status) changes.push(`status ${previous.status} → ${current.status}`);
  if (previous.startsAt !== startsAt) {
    const time = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(current.startsAt);
    changes.push(`kickoff changed to ${time} WAT`);
  }
  if (!changes.length) return null;
  return { key: `${current.status}|${startsAt}`, since: observedAt,
    message: `AUREX fixture update (SportyBet feed)\n${current.homeTeam} vs ${current.awayTeam}\n${changes.join('; ')}\nChecked: ${observedAt}. Open AUREX to verify the latest state. This is not betting advice.`,
  };
}

export interface WatchStore {
  get(telegramId: string): Promise<WatchState>;
  change(telegramId: string, update: (state: WatchState) => WatchState): Promise<WatchState>;
  enabledUsers(limit: number): Promise<string[]>;
}
export class PrismaWatchStore implements WatchStore {
  constructor(private readonly prisma: PrismaClient) {}
  async get(telegramId: string): Promise<WatchState> {
    const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { preferences: true } });
    return readWatchState(user?.preferences);
  }
  async change(telegramId: string, update: (state: WatchState) => WatchState): Promise<WatchState> {
    await this.prisma.user.upsert({ where: { telegramId: BigInt(telegramId) },
      create: { telegramId: BigInt(telegramId) }, update: {} });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) },
        select: { id: true, updatedAt: true, preferences: true } });
      const previous = object(user.preferences) ? user.preferences : {};
      const next = update(readWatchState(previous));
      const preferences = JSON.parse(JSON.stringify({ ...previous, [key]: next })) as Prisma.InputJsonValue;
      const result = await this.prisma.user.updateMany({ where: { id: user.id, updatedAt: user.updatedAt },
        data: { preferences } });
      if (result.count === 1) return next;
    }
    throw new Error('Watchlist was changed concurrently. Please retry.');
  }
  async enabledUsers(limit: number): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { preferences: { path: [key, 'enabled'], equals: true } },
      orderBy: { updatedAt: 'asc' }, take: limit, select: { telegramId: true },
    });
    return users.map((user) => user.telegramId.toString());
  }
}
export interface TelegramSender { send(telegramId: string, message: string): Promise<void> }
export class TelegramWatchSender implements TelegramSender {
  constructor(private readonly botToken: string) {}
  async send(telegramId: string, message: string): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('Telegram rejected the alert.');
    const result: unknown = await response.json();
    if (!object(result) || result.ok !== true) throw new Error('Telegram did not confirm delivery.');
  }
}
export class WatchService {
  constructor(private readonly store: WatchStore, private readonly provider: Pick<SportyBetProvider, 'getEvent'>,
    private readonly sender: TelegramSender | null, private readonly alertsReady: boolean) {}
  private async mutate(id: string, fn: (state: WatchState) => WatchState) { return this.store.change(id, fn); }
  async state(id: string) { return { ...(await this.store.get(id)), alertsReady: this.alertsReady, source: 'SportyBet fixture feed', frequency: 'Daily scheduled check (production only)' }; }
  async toggle(id: string, eventId: string, sport: Sport, watch: boolean) {
    if (!watch) return this.mutate(id, (state) => ({ ...state, items: state.items.filter((item) => item.id !== eventId) }));
    const existing = (await this.store.get(id)).items.find((item) => item.id === eventId);
    if (existing) return this.store.get(id);
    const fixture = await this.provider.getEvent(eventId);
    if (!fixture || !Number.isFinite(fixture.startsAt.getTime()) || !fixture.homeTeam || !fixture.awayTeam ||
      !['scheduled', 'live'].includes(fixture.status)) throw new Error('This fixture is not currently verifiable or watchable.');
    const item: WatchItem = { id: fixture.providerEventId, sport, homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam, league: fixture.league || 'Competition not supplied',
      startsAt: fixture.startsAt.toISOString(), status: fixture.status, observedAt: new Date().toISOString(), muted: false };
    return this.mutate(id, (state) => {
      if (state.items.some((value) => value.id === eventId)) return state;
      if (state.items.length >= 24) throw new Error('Watchlist is full (24 fixtures).');
      return { ...state, items: [item, ...state.items] };
    });
  }
  async settings(id: string, enabled: boolean, quietStart: string | null, quietEnd: string | null) {
    return this.mutate(id, (state) => ({ ...state, enabled, quietStart, quietEnd,
      items: state.items.map((item) => enabled && !state.enabled ?
        { ...item, baselinePending: true, pending: undefined } :
        !enabled ? { ...item, pending: undefined } : item),
    }));
  }
  async mute(id: string, eventId: string, muted: boolean) {
    return this.mutate(id, (state) => ({ ...state,
      items: state.items.map((item) => item.id === eventId ?
        { ...item, muted, ...(muted ? { pending: undefined } : { baselinePending: true }) } : item),
    }));
  }
  async clear(id: string) { return this.mutate(id, (state) => ({ ...state, enabled: false, items: [] })); }
  private async checkItem(id: string, item: WatchItem, sendAlert: boolean, now: Date): Promise<'changed'|'same'|'unavailable'> {
    let fixture: SportyBetEvent | null;
    try { fixture = await this.provider.getEvent(item.id); }
    catch { fixture = null; }
    if (!fixture || !Number.isFinite(fixture.startsAt.getTime()) || fixture.providerEventId !== item.id || !validStatus(fixture.status)) {
      await this.mutate(id, (state) => ({ ...state, items: state.items.map((entry) => entry.id === item.id ?
        { ...entry, lastError: 'Fixture could not be verified by the provider.' } : entry) }));
      return 'unavailable';
    }
    const observedAt = now.toISOString();
    let changed = false;
    await this.mutate(id, (state) => ({ ...state, lastCheckedAt: observedAt,
      items: state.items.map((entry) => {
        if (entry.id !== item.id) return entry;
        const change = fixtureChanges(entry, fixture, observedAt);
        changed = Boolean(change) && !entry.baselinePending;
        const pending = change && changed && state.enabled && !entry.muted ? change : entry.pending;
        return { ...entry, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
          league: fixture.league || entry.league, status: fixture.status,
          startsAt: fixture.startsAt.toISOString(), observedAt, baselinePending: false,
          pending, lastError: undefined };
      }),
    }));
    if (sendAlert) await this.deliver(id, item.id, now);
    return changed ? 'changed' : 'same';
  }
  private async deliver(id: string, eventId: string, now: Date): Promise<boolean> {
    if (!this.alertsReady || !this.sender) return false;
    const lease = now.getTime() + 60_000;
    let claimed = false;
    const state = await this.mutate(id, (current) => {
      const item = current.items.find((entry) => entry.id === eventId);
      if (!current.enabled || isQuiet(current, now) || !item || item.muted || !item.pending ||
          (item.pending.leaseUntil || 0) > now.getTime()) return current;
      if (now.getTime() - Date.parse(item.pending.since) > 6 * 60 * 60_000) {
        return { ...current, items: current.items.map((entry) => entry.id === eventId ? { ...entry, pending: undefined } : entry) };
      }
      claimed = true;
      return { ...current, items: current.items.map((entry) => entry.id === eventId ?
        { ...entry, pending: { ...entry.pending!, leaseUntil: lease } } : entry) };
    });
    if (!claimed) return false;
    const pending = state.items.find((entry) => entry.id === eventId)?.pending;
    if (!pending || pending.leaseUntil !== lease) return false;
    try {
      await this.sender.send(id, pending.message);
      await this.mutate(id, (current) => ({ ...current, items: current.items.map((item) =>
        item.id === eventId && item.pending?.key === pending.key && item.pending?.leaseUntil === lease ?
          { ...item, pending: undefined, lastError: undefined } : item) }));
      return true;
    } catch {
      await this.mutate(id, (current) => ({ ...current, items: current.items.map((item) =>
        item.id === eventId && item.pending?.key === pending.key && item.pending?.leaseUntil === lease ?
          { ...item, pending: { ...item.pending, leaseUntil: 0 }, lastError: 'Telegram alert delivery failed; will retry.' } : item) }));
      return false;
    }
  }
  async check(id: string, sendAlert = false, now = new Date()) {
    const state = await this.store.get(id);
    const counts = { checked: 0, changed: 0, unavailable: 0, delivered: 0 };
    for (const item of state.items.slice(0, 12)) {
      const outcome = await this.checkItem(id, item, sendAlert, now);
      counts.checked += 1;
      if (outcome === 'changed') counts.changed += 1;
      if (outcome === 'unavailable') counts.unavailable += 1;
      const after = await this.store.get(id);
      if (sendAlert && !after.items.find((entry) => entry.id === item.id)?.pending && outcome === 'changed') counts.delivered += 1;
    }
    return { ...counts, checkedAt: now.toISOString() };
  }
  async monitor(now = new Date()) {
    if (!this.alertsReady || !this.sender) throw new Error('Scheduled monitoring is not configured.');
    const ids = await this.store.enabledUsers(5);
    const totals = { users: 0, checked: 0, changed: 0, unavailable: 0 };
    for (const id of ids) {
      const result = await this.check(id, true, now);
      totals.users += 1; totals.checked += result.checked;
      totals.changed += result.changed; totals.unavailable += result.unavailable;
    }
    return totals;
  }
}
