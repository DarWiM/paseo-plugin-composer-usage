# paseo-plugin-composer-usage

A [Paseo](https://paseo.sh) plugin that puts each agent's plan usage limits back into the
composer: a pill next to Tasks and Subagents shows the windows the agent's model spends, for
example `5h 16% · wk 86%`, and opens every window of that provider with its reset time.

Paseo 0.9 and 0.10 showed provider usage in the context-window tooltip. Paseo 0.11 moved it to the
Usage screen and the sidebar footer, so this plugin brings the per-agent view back, for every
provider that has a usage report, including multi-provider harnesses such as
[Oh My Pi](https://github.com/can1357/oh-my-pi) (`omp`) and Pi.

| Agent                                | Pill                                      |
| ------------------------------------ | ----------------------------------------- |
| Claude, `claude-opus-5-5`            | `5h 16% · wk 86%`                         |
| Claude, `claude-fable-5-1`           | `5h 16% · wk 86% · wk Fable 33%`          |
| Codex                                | `5h 5% · wk 41%`                          |
| omp, `zai/glm-5.3`                   | `5h 56% · wk 53%`                         |
| omp or Pi on Antigravity, Gemini     | Gemini quota: `5h 15% · wk 25%`           |
| omp on Antigravity, Claude or GPT    | Claude & GPT quota: `5h 100% · wk 33%`    |
| a provider without a usage report    | no pill                                   |

The dot takes the warning or danger color as a window approaches its limit.

## Requirements

- **Paseo 0.10 or later** on the daemon and on every app you connect from.
- Plugins enabled on the daemon (**Settings → Plugins → Enable plugins**).
- For `omp` limits, the [`paseo-plugin-omp-usage`](https://github.com/DarWiM/paseo-plugin-omp-usage)
  plugin, which needs a Paseo 0.11 daemon. Without it, `omp` agents on Claude or Codex backends still
  get the built-in Claude and Codex reports.

## Install

```bash
paseo plugin install github:DarWiM/paseo-plugin-composer-usage
paseo plugin ls   # composer-usage should be "running"
```

Or paste `github:DarWiM/paseo-plugin-composer-usage` into **Settings → Plugins → Plugin source**.
Update with `paseo plugin update composer-usage`.

## How it works

- **Data.** The client reads `paseo.providers.listUsage()`, the usage list Paseo already builds from
  its built-in sources (Claude, Codex, Copilot, Cursor, Z.ai, …) and from usage-source plugins. One
  request serves every pill; it refreshes every minute, when an agent's turn ends, and from the
  Refresh button in the popover. Paseo caches reports for five minutes, so Refresh may return the
  cached list; the refresh button on the Usage screen bypasses that cache.
- **Agent → report.** Claude and Codex agents use the report with the same provider ID. `omp` and Pi
  agents run `<backend>/<model>` models, so the backend picks the report: `zai/…` reads `omp-zai`,
  `google-antigravity/…` reads `omp-google-antigravity`, `anthropic/…` reads `claude`,
  `openai-codex/…` reads `codex`. Edit `HARNESS_BACKENDS` in `client/matchReport.ts` to change it.
- **Windows.** The pill shows the provider's summary windows plus model-specific windows whose name
  matches the model, such as `Weekly · Fable` for Fable models or the Gemini quota for Gemini models.
  On a Paseo 0.10 app, which drops `summary` and `shortLabel` from reports, the pill falls back to the
  Session and Weekly windows and derives `5h` / `wk` from their names.
- **Diagnostics.** A small server entry writes client events to the plugin log, because mobile apps
  have no console you can read:

  ```bash
  paseo plugin logs composer-usage
  # [client] started: ios
  # [client] usage ok: claude/available, codex/available, …: 113 of 113 pills visible
  ```

## Known limitations

- Paseo does not tell a client which account a session spends, so with several accounts on one
  provider the pill shows the first available report.
- Paseo has no usage source for Pi's own Antigravity login, so Pi's Antigravity agents show the `omp`
  Antigravity report. The numbers match only when both are logged in to the same Google account.
- The pill sits next to the context-window meter; plugins cannot extend that tooltip itself.

## Development

```bash
npm install            # SDK, React and React Native types; Paseo provides them at runtime
npm run typecheck      # against SDK 0.10.3, the oldest supported version
npm run check:hermes   # build the client bundle like the daemon and parse it with Hermes
paseo plugin install "$PWD"
paseo plugin reload composer-usage
```

Keep `class` out of client code. Paseo compiles plugin client bundles for ES2020 without Metro, and
the mobile app evaluates them with Hermes, which rejects `class` there: the plugin then shows
`failed` with `Invalid expression encountered` on the phone while the desktop app works
([getpaseo/paseo#5783](https://github.com/getpaseo/paseo/issues/5783)). `npm run check:hermes`
catches this before you reload.

## License

[MIT](LICENSE)
