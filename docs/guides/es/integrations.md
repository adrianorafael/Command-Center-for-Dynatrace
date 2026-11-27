# Integraciones — cómo salen las notificaciones

🌐 [English](../en/integrations.md) · [Português (BR)](../pt-BR/integrations.md) · **Español**

Los eventos de entrada se cubren en la [referencia de alertas](alerts-reference.md). Esta página cubre el lado de
salida: los ocho canales, qué recibe cada proveedor, la integración custom workflow y cómo probarlos.

![Integrations — Outbound](../../screenshots/integrations-outbound.png)

## Cómo se envía una notificación

1. El motor se ejecuta según su programación (simple workflow, una acción). Decide a quién se debe notificar ahora: el
   paso de escalamiento que vence, las personas de guardia de sus destinos y las reglas de notificación de cada persona.
2. Escribe una **entrada del registro de notificaciones** (ledger) (`planned`) por persona, paso, canal e intento.
3. Justo después de planificar, la misma ejecución envía: a través del workflow propio de la integración cuando hay uno
   vinculado (más abajo), o si no, directamente — lee el secreto del proveedor desde el Credential Vault y llama al
   proveedor por HTTPS (o ejecuta tu custom workflow).
4. El resultado se escribe de vuelta: `sent` (con la referencia del proveedor cuando se devuelve una) o `failed` (con
   el error del proveedor; los secretos y las URLs se enmascaran como `***` y `<url>`).
5. Una notificación que falló, o que no obtuvo resultado dentro de *Delivery report timeout* (`timeout`), se reintenta
   con un nuevo intento mientras el incidente siga triggered, hasta *Delivery attempts* (predeterminado 3).

Cada llamada HTTP tiene un timeout de 10 segundos. Una ejecución no inicia ningún envío nuevo pasados unos 90 segundos
desde su comienzo; lo que queda se envía en la siguiente ejecución. Los avisos son **al menos una vez** (at least once): en carreras poco
frecuentes (una ejecución que se superpone con una ejecución anterior lenta) una persona puede ser notificada dos
veces.

## Canales y proveedores

| Canal | Proveedor (ID predeterminado) | Dirección de contacto de una persona | Entrada del vault |
| --- | --- | --- | --- |
| SMS | Twilio SMS (`twilio-sms`) | Teléfono en E.164, por ejemplo `+5511999990000` | Username/password: Account SID (o API key SID) / auth token (o API key secret) |
| Llamada de voz | Twilio Voice (`twilio-voice`) | Teléfono en E.164 | igual |
| WhatsApp | Twilio WhatsApp (`twilio-whatsapp`) | Teléfono en E.164 (se agrega el prefijo `whatsapp:`) | igual |
| IFTTT | IFTTT Webhooks (`ifttt`) | Cualquier etiqueta: el applet decide a dónde va | Token: tu clave de Webhooks |
| Slack | Slack (`slack`) | Cualquier etiqueta: el webhook decide el canal; el mensaje muestra el nombre de la persona | Token: la URL del incoming webhook |
| Microsoft Teams | Microsoft Teams (`teams`) | Cualquier etiqueta: el webhook decide el chat; la tarjeta muestra el nombre de la persona | Token: la URL del webhook de Teams Workflows |
| Telegram | Telegram (`telegram`) | El chat ID | Token: el token del bot |
| Webhook | Webhook genérico (`webhook`) | Una clave de enrutamiento para tu endpoint | Token: la URL del endpoint. O username/password: username = URL, password = valor del header de autenticación |
| Webhook | Custom workflow (`custom-workflow`) | Una clave de enrutamiento, que se pasa como `notification.to.address` | ninguna: el workflow ID de un workflow que es tuyo |

Todos los proveedores comienzan **desactivados** y tienen un interruptor **On/Off** en su tarjeta. Un proveedor se usa
solo mientras está activado y configurado (un ID de entrada del vault; para el custom workflow, un workflow ID). Puede
haber un solo proveedor activado por canal: el webhook genérico y el custom workflow comparten el canal *webhook*. Los
proveedores desactivados no cuestan nada y no se ejecuta nada de ellos.

## Integration workflows

Cada integración integrada puede tener **su propio workflow**, que se crea cuando la activas:

