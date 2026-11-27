/**
 * Texts of the Help overview (the page without `?doc=`) in each documentation language.
 *
 * Why this exists: the language selector applies to the whole Help page. When the overview was English only, choosing
 * Português or Español changed the sidebar labels but not the page, so the selected language and the content shown
 * disagreed. The app's own UI is English, so button and menu names stay English inside the translations, as in the
 * translated guides.
 *
 * Pure data: no React (the English event notes come from components/snippets.ts, shared with Integrations). Section ids (`TOC_IDS`) are the same in every language, so `/help#shortcuts` from the Help menu
 * lands whatever language is selected.
 */
import { EVENT_SOURCE_NOTE, RESOLVE_NOTE } from "../../components/snippets";
import type { Language } from "./guides/content";

export const TOC_IDS = ["get-started", "concepts", "console", "inbound", "outbound", "shortcuts", "troubleshooting", "privacy"] as const;
export type OverviewSectionId = (typeof TOC_IDS)[number];

export const SHORTCUT_KEYS = ["j", "k", "Escape", "a", "r", "x", "/", "Shift+R"] as const;
type ShortcutKey = (typeof SHORTCUT_KEYS)[number];

/** Event properties in the order of EVENT_FIELDS (components/snippets.ts). */
export const EVENT_FIELD_KEYS = ["title", "eventType / event.category", "entitySelector", "cc.dedup_key", "cc.priority", "cc.service", "cc.tags", "cc.action"] as const;
type EventFieldKey = (typeof EVENT_FIELD_KEYS)[number];

/** The five Get started steps, in order: team, ready checklist, provider, engine workflow, test event. */
export type StepLabels = [string, string, string, string, string];

export interface OverviewText {
  title: string;
  subtitle: string;
  sections: Record<OverviewSectionId, string>;
  getStartedIntro: string;
  steps: StepLabels;
  done: string;
  toDo: string;
  concepts: string;
  console: string;
  /** Text before the token permission name, and the text right after it (starting with its own space if one is needed). */
  inbound: [string, string];
  resolveNote: string;
  eventSourceNote: string;
  fieldHeader: string;
  usedForHeader: string;
  eventFields: Record<EventFieldKey, string>;
  /** Tab title of the Dynatrace Workflow snippet; the other snippet tabs are product names. */
  workflowSnippet: string;
  outbound: string;
  shortcutsIntro: string;
  shortcuts: Record<ShortcutKey, string>;
  troubleshooting: string;
  privacy: string;
}

