# Migración del software de fichaje a SaaS multi-tenant

## Tu rol

Actúas como **ingeniero de software senior especializado en arquitectura SaaS multi-tenant** y mi compañero de pair programming. Tu trabajo no es solo escribir código: es **proponer, justificar y discutir** decisiones de arquitectura antes de implementarlas, detectar trampas, y dejar trazabilidad de cada cambio.

Reglas de trabajo:

- **No escribas código en la primera respuesta.** Primero auditas el repo, entiendes lo que hay, y propones un plan por fases. Solo después de que yo apruebe el plan empiezas a tocar ficheros.
- **No asumas el stack ni la arquitectura actual.** Léelo del repo (lenguaje, framework, ORM, base de datos, sistema de auth, estructura de carpetas, scripts de despliegue, Dockerfile, docker-compose, dependencias).
- **Cuestiona mis decisiones si crees que están mal.** Tengo experiencia de infra y devops, pero no soy arquitecto SaaS. Si una decisión por defecto que propongo es mala para mi caso, dímelo con argumentos.
- **Trabaja en pasos pequeños y verificables.** Cada fase termina con algo que arranca, se prueba y se commitea.
- **Idioma**: castellano de España. Términos técnicos en inglés cuando sea más claro (tenant, addon, feature flag, schema, etc.).

---

## Contexto del producto

- **Producto**: software de fichaje (control horario laboral) para empresas.
- **Estado actual**: existe un repo funcional **mono-tenant** (un único cliente). Está en este directorio.
- **Objetivo**: convertirlo en **SaaS multi-tenant** donde:
  - Cada cliente (tenant) paga una suscripción.
  - Según el plan de suscripción, dispone de unas features u otras.
  - Pueden existir **addons** contratados a mayores del plan base, por tenant.
  - Cada tenant tiene **sus propias configuraciones** (logo, marca, ajustes de fichaje, festivos, departamentos, etc.).
  - Yo (super-admin de la plataforma) tengo un **panel de control global** desde el que veo:
    - Tenants registrados, su plan, su estado de suscripción, usuarios activos, último uso, MRR estimado.
    - Posibilidad de impersonar un tenant para soporte.
    - Métricas básicas (tenants nuevos, churn, ingresos).

---

## Estado actual del despliegue (ya existe en producción)

Esto **no se construye desde cero**. Hay un despliegue funcional que hay que migrar sin romperlo.

- **Dokploy** corriendo en mi infra (Stackscale, IP pública del rango `185.99.186.64/28`).
- Aplicación en Dokploy llamada `Ficha` (slug interno `fichaje-prueba-qlhel6`), conectada al repo de GitHub que estás leyendo. **Auto-deploy en cada push** a la rama de producción.
- Dominio actual: **`ficha.tecnocloud.es`**, puerto 3000, HTTPS con Let's Encrypt vía Dokploy (Traefik), challenge HTTP-01.
- **PostgreSQL ya provisionado** en el mismo Dokploy como servicio del proyecto.
- DNS gestionado en `ns1.paginalia.es` / `ns2.paginalia.es` (servidores DNS propios). **Sin API ACME** compatible con Traefik/Caddy para DNS-01 challenge.

Implicaciones:

1. La Fase 8 es **migración** del despliegue actual, no instalación nueva.
2. Hay que planificar un **cutover** con ventana mínima (o, idealmente, deploy paralelo y switch DNS).
3. Reutilizar el servicio Postgres existente: crear ahí la DB del control plane y los schemas de tenants. No montar un Postgres aparte salvo que justifiques que merece la pena.
4. Las migraciones se aplican en el arranque del contenedor (entrypoint) o en un job pre-deploy de Dokploy. Decide y documenta.

---

## Decisión crítica que tienes que documentar: estrategia de certificado TLS

El multi-tenant por subdominio (`*.ficha.tecnocloud.es`) requiere certificado wildcard o cert por subdominio. El DNS está en paginalia y **no soporta DNS-01 challenge** con plugin de Traefik. Las opciones:

- **A. Delegar la zona `ficha.tecnocloud.es` a Cloudflare** (NS específico solo para esa zona, el resto sigue en paginalia). Wildcard cert automático con DNS-01 vía plugin de Cloudflare en Traefik. **Mi opción preferida.**
- **B. Cert por tenant con HTTP-01** (Dokploy ya lo hace para dominios individuales). Requiere registrar cada subdominio en Dokploy al crear el tenant, vía API de Dokploy o manual. Sufre rate limits de Let's Encrypt (50 certs/semana por dominio raíz).
- **C. Wildcard manual** con renovación manual cada 90 días. Descartada salvo justificación.

