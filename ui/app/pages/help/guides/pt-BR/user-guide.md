# Guia do usuário — cada tela, ícone e status

<!-- app:omit -->
As capturas de tela foram feitas em **modo demo**, com dados de exemplo.
<!-- /app:omit -->

## Cabeçalho

![Console](../../screenshots/console.png)

| Elemento | O que faz |
| --- | --- |
| **Console · On-call · Teams · Escalations · Services · Integrations · War rooms · Reports** | Navegação principal. **War rooms** mostra um contador vermelho enquanto há salas em andamento. |
| :icon[NotificationIcon]: **Sino** | As últimas notificações desta sessão, com um contador de não lidas (até `99+`). Estados do ícone: :icon[NotificationIcon]: nada novo, :icon[NotificationActiveIcon]: itens não lidos, :icon[NotificationOffIcon]: pop-ups silenciados. Selecionar um item abre aquilo a que ele se refere. Fechar o menu marca tudo como lido. |
| :icon[CallIcon]: **Indicador de plantão** | `You're on call` em um círculo verde quando você está de plantão; caso contrário, `On call: <name>` (+N para mais pessoas), `On call` quando ninguém está cobrindo neste momento, ou `No one on call` quando ainda não existe escala. O menu lista quem está de plantão em cada equipe e até quando, e oferece **Leave on-call now…** ou **Take on-call now…** (abaixo). |
| :icon[SettingIcon]: **Settings** | Abre as [configurações](configuration.md). |
| Menu de ajuda **?** | What's new (novidades), Get started (primeiros passos), In-app guide (guia dentro do app), Sending events (API) (envio de eventos), atalhos de teclado, sobre. |

### Notificações (sino e pop-ups)

Os pop-ups aparecem no **canto superior direito**, logo abaixo da barra de cabeçalho com o sino, e entram deslizando
pela direita. Eles cobrem quatro categorias:

| Categoria | Exemplos |
| --- | --- |
| New P1/P2 incidents (novos incidentes P1/P2) | `P1 · <title>` (crítico), `P2 · <title>` (aviso). Depois de três, eles são agrupados como `N more new P1/P2 incidents`. |
| Confirmations of my actions (confirmações das minhas ações) | `Incident acknowledged` com **Undo** (10 segundos), `Incident resolved` com **Undo**, `Incident snoozed`… |
| Errors (erros) | `Couldn't save your changes`, `Couldn't acknowledge …` com **Retry** |
| Paging engine health (saúde do motor de acionamento) | `Paging engine is not running`: nenhuma execução do motor por dois intervalos mais um minuto (um erro do motor aparece apenas no banner do Console) |

No menu do sino, **Pop-ups on (click to silence)** alterna para *Silenced: only counting*. **Show pop-ups for…**
escolhe as categorias, e **Clear all** esvazia a lista. As preferências ficam guardadas neste navegador. A lista em si
fica na memória e é apagada quando você recarrega a página. Quando os pop-ups estão silenciados, o botão Undo das
confirmações também não é exibido.

### Sair ou assumir o plantão

- **Leave on-call now…** pergunta quem cobre o restante do seu turno. A próxima pessoa do rodízio vem pré-selecionada.
  Em seguida, ele cria uma **substituição (override)** na escala, de agora até o fim do turno atual, para que os
  acionamentos parem de chegar a você imediatamente.
- **Take on-call now…** aparece nas escalas em que você participa, mas não está de plantão. Ele cria uma substituição
  que coloca você de plantão até o fim do turno atual, ou por 8 horas se ninguém estava de plantão.
- As substituições aparecem em **On-call → Overrides**, com a nota *Left on-call from the header* ou *Took on-call from
  the header*, e podem ser removidas ali.

## Ícones e cores

**Status do incidente**

| Indicador | Status | Significado |
| --- | --- | --- |
| :icon[HealthCritical]: Triggered | `triggered` | Novo ou disparado novamente. A política de escalonamento está em andamento. |
| :icon[HealthWarning]: Acknowledged | `acknowledged` | Alguém está cuidando dele. O escalonamento para. |
| :icon[HealthNeutral]: Snoozed | `snoozed` | Oculto até um horário. Depois, dispara novamente e o escalonamento recomeça. |
| :icon[HealthIdeal]: Resolved | `resolved` | Fechado pela origem ou por um operador. Continua visível por 24 horas (configurável), depois é arquivado. |

