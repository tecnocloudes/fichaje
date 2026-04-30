# ADR-008 — Lifecycle del tenant: SUSPENDED → DELETED y reconciliación GDPR + RD 8/2019

- **Estado**: PROPUESTO (pendiente de aprobación)
- **Fecha**: 2026-04-30
- **Contexto previo**: ADR-003 §5.5 dejó este lifecycle explícitamente diferido. Este ADR lo cierra antes de Fase 5.
- **ADRs relacionados**: ADR-001 (aislamiento multi-tenant — schema-per-tenant), ADR-002 (resolución de tenant — los 5 status), ADR-003 (billing — quién dispara `customer.subscription.deleted`), ADR-007 panel super-admin (futuro — auth + audit_log).

## 1. Contexto

Tras Fase 4, el lifecycle del tenant tiene 5 estados:

```
PENDING → PROVISIONING → ACTIVE → SUSPENDED  (DELETED no se alcanza nunca)
            ↓                          ↓
         (job 24h)               (Stripe deleted/paused, dunning)
            ↓                          ↓
         DELETE                    (sin transición posterior)
```

`SUSPENDED → DELETED` no está implementado. Hoy un tenant suspendido se queda así indefinidamente — sus datos persisten en `tenant_<slug>.*`, su fila en `master.tenants` con `status=suspended`, su `tenant_features` con `source='manual_override'` (el resto se vacía en `customer.subscription.deleted`).

Tres tensiones que este ADR debe resolver:

1. **GDPR art. 17 (derecho al olvido)**: el OWNER puede solicitar borrado de su cuenta. Plazo legal de respuesta: 1 mes (art. 12.3 RGPD).
2. **RD 8/2019 (registro horario laboral)**: obliga a retener fichajes de los empleados durante 4 años desde la baja. Aplica a los datos del producto (`Fichaje`, `Turno`, `BolsaHoras`).
3. **Auditoría fiscal**: facturas de Stripe se retienen 7 años (criterio Stripe + práctica fiscal española). `stripe_customer_id` y `subscriptions` en master.

Las tres legales conviven con el coste operacional: cada tenant `SUSPENDED` indefinido ocupa espacio en BD (schema con tablas vacías o casi vacías), un slug bloqueado, y una fila en `master.tenants` que no aporta valor.

## 2. Decisión

### 2.1 Política general

**Tres etapas, todas con super-admin en el loop**:

```
SUSPENDED ──── 90 días ────► [super-admin alertado] ──── purge --pseudonymize ────► DELETED (soft)
                                                                                          │
                                                                                       4 años
                                                                                          │
                                                                                          ▼
                                                            [super-admin alertado] ──── purge --hard-delete ────► (sin fila)
```

Ningún borrado es automático. Un job cron alerta al super-admin cuando un tenant cumple los plazos; la decisión final es humana y queda en `master.audit_log` (Fase 7, ADR-007).

### 2.2 Etapa 1 — SUSPENDED (días 0-89)

- `tenant.status = 'suspended'`.
- Schema `tenant_<slug>` intacto. Fichajes accesibles si el super-admin impersona (ADR-007).
- `master.subscriptions.status = 'canceled'` (de ADR-003 §2.3.a `customer.subscription.deleted`).
- `master.tenant_features` con `source IN ('plan','addon')` ya borrado por ADR-003. `source='manual_override'` se preserva.
- `tenant.stripe_customer_id` se conserva en master para histórico de facturación.
- **Reactivación posible**: el OWNER paga una nueva subscription (`checkout.session.completed` cuando `tenant.status='suspended'`), el handler la transiciona a `active` (ADR-003 §2.3.a `invoice.payment_succeeded`).

### 2.3 Etapa 2 — DELETED soft (días 90 a 4 años post-baja)

Disparada manualmente con `tenants:purge --pseudonymize <slug>` tras alerta del job (§2.6).

**Pseudonimización del schema del tenant**:

Aplicado vía SQL dentro del schema `tenant_<slug>`:

