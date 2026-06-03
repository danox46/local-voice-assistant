# Contributing

Thanks for taking a look at Local Voice Assistant.

## Development

```bash
npm install
npm run dev
```

The web client runs at `http://127.0.0.1:5173` and proxies API calls to the local Express server at `http://127.0.0.1:8787`.

## Checks

Run both checks before opening a pull request:

```bash
npm test -- --run
npm run build
```

## Guidelines

- Keep API keys and local session state out of commits.
- Keep `work/`, `dist/`, logs, screenshots, and audio captures as generated local artifacts.
- Prefer small, focused changes with tests for routing, persistence, playback, and provider behavior.
- Do not enable always-listen, wake phrase, Home Assistant webhooks, or shell-executing integrations without clear safety controls and documentation.
