# Website Publication Handoff

## Destination

Dani En Remoto website.

Live target: `https://danienremoto.com/`

This handoff is not the publication destination. It is the source packet for the managed Dani En Remoto website workflow.

## Recommended Page Type

Blog post or publication article under the "Proyectos en la mesa" / process-notes track.

## Suggested Slug

`local-voice-assistant-codex-workflow`

## Source Draft

`local-voice-assistant-first-post.md`

## Summary

This article introduces the local voice assistant as a Dani En Remoto experiment from the current project table. It explains the voice-to-Codex workflow, connects the test to practical remote-work systems, and highlights the response sanitizer that keeps spoken output short by saying file names instead of full local paths.

## Suggested Excerpt

From the Dani En Remoto project table: a local voice assistant experiment that lets a user talk naturally to a coding agent while it works inside a real project folder. The current prototype captures dictated instructions, lets the assistant make project changes, and uses a speech-friendly response sanitizer so spoken summaries stay practical.

## Publish Notes

- Place this as part of Dani En Remoto's public process, not as a separate commercial product.
- Use the existing site language and IA: "Esta semana sobre la mesa", "Proyectos en la mesa", and notes from real work.
- Keep the article focused on the working prototype and what exists now.
- Do not overpromise future automation.
- Mention that full technical details remain available in the transcript.
- Mention AUTOMATED & CO only as a related systems/automation bridge, not as the owner of the experiment.
- Use this as an early project-table note before planning social media content.

## Required Workflow

1. Confirm the Dani En Remoto website source repo is mounted and selected.
2. Use the Webmaster Astro blog/publication implementation workflow to add this content to the site source.
3. Add the article as a Dani En Remoto note or project-table entry, not as a separate microsite or local preview page.
4. Build and QA the website locally.
5. Only then move to campaign/social/CRM staging work.

## Current Blocker

The current voice-assistant workspace contains the local app and this publication packet, but it does not contain the Dani En Remoto website source. A nearby `C:\Users\danox\Documents\danienremoto` folder only contains logo assets, not an Astro/site repo. Until the real site repo is mounted or selected, the correct action is to prepare a Webmaster-ready handoff and stop before claiming the page was added to the live website.