**Chips de prioridade**: somente texto, sem ícone. **P1** é o único chip vermelho sólido, **P2** é avermelhado, **P3**
âmbar, **P4** azul e **P5** cinza. Significados: P1 crítico (grande indisponibilidade ou impacto em clientes), P2 alto
(um serviço está degradado), P3 moderado (precisa de atenção em breve), P4 baixo (pode esperar o horário comercial), P5
informativo. A prioridade não decide *se* alguém é acionado: quem decide é a política de escalonamento, e uma regra de
roteamento pode suprimir. A prioridade seleciona as regras de notificação das pessoas ("for priorities P1–P2…") e o
comportamento das quiet hours.

**Status da notificação (entrega)**

| Rótulo | Significado |
| --- | --- |
| Sending | Planejada nesta execução, ainda sem resultado |
| Sent | O provedor aceitou a mensagem (HTTP 2xx). A entrega no aparelho não é rastreada. |
| Failed | O provedor a recusou, ou todas as tentativas falharam. O erro do provedor é exibido. |
| No result | Nenhum resultado chegou a tempo. O motor tenta novamente com uma nova tentativa. |

**Canais**: :icon[MobileIcon]: SMS · :icon[CallIcon]: voz · :icon[ChatIcon]: chat (WhatsApp, Telegram, Slack, Microsoft Teams) · :icon[HttpIcon]: HTTP (IFTTT, webhook). Um
:icon[CriticalFailedIcon]: vermelho em *Last notified* significa que a última notificação falhou ou ficou sem resultado.

**Origens**: :icon[AiIcon]: Davis (IA) marca um Davis problem; :icon[EventIcon]: marca um Davis event ou um evento da Events API.

**Outros ícones**

| Ícone | Significado |
| --- | --- |
| :icon[ArrowUpIcon]: | Escalar |
| :icon[PauseIcon]: | Snooze (adiar) |
| :icon[AccountIcon]: | Responsável, reatribuir |
| :icon[EditIcon]: | Alteração de prioridade ou de tag |
| :icon[DescriptionIcon]: | Nota |
| :icon[GroupIcon]: | War room, ou a equipe inteira |
| :icon[ClockIcon]: | MTTA, ou *acima da meta de reconhecimento* |
| :icon[MuteIcon]: | Suprimido |
| :icon[RepeatIcon]: | A política se repete |
| :icon[SuccessIcon]: | Passo concluído |
| Spinner | Passo atual |
| :icon[CircleIcon]: | Passo pendente |
| :icon[LockIcon]: | Rota padrão |
| :icon[PlayIcon]: | Executar, ou enviar um teste |
| :icon[KeyIcon]: | Credential Vault |
| :icon[FlowIcon]: | Workflow do motor |

**Destaque de item criado**: tudo o que você cria com um botão em uma lista (uma war room, uma equipe, um membro, uma
escala, uma camada, uma substituição, um passo de política, um serviço, uma regra, uma nota…) pulsa uma vez por um
segundo com um contorno, para que você o encontre. Com a configuração de sistema *reduce motion*, ele esmaece uma vez,
sem pulsar.

## Console

O Console é a tela do NOC: todos os incidentes abertos, os mais recentes primeiro. O cabeçalho mostra quando os dados
foram atualizados, **Auto-refresh** (Off, 15 s, 30 s, 1 min, 5 min; começa no padrão de Settings → General, 1 min se não
for alterado) e **Refresh now**.

**Tiles de KPI** (os sparklines são contagens por hora, nas últimas 24 horas):

| Tile | Valor | Clique |
| --- | --- | --- |
| Triggered | Incidentes esperando alguém (vermelho quando > 0) | Filtra por Triggered |
| Acknowledged | Incidentes sendo trabalhados. Rodapé: reconhecimentos vs. a hora anterior | Filtra por Acknowledged |
| Open P1 | Incidentes P1 não resolvidos (vermelho quando > 0) | Filtra por P1 abertos |
| MTTA today | Tempo **mediano** para reconhecer desde a meia-noite local. Vermelho acima da sua meta de reconhecimento; o medidor vai de 0 ao dobro da meta. | — |
| Assigned to me | Incidentes abertos atribuídos a você | Filtra por Assignee = me |
| Open incidents | Todos os incidentes abertos, divididos por prioridade | — |