| Tabla | Columnas pseudonimizadas | Detalle |
|---|---|---|
| `User` | `email = 'deleted_<id>@local'`, `password = NULL`, `dni = NULL`, `foto = NULL`, `telefono = NULL`, `nombre = 'Anónimo'`, `apellidos = ''`, `fechaNacimiento = NULL`, `resetToken = NULL`, `resetTokenExpiry = NULL` | `User.id` PERMANECE (es la FK de `Fichaje.userId`). **Si `User.foto` es URL a storage externo** (S3/MinIO, decisión Fase 5+): borrar archivo físico antes de redactar la columna. |
| `Fichaje` | `nota = NULL`, `latitud = NULL`, `longitud = NULL`, `ip = NULL` | Conservar `userId`, `tipo`, `timestamp`, `tiendaId` (datos legales del registro horario). |
| `Tienda` | `email = NULL`, `telefono = NULL` (PII de la empresa) | Conservar `nombre`, `direccion`, `ciudad` (necesario para reconstruir el registro horario). |
| `Comunicado`, `Articulo` | DROP TABLE (contenido editorial sin valor legal) | |
| `Documento` | `url = NULL`, `descripcion = NULL`. Conservar fila para auditoría. **Storage externo: borrar archivo físico antes de redactar la columna `url`** (S3, MinIO, disco local — depende de Fase 5+). |
| `BolsaHoras` | `concepto = 'anónimo'` | Conservar `userId`, `horas`, `fecha`. |
| `Notificacion`, `PreferenciasNotificacion`, `PushSubscripcion` | DROP TABLE | Sin valor legal. |
| `Tarea`, `Onboarding*` | DROP TABLE | Sin valor legal. |
| `Ausencia` | `motivo = NULL`, `comentarioAdmin = NULL` | Conservar fechas + tipo (registro de jornada). |
| `ConfiguracionEmpresa` | DROP TABLE | Branding + configuración SMTP/push. PII de contacto del cliente. |

**Storage externo (Documento.url, User.foto)**:

El comando `tenants:purge --pseudonymize`:

1. **Antes** de redactar las columnas `Documento.url` y `User.foto`,
   itera todas las filas con valor no nulo y ejecuta el delete del
   archivo físico en el storage backend (S3, MinIO, disco local —
   provider configurable Fase 5+).
2. Si **alguna delete falla** (S3 down, credenciales caducadas,
   bucket inaccesible): el comando **NO procede** con la
   pseudonimización del campo. Sale con código de error y lista los
   archivos huérfanos en logs para que el operador reintente. Esto
   evita el escenario "URL nula apuntando a archivo que sigue en
   S3" — fuga de PII más insidiosa que mantener el campo intacto.
3. Tras delete OK del storage → redactar columna a NULL.
4. Listado de archivos borrados queda en `[AUDIT]` log (§2.6) para
   trazabilidad GDPR.

**Estado en master**:

- `tenant.status = 'deleted'`.
- `tenant.email = 'deleted_<id>@local'` (para no exponer email del cliente original en logs).
- `tenant.name = 'Tenant eliminado'`.
- `tenant.stripe_customer_id` SE CONSERVA (auditoría fiscal: aún facturable, aún auditable). El super-admin puede borrar el customer en el panel de Stripe en una operación independiente.
- `tenant.deleted_at = now()` (columna añadida por este ADR — §2.7).
- `tenant_features` con `source='manual_override'` SE BORRA aquí (ya no aplica).

**Comportamiento HTTP** (proxy.ts + withTenant): igual que ADR-002 §2.4 deja: `status='deleted'` → 410 Gone. La página/api responde 410 sin tocar BD del tenant.

**Reactivación**: NO posible desde el flow de cliente. Solo super-admin con `tenants:restore <slug>` (no en este ADR; Fase 7).

### 2.4 Etapa 3 — DELETED hard (≥ 4 años post-baja)

Disparada manualmente con `tenants:purge --hard-delete <slug>` tras alerta del job (§2.6) cuando el tenant cumple **4 años + 1 día** desde el `deleted_at`.

**Acciones**:

1. `DROP SCHEMA tenant_<slug> CASCADE` con `prismaMaster` (master_role).
2. `DELETE FROM master.tenant_features WHERE tenant_id = ?`.
3. `DELETE FROM master.tenant_quota_usage WHERE tenant_id = ?`.
4. `DELETE FROM master.subscription_items WHERE subscription_id IN (...)`.
5. `DELETE FROM master.subscriptions WHERE tenant_id = ?`.
6. `DELETE FROM master.tenants WHERE id = ?` (la fila desaparece).
7. **NO se borran** filas de `master.stripe_events` referentes a ese customer (auditoría fiscal independiente; persisten 7 años antes de su propio purge — TODO Fase 9).
8. **NO se borra** el Customer en Stripe (decisión manual del super-admin; el `stripe_customer_id` ya no existe en nuestro lado, así que no podemos borrarlo automáticamente desde nuestra app aunque quisiéramos — el super-admin lo busca en el panel de Stripe).

