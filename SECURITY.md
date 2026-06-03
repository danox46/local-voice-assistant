# Security

This project is a local-first development tool. It can run local CLIs and, in Codex execute mode, background workers may edit files inside `CODEX_WORKDIR`.

## Keep In Mind

- Do not expose the Express API directly to the public internet.
- Keep `OPENAI_API_KEY`, Gemini login state, and Codex credentials local.
- Review `CODEX_WORKDIR` before using execute mode.
- Use plan mode when you want read-only worker sessions.
- Treat browser speech transcripts and `work/` session files as private local data.

## Reporting

Please open a private report or contact the maintainer before publishing exploitable issues.