En el ADR-005 plantea las tres con sus consecuencias y dame tu recomendación argumentada para mi caso (volumen previsto: 10-100 tenants en los primeros 12 meses).

---

## Arquitectura propuesta (puntos de partida — discutibles)

### 1. Aislamiento de datos: schema-per-tenant en PostgreSQL

- Una **base de datos master** ("control plane") con:
  - `tenants` (id, slug, nombre, schema_name, plan_id, status, created_at, …)
  - `plans` (id, key, name, price, billing_period, …)
  - `features` (id, key, name, description, type — boolean/limit/quota)
  - `plan_features` (plan_id, feature_id, value)
  - `tenant_features` (tenant_id, feature_id, value, expires_at) — overrides y addons
  - `subscriptions` (tenant_id, stripe_subscription_id, status, current_period_end, …)
  - `super_admins` (cuentas con acceso al panel global)
- **Un schema PostgreSQL por tenant** (`tenant_<slug>`) con todas las tablas del producto (usuarios, fichajes, departamentos, configuración, etc.).
- Razones: aislamiento real de datos laborales (sensibles), backups y restores por tenant, GDPR (drop schema = borrar tenant), migraciones controladas.

**Justifica esta decisión vs alternativas** (shared schema con `tenant_id` en cada fila, base de datos por tenant, container por tenant) en tu plan inicial. Si crees que para mi caso shared-schema-con-tenant_id es mejor (menor complejidad operativa con pocos tenants), dilo y argúmentalo.

### 2. Identificación del tenant: subdominio

- `cliente1.ficha.tecnocloud.es` → tenant resuelto por slug del subdominio.
- `admin.ficha.tecnocloud.es` → panel super-admin.
- `ficha.tecnocloud.es` → landing de marketing y registro/onboarding (durante la migración puede mantener temporalmente la app del primer tenant hasta el cutover).

### 3. Resolución del contexto de tenant

- Middleware que, para cada request:
  1. Lee el host, extrae el slug, busca el tenant en el control plane (con caché, TTL corto).
  2. Si no existe o está suspendido, responde 404 / página de "suscripción no activa".
  3. Inyecta el tenant en el contexto de la request.
  4. Configura la conexión al schema de ese tenant (search_path en Postgres) durante la vida de la request.
- Auth con **JWT que incluye `tenant_id`** en el claim, validado contra el host.
- Considera Redis para cachear la resolución host→tenant. Si no merece la pena montarlo todavía, justifícalo y deja un TODO.

### 4. Sistema de planes y features (feature flags)

- Las features se chequean en código con un helper tipo `tenant.hasFeature('export_csv')` o `tenant.getLimit('max_employees')`.
- El plan define el set base. Los addons añaden features individuales a un tenant concreto.
- El control plane es la única fuente de verdad. La app del tenant nunca decide su propio plan.

### 5. Billing: Stripe

- Stripe Customer = tenant.
- Productos en Stripe espejo de `plans`. Addons = productos adicionales.
- Webhooks de Stripe → actualizar `subscriptions` y `tenant_features`.
- Onboarding: registro → checkout Stripe → webhook crea tenant + schema + usuario admin → redirección a `cliente.ficha.tecnocloud.es`.

### 6. Panel super-admin

- Aplicación lógicamente separada bajo `admin.ficha.tecnocloud.es`, con su propia auth (super-admins).
- Solo accede al control plane + capacidad de leer cualquier schema en modo soporte (impersonación con auditoría).

### 7. Despliegue Dokploy (migración del existente)

- **No** creas una app Dokploy nueva. Refactorizas la actual.
- Una sola app Docker (multi-tenant lógico) con variables de entorno para conexión a Postgres y, si aplica, Redis.
- Postgres existente reaprovechado: nueva DB para control plane (`fichaje_master`) y nueva DB para los schemas de tenants (`fichaje_app`) — o bien una sola DB con schema `master` y resto de schemas `tenant_*`. Decide y justifica.
- Worker separado (servicio adicional en Dokploy) para tareas asíncronas (webhooks Stripe, generación de informes, emails, etc.).
- Migraciones aplicadas en arranque: primero al control plane, luego a cada schema de tenant.
- Healthcheck endpoint que verifique conexión a Postgres y Redis.
- Plan de cutover documentado: cómo pasamos del estado actual (un solo cliente) al estado multi-tenant sin perder datos. Incluye paso de los datos actuales al primer tenant del nuevo sistema.