**Show** (abas acima da tabela): *Open* (Triggered + Acknowledged, o padrão), *Triggered*, *Acknowledged*,
*Snoozed*, *Resolved* e *All*. Cada aba mostra uma contagem que acompanha os outros filtros. *Resolved* e *All* mostram
só incidentes criados hoje (desde a meia-noite local no fuso horário do app) e aparecem como *Resolved today* / *All
today*, com a dica *Today · pick a timeframe in Created to see older incidents*; um intervalo escolhido em **Created**
substitui esse limite. As outras abas não são limitadas.

**Filtros**: busca (título, ID, entidade, tag), Priority, Team, Assignee (*Me*, *Unassigned*, membros), Acknowledged by
(*Me* e todas as pessoas que reconheceram um incidente nos dados carregados, em ordem de nome), Service, Source,
Escalation level (*Not started*, *Step N*, *Exhausted*) e Created (intervalo de tempo). Todos os filtros, exceto o
intervalo de tempo, fazem parte da URL (Acknowledged by é `ackby=…`), assim como a aba **Show** (`status=…`), então uma visão de NOC pode ser salva
nos favoritos. Um link também pode abrir a Console com **Created** nas últimas N horas (`?created=24h`, de 1 a 720
horas): ele é lido quando a página abre, e depois o seletor Created assume.

**Colunas**: Priority, Status (e *until …* quando em snooze), Incident (título, `#display ID · first entity`), Age
(vermelho com um ícone de relógio quando um incidente **triggered** é mais antigo que a meta de reconhecimento),
Service, Team, Assignee, Acknowledged by (nome, com o horário embaixo e a data completa ao passar o mouse; vazio quando
não reconhecido, e mantido depois que o incidente é resolvido), Escalation (*Step N of M*, *Not started*, *Exhausted*, *No policy*), Last notified. Source e
Created ficam ocultas por padrão. Use o menu de colunas para mostrar, ocultar ou reordenar colunas. A escolha é
lembrada neste navegador. As linhas podem ser expandidas para mostrar a descrição, a atividade mais recente e o
escalonamento.

**Ações da linha**: cada linha mostra até quatro ações como botões de ícone (passe o mouse para ver o nome) e depois
**:icon[DotMenuIcon]:** com todas as outras: *Acknowledge* (desabilitada a menos que o incidente esteja triggered), *Resolve*,
*Reassign…*, *Escalate now*, *Snooze* (15 min, 30 min, 1 h, 4 h, Custom…), *Change priority…*, *Add note*, *Open war
room…* / *Join war room*, *Open Davis problem* (só para problemas do Davis), *Copy link*. Por padrão os botões são
Acknowledge e Resolve. O botão :icon[SettingIcon]: **Row actions**, acima do canto superior direito da tabela, escolhe quais
ações aparecem como botões e em que ordem (até quatro, ou nenhuma); **Reset to default** volta para Acknowledge e
Resolve. A escolha fica salva para você neste navegador.

**Ações em massa** (selecione linhas): Acknowledge, Resolve (pede confirmação acima de 10 incidentes), Reassign,
Snooze, Escalate now, Set priority.

**Atalhos de teclado** (somente no Console, nunca enquanto você digita): `j`/`k` próximo/anterior, `a` reconhecer, `r`
resolver, `x` selecionar, `/` buscar, `Shift+R` atualizar, `Esc` fechar detalhes. Eles podem ser desativados em
Settings → General.

**Banners**: *The paging engine is late / reported an error / hasn't run yet* aparece quando o heartbeat do motor é
mais antigo que dois intervalos de execução mais um minuto, ou quando ele reporta um erro. *Demo mode* mostra um banner
permanente com **Turn off demo mode**.

**Ações em detalhe**

