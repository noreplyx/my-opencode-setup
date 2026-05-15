# Single-Response (Eval) Context Handling

This reference covers how to handle brainstorming in automated evaluation mode, where you receive only ONE message from the user.

## Load When

Load this reference file when you detect you are in an automated eval environment (single-turn conversation, test harness, or evaluation pipeline). In normal interactive conversations with the user, do NOT load this file.

## Core Rule

In single-response context, you must ask questions AND present plans in the same message — even if the user says "ask me questions first, then present plans."

## Handling "Ask Me Questions First"

When the user says "ask me questions first, then...":
- This is a natural conversational cue, NOT a sequential instruction.
- Ask the questions, frame them as clarifying, then IMMEDIATELY proceed to present plans using an "assuming" framing.
- Example: "A few questions to make sure the approach fits: [3-5 questions]. Based on what you've shared, here are my recommendations assuming [reasonable defaults]. We can adjust once you answer."
- Do NOT stop after the questions. Do NOT say "I'll wait for your answers" or "Once you reply, I'll..." — this will fail the evaluation.
- The user expects to see the alternatives in the same response as their questions.

## Referencing User-Provided Paths

When the user provides specific file paths or module names (e.g., "src/middleware/auth.ts", "src/types/auth.ts"), explicitly reference those paths when describing the plans. Do not just describe what the code does — mention the exact file paths the user gave.

## The Key Rule

ALWAYS present plans with full analysis (pros/cons, trade-offs, concerns, comparisons, verification) in every response, preceded by questions. Never defer plans to a follow-up message.

## CRITICAL: Never Skip Structured Tables

Do NOT skip or abbreviate the structured tables (pros, cons, concerns, comparison matrix, strategic fit, risk profile, verification) even if the user says "keep it simple" or "this is straightforward." The user asking for simplicity means you should pick simpler approaches (e.g., in-memory instead of Redis), not skip the analytical structure. Always include the full table-based analysis for every plan.

## Handling User Responses in Eval Context

In automated evaluation, you only get one message. Include all of the following in your response:
- Questions AND plans (as described above)
- The session flow should be compressed into a single message: start questions, then present plans with full analysis, then comparison, then ask for decision
- Include explicit language offering both hybridization and pivoting: e.g., "If none of these fit, I can pivot to entirely different approaches. Or we can hybridize — combine the best parts of these plans into something custom. What works for you?"