Tras hard-delete, el slug queda **libre para reuso** por construcción (UNIQUE en master.tenants). En la práctica, super-admin puede mantener el slug en `master.reserved_slugs` con razón `"slug histórico de tenant deleted; bloqueado para evitar suplantación"` si el slug fue público y se quiere prevenir un atacante registrando con el mismo subdominio.

### 2.5 Reconciliación GDPR art. 17 vs RD 8/2019

**GDPR art. 17.3.b** reconoce excepción al derecho al olvido cuando el tratamiento es necesario "para el cumplimiento de una obligación legal". RD 8/2019 art. 34.9 obliga a conservar fichajes 4 años.

**Política**:

- Solicitud GDPR delete del OWNER (canal: email al super-admin con audit en `master.audit_log`):
  - Inmediato: pseudonimización (§2.3) — equivalente a "DELETED soft". Sin esperar 90 días.
  - Diferido a 4 años: hard delete del schema y fila master.
- En la página de privacidad del producto se documenta este tratamiento dual con base legal: GDPR art. 6.1.c (cumplimiento de obligación legal) para los datos retenidos; GDPR art. 6.1.b (ejecución de contrato) para los datos pseudonimizados.
- Cualquier dato fuera del registro legal de jornada (notificaciones, comunicados, fotos, documentos) se elimina inmediatamente en la pseudonimización.

**Conservación distinta por tipo de dato**:

| Tipo de dato | Retención | Base legal |
|---|---|---|
| Fichajes (`User.id`, `Fichaje.*` esenciales) | 4 años desde baja | RD 8/2019 art. 34.9 |
| PII directa del usuario (email, DNI, teléfono, foto, password, comunicados, etc.) | Borrado inmediato en pseudonimización | GDPR art. 17 + 5.1.c (minimización) |
| Configuración del tenant (branding, SMTP, push) | Borrado inmediato | Sin base legal para retener |
| Facturación Stripe (`stripe_customer_id`, `subscriptions`, `stripe_events`) | 7 años (Stripe) + retención fiscal | LGT 25 + Stripe TOS |

### 2.6 Jobs cron de purge

> **NOTA**: las menciones a `master.audit_log` en este ADR están
> condicionadas a que ADR-007 cierre su shape. Mientras ADR-007 está
> pendiente, fallback a logging estructurado a stdout con prefijo
> `[AUDIT]` y formato JSON (timestamp, super_admin_id si disponible,
> action, target_slug, summary). Cuando ADR-007 cierre
> `master.audit_log`, los registros pasan a BD y los logs en stdout
> se mantienen como redundancia.

#### 2.6.a `detect-suspended-due-for-deletion`

Añade un tercer job al worker (junto a `cleanup-pending-tenants` y `detect-provisioning-stuck`):

```ts
// Una vez al día, 03:00 UTC (cuando hay menos tráfico).
cron.schedule("0 3 * * *", async () => {
  const ninetyDays  = new Date(Date.now() - 90 * 86400 * 1000);
  const fourYears   = new Date(Date.now() - 4 * 365 * 86400 * 1000 - 86400 * 1000);

  const due90 = await prismaMaster.tenant.findMany({
    where: { status: 'suspended', suspendedAt: { lt: ninetyDays } },
    select: { id: true, slug: true, email: true, suspendedAt: true },
  });
  const due4y = await prismaMaster.tenant.findMany({
    where: { status: 'deleted', deletedAt: { lt: fourYears } },
    select: { id: true, slug: true, deletedAt: true },
  });

  if (due90.length > 0 || due4y.length > 0) {
    await emailSuperAdmin({
      due90,
      due4y,
      message: 'Tenants pendientes de purge. Ejecutar tenants:purge tras revisión.',
    });
  }
});
```

**No borra. Solo alerta**. La decisión es humana.

#### 2.6.b `notify-tenant-purge-imminent`

Job adicional semanal (lunes 03:00 UTC) que envía email al `tenant.email`
cuando el tenant lleva **60 días suspended** — 30 días antes de la
pseudonimización a 90 días.

