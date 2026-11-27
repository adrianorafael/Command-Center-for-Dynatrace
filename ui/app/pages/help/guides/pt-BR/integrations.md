# Integrações — como as notificações saem

Os eventos de entrada são tratados na [referência de alertas](alerts-reference.md). Esta página trata do lado de
saída: os oito canais, o que cada provedor recebe, a integração custom workflow e como testá-los.

![Integrations — Outbound](../../screenshots/integrations-outbound.png)

## Como uma notificação é enviada

1. O motor roda no seu agendamento (simple workflow, uma ação). Ele decide quem precisa ser notificado agora: o passo
   de escalonamento que está vencido, as pessoas de plantão para os alvos desse passo e as regras de notificação de
   cada pessoa.
2. Ele grava uma **entrada no registro (ledger)** (`planned`) por pessoa, passo, canal e tentativa.
3. Logo após o planejamento, a mesma execução envia: ela lê o segredo do provedor no Credential Vault e chama o
   provedor por HTTPS (ou executa o seu custom workflow). Uma integração que tem workflow próprio (abaixo) é
   entregue a esse workflow.
4. O resultado é gravado de volta: `sent` (com a referência do provedor, quando uma é retornada) ou `failed` (com o
   erro do provedor; segredos e URLs são mascarados como `***` e `<url>`).
5. Uma notificação que falhou, ou que não teve resultado dentro de *Delivery report timeout* (`timeout`), é tentada
   novamente com uma nova tentativa enquanto o incidente ainda está triggered, até *Delivery attempts* (padrão 3).

Cada chamada HTTP tem um timeout de 10 segundos. Uma execução não inicia nenhum novo envio depois de cerca de 90 segundos
do seu início; o que sobrar é enviado na execução seguinte. O acionamento é **pelo menos uma vez (at least once)**: em raras condições de corrida
(uma execução que se sobrepõe a uma execução anterior lenta), uma pessoa pode ser notificada duas vezes.

## Canais e provedores

| Canal | Provedor (ID padrão) | Endereço de contato de uma pessoa | Entrada do vault |
| --- | --- | --- | --- |
| SMS | Twilio SMS (`twilio-sms`) | Telefone em E.164, por exemplo `+5511999990000` | Username/password: Account SID (ou API key SID) / auth token (ou API key secret) |
| Chamada de voz | Twilio Voice (`twilio-voice`) | Telefone em E.164 | igual |
| WhatsApp | Twilio WhatsApp (`twilio-whatsapp`) | Telefone em E.164 (o prefixo `whatsapp:` é adicionado) | igual |
| IFTTT | IFTTT Webhooks (`ifttt`) | Qualquer rótulo: o applet decide para onde vai | Token: sua chave do Webhooks |
| Slack | Slack (`slack`) | Qualquer rótulo: o webhook decide o canal; a mensagem mostra o nome da pessoa | Token: a URL do incoming webhook |
| Microsoft Teams | Microsoft Teams (`teams`) | Qualquer rótulo: o webhook decide o chat; o card mostra o nome da pessoa | Token: a URL do webhook do Teams Workflows |
| Telegram | Telegram (`telegram`) | O chat ID | Token: o token do bot |
| Webhook | Webhook genérico (`webhook`) | Uma routing key para o seu endpoint | Token: a URL do endpoint. Ou username/password: username = URL, password = valor do header de autenticação |
| Webhook | Custom workflow (`custom-workflow`) | Uma routing key, passada como `notification.to.address` | nenhuma: o ID de um workflow que é seu |

Todo provedor começa **desativado** e tem uma chave **On/Off** no seu card. Um provedor só é usado enquanto está
ativado e configurado (um ID de entrada do vault; para o custom workflow, um ID de workflow). Só pode haver um provedor
ativado por canal: o webhook genérico e o custom workflow compartilham o canal *webhook*. Provedores desativados não
custam nada, e nada deles é executado.

## Integration workflows

Por padrão, o próprio motor envia todas as integrações nativas, sem custo extra. Uma integração **pode** ter um
workflow próprio no lugar; você escolhe isso por integração:

