#!/usr/bin/env python3
"""Assignment 09 A — BuildShift LLM chat experiment.

A small terminal chat that talks to the school's OpenAI-compatible
Qwen endpoint (``https://api.llm.mechatronics.be/v1``) through the
Python OpenAI SDK. It answers questions about the BuildShift game
using a system prompt that carries the game's rules, controls and
objectives.

Usage (from the game repository root, inside the experiment venv):

    python experiments/llm/chat.py --once            # exactly one request
    python experiments/llm/chat.py                   # interactive chat
    python experiments/llm/chat.py --once --question "How do I move?"

The API key is read from the environment variable ``VIVES_LLM_API_KEY``.
Load it privately in your own terminal (see ``experiments/llm/README.md``);
never put it in a file, commit it, or print it.

Behaviour:
- The system prompt (game rules) is always the first message of every
  request; the assistant never sees anything else about the game.
- In interactive mode, earlier user/assistant turns are re-sent with
  each request (retained follow-up context), bounded to at most
  ``MAX_HISTORY_MESSAGES`` non-system messages (oldest dropped first).
- Only complete, successful replies (``finish_reason == "stop"`` with
  non-empty content) are stored in the conversation history.
- ``/quit`` (or ``/exit``, or Ctrl-D/Ctrl-C) ends the chat.
"""

from __future__ import annotations

import argparse
import sys

# ───────────────────────────── school connection ─────────────────────────────

BASE_URL = "https://api.llm.mechatronics.be/v1"
MODEL = "qwen3.8-27b"
REASONING_EFFORT = "low"
MAX_TOKENS = 2048  # output budget, includes the model's thinking
TIMEOUT_SECONDS = 60.0
MAX_RETRIES = 0  # exactly one attempt per request

API_KEY_ENV_VAR = "VIVES_LLM_API_KEY"

# Bound the retained follow-up context: at most this many user/assistant
# messages are re-sent after the system prompt (oldest dropped first).
MAX_HISTORY_MESSAGES = 20

# ─────────────────────── BuildShift system prompt ─────────────────────────────
# Facts below come from the current game docs and shared configuration
# (packages/game-config, apps/web controls, packages/protocol match
# lifecycle). Keep it truthful: the model only knows what is sent here.

SYSTEM_PROMPT = """\
You are the in-game explanation chat for BuildShift, a competitive
two-player, server-authoritative multiplayer browser building shooter
with a third-person character.

Explain the game to players in short, friendly answers. Use only the
information below. If the supplied rules do not answer a question,
say so instead of guessing.

Objective (Energy Box Fights):
- Fight the other player and win rounds to win the match. You win the
  match by winning 3 rounds first.
- You win a round when the opponent's health reaches zero, or when the
  90-second round timer expires you are still standing (a time-expired
  round is won by the player with the higher health; equal health is a
  deterministic tie-break). If you are completely inactive for 30
  seconds the round is lost on anti-stall timeout.

Movement:
- W/A/S/D move forward/back/left/right; Space jumps; C crouches
  (crouching slows you down and lowers your character so you can fit
  under low openings such as half-walls). The camera is third-person.

Combat:
- You have 100 health and 50 shield. Fire with the left mouse button.
- Two hitscan weapons, switched with 1 and 2:
  * Assault rifle (slot 1): 20 damage per hit, up to 60 m range,
    30-round magazine with 60 reserve, fast fire rate.
  * Shotgun (slot 2): very heavy damage at close range (up to 15 m),
    5-round magazine with 20 reserve, one shot every ~1.2 s.
- R reloads. Reloads take time, so reload before you run dry.

Building:
- Building is limited by a regenerating Energy resource, not unlimited
  spam. Your pool holds 100 energy, you start a round at 100, and it
  regenerates at about 30 energy per second.
- Placements snap to a modular grid, must be within 12 m of you, and
  live inside the ~30 m x 30 m arena (up to three layers high).
- Structure costs: wall 10 energy, ramp 8, cone 6, floor 5.
  Walls block movement and fire, floors give you platforms, ramps let
  you climb a layer, cones are small fixtures.
- Default piece binds: mouse button 4 = wall, Q = floor,
  mouse button 5 = ramp, F = cone; X rotates left, R rotates right in
  build mode. You can place at most one structure every third of a
  second.

Editing:
- Press E to edit a structure: you can cut openings such as doors,
  windows, or top/bottom halves into a wall. Confirm with Enter;
  right mouse (or T/Backspace) resets the local edit draft.

Keep answers short (a few sentences) and aimed at a first-time player
playing right now.
"""

