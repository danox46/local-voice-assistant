---
title: "Building a Local Voice Assistant That Can Work With Codex"
description: "A first look at the local voice wrapper, the model flow behind it, and the response-sanitizing layer that keeps spoken answers practical."
status: "ready-for-website"
date: "2026-06-02"
audience: "Dani En Remoto website visitors, technical clients, and internal collaborators"
---

# Building a Local Voice Assistant That Can Work With Codex

This is one of the projects currently on the Dani En Remoto table: a local voice assistant that lets a person talk naturally to a coding agent while it works inside a real project folder. The goal is simple: make the computer easier to direct while still keeping the work concrete, visible, and editable.

This is an experiment, not a real product. We are sharing what we are testing, what works, what breaks, and what we learn. It also sits near the bridge toward AUTOMATED & CO, because the same questions show up there: clearer systems, practical automation, and workflows that help real work move.

Instead of typing every instruction, the user can dictate what they want done. The voice wrapper turns that spoken request into text, sends it into the assistant workflow, and reads back a practical summary of what happened. That makes the loop faster for project work, especially when the user is thinking out loud or wants to keep moving without switching context.

## What It Does Today

The current version already supports a real working loop:

- The user speaks a request.
- The wrapper captures the dictated instruction.
- The assistant works in the active project directory.
- The assistant can inspect files, update code, and run checks when needed.
- The spoken response is shortened so it is useful to hear out loud.

One important improvement we added is response sanitizing. When the assistant mentions local files, the voice layer no longer has to read a long full path out loud. For speech, a path like a deeply nested Windows project file can be reduced to the filename. The full path still exists in the transcript when it is needed, but the spoken response stays clean and human.

## The Model Flow

The assistant uses one main model interaction to understand the dictated request, reason about the project, and decide what work needs to happen. That same model can handle practical project instructions, coding steps, summaries, and translation-style interpretation of rough dictated language into a clearer working instruction.

Around that model, we are adding local layers that make the experience better:

- A voice capture layer for spoken input.
- A response sanitizer for spoken output.
- A project execution layer that keeps work tied to the current folder.
- A transcript trail so details are still available when the spoken version is intentionally short.

That separation matters. The model can stay focused on doing the work, while the wrapper handles the details that make voice interaction comfortable.

## Why The Sanitizer Matters

Voice output has different rules than text output. A written answer can include a complete path, command, or stack trace. A spoken answer should usually avoid reading every character unless the user asks for that detail.

The sanitizer helps by turning noisy technical references into speech-friendly language. For example, instead of reading a full local path, the assistant can say only the file name. That keeps the spoken summary understandable while preserving the exact technical detail in the full transcript.

This is the kind of small product decision that makes a voice-controlled coding workflow feel usable in real life.

## Where This Is Going

The near-term plan is to keep testing the prototype as part of the Dani En Remoto project table. The important direction is not just voice input. It is a complete workflow where the user can talk through priorities, have the assistant make changes, and then hear a concise status update without losing the underlying technical record.

Planned improvements include:

- Better spoken summaries after longer tasks.
- More predictable handling of project status and interruptions.
- Clearer publication and handoff content for the Dani En Remoto website.
- Future social content based on real tested behavior after the project story is clearer.

For now, the priority is to publish the project story early: what we have built, how it works, and why voice plus a careful response layer can make AI-assisted remote work feel more natural.
