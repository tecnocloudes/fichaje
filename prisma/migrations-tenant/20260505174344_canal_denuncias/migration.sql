-- Canal de denuncias (Ley 2/2023). Sprint 1 #1.
-- Tabla `Denuncia` + `ComentarioDenuncia` + 2 enums.
-- Plazos legales: acuse de recibo en 7 días, resolución en 3 meses.

-- CreateEnum
CREATE TYPE "CategoriaDenuncia" AS ENUM (
  'acoso_laboral',
  'acoso_sexual',
  'discriminacion',
  'fraude',
  'corrupcion',
  'incumplimiento_normativo',
  'proteccion_datos',
  'seguridad_salud',
  'otro'
);

-- CreateEnum
CREATE TYPE "EstadoDenuncia" AS ENUM (
  'recibida',
  'acuse_recibido',
  'en_investigacion',
  'resuelta',
  'archivada'
);

-- CreateTable
CREATE TABLE "Denuncia" (
  "id" TEXT NOT NULL,
  "esAnonima" BOOLEAN NOT NULL DEFAULT false,
  "accessTokenHash" TEXT,
  "informanteEmail" TEXT,
  "informanteNombre" TEXT,
  "informanteTelefono" TEXT,
  "informanteUserId" TEXT,
  "asunto" TEXT NOT NULL,
  "categoria" "CategoriaDenuncia" NOT NULL,
  "descripcion" TEXT NOT NULL,
  "fechaIncidente" TIMESTAMP(3),
  "estado" "EstadoDenuncia" NOT NULL DEFAULT 'recibida',
  "asignadoUserId" TEXT,
  "acuse_recibo_at" TIMESTAMP(3),
  "resolucion_at" TIMESTAMP(3),
  "resolucion_resumen" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Denuncia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComentarioDenuncia" (
  "id" TEXT NOT NULL,
  "denunciaId" TEXT NOT NULL,
  "autorUserId" TEXT,
  "autorRole" TEXT NOT NULL,
  "contenido" TEXT NOT NULL,
  "es_interno" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComentarioDenuncia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Denuncia_accessTokenHash_key" ON "Denuncia"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Denuncia_estado_idx" ON "Denuncia"("estado");

-- CreateIndex
CREATE INDEX "Denuncia_categoria_idx" ON "Denuncia"("categoria");

-- CreateIndex
CREATE INDEX "Denuncia_created_at_idx" ON "Denuncia"("created_at");

-- CreateIndex
CREATE INDEX "Denuncia_asignadoUserId_idx" ON "Denuncia"("asignadoUserId");

-- CreateIndex
CREATE INDEX "ComentarioDenuncia_denunciaId_idx" ON "ComentarioDenuncia"("denunciaId");

-- AddForeignKey
ALTER TABLE "Denuncia"
  ADD CONSTRAINT "Denuncia_informanteUserId_fkey"
  FOREIGN KEY ("informanteUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Denuncia"
  ADD CONSTRAINT "Denuncia_asignadoUserId_fkey"
  FOREIGN KEY ("asignadoUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioDenuncia"
  ADD CONSTRAINT "ComentarioDenuncia_denunciaId_fkey"
  FOREIGN KEY ("denunciaId") REFERENCES "Denuncia"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioDenuncia"
  ADD CONSTRAINT "ComentarioDenuncia_autorUserId_fkey"
  FOREIGN KEY ("autorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
