# Primeros pasos — instalación, permisos y el motor de avisos

🌐 [English](../en/getting-started.md) · [Português (BR)](../pt-BR/getting-started.md) · **Español**

Esta guía te lleva desde un entorno vacío hasta un primer aviso de prueba. Calcula unos 30 minutos. Cada paso indica
qué está verificado y qué no, para que sepas qué debes comprobar por tu cuenta.

## Qué necesitas

- Un entorno Dynatrace SaaS (latest Dynatrace) con Grail, AppEngine y Workflows.
- Node.js 22 o posterior y npm, para compilar y desplegar la app.
- Permiso para desplegar apps. Para los avisos también necesitas a un administrador para el Credential Vault, la lista
  de hosts permitidos de External requests y las authorization settings de Workflows.
- Cuentas en los proveedores que vayas a usar: Twilio e IFTTT son los predeterminados. Slack, Microsoft Teams,
  Telegram y un webhook genérico también vienen integrados.

## Paso 1 — Desplegar la app

```bash
npm install
# app.config.json → "environmentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/"
npx dt-app deploy
```

- El ID de la app debe comenzar con `my.` para una app sin firmar. El predeterminado es `my.command.center`.
- Cada despliegue necesita un `app.version` mayor que la versión instalada en ese entorno.
- Al abrirla por primera vez, a cada usuario se le pide que dé su consentimiento a los permisos de la app (siguiente
  sección).

## Paso 2 — Entender los permisos

La app pide solo lo que usa. Cada scope de abajo fue aceptado cuando la app se desplegó en un entorno trial y fue
ejercitado allí por la funcionalidad de la segunda columna.

