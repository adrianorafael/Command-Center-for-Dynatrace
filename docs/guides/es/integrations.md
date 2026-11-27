# Integraciones — cómo salen las notificaciones

🌐 [English](../en/integrations.md) · [Português (BR)](../pt-BR/integrations.md) · **Español**

Los eventos de entrada se cubren en la [referencia de alertas](alerts-reference.md). Esta página cubre el lado de
salida: los ocho canales, qué recibe cada proveedor y cómo probarlos.

![Integrations — Outbound](../../screenshots/integrations-outbound.png)

## Cómo se envía una notificación

1. El motor se ejecuta según su programación (simple workflow, una acción). Decide a quién se debe notificar ahora: el
   paso de escalamiento que vence, las personas de guardia de sus destinos y las reglas de notificación de cada persona.
2. Escribe una **entrada del registro de notificaciones** (ledger) (`planned`) por persona, paso, canal e intento.
3. En la misma ejecución lee el secreto del proveedor desde el Credential Vault y llama al proveedor por HTTPS.
4. El resultado se escribe de vuelta: `sent` (con la referencia del proveedor cuando se devuelve una) o `failed` (con
   el error del proveedor; los secretos y las URLs se enmascaran como `***` y `<url>`).
5. Una notificación que no tiene resultado después de *Delivery report timeout* pasa a `timeout` y se reintenta, hasta
   *Delivery attempts* (predeterminado 3).

Cada llamada HTTP tiene un timeout de 10 segundos. Una ejecución deja de enviar después de unos 100 segundos; lo que
queda se envía en la siguiente ejecución. Los avisos son **al menos una vez** (at least once): en carreras poco
frecuentes (una ejecución que se superpone con una ejecución anterior lenta) una persona puede ser notificada dos
veces.

## Canales y proveedores

| Canal | Proveedor (ID predeterminado) | Dirección de contacto de una persona | Entrada del vault |
| --- | --- | --- | --- |
| SMS | Twilio SMS (`twilio-sms`) | Teléfono en E.164, por ejemplo `+5511999990000` | Username/password: Account SID (o API key SID) / auth token (o API key secret) |
| Llamada de voz | Twilio Voice (`twilio-voice`) | Teléfono en E.164 | igual |
| WhatsApp | Twilio WhatsApp (`twilio-whatsapp`) | Teléfono en E.164 (se agrega el prefijo `whatsapp:`) | igual |
| IFTTT | IFTTT Webhooks (`ifttt`) | Una etiqueta (el applet decide a dónde va) | Token: tu clave de Webhooks |
| Slack | Slack (`slack`) | Una etiqueta o handle, que se muestra en el mensaje | Token: la URL del incoming webhook |
| Microsoft Teams | Microsoft Teams (`teams`) | Una etiqueta o handle, que se muestra en la tarjeta | Token: la URL del webhook de Teams Workflows |
| Telegram | Telegram (`telegram`) | El chat ID | Token: el token del bot |
| Webhook | Webhook genérico (`webhook`) | Una clave de enrutamiento para tu endpoint | Token: la URL del endpoint. O username/password: username = URL, password = valor del header de autenticación |

Todos los proveedores comienzan **desactivados**. Un proveedor se usa solo cuando está activado y tiene un ID de entrada
del vault.

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
    "key": "dp-p-26112716.0.0.1a2b3c4d.webhook.1",
    "incidentId": "dp-p-26112716",
    "displayId": "P-26112716",
    "cycle": 0,
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
| `cycle` | Ciclo de escalamiento, que se incrementa con *Escalate now* y con un nuevo disparo |
| `step` | Índice del paso de escalamiento (0 = primer paso) |
| `attempt` | 1 para el primer intento, luego 2, 3… para los reintentos después de un timeout |
| `to` | La persona: ID de usuario de IAM, la dirección de su método de contacto, nombre para mostrar |
| `subject`, `text` | Textos prearmados (límites más abajo) |
| `speech` | Solo para voz: el texto que se pronuncia |

Esta es la vía de salida hacia cualquier herramienta sin un emisor integrado: un ITSM, un gateway de correo
electrónico, un chatbot, otro servicio de avisos.

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

**Integrations → Outbound → proveedor → Send test notification** envía un mensaje a la dirección que escribas, a
través del mismo código que usa el motor (función de la app `engine-run` con `reason: "test"`). El resultado (enviado o
el error del proveedor) se muestra de inmediato. Prueba de punta a punta cada canal que actives antes de depender de él.

## Qué se ha verificado

| Proveedor | Estado |
| --- | --- |
| Webhook genérico | ✅ Verificado en vivo en un entorno trial: escalamientos y pruebas entregados, resultados escritos en el registro de notificaciones |
| Twilio SMS, voz, WhatsApp, IFTTT, Slack, Microsoft Teams, Telegram | Implementados a partir de la documentación de la API de cada proveedor y cubiertos por pruebas unitarias, **no ejercitados en vivo** (no hay cuentas en el entorno de pruebas). Pruébalos con *Send test notification*. |

Las respuestas bidireccionales (reconocer respondiendo un SMS o un mensaje de chat) no están implementadas. Reconoce en
la Console.
