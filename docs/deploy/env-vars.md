# Variables de entorno

Lista consolidada de todas las variables de entorno que la app y el worker
consumen, con su origen (qué ADR las introdujo) y su categoría (secret /
public / build-time).

> **Nota**: durante Fase 2 el archivo `.env.example` no se actualizó por
> restricción del entorno de desarrollo (los archivos `.env*` están en
> directorio denegado a edición automática). El operador debe sincronizar
> `.env.example` con esta tabla manualmente antes de Fase 8 (cutover).

## Aplicación

| Variable                       | Tipo    | Default                                          | Origen                |
|--------------------------------|---------|--------------------------------------------------|-----------------------|
| `NODE_ENV`                     | public  | `production`                                     | infra estándar        |
| `NEXTAUTH_URL`                 | public  | `https://app.ficha.tecnocloud.es`                | ADR-005 §2.4 + §3.2   |
| `AUTH_SECRET`                  | secret  | `openssl rand -base64 32`                        | NextAuth v5           |
| `MASTER_DATABASE_URL`          | secret  | (URL completa con password)                      | ADR-001 §5.3          |
| `APP_DATABASE_URL`             | secret  | (URL completa)                                   | ADR-001 §5.3          |
| `TENANT_RUNTIME_DATABASE_URL`  | secret  | (URL completa)                                   | ADR-002 §3.6 (renombrada en ADR-004 §2.2) |
| `QUOTA_WRITER_DATABASE_URL`    | secret  | (URL completa)                                   | ADR-004 §2.2          |
| `DATABASE_URL`                 | secret  | alias compat de Fase 2 → cae a `MASTER_DATABASE_URL` | ADR-005 §2.3.a    |
| `TENANT_CACHE_TTL_MS`          | public  | `60000`                                          | ADR-002 §2.3          |

## Stripe (Fase 4)

| Variable                                       | Tipo    | Default            | Origen          |
|------------------------------------------------|---------|--------------------|------------------|
| `STRIPE_SECRET_KEY`                            | secret  | `sk_test_...`      | ADR-003 §5.4    |
| `STRIPE_PUBLISHABLE_KEY`                       | public  | `pk_test_...`      | ADR-003 §5.4    |
| `STRIPE_WEBHOOK_SECRET`                        | secret  | `whsec_...`        | ADR-003 §2.5    |
| `STRIPE_PRICE_STARTER_MONTHLY`                 | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_STARTER_YEARLY`                  | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_PRO_MONTHLY`                     | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_PRO_YEARLY`                      | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY`              | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ENTERPRISE_YEARLY`               | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ADDON_DOMINIO_PERSONALIZADO`     | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ADDON_API_ACCESS`                | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ADDON_INTEGRACIONES_NOMINA`      | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ADDON_FIRMA_ELECTRONICA`         | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ADDON_PEOPLE_ANALYTICS`          | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ADDON_STORAGE_EXTRA`             | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_PRICE_ADDON_EMAILS_EXTRA`              | public  | `price_...`        | ADR-003 §5.4    |
| `STRIPE_TRIAL_DAYS`                            | public  | `14`               | ADR-003 §2.7    |
| `STRIPE_TRIAL_REQUIRES_CARD`                   | public  | `true`             | ADR-003 §2.7 (enmienda) |
| `STRIPE_PORTAL_RETURN_URL`                     | public  | (template)         | ADR-003 §5.4    |
| `STRIPE_CHECKOUT_SUCCESS_URL`                  | public  | (URL completa)     | ADR-003 §5.4    |
| `STRIPE_CHECKOUT_CANCEL_URL`                   | public  | (URL completa)     | ADR-003 §5.4    |

## Roles Postgres (en `scripts/sql/00-roles.sql`)

| Variable                         | Tipo    | Default | Uso                                          |
|----------------------------------|---------|---------|-----------------------------------------------|
| `APP_ROLE_PASSWORD`              | secret  | -       | wrapper Node de `00-roles.sql` (Fase 8)      |
| `TENANT_RUNTIME_ROLE_PASSWORD`   | secret  | -       | wrapper Node de `00-roles.sql` (Fase 8)      |
| `QUOTA_WRITER_ROLE_PASSWORD`     | secret  | -       | wrapper Node de `00-roles.sql` (Fase 8)      |

## Traefik (no la app)

| Variable                       | Tipo    | Default            | Origen      |
|--------------------------------|---------|--------------------|-------------|
| `CLOUDFLARE_DNS_API_TOKEN`     | secret  | (token Cloudflare) | ADR-005 §2.1.b |

> Solo Traefik conoce este token. La app **no** debe recibirlo.

## Build-time

| Variable                       | Tipo        | Default | Origen                   |
|--------------------------------|-------------|---------|---------------------------|
| `NEXT_TELEMETRY_DISABLED`      | build-time  | `1`     | repo actual (Dockerfile)  |

## Política

- Toda variable `secret` se marca con el toggle de "secret" en Dokploy y no
  aparece en logs.
- En CI no se necesitan los secrets reales; los tests usan stubs (Stripe en
  modo test con cuenta dedicada, Postgres en container con passwords
  arbitrarias).
- `.env.example` en la raíz del repo debe estar sincronizado con esta
  tabla. Mantenimiento manual hasta que entre la regla de CI que lo
  verifique automáticamente.
