import type { ParsedIntent } from '../ai/intent-schema.js';
import type { SlipDraft, Sport } from '../types/domain.js';
import type { SportsResearchResult } from '../you/types.js';
import type { SlipAnalysis } from '../ai/slip-analyzer.js';
import type { SplitResult } from '../slips/splitter.js';

export interface ConversationState {
  currentSlipId?: string;
  currentSlip?: SlipDraft;
  recentAnalysis?: string;
  currentSlipAnalysis?: SlipAnalysis & { slipId: string };
  splitSlips?: SplitResult[];
  lastSport?: Sport;
  lastFixture?: string;
  lastMarketCategory?: string;
  preferences: Record<string, unknown>;
  lastIntent?: ParsedIntent;
  recentResearch?: SportsResearchResult;
}

export interface ConversationStore {
  get(userId: string): Promise<ConversationState>;
  set(userId: string, state: ConversationState): Promise<void>;
  clear(userId: string): Promise<void>;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly states = new Map<string, ConversationState>();
  get(userId: string): Promise<ConversationState> {
    return Promise.resolve(this.states.get(userId) ?? { preferences: {} });
  }
  set(userId: string, state: ConversationState): Promise<void> {
    this.states.set(userId, structuredClone(state));
    return Promise.resolve();
  }
  clear(userId: string): Promise<void> {
    this.states.delete(userId);
    return Promise.resolve();
  }
}