const en: OverviewText = {
  title: "Help",
  subtitle: "How Command Center turns Dynatrace alerts into incidents, pages and reports",
  sections: {
    "get-started": "Get started",
    concepts: "Concepts",
    console: "Console workflow",
    inbound: "Sending events (inbound)",
    outbound: "Notifications (outbound)",
    shortcuts: "Keyboard shortcuts",
    troubleshooting: "Troubleshooting",
    privacy: "Privacy",
  },
  getStartedIntro: "Five steps take you from an empty app to paging people. Completed steps are checked from the app's current data.",
  steps: [
    "Create a team",
    "Finish the team's “Ready to page?” checklist: people, contact methods, schedule, escalation policy, routing",
    "Switch on a notification provider",
    "Install the engine workflow",
    "Send a test event",
  ],
  done: "Done",
  toDo: "To do",
  concepts: `
- **Incident**: one alert from Davis or the Events API after deduplication. It moves from *Triggered* to *Acknowledged* to *Resolved*; *Snoozed* hides it until a time, then it triggers again.
- **Priority**: P1 (critical) to P5 (informational). Set by a routing rule, the event's \`cc.priority\`, the service default, or the priority mapping. Priority doesn't decide *whether* someone is paged (the escalation policy does, and a routing rule can suppress); it selects people's notification rules and quiet-hours behaviour.
- **Team**: Dynatrace users with a role. *Team admins* edit the team and get paged, *Responders* get paged, *Observers* only watch and are never paged.
- **Schedule**: who is on call. A **rotation** makes its people take turns daily, weekly or every N hours, optionally only in certain hours. A schedule can have more rotations (**layers**), for example for nights or weekends: where their hours overlap, the layer further down the list is on call. **Overrides** win over everything.
- **Escalation policy**: ordered steps. Each step waits a number of minutes, then notifies an on-call schedule, a whole team, or a person. It can repeat; it stops as soon as someone acknowledges.
- **Service and routing rule**: rules are checked top to bottom and the first match decides service, team, policy and priority, or suppresses the alert. An alert that no rule or service assigns goes to the **default team**. Problems that Davis detects on its own carry no team (only events you post can name a service in \`cc.service\`): without a default team or a routing rule they page nobody.
`,
  console: `
1. **Acknowledge** to stop escalation and tell your team you're on it. The confirmation pop-up offers Undo for 10 seconds (also after Resolve), unless you silenced pop-ups.
2. **Reassign** to a team or a person, optionally with a note.
3. **Snooze** for 15 minutes to 4 hours, or until a custom time. Escalation resumes afterwards.
4. **Escalate now** jumps to the next step immediately.
5. **Resolve** when the problem is fixed. Davis problems also resolve automatically when Davis closes them.
6. **Notes** are append-only and part of the audit timeline.

Select several rows to act on them together. Filters are part of the URL, so you can bookmark a NOC view.
`,
  inbound: [
    "Davis problems arrive automatically. Any other tool posts events to the Dynatrace Events API v2 with a platform token that has the",
    " permission; each event opens a Davis problem that carries its cc.* properties for routing. Use placeholders below and keep tokens in your tool's secret store.",
  ],
  // The English notes are the ones Integrations shows, so the two places cannot drift apart.
  resolveNote: RESOLVE_NOTE,
  eventSourceNote: EVENT_SOURCE_NOTE,
  fieldHeader: "Event property",
  usedForHeader: "Used for",
  eventFields: {
    title: "Incident title, routing conditions (title contains / regex)",
    "eventType / event.category": "Default priority by category, routing",
    entitySelector: "Affected entities shown in the incident",
    "cc.dedup_key": "Davis events / generic events sources only: same key, same incident",
    "cc.priority": "Priority P1–P5 (a matching rule can override it)",
    "cc.service": "Service (by id or name) and therefore team and policy",
    "cc.tags": "Comma-separated tags, usable in routing rules",
    "cc.action": 'Davis events / generic events sources only: "trigger" (default) or "resolve"',
  },
  workflowSnippet: "Dynatrace Workflow (JavaScript task)",
  outbound: `
Notifications are sent by this app's engine action. The **Command Center · Engine** workflow, a simple workflow, runs it every 1, 2 or 5 minutes:

1. In **Integrations → Workflows**, choose the interval and select **Install in Workflows**, then deploy the workflow. If it shows up as a standard workflow, upload the downloaded JSON instead (or ask an admin to run \`scripts/install-workflow.mjs\`). Optional: **Engine on problem** on the same tab also runs the engine when Davis opens or closes a problem, so the first page doesn't wait for the interval.
2. In the Workflows app's **Authorization settings**, grant the workflow actor (the person who deploys it, or a service user) the permissions the engine uses: Grail read, app state and credential vault read.
3. Create one **Credential Vault** entry per provider (Twilio, IFTTT, Slack, Microsoft Teams, Telegram, or your webhook) with scope **AppEngine**, owned by the workflow actor. Its ID looks like \`CREDENTIAL_VAULT_ENTRY-…\`.
4. In **Integrations → Outbound**, switch on only the providers you use: paste the credential vault ID, set the sender, and send a test. The engine sends them itself, at no extra cost; under **Configure → Delivery** an integration can get a workflow of its own instead (one more function call per notification). For any other tool, **Custom workflow → Create example workflow** prefills a workflow you own; Command Center runs it once per notification.
5. Add the provider hosts to **Settings → General → Environment management → External requests**.

The app never sees secrets: it only stores vault IDs. Delivery results come back to the incident timeline and the notification ledger.
`,
  shortcutsIntro: "Console only, and never while you type in a field. Turn single-key shortcuts off in Settings → General.",
  shortcuts: {
    j: "Next row",
    k: "Previous row",
    Escape: "Close details",
    a: "Acknowledge the active incident",
    r: "Resolve the active incident",
    x: "Select or deselect the active row",
    "/": "Focus search",
    "Shift+R": "Refresh now",
  },
  troubleshooting: `
- **No incidents appear**: check that a source is on in Settings and that events arrive (Integrations → Inbound). The engine workflow must be running: a banner on the Console tells you when its heartbeat is late (older than two intervals plus one minute).
- **An incident has no team and nobody was paged**: no routing rule matched and there is no default team. Open the team and select **Receive all unrouted alerts** in its *Ready to page?* checklist, or add a routing rule in Services. The same checklist shows what else the team is missing.
- **A notification failed**: open the incident's Notifications tab for the provider error. *Host not allowed: …* means the provider's host is missing in Settings → General → Environment management → External requests (Integrations → Configure shows which host). Other common causes are a vault entry the workflow actor can't read (make the actor its owner), the wrong credential type, or an invalid phone number (use E.164).
- **The workflow isn't installed or is outdated**: in Integrations → Workflows select **Reinstall in Workflows** (or upload the downloaded JSON), then delete the old workflow.
- **Permission errors**: the app needs the scopes listed in Settings → Permissions, and your user needs IAM access to the app.
- **People can't be found in the user picker**: type at least 3 characters of the email or the first name. Only active users of the account that owns this environment are listed: people who were invited but never signed in are not found yet. If the picker says user search is unavailable, IAM returned 403: check that your user belongs to the Dynatrace account that owns this environment and may view users; ask your account admin.
`,
  privacy: `
The app stores IAM user IDs and display names, phone numbers and chat IDs that people enter as contact methods, and the audit trail of actions. All of it lives in this app's app state in your environment and is readable by every user of the app. Emails are read live from IAM and shown only in the user picker and team member list. The engine workflow's execution results contain only counts, never message texts or phone numbers.
`,
};

