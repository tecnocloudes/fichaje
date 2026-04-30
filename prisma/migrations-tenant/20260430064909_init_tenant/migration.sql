-- CreateSchema

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('OWNER', 'MANAGER', 'EMPLEADO');

-- CreateEnum
CREATE TYPE "TipoFichaje" AS ENUM ('ENTRADA', 'PAUSA', 'VUELTA_PAUSA', 'SALIDA');

-- CreateEnum
CREATE TYPE "MetodoFichaje" AS ENUM ('WEB', 'MOVIL', 'TABLET', 'MANUAL');

-- CreateEnum
CREATE TYPE "EstadoAusencia" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('BORRADOR', 'PUBLICADO');

-- CreateTable
CREATE TABLE "Tienda" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "codigoPostal" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "radio" INTEGER NOT NULL DEFAULT 200,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tienda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "nombre" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "dni" TEXT,
    "telefono" TEXT,
    "foto" TEXT,
    "fechaNacimiento" TIMESTAMP(3),
    "rol" "Rol" NOT NULL DEFAULT 'EMPLEADO',
    "tiendaId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fichaje" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tiendaId" TEXT,
    "tipo" "TipoFichaje" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "distancia" DOUBLE PRECISION,
    "metodo" "MetodoFichaje" NOT NULL DEFAULT 'WEB',
    "nota" TEXT,
    "editadoPor" TEXT,
    "editadoEn" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fichaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turno" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tiendaId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "nota" TEXT,
    "estado" "EstadoTurno" NOT NULL DEFAULT 'BORRADOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoAusencia" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "icono" TEXT NOT NULL DEFAULT 'calendar',
    "pagada" BOOLEAN NOT NULL DEFAULT true,
    "requiereAprobacion" BOOLEAN NOT NULL DEFAULT true,
    "diasMaximos" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipoAusencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ausencia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipoAusenciaId" TEXT NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "dias" INTEGER NOT NULL,
    "motivo" TEXT,
    "estado" "EstadoAusencia" NOT NULL DEFAULT 'PENDIENTE',
    "aprobadoPorId" TEXT,
    "aprobadoEn" TIMESTAMP(3),
    "comentarioAdmin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ausencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'info',
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "enlace" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracionEmpresa" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT 'Mi Empresa',
    "logo" TEXT,
    "horasJornadaDiaria" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "horasSemanales" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "toleranciaFichaje" INTEGER NOT NULL DEFAULT 15,
    "geofencingActivo" BOOLEAN NOT NULL DEFAULT true,
    "fichajeMovilActivo" BOOLEAN NOT NULL DEFAULT true,
    "fichajeTabletActivo" BOOLEAN NOT NULL DEFAULT true,
    "notifAusencias" BOOLEAN NOT NULL DEFAULT true,
    "notifTurnos" BOOLEAN NOT NULL DEFAULT true,
    "notifTareas" BOOLEAN NOT NULL DEFAULT true,
    "notifFichajes" BOOLEAN NOT NULL DEFAULT false,
    "notifComunicados" BOOLEAN NOT NULL DEFAULT true,
    "emailActivo" BOOLEAN NOT NULL DEFAULT false,
    "emailHost" TEXT,
    "emailPort" INTEGER,
    "emailSecure" BOOLEAN NOT NULL DEFAULT true,
    "emailUser" TEXT,
    "emailPassword" TEXT,
    "emailFrom" TEXT,
    "pushActivo" BOOLEAN NOT NULL DEFAULT false,
    "pushVapidPublicKey" TEXT,
    "pushVapidPrivateKey" TEXT,
    "favicon" TEXT,
    "colorPrimario" TEXT NOT NULL DEFAULT '#6366f1',
    "colorSidebar" TEXT NOT NULL DEFAULT '#1e1b4b',
    "appNombre" TEXT NOT NULL DEFAULT 'TelecomFichaje',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenciasNotificacion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inAppAusencias" BOOLEAN NOT NULL DEFAULT true,
    "inAppTurnos" BOOLEAN NOT NULL DEFAULT true,
    "inAppTareas" BOOLEAN NOT NULL DEFAULT true,
    "inAppFichajes" BOOLEAN NOT NULL DEFAULT false,
    "inAppComunicados" BOOLEAN NOT NULL DEFAULT true,
    "emailAusencias" BOOLEAN NOT NULL DEFAULT true,
    "emailTurnos" BOOLEAN NOT NULL DEFAULT true,
    "emailTareas" BOOLEAN NOT NULL DEFAULT false,
    "emailFichajes" BOOLEAN NOT NULL DEFAULT false,
    "emailComunicados" BOOLEAN NOT NULL DEFAULT false,
    "pushAusencias" BOOLEAN NOT NULL DEFAULT true,
    "pushTurnos" BOOLEAN NOT NULL DEFAULT true,
    "pushTareas" BOOLEAN NOT NULL DEFAULT true,
    "pushFichajes" BOOLEAN NOT NULL DEFAULT false,
    "pushComunicados" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenciasNotificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscripcion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarea" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "fechaLimite" TIMESTAMP(3),
    "asignadoAId" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comunicado" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "publicadoEn" TIMESTAMP(3),
    "autorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comunicado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Articulo" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'general',
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "vistas" INTEGER NOT NULL DEFAULT 0,
    "autorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "url" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'otro',
    "userId" TEXT,
    "subidoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Festivo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "ambito" TEXT NOT NULL DEFAULT 'nacional',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Festivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcesoOnboarding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3),
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcesoOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TareaOnboarding" (
    "id" TEXT NOT NULL,
    "procesoId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TareaOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantillaTareaOnboarding" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantillaTareaOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BolsaHoras" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "horas" DOUBLE PRECISION NOT NULL,
    "concepto" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "aprobadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BolsaHoras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_dni_key" ON "User"("dni");

