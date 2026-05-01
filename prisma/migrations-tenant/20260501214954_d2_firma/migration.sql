-- Plan D.2: tabla Firma para firma electrónica básica.
-- Aditiva. Stub: integración con DocuSign queda Fase 9.

CREATE TABLE "Firma" (
  "id"            TEXT PRIMARY KEY,
  "documentoId"   TEXT NOT NULL REFERENCES "Documento"("id") ON DELETE CASCADE,
  "userId"        TEXT NOT NULL REFERENCES "User"("id"),
  "document_hash" TEXT NOT NULL,
  "ip"            TEXT,
  "user_agent"    TEXT,
  "firmado_en"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Firma_documentoId_idx" ON "Firma" ("documentoId");
CREATE INDEX "Firma_userId_idx" ON "Firma" ("userId");