# ───────────────────────────────── helpers ────────────────────────────────────


class ChatError(Exception):
    """A user-facing chat failure (message is safe to display)."""


def make_client():
    """Create the OpenAI-compatible client for the school endpoint.

    Raises ``ChatError`` with a helpful message when the key is missing.
    The key value itself is never printed or stored anywhere.
    """
    import os

    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover - environment problem
        raise ChatError(
            "The OpenAI SDK is not installed in this environment. "
            "Activate the experiment venv and install requirements: "
            "see experiments/llm/README.md."
        ) from exc

    api_key = os.environ.get(API_KEY_ENV_VAR, "")
    if not api_key:
        raise ChatError(
            f"{API_KEY_ENV_VAR} is not set for this terminal. Load your "
            "private key yourself (for example: export "
            f"{API_KEY_ENV_VAR}=\"$(cat \"$HOME/.config/ai-operations/"
            "vives-llm-key\")\") and run the script again. Do not paste "
            "the key into files or chat."
        )

    return OpenAI(
        base_url=BASE_URL,
        api_key=api_key,
        timeout=TIMEOUT_SECONDS,
        max_retries=MAX_RETRIES,
    )


def complete(client, messages) -> str:
    """Send one chat request and return the complete reply text.

    Raises ``ChatError`` on any failure or incomplete answer; callers
    must not store such a turn in the conversation history.
    """
    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            reasoning_effort=REASONING_EFFORT,
            max_tokens=MAX_TOKENS,
        )
    except Exception as exc:
        # Never echo raw exception text: an SDK exception can carry
        # arbitrary upstream body text that may include credentials.
        # Keep only the exception type and a network/auth hint; the
        # original exception stays attached as __cause__ for offline
        # debugging (it is never printed by this script).
        raise ChatError(
            f"The model request failed ({type(exc).__name__}). Check your "
            f"network connection and that your personal key has access to "
            f"{MODEL}."
        ) from exc

    if not response.choices:
        raise ChatError("The model returned no choices. Try again.")

    choice = response.choices[0]
    content = (choice.message.content or "").strip()
    if choice.finish_reason != "stop" or not content:
        raise ChatError(
            "No complete answer "
            f"(finish_reason={choice.finish_reason!r}). The output limit "
            "may have been reached, including the model's thinking; "
            "please try again."
        )
    return content


def build_messages(history) -> list[dict[str, str]]:
    """System prompt first, then the retained conversation history."""
    return [{"role": "system", "content": SYSTEM_PROMPT}, *history]


def trim_history(history) -> list[dict[str, str]]:
    """Keep at most MAX_HISTORY_MESSAGES non-system messages (newest)."""
    if len(history) <= MAX_HISTORY_MESSAGES:
        return history
    return history[-MAX_HISTORY_MESSAGES:]


# ─────────────────────────────── modes ────────────────────────────────────────

DEFAULT_QUESTION = "What am I trying to achieve in BuildShift, and how do I win a round?"


def run_once(question: str, client=None) -> None:
    """Make exactly one request and print the answer."""
    client = client or make_client()
    messages = build_messages([{"role": "user", "content": question}])
    try:
        answer = complete(client, messages)
    except ChatError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print(answer)


def run_interactive(client=None) -> None:
    """Interactive conversation with retained, bounded follow-up context."""
    client = client or make_client()
    history: list[dict[str, str]] = []

    print("BuildShift game chat. Ask anything about the rules, controls or")
    print("objectives. Type /quit (or press Ctrl-D) to exit.")

    while True:
        try:
            question = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not question:
            continue
        if question in ("/quit", "/exit"):
            break

        messages = build_messages(
            history + [{"role": "user", "content": question}]
        )
        try:
            answer = complete(client, messages)
        except ChatError as exc:
            # Failed/incomplete turn: show the problem, store nothing.
            print(f"error: {exc}")
            continue

        history = trim_history(history + [
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer},
        ])
        print(f"chat> {answer}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="BuildShift LLM chat experiment (school Qwen endpoint)."
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="make exactly one request and exit (no conversation history)",
    )
    parser.add_argument(
        "--question",
        default=DEFAULT_QUESTION,
        help="question to send with --once (default: a match-goal question)",
    )
    args = parser.parse_args(argv)

    try:
        if args.once:
            run_once(args.question)
        else:
            run_interactive()
    except ChatError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