```ts
cron.schedule("0 3 * * 1", async () => {
  const sixtyDays = new Date(Date.now() - 60 * 86400 * 1000);
  const ninetyDays = new Date(Date.now() - 90 * 86400 * 1000);
  // Tenants en ventana 60-90 días desde suspended_at.
  const due = await prismaMaster.tenant.findMany({
    where: {
      status: "suspended",
      suspendedAt: { lt: sixtyDays, gte: ninetyDays },
    },
    select: { id: true, slug: true, email: true, suspendedAt: true },
  });
  for (const t of due) {
    await sendEmail({
      to: t.email,
      from: process.env.EMAIL_FROM ?? "no-reply@ficha.tecnocloud.es",
      subject: "Pseudonimización inminente de tu cuenta — 30 días",
      // Contenido: aviso de pseudonimización en T-30, link a
      // tenants:export <slug> (Fase 7) para descargar datos, contacto
      // soporte.
      ...,
    });
  }
});
```

**No bloquea ni borra**. Solo notifica. Si el cliente reactiva pagando
antes del día 90, el handler `customer.subscription.updated` /
`invoice.payment_succeeded` (Fase 4) actualiza `tenant.status='active'`
y `suspendedAt=NULL`, y el job deja de incluirlo en el siguiente ciclo.

### 2.7 Migración necesaria

Una migración backward-compatible en `master`:

```sql
-- prisma/migrations/<ts>_master_tenants_lifecycle_columns/migration.sql

ALTER TABLE master.tenants
  ADD COLUMN suspended_at TIMESTAMPTZ,
  ADD COLUMN deleted_at   TIMESTAMPTZ;

CREATE INDEX tenants_suspended_at_idx ON master.tenants (suspended_at)
  WHERE suspended_at IS NOT NULL;
CREATE INDEX tenants_deleted_at_idx ON master.tenants (deleted_at)
  WHERE deleted_at IS NOT NULL;
```

Backward-compatible: las nuevas columnas son nullable, sin default automático. La app pre-Fase-5 sigue funcionando sin tocarlas.

**Backfill ligero**: para tenants ya existentes en `status='suspended'` cuando esta migración se aplique, set `suspended_at = updated_at` (mejor aproximación). Lo hace la propia migración con un `UPDATE`.

```sql
UPDATE master.tenants
   SET suspended_at = updated_at
 WHERE status = 'suspended' AND suspended_at IS NULL;
```

### 2.8 Modificación de handlers existentes

`handleSubscriptionDeleted` (commit 10 Fase 4): añadir `suspendedAt: new Date()` al `update` cuando se transiciona a `suspended`.

`handleSubscriptionPaused` (commit 12 Fase 4): idem.

`handleCheckoutCompleted` (commit 7 Fase 4) cuando se reactiva un suspended: `suspendedAt: null`.

### 2.9 Comando CLI `tenants:purge <slug>`

Dos modos exclusivos:

```sh
npm run tenants:purge -- <slug> --pseudonymize
npm run tenants:purge -- <slug> --hard-delete
```

**Validaciones obligatorias**:
- El slug debe existir en `master.tenants`.
- Para `--pseudonymize`: `tenant.status = 'suspended' AND suspended_at < now - 90 days`. Si no, error con razón.
- Para `--hard-delete`: `tenant.status = 'deleted' AND deleted_at < now - 4 years`. Si no, error.

**Confirmación interactiva** (no bypassable con flag):

```
Vas a PSEUDONIMIZAR el tenant "acme" (id=tnt_abc123).
Esta acción es irreversible. Datos afectados:
  - 12 usuarios PII redactados
  - 4523 fichajes conservados (RD 8/2019)
  - 18 documentos eliminados
  - configuración + comunicados eliminados

Escribe "acme" para confirmar:
```

Idempotente: si ya está pseudonimizado, exit 0 informando.

**Dump SQL automático antes de purge** (mejora pre-implementación):

Antes de ejecutar la pseudonimización o el hard-delete, el comando
`tenants:purge` exporta un dump SQL del schema afectado a un
directorio configurable (env `PURGE_DUMP_DIR`, default
`/var/lib/fichaje-purge-dumps`). El dump se nombra
`<slug>_<mode>_<timestamp>.sql.gz` (gzipped).

Permite recuperación manual en caso de error humano del super-admin
(SQL recovery dentro de la ventana de retención del dump). El propio
dump expira a los **90 días** (cron separado en Fase 9), tiempo
razonable para detectar errores antes de que la PII expire también
en backups (§2.11).

