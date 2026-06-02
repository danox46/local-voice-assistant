# Dani En Remoto Publication Process Diagnosis

Date: 2026-06-02

## What Went Wrong

The content was treated as a local publication package instead of a campaign item that must enter the Dani En Remoto website workflow. The files in this folder are useful as source material, but they are not the managed website and should not be described as if they published the content to `danienremoto.com`.

The missing step is the handoff from campaign/content preparation into Webmaster implementation. Once a website article is marked ready, the process must switch to the Dani En Remoto site repo and use the site's existing structure.

## Confirmed Site Context

The live homepage at `https://danienremoto.com/` already frames the brand around:

- "Esta semana sobre la mesa"
- "Proyectos en la mesa"
- notes from real work
- a bridge toward AUTOMATED & CO

That means this voice-assistant story belongs as a Dani En Remoto experiment/note in that structure, not as a standalone local HTML publication page.

## Correct Workflow

1. Campaign/strategy context: confirm the brand, audience, project-table framing, and campaign purpose.
2. Content Creator: produce the article draft and any social copy as content artifacts.
3. Webmaster: implement the ready website article inside the Dani En Remoto site source.
4. Website QA: build the site, inspect the generated route, and verify the content appears in the intended section.
5. Campaign Planner/CRM Expert: only after the website URL exists, prepare social or Zoho staging packets that point to the real page.

## Guardrails For Future Voice Turns

- If the user says "put this on the Dani En Remoto website", first locate the website source repo.
- If the repo is not in the current workspace, say that plainly and create a Webmaster-ready handoff instead of making a standalone page.
- Do not call local preview files "published" or "on the website".
- Keep AUTOMATED & CO secondary unless the user asks for that project specifically.
- Use Spanish site IA and brand framing when writing website-facing copy.

## Current State

Ready source files exist in this folder:

- `local-voice-assistant-first-post.md`
- `website-publication-handoff.md`
- `danny-remoto-experiment-publish-pack.md`

The Dani En Remoto website source repo was not found in this working directory. `C:\Users\danox\Documents\danienremoto` contains only logo files, so it is not enough to implement or verify the website article.