---

## Plan de trabajo por fases

Cada fase termina con un commit o varios commits atómicos, con mensajes descriptivos. Al final de cada fase, paras y me presentas:

1. Qué se ha hecho.
2. Qué se ha decidido y por qué.
3. Qué se ha dejado fuera y por qué.
4. Próximo paso propuesto.

### Fase 0 — Auditoría (sin tocar código)

1. Recorre el repo y reporta:
   - Stack (lenguaje, framework, ORM, gestor de paquetes).
   - Estructura de carpetas y módulos principales.
   - Modelo de datos actual (tablas, relaciones, migraciones existentes).
   - Sistema de auth actual.
   - Cómo se gestiona la configuración (env vars, ficheros).
   - Cómo se despliega hoy (Dockerfile, scripts, CI, configuración Dokploy detectable).
   - Tests existentes y cobertura aproximada.
2. Identifica los **acoplamientos mono-tenant**: dónde se asume "una sola empresa". Por ejemplo: tablas sin `tenant_id`, configuración global en lugar de por-tenant, hardcoded company name, single admin user, etc.
3. Propón un **mapa de migración**: qué cambia, qué se queda, qué se duplica (control plane vs producto), y un **plan de cutover** del despliegue actual.
4. Si en algún punto crees que mi propuesta de arquitectura no encaja con lo que hay, **dilo aquí** con alternativas concretas.

**Entregable**: un fichero `docs/arch/00-auditoria.md` con todo lo anterior. **No tocas código todavía.**

### Fase 1 — Decisiones de arquitectura confirmadas

1. Tras leer la auditoría y debatir conmigo, escribes un ADR (Architecture Decision Record) por cada decisión clave:
   - `docs/arch/adr-001-aislamiento-multi-tenant.md`
   - `docs/arch/adr-002-resolucion-tenant.md`
   - `docs/arch/adr-003-billing-y-suscripciones.md`
   - `docs/arch/adr-004-feature-flags-y-addons.md`
   - `docs/arch/adr-005-deployment-y-tls.md` (incluye la decisión wildcard cert: A vs B vs C)
2. Cada ADR: contexto, opciones consideradas, decisión, consecuencias.

**Entregable**: ADRs commiteados.

### Fase 2 — Control plane

1. Crear el modelo de datos del control plane (tenants, plans, features, plan_features, tenant_features, subscriptions, super_admins) con migraciones.
2. CRUD básico (sin UI todavía) y seeds con planes de ejemplo: `starter`, `pro`, `enterprise`, y features tipo `max_employees`, `export_csv`, `geofencing`, `api_access`, `integraciones_nomina`, etc. (propón tú la lista inicial basándote en lo que sea típico en un SaaS de fichaje y revísala conmigo).
3. Helpers en código: `getTenantBySlug`, `tenant.hasFeature`, `tenant.getLimit`.
4. Tests unitarios de estos helpers.

### Fase 3 — Resolución de tenant y refactor del producto

1. Middleware de resolución por subdominio.
2. Conexión dinámica al schema del tenant (search_path o connection pool por tenant, justifica la elección).
3. Refactor del código del producto para que toda consulta vaya al schema correcto. Eliminar cualquier asunción mono-tenant detectada en la auditoría.
4. Migraciones del producto reescritas para aplicarse a cualquier schema que se le indique.
5. Comando CLI `tenants:migrate <slug>` y `tenants:migrate:all`.
6. Tests de integración con dos tenants en paralelo verificando que **no hay fuga de datos** entre ellos.

### Fase 4 — Onboarding y auth

1. Flujo de registro: formulario en el dominio raíz → crea tenant pendiente → checkout Stripe.
2. Webhook de Stripe `checkout.session.completed`:
   - Crea schema del tenant.
   - Aplica migraciones.
   - Crea usuario admin del tenant.
   - Marca tenant como `active`.
   - Si la opción TLS elegida es B (cert por tenant), llama a la API de Dokploy para registrar el subdominio.
   - Envía email de bienvenida con URL `slug.ficha.tecnocloud.es`.
3. Login por tenant en su subdominio. JWT con `tenant_id`.
4. Recuperación de contraseña por tenant.

### Fase 5 — Feature flags en uso

1. Aplicar `hasFeature` y `getLimit` en todos los puntos del producto que dependan de plan: límite de empleados, exportación CSV, geolocalización, API, etc.
2. UI que oculte/muestre opciones según features, y endpoints que rechacen con 402/403 + mensaje "tu plan no incluye X".
3. Endpoint `/api/me/features` para que el front sepa qué puede mostrar.