| Paso | Qué ocurre |
| --- | --- |
| Activar (**on**) | Command Center guarda el proveedor y abre la app Workflows con *Command Center · <provider>* ya completado: un simple workflow, sin trigger (bajo demanda), una tarea — la acción de la app **Send Command Center notification** con las entradas `providerId` y `notification` = `{{ execution().params.notification }}`. Tú lo guardas (una confirmación: la app no puede crear workflows por sí misma). |
| De vuelta en Command Center | Integrations → Outbound encuentra el workflow por su título y lo vincula (su ID se guarda en el proveedor). **Configure → Integration workflow** también ofrece *Create its workflow*, *Download JSON*, *Find its workflow* y *Unlink*. |
| Vence una notificación | El motor ejecuta ese workflow con la notificación como parámetros de ejecución. La acción lee los ajustes del proveedor desde Command Center y el secreto desde el Credential Vault, envía, y escribe *Sent* o *Failed* en el registro de notificaciones. Un envío fallido hace fallar la ejecución del workflow, así que se ve en la app Workflows. |
| El workflow no se puede ejecutar | Eliminado, o sin permiso: el motor envía esa notificación directamente, para que nadie se pierda un aviso. Hasta que haya un workflow vinculado, el motor también envía directamente. |
| Desactivar (**off**) | El proveedor y su workflow dejan de usarse; el vínculo se conserva para cuando lo vuelvas a activar. La app no puede pausar ni eliminar workflows: elimínalo en la app Workflows si no lo necesitas. |

Cada notificación de una integración vinculada es una ejecución de workflow con una invocación de acción, además de la ejecución del motor que la planificó. Como simple
workflows, no consumen horas de workflow. Si un workflow se creó como *standard* workflow (el intent create-workflow no
tiene campo de tipo), *Find its workflow* lo indica y la vinculación automática lo omite; en ese caso sube el JSON
descargado.

## Qué recibe cada proveedor

| Proveedor | Solicitud | Contenido |
| --- | --- | --- |
| Twilio SMS | `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` (formulario, HTTP Basic) | `To`, `Body` (el texto del SMS, como máximo 1,600 caracteres), `From` o `MessagingServiceSid` |
| Twilio WhatsApp | mismo endpoint | `To` y `From` con el prefijo `whatsapp:`, `Body` |
| Twilio Voice | `POST …/Calls.json` | `To`, `From`, `Twiml`: el mensaje se pronuncia dos veces con `<Say>` (`voice` y `language` opcionales) |
| IFTTT | `POST https://maker.ifttt.com/trigger/{event}/with/key/{key}` | `value1` = asunto, `value2` = texto, `value3` = enlace al incidente |
| Slack | `POST` a la URL del webhook | Un mensaje con el asunto, el texto y el enlace al incidente. El markup de Slack se escapa, así que el título de una alerta no puede mencionar `@channel`. |
| Microsoft Teams | `POST` a la URL del webhook | Una Adaptive Card con el asunto, el texto y un botón **Open in Command Center** |
| Telegram | `POST https://api.telegram.org/bot{token}/sendMessage` | `chat_id`, `text` = asunto + texto + enlace, como texto plano (sin markup), vistas previas de enlaces desactivadas |
| Webhook genérico | `POST` a tu URL, `Content-Type: application/json`, header de autenticación opcional | `{"source":"command-center","version":1,"notification":{…}}` (más abajo) |

Microsoft Teams: solo se admiten webhooks de **Teams Workflows**. Microsoft retiró los antiguos webhooks de conectores
de Office 365.

### Payload del webhook genérico

```json
{
  "source": "command-center",
  "version": 1,
  "notification": {
    "key": "dp-p-26112716.1.0.1a2b3c4d.webhook.1",
    "incidentId": "dp-p-26112716",
    "displayId": "P-26112716",
    "cycle": 1,
    "step": 0,
    "attempt": 1,
    "channel": "webhook",
    "providerId": "webhook",
    "priority": "P2",
    "to": { "uid": "<IAM user id>", "address": "<routing key>", "name": "Ana Lima" },
    "subject": "[P2] P-26112716 Checkout latency above 2 s · Command Center",
    "text": "P2 P-26112716: Checkout latency above 2 s …",
    "incidentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/ui/apps/my.command.center/incidents/dp-p-26112716"
  }
}
```

| Campo | Significado |
| --- | --- |
| `key` | Único por incidente, ciclo de escalamiento, paso, persona, canal e intento. Úsalo para deduplicar de tu lado. |
| `cycle` | Ciclo de escalamiento, que comienza en 1. Se incrementa cuando el incidente se dispara de nuevo, se reabre, deja de estar pospuesto o se deshace su reconocimiento; *Escalate now* lo incrementa solo después de que la política queda agotada. |
| `step` | Ordinal de escalamiento: pasada × cantidad de pasos + índice del paso (0 = primer paso de la primera pasada) |
| `attempt` | 1 para el primer intento, luego 2, 3… para los reintentos después de un timeout |
| `to` | La persona: ID de usuario de IAM, la dirección de su método de contacto, nombre para mostrar |
| `subject`, `text` | Textos prearmados (límites más abajo) |
| `speech` | Solo para voz: el texto que se pronuncia |

Esta es la vía de salida hacia cualquier herramienta sin un emisor integrado: un ITSM, un gateway de correo
electrónico, un chatbot, otro servicio de avisos. Si prefieres construir esa llamada en Dynatrace Workflows, usa el
custom workflow que se describe a continuación.

## Custom workflow

El proveedor **Custom workflow** entrega cada notificación a un workflow **que es tuyo y que tú editas**, para que
puedas llegar a cualquier sistema con cualquier acción de Workflows (HTTP request, correo electrónico, ITSM, chat) sin
cambiar Command Center.

