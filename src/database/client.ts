import { PrismaClient, type Prisma } from '@prisma/client';
import type { ConversationState, ConversationStore } from '../services/conversation-store.js';

export interface DatabaseService {
  health(): Promise<{ ok: boolean; detail: string }>;
  close(): Promise<void>;
}

export class PrismaDatabase implements DatabaseService {
  readonly client: PrismaClient;
  constructor() {
    this.client = new PrismaClient();
  }
  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return { ok: true, detail: 'Connected' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? 'Connection unavailable' : 'Unavailable' };
    }
  }
  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}

export class PrismaConversationStore implements ConversationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(telegramUserId: string): Promise<ConversationState> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUserId) },
      include: { conversations: { orderBy: { updatedAt: 'desc' }, take: 1 } },
    });
    const value = user?.conversations[0]?.conversationState;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as unknown as ConversationState)
      : { preferences: {} };
  }

  async set(telegramUserId: string, state: ConversationState): Promise<void> {
    const user = await this.prisma.user.upsert({
      where: { telegramId: BigInt(telegramUserId) },
      create: { telegramId: BigInt(telegramUserId) },
      update: {},
      include: { conversations: { orderBy: { updatedAt: 'desc' }, take: 1 } },
    });
    const data = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
    const conversation = user.conversations[0];
    if (conversation) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          conversationState: data,
          currentSlipId: state.currentSlipId ?? null,
          lastSport: state.lastSport
            ? (state.lastSport.toUpperCase() as 'FOOTBALL' | 'BASKETBALL')
            : null,
          lastFixture: state.lastFixture ?? null,
          lastMarketCategory: state.lastMarketCategory ?? null,
        },
      });
    } else {
      await this.prisma.conversation.create({
        data: {
          userId: user.id,
          conversationState: data,
          currentSlipId: state.currentSlipId ?? null,
          lastSport: state.lastSport
            ? (state.lastSport.toUpperCase() as 'FOOTBALL' | 'BASKETBALL')
            : null,
          lastFixture: state.lastFixture ?? null,
          lastMarketCategory: state.lastMarketCategory ?? null,
        },
      });
    }
  }

  async clear(telegramUserId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUserId) },
    });
    if (user) await this.prisma.conversation.deleteMany({ where: { userId: user.id } });
  }
}