Comando ejemplo:

```bash
pg_dump --schema=tenant_acme --format=custom \
  | gzip > $PURGE_DUMP_DIR/acme_pseudonymize_20260430123000.sql.gz
```

> **NOTA**: el uso de `master.audit_log` está condicionado a que
> ADR-007 cierre su shape (ver §2.6). Hasta entonces, log a
> `console.warn` con prefijo `[AUDIT]` y formato JSON para que
> `journalctl` lo recoja.

Logueado con: super-admin id, slug, modo, timestamp, dump_path,
summary del impacto (filas afectadas por tabla, archivos de storage
borrados).

### 2.10 Política con `stripe_customer_id`

| Estado tenant | `stripe_customer_id` en master | `customer` en Stripe |
|---|---|---|
| ACTIVE | Presente | Existe |
| SUSPENDED | Presente | Existe (sub canceled) |
| DELETED soft | Presente (auditoría) | Existe (super-admin decide cuándo borrar manualmente) |
| Hard-deleted | Fila master eliminada → ya no hay donde guardar id | Persiste en Stripe (responsabilidad operativa del super-admin) |

**No borramos en Stripe automáticamente**. La razón: el super-admin podría querer reutilizar el customer (ej. el cliente vuelve), o consultarlo para auditoría. La automatización del borrado en Stripe queda fuera de este ADR — el super-admin tiene el panel de Stripe para esa operación manual.

### 2.11 Backups y pseudonimización

Los backups de la BD (master y tenant_schemas) contienen las
versiones pre-pseudonimización mientras dure su ciclo de retención.

**Política**:

- Backups diarios con retención **30 días** (ADR-001 §5.5 cuando
  cierre).
- Cuando el super-admin ejecuta `tenants:purge --pseudonymize <slug>`,
  la PII se elimina de la BD viva inmediatamente. **Los backups que
  contengan PII pre-purge expiran en ≤30 días**.
- Esto se considera "almacenamiento técnico necesario" para la
  operación del servicio y es consistente con la **opinión 03/2017**
  del Article 29 Data Protection Working Party (predecesor del
  EDPB), que admite ventana razonable de eliminación efectiva mientras
  los backups expiran por rotación.
- En la página de privacidad del producto se documenta el plazo
  máximo efectivo de pseudonimización completa: **"Tu PII se elimina
  inmediatamente de los sistemas activos. Los backups de seguridad
  pueden contenerla hasta 30 días tras tu solicitud, tras lo cual
  expiran automáticamente."**
- **Escenario excepcional**: si el cliente exige eliminación de
  backups (raro, normalmente solo en disputas regulatorias serias),
  el super-admin puede ejecutar borrado puntual del último backup
  tras la purge. **No es operativa estándar** y queda documentado en
  `[AUDIT]` log.

### 2.12 Tratamiento de `master.stripe_events` tras pseudonimización

Los eventos en `master.stripe_events` contienen `payload` JSON
completo del webhook con PII (email, name, billing_address). Cuando
un tenant pasa a `deleted`:

**1. Inmediato — redactar el campo `payload` JSON**:

Eliminar claves de PII por cada evento del customer afectado:

- `payload.data.object.customer_email` → `null`
- `payload.data.object.customer_details.email` → `null`
- `payload.data.object.customer_details.name` → `null`
- `payload.data.object.customer_details.address` → `null`
- `payload.data.object.customer_details.phone` → `null`
- **Mantener**: `customer` (cus_id no es PII), `subscription` (sub_id),
  `amount`, `currency`, `created`, fechas, status.

Implementación (SQL ejecutado dentro de `tenants:purge --pseudonymize`):

```sql
UPDATE master.stripe_events
   SET payload = payload
       #- '{data,object,customer_email}'
       #- '{data,object,customer_details,email}'
       #- '{data,object,customer_details,name}'
       #- '{data,object,customer_details,address}'
       #- '{data,object,customer_details,phone}'
 WHERE payload->'data'->'object'->>'customer' = $1; -- stripe_customer_id
```

**2. Conservar columnas no-PII**:

`id`, `type`, `created_at`, `received_at`, `processed_at`,
`processing_error` quedan intactas (datos no PII, base legal LGT 25
retención fiscal).

**3. Tras 7 años desde `deleted_at`**:

Los eventos del customer afectado se borran completamente. Purge
separado en Fase 9 (`master.stripe_events` purge cron):

