# ADR-000 — Visión: migración a SaaS multi-tenant

- **Estado**: aceptado (visión)
- **Fecha**: 2026-04-28
- **Spec maestra**: [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md)
- **Rama de trabajo**: `feature/saas-migration`

## Contexto

El proyecto `fichaje` es hoy una aplicación **mono-tenant** funcional, desplegada en
producción en `ficha.tecnocloud.es` sobre Dokploy + PostgreSQL. Sirve a un único
cliente.

El objetivo de negocio es convertirlo en un producto **SaaS multi-tenant** con:

- Catálogo de planes de suscripción y features.
- Addons contratables por tenant a mayores del plan base.
- Onboarding self-service vía Stripe Checkout.
- Panel super-admin para operar la plataforma (alta/suspensión, métricas, soporte
  con impersonación).
- Aislamiento real de los datos laborales (sensibles) entre tenants.

Esta migración debe ejecutarse **sobre el despliegue existente**, sin romperlo, con
un cutover controlado.

## Decisión

Adoptar la **spec maestra `docs/specs/00-saas-migration-master-plan.md`** como guía
del proyecto. Esa spec fija:

- **Plan por fases (0–9)**, con entregable verificable al final de cada fase y
  parada para revisión antes de la siguiente.
- **Estrategia base de aislamiento de datos**: schema-per-tenant en PostgreSQL,
  con un schema `master` para el control plane. Pendiente de confirmar en
  ADR-001 tras la auditoría.
- **Identificación de tenant**: por subdominio (`<slug>.ficha.tecnocloud.es`),
  con `admin.ficha.tecnocloud.es` para la plataforma. Pendiente de confirmar en
  ADR-002.
- **Billing**: Stripe (Customer = tenant). Pendiente de confirmar en ADR-003.
- **Feature flags y addons** centralizados en el control plane. Pendiente de
  confirmar en ADR-004.
- **Despliegue**: Dokploy actual reaprovechado, decisión TLS abierta entre
  delegación de zona a Cloudflare (DNS-01), cert por subdominio (HTTP-01) o
  wildcard manual. Pendiente de cerrar en ADR-005.

## Bounded contexts identificados

La migración se organiza en cinco bounded contexts (registrados en el tracker DDD
en `ddd-bounded-contexts`):

| Bounded context        | Responsabilidad principal                                   |
|------------------------|-------------------------------------------------------------|
| `control-plane`        | Tenants, planes, features, addons, suscripciones, super-admins |
| `tenant-resolution`    | Resolución de host → tenant, search_path, JWT con tenant_id |
| `billing`              | Stripe (checkout, webhooks, sincronización con control-plane) |
| `fichaje`              | El producto actual: control horario, ausencias, turnos, etc. |
| `super-admin`          | Panel global de plataforma, métricas, impersonación         |

## Consecuencias

### Positivas

- Trazabilidad: cada decisión clave queda en su propio ADR (`adr-001`…`adr-005`),
  encadenado a esta visión.
- Aislamiento de datos por defecto, que facilita GDPR (drop schema = borrar tenant)
  y backups por cliente.
- Onboarding automatizado: nuevo cliente → checkout → tenant operativo sin
  intervención manual.
- El producto actual (`fichaje`) queda encapsulado como bounded context y se
  prepara para escalar sin reescribir su lógica de negocio.

### Negativas / costes

- Complejidad operativa: aplicar migraciones a N schemas, vigilar drift, backups
  por tenant, healthchecks por capa.
- Riesgo de **fuga cross-tenant** si la resolución de schema falla o si algún
  query olvida usar el contexto. Necesita tests de integración explícitos
  (Fase 3) y, opcionalmente, RLS como segunda barrera.
- Acoplamiento con Stripe: errores en webhooks pueden dejar el control plane
  fuera de sync con la realidad del cobro. Hay que aplicar idempotencia y
  reintentos.
- El despliegue Dokploy actual debe migrarse en caliente con plan de cutover
  (Fase 8). Hasta entonces, la rama `feature/saas-migration` no toca producción.

### No decidido aquí (queda para ADRs específicos tras la auditoría)

- Estrategia exacta de TLS (A/B/C). → ADR-005.
- Una DB con muchos schemas vs dos DB (master + app). → ADR-001.
- Connection pool por tenant vs `SET search_path` por request. → ADR-002.
- Caché de resolución host→tenant: in-memory vs Redis desde el día 1. → ADR-002.
- Lista concreta de features por plan (`starter` / `pro` / `enterprise`) y
  límites (`max_employees`, etc.). → ADR-004.

## Estado de las fases

| Fase | Nombre                              | Estado     |
|-----:|-------------------------------------|------------|
| 0    | Auditoría (sin tocar código)        | en curso   |
| 1    | Decisiones de arquitectura (ADR-001…005) | bloqueado por Fase 0 |
| 2    | Control plane                       | pendiente  |
| 3    | Resolución de tenant + refactor     | pendiente  |
| 4    | Onboarding y auth                   | pendiente  |
| 5    | Feature flags en uso                | pendiente  |
| 6    | Configuración por tenant            | pendiente  |
| 7    | Panel super-admin                   | pendiente  |
| 8    | Migración del despliegue Dokploy    | pendiente  |
| 9    | Calidad (tests E2E + docs)          | pendiente  |

## Referencias

- Spec maestra: `docs/specs/00-saas-migration-master-plan.md`
- Tracker DDD: namespace `ddd-bounded-contexts` (5 entradas)
- Tracker ADRs: namespace `adrs`
- Patterns AgentDB: namespace `saas-migration`
