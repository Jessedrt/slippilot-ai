export type Sport = 'football' | 'basketball' | 'tennis' | 'handball';
export type RiskMode = 'conservative' | 'balanced' | 'aggressive';
export type RiskLevel = 'lower' | 'medium' | 'higher';
export type DataQuality = 'low' | 'medium' | 'high';
export type StatisticalSupport = 'supported' | 'mixed' | 'insufficient';

export interface EvidenceSource {
  name: string;
  url: string;
  retrievedAt: Date;
  kind: 'authorized-statistics' | 'official-team-news' | 'research';
}

export interface SelectionAssessment {
  evidenceQualityScore: number;
  statisticalSupport: StatisticalSupport;
  recommendationVerdict: 'keep' | 'caution' | 'reject';
  assessedAt: Date;
  expiresAt: Date;
  sources: EvidenceSource[];
  statisticalProjection?: number;
  bookmakerImpliedProbability?: number;
  conflictingEvidence: boolean;
}

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
  /** Structured review metadata. Legacy numeric fields above remain API-compatible aliases. */
  assessment?: SelectionAssessment;
}

export interface SlipDraft {
  id: string;
  selections: CandidateSelection[];
  targetOdds?: number;
  riskMode: RiskMode;
}