const ptBR: OverviewText = {
  title: "Ajuda",
  subtitle: "Como o Command Center transforma alertas do Dynatrace em incidentes, acionamentos e relatórios",
  sections: {
    "get-started": "Primeiros passos",
    concepts: "Conceitos",
    console: "Fluxo de trabalho no Console",
    inbound: "Envio de eventos (entrada)",
    outbound: "Notificações (saída)",
    shortcuts: "Atalhos de teclado",
    troubleshooting: "Solução de problemas",
    privacy: "Privacidade",
  },
  getStartedIntro: "Cinco passos levam de um app vazio até acionar pessoas. Os passos concluídos são marcados a partir dos dados atuais do app.",
  steps: [
    "Crie uma equipe",
    "Conclua a checklist “Ready to page?” da equipe: pessoas, métodos de contato, escala, política de escalonamento, roteamento",
    "Ative um provedor de notificação",
    "Instale o workflow do motor",
    "Envie um evento de teste",
  ],
  done: "Concluído",
  toDo: "A fazer",
  concepts: `
- **Incidente**: um alerta do Davis ou da Events API após a deduplicação. Passa de *Triggered* para *Acknowledged* e para *Resolved*; *Snoozed* o oculta até um horário e depois ele dispara de novo.
- **Prioridade**: de P1 (crítica) a P5 (informativa). Definida por uma regra de roteamento, pelo \`cc.priority\` do evento, pelo padrão do serviço ou pelo mapeamento de prioridades. A prioridade não decide *se* alguém é acionado (quem decide é a política de escalonamento, e uma regra de roteamento pode suprimir); ela seleciona as regras de notificação das pessoas e o comportamento no horário de silêncio.
- **Equipe**: usuários do Dynatrace com um papel. *Team admins* editam a equipe e são acionados, *Responders* são acionados, *Observers* só acompanham e nunca são acionados.
- **Escala**: quem está de plantão. Uma **rotação** faz suas pessoas se revezarem diariamente, semanalmente ou a cada N horas, opcionalmente só em certos horários. Uma escala pode ter mais rotações (**camadas**), por exemplo para noites ou fins de semana: onde os horários se sobrepõem, a camada mais abaixo na lista fica de plantão. **Substituições** (overrides) prevalecem sobre tudo.
- **Política de escalonamento**: passos em ordem. Cada passo espera alguns minutos e então notifica uma escala de plantão, uma equipe inteira ou uma pessoa. Pode se repetir; para assim que alguém reconhece.
- **Serviço e regra de roteamento**: as regras são verificadas de cima para baixo e a primeira que corresponde decide serviço, equipe, política e prioridade, ou suprime o alerta. Um alerta que nenhuma regra ou serviço atribui vai para a **equipe padrão**. Os problemas que o Davis detecta sozinho não trazem equipe (só os eventos que você envia podem citar um serviço em \`cc.service\`): sem uma equipe padrão ou uma regra de roteamento, eles não acionam ninguém.
`,
  console: `
1. **Acknowledge** para parar o escalonamento e avisar a equipe de que você está cuidando. O pop-up de confirmação oferece Undo por 10 segundos (também depois de Resolve), a menos que você tenha silenciado os pop-ups.
2. **Reassign** para uma equipe ou uma pessoa, opcionalmente com uma nota.
3. **Snooze** por 15 minutos a 4 horas, ou até um horário escolhido. O escalonamento continua depois.
4. **Escalate now** pula imediatamente para o próximo passo.
5. **Resolve** quando o problema estiver corrigido. Os problemas do Davis também se resolvem sozinhos quando o Davis os fecha.
6. As **notas** só podem ser acrescentadas e fazem parte da linha do tempo de auditoria.

Selecione várias linhas para agir sobre elas de uma vez. Os filtros fazem parte da URL, então você pode salvar uma visão de NOC nos favoritos.
`,
  inbound: [
    "Os problemas do Davis chegam automaticamente. Qualquer outra ferramenta envia eventos para a Events API v2 do Dynatrace com um token de plataforma que tenha a permissão",
    "; cada evento abre um problema do Davis que leva suas propriedades cc.* para o roteamento. Use os placeholders abaixo e guarde os tokens no cofre de segredos da sua ferramenta.",
  ],
  resolveNote:
    "O evento abre um problema do Davis; o incidente se resolve quando o Davis fecha o problema (após o timeout do evento, ou quando você o fecha). Reenviar o mesmo evento o renova.",
  eventSourceNote:
    'Se você ativar a fonte Davis events ou generic events em vez disso, adicione "cc.dedup_key" (mesma chave, mesmo incidente) e envie "cc.action": "resolve" com essa chave para resolver. Essas duas propriedades não têm efeito em problemas do Davis.',
  fieldHeader: "Propriedade do evento",
  usedForHeader: "Usada para",
  eventFields: {
    title: "Título do incidente, condições de roteamento (title contains / regex)",
    "eventType / event.category": "Prioridade padrão por categoria, roteamento",
    entitySelector: "Entidades afetadas mostradas no incidente",
    "cc.dedup_key": "Só para as fontes Davis events / generic events: mesma chave, mesmo incidente",
    "cc.priority": "Prioridade P1–P5 (uma regra que corresponde pode substituí-la)",
    "cc.service": "Serviço (por id ou nome) e, com ele, equipe e política",
    "cc.tags": "Tags separadas por vírgula, utilizáveis em regras de roteamento",
    "cc.action": 'Só para as fontes Davis events / generic events: "trigger" (padrão) ou "resolve"',
  },
  workflowSnippet: "Dynatrace Workflow (tarefa JavaScript)",
  outbound: `
As notificações são enviadas pela ação do motor deste app. O workflow **Command Center · Engine**, um workflow simples, a executa a cada 1, 2 ou 5 minutos:

1. Em **Integrations → Workflows**, escolha o intervalo e selecione **Install in Workflows**, depois implante o workflow. Se ele aparecer como workflow padrão (standard), faça o upload do JSON baixado (ou peça a um admin para executar \`scripts/install-workflow.mjs\`). Opcional: **Engine on problem**, na mesma aba, também executa o motor quando o Davis abre ou fecha um problema, para que o primeiro acionamento não espere o intervalo.
2. Nas **Authorization settings** do app Workflows, conceda ao ator do workflow (a pessoa que o implanta, ou um usuário de serviço) as permissões que o motor usa: leitura do Grail, app state e leitura do credential vault.
3. Crie uma entrada no **Credential Vault** por provedor (Twilio, IFTTT, Slack, Microsoft Teams, Telegram ou o seu webhook) com escopo **AppEngine**, de propriedade do ator do workflow. O ID dela tem o formato \`CREDENTIAL_VAULT_ENTRY-…\`.
4. Em **Integrations → Outbound**, ative só os provedores que você usa: cole o ID do credential vault, defina o remetente e envie um teste. O próprio motor envia, sem custo extra; em **Configure → Delivery** uma integração pode ganhar um workflow próprio (uma chamada de função a mais por notificação). Para qualquer outra ferramenta, **Custom workflow → Create example workflow** preenche um workflow seu; o Command Center o executa uma vez por notificação.
5. Adicione os hosts dos provedores em **Settings → General → Environment management → External requests**.

O app nunca vê segredos: ele só guarda IDs do vault. Os resultados de entrega voltam para a linha do tempo do incidente e para o registro de notificações.
`,
  shortcutsIntro: "Só no Console, e nunca enquanto você digita em um campo. Desative os atalhos de uma tecla em Settings → General.",
  shortcuts: {
    j: "Próxima linha",
    k: "Linha anterior",
    Escape: "Fechar os detalhes",
    a: "Reconhecer o incidente ativo",
    r: "Resolver o incidente ativo",
    x: "Selecionar ou desmarcar a linha ativa",
    "/": "Ir para a busca",
    "Shift+R": "Atualizar agora",
  },
  troubleshooting: `
- **Nenhum incidente aparece**: verifique se uma fonte está ativada em Settings e se os eventos chegam (Integrations → Inbound). O workflow do motor precisa estar rodando: um banner no Console avisa quando o heartbeat dele está atrasado (mais antigo que dois intervalos mais um minuto).
- **Um incidente está sem equipe e ninguém foi acionado**: nenhuma regra de roteamento correspondeu e não há equipe padrão. Abra a equipe e selecione **Receive all unrouted alerts** na checklist *Ready to page?* dela, ou adicione uma regra de roteamento em Services. A mesma checklist mostra o que mais falta para a equipe.
- **Uma notificação falhou**: abra a aba Notifications do incidente para ver o erro do provedor. *Host not allowed: …* significa que o host do provedor falta em Settings → General → Environment management → External requests (Integrations → Configure mostra qual host). Outras causas comuns são uma entrada do vault que o ator do workflow não consegue ler (torne o ator o dono dela), o tipo de credencial errado ou um número de telefone inválido (use E.164).
- **O workflow não está instalado ou está desatualizado**: em Integrations → Workflows selecione **Reinstall in Workflows** (ou faça o upload do JSON baixado) e depois exclua o workflow antigo.
- **Erros de permissão**: o app precisa dos escopos listados em Settings → Permissions, e o seu usuário precisa de acesso IAM ao app.
- **Pessoas não aparecem no seletor de usuários**: digite pelo menos 3 caracteres do e-mail ou do primeiro nome. Só são listados usuários ativos da conta dona deste ambiente: pessoas convidadas que nunca entraram ainda não são encontradas. Se o seletor disser que a busca de usuários não está disponível, o IAM respondeu 403: verifique se o seu usuário pertence à conta Dynatrace dona deste ambiente e pode ver usuários; fale com o admin da conta.
`,
  privacy: `
O app guarda IDs de usuário do IAM e nomes de exibição, números de telefone e IDs de chat que as pessoas informam como métodos de contato, e a trilha de auditoria das ações. Tudo isso fica no app state deste app no seu ambiente e pode ser lido por todos os usuários do app. Os e-mails são lidos na hora a partir do IAM e mostrados só no seletor de usuários e na lista de membros da equipe. Os resultados de execução do workflow do motor contêm apenas contagens, nunca textos de mensagens ou números de telefone.
`,
};

