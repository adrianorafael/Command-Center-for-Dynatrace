# Referencia de configuración — cada ajuste, función de la app y clave almacenada

Los ajustes son **para toda la app**: un cambio se aplica a todos los usuarios de la app en el entorno. Las únicas
excepciones son los elementos marcados como *this browser* (este navegador), que se guardan de inmediato. Las secciones
General, Event sources, Routing defaults, Paging engine y Data retention tienen cada una su propio botón **Save**. La
validación se ejecuta antes de guardar e indica el nombre del campo que hay que corregir.

![Settings](../../screenshots/settings.png)

## General

| Ajuste | Predeterminado | Rango | Efecto |
| --- | --- | --- | --- |
| Tenant time zone | La zona horaria del navegador | Zonas IANA | Marcas de tiempo, calendarios, traspasos y días de los informes |
| Auto-refresh default | 1 min | Off, 15 s, 30 s, 1 min, 5 min | Con qué frecuencia las páginas abiertas recargan App State. Sin costo de Grail: la UI no ejecuta DQL. |
| Table density *(this browser)* | Condensed | Default, Condensed | Altura de fila de las tablas |
| Single-key keyboard shortcuts in the Console *(this browser)* | On | On, Off | `j`/`k`, `a`, `r`, `x`, `/`, `Shift+R`, `Esc` |
| Acknowledge target (minutes) *(this browser)* | 5 | 1–240 | Los incidentes más antiguos que este valor sin un reconocimiento se ponen en rojo en la Console. Determina el medidor de MTTA. |
| Demo mode → Show sample data *(this browser)* | Off | On, Off | On: datos de ejemplo en todas partes. Nada se lee del entorno ni se guarda en él, y no se envía ninguna notificación. Off: solo datos reales. La página se recarga cuando lo cambias. |

¿Por qué el modo demo es por navegador? Un ajuste compartido reemplazaría la consola real de cada operador por datos de
ejemplo mientras los avisos reales siguen en segundo plano. Con un cambio por navegador, un presentador puede hacer una
demo en su propia pantalla sin afectar a nadie de guardia.

Otras elecciones también se guardan en este navegador, donde las haces: las columnas de la Console y **Row actions**
(qué acciones se muestran como botones en cada fila), *Workdays only* en On-call, las preferencias de pop-ups de la
campana y el idioma de Help.

## Event sources