| Ação | Efeito |
| --- | --- |
| Acknowledge | O escalonamento para. O MTTA é medido. **Undo** em até 10 segundos, ou *Undo acknowledgement* depois, nos detalhes. |
| Resolve | O escalonamento para. Ninguém é notificado sobre a resolução. Davis problems também se resolvem sozinhos quando o Davis os fecha. |
| Reopen | Um incidente resolvido dispara novamente e o escalonamento recomeça. |
| Snooze | Até um horário no futuro, opcionalmente com uma nota. Depois, o incidente dispara novamente e a política recomeça. |
| Reassign | Para uma equipe ou uma pessoa, opcionalmente com uma nota |
| Escalate now | Dispara o **próximo passo** da política imediatamente (um incidente reconhecido ou em snooze volta a ficar triggered) e executa o motor na hora. Se a execução imediata falhar, o toast diz *Escalation recorded, but the engine didn't start*, e a próxima execução agendada faz o envio. |
| Change priority | P1–P5 |
| Add note | Markdown, somente acréscimo (append-only), parte da trilha de auditoria |

Cada ação é registrada na linha do tempo do incidente, com quem a fez e quando.

## Detalhes do incidente

![Incident](../../screenshots/incident.png)

Abre ao lado da tabela. O cabeçalho mostra prioridade, status, `#ID`, um botão de copiar link, título, *Opened … ·
Service · Team · Source*, *Under maintenance: paging suppressed* quando se aplica, a quem está atribuído e, depois do
reconhecimento, *Acknowledged by* com a pessoa e o horário. Botões: Acknowledge, Resolve,
Reopen, Reassign, Open/Join war room, Escalate now, Snooze e :icon[DotMenuIcon]: (Change priority, Add note, Undo acknowledgement, Copy
link). Davis problems têm o link **Open in Problems app**.

| Aba | Conteúdo |
| --- | --- |
| Timeline | Cada evento: criado, roteado, reconhecido, notificações, notas… Filtros *All / Actions / Notifications / System*. Notificações com falha ficam destacadas. |
| Escalation | A política, cada passo com os seus alvos e canais, qual passo é o próximo e quando. *Escalation stops automatically while an incident is acknowledged or snoozed.* |
| Notifications (N) | O registro (ledger): canal, destinatário, passo (`N · try A`, com *repeat P*), status, horário, detalhes do provedor |
| Entities (N) | Entidades afetadas: nome, tipo, ID da entidade |
| Notes (N) | Adicione uma nota (Markdown). As notas são somente acréscimo (append-only). |

## War rooms

![War rooms](../../screenshots/war-rooms.png)

Uma war room é um link de reunião mais os incidentes que ela trata e os seus notebooks.

- **Abrir**: a partir de um incidente (**Open war room**, ou **:icon[DotMenuIcon]: → Open war room…** no Console) ou com o botão **Open
  war room**. Cole o link da reunião que você criou no Teams, Zoom, Meet ou em um huddle do Slack (somente https).
  Incidentes abertos relacionados são adicionados automaticamente: os que têm a mesma causa raiz, ou o mesmo serviço e
  começaram em até 30 minutos. Remova os que não pertencem à sala.
- **Notebooks**: **Create post-mortem notebook** cria um Dynatrace Notebook com o nome do primeiro incidente (por
  exemplo `P-26112613 · Post-mortem: …`) com resumo, linha do tempo, causa raiz, impacto, itens de ação e uma seção DQL
  para os problems da sala. **Select an existing notebook** anexa qualquer notebook a que você tenha acesso. Você
  também pode adicionar qualquer link https. Um notebook novo pertence a quem o criou e, segundo a Document API da
  Dynatrace, não fica acessível para outros usuários até ser compartilhado no app Notebooks.
- **Lista**: *Today* por padrão (salas abertas e salas abertas ou fechadas hoje), ou *In progress*, *Closed*, *All*.
  Colunas: Status (*Open · duration* ou *Closed*), War room (título e link **Join**), Incidents, Notebooks, Opened by,
  Started, Ended, Duration.
- **Close / Reopen** é feito por pessoas. Uma sala fechada mantém o link visível como texto simples, para referência,
  e ele não pode ser clicado. Enquanto uma sala está aberta, o incidente mostra **Join war room**.

## On-call (plantão)

![On-call](../../screenshots/oncall.png)

