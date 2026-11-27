# Command Center for Dynatrace

🌐 [English](README.md) · **Português (BR)** · [Español](README.es.md) — 🔗 **Página do projeto:** https://adrianorafael.github.io/Command-Center-for-Dynatrace/

O **Command Center for Dynatrace** é um app criado e mantido por [@adrianorafael](https://github.com/adrianorafael) no GitHub.

É um **console de eventos para NOC com gestão de plantão (on-call)**, construído nativamente no Dynatrace AppEngine. Ele
transforma Davis problems e eventos publicados no Dynatrace em **incidentes** que os operadores triam, reconhecem,
atribuem, adiam (snooze) e resolvem. Ele **aciona as pessoas de plantão** de uma equipe via Twilio (SMS, voz, WhatsApp)
e IFTTT por padrão, além de Slack, Microsoft Teams, Telegram e um webhook genérico. Ele explora o que é preciso para
substituir um console de alertas dedicado, como **Splunk On-Call (VictorOps)**, **Atlassian Opsgenie** ou um **console
de NOC no estilo Moogsoft**, por um app que vive dentro do Dynatrace.

Este app é um **app de demonstração**. Ele mostra até onde você consegue chegar construindo o seu próprio Dynatrace App
por meio de **vibecoding**, seguindo a documentação oficial em [developer.dynatrace.com](https://developer.dynatrace.com/)
e usando o **Strato**, o design system da Dynatrace.

> ⚠️ **Aviso**
>
> Este app é fornecido pelo desenvolvedor **sem nenhuma afiliação com a Dynatrace** e **sem nenhuma responsabilidade** por quaisquer falhas, problemas ou consumo de recursos e licenças. É uma **versão de estudo, sem suporte oficial**.
>
> A decisão de baixá-lo e instalá-lo no seu ambiente é **por conta e risco do próprio usuário**. Você também é livre para melhorar e expandir as suas funcionalidades.

> **O acionamento é uma função crítica para a segurança.** Não faça deste app a única forma de acordar a sua equipe à
> noite até ter testado cada canal de ponta a ponta no seu próprio ambiente. Leia primeiro
> [Verificado e não verificado](docs/guides/pt-BR/operations.md#verificado-e-não-verificado).

![Console](docs/screenshots/console.png)

## Visão geral

| | |
| --- | --- |
| **Entrada** | Somente pelo Dynatrace: Davis problems e, opcionalmente, Davis events e eventos genéricos, lidos do Grail com DQL. Suas ferramentas publicam eventos nas APIs de ingestão do Dynatrace. |
| **Console** | Tabela de incidentes ao vivo com tiles de KPI, filtros, ações em massa e atalhos de teclado; detalhes do incidente com linha do tempo, progresso do escalonamento, registro de notificações, entidades e notas. |
| **Plantão** | Equipes de **usuários do Dynatrace** (escolhidos no IAM), escalas em camadas com rodízio e substituições (overrides), políticas de escalonamento com passos e repetições, métodos de contato pessoais, regras de notificação e quiet hours (horário de silêncio) por equipe. |
| **War rooms** | Um link de reunião mais os incidentes que ela trata e os seus Dynatrace Notebooks, incluindo um notebook de post-mortem gerado. |
| **Saída** | Um único **simple workflow** (*Command Center · Engine*) executa a ação do próprio app a cada 1, 2 ou 5 minutos e não consome workflow hours. Cada integração tem uma chave On/Off; ativar uma delas cria **o seu próprio workflow** (*Command Center · Slack*, …) com uma confirmação no app Workflows, e esse workflow envia as notificações dela. Uma integração **Custom workflow** entrega as notificações a um workflow pré-preenchido que é seu e que você edita. |
| **Armazenamento** | Dynatrace App State. Nenhum banco de dados externo. Os segredos dos provedores ficam no Credential Vault. |
| **Modo demo** | Por navegador: dados de exemplo em todo lugar, nada é lido nem escrito, nada é enviado. Desativado: somente dados reais. |

Versão atual: **2.1.1** — veja o [CHANGELOG.md](CHANGELOG.md).

## Documentação

| Guia | O que cobre |
| --- | --- |
| [Primeiros passos](docs/guides/pt-BR/getting-started.md) | Implantação, cada permissão com a sua documentação da Dynatrace, Credential Vault, lista de permissões de hosts, instalação do motor, primeiro teste |
| [Guia do usuário](docs/guides/pt-BR/user-guide.md) | Cada tela e menu, ícones, status, KPIs, notificações, war rooms, chave de plantão |
| [Referência de alertas](docs/guides/pt-BR/alerts-reference.md) | Os três caminhos de entrada, formatos JSON, campos, propriedades `cc.*`, ordem de roteamento |
| [Integrações](docs/guides/pt-BR/integrations.md) | Os oito canais, o que cada provedor recebe, payload do webhook, textos das mensagens, testes |
| [Configuração](docs/guides/pt-BR/configuration.md) | Cada configuração com o seu padrão, funções do app para automação, dados armazenados |
| [Operações](docs/guides/pt-BR/operations.md) | Arquitetura, o estudo de custo do simple workflow com medições, solução de problemas, segurança, o que está verificado |

Também disponível em inglês em [docs/guides/en](docs/guides/en/) e em espanhol em [docs/guides/es](docs/guides/es/).

## O que ele substitui

| Capacidade de um console dedicado | Como o Command Center faz |
| --- | --- |
| API de recebimento de alertas | Ingestão de eventos do Dynatrace via OpenPipeline. O Davis transforma eventos em problems; o Command Center os lê do Grail. |
| Deduplicação e correlação | Correlação do Davis em problems, mais uma chave de deduplicação por origem (`cc.dedup_key`) |
| Linha do tempo e auditoria do incidente | Linha do tempo somente de acréscimo (append-only) por incidente: quem, quando, o quê |
| Escalas de plantão, rodízios, substituições | Camadas (diária, semanal, a cada N horas), horário de passagem de plantão, fuso horário, restrições de dia da semana/horário, substituições, sair/assumir o plantão pelo cabeçalho |
| Políticas de escalonamento | Passos ordenados com atrasos, alvos (escala, usuário, equipe inteira), canais forçados opcionais, repetições; para no reconhecimento |
| Métodos de contato e regras pessoais | SMS, voz, WhatsApp, Telegram, Slack, Teams, IFTTT, webhook, com "prioridade até Px → este método após N minutos" |
| Roteamento / regras de alerta | Serviços mais regras ordenadas (a primeira correspondência vence), com um testador de regras |
| Manutenção e quiet hours | Janelas de manutenção do Davis suprimem o acionamento (configurável); as quiet hours da equipe retêm ou rebaixam acionamentos menos urgentes |
| War rooms / pontes | Link de reunião, incidentes vinculados, notebooks, modelo de post-mortem |
| Relatórios | MTTA, MTTR, volume, ruído, entrega, carga de plantão |
| Integrações de saída | Remetentes integrados, um webhook JSON genérico e um custom workflow seu para todo o resto |

Não implementado: reconhecimento bidirecional por respostas de SMS ou chat, um app móvel, status pages e permissões
por usuário aplicadas no servidor.

## Início rápido

```bash
npm install
# app.config.json → "environmentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/"
npx dt-app deploy
```

Depois, no app:

1. **Integrations → Workflows** → escolha o intervalo → **Install in Workflows** (ou **Download JSON** e faça o upload
   do arquivo). Habilite as **Authorization settings** do Workflows para o ator.
2. Entradas do **Credential Vault** para os seus provedores. Adicione os hosts deles em **External requests**.
3. **Integrations → Outbound** → ative os provedores que você usa (Twilio, IFTTT, Slack, Teams, Telegram, webhook ou
   o seu próprio custom workflow). Cada um abre o app Workflows com o seu próprio workflow já preenchido: salve-o, volte,
   e o Command Center o vincula. Depois use **Send test**.
4. **Teams**, **On-call**, **Escalations**, **Services** → pessoas, escalas, uma política, roteamento.
5. Envie um evento (o token precisa de `openpipeline:events.davis:ingest`):

```bash
curl -X POST "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Bearer <PLATFORM-TOKEN>" -H "Content-Type: application/json" \
  -d '{"eventType":"CUSTOM_ALERT","title":"Checkout latency above 2 s","timeout":30,
       "properties":{"cc.service":"checkout","cc.priority":"P2"}}'
```

Cada passo em detalhe: [primeiros passos](docs/guides/pt-BR/getting-started.md).

## Escopos OAuth necessários

| Escopo | Finalidade |
| --- | --- |
| `storage:buckets:read` | Qualquer leitura do Grail |
| `storage:events:read` | Ler `dt.davis.problems`, `dt.davis.events`, `events` |
| `state:app-states:read` / `:write` / `:delete` | Configuração, incidentes, ações, registro de notificações |
| `iam:users:read` | Busca de membros de equipe e nomes |
| `automation:workflows:read` | Status de instalação do workflow do motor; encontrar o seu custom workflow |
| `automation:workflows:run` | Integração Custom workflow: executar o seu workflow uma vez por notificação |
| `document:documents:read` / `:write` | War rooms: anexar notebooks, criar o notebook de post-mortem |
| `credential-vault:entries:read` | O motor lê os segredos dos provedores quando envia |

`automation:workflows:write` **não** é solicitado: a plataforma o rejeitou quando implantamos, com a mensagem de que
apenas apps fornecidos pela Dynatrace podem usá-lo. É por isso que o workflow é instalado com uma confirmação no app
Workflows. O link da documentação de cada escopo está em
[primeiros passos](docs/guides/pt-BR/getting-started.md#passo-2--entenda-as-permissões).

## Custo de consultas e consumo

> ⚠️ Leia isto antes de rodar o app em produção. O motor roda o dia inteiro, independentemente de quantas pessoas usam
> o app.

| Item | Intervalo de 1 minuto | 2 minutos | 5 minutos |
| --- | --- | --- | --- |
| Execuções do motor (uma invocação de função cada) por mês | ≈ 43.200 | ≈ 21.600 | ≈ 8.640 |
| Workflow hours | 0 | 0 | 0 |
| Consultas ao Grail por execução | 1–8 | 1–8 | 1–8 |

Medido em um ambiente trial: o motor anterior, baseado em workflow standard, usava cerca de **690 invocações de função
por hora mais uma workflow hour por hora**. O motor baseado em simple workflow usa **1 invocação por execução** (60 por
hora em um intervalo de 1 minuto) e nenhuma workflow hour. A UI não executa DQL. As consultas, os fatores de custo e
como medi-los no seu próprio ambiente estão no [guia de operações](docs/guides/pt-BR/operations.md#custo-e-consumo).

## Desenvolvimento

```bash
npx dt-app dev        # open the link printed in the terminal (the app must run inside Dynatrace)
npm test              # vitest: domain, engine cycle, senders, lease, workflow definition
npm run typecheck     # tsc for ui/ and api/
npm run lint          # ESLint incl. security and secret rules
npm run check         # lint + typecheck + test + build
```

Prévia offline em modo demo: `npx dt-app build && node scripts/preview-server.mjs --port 4173` e depois abra
`http://127.0.0.1:4173/ui/`. `node scripts/screenshot.mjs ./out` tira uma captura de tela por rota.

| Script | Descrição |
| --- | --- |
| `node scripts/install-workflow.mjs [--interval 1\|2\|5] [--actor <uid>] [--dry-run]` | Instalação ou atualização, por um administrador, do workflow do motor pela Automation API (platform token com `automation:workflows:read` e `:write`) |
| `node scripts/gen-workflow-templates.mjs [--check]` | Regenerar ou verificar `workflow-templates/command-center-engine.workflow.json` |
| `node scripts/preview-server.mjs` | Servir a UI compilada offline em modo demo |
| `node scripts/screenshot.mjs` | Capturar a tela de cada rota da prévia offline |

Implantando em outro ambiente: edite `environmentUrl`, `npx dt-app auth`, `npx dt-app deploy` e depois repita a
instalação do motor, as entradas do vault e a lista de permissões de hosts. O App State não é migrado: use
**Settings → Export and import**.

## Estrutura de arquivos relevante

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

## Versionamento e changelog

[Semantic Versioning](https://semver.org/), em que "breaking" significa que quebra algo para quem roda o app. MAJOR: um
escopo mudou (todos consentem novamente), dados armazenados mudaram sem migração, uma funcionalidade foi removida ou um
padrão aumenta o custo. MINOR: uma nova visão, gráfico, filtro ou configuração. PATCH: correções, textos, estilo,
atualizações de dependências. `app.config.json → app.version` é a única fonte da verdade, cada release está no
[CHANGELOG.md](CHANGELOG.md), e o Dynatrace rejeita uma implantação cuja versão não seja maior que a instalada.

---

Construído seguindo o [Development Pattern for Dynatrace](https://github.com/adrianorafael/development-pattern-for-Dynatrace).