const es: OverviewText = {
  title: "Ayuda",
  subtitle: "Cómo Command Center convierte las alertas de Dynatrace en incidentes, avisos e informes",
  sections: {
    "get-started": "Primeros pasos",
    concepts: "Conceptos",
    console: "Flujo de trabajo en la Console",
    inbound: "Envío de eventos (entrada)",
    outbound: "Notificaciones (salida)",
    shortcuts: "Atajos de teclado",
    troubleshooting: "Solución de problemas",
    privacy: "Privacidad",
  },
  getStartedIntro: "Cinco pasos te llevan de una app vacía a avisar a personas. Los pasos completados se marcan a partir de los datos actuales de la app.",
  steps: [
    "Crea un equipo",
    "Completa la checklist “Ready to page?” del equipo: personas, métodos de contacto, turno, política de escalado, enrutamiento",
    "Activa un proveedor de notificaciones",
    "Instala el workflow del motor",
    "Envía un evento de prueba",
  ],
  done: "Hecho",
  toDo: "Pendiente",
  concepts: `
- **Incidente**: una alerta de Davis o de la Events API después de la deduplicación. Pasa de *Triggered* a *Acknowledged* y a *Resolved*; *Snoozed* lo oculta hasta una hora y luego vuelve a dispararse.
- **Prioridad**: de P1 (crítica) a P5 (informativa). La fija una regla de enrutamiento, el \`cc.priority\` del evento, el valor predeterminado del servicio o el mapeo de prioridades. La prioridad no decide *si* se avisa a alguien (eso lo decide la política de escalado, y una regla de enrutamiento puede suprimir); selecciona las reglas de notificación de las personas y el comportamiento en las horas de silencio.
- **Equipo**: usuarios de Dynatrace con un rol. Los *Team admins* editan el equipo y reciben avisos, los *Responders* reciben avisos, los *Observers* solo observan y nunca reciben avisos.
- **Turno**: quién está de guardia. Una **rotación** hace que sus personas se turnen a diario, semanalmente o cada N horas, opcionalmente solo en ciertas horas. Un turno puede tener más rotaciones (**capas**), por ejemplo para noches o fines de semana: donde sus horas se solapan, está de guardia la capa que está más abajo en la lista. Las **sustituciones** (overrides) prevalecen sobre todo.
- **Política de escalado**: pasos en orden. Cada paso espera unos minutos y luego notifica a un turno de guardia, a un equipo entero o a una persona. Puede repetirse; se detiene en cuanto alguien reconoce.
- **Servicio y regla de enrutamiento**: las reglas se comprueban de arriba abajo y la primera que coincide decide servicio, equipo, política y prioridad, o suprime la alerta. Una alerta que ninguna regla ni servicio asigna va al **equipo predeterminado**. Los problemas que Davis detecta por su cuenta no llevan equipo (solo los eventos que envías pueden nombrar un servicio en \`cc.service\`): sin un equipo predeterminado o una regla de enrutamiento no avisan a nadie.
`,
  console: `
1. **Acknowledge** para detener el escalado y decirle a tu equipo que te encargas. La ventana emergente de confirmación ofrece Undo durante 10 segundos (también después de Resolve), salvo que hayas silenciado las ventanas emergentes.
2. **Reassign** a un equipo o a una persona, opcionalmente con una nota.
3. **Snooze** de 15 minutos a 4 horas, o hasta una hora elegida. El escalado se reanuda después.
4. **Escalate now** salta de inmediato al siguiente paso.
5. **Resolve** cuando el problema esté corregido. Los problemas de Davis también se resuelven solos cuando Davis los cierra.
6. Las **notas** solo se pueden añadir y forman parte de la línea de tiempo de auditoría.

Selecciona varias filas para actuar sobre ellas a la vez. Los filtros forman parte de la URL, así que puedes guardar una vista de NOC en marcadores.
`,
  inbound: [
    "Los problemas de Davis llegan automáticamente. Cualquier otra herramienta envía eventos a la Events API v2 de Dynatrace con un token de plataforma que tenga el permiso",
    "; cada evento abre un problema de Davis que lleva sus propiedades cc.* para el enrutamiento. Usa los marcadores de posición de abajo y guarda los tokens en el almacén de secretos de tu herramienta.",
  ],
  resolveNote:
    "El evento abre un problema de Davis; el incidente se resuelve cuando Davis cierra el problema (tras el timeout del evento, o cuando lo cierras tú). Reenviar el mismo evento lo renueva.",
  eventSourceNote:
    'Si en su lugar activas la fuente Davis events o generic events, añade "cc.dedup_key" (misma clave, mismo incidente) y envía "cc.action": "resolve" con esa clave para resolver. Estas dos propiedades no tienen efecto en los problemas de Davis.',
  fieldHeader: "Propiedad del evento",
  usedForHeader: "Se usa para",
  eventFields: {
    title: "Título del incidente, condiciones de enrutamiento (title contains / regex)",
    "eventType / event.category": "Prioridad predeterminada por categoría, enrutamiento",
    entitySelector: "Entidades afectadas que se muestran en el incidente",
    "cc.dedup_key": "Solo fuentes Davis events / generic events: misma clave, mismo incidente",
    "cc.priority": "Prioridad P1–P5 (una regla que coincide puede reemplazarla)",
    "cc.service": "Servicio (por id o nombre) y, con él, equipo y política",
    "cc.tags": "Etiquetas separadas por comas, utilizables en reglas de enrutamiento",
    "cc.action": 'Solo fuentes Davis events / generic events: "trigger" (predeterminado) o "resolve"',
  },
  workflowSnippet: "Dynatrace Workflow (tarea JavaScript)",
  outbound: `
Las notificaciones las envía la acción del motor de esta app. El workflow **Command Center · Engine**, un workflow simple, la ejecuta cada 1, 2 o 5 minutos:

1. En **Integrations → Workflows**, elige el intervalo y selecciona **Install in Workflows**, y luego despliega el workflow. Si aparece como workflow estándar, carga en su lugar el JSON descargado (o pide a un admin que ejecute \`scripts/install-workflow.mjs\`). Opcional: **Engine on problem**, en la misma pestaña, también ejecuta el motor cuando Davis abre o cierra un problema, para que el primer aviso no espere al intervalo.
2. En las **Authorization settings** de la app Workflows, concede al actor del workflow (la persona que lo despliega, o un usuario de servicio) los permisos que usa el motor: lectura de Grail, app state y lectura del credential vault.
3. Crea una entrada de **Credential Vault** por proveedor (Twilio, IFTTT, Slack, Microsoft Teams, Telegram o tu webhook) con el ámbito **AppEngine**, propiedad del actor del workflow. Su ID tiene la forma \`CREDENTIAL_VAULT_ENTRY-…\`.
4. En **Integrations → Outbound**, activa solo los proveedores que uses: pega el ID del credential vault, define el remitente y envía una prueba. El motor los envía él mismo, sin coste extra; en **Configure → Delivery** una integración puede tener en su lugar un workflow propio (una llamada de función más por notificación). Para cualquier otra herramienta, **Custom workflow → Create example workflow** rellena un workflow tuyo; Command Center lo ejecuta una vez por notificación.
5. Añade los hosts de los proveedores en **Settings → General → Environment management → External requests**.

La app nunca ve secretos: solo guarda IDs del vault. Los resultados de entrega vuelven a la línea de tiempo del incidente y al registro de notificaciones.
`,
  shortcutsIntro: "Solo en la Console, y nunca mientras escribes en un campo. Desactiva los atajos de una tecla en Settings → General.",
  shortcuts: {
    j: "Fila siguiente",
    k: "Fila anterior",
    Escape: "Cerrar los detalles",
    a: "Reconocer el incidente activo",
    r: "Resolver el incidente activo",
    x: "Seleccionar o deseleccionar la fila activa",
    "/": "Ir a la búsqueda",
    "Shift+R": "Actualizar ahora",
  },
  troubleshooting: `
- **No aparece ningún incidente**: comprueba que hay una fuente activada en Settings y que llegan eventos (Integrations → Inbound). El workflow del motor tiene que estar en marcha: un banner en la Console avisa cuando su heartbeat se retrasa (más antiguo que dos intervalos más un minuto).
- **Un incidente no tiene equipo y no se avisó a nadie**: ninguna regla de enrutamiento coincidió y no hay equipo predeterminado. Abre el equipo y selecciona **Receive all unrouted alerts** en su checklist *Ready to page?*, o añade una regla de enrutamiento en Services. La misma checklist muestra qué más le falta al equipo.
- **Una notificación falló**: abre la pestaña Notifications del incidente para ver el error del proveedor. *Host not allowed: …* significa que falta el host del proveedor en Settings → General → Environment management → External requests (Integrations → Configure muestra qué host). Otras causas habituales son una entrada del vault que el actor del workflow no puede leer (haz al actor su propietario), el tipo de credencial equivocado o un número de teléfono no válido (usa E.164).
- **El workflow no está instalado o está desactualizado**: en Integrations → Workflows selecciona **Reinstall in Workflows** (o carga el JSON descargado) y luego elimina el workflow antiguo.
- **Errores de permisos**: la app necesita los ámbitos que aparecen en Settings → Permissions, y tu usuario necesita acceso IAM a la app.
- **No se encuentran personas en el selector de usuarios**: escribe al menos 3 caracteres del correo o del nombre. Solo aparecen los usuarios activos de la cuenta propietaria de este entorno: las personas invitadas que nunca iniciaron sesión todavía no se encuentran. Si el selector dice que la búsqueda de usuarios no está disponible, IAM respondió 403: comprueba que tu usuario pertenece a la cuenta de Dynatrace propietaria de este entorno y puede ver usuarios; consulta al admin de tu cuenta.
`,
  privacy: `
La app guarda IDs de usuario de IAM y nombres visibles, números de teléfono e IDs de chat que las personas introducen como métodos de contacto, y el registro de auditoría de las acciones. Todo ello vive en el app state de esta app en tu entorno y lo pueden leer todos los usuarios de la app. Los correos se leen en el momento desde IAM y solo se muestran en el selector de usuarios y en la lista de miembros del equipo. Los resultados de ejecución del workflow del motor solo contienen recuentos, nunca textos de mensajes ni números de teléfono.
`,
};

export const OVERVIEW: Record<Language, OverviewText> = { en, "pt-BR": ptBR, es };