| Ajuste | Predeterminado | Rango | Efecto |
| --- | --- | --- | --- |
| Davis problems | On | | Lee `dt.davis.problems` (consulta Q1) y las propiedades `cc.*` de sus eventos (Q4) |
| Look back (hours) | 72 | 1–336 | Hasta qué punto hacia atrás leen Q1 y Q4. Un problema más antiguo que este valor ya no se ve. |
| Page during maintenance windows | Off | | Off: los problemas bajo una ventana de mantenimiento de Davis crean incidentes pero no avisan a nadie |
| Davis events that don't open a problem (Events API v2) | Off | | Lee `dt.davis.events` de los tipos listados (Q2, últimas 24 h) |
| Davis event types | `CUSTOM_ALERT, ERROR_EVENT` | Separados por comas | Tipos de evento que lee Q2 |
| Generic events (OpenPipeline) | Off | | Lee la tabla `events` (Q3, últimas 24 h) |
| Generic event type | `command_center.alert` | | `event.type` que lee Q3 |
| Grail scan limit per query (GB) | 1 | 1–100, GB enteros | Protección de costo: el máximo de datos que puede escanear una consulta del motor. Una consulta que lo alcanza marca su fuente como incompleta en el último error del motor (Integrations → Workflows), nunca como todo en orden. Debajo del campo: lo que escaneó la última ejecución. Consulta [costo](operations.md#costo-y-consumo). |

Los formatos y los campos están en la [referencia de alertas](alerts-reference.md).

## Routing defaults

Se usan cuando ninguna regla de enrutamiento, propiedad del evento o servicio decide.

| Ajuste | Predeterminado | Efecto |
| --- | --- | --- |
| Default team | ninguno (viene marcado cuando creas el primer equipo) | Equipo para los incidentes que ninguna regla o servicio asigna. Los problemas que Davis detecta por sí solo no traen equipo: sin un equipo predeterminado o reglas de enrutamiento, no avisan a nadie. También se define desde un equipo (**New team**, **Edit team** o el *Receive all unrouted alerts* de la lista de verificación). Eliminar el equipo predeterminado lo deja sin definir. |
| Default escalation policy | ninguna | Política cuando ni la regla, ni el servicio, ni el equipo tienen una. Sin una política no se avisa a nadie. |
| Fallback priority | P3 | Último paso del orden de prioridad |

El mapeo de prioridad por severidad y categoría se edita en **Services → Priority mapping**.

## Paging engine

| Ajuste | Predeterminado | Rango | Efecto |
| --- | --- | --- | --- |
| Engine enabled | On | | Off pausa **todos** los avisos. El motor sigue ejecutándose según la programación pero no hace nada. |
| Engine workflow ID | Lo completa Integrations → Workflows | UUID | Permite que la pestaña Workflows encuentre y vincule el workflow. El intervalo (1, 2 o 5 minutos) se elige al instalar; la app lo vuelve a leer del workflow instalado. Con el workflow opcional *Engine on problem* instalado, 5 minutos bastan para la mayoría de los equipos. |
| Max notifications per run | 100 | 1–500 | Las notificaciones que superan este valor se vuelven a planificar en la siguiente ejecución |
| Delivery report timeout (seconds) | 180 | 30–3600 | Una notificación sin resultado de entrega después de este tiempo se marca como *timeout* y se reintenta |
| Delivery attempts | 3 | 1–10 | Intentos por notificación antes de que se marque como fallida |
| Engine lock lease (seconds) | 130 | 30–180 | Evita que dos ejecuciones avisen dos veces. El motor siempre usa un valor entre 130 y 180. |

## Data retention

| Ajuste | Predeterminado | Rango | Efecto |
| --- | --- | --- | --- |
| Keep resolved incidents visible (hours) | 24 | 1–720 | Después el incidente se archiva y sale de la Console |
| Archive resolved incidents for (days) | 30 | 1–90 | Cuánto tiempo se conservan los incidentes archivados. App State permite como máximo 90 días. |

La sección muestra una estimación del App State que usan los datos cargados en esta página (excluidos los
incidentes archivados). App State permite 50 MB por app.

## Export and import

- **Export configuration** descarga como JSON los ajustes, equipos, calendarios, políticas, servicios, reglas de
  enrutamiento y contactos. No se incluyen incidentes, war rooms ni historial.
- **Import configuration** valida primero el archivo completo, incluidas las referencias entre las entidades. Si algo
  está mal, no se escribe nada y obtienes la lista de errores. Los equipos, calendarios, políticas, servicios y contactos
  se **agregan o actualizan por ID** y nunca se eliminan. Las reglas de enrutamiento del archivo **reemplazan** las
  reglas actuales, y una lista de proveedores en el archivo reemplaza los proveedores actuales. Los demás ajustes se
  fusionan.
- El archivo contiene números de teléfono, chat IDs e IDs de entradas del Credential Vault en texto plano: guárdalo como
  datos personales.
- **Legacy data** (datos heredados): la versión 1 guardaba los reconocimientos en la clave de App State `problem-ack-states`. La
  versión 2 no la lee, y este botón la elimina.

## Permissions y About

**Permissions** lista los scopes de la app y lo que habilita cada uno (la misma lista que en
[primeros pasos](getting-started.md#paso-2--entender-los-permisos)). Los roles de equipo (*Team admin*, *Responder*,
*Observer*) son orientativos para las personas. App State no tiene permisos por clave, así que cualquier usuario de la
app puede cambiar la configuración. Tus políticas de IAM deciden quién puede abrir la app.

**About** muestra la versión de la app, la versión del esquema de datos y si la app está conectada al entorno o se
ejecuta en modo demo.

## Funciones de la app (automatización y scripts)

Cada función se llama con `POST https://YOUR-ENVIRONMENT.apps.dynatrace.com/platform/app-engine/app-functions/v1/apps/my.command.center/api/<name>`
y se ejecuta con los permisos de **quien la llama**. Quien la llama necesita `app-engine:apps:run` más los permisos de
los datos que toca.

- **`config`**
  - *Cuerpo*: `{"op":"export"}` o `{"op":"import","bundle":{…},"dryRun":true}`
  - *Devuelve*: Export: `{ok, bundle}`. Import: conteos, o `errors[]` con entidad, ruta y mensaje.
  - *Verificado*: Sí (export, import, dry run)
- **`engine-run`**
  - *Cuerpo*: `{"reason":"manual"}` o `{"reason":"test","testRequest":{"providerId","channel","address"}}`
  - *Devuelve*: `{ok, sent, failed, deferred, counts, errors, skipped?}`. Si una ejecución programada tiene el lease, espera hasta unos 20 segundos.
  - *Verificado*: Sí
- **`status`**
  - *Cuerpo*: `{}`
  - *Devuelve*: `{heartbeat, lease, openIncidents, triggered}` — para verificaciones de salud externas
  - *Verificado*: Sí
- **`incidents`**
  - *Cuerpo*: `{}` o `{"status":"triggered"}`
  - *Devuelve*: Los 200 resúmenes de incidentes más recientes, sin datos de contacto ni línea de tiempo
  - *Verificado*: Sí
- **`directory`**
  - *Cuerpo*: `{"query":"ana"}` o `{"uids":[…]}`
  - *Devuelve*: Usuarios de IAM
  - *Verificado*: Con un platform token, la API de IAM respondió *User not authorized* (también al llamarla directamente, incluso para el propietario de la cuenta). Responde para la sesión de un usuario que inició sesión.

```bash
curl -X POST "https://YOUR-ENVIRONMENT.apps.dynatrace.com/platform/app-engine/app-functions/v1/apps/my.command.center/api/config" \
  -H "Authorization: Bearer <PLATFORM-TOKEN>" -H "Content-Type: application/json" \
  -d '{"op":"export"}' > command-center-config.json
```

## Qué se almacena y dónde

Todo vive en el **App State** de esta app en tu entorno. No hay base de datos externa. Las claves están en minúsculas,
tienen como máximo 200 caracteres, y los valores son JSON con un `schemaVersion`.

| Clave | Escrita por | Contenido | Vencimiento |
| --- | --- | --- | --- |
| `cfg.settings` | UI | Ajustes, incluidos los proveedores (solo los **IDs** de las entradas del vault) | ninguno |
| `rules.main` | UI | Reglas de enrutamiento ordenadas | ninguno |
| `team.<id>`, `sched.<id>`, `pol.<id>`, `svc.<id>` | UI | Equipos, calendarios, políticas, servicios | ninguno |
| `contact.<uid>` | UI | Los métodos de contacto, las reglas de notificación y el nombre visible de una persona (sin email) | ninguno |
| `war.<id>` | UI | War room | ninguno |
| `inc.<id>` | motor | Incidente (línea de tiempo limitada a 200 entradas) | archivado después del período visible |
| `act.<incId>.<time>.<rand>` | UI | Una acción de un operador (reconocer, nota…) | 7 días, se elimina una vez aplicada |
| `ntf.<key>` | motor | Entrada del registro de notificaciones | 14 días |
| `arc.<yyyymmdd>.<id>` | motor | Incidente archivado | *Archive resolved incidents for* |
| `rpt.<yyyy-mm-dd>` | motor | Resumen diario para Reports | 90 días |
| `hb.engine` | motor | Heartbeat: última ejecución, duración, conteos, último error, estimación de almacenamiento | ninguno |
| `lock.engine` | motor | Lease del motor | se libera al final de cada ejecución |

**Por qué los operadores nunca escriben incidentes.** App State no tiene bloqueo optimista: gana la última escritura.
Por eso cada acción de un operador es su propia clave `act.*`. El motor aplica estas acciones en orden en la siguiente
ejecución, y la UI muestra el resultado de inmediato con la misma lógica. Las ediciones de configuración (equipos,
calendarios…) son de tipo última-escritura-gana: si dos personas guardan el mismo equipo al mismo tiempo, gana el
guardado posterior.
