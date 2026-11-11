# Assignment 09 — AI Guide (operator / student instructions)

Status: **automated final validation pending, and live acceptance pending.**
Mock and offline checks have passed, but the final gameplay browser
validation is still being reviewed and the unfiltered full browser sweep has
**not** been completed; a private live run with the school key has **not**
been done either (see [Acceptance status](#acceptance-status) and
[Honest browser status](#honest-browser-status) below). This is an operator
handoff, not a statement that the feature is final.

This document is the operator handoff for trying the Assignment 09 AI Guide.
It covers the terminal experiment, the in-game guide, exact settings, and the
manual steps that still have to be done by a person with the private school
key. It intentionally never prints or stores the key.

---

## What exists

There are **two** separate chat surfaces. Do not confuse them:

1. **Terminal experiment** — `experiments/llm/`. A small **Python** script that
   talks directly to the school's OpenAI-compatible endpoint with the Python
   OpenAI SDK. This is a self-contained experiment, not part of the game.
2. **In-game AI Guide** — the game's **existing TypeScript / Node** game server
   exposes `POST /api/ai-chat` on the same origin/port as the Colyseus game.
   It is served by `apps/game-server` (Node, JS `openai` SDK), **not by a Python
   backend.** The web panel (`apps/web/src/ui/ai-chat/`) just calls that HTTP
   route.

Both use the same school endpoint and model, but they manage history
differently:

- The terminal script keeps its **own client-side** turn list (bounded to at
  most 20 user/assistant messages; the system prompt is always re-sent).
- The in-game guide uses **server-owned, separate, bounded histories**: the
  server keeps one history per conversation id. Per conversation the server
  retains at most **8 user/assistant pairs** (oldest pairs dropped first); at
  most 128 conversations are kept, and idle conversations expire after 30
  minutes. The browser only ever sends a `conversationId` (or nothing) plus the
  user text — it never holds or sends the model history, and no secret reaches
  the browser.

---

## 1. Terminal experiment (Python)

Run it from the Assignment 09 integration worktree
(`/root/projects/buildshift/assignment09-integration`), not from another
worktree. Needs no game server and no browser.

### One-time environment setup (isolated venv, pinned dependency)

```bash
# Always work from the Assignment 09 integration worktree (NOT another
# worktree such as Batch 2D), so these commands hit the integrated code:
cd /root/projects/buildshift/assignment09-integration

# Create the isolated venv once (kept out of Git via .gitignore):
python3 -m venv .venv-llm

# Activate it and install the pinned SDK (openai==3.26.0, the school guide's reference)
source .venv-llm/bin/activate
python -m pip install -r experiments/llm/requirements.txt
```

`.venv-llm/` is ignored by Git (see `.gitignore`). The only pinned dependency
is `openai==3.26.0`; any Python 3.11+ works.

### Load your PRIVATE key (do it yourself, in your own terminal)

```bash
export VIVES_LLM_API_KEY="$(cat "$HOME/.config/ai-operations/vives-llm-key")"
```

- The environment variable name is **`VIVES_LLM_API_KEY`**.
- Load it from your private key file (path shown above). Do the `export`
  yourself; never paste the key into a file, a chat message, or Git, and never
  `echo` or otherwise print its value. This shell-only `export` keeps it out of
  any committed artifact.
- The key is read only from this terminal's environment by the script.

### Run it

```bash
# Exactly one request (system prompt + one question), then exit:
python experiments/llm/chat.py --once

# Change the single question:
python experiments/llm/chat.py --once --question "How do I build a wall?"

# Interactive conversation (retained context; /quit or Ctrl-D to exit):
python experiments/llm/chat.py
```

In interactive mode each request re-sends the system prompt plus the retained
earlier user/assistant turns, so follow-up questions work. A turn is stored
only when the request succeeds and the model returns a complete answer
(`finish_reason == "stop"` with non-empty content); failed or cut-off replies
are shown as errors and are **not** stored.

### Terminal error states (what you should see, by design)

- **Missing key** (not exported in this terminal): the script prints that
  `VIVES_LLM_API_KEY` is not set for this terminal and how to load it privately,
  then exits. It does **not** print the key.
- **Network / auth / upstream failure**: a short message with the exception
  type and a hint to check the connection and that the key has access to the
  model. Raw upstream/exception body text is never echoed (it can contain
  credentials).
- **Incomplete answer**: reports the `finish_reason` and does not store the
  turn.

### Offline self-test (no network, no key, no live request)

```bash
source .venv-llm/bin/activate   # or any Python 3.11+
python experiments/llm/selftest_offline.py
```

This mocks the model client and verifies required API parameters, the bounded
history behaviour, and that no raw exception / fake secret is printed. It
passes without a key or a connection.

---

## 2. In-game AI Guide (existing TypeScript/Node backend)

The guide is part of the running game. The game server owns the model
credentials and the per-conversation history; the browser only exchanges a
`conversationId` and plain text.

### How it is exposed

- Backend route: **`POST /api/ai-chat`**, mounted on the **same origin and port**
  as the Colyseus game server (`apps/game-server/src/server.ts`).
- Frontend: an **`AI Guide`** toggle panel in the game
  (`apps/web/src/ui/ai-chat/AiChatPanel.tsx`, mounted at page level in
  `App.tsx` so a conversation survives open/close within the session).
- The panel derives its endpoint from the same game-server URL the gameplay
  client uses, so `ws://host:port` → `http://host:port/api/ai-chat`
  (and `wss://` → `https://`). With the local defaults that is
  `http://localhost:2567/api/ai-chat`.

### Request / response shape

- Request body: `{ "message": "<text>" }` for the first message of a
  conversation; `{ "conversationId": "<id>", "message": "<text>" }` for
  follow-ups. The `conversationId` is returned by the server on the first
  successful reply and echoed back on every follow-up.
- Response body: `{ "conversationId": "<id>", "reply": "<text>" }`.
- The panel renders replies as **plain text only** (never HTML).

### Server-side bounds (fixed in `apps/game-server/src/aiChat/limits.ts`)

- Max user message length: **2000** characters.
- Retained history per conversation: **8 user/assistant pairs** (oldest first).
- Max concurrent conversations: 128; idle conversations expire after 30 min.
- Only complete, successful turns are stored — a failed request never mutates
  a conversation.

---

## 3. Exact model / connection settings (both surfaces agree)

These are the fixed school-endpoint settings, confirmed in both
`experiments/llm/chat.py` and `apps/game-server/src/aiChat/limits.ts`:

| Setting | Value |
| --- | --- |
| Base URL | `https://api.llm.mechatronics.be/v1` |
| Model | `qwen3.8-27b` |
| `reasoning_effort` | `low` |
| `max_tokens` (output budget, includes the model's thinking) | `2048` |
| Timeout | **60 seconds** (terminal `timeout=60.0`; server `requestTimeoutMs = 60_000`) |
| Retries | **0** — `max_retries` / `maxRetries: 0`; exactly one attempt per request |

The API key is read **only** from `process.env.VIVES_LLM_API_KEY` (server) or
`VIVES_LLM_API_KEY` (terminal). It is never logged, echoed, or included in any
error response.

---

## 4. Missing-key and error states (in-game endpoint)

When the game server starts **without** `VIVES_LLM_API_KEY` set in *its*
terminal, the game and the `/api/ai-chat` route still boot normally; the first
chat request returns a clean, bounded error instead of a secret or stack
trace. Useful states a tester may hit:

| `error.code` | HTTP | When |
| --- | --- | --- |
| `ai_not_configured` | 503 | `VIVES_LLM_API_KEY` is not set on the server (the case to expect if the key was not loaded in the server terminal) |
| `empty_message` | 400 | Empty / whitespace-only message |
| `message_too_long` | 400 | Message over 2000 characters |
| `invalid_request` | 400 | Body not a JSON object, or missing / non-string `message`, or bad `conversationId` |
| `unknown_conversation` | 404 | `conversationId` not found / already evicted (start fresh by omitting it) |
| `too_many_conversations` | 503 | Store full of fresh conversations and no stale one free |
| `ai_timeout` | 504 | Upstream did not answer within the 60 s limit |
| `ai_error` | 502 | Upstream transport / HTTP / API failure |
| `ai_incomplete_response` | 502 | `finish_reason != "stop"` or empty content (nothing stored) |

The panel shows the server's safe `error.message` verbatim (capped at 200
chars) or a generic "AI Guide: …" fallback. The 204 preflight is answered with
CORS headers for the chat route only.

---

## 5. Manual acceptance (private key required)

These steps require the real school key and a live model. They are the
acceptance that has **not yet** been done by the automated pipeline.

### 5a. Terminal experiment acceptance

1. Set up the venv + load the key (sections 1).
2. `python experiments/llm/chat.py --once` — expect a single short answer and a
   clean exit.
3. Run interactive mode; ask a question, then a **follow-up** that depends on
   the previous answer (e.g. "then how does the shotgun compare?") — the model
   should use the retained context.

### 5b. In-game guide acceptance (two terminals, from the integration worktree)

Run both from the Assignment 09 **integration** worktree
(`/root/projects/buildshift/assignment09-integration`), **not** from another
worktree. If a Batch 2D or other dev server is already running on port
**2567** (game server) or **5173** (Vite web), stop that process first — a
stale listener on those ports will shadow this worktree.

**Terminal 1 — game server (this terminal owns the key):**

```bash
# Run from the Assignment 09 integration worktree (NOT another worktree):
cd /root/projects/buildshift/assignment09-integration

# Load the key into THIS terminal only (server reads it from the environment):
export VIVES_LLM_API_KEY="$(cat "$HOME/.config/ai-operations/vives-llm-key")"

# Start the game server (default port 2567; also serves /api/ai-chat):
pnpm dev:server
```

Do **not** echo the key. If you skip the `export`, expect `ai_not_configured`
(503) from the guide — that is the intended missing-key behaviour.

**Terminal 2 — web app:**

```bash
# Run from the Assignment 09 integration worktree (NOT another worktree):
cd /root/projects/buildshift/assignment09-integration

pnpm dev
```

Open the printed Vite URL in the browser, start/join a match, and click the
**AI Guide** toggle.

Things to try (manual acceptance questions + behaviours):

- **Objective / movement / weapons / building** questions, e.g.:
  - "What am I trying to achieve in BuildShift, and how do I win a round?"
  - "How do I move, jump, and crouch?"
  - "What are the two weapons and how do I switch between them?"
  - "How does building Energy work, and how much does a wall cost?"
- **Follow-up** in the same conversation (server-owned history): after asking
  about weapons, ask "and the shotgun then?" — confirm the reply stays
  on-topic using the earlier context.
- **New conversation** button: confirm it starts fresh (a new
  `conversationId`; the previous context is no longer sent).
- **Input suppression while typing**: with the chat input focused, confirm that
  W/A/S/D, mouse fire, and build keys do **not** move / fire / build the
  character (focus calls `setGameplayInputSuppressed(true)`). Close the panel
  (or blur the input) and confirm normal gameplay input is restored.
- **Reset while a reply is pending**: with a reply in flight, press
  **New conversation** — confirm the stale in-flight reply is discarded and a
  stale `conversationId` is not reused (the next send starts a fresh
  conversation).
- **Missing-key path**: in a separate run, start the server terminal **without**
  the `export` and confirm the guide shows the 503
  `ai_not_configured` message rather than a crash.

---

## 6. Acceptance status (what is done vs. pending)

- **Passed (automated / mocked / offline):**
  - Python SDK offline self-test (mocked client, no network/key) — passing.
  - Backend unit + integration tests (mocked LLM) — passing.
  - Frontend unit tests (mocked client) — passing.
  - Private real-browser AI-guide smoke (real built web app + two real
    Colyseus clients + real HTTP route/service/store, **mock LLM only**): all
    11 checks passed — missing-key handling, plain-text rendering, follow-up
    history, close/reopen retention, conversation isolation, incomplete-response
    atomicity, reset-during-pending, and typing-suppresses-movement/build.
    `browser-smoke.json` records `mockedLlm: true`, `liveSchoolRequests: 0`.
- **Pending (needs the private key / live school model):**
  - Live terminal `--once` + interactive follow-up against the real endpoint.
  - Live in-game guide acceptance (sections 5a/5b). No live school model
    acceptance has been performed yet.

> **Mock/offline tests have passed. Live school acceptance is still pending and
> must be done privately by the user after loading the key.**

---

## 7. Honest browser status (do not read this as a clean run)

- **Do not** claim a clean, unfiltered 60/60 full browser suite pass. The full
  60-case sweep is **still pending**.
- The last full browser attempt **passed 54 cases and stopped at the
  "surface F" side-button-binds case** (one extra ramp placed); 5 cases did not
  run. See `integration-browser-attempt4.log`. (Preserved as history.)
- The **current** browser candidate is `0552dc8`, which restores the **real CDP
  side-button dispatch** (`pressKey` → `Input.dispatchMouseEvent`) using a
  `page.exposeBinding` notify fired on the first local ramp request — replacing
  the earlier rejected in-page synthetic-event fix (`47951fe`, now preserved as
  history, **not** the current state). A **focused six-case** run passed against
  it (`surface-f-real-input.log`: 6 passed). Fresh QA of this candidate is
  **ongoing**.
- Therefore the full live gameplay browser acceptance (the unfiltered sweep)
  is **not** complete and remains a reported risk: only the focused six cases
  have passing evidence, and live school-key acceptance is still pending.

---

## 8. Where the settings live (for reference)

- Terminal experiment: `experiments/llm/chat.py` (`BASE_URL`, `MODEL`,
  `REASONING_EFFORT`, `MAX_TOKENS`, `TIMEOUT_SECONDS`, `MAX_RETRIES`,
  `MAX_HISTORY_MESSAGES`) and `experiments/llm/requirements.txt`.
- In-game backend: `apps/game-server/src/aiChat/limits.ts` (`AI_CHAT.*`),
  `apps/game-server/src/aiChat/llmClient.ts` (JS `openai`, `maxRetries: 0`),
  `apps/game-server/src/aiChat/chatService.ts` (validation + error mapping),
  `apps/game-server/src/aiChat/conversationStore.ts` (server-owned bounded
  histories).
- In-game frontend: `apps/web/src/ui/ai-chat/*` (panel, client, origin resolver).
