export type Sport = 'football' | 'basketball';
export type RiskMode = 'conservative' | 'balanced' | 'aggressive';
export type RiskLevel = 'lower' | 'medium' | 'higher';
export type DataQuality = 'low' | 'medium' | 'high';

export interface Fixture {
  id: string;
  providerId?: string;
  sport: Sport;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
}

export interface NormalizedMarket {
  providerMarketId: string;
  providerSelectionId: string;
  eventId: string;
  sport: Sport;
  category: string;
  marketName: string;
  selectionName: string;
  odds: number;
  line?: number;
  specifier?: string;
  status: 'active' | 'suspended' | 'settled';
  lastUpdated: Date;
}

export interface CandidateSelection extends NormalizedMarket {
  fixture: Fixture;
  modelProbability: number;
  confidenceScore: number;
  dataQuality: DataQuality;
  riskLevel: RiskLevel;
  reasoning: string[];
}

export interface SlipDraft {
  id: string;
  selections: CandidateSelection[];
  targetOdds?: number;
  riskMode: RiskMode;
}
