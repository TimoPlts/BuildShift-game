#!/usr/bin/env python3
"""Offline self-test for ``chat.py`` — no network, no API key, no live request.

Mocks the OpenAI SDK client with a fake that records every request and
returns canned responses. Verifies:

1. ``make_client`` uses the required connection settings and raises a
   helpful, leak-free error when the key is missing.
2. ``--once`` makes exactly one request (system prompt + question) with
   the required model/reasoning/token parameters.
3. Interactive mode retains the system prompt and earlier turns, bounds
   the history, and never stores a failed or incomplete turn.

Run:  python experiments/llm/selftest_offline.py
Works with or without the real ``openai`` package installed: if missing,
a stub module is injected so ``from openai import OpenAI`` resolves.
"""

from __future__ import annotations

import builtins
import contextlib
import io
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import openai  # noqa: F401
except ImportError:
    openai = types.ModuleType("openai")
    openai.OpenAI = object  # replaced per test
    sys.modules["openai"] = openai

import chat  # noqa: E402


class FakeChoice:
    def __init__(self, content, finish_reason):
        self.message = types.SimpleNamespace(content=content)
        self.finish_reason = finish_reason


class FakeClient:
    """Records requests; returns scripted replies in order."""

    def __init__(self, replies):
        self.requests = []
        self.replies = list(replies)
        self.chat = types.SimpleNamespace(
            completions=types.SimpleNamespace(create=self._create)
        )

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return types.SimpleNamespace(
            choices=[
                FakeChoice(
                    reply.get("content", ""),
                    reply.get("finish_reason", "stop"),
                )
            ]
        )


def make_fake_openai(fake_client):
    """Return an OpenAI substitute that records ctor kwargs."""

    class FakeOpenAI:
        def __init__(self, **kwargs):
            FakeOpenAI.kwargs = kwargs
            self.client = fake_client

    # chat.make_client does `from openai import OpenAI` then
    # `OpenAI(base_url=..., api_key=..., timeout=..., max_retries=...)`.
    return FakeOpenAI


def run_scripted_interactive(fake, script, fn=chat.run_interactive, **kwargs):
    """Run an interactive fn with `script` as the stdin lines."""
    iterator = iter(script)
    saved_input = builtins.input

    def fake_input(prompt=""):
        return next(iterator)

    builtins.input = fake_input
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            fn(**kwargs)
    finally:
        builtins.input = saved_input
    return out.getvalue()


class ClientFactoryTests(unittest.TestCase):
    def test_connection_settings(self):
        fake = FakeClient([])
        FakeOpenAI = make_fake_openai(fake)
        openai.OpenAI = FakeOpenAI
        os.environ["VIVES_LLM_API_KEY"] = "placeholder-not-a-real-secret"
        chat.make_client()
        kwargs = FakeOpenAI.kwargs
        self.assertEqual(kwargs["base_url"], "https://api.llm.mechatronics.be/v1")
        self.assertEqual(kwargs["timeout"], 60.0)
        self.assertEqual(kwargs["max_retries"], 0)
        self.assertEqual(kwargs["api_key"], "placeholder-not-a-real-secret")

    def test_missing_key_is_helpful_and_leaks_nothing(self):
        saved = os.environ.pop("VIVES_LLM_API_KEY", None)
        try:
            with self.assertRaises(chat.ChatError) as ctx:
                chat.make_client()
        finally:
            if saved is not None:
                os.environ["VIVES_LLM_API_KEY"] = saved
        message = str(ctx.exception)
        self.assertIn("VIVES_LLM_API_KEY", message)
        self.assertIn("not set", message)
        # No credential material, no full environment dump.
        self.assertNotIn("placeholder", message.lower())


class OnceModeTests(unittest.TestCase):
    def test_exactly_one_request_with_required_params(self):
        fake = FakeClient([{"content": "You win rounds by knock-out."}])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            chat.run_once("How do I win?", client=fake)
        self.assertEqual(len(fake.requests), 1)
        req = fake.requests[0]
        self.assertEqual(req["model"], "qwen3.8-27b")
        self.assertEqual(req["reasoning_effort"], "low")
        self.assertEqual(req["max_tokens"], 2048)
        self.assertEqual(req["messages"][0]["role"], "system")
        self.assertIn("BuildShift", req["messages"][0]["content"])
        self.assertEqual(req["messages"][1], {"role": "user", "content": "How do I win?"})
        self.assertIn("You win rounds by knock-out.", out.getvalue())

    def test_incomplete_answer_rejected(self):
        fake = FakeClient([{"content": "", "finish_reason": "length"}])
        with self.assertRaises(chat.ChatError):
            chat.complete(fake, [{"role": "user", "content": "hi"}])


class InteractiveTests(unittest.TestCase):
    def test_history_retained_bounded_and_trimmed(self):
        n = chat.MAX_HISTORY_MESSAGES
        fake = FakeClient([{"content": f"answer {i}"} for i in range(n + 3)])
        script = [f"q{i}" for i in range(n + 3)] + ["/quit"]
        out = run_scripted_interactive(fake, script, client=fake)

        self.assertEqual(len(fake.requests), n + 3)
        for req in fake.requests:
            self.assertEqual(req["messages"][0]["role"], "system")
        # Follow-up request re-sends the earlier turn.
        second = fake.requests[1]["messages"]
        self.assertEqual(second[1], {"role": "user", "content": "q0"})
        self.assertEqual(second[2], {"role": "assistant", "content": "answer 0"})
        self.assertEqual(second[3], {"role": "user", "content": "q1"})
        # Final request is bounded: system + MAX_HISTORY_MESSAGES + current question.
        last = fake.requests[-1]["messages"]
        self.assertEqual(len(last), 2 + n)
        self.assertEqual(last[-1], {"role": "user", "content": script[-2]})
        self.assertIn("answer 0", out)

    def test_failed_and_incomplete_turns_not_stored(self):
        fake = FakeClient([
            Exception("connection refused"),            # request failure
            {"content": "", "finish_reason": "length"},  # cut-off answer
            {"content": "ok answer"},                    # success
        ])
        out = run_scripted_interactive(fake, ["q1", "q2", "q3", "/quit"], client=fake)

        self.assertIn("error:", out)
        self.assertEqual(len(fake.requests), 3)
        final = fake.requests[-1]["messages"]
        # Only the successful turn plus the new question are in history.
        self.assertEqual(final[1], {"role": "user", "content": "q3"})
        contents = [m["content"] for m in final]
        self.assertNotIn("q1", contents)
        self.assertNotIn("q2", contents)

    def test_quit_and_eof_end_cleanly(self):
        fake = FakeClient([])
        out = run_scripted_interactive(fake, ["/quit"], client=fake)
        self.assertEqual(fake.requests, [])
        self.assertIn("BuildShift game chat", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
