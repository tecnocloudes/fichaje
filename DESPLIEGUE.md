# Guía de Despliegue en Dokploy + VPS

## Requisitos previos
- VPS con Docker instalado
- Dokploy instalado en el VPS (https://dokploy.com)
- Dominio apuntando al VPS
- Repositorio Git (GitHub/GitLab/Gitea)

---

## 1. Preparar el repositorio

```bash
# En tu máquina local
cd fichaje
git init
git add .
git commit -m "Initial commit - TelecomFichaje"
git remote add origin https://github.com/TU_USUARIO/telecom-fichaje.git
git push -u origin main
```

---

## 2. Configurar variables de entorno en Dokploy

En el panel de Dokploy, crea las siguientes variables de entorno para tu aplicación:

```env
DATABASE_URL=postgresql://fichaje_user:CONTRASEÑA_SEGURA@postgres:5432/fichaje_db
AUTH_SECRET=GENERA_UN_SECRETO_DE_32_CHARS_MINIMO_AQUI
NEXTAUTH_URL=https://fichaje.tudominio.com
NODE_ENV=production
```

Para generar `AUTH_SECRET`:
```bash
openssl rand -base64 32
```

---

## 3. Crear la base de datos PostgreSQL en Dokploy

En Dokploy → Databases → New Database:
- **Tipo:** PostgreSQL
- **Nombre:** fichaje_postgres
- **Usuario:** fichaje_user
- **Contraseña:** (pon una segura)
- **Base de datos:** fichaje_db

---

## 4. Crear la aplicación en Dokploy

En Dokploy → Applications → New Application:

1. **Tipo:** Docker Compose o Dockerfile
2. **Repositorio:** URL de tu repo Git
3. **Branch:** main
4. **Dockerfile:** selecciona el `Dockerfile` en la raíz
5. **Puerto:** 3000
6. **Dominio:** fichaje.tudominio.com (con SSL automático via Let's Encrypt)

---

## 5. Aplicar migraciones y seed

Después del primer despliegue, ejecuta desde Dokploy → Terminal:

```bash
# Aplicar migraciones de base de datos
npx prisma migrate deploy

# Cargar datos iniciales (15 tiendas, usuarios de ejemplo)
npm run db:seed
```

O usa el docker-compose con el perfil migrate:
```bash
docker compose --profile migrate up migrate
```

---

## 6. Acceso inicial

Una vez desplegado, accede a `https://fichaje.tudominio.com`

**Credenciales por defecto:**
| Rol | Email | Contraseña |
|-----|-------|-----------|
| Super Admin | admin@telecom.es | password123 |
| Manager (T1) | manager.tienda1@telecom.es | password123 |
| Empleado | empleado1@telecom.es | password123 |

⚠️ **Cambia todas las contraseñas tras el primer login.**

---

## 7. Configuración post-despliegue

1. Accede como Super Admin → **Configuración**
2. Actualiza el nombre de la empresa
3. Verifica las tiendas y añade coordenadas GPS reales para el geofencing
4. Crea las cuentas de manager para cada tienda
5. Asigna los empleados a sus tiendas correspondientes

---

## 8. Despliegues automáticos

Dokploy soporta webhooks de GitHub/GitLab para auto-despliegue.
En Dokploy → tu App → Deployments → Webhook URL:
- Añade esta URL como webhook en tu repositorio
- Cada push a `main` desplegará automáticamente

---

## Estructura de la aplicación

```
fichaje/
├── src/
│   ├── app/
│   │   ├── (auth)/login/          # Página de login
│   │   ├── (dashboard)/
│   │   │   ├── admin/             # Panel superadmin
│   │   │   ├── manager/           # Panel manager
│   │   │   └── empleado/          # Portal empleado
│   │   ├── api/                   # API Routes
│   │   ├── layout.tsx             # Layout raíz
│   │   └── manifest.ts            # PWA manifest
│   ├── components/
│   │   ├── layout/                # Sidebar, Header
│   │   └── ui/                    # Componentes UI
│   ├── generated/prisma/          # Cliente Prisma (auto-generado)
│   ├── lib/
│   │   ├── auth.ts                # NextAuth config
│   │   ├── prisma.ts              # Cliente Prisma
│   │   └── utils.ts               # Utilidades
│   └── middleware.ts              # Protección de rutas
├── prisma/
│   ├── schema.prisma              # Modelos de BD
│   └── seed.ts                    # Datos iniciales
├── public/
│   └── sw.js                      # Service Worker (PWA)
├── Dockerfile
├── docker-compose.yml
└── next.config.ts
```

---

## Acceso PWA (app móvil)

Los empleados pueden instalar la aplicación como app en su móvil:

1. Abrir `https://fichaje.tudominio.com` en Chrome/Safari
2. Pulsar "Añadir a pantalla de inicio"
3. La app funciona offline y se comporta como una app nativa

---

## Soporte técnico

- **Logs:** Dokploy → tu App → Logs
- **BD Studio:** `npm run db:studio` (solo en desarrollo)
- **Reiniciar app:** Dokploy → tu App → Restart