| Passo | O que acontece |
| --- | --- |
| Escolher | **Configure → Delivery → Through its own workflow** e depois **Create its workflow**. O app Workflows abre com *Command Center · &lt;provider&gt;* já preenchido: um simple workflow, sem gatilho (sob demanda), uma tarefa — a ação do app **Send Command Center notification** com as entradas `providerId` e `notification` = `{{ execution().params.notification }}`. Você o salva lá (o app não consegue criar workflows sozinho). **Download JSON** entrega a mesma definição para upload. Depois salve a integração. |
| De volta ao Command Center | Integrations → Outbound encontra o workflow pelo título e o vincula (o ID dele é armazenado no provedor); **Find its workflow** faz o mesmo manualmente. O card passa a mostrar *Sent by its workflow*. |
| Uma notificação está vencida | O motor executa esse workflow com a notificação como parâmetros de execução. A ação lê as configurações do provedor no Command Center e o segredo no Credential Vault, envia e grava *Sent* ou *Failed* no registro de notificações. Um envio com falha faz a execução do workflow falhar, então isso aparece no app Workflows. |
| O workflow não pode ser executado | Excluído, ou sem permissão: o motor envia essa notificação diretamente, para que ninguém perca um acionamento. Até que um workflow seja vinculado, o motor também envia diretamente. |
| Voltar para o motor | **Configure → Delivery → By the engine** remove a escolha e o vínculo. O workflow em si continua no app Workflows: exclua-o lá se não precisar dele. |
| Desativar (**off**) | O provedor e o seu workflow deixam de ser usados; o vínculo é mantido para quando você ativá-lo de novo. O app não consegue pausar nem excluir workflows. |

Cada notificação de uma integração com workflow próprio é uma execução de workflow com uma invocação de ação, além da
execução do motor que a planejou; enviada pelo motor, ela não custa nenhuma invocação extra. Como simple
workflows, eles não consomem workflow hours. Se um workflow foi criado como workflow *standard* (o intent
create-workflow não tem campo de tipo), *Find its workflow* avisa e o vínculo automático o ignora; nesse caso, faça o
upload do JSON baixado.

## O que cada provedor recebe

| Provedor | Requisição | Conteúdo |
| --- | --- | --- |
| Twilio SMS | `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` (form, HTTP Basic) | `To`, `Body` (o texto do SMS, no máximo 1.600 caracteres), `From` ou `MessagingServiceSid` |
| Twilio WhatsApp | mesmo endpoint | `To` e `From` com o prefixo `whatsapp:`, `Body` |
| Twilio Voice | `POST …/Calls.json` | `To`, `From`, `Twiml`: a mensagem é falada duas vezes com `<Say>` (`voice` e `language` opcionais) |
| IFTTT | `POST https://maker.ifttt.com/trigger/{event}/with/key/{key}` | `value1` = assunto, `value2` = texto, `value3` = link do incidente |
| Slack | `POST` na URL do webhook | Uma mensagem com o assunto, o texto e o link do incidente. A marcação do Slack é escapada, então o título de um alerta não consegue mencionar `@channel`. |
| Microsoft Teams | `POST` na URL do webhook | Um Adaptive Card com o assunto, o texto e um botão **Open in Command Center** |
| Telegram | `POST https://api.telegram.org/bot{token}/sendMessage` | `chat_id`, `text` = assunto + texto + link, como texto simples (sem marcação), pré-visualização de links desativada |
| Webhook genérico | `POST` na sua URL, `Content-Type: application/json`, header de autenticação opcional | `{"source":"command-center","version":1,"notification":{…}}` (abaixo) |

Microsoft Teams: somente webhooks do **Teams Workflows** são suportados. A Microsoft aposentou os antigos webhooks de
conector do Office 365.

### Payload do webhook genérico

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
| `key` | Único por incidente, ciclo de escalonamento, passo, pessoa, canal e tentativa. Use-o para deduplicar do seu lado. |
| `cycle` | Ciclo de escalonamento, começando em 1. Ele aumenta quando o incidente é disparado novamente, reaberto, sai do snooze ou perde o reconhecimento; *Escalate now* só o aumenta depois que a política está esgotada. |
| `step` | Ordinal do escalonamento: passada × número de passos + índice do passo (0 = primeiro passo da primeira passada) |
| `attempt` | 1 na primeira tentativa, depois 2, 3… nas novas tentativas após um timeout |
| `to` | A pessoa: ID de usuário do IAM, o endereço do seu método de contato, nome de exibição |
| `subject`, `text` | Textos pré-renderizados (limites abaixo) |
| `speech` | Somente para voz: o texto a ser falado |

Este é o caminho de saída para qualquer ferramenta sem um remetente integrado: um ITSM, um gateway de email, um chat
bot, outro serviço de acionamento. Se você preferir montar essa chamada no Dynatrace Workflows, use o custom workflow
abaixo.

## Custom workflow

O provedor **Custom workflow** entrega cada notificação a um workflow **que é seu e que você edita**, para que você
alcance qualquer sistema com qualquer ação do Workflows (HTTP request, email, ITSM, chat) sem alterar o Command Center.