- **Now**: Um card por equipe: quem está de plantão e até quando, os seus métodos de contato (em cinza quando não configurados), quem é o próximo e cada camada. *No one is on call* vem com **Add override**. Enquanto ainda não existe nenhuma equipe, a página diz *Start with a team* (comece por uma equipe). Abaixo: *Shifts* (turnos), uma semana do calendário (domingo → sábado, uma coluna por dia) no *Tenant time zone* definido em Settings (mostrado ao lado das datas), com uma linha *Now* e a coluna de hoje destacada. Uma linha por equipe mostra a escala final com o nome de quem está de plantão em cada barra; substituições (overrides) têm contorno tracejado e *· override*, lacunas *No one on call* aparecem listradas em âmbar. Expanda uma equipe (ou use **Show people**) para ver uma linha por pessoa com os horários dos seus turnos e as horas de plantão na semana; passe o mouse sobre uma barra para ver os horários exatos. Navegue com as setas de semana anterior / seguinte, **This week** ou *Week of* (um seletor de data que vai para a semana que contém essa data). A semana fica no link (`?week=2026-11-22`), então pode ser compartilhada; **Workdays only** mostra segunda → sexta e fica lembrado neste navegador. Filtro: Team.
- **Schedules**: Nome, equipe, fuso horário, camadas, de plantão agora, próxima passagem de plantão, cobertura para os próximos 7 dias (em %). Edit, Duplicate, Delete.
- **Overrides**: Quem cobre, para quem, escala, de, até, motivo. Futuras ou passadas. Remove.

**Editor de escala** ![Schedule editor](../../screenshots/schedule-editor.png)

Uma escala nova já vem pronta para salvar: leva o nome da equipe, as pessoas da equipe que são acionadas já estão no
rodízio, e ela começa hoje, de modo que alguém fica de plantão imediatamente.

- **Schedule**: nome, equipe, fuso horário (as passagens de plantão e as restrições o seguem, incluindo o horário de
  verão).
- **Rotation (rodízio)**: primeiro vêm as *People in the rotation* (pessoas no rodízio), na ordem em que se revezam
  (arraste para reordenar). *Add from the team* adiciona um membro da equipe com um clique; *Add someone else* busca
  entre todos os usuários. Depois vêm o *Rotation type* (*Daily*, *Weekly* ou *Custom*, com duração de turno de 1–672
  horas), o *Handoff time* (HH:mm) e quando o rodízio começa (*Rotation starts*). Uma frase abaixo desses campos diz
  quando as pessoas trocam, por exemplo *People swap every Fri at 09:00 (America/Sao_Paulo)*; o dia da semana é o da
  primeira passagem de plantão no fuso horário da escala. *Only during specific hours* limita o rodízio a dias da
  semana e horários.
- **Add layer** (opcional) adiciona um segundo rodízio para certos horários, por exemplo noites ou fins de semana. Com
  várias camadas, cada uma tem um nome, **a camada mais abaixo na lista é a que fica de plantão onde os horários se
  sobrepõem**, e as substituições vencem todas as camadas.
- **Prévia de cobertura** (1, 2 ou 4 semanas): *Full coverage* ou *N gaps, … uncovered*, o Gantt com uma linha *Final
  schedule*, e **Who is on call, from when**: as próximas passagens de plantão em forma de lista, no fuso horário da
  escala.

**Nova substituição (New override)**: escala, quem cobre, de, até (padrão: a próxima hora cheia, por 8 horas), motivo.
Uma frase de prévia diz exatamente o que vai acontecer.

## Teams (equipes)

![Teams](../../screenshots/teams.png) ![Team](../../screenshots/team.png)

- **Lista de equipes**: nome, membros, de plantão agora, política de escalonamento, serviços, incidentes abertos por
  prioridade. Uma equipe que ainda é usada por políticas, regras ou serviços não pode ser excluída até que essas
  referências sejam removidas.
- **New team**: um nome e uma descrição opcional. **Default team** (equipe padrão) vem marcado enquanto não existe
  nenhuma equipe padrão: a equipe padrão recebe todo alerta que nenhuma regra de roteamento envia para outro lugar. Os
  problemas que o Davis detecta sozinho não trazem equipe; por isso, sem uma equipe padrão ou regras de roteamento, eles não acionam
  ninguém. **Edit team** também define a política de escalonamento padrão da equipe.