```sql
DELETE FROM master.stripe_events
 WHERE payload->'data'->'object'->>'customer' = $1
   AND received_at < now() - interval '7 years';
```

**4. Ejecución**:

Esto se ejecuta como parte del comando `tenants:purge --pseudonymize`,
**no como job separado**. Mantiene atomicidad con la pseudonimización
del schema del tenant: o ambas cosas pasan o ninguna.

## 3. Opciones consideradas

### 3.1 Hard delete inmediato a los 90 días

| Pro | Contra |
|---|---|
| Coste BD predecible | Viola RD 8/2019 (4 años) |
| Simple | Pérdida irreversible si super-admin se equivoca |

**Descartada** por ilegal en España y por riesgo operacional.

### 3.2 Pseudonimización inmediata al SUSPENDED

| Pro | Contra |
|---|---|
| Cumple GDPR ya | Imposible reactivar al cliente que pagó por error |
| Mínimo dato | Pérdida sigue irreversible |

**Descartada**: muchos suspended son por dunning de Stripe (14 días), no por baja real. Pseudonimizar ahí es prematuro y rompe la reactivación. 90 días dan margen.

### 3.3 Soft delete eterno

| Pro | Contra |
|---|---|
| Reversible siempre | Coste BD crece sin techo |
| Cumple ambas leyes | No cumple GDPR art. 17 (PII retenida indefinidamente) |

**Descartada**: GDPR no permite retención indefinida de PII sin base legal. RD 8/2019 obliga 4 años, no más.

### 3.4 Hard delete tras 4 años SIN paso intermedio

| Pro | Contra |
|---|---|
| Una sola purga | Mantenemos 4 años de PII (email, DNI, etc.) sin necesidad |
| Simple | Choca con GDPR minimización (5.1.c) |

**Descartada**: la pseudonimización a los 90 días reduce datos PII a lo legalmente necesario. Mantenerlos 4 años no aporta nada.

### 3.5 Automatización completa (purge sin super-admin)

| Pro | Contra |
|---|---|
| Sin fricción operativa | Sin auditoría humana |
| Predecible | Errores irreversibles si bug en lógica |

**Descartada**: la decisión irreversible (especialmente pseudonimización) merece un humano en el loop. El job alerta; el super-admin decide.

### 3.6 Política elegida: 3 etapas con super-admin

90 días suspended → super-admin pseudonimiza → 4 años deleted soft → super-admin hard-delete.

Cumple GDPR (PII fuera a 90 días), RD 8/2019 (4 años de fichajes), Stripe TOS (customer + facturas en Stripe), y mantiene reversibilidad mientras el cliente puede pagar.

## 4. Consecuencias

### 4.1 Positivas

- Cumple las 3 obligaciones legales (GDPR, RD 8/2019, retención fiscal).
- Coste BD acotado: PII fuera tras 90 días, schema completo fuera tras 4 años.
- Reactivación posible durante 90 días (cliente recupera al pagar).
- Decisiones irreversibles tienen audit_log + confirmación humana.

### 4.2 Negativas (asumidas)

- Coste BD entre 90 días y 4 años: schema preservado pero con PII redactada. ~10-50 MB por tenant pseudonimizado (estimación: 10K fichajes + tablas vacías). Con 1000 tenants históricos, ~10-50 GB en master+tenant schemas. Asumible.
- Super-admin debe revisar alertas diarias del job. Carga operativa: ~5 min/día con <10 tenants nuevos due/semana.
- Pseudonimización irreversible — un error humano del super-admin es destructivo. Mitigado con confirmación del slug + audit_log + dump SQL automático antes de purge (TODO Fase 7).

### 4.3 Neutras

- `stripe_customer_id` no se borra. El super-admin tiene panel de
  Stripe para gestionarlo manualmente si lo desea.
- `master.stripe_events` conserva eventos con `customer = ese cus_id`
  con PII redactada (§2.12) tras pseudonimización. Borrado completo
  en Fase 9 cuando cumpla 7 años desde `deleted_at` (purge separado
  por motivos LGT 25).

## 5. Implicaciones para fases siguientes

### 5.1 Fase 5 — Feature flags productivos

- Verificar que `withFeature(key)` y `withQuota(key, n)` respetan `tenant.status='suspended'` y `'deleted'` (ADR-002 §2.4 ya devuelve 402 y 410 respectivamente).
- Sin impacto directo en Fase 5: las features solo se evalúan para tenants `active` (el proxy/HOF responden antes con 402/410 para los demás).

