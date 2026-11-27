# Primeiros passos — instalação, permissões e o motor de acionamento

🌐 [English](../en/getting-started.md) · **Português (BR)** · [Español](../es/getting-started.md)

Este guia leva você de um ambiente vazio até um primeiro acionamento de teste. Reserve cerca de 30 minutos. Cada passo
diz o que está verificado e o que não está, para que você saiba o que conferir por conta própria.

## O que você precisa

- Um ambiente Dynatrace SaaS (Dynatrace mais recente) com Grail, AppEngine e Workflows.
- Node.js 22 ou superior e npm, para compilar e implantar o app.
- Permissão para implantar apps. Para acionamentos, você também precisa de um administrador para o Credential Vault, a
  lista de permissões de External requests e as configurações de autorização do Workflows.
- Contas nos provedores que você vai usar: Twilio e IFTTT são os padrões. Slack, Microsoft Teams, Telegram e um
  webhook genérico também já vêm integrados.

## Passo 1 — Implante o app

```bash
npm install
# app.config.json → "environmentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/"
npx dt-app deploy
```

- O ID do app precisa começar com `my.` para um app não assinado. O padrão é `my.command.center`.
- Cada implantação precisa de um `app.version` maior que a versão instalada naquele ambiente.
- Na primeira abertura, cada usuário é solicitado a consentir com as permissões do app (próxima seção).

## Passo 2 — Entenda as permissões

O app pede apenas o que usa. Cada escopo abaixo foi aceito quando o app foi implantado em um ambiente trial e foi
exercitado lá pela funcionalidade da segunda coluna.