-- CreateIndex
CREATE INDEX "User_tiendaId_idx" ON "User"("tiendaId");

-- CreateIndex
CREATE INDEX "Fichaje_userId_idx" ON "Fichaje"("userId");

-- CreateIndex
CREATE INDEX "Fichaje_tiendaId_idx" ON "Fichaje"("tiendaId");

-- CreateIndex
CREATE INDEX "Fichaje_timestamp_idx" ON "Fichaje"("timestamp");

-- CreateIndex
CREATE INDEX "Turno_userId_idx" ON "Turno"("userId");

-- CreateIndex
CREATE INDEX "Turno_tiendaId_idx" ON "Turno"("tiendaId");

-- CreateIndex
CREATE INDEX "Turno_fecha_idx" ON "Turno"("fecha");

-- CreateIndex
CREATE INDEX "Ausencia_userId_idx" ON "Ausencia"("userId");

-- CreateIndex
CREATE INDEX "Ausencia_fechaInicio_idx" ON "Ausencia"("fechaInicio");

-- CreateIndex
CREATE INDEX "Notificacion_userId_idx" ON "Notificacion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenciasNotificacion_userId_key" ON "PreferenciasNotificacion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscripcion_endpoint_key" ON "PushSubscripcion"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscripcion_userId_idx" ON "PushSubscripcion"("userId");

-- CreateIndex
CREATE INDEX "Tarea_asignadoAId_idx" ON "Tarea"("asignadoAId");

-- CreateIndex
CREATE INDEX "Tarea_creadoPorId_idx" ON "Tarea"("creadoPorId");

-- CreateIndex
CREATE INDEX "Comunicado_autorId_idx" ON "Comunicado"("autorId");

-- CreateIndex
CREATE INDEX "Articulo_autorId_idx" ON "Articulo"("autorId");

-- CreateIndex
CREATE INDEX "Documento_userId_idx" ON "Documento"("userId");

-- CreateIndex
CREATE INDEX "Documento_subidoPorId_idx" ON "Documento"("subidoPorId");

-- CreateIndex
CREATE INDEX "ProcesoOnboarding_userId_idx" ON "ProcesoOnboarding"("userId");

-- CreateIndex
CREATE INDEX "TareaOnboarding_procesoId_idx" ON "TareaOnboarding"("procesoId");

-- CreateIndex
CREATE INDEX "BolsaHoras_userId_idx" ON "BolsaHoras"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fichaje" ADD CONSTRAINT "Fichaje_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fichaje" ADD CONSTRAINT "Fichaje_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ausencia" ADD CONSTRAINT "Ausencia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ausencia" ADD CONSTRAINT "Ausencia_tipoAusenciaId_fkey" FOREIGN KEY ("tipoAusenciaId") REFERENCES "TipoAusencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ausencia" ADD CONSTRAINT "Ausencia_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciasNotificacion" ADD CONSTRAINT "PreferenciasNotificacion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscripcion" ADD CONSTRAINT "PushSubscripcion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_asignadoAId_fkey" FOREIGN KEY ("asignadoAId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comunicado" ADD CONSTRAINT "Comunicado_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Articulo" ADD CONSTRAINT "Articulo_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_subidoPorId_fkey" FOREIGN KEY ("subidoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcesoOnboarding" ADD CONSTRAINT "ProcesoOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaOnboarding" ADD CONSTRAINT "TareaOnboarding_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "ProcesoOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BolsaHoras" ADD CONSTRAINT "BolsaHoras_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BolsaHoras" ADD CONSTRAINT "BolsaHoras_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
