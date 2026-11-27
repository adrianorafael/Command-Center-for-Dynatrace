# Command Center for Dynatrace

🌐 [English](README.md) · [Português (BR)](README.pt-BR.md) · **Español** — 🔗 **Página del proyecto:** https://adrianorafael.github.io/Command-Center-for-Dynatrace/

**Command Center for Dynatrace** es una app creada y mantenida por [@adrianorafael](https://github.com/adrianorafael) en GitHub.

Es una **consola de eventos para NOC con gestión de guardias**, construida de forma nativa sobre Dynatrace AppEngine.
Convierte los problemas de Davis y los eventos enviados a Dynatrace en **incidentes** que los operadores clasifican,
reconocen, asignan, posponen y resuelven. **Avisa a las personas de guardia** de un equipo a través de Twilio (SMS,
voz, WhatsApp) e IFTTT de forma predeterminada, además de Slack, Microsoft Teams, Telegram y un webhook genérico.
Explora lo que se necesita para reemplazar una consola de alertas dedicada, como **Splunk On-Call (VictorOps)**,
**Atlassian Opsgenie** o una **consola NOC al estilo Moogsoft**, por una app que vive dentro de Dynatrace.

Esta app es una **app de demostración**. Muestra hasta dónde se puede llegar construyendo tu propia Dynatrace App
mediante **vibecoding**, siguiendo la documentación oficial en [developer.dynatrace.com](https://developer.dynatrace.com/)
y usando **Strato**, el sistema de diseño de Dynatrace.

> ⚠️ **Aviso legal**
>
> Esta app es proporcionada por el desarrollador **sin ninguna afiliación con Dynatrace** y **sin responsabilidad** por fallas, problemas o consumo de recursos y licencias. Es una **versión de estudio sin soporte oficial**.
>
> La decisión de descargarla e instalarla en tu entorno es **bajo el propio riesgo del usuario**. Del mismo modo, eres libre de mejorarla y ampliar sus funcionalidades.

> **Avisar a las personas es una función crítica para la seguridad.** No conviertas esta app en el único medio para
> despertar a tu equipo de noche hasta haber probado cada canal de punta a punta en tu propio entorno. Lee primero
> [Verificado y no verificado](docs/guides/es/operations.md#verificado-y-no-verificado).

![Console](docs/screenshots/console.png)

## Descripción general

| | |
| --- | --- |
| **Entrada** | Solo a través de Dynatrace: problemas de Davis y, opcionalmente, eventos de Davis y eventos genéricos, leídos desde Grail con DQL. Tus herramientas envían eventos a las APIs de ingesta de Dynatrace. |
| **Consola** | Tabla de incidentes en vivo con mosaicos de KPI, filtros, acciones masivas y atajos de teclado; detalles del incidente con línea de tiempo, progreso del escalamiento, registro de notificaciones, entidades y notas. |
| **Guardias** | Equipos de **usuarios de Dynatrace** (elegidos desde IAM), calendarios rotativos por capas con overrides (reemplazos), políticas de escalamiento con pasos y repeticiones, métodos de contacto personales, reglas de notificación y horas de silencio por equipo. |
| **War rooms** | Un enlace de reunión más los incidentes que atiende y sus Dynatrace Notebooks, incluido un notebook de post-mortem generado. |
| **Salida** | Un único **simple workflow** (*Command Center · Engine*) ejecuta la acción propia de la app cada 1, 2 o 5 minutos. No consume horas de workflow. |
| **Almacenamiento** | Dynatrace App State. Sin base de datos externa. Los secretos de los proveedores permanecen en el Credential Vault. |
| **Modo demo** | Por navegador: datos de ejemplo en todas partes, nada se lee ni se escribe, nada se envía. Desactivado: solo datos reales. |

Versión actual: **2.0.0** — consulta [CHANGELOG.md](CHANGELOG.md).

## Documentación

| Guía | Qué cubre |
| --- | --- |
| [Primeros pasos](docs/guides/es/getting-started.md) | Despliegue, cada permiso con su documentación de Dynatrace, Credential Vault, lista de hosts permitidos, instalación del motor, primera prueba |
| [Guía del usuario](docs/guides/es/user-guide.md) | Cada pantalla y menú, íconos, estados, KPIs, notificaciones, war rooms, cambio de guardia |
| [Referencia de alertas](docs/guides/es/alerts-reference.md) | Las tres vías de entrada, formatos JSON, campos, propiedades `cc.*`, orden de enrutamiento |
| [Integraciones](docs/guides/es/integrations.md) | Los ocho canales, qué recibe cada proveedor, payload del webhook, textos de los mensajes, pruebas |
| [Configuración](docs/guides/es/configuration.md) | Cada ajuste con su valor predeterminado, funciones de la app para automatización, datos almacenados |
| [Operaciones](docs/guides/es/operations.md) | Arquitectura, el estudio de costo del simple workflow con mediciones, resolución de problemas, seguridad, qué está verificado |

También disponible en inglés en [docs/guides/en](docs/guides/en/) y en portugués (BR) en [docs/guides/pt-BR](docs/guides/pt-BR/).

## Qué reemplaza

| Capacidad de una consola dedicada | Cómo lo hace Command Center |
| --- | --- |
| API de recepción de alertas | Ingesta de eventos de Dynatrace a través de OpenPipeline. Davis convierte los eventos en problemas; Command Center los lee desde Grail. |
| Deduplicación y correlación | Correlación de Davis en problemas, más una clave de deduplicación por fuente (`cc.dedup_key`) |
| Línea de tiempo y auditoría del incidente | Línea de tiempo de solo anexado por incidente: quién, cuándo, qué |
| Calendarios de guardia, rotaciones, overrides | Capas (diarias, semanales, cada N horas), hora de traspaso, zona horaria, restricciones por día de la semana/hora, overrides, dejar/tomar la guardia desde el encabezado |
| Políticas de escalamiento | Pasos ordenados con demoras, destinos (calendario, usuario, equipo completo), canales forzados opcionales, repeticiones; se detiene al reconocer |
| Métodos de contacto y reglas personales | SMS, voz, WhatsApp, Telegram, Slack, Teams, IFTTT, webhook, con "prioridad hasta Px → este método después de N minutos" |
| Reglas de enrutamiento / de alertas | Servicios más reglas ordenadas (gana la primera coincidencia), con un probador de reglas |
| Mantenimiento y horas de silencio | Las ventanas de mantenimiento de Davis suprimen los avisos (configurable); las horas de silencio del equipo retienen o rebajan los avisos menos urgentes |
| War rooms / puentes | Enlace de reunión, incidentes vinculados, notebooks, plantilla de post-mortem |
| Informes | MTTA, MTTR, volumen, ruido, entrega, carga de guardia |
| Integraciones de salida | Emisores integrados más un webhook JSON genérico para todo lo demás |

No implementado: reconocimiento bidireccional mediante respuestas por SMS o chat, una app móvil, páginas de estado y
permisos por usuario aplicados en el servidor.

## Inicio rápido

```bash
npm install
# app.config.json → "environmentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/"
npx dt-app deploy
```

Luego, en la app:

1. **Integrations → Workflows** → elige el intervalo → **Install in Workflows** (o **Download JSON** y súbelo).
   Habilita las **Authorization settings** de Workflows para el actor.
2. Entradas del **Credential Vault** para tus proveedores. Agrega sus hosts a **External requests**.
3. **Integrations → Outbound** → configura un proveedor → **Send test notification**.
4. **Teams**, **On-call**, **Escalations**, **Services** → personas, calendarios, una política, enrutamiento.
5. Envía un evento (el token necesita `openpipeline:events.davis:ingest`):

```bash
curl -X POST "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Bearer <PLATFORM-TOKEN>" -H "Content-Type: application/json" \
  -d '{"eventType":"CUSTOM_ALERT","title":"Checkout latency above 2 s","timeout":30,
       "properties":{"cc.service":"checkout","cc.priority":"P2"}}'
```

Cada paso en detalle: [primeros pasos](docs/guides/es/getting-started.md).

## Scopes de OAuth requeridos

| Scope | Propósito |
| --- | --- |
| `storage:buckets:read` | Cualquier lectura de Grail |
| `storage:events:read` | Leer `dt.davis.problems`, `dt.davis.events`, `events` |
| `state:app-states:read` / `:write` / `:delete` | Configuración, incidentes, acciones, registro de notificaciones |
| `iam:users:read` | Búsqueda y nombres de miembros de equipo |
| `automation:workflows:read` | Estado de instalación del workflow del motor |
| `document:documents:read` / `:write` | War rooms: adjuntar notebooks, crear el notebook de post-mortem |
| `credential-vault:entries:read` | El motor lee los secretos de los proveedores cuando envía |

`automation:workflows:write` **no** se solicita: la plataforma lo rechazó cuando desplegamos, con el mensaje de que solo
las apps proporcionadas por Dynatrace pueden usarlo. Por eso el workflow se instala con una confirmación en la app
Workflows. El enlace a la documentación de cada scope está en [primeros pasos](docs/guides/es/getting-started.md#paso-2--entender-los-permisos).

## Costo de consultas y consumo

> ⚠️ Lee esto antes de ejecutar la app en producción. El motor se ejecuta todo el día, independientemente de cuántas
> personas usen la app.

| Elemento | Intervalo de 1 minuto | 2 minutos | 5 minutos |
| --- | --- | --- | --- |
| Ejecuciones del motor (una invocación de función cada una) por mes | ≈ 43,200 | ≈ 21,600 | ≈ 8,640 |
| Horas de workflow | 0 | 0 | 0 |
| Consultas a Grail por ejecución | 1–8 | 1–8 | 1–8 |

Medido en un entorno trial: el motor anterior basado en standard workflow usaba cerca de **690 invocaciones de función
por hora más una hora de workflow por hora**. El motor basado en simple workflow usa **1 invocación por ejecución**
(60 por hora con un intervalo de 1 minuto) y ninguna hora de workflow. La UI no ejecuta DQL. Las consultas, los
factores de costo y cómo medirlos en tu propio entorno están en la [guía de operaciones](docs/guides/es/operations.md#costo-y-consumo).

## Desarrollo

```bash
npx dt-app dev        # open the link printed in the terminal (the app must run inside Dynatrace)
npm test              # vitest: domain, engine cycle, senders, lease, workflow definition
npm run typecheck     # tsc for ui/ and api/
npm run lint          # ESLint incl. security and secret rules
npm run check         # lint + typecheck + test + build
```

Vista previa sin conexión en modo demo: `npx dt-app build && node scripts/preview-server.mjs --port 4173`, luego abre
`http://127.0.0.1:4173/ui/`. `node scripts/screenshot.mjs ./out` toma una captura de pantalla por ruta.

| Script | Descripción |
| --- | --- |
| `node scripts/install-workflow.mjs [--interval 1\|2\|5] [--actor <uid>] [--dry-run]` | Instalación o actualización administrativa del workflow del motor a través de la Automation API (platform token con `automation:workflows:read` y `:write`) |
| `node scripts/gen-workflow-templates.mjs [--check]` | Regenerar o verificar `workflow-templates/command-center-engine.workflow.json` |
| `node scripts/preview-server.mjs` | Servir la UI compilada sin conexión en modo demo |
| `node scripts/screenshot.mjs` | Tomar capturas de pantalla de cada ruta de la vista previa sin conexión |

Despliegue en otro entorno: edita `environmentUrl`, `npx dt-app auth`, `npx dt-app deploy`, y luego repite la
instalación del motor, las entradas del vault y la lista de hosts permitidos. App State no se migra: usa
**Settings → Export and import**.

## Estructura de archivos relevante

```
app.config.json                  app id, version, scopes, the run-engine action
actions/run-engine.action.ts     the workflow action: one engine cycle
api/                             app functions engine-run, config, status, incidents, directory
api/lib/                         engine cycle, sources (Q1–Q4), lease, senders, config as code
ui/app/domain/                   pure TypeScript core: routing, schedules, escalation, planning, reports
ui/app/data/                     App State, DQL builders, IAM directory, notebooks, workflow definition
ui/app/pages/                    console, war rooms, on-call, teams, escalations, services, integrations, reports, settings, help
workflow-templates/              generated engine workflow + trial-only alert simulator
docs/                            project page, guides in three languages, screenshots
specs/, design/                  specification and screen design
```

## Versionado y registro de cambios

[Semantic Versioning](https://semver.org/), donde "incompatible" (breaking) significa incompatible para la persona que
ejecuta la app. MAJOR: cambió un scope (todos vuelven a dar su consentimiento), los datos almacenados cambiaron sin
migración, se eliminó una funcionalidad o un valor predeterminado aumenta el costo. MINOR: una nueva vista, gráfico,
filtro o ajuste. PATCH: correcciones, textos, estilos, actualizaciones de dependencias.
`app.config.json → app.version` es la única fuente de verdad, cada versión está en [CHANGELOG.md](CHANGELOG.md), y
Dynatrace rechaza un despliegue cuya versión no sea mayor que la instalada.

---

Construido siguiendo [Development Pattern for Dynatrace](https://github.com/adrianorafael/development-pattern-for-Dynatrace).