| Escopo do app | Para que é usado | Onde a Dynatrace o documenta |
| --- | --- | --- |
| `storage:buckets:read` | Qualquer leitura do Grail (exigido junto com a permissão da tabela) | [Grail permissions](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail) |
| `storage:events:read` | O motor lê `dt.davis.problems`, `dt.davis.events` e `events` | [Grail permissions](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail) |
| `state:app-states:read` / `:write` / `:delete` | Configuração, incidentes, ações dos operadores, registro de notificações (App State) | Referência do SDK `@dynatrace-sdk/client-state` ("Required scope" de cada chamada), [State management API](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-state-management-v1) |
| `iam:users:read` | Busca de membros de equipe e nomes de exibição | [IAM API: get users](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-iam-v1/organizational-levels-level-type-level-id-users-get) |
| `automation:workflows:read` | Integrations → Workflows: status de instalação do workflow do motor; encontrar o seu custom workflow | [Workflows security](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/security) |
| `automation:workflows:run` | A integração **Custom workflow**: o motor executa o seu workflow uma vez por notificação | [Workflows security](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/security) |
| `document:documents:read` | War rooms: listar notebooks para anexar | [Document SDK](https://developer.dynatrace.com/develop/sdks/client-document/) |
| `document:documents:write` | War rooms: criar o notebook de post-mortem | Referência do SDK `@dynatrace-sdk/client-document` ("Required scope" de `createDocument`) |
| `credential-vault:entries:read` | O motor lê os segredos dos provedores quando envia | [Credential Vault API](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-credential-vault-v1/entries-entry-id-get) |

**Não solicitados, e por quê**

- `automation:workflows:write`: a plataforma o rejeitou quando implantamos o app. A implantação informou que apenas
  apps fornecidos pela Dynatrace podem usar esse escopo. Por isso o app **não consegue criar o próprio workflow**. O
  passo 5 mostra a alternativa de um clique.
- Nenhum escopo de ingestão: o app nunca escreve no Grail. Suas ferramentas enviam eventos com o próprio token (veja a
  [referência de alertas](alerts-reference.md)).

**Permissões de usuário.** Um escopo do app não basta sozinho. O app age com as permissões de cada **usuário**, então
os usuários também precisam de políticas de IAM que concedam as mesmas permissões (leitura do Grail, App State,
documentos, leitura de usuários do IAM).

**A busca de usuários mostra apenas usuários ativos.** A busca de membros de equipe usa o endpoint do IAM que retorna
usuários *ativos* da conta dona do ambiente. Alguém que foi convidado, mas ainda não aceitou o convite, **não é
encontrado**. Peça para a pessoa entrar uma vez e depois busque novamente.

## Passo 3 — Guarde os segredos dos provedores no Credential Vault

Crie uma entrada por provedor no **Credential Vault** (Dynatrace mais recente) e anote o ID da entrada
(`CREDENTIAL_VAULT_ENTRY-…`). O Command Center guarda **apenas o ID**, nunca o segredo.

| Provedor | Tipo de credencial | Conteúdo |
| --- | --- | --- |
| Twilio (SMS, voz, WhatsApp) | Username and password | Account SID / auth token, ou API key SID / API key secret (nesse caso, preencha também *Account SID* no provedor) |
| IFTTT Webhooks | Token | Sua chave do IFTTT Webhooks |
| Slack | Token | A URL completa do incoming webhook `https://hooks.slack.com/…` |
| Microsoft Teams | Token | A URL completa do webhook do **Workflows** do Teams ("When a Teams webhook request is received") |
| Telegram | Token | O token do bot (o endereço de contato da pessoa é o chat ID dela) |
| Webhook genérico | Token, ou username and password | Token: a URL `https://` do endpoint. Username/password: username = URL, password = o valor do header de autenticação |

Configurações da entrada:

- Selecione o escopo **AppEngine**.
- Mantenha **Owner access only** ativado (recomendado) e defina o **ator do workflow** (passo 5) como dono, como no
  ambiente trial. A documentação da Dynatrace afirma
  que uma credencial só pode ser usada em um app quando *tanto* o usuário *quanto* o app têm acesso a ela.
- *Allow access without app context* **não** é necessário: o motor roda como uma ação do app. No ambiente trial, uma
  entrada sem essa opção foi lida com sucesso pelo motor.

## Passo 4 — Libere os hosts dos provedores

**Settings → General → Environment management → External requests**: adicione apenas os hosts que você usa.

| Provedor | Host |
| --- | --- |
| Twilio | `api.twilio.com` |
| IFTTT | `maker.ifttt.com` |
| Slack | `hooks.slack.com` |
| Microsoft Teams | O host da URL do seu webhook do Teams Workflows (copie da URL) |
| Telegram | `api.telegram.org` |
| Webhook genérico | O host do seu endpoint |

## Passo 5 — Instale o workflow do motor

O motor é um **simple workflow** chamado **Command Center · Engine**. Ele tem uma única tarefa, a ação do próprio app
**Run Command Center engine**, com um gatilho de intervalo. Simple workflows não consomem workflow hours
([Create a simple workflow](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/build/simple-workflow)).
O [guia de operações](operations.md) explica o custo.

Abra **Command Center → Integrations → Workflows**, escolha **Run every** 1, 2 ou 5 minutos e use uma destas três
opções:

| Opção | Como | Status |
| --- | --- | --- |
| **A. Install in Workflows** | Abre o app Workflows com o workflow já preenchido (intent "create workflow" do Workflows). Revise, salve e implante. | O payload do intent documentado pela Dynatrace tem título, tarefas e gatilho, mas **nenhum tipo de workflow**. Se o novo workflow sair como um workflow *standard*, a aba Workflows mostra um aviso. Nesse caso, exclua-o e use B ou C. |
| **B. Download JSON** | App Workflows → **Upload** → o arquivo baixado. O arquivo contém `"type": "SIMPLE"` e o intervalo que você escolheu. | É a mesma definição que foi criada pela Automation API e rodou no ambiente trial. O botão de upload em si não foi exercitado. |
| **C. Script de administrador** | `DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com DT_PLATFORM_TOKEN=… node scripts/install-workflow.mjs --interval 1` (token com `automation:workflows:read` e `automation:workflows:write`). Idempotente; `--dry-run` imprime o JSON. | Verificado no ambiente trial: um simple workflow, rodando a cada minuto, todas as execuções com sucesso. |

Depois:

1. **Ator.** O workflow roda como o seu ator, que é a pessoa que o implanta, a menos que você defina um usuário de
   serviço. A ação do motor lê o Grail, o App State e o Credential Vault com as permissões do ator.
2. **Authorization settings.** No app Workflows → **Settings → Authorization settings**, habilite para o ator as
   permissões que o motor usa: `storage:buckets:read`, `storage:events:read`, `state:app-states:read`,
   `state:app-states:write`, `state:app-states:delete`, `credential-vault:entries:read` e, para os workflows de integração
   e a integração Custom workflow, `automation:workflows:run`. O ator de cada workflow de integração precisa de
   `state:app-states:read`, `state:app-states:write` e `credential-vault:entries:read`: a ação dele lê as
   configurações do provedor, lê o segredo e registra o resultado. No ambiente trial, todas as permissões foram habilitadas para o ator, então o conjunto mínimo não foi isolado.
3. De volta ao Command Center, selecione **Refresh**. Se o workflow foi encontrado pelo título, selecione **Save this
   ID**. O status fica verde (**Installed · simple workflow**) e **Last engine run** é atualizado dentro de um
   intervalo.

**Run engine now** executa um ciclo completo imediatamente pela função do app `engine-run`, com as suas próprias
permissões. Use-o para testar sem esperar o agendamento.

## Passo 6 — Configure os provedores

**Integrations → Outbound**: cada card de provedor tem uma chave **On/Off**, e somente os provedores ativados são
usados. Ativar um provedor pela primeira vez abre **Configure**: cole o ID da entrada do vault, preencha os parâmetros
não secretos e salve. Só pode haver um provedor ativado por canal.

Quando um provedor integrado é ativado (**on**), o app Workflows abre com **o seu próprio workflow** já preenchido
(*Command Center · <provider>*, um simple workflow cuja tarefa é a ação do app *Send Command Center notification*).
Salve-o lá. De volta a Integrations → Outbound, o Command Center o encontra pelo título e o vincula; o card passa a
mostrar *Sent by its workflow*. Até que ele seja vinculado, o próprio motor envia as notificações desse provedor, então
nada se perde. Depois use **Send test** com um endereço. Detalhes: [integrações](integrations.md#integration-workflows).

| Provedor | Parâmetros |
| --- | --- |
| Twilio SMS / Voice / WhatsApp | *Sender number* em E.164 (WhatsApp: o remetente aprovado). *Account SID* apenas com uma API key. *Messaging service SID* (opcional, SMS). *Voice* e *Voice language* (opcionais, chamadas). |
| IFTTT | *Event name* (padrão `command_center_alert`) |
| Slack, Microsoft Teams, Telegram | nenhum |
| Webhook genérico | *Auth header name* (opcional). O valor do header é a senha de uma entrada do tipo username/password. |
| Custom workflow | *Workflow ID* de um workflow que é seu (veja [integrações](integrations.md#custom-workflow)). Sem entrada do vault. |

## Passo 7 — Pessoas, escalas, políticas e roteamento

A página da equipe conduz você: a checklist **Ready to page?** sempre destaca o próximo passo.

1. **Teams → New team**: digite um nome e deixe **Default team** (equipe padrão) marcado. A equipe passa a receber
   todo alerta que nenhuma regra de roteamento envia para outro lugar. Isso importa porque os problemas do Davis não
   trazem equipe.
2. **Add people**: o seu próprio usuário é oferecido primeiro; para os demais, digite pelo menos 3 caracteres de um
   nome ou email.
3. **Add contact methods**: há uma linha pronta para cada pessoa (telefone em E.164, chat ID do Telegram, um nome para
   Slack/Teams/IFTTT, uma routing key para o webhook). **Save and next** segue para a próxima pessoa. As regras de
   notificação são opcionais, por exemplo "P1–P2: voz agora, SMS após 5 minutos".
4. **Create schedule**: a escala abre com o nome da equipe e com as pessoas dela no rodízio. Ajuste o tipo de rodízio
   e o horário de passagem de plantão, se precisar, e salve. A prévia de cobertura mostra as lacunas e as próximas
   passagens de plantão.
5. **Create policy**: a política abre com a pessoa de plantão primeiro e a equipe inteira depois de 10 minutos. Salve.
   A seção **Simulation** mostra quem é notificado e quando.
6. Opcional: **Services** e **regras de roteamento** enviam certos alertas para outras equipes; **Test a rule** as
   confere. **Settings → Routing defaults** mostra a equipe e a política padrão.

A partir de um app vazio, isso leva cerca de 20 cliques e campos digitados para uma equipe de três pessoas. Um
problema do Davis é então roteado para a equipe e para a política de escalonamento dela (confira em **Services → Test
a rule**).

Detalhes de cada tela: [guia do usuário](user-guide.md).

## Passo 8 — Envie um evento de teste

```bash
curl -X POST "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Bearer <PLATFORM-TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"CUSTOM_ALERT","title":"Test from Command Center setup","timeout":15,
       "properties":{"cc.service":"<your service name>","cc.priority":"P3"}}'
```

O token precisa de `openpipeline:events.davis:ingest`. Dentro de um intervalo do motor, o incidente aparece no
Console. A pessoa de plantão é então acionada de acordo com a política. Reconheça (Acknowledge) o incidente no Console
para parar o escalonamento.

**Somente em um ambiente trial ou de teste**, `workflow-templates/command-center-alert-simulator.workflow.json` publica
um ou dois alertas sintéticos `[SIM] …` a cada 7 minutos. É um workflow standard, portanto consome workflow hours, e
nunca deve ser importado em produção.

## Modo demo

**Settings → General → Demo mode → Show sample data** passa **este navegador** para incidentes, equipes, escalas, war
rooms e relatórios de exemplo. Enquanto está ativado, nada é lido do ambiente nem escrito nele, e nenhuma notificação é
enviada. Quando está desativado, tudo o que aparece são dados reais do ambiente: o app nunca mistura os dois. A chave é
por navegador de propósito, para que a demonstração de um apresentador nunca substitua o console real dos operadores
de plantão. Fora do Dynatrace (a prévia offline), o app sempre roda em modo demo.
