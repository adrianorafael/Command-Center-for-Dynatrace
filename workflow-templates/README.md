# Workflow templates

| File | What it is |
| --- | --- |
| `command-center-engine.workflow.json` | The **Command Center · Engine** workflow: a **simple workflow** with one task, the app action `my.command.center:run-engine`, on an interval trigger (1 minute in this file). Generated from `ui/app/data/workflows/definition.ts` by `node scripts/gen-workflow-templates.mjs`; a unit test fails if it drifts. Do not edit it by hand. |
| `command-center-alert-simulator.workflow.json` | **For trial or test environments only.** A standard workflow that posts one or two synthetic `[SIM] …` alerts every 7 minutes through the relative path `/platform/classic/environment-api/v2/events/ingest` (authenticated as the workflow actor). As a standard workflow it consumes workflow hours. Never import it into production. |

## Installing the engine

The app cannot create workflows (`automation:workflows:write` is reserved for apps provided by Dynatrace), so use one
of these:

1. **Command Center → Integrations → Workflows → Install in Workflows**: the Workflows app opens with the workflow
   filled in; review and deploy it. The documented intent payload has no workflow type: if the status then says
   *standard workflow*, delete it and use option 2 or 3.
2. **Download JSON** on the same page (generated for your app ID and interval), then **Upload** it in the Workflows
   app. The file carries `"type": "SIMPLE"`.
3. **Admin script** with a platform token that has `automation:workflows:read` and `automation:workflows:write`:

   ```bash
   DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com \
   DT_PLATFORM_TOKEN=YOUR-PLATFORM-TOKEN \
   node scripts/install-workflow.mjs --app-id my.command.center --interval 1 [--actor <service-user-uid>] [--dry-run]
   ```

   Idempotent: update if it exists, restore it from the trash, otherwise create it. Verified on a trial environment.

If you changed the app ID, the action ID changes with it (`<appId>:run-engine`): generate the JSON from the app or
pass `--app-id`.

The full setup (actor permissions, Credential Vault, External requests) is in
[docs/guides/en/getting-started.md](../docs/guides/en/getting-started.md).