### Fase 6 — Configuración por tenant

1. Tabla `tenant_settings` en cada schema (o en la tabla `tenants` del control plane si es config global del tenant).
2. UI de ajustes para el admin del tenant: logo, colores, zona horaria, festivos, departamentos, política de fichaje (geo, IP, foto, etc.), formato de informes.
3. Cargar estos ajustes en cada request.

### Fase 7 — Panel super-admin

1. App o ruta `admin.ficha.tecnocloud.es` con auth de super-admin (independiente de los tenants).
2. Dashboard: tenants totales, activos, churn 30d, MRR, últimos registros.
3. Listado/búsqueda de tenants con su plan, estado de suscripción, número de usuarios, último login.
4. Detalle de tenant: ver y editar features y addons manualmente, suspender/reactivar, impersonar (con log de auditoría).
5. Listado global de usuarios con filtro por tenant.

### Fase 8 — Migración del despliegue Dokploy

1. `Dockerfile` de la app revisado (multi-stage, imagen mínima) si no lo está ya.
2. `docker-compose.yml` para desarrollo local (app + postgres + redis + mailhog).
3. Documento `docs/deploy/dokploy.md` con paso a paso:
   - Variables de entorno necesarias en la app de Dokploy actual (qué añadir).
   - Configuración del dominio wildcard `*.ficha.tecnocloud.es` en Dokploy/Traefik según la opción TLS elegida.
   - Cómo crear el segundo servicio (worker) en el mismo proyecto Dokploy.
   - Backups del Postgres del control plane y de los schemas (estrategia de `pg_dump` por tenant si es schema-per-tenant).
4. Migraciones aplicadas en `entrypoint.sh` antes de arrancar la app (control plane primero, luego todos los schemas de tenants).
5. Healthcheck endpoint.
6. **Plan de cutover paso a paso** del despliegue actual:
   - Crear el control plane en la DB Postgres existente.
   - Crear el primer tenant a partir de los datos actuales (script de migración de datos).
   - Configurar wildcard DNS.
   - Activar el nuevo enrutamiento por subdominio.
   - Probar `cliente1.ficha.tecnocloud.es`.
   - Mantener `ficha.tecnocloud.es` apuntando al primer tenant temporalmente o redirigir según se decida.

### Fase 9 — Calidad

1. Tests E2E del flujo completo: registro → checkout (mock Stripe) → tenant creado → login → uso → ver feature bloqueada por plan.
2. Documentación final: `README.md` actualizado, `docs/arch/` con todos los ADRs, `docs/deploy/`, `docs/operacion/` (cómo crear un tenant manualmente, cómo migrar tenants, cómo backupear).
3. Checklist de seguridad: no fuga de datos entre tenants, RLS opcional como segunda barrera, secretos fuera del repo, rate limiting por tenant, logs sin datos personales.

---

## Restricciones y convenciones

- **No usar `sudo`** en ningún script o instrucción que me des.
- **n8n** no se toca y no es relevante para este producto. Es otra app.
- **Dokploy** ya está montado y no se reinstala. Solo se modifican la app `Ficha` y los servicios asociados.
- **Postgres**: si hay que añadir extensiones, justifícalo.
- **Stripe**: usa la SDK oficial. Modo test por defecto en desarrollo.
- **Secretos**: nunca en el repo. `.env.example` con todas las variables documentadas.
- **Commits**: en castellano, formato convencional (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- **Migraciones**: irreversibles solo si no hay alternativa razonable; cada una con su `down`.
- **Dependencias nuevas**: justifica cada una. Prefiere librerías mantenidas y populares.
- **Estilo de código**: respeta el del repo. Si no hay linter/formatter, propón uno y configúralo en la fase 0.

---

## Lo que espero de ti ahora mismo (primera respuesta)

1. Confirmas que has leído este prompt.
2. Empiezas la **Fase 0 (auditoría)**: recorres el repo, lo entiendes, y entregas `docs/arch/00-auditoria.md`.
3. Al terminar la auditoría, **paras**, me presentas un resumen ejecutivo (10-15 líneas) y me preguntas:
   - Si la arquitectura propuesta encaja con lo que has visto.
   - Si hay alguna decisión por defecto que quieras revisar conmigo antes de seguir.
   - Si la lista de planes/features inicial te parece correcta para fichaje (propón tú una lista concreta).
   - Tu recomendación argumentada para la decisión TLS (A/B/C).

**No avances a la Fase 1 sin mi visto bueno explícito.**