| Scope de la app | Para qué se usa | Dónde lo documenta Dynatrace |
| --- | --- | --- |
| `storage:buckets:read` | Cualquier lectura de Grail (requerido junto con el permiso de la tabla) | [Grail permissions](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail) |
| `storage:events:read` | El motor lee `dt.davis.problems`, `dt.davis.events` y `events` | [Grail permissions](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail) |
| `state:app-states:read` / `:write` / `:delete` | Configuración, incidentes, acciones de los operadores, registro de notificaciones (App State) | Referencia del SDK `@dynatrace-sdk/client-state` ("Required scope" de cada llamada), [State management API](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-state-management-v1) |
| `iam:users:read` | Búsqueda de miembros de equipo y nombres para mostrar | [IAM API: get users](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-iam-v1/organizational-levels-level-type-level-id-users-get) |
| `automation:workflows:read` | Integrations → Workflows: estado de instalación del workflow del motor; encontrar tu custom workflow | [Workflows security](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/security) |
| `automation:workflows:run` | La integración **Custom workflow**: el motor ejecuta tu workflow una vez por notificación | [Workflows security](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/security) |
| `document:documents:read` | War rooms: listar notebooks para adjuntar | [Document SDK](https://developer.dynatrace.com/develop/sdks/client-document/) |
| `document:documents:write` | War rooms: crear el notebook de post-mortem | Referencia del SDK `@dynatrace-sdk/client-document` ("Required scope" de `createDocument`) |
| `credential-vault:entries:read` | El motor lee los secretos de los proveedores cuando envía | [Credential Vault API](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-credential-vault-v1/entries-entry-id-get) |

**No se solicitan, y por qué**

- `automation:workflows:write`: la plataforma lo rechazó cuando desplegamos la app. El despliegue informó que solo las
  apps proporcionadas por Dynatrace pueden usar este scope. Por lo tanto, la app **no puede crear su workflow por sí
  misma**. El paso 5 muestra la alternativa de un clic.
- Ningún scope de ingesta: la app nunca escribe en Grail. Tus herramientas envían eventos con su propio token (consulta
  la [referencia de alertas](alerts-reference.md)).

**Permisos de usuario.** Un scope de la app no basta por sí solo. La app actúa con los permisos de cada **usuario**,
así que los usuarios también necesitan políticas de IAM que otorguen los mismos permisos (lectura de Grail, App State,
documentos, lectura de usuarios de IAM).

**La búsqueda de usuarios muestra solo usuarios activos.** La búsqueda de miembros de equipo usa el endpoint de IAM que
devuelve los usuarios *activos* de la cuenta propietaria del entorno. Alguien que fue invitado pero todavía no aceptó la
invitación **no se encuentra**. Pídele que inicie sesión una vez y luego vuelve a buscar.

## Paso 3 — Guardar los secretos de los proveedores en el Credential Vault

Crea una entrada por proveedor en **Credential Vault** (latest Dynatrace) y anota el ID de la entrada
(`CREDENTIAL_VAULT_ENTRY-…`). Command Center guarda **solo el ID**, nunca el secreto.

| Proveedor | Tipo de credencial | Contenido |
| --- | --- | --- |
| Twilio (SMS, voz, WhatsApp) | Username and password | Account SID / auth token, o API key SID / API key secret (en ese caso completa también *Account SID* en el proveedor) |
| IFTTT Webhooks | Token | Tu clave de IFTTT Webhooks |
| Slack | Token | La URL completa del incoming webhook `https://hooks.slack.com/…` |
| Microsoft Teams | Token | La URL completa del webhook de **Workflows** de Teams ("When a Teams webhook request is received") |
| Telegram | Token | El token del bot (la dirección de contacto de la persona es su chat ID) |
| Webhook genérico | Token, o username and password | Token: la URL `https://` del endpoint. Username/password: username = URL, password = el valor del header de autenticación |

Configuración de la entrada:

- Selecciona el scope **AppEngine**.
- Mantén **Owner access only** activado (recomendado) y haz que el **actor del workflow** (paso 5) sea el propietario,
  como en el entorno trial. La documentación de Dynatrace indica
  que una credencial se puede usar en una app solo cuando *tanto* el usuario como la app tienen acceso a ella.
- *Allow access without app context* **no** es necesario: el motor se ejecuta como una acción de la app. En el entorno
  trial, una entrada sin esa opción fue leída con éxito por el motor.

## Paso 4 — Permitir los hosts de los proveedores

**Settings → General → Environment management → External requests**: agrega solo los hosts que uses.

| Proveedor | Host |
| --- | --- |
| Twilio | `api.twilio.com` |
| IFTTT | `maker.ifttt.com` |
| Slack | `hooks.slack.com` |
| Microsoft Teams | El host de la URL de tu webhook de Teams Workflows (cópialo de la URL) |
| Telegram | `api.telegram.org` |
| Webhook genérico | El host de tu endpoint |

## Paso 5 — Instalar el workflow del motor

El motor es un único **simple workflow** llamado **Command Center · Engine**. Tiene una sola tarea, la acción propia
de la app **Run Command Center engine**, con un trigger de intervalo. Los simple workflows no consumen horas de workflow
([Create a simple workflow](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/build/simple-workflow)).
La [guía de operaciones](operations.md) explica el costo.

Abre **Command Center → Integrations → Workflows**, elige **Run every** 1, 2 o 5 minutos y luego usa una de estas
tres opciones:

| Opción | Cómo | Estado |
| --- | --- | --- |
| **A. Install in Workflows** | Abre la app Workflows con el workflow ya completado (intent "create workflow" de Workflows). Revísalo, guárdalo y despliégalo. | El payload del intent documentado por Dynatrace tiene título, tareas y trigger, pero **ningún tipo de workflow**. Si el nuevo workflow queda como un *standard* workflow, la pestaña Workflows muestra una advertencia. En ese caso elimínalo y usa B o C. |
| **B. Download JSON** | App Workflows → **Upload** → el archivo descargado. El archivo contiene `"type": "SIMPLE"` y el intervalo que elegiste. | Es la misma definición que se creó mediante la Automation API y se ejecutó en el entorno trial. El botón de carga en sí no fue ejercitado. |
| **C. Script de administración** | `DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com DT_PLATFORM_TOKEN=… node scripts/install-workflow.mjs --interval 1` (token con `automation:workflows:read` y `automation:workflows:write`). Idempotente; `--dry-run` imprime el JSON. | Verificado en el entorno trial: un simple workflow, ejecutándose cada minuto, todas las ejecuciones exitosas. |

Luego:

1. **Actor.** El workflow se ejecuta como su actor, que es la persona que lo despliega a menos que configures un
   usuario de servicio. La acción del motor lee Grail, App State y el Credential Vault con los permisos del actor.
2. **Authorization settings.** En la app Workflows → **Settings → Authorization settings**, habilita para el actor los
   permisos que usa el motor: `storage:buckets:read`, `storage:events:read`, `state:app-states:read`,
   `state:app-states:write`, `state:app-states:delete`, `credential-vault:entries:read` y, para los workflows de
   integración y la integración Custom workflow, `automation:workflows:run`. El actor de cada workflow de integración
   necesita `state:app-states:read`, `state:app-states:write` y `credential-vault:entries:read`: su acción lee los
   ajustes del proveedor, lee el secreto y registra el resultado. En el entorno trial se habilitaron todos los permisos para el actor, así que el conjunto mínimo no se aisló.
3. De vuelta en Command Center selecciona **Refresh**. Si el workflow se encontró por su título, selecciona **Save this
   ID**. El estado se pone en verde (**Installed · simple workflow**) y **Last engine run** se actualiza dentro de un
   intervalo.

**Run engine now** ejecuta de inmediato un ciclo completo a través de la función de la app `engine-run`, con tus
propios permisos. Úsalo para probar sin esperar a la programación.

## Paso 6 — Configurar los proveedores

**Integrations → Outbound**: cada tarjeta de proveedor tiene un interruptor **On/Off**, y solo se usan los proveedores
que están activados. Al activar uno por primera vez se abre **Configure**: pega el ID de la entrada del vault, completa
los parámetros no secretos y guarda. Puede haber un solo proveedor activado por canal.

Cuando se **activa** un proveedor integrado, la app Workflows se abre con **su propio workflow** ya completado
(*Command Center · <provider>*, un simple workflow cuya tarea es la acción de la app *Send Command Center notification*).
Guárdalo ahí. De vuelta en Integrations → Outbound, Command Center lo encuentra por su título y lo vincula; la tarjeta
entonces dice *Sent by its workflow*. Hasta que esté vinculado, el motor envía por sí mismo las notificaciones de ese
proveedor, así que no se pierde nada. Luego usa **Send test** con una dirección. Detalles:
[integraciones](integrations.md#integration-workflows).

| Proveedor | Parámetros |
| --- | --- |
| Twilio SMS / Voice / WhatsApp | *Sender number* en E.164 (WhatsApp: el remitente aprobado). *Account SID* solo con una API key. *Messaging service SID* (opcional, SMS). *Voice* y *Voice language* (opcional, llamadas). |
| IFTTT | *Event name* (predeterminado `command_center_alert`) |
| Slack, Microsoft Teams, Telegram | ninguno |
| Webhook genérico | *Auth header name* (opcional). El valor del header es el password de una entrada username/password. |
| Custom workflow | *Workflow ID* de un workflow que es tuyo (consulta [integraciones](integrations.md#custom-workflow)). Sin entrada del vault. |

## Paso 7 — Personas, calendarios, políticas y enrutamiento

La página del equipo te guía: su lista de verificación **Ready to page?** siempre resalta el siguiente paso.

1. **Teams → New team**: escribe un nombre y deja **Default team** (equipo predeterminado) marcado. El equipo recibe
   entonces toda alerta que ninguna regla de enrutamiento envía a otro lugar. Esto importa porque los problemas de
   Davis no traen equipo.
2. **Add people**: primero se ofrece tu propio usuario; para los demás, escribe al menos 3 caracteres de un nombre o
   correo electrónico.
3. **Add contact methods**: hay una fila lista para cada persona (teléfono en E.164, chat ID de Telegram, un nombre
   para Slack/Teams/IFTTT, una clave de enrutamiento para el webhook). **Save and next** pasa a la siguiente persona.
   Las reglas de notificación son opcionales, por ejemplo "P1–P2: voz ahora, SMS después de 5 minutos".
4. **Create schedule**: el calendario se abre con el nombre del equipo y con sus personas en la rotación. Ajusta el
   tipo de rotación y la hora de traspaso si hace falta, y guarda. La vista previa de cobertura muestra los huecos y
   los próximos traspasos.
5. **Create policy**: la política se abre con la persona de guardia primero y el equipo completo después de 10
   minutos. Guárdala. La sección **Simulation** muestra a quién se notifica y cuándo.
6. Opcional: **Services** y las **routing rules** envían ciertas alertas a otros equipos; **Test a rule** las
   comprueba. **Settings → Routing defaults** muestra el equipo y la política predeterminados.

Desde una app vacía, esto lleva unos 20 clics y campos escritos para un equipo de tres personas. Un problema de Davis
se enruta entonces al equipo y a su política de escalamiento (compruébalo con **Services → Test a rule**).

Detalles de cada pantalla: [guía del usuario](user-guide.md).

## Paso 8 — Enviar un evento de prueba

```bash
curl -X POST "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Bearer <PLATFORM-TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"CUSTOM_ALERT","title":"Test from Command Center setup","timeout":15,
       "properties":{"cc.service":"<your service name>","cc.priority":"P3"}}'
```

El token necesita `openpipeline:events.davis:ingest`. Dentro de un intervalo del motor, el incidente aparece en la
Console. Luego se avisa a la persona de guardia según la política. Reconócelo en la Console para detener el
escalamiento.

**Solo en un entorno trial o de pruebas**, `workflow-templates/command-center-alert-simulator.workflow.json` envía una
o dos alertas sintéticas `[SIM] …` cada 7 minutos. Es un standard workflow, así que consume horas de workflow, y nunca
debe importarse en producción.

## Modo demo

**Settings → General → Demo mode → Show sample data** cambia **este navegador** a incidentes, equipos, calendarios,
war rooms e informes de ejemplo. Mientras está activado, nada se lee del entorno ni se escribe en él, y no se envía
ninguna notificación. Cuando está desactivado, todo lo que se muestra son datos reales del entorno: la app nunca mezcla
ambos. El cambio es por navegador a propósito, para que la demo de un presentador nunca reemplace la consola real de
los operadores de guardia. Fuera de Dynatrace (la vista previa sin conexión) la app siempre se ejecuta en modo demo.
