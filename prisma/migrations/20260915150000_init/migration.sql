CREATE TYPE "Sport" AS ENUM ('FOOTBALL', 'BASKETBALL', 'MIXED');
CREATE TYPE "RiskMode" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE');
CREATE TYPE "SlipStatus" AS ENUM ('DRAFT', 'APPROVED', 'CODE_CREATED', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "telegramId" BIGINT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "locale" TEXT,
  "preferences" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currentSlipId" TEXT,
  "recentAnalysis" JSONB,
  "lastSport" "Sport",
  "lastFixture" TEXT,
  "lastMarketCategory" TEXT,
  "preferences" JSONB,
  "conversationState" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "telegramId" BIGINT,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Fixture" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "sport" "Sport" NOT NULL,
  "league" TEXT NOT NULL,
  "homeTeam" TEXT NOT NULL,
  "awayTeam" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "rawData" JSONB,
  "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketSnapshot" (
  "id" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerMarketId" TEXT NOT NULL,
  "providerSelectionId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "marketName" TEXT NOT NULL,
  "selectionName" TEXT NOT NULL,
  "odds" DECIMAL(12,4) NOT NULL,
  "line" DECIMAL(12,4),
  "status" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Analysis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "modelProbability" DECIMAL(5,2) NOT NULL,
  "confidenceScore" DECIMAL(4,2) NOT NULL,
  "dataQuality" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "reasoning" JSONB NOT NULL,
  "model" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Selection" (
  "id" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "analysisId" TEXT,
  "provider" TEXT,
  "providerMarketId" TEXT,
  "providerSelectionId" TEXT,
  "marketName" TEXT NOT NULL,
  "selectionName" TEXT NOT NULL,
  "odds" DECIMAL(12,4) NOT NULL,
  "line" DECIMAL(12,4),
  "modelProbability" DECIMAL(5,2) NOT NULL,
  "confidenceScore" DECIMAL(4,2) NOT NULL,
  "dataQuality" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Selection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Slip" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sport" "Sport" NOT NULL,
  "targetOdds" DECIMAL(12,4),
  "currentOdds" DECIMAL(12,4) NOT NULL,
  "riskMode" "RiskMode" NOT NULL,
  "status" "SlipStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Slip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SlipSelection" (
  "id" TEXT NOT NULL,
  "slipId" TEXT NOT NULL,
  "selectionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SlipSelection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BookingCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "slipId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "oddsAtCreation" DECIMAL(12,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "BookingCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "plan" "SubscriptionPlan" NOT NULL,
  "status" "SubscriptionStatus" NOT NULL,
  "paymentProvider" TEXT,
  "externalSubscriptionId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "units" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "metadata" JSONB,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchSnapshot" (
  "id" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "freshness" TEXT NOT NULL,
  "confidence" DECIMAL(5,2) NOT NULL,
  "searchedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawMetadata" JSONB,
  CONSTRAINT "ResearchSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchSource" (
  "id" TEXT NOT NULL,
  "researchSnapshotId" TEXT NOT NULL,
  "sourceTitle" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "publisher" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confidence" DECIMAL(5,2) NOT NULL,
  "rawMetadata" JSONB,
  CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE UNIQUE INDEX "Fixture_provider_providerId_key" ON "Fixture"("provider", "providerId");
CREATE INDEX "Fixture_sport_startsAt_idx" ON "Fixture"("sport", "startsAt");
CREATE INDEX "MarketSnapshot_fixtureId_capturedAt_idx" ON "MarketSnapshot"("fixtureId", "capturedAt");
CREATE INDEX "MarketSnapshot_provider_providerMarketId_providerSelectionId_idx" ON "MarketSnapshot"("provider", "providerMarketId", "providerSelectionId");
CREATE INDEX "Analysis_userId_createdAt_idx" ON "Analysis"("userId", "createdAt");
CREATE INDEX "Slip_userId_updatedAt_idx" ON "Slip"("userId", "updatedAt");
CREATE UNIQUE INDEX "SlipSelection_slipId_selectionId_key" ON "SlipSelection"("slipId", "selectionId");
CREATE UNIQUE INDEX "SlipSelection_slipId_position_key" ON "SlipSelection"("slipId", "position");
CREATE INDEX "BookingCode_userId_createdAt_idx" ON "BookingCode"("userId", "createdAt");
CREATE UNIQUE INDEX "BookingCode_provider_code_key" ON "BookingCode"("provider", "code");
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");
CREATE INDEX "UsageRecord_userId_feature_occurredAt_idx" ON "UsageRecord"("userId", "feature", "occurredAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "ResearchSnapshot_fixtureId_searchedAt_idx" ON "ResearchSnapshot"("fixtureId", "searchedAt");
CREATE INDEX "ResearchSource_researchSnapshotId_idx" ON "ResearchSource"("researchSnapshotId");
CREATE INDEX "ResearchSource_sourceUrl_idx" ON "ResearchSource"("sourceUrl");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Slip" ADD CONSTRAINT "Slip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlipSelection" ADD CONSTRAINT "SlipSelection_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "Slip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlipSelection" ADD CONSTRAINT "SlipSelection_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "Selection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingCode" ADD CONSTRAINT "BookingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingCode" ADD CONSTRAINT "BookingCode_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "Slip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchSnapshot" ADD CONSTRAINT "ResearchSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_researchSnapshotId_fkey" FOREIGN KEY ("researchSnapshotId") REFERENCES "ResearchSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