- **Abas do detalhe da equipe**: *Members*, *On-call*, *Escalation*, *Quiet hours*, *Services*. Quando um membro
  aparece como um ID em vez de um nome, a aba *Members* diz por quê: o seu usuário não pode ver os usuários da conta
  (o IAM respondeu 403), a busca de nomes falhou (com o motivo) ou a pessoa não é um usuário ativo da conta.
  Associação, métodos de contato e acionamento nunca dependem do nome. Cada gravação de uma equipe, escala, política
  ou contato guarda os nomes conhecidos naquele momento nos registros de contato das pessoas (sem email), para que os
  nomes continuem aparecendo quando o diretório de usuários não puder ser consultado.
- **Ready to page?** Uma checklist de 5 passos, em ordem: pessoas que são acionadas, métodos de contato, uma escala de
  plantão, uma política de escalonamento e alertas roteados para a equipe. O próximo passo tem o botão em destaque; os
  passos que dependem de haver pessoas não mostram botão. O passo 5 fica concluído quando a equipe é a equipe padrão ou
  quando uma regra de roteamento habilitada envia alertas para ela. Um serviço sozinho não basta: só chegam os eventos
  que o citam em `cc.service`. O botão dele é *Receive all unrouted alerts* enquanto não existe equipe padrão; depois
  disso, *Add routing rule*. Com os cinco passos concluídos, a checklist ainda avisa quando um canal usado pela equipe
  não tem nenhum provedor ligado, ou quando o motor nunca rodou.
- **Add people**: o seu próprio usuário é oferecido primeiro. Para os demais, digite pelo menos 3 letras de um nome ou
  de um email. Os resultados vêm do IAM do Dynatrace: usuários ativos da conta dona do ambiente (quem nunca fez login
  não é encontrado). As pessoas escolhidas ficam numa lista **Selected (n)** abaixo dos resultados, cada uma com
  **Remove**, ao longo de várias buscas. Papéis:

| Papel | Acionado? | Indicado para |
| --- | --- | --- |
| Team admin | sim | Edita a equipe, as suas escalas e a sua política |
| Responder | sim | Reconhece e resolve |
| Observer | nunca | Acompanha os incidentes da equipe |

Os papéis são orientações: o App State não tem permissões por chave, então tecnicamente qualquer usuário do app pode
alterar a configuração.

- **Contact methods** (pessoa → *Add* ou *Edit*): cada linha tem um canal, o endereço e um rótulo opcional, mais **Send
  test**. Para uma pessoa sem métodos de contato, a tela abre com uma linha pronta para preencher. O campo do endereço
  leva o nome do canal: *Phone number* em E.164 com o código do país (SMS, voz, WhatsApp); *Chat ID* (Telegram); *Name
  in the message* (Slack, Teams e IFTTT: o webhook ou o applet decide o destino); *Routing key* (webhook ou custom
  workflow). Linhas deixadas vazias são ignoradas. A partir da checklist, **Save and next** segue para a próxima pessoa
  sem método de contato. Números de telefone e chat IDs podem ser lidos por todos os usuários do app. Eles ficam
  mascarados nas listas. Email não é um canal separado: envie emails por meio de um gateway de webhook.
- **Notification rules (optional)** (regras de notificação, opcionais): sem regras, todos os métodos de contato são
  usados de uma vez. Uma regra diz: *use* este método *after N minutes* (contados a partir do momento em que o passo
  dispara) *for priorities* P1 a Px, ou todas. Depois que uma pessoa tem regras, só os incidentes cobertos por alguma
  regra a notificam; a tela informa quais prioridades ficam de fora. Um passo com canais forçados usa o primeiro
  método de cada canal, sem atraso.
- **Quiet hours**: janelas (dias, de/até, fuso horário; uma janela pode atravessar a meia-noite) durante as quais
  incidentes **menos urgentes** que uma prioridade são **retidos** (hold: nenhum acionamento até a janela terminar) ou
  acionados apenas com canais de **baixa urgência** (Slack, Teams, Telegram, IFTTT, webhook). Incidentes mais urgentes
  sempre acionam. Quando as janelas se sobrepõem, *hold* vence.

## Escalations (escalonamentos)

![Escalations](../../screenshots/escalations.png) ![Policy editor](../../screenshots/policy-editor.png)

- **Lista**: nome, equipe, passos (quem é notificado em cada passo e a espera entre eles, por exemplo *on-call of
  Payments on-call → 10 min → team Payments*), repetição, usada por, último disparo. Excluir uma política faz os seus
  incidentes voltarem para a política padrão da sua equipe ou, na falta dela, para a política padrão definida em
  Settings.