1. **Integrations → Outbound → Custom workflow → Configure → Create example workflow.** La app Workflows se abre con
   un simple workflow llamado *Command Center · Custom integration*: una tarea **HTTP request**, método POST, una URL
   de ejemplo `https://example.com/command-center/notifications`, un header de ejemplo y el cuerpo
   `{{ execution().params | to_json }}`. O selecciona **Download example JSON** y súbelo en la app Workflows.
2. En la app Workflows, reemplaza la URL y los headers por los de tu endpoint, o reemplaza la tarea por cualquier
   acción. La notificación está disponible en las expresiones, por ejemplo `{{ execution().params.notification.subject }}`,
   `{{ execution().params.notification.priority }}` o `{{ execution().params.notification.to.address }}`. Guárdalo.
3. De vuelta en Command Center selecciona **Find my workflow** → **Use** (o pega el workflow ID), **Save**, cambia el
   proveedor a **On** y usa **Send test**.
4. Agrega el host de tu endpoint a *External requests*. En las **Authorization settings** de Workflows, el actor del
   workflow del motor necesita `automation:workflows:run`, y el actor de tu workflow necesita los permisos que usa su
   tarea.

Los parámetros de ejecución son el mismo JSON que el cuerpo del webhook genérico: `{"source":"command-center","version":1,
"notification":{…}}`. *Sent* significa que la ejecución del workflow fue aceptada. Lo que tu workflow haga después no
lo rastrea Command Center: revisa sus ejecuciones en la app Workflows. Cada notificación es una ejecución del workflow.
Como simple workflow no consume horas de workflow; su tarea se factura como cualquier tarea de workflow. El ejemplo no
tiene un trigger propio (bajo demanda), y aplica la misma salvedad que para el motor: si el intent lo crea como un
*standard* workflow, **Find my workflow** lo indica, y el JSON subido crea uno simple.

## Textos de los mensajes

- **Asunto:** `[P2] P-26112716 <title> · Command Center`, como máximo 150 caracteres.
- **SMS y voz:** `P2 P-26112716: <title> <service> Ack: <incident link>`, como máximo 300 caracteres. El título se
  acorta primero.
- **Otros canales:** prioridad, ID, título, servicio, equipo, descripción (como texto plano) y hasta cinco entidades
  afectadas, y luego el enlace. Límites: WhatsApp 1,000, IFTTT 1,000, Slack 3,000, Teams 3,000, Telegram 3,500,
  webhook 4,000 caracteres.
- En una repetición de la política el texto dice `(repeat N)`.

Los textos de los mensajes incluyen el título y la descripción de la alerta. No pongas secretos ni datos personales en
los títulos de los eventos si se envían a terceros.

## Reglas de notificación y urgencia

Cada persona tiene **métodos de contacto** y **reglas de notificación** (Teams → persona → Contact methods). Una regla
dice: "para incidentes de prioridad Px o más urgentes, usa este método N minutos después de que se dispare el paso". Un
paso de escalamiento también puede **forzar canales**, lo que reemplaza las reglas personales para ese paso.

Durante las **horas de silencio** de un equipo en modo *baja urgencia* (low urgency), solo se usan Slack, Teams,
Telegram, IFTTT y webhook. SMS, voz y WhatsApp se omiten.

## Probar un proveedor

**Integrations → Outbound → proveedor → Send test** envía un mensaje a la dirección que escribas, a
través del mismo código que usa el motor (función de la app `engine-run` con `reason: "test"`). El resultado (enviado o
el error del proveedor) se muestra de inmediato. Prueba de punta a punta cada canal que actives antes de depender de él.

## Qué se ha verificado

| Proveedor | Estado |
| --- | --- |
| Webhook genérico | ✅ Verificado en vivo en un entorno trial: escalamientos y pruebas entregados, resultados escritos en el registro de notificaciones |
| Custom workflow | ✅ Verificado en vivo en un entorno trial: una prueba y un escalamiento programado ejecutaron el workflow, que entregó el JSON completo de la notificación al receptor |
| Integration workflows | ✅ Verificado en vivo en un entorno trial con el webhook genérico: el motor ejecutó *Command Center · Generic webhook*, su acción leyó el proveedor y el secreto del vault y entregó; un error del proveedor (HTTP 429) hizo fallar la ejecución del workflow con el mensaje del proveedor |
| Twilio SMS, voz, WhatsApp, IFTTT, Slack, Microsoft Teams, Telegram | Implementados a partir de la documentación de la API de cada proveedor, **no ejercitados en vivo** (no hay cuentas en el entorno de pruebas). Las pruebas unitarias cubren las solicitudes de Twilio SMS y voz, Slack y Telegram. Prueba cada proveedor con *Send test*. |

Las respuestas bidireccionales (reconocer respondiendo un SMS o un mensaje de chat) no están implementadas. Reconoce en
la Console.
