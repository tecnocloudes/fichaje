-- CreateTable
CREATE TABLE "master"."stripe_events" (
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "api_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "processing_error" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "stripe_events_type_idx" ON "master"."stripe_events"("type");

-- CreateIndex
CREATE INDEX "stripe_events_received_at_idx" ON "master"."stripe_events"("received_at");