1. **Integrations → Outbound → Custom workflow → Configure → Create example workflow.** O app Workflows abre com um
   simple workflow chamado *Command Center · Custom integration*: uma tarefa **HTTP request**, método POST, uma URL de
   exemplo `https://example.com/command-center/notifications`, um header de exemplo e o corpo
   `{{ execution().params | to_json }}`. Ou selecione **Download example JSON** e faça o upload no app Workflows.
2. No app Workflows, substitua a URL e os headers pelos do seu endpoint, ou substitua a tarefa por qualquer ação. A
   notificação fica disponível nas expressões, por exemplo `{{ execution().params.notification.subject }}`,
   `{{ execution().params.notification.priority }}` ou `{{ execution().params.notification.to.address }}`. Salve.
3. De volta ao Command Center, selecione **Find my workflow** → **Use** (ou cole o ID do workflow), **Save**, ative o
   provedor (**On**) e use **Send test**.
4. Adicione o host do seu endpoint em *External requests*. Nas **Authorization settings** do Workflows, o ator do
   workflow do motor precisa de `automation:workflows:run`, e o ator do seu workflow precisa das permissões que a
   tarefa dele usa.

Os parâmetros de execução são o mesmo JSON do corpo do webhook genérico: `{"source":"command-center","version":1,
"notification":{…}}`. *Sent* significa que a execução do workflow foi aceita. O que o seu workflow faz depois não é
rastreado pelo Command Center: confira as execuções dele no app Workflows. Cada notificação é uma execução de workflow.
Como simple workflow, ele não consome workflow hours; a sua tarefa é cobrada como qualquer tarefa de workflow. O
exemplo não tem gatilho próprio (sob demanda), e vale a mesma ressalva do motor: se o intent o criar como um workflow
*standard*, **Find my workflow** avisa, e o JSON enviado por upload cria um simple workflow.

## Textos das mensagens

- **Assunto:** `[P2] P-26112716 <title> · Command Center`, no máximo 150 caracteres.
- **SMS e voz:** `P2 P-26112716: <title> <service> Ack: <incident link>`, no máximo 300 caracteres. O título é
  encurtado primeiro.
- **Outros canais:** prioridade, ID, título, serviço, equipe, descrição (como texto simples) e até cinco entidades
  afetadas, depois o link. Limites: WhatsApp 1.000, IFTTT 1.000, Slack 3.000, Teams 3.000, Telegram 3.500, webhook
  4.000 caracteres.
- Em uma repetição da política, o texto diz `(repeat N)`.

Os textos das mensagens incluem o título e a descrição do alerta. Não coloque segredos ou dados pessoais em títulos de
eventos se eles forem enviados a terceiros.

## Regras de notificação e urgência

Cada pessoa tem **métodos de contato** e **regras de notificação** (Teams → pessoa → Contact methods). Uma regra diz:
"para incidentes de prioridade Px ou mais urgentes, use este método após N minutos a partir do momento em que o passo
dispara". Um passo de escalonamento também pode **forçar canais**, o que substitui as regras pessoais naquele passo.

Durante as **quiet hours** de uma equipe no modo *low urgency*, somente Slack, Teams, Telegram, IFTTT e webhook são
usados. SMS, voz e WhatsApp são ignorados.

## Testando um provedor

**Integrations → Outbound → provedor → Send test** envia uma mensagem para o endereço que você digitar,
pelo mesmo código que o motor usa (função do app `engine-run` com `reason: "test"`). O resultado (enviado, ou o erro do
provedor) aparece na hora. Teste cada canal que você ativar, de ponta a ponta, antes de depender dele.

## O que foi verificado

| Provedor | Status |
| --- | --- |
| Webhook genérico | ✅ Verificado ao vivo em um ambiente trial: escalonamentos e testes entregues, resultados gravados no registro (ledger) |
| Custom workflow | ✅ Verificado ao vivo em um ambiente trial: um teste e um escalonamento agendado executaram o workflow, que entregou o JSON completo da notificação ao receptor |
| Integration workflows | ✅ Verificado ao vivo em um ambiente trial com o webhook genérico: o motor executou *Command Center · Generic webhook*, a ação dele leu o provedor e o segredo do vault e entregou; um erro do provedor (HTTP 429) fez a execução do workflow falhar com a mensagem do provedor |
| Twilio SMS, voz, WhatsApp, IFTTT, Slack, Microsoft Teams, Telegram | Implementados a partir da documentação da API de cada fornecedor, **não exercitados ao vivo** (sem contas no ambiente de teste). Testes unitários cobrem as requisições de Twilio SMS e voz, Slack e Telegram. Teste cada provedor com *Send test*. |

Respostas bidirecionais (reconhecer respondendo a um SMS ou a uma mensagem de chat) não estão implementadas. Reconheça
no Console.