- **Editor**: uma política nova já vem pronta para salvar. Ela leva o nome da equipe; o passo 1 notifica quem está de
  plantão na escala da equipe, e o passo 2, a equipe inteira depois de 10 minutos (sem escala: a equipe inteira de
  imediato). Os passos rodam em ordem até alguém reconhecer. Cada passo espera um número de minutos (0–1440)
  **contados a partir do passo anterior** e então notifica os seus alvos: *On-call of schedule*, *Team (all
  responders)*, que significa todos que não são observadores, incluindo os admins, ou um *User*. **Add step**
  adiciona um passo que notifica a equipe inteira depois de 5 minutos. Cada pessoa é notificada pelos seus próprios
  métodos de contato; **Force channels** abre o campo *Channels* para mudar isso em um passo. Canais sem um provedor
  ligado ficam desabilitados.
- **Repetição**: *Repeat policy if nobody acknowledges* de 1 a 5 vezes. Cada repetição começa após o atraso do último
  passo (5 minutos se esse atraso for 0). Quando todas as repetições terminam, a política fica **esgotada (exhausted)**
  e o incidente continua triggered.
- **Simulação** (sempre visível no editor): *If an incident is triggered now* lista, minuto a minuto, quem seria
  acionado. Ela avisa quando um passo não aciona ninguém (uma lacuna na escala ou uma equipe vazia), cita as pessoas
  que ainda não têm método de contato e informa quando nada acontece depois do único passo.

A precisão do timing é igual ao intervalo do motor: um passo dispara na primeira execução do motor depois de vencido.
No ambiente trial, com intervalo de 1 minuto, cada passo de uma política de teste de quatro passos disparou dentro de
um minuto após o vencimento.

## Services e roteamento

![Services](../../screenshots/services.png) ![Routing](../../screenshots/routing.png)

- **Services**: Serviço, equipe, política de escalonamento (ou *Team default*), regras, incidentes abertos, ruído nos últimos 7 dias
- **Routing rules (N)**: Regras ordenadas (arraste para reordenar). **A primeira regra habilitada que corresponder vence.** Uma regra nova é colocada acima da primeira regra genérica (catch-all, uma regra sem condições). Colunas: #, nome, condições, ações, correspondências em 24 h e uma chave que liga ou desliga a regra. A última linha, fixa, é a rota padrão; ela avisa quando não há equipe padrão. Nesta aba, o botão da página é **New rule**.
- **Test a rule**: Carregue um alerta recente ou um exemplo, edite o JSON, **Run test**: mostra a regra correspondente (ou a mais próxima), cada condição :icon[SuccessIcon]:/:icon[XmarkIcon]: e o serviço, a equipe, a política e a prioridade resultantes, com a sua origem
- **Priority mapping**: Prioridade por categoria do Davis e por severidade, mais o fallback

