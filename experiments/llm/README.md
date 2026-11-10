# Assignment 09 A — Python SDK chat experiment

A small terminal script that talks to the school's OpenAI-compatible
Qwen endpoint with the Python OpenAI SDK. It explains the BuildShift
game (rules, controls, objectives) in a short conversation, using the
current game docs/source as the basis for its system prompt.

Files:

- `chat.py` — the chat script.
- `requirements.txt` — pinned dependency manifest (`openai==3.26.0`,
  the school guide's reference version).
- `selftest_offline.py` — offline check with a mocked model client
  (no network, no key, no live request).

## Run it (in your own terminal)

From the game repository root:

```bash
# 1. Create the isolated environment once (kept out of Git via .gitignore)
python3 -m venv .venv-llm

# 2. Activate it and install the SDK
source .venv-llm/bin/activate
python -m pip install -r experiments/llm/requirements.txt

# 3. Load your private key into this terminal session (do it yourself,
#    never paste the key into a file, chat, or Git)
export VIVES_LLM_API_KEY="$(cat "$HOME/.config/ai-operations/vives-llm-key")"

# 4a. One request, no history:
python experiments/llm/chat.py --once

# 4b. Interactive conversation (retained context, /quit to exit):
python experiments/llm/chat.py
```

## Behaviour

- `--once` makes exactly one request (system prompt + one question) and
  exits. Use `--question "..."` to change the question.
- Without `--once` the script runs an
  interactive loop. Each request re-sends the system prompt plus the
  retained earlier user/assistant turns, so follow-up questions work.
  The retained turn history is bounded (at most 20 user/assistant
  messages; oldest dropped first), while the system prompt is always
  retained.
- A turn is stored in history only when the request succeeds and the
  model returns a complete answer (`finish_reason == "stop"` with
  non-empty content). Failed or cut-off replies are shown as errors
  and are not stored.
- Connection settings are fixed to the school endpoint:
  `base_url=https://api.llm.mechatronics.be/v1`, model `qwen3.8-27b`,
  `timeout=60.0`, `max_retries=0`, `reasoning_effort="low"`,
  `max_tokens=2048` (the output budget also covers the model's
  thinking).

## Error messages

- Missing `VIVES_LLM_API_KEY` → the script says the variable is not set
  for this terminal and how to load it privately. The key is never
  printed, stored, or committed.
- HTTP/authentication or network failure → the request failure type is
  shown with a hint to check the connection and the key's model access.
- Incomplete answer → the script reports the `finish_reason` and does
  not store the turn.

## Offline check

```bash
source .venv-llm/bin/activate   # any Python 3.11+ works; openai optional
python experiments/llm/selftest_offline.py
```

The self-test mocks the model client, so it needs neither a network
connection nor an API key.
