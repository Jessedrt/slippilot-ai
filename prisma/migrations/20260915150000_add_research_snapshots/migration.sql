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

CREATE INDEX "ResearchSnapshot_fixtureId_searchedAt_idx" ON "ResearchSnapshot"("fixtureId", "searchedAt");
CREATE INDEX "ResearchSource_researchSnapshotId_idx" ON "ResearchSource"("researchSnapshotId");
CREATE INDEX "ResearchSource_sourceUrl_idx" ON "ResearchSource"("sourceUrl");
ALTER TABLE "ResearchSnapshot" ADD CONSTRAINT "ResearchSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_researchSnapshotId_fkey" FOREIGN KEY ("researchSnapshotId") REFERENCES "ResearchSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