**Editor de regra**: nome, habilitada, *Match all / any*, condições (campo, operador, valor, *Not*) e **Then**:
serviço, equipe, política de escalonamento, prioridade (ou *Use priority mapping*), adicionar tags e *Suppress (create the incident, page nobody)* (criar o incidente, não acionar ninguém). Aberta a partir da checklist de uma equipe (*Add routing rule*), a regra já
vem com nome e apontando para essa equipe, de modo que só falta a condição. Os
campos, os operadores e a ordem de roteamento estão listados na
[referência de alertas](alerts-reference.md#como-um-alerta-vira-um-incidente).

**Serviço**: nome (os eventos o referenciam pelo nome ou ID em `cc.service`; os demais alertas, como os problemas que o
Davis detecta sozinho, precisam de uma regra de roteamento), descrição, equipe responsável, política de escalonamento
(vazio = a padrão da equipe) e prioridade padrão.

## Integrations (integrações)

- **Inbound**: Cada origem com o seu status (*Receiving*, *Quiet > 1 h*, *Turned off*, *Never seen*), último evento, incidentes em 24 h e **Show events** (abre a Console na aba *All* com *Created* nas últimas 24 horas, para a lista bater com essa contagem). Snippets prontos para copiar (curl, PowerShell, Python, Dynatrace Workflow) e os campos que o app lê.

  ![Inbound](../../screenshots/integrations.png)
- **Outbound**: Os nove provedores (oito integrados mais **Custom workflow**), cada um com uma chave **On/Off**: *Not configured*, *Off*, *Configured*, *Last delivery failed* ou *Host not allowed: add it to External requests*, contagens de enviados/falhos, *Sent by the engine* (o padrão) ou *Sent by its workflow*, **Configure** (ID da entrada do vault ou ID do workflow, parâmetros, **Delivery** e, para um provedor integrado, o host a liberar em *External requests*) e **Send test**. Em **Delivery** você escolhe quem envia um provedor integrado: *By the engine* (sem custo extra) ou *Through its own workflow* (uma chamada de função a mais por notificação). Só pode haver um provedor ativado por canal.

  ![Outbound](../../screenshots/integrations-outbound.png)
- **Workflows**: Status do motor (*Not installed*, *Installed · simple workflow*, *Update available*, *Installed as a standard workflow…*), a última execução do motor, **Run every**, **Install in Workflows**, **Download JSON**, **Run engine now**, **Refresh**, os passos de configuração e os hosts a liberar. Um segundo card, **Command Center · Engine on problem**, instala o workflow opcional que roda o motor quando o Davis abre ou fecha um problema (*Optional · not installed*, *Installed · simple workflow*, *Installed, but its trigger is switched off*).

  ![Workflows](../../screenshots/integrations-workflow.png)

Detalhes: [integrações](integrations.md) e [primeiros passos](getting-started.md).

## Reports (relatórios)

![Reports](../../screenshots/reports.png)

O intervalo de tempo padrão é os últimos 30 dias. Os painéis de resposta, volume, equipes e ruído vêm de consolidações
diárias (mantidas por 90 dias). *Time to acknowledge* e as colunas de fora do horário, noturno e reconhecimentos de
*On-call load* usam os incidentes ainda presentes no app e o registro de notificações (mantido por 14 dias), então
cobrem no máximo cerca de 14 dias.

| Painel | Pergunta que responde |
| --- | --- |
| Response at a glance | MTTA, MTTR, incidentes, sucesso de entrega |
| MTTA and MTTR | *How are acknowledge and resolve times changing?* (como os tempos de reconhecimento e de resolução estão mudando?) |
| Load by priority | *How is the load split across priorities?* (como a carga se divide entre as prioridades?) |
| Incidents per day | *When do incidents arrive, and how urgent are they?* (quando os incidentes chegam, e quão urgentes eles são?) |
| Incidents by team | *Which teams get the most incidents?* (quais equipes recebem mais incidentes?) |
| Noisiest services and sources | *Where do incidents come from?* (de onde vêm os incidentes?) (top 10) |
| Time to acknowledge | Distribuição em minutos (faixas a partir de 0, 1, 2, 5, 10, 15, 30, 60 e 120 minutos; a última faixa contém tudo de 120 para cima) |
| Notification delivery | Proporção de notificações que os provedores aceitaram |
| On-call load | Por pessoa: horas de plantão, acionamentos, acionamentos fora do horário, acionamentos noturnos (00–06), reconhecimentos, tempo médio para reconhecer |

*Fora do horário (off-hours)* significa antes das 08:00, a partir das 18:00, ou em fim de semana; *noturno (night)*
significa antes das 06:00. Ambos usam o fuso horário do seu navegador.

## Help (ajuda)

![Help](../../screenshots/help.png)

**Get started** tem cinco passos e se marca sozinho a partir dos seus dados: criar uma equipe, concluir a checklist
*Ready to page?* da equipe (marcado quando uma equipe tem os cinco passos concluídos), ligar um provedor, instalar o
workflow do motor (existe um heartbeat) e enviar um evento de teste (existe um incidente). Depois vêm conceitos, fluxo de trabalho no Console, envio de eventos, notificações, atalhos de
teclado, solução de problemas e privacidade.

O menu à esquerda também lista os sete guias (primeiros passos, instalar com vibe coding, guia do usuário, referência
de alertas, integrações, configuração, operações). Os guias mostram os ícones do próprio app. O seletor de idioma
mostra a página Help inteira, a visão geral inclusive, em English, Português (BR) ou Español. Inglês é o padrão; a sua
escolha fica guardada neste navegador, e o endereço de um guia leva o guia e o idioma (`?lang=…`), para que possa ser
compartilhado e abra no idioma em que foi compartilhado.