### 5.2 Fase 7 — Panel super-admin

- UI para `tenants:purge`: lista de tenants due con fecha + razón + botón "purge --pseudonymize" o "purge --hard-delete" según corresponda.
- Confirmación del slug con dialogo modal.
- Audit log visible.
- Botón de "tenants:restore" para revertir un suspended a active (no para revertir un pseudonimizado — ya es irreversible).

### 5.3 Fase 8 — Despliegue

- Worker (proceso separado) ya gestiona los 2 jobs anteriores; añadir el tercero en el mismo proceso.
- Dokploy: ningún cambio adicional.
- `EMAIL_SUPER_ADMIN` env nueva: dirección para el aviso del job. En desarrollo, fallback a `console.log`.

### 5.4 Fase 9 — Optimización futura

- Purge de `master.stripe_events` con > 7 años.
- Compresión de schemas pseudonimizados (PostgreSQL TOAST).
- Métrica "tenants pseudonimizados/hard-deleted" en dashboard super-admin.

## 6. Criterios de aceptación

Esta decisión se considera implementada (probable Fase 6 o cuando arranque la implementación) cuando todos los siguientes son ciertos:

1. `master.tenants` tiene columnas `suspended_at` y `deleted_at` (NULLABLE TIMESTAMPTZ) con índices parciales.
2. `handleSubscriptionDeleted`, `handleSubscriptionPaused` setean `suspendedAt = now()`. `handleCheckoutCompleted` reset a NULL al reactivar.
3. Comando `npm run tenants:purge -- <slug> --pseudonymize` funciona contra un tenant SUSPENDED > 90 días: redacta PII según §2.3, set `status='deleted'` + `deleted_at=now()`. Idempotente.
4. Comando `npm run tenants:purge -- <slug> --hard-delete` funciona contra un tenant DELETED > 4 años: DROP SCHEMA + DELETE filas master. Idempotente. Slug queda libre.
5. Job cron `detect-suspended-due-for-deletion` corre diario, alerta a super-admin. **No borra**.
6. Test de integración con Testcontainers que ejercita los dos modos (`--pseudonymize` y `--hard-delete`) y verifica el estado resultante (incluye §2.3 storage delete simulado y §2.12 redacción `master.stripe_events`).
7. **(Hasta cierre ADR-007)** `tenants:purge` y los jobs cron emiten logs estructurados a stdout con prefijo `[AUDIT]` y formato JSON (timestamp, super_admin_id si disponible, action, target_slug, summary, dump_path). Tras cierre ADR-007, también escriben en `master.audit_log` con los logs stdout como redundancia.
8. **(Pendiente Fase 7)** Comando `npm run tenants:restore -- <slug>` revierte `status=suspended` → `active`, `suspended_at` → NULL, restaura `tenant_features` con `source='manual_override'` a active. **NO aplicable a tenants en `deleted` — irreversibles**. Idempotente. Pendiente de implementación cuando ADR-007 cierre el panel super-admin.
9. Job `notify-tenant-purge-imminent` corre semanalmente (lunes 03:00 UTC), envía email a tenants en `suspended` con `suspended_at` en ventana 60-90 días. Aviso T-30. No bloquea ni borra; solo notifica.
10. Documentación pública (`/legal/privacidad`) documenta la política GDPR + RD 8/2019, incluyendo el plazo de 30 días en backups (§2.11).

## 7. Referencias

- [GDPR art. 17 — derecho al olvido](https://gdpr-info.eu/art-17-gdpr/).
- [GDPR art. 6.1.b/c — bases legales](https://gdpr-info.eu/art-6-gdpr/).
- [RD 8/2019 art. 34.9 — registro horario](https://www.boe.es/eli/es/rdl/2019/03/08/8) (4 años de retención).
- LGT art. 25 — retención fiscal de facturas (4 años + extensiones por inspección).
- Stripe TOS — invoice retention 7 años.
- ADR-001 §2.3 (master_role), §5.4 (worker dual-rol).
- ADR-002 §2.4 (mapping status → HTTP).
- ADR-003 §2.3.a (`customer.subscription.deleted` deja en SUSPENDED), §5.5 (este ADR-008 lo cierra).
- ADR-007 (panel super-admin + audit_log) — pendiente, materializa la UI de purge y la persistencia del audit_log.
