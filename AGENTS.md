<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Desarrollo local multi-tenant (Fase 3)

Tras Fase 3 la app es multi-tenant: cada request necesita un `Host` que
resuelva a un tenant existente. Para desarrollo local:

```bash
# Una sola vez (o cuando se rompa la BD local):
NODE_ENV=development npm run dev:seed-tenant

# Después arranca dev y abre dev.localhost:
npm run dev
# http://dev.localhost:3000/login
#   email:    admin@dev.local
#   password: dev_password_2026
```

`dev:seed-tenant` crea el schema `tenant_dev` con la estructura del
producto, inserta un OWNER hardcodeado y registra `dev` en
`master.tenants`. Las credenciales **solo son válidas si
NODE_ENV=development** — el script aborta en producción.

Para `dev.localhost` no hace falta tocar `/etc/hosts` (macOS y Linux
modernos resuelven `*.localhost` a 127.0.0.1 por defecto). Si tu OS no
lo hace, añade `127.0.0.1 dev.localhost` a `/etc/hosts`.

# Schema multi-tenant — dos clientes Prisma

- `prisma/schema.prisma` → control plane (`master.*`).
  Cliente generado: `src/generated/prisma`.
  Lo usan: `prismaMaster`, `prismaRuntime`, `prismaQuotaWriter`.
- `prisma/schema-tenant.prisma` → producto (`tenant_<slug>.*`).
  Cliente generado: `src/generated/prisma-tenant`.
  Lo usa: `prismaApp` (multiplexado por tenant via Proxy).

Migraciones:
- `prisma/migrations/` (master): `npx prisma migrate dev/deploy`.
- `prisma/migrations-tenant/` (producto): aplicadas a cada
  `tenant_<slug>` con `npm run tenants:migrate -- <slug>` o
  `npm run tenants:migrate:all`.

Ningún archivo en `src/app/api/` debe importar `prisma` o
`prismaMaster`: la regla ESLint `fichaje/no-legacy-prisma` lo
bloquea. Usa `prismaApp` para datos del tenant.
