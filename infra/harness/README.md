# DeepSeek Harness runtime pin

Research Workbench uses DeepSeek Harness as an external execution runtime through
`@deepseek-ai/dsh-sdk-client`. The scientific control plane never imports
Harness core packages.

## Version pin

`version.env` records both the reviewed source commit and the SDK package
version. Updating either value is a dependency change that requires a dedicated
review and the Harness contract/smoke tests.

The reviewed source is the user's fork:

- repository: `bxbdndhfjfbdj2-creator/deepseek-harness`
- source commit: `4878cdabd87d4041bdaff61d04c966883b9fd07a`
- SDK client: `@deepseek-ai/dsh-sdk-client@0.2.0-rc.1`

## Runtime configuration

The worker must provide an explicit `RW_DSH_BIN` path to the pinned
`@deepseek-ai/dsh` CLI module. The adapter also uses a dedicated `DSH_HOME`
location and passes `infra/harness/workbench.cordis.yml` as a launch patch.

The SDK child environment is replaced rather than inherited. Only deployment
variables present in the configured environment allowlist are copied. The
adapter then adds non-secret policy variables:

- `DSH_PERMISSION_MODE`
- `DSH_TELEMETRY_MODE=DISABLED`
- `RW_TOOL_ALLOWLIST`
- `RW_SUBAGENT_ALLOWLIST`

The patch disables model-facing tool families not allowed for the Run. The
sandbox remains the final file-effect boundary. `danger-full-access` is
rejected unless the deployment explicitly opts in.

Secrets such as `DEEPSEEK_API_KEY` may cross the process boundary only through
the explicit runtime environment allowlist. Their values are never written to
AgentContextSnapshot, ResearchEvent, or HarnessSessionReference.

## Smoke test

`tests/integration/harness-sdk-smoke.test.ts` always validates durable session
reference generation. The real Harness smoke case is skipped unless both
`DEEPSEEK_API_KEY` and `RW_DSH_BIN` are present.
