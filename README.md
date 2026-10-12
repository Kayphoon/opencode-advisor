# opencode-advisor

> **A background Watchdog Advisor for OpenCode V2** — an independent reviewer model that observes each primary turn, verifies facts against the real codebase, and injects severity-ranked advice (`nit` / `concern` / `blocker`) back into the session with **mathematical anti-loop guarantees**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-V2.0%2B-black)](https://opencode.ai/v2/docs/)

---

## Table of Contents

- [Why an Advisor?](#why-an-advisor)
- [Design Philosophy](#design-philosophy)
- [System Architecture](#system-architecture)
- [The Fact-Checking Pipeline](#the-fact-checking-pipeline)
- [Anti-Loop Safety Model](#anti-loop-safety-model)
- [Severity & Delivery Routing](#severity--delivery-routing)
- [Model Routing Strategy](#model-routing-strategy)
- [Core Modules](#core-modules)
- [Configuration](#configuration)
- [Installation](#installation)
- [Development](#development)
- [Roadmap](#roadmap)

---

## Why an Advisor?

A single coding agent has three structural weaknesses that no amount of prompt engineering removes:

1. **No independent perspective.** The agent reviews its own work with the same reasoning that produced the mistake. It cannot catch its own blind spots.
2. **Goal drift over long sessions.** By turn 30, the original objective is buried under a mountain of intermediate detail. The agent optimizes the *last instruction* instead of the *real goal*.
3. **Cost/latency trade-off.** Running a high-IQ reasoning model on every turn is expensive and slow; running a fast model everywhere means missing subtle architectural and security flaws.

An **Advisor** solves all three: a *second, independent model* that watches the transcript, judges work **against the original intent**, and surfaces only the issues that matter — without becoming a second agent that fights for control.

This project ports that idea to OpenCode, drawing on two reference designs:

- **OMP (`oh-my-pi`) Watchdog Advisor** — an *extrinsic*, always-on background reviewer that fires on turn boundaries.
- **Claude Code Advisor Tool** — an *intrinsic*, model-driven consultation the primary agent can request at decision points.

---

## Design Philosophy

### 1. Advisory, not sovereign

The Advisor **never approves, rejects, or executes** anything. It cannot edit files, run commands, or spawn agents. Its only output is a bounded, self-described advisory note. Every guarantee in this project exists to make sure a misbehaving reviewer can **never stall or pollute the primary loop**.

### 2. Facts over speculation (Fact-Checking First)

> *"Whoever asserts must prove."* — 谁主张，谁举证。

An AI reviewer that speculates from a diff alone produces **confident, wrong** findings. The single biggest source of false positives is an advisor that sees `user.name` and assumes `user` might be `null` — without ever checking whether `findUserById()` throws instead of returning `null`.

This project mandates that a suspicion must be **verified against real code** (via `read` / `grep` / `glob`) before it is allowed to interrupt anything. See [The Fact-Checking Pipeline](#the-fact-checking-pipeline).

### 3. High precision over high recall

Developers hate noisy reviewers more than they hate missed bugs. It is far better to stay silent than to fire a false alarm. Content-free chatter ("LGTM", "done", "continue") and unverified guesses are **suppressed by construction**, not by prompt wording alone.

### 4. Non-blocking by default

The Advisor is a fire-and-forget background observer. If it times out, errors, rate-limits, or crashes, **the primary session is never blocked**. The user always has priority: a new human input immediately outranks any in-flight review.

### 5. Deterministic evidence beats agentic retrieval

Where a fact can be obtained without the model (compiler diagnostics, git diff stats, test results), it should be injected into the review context directly. This is cheaper, faster, and immune to hallucination.

---

## System Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                      Primary Session (Main Agent)                         │
│                                                                            │
│   user turn ──▶ agent loop ──▶ tools ──▶ assistant turn ──▶ (idle)         │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │  ctx.event.subscribe()
                                    │  session.step.ended / execution.succeeded / idle
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    Advisor Plugin (background, in-process)                │
│                                                                            │
│   ┌────────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────┐  │
│   │  trigger   │──▶│  transcript  │──▶│   reviewer    │──▶│   guard    │  │
│   │  (events,  │   │  (delta +    │   │  (agent loop  │   │ (dedupe,   │  │
│   │   debounce,│   │   goal header│   │   + tools +   │   │  phrases,  │  │
│   │   circuit) │   │   + summary) │   │   fact-check) │   │  quota)    │  │
│   └────────────┘   └──────────────┘   └───────┬───────┘   └─────┬──────┘  │
│        │                                       │                 │         │
│        │                              ┌────────▼────────┐        │         │
│        │                              │  read / grep /  │        │         │
│        │                              │  glob (safe-fs) │        │         │
│        │                              │  + advise tool  │        │         │
│        │                              └─────────────────┘        │         │
│        │                                                          ▼         │
│        │                                                   ┌────────────┐  │
│        └───────────────────────────────────────────────────│  delivery  │  │
│                                                            │ (synthetic │  │
│                                                            │  / steer)  │  │
│                                                            └─────┬──────┘  │
└──────────────────────────────────────────────────────────────────┼────────┘
                                                                    │
                          session.synthetic(resume:false)  ─────────┤ nit / concern
                          session.prompt(steer, resume:true) ───────┘ blocker (circuit-breaker gated)
                                                                    │
                                                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      Primary Session (advice applied)                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Lifecycle in one sentence

> A primary turn ends → the plugin captures the **incremental transcript delta** → an **independent reviewer agent** verifies suspicions against the codebase with read-only tools → a **guard** filters noise and duplicates → surviving notes are **delivered** at the appropriate severity, with a hard circuit breaker ensuring the reviewer can never drive an infinite loop.

---

## The Fact-Checking Pipeline

This is the core quality mechanism. A finding travels through three gates before it can reach the primary session.

```text
   [1] HYPOTHESIS                [2] VERIFICATION               [3] VERDICT
   ─────────────                 ────────────────               ───────────
   "This looks wrong."    ──▶    read/grep the real code   ──▶  confirmed  ──▶ deliver
   (from the delta)              + compiler diagnostics         refuted    ──▶ discard
                                 + existing call sites          uncertain  ──▶ downgrade to nit
```

### Worked example — how false positives die

**Primary agent writes:**

```ts
export function getUserProfile(userId: string) {
  const user = findUserById(userId);
  return { name: user.name, role: user.role };
}
```

**❌ A naive reviewer (diff-only):**

> "BLOCKER: if `findUserById` returns `null`, `user.name` will crash. Stop and fix!"

It fires a waking interrupt. The primary agent derails into defensive `if (!user) return;` boilerplate.

**✅ A fact-checking reviewer:**

1. **Hypothesis** — "`user` might be nullable."
2. **Verification** — `grep("function findUserById")` → `read("src/db.ts:40-60")`.
3. **Observed fact** — the implementation contains `throw new UserNotFoundError(id);` and **never returns `null`**.
4. **Verdict** — *refuted* → the suspicion is silently discarded. No interrupt, no noise.

The reviewer is only permitted to escalate to `blocker` when it can cite a **concrete, verified fact** (e.g. *"`src/db.ts:45` returns `null` and the caller dereferences it unconditionally"*). Unverified claims are downgraded to `nit` or dropped.

---

## Anti-Loop Safety Model

The single greatest risk in an always-on reviewer is a **feedback loop**:

```text
idle → advisor wakes the agent → agent works → idle → advisor wakes again → ∞
```

This project treats loop-safety as a correctness property, enforced by **layered, independent guards** — not by hoping the model behaves.

| Layer | Mechanism | Guarantee |
|---|---|---|
| **1. Identity tagging** | Every injected message carries `metadata.advisor = true`. The delta extractor filters these out. | The reviewer never reviews its own advice. |
| **2. Hard circuit breaker** | `consecutiveAdvisorTurns <= 1`. A `blocker` may wake the session **at most once**; it is forbidden from waking again until a **genuine human message** is admitted. | **Mathematically impossible to loop**, even if every other guard fails. |
| **3. Cooldown (`immuneTurns`)** | After a waking interrupt, subsequent `concern` notes are downgraded for N user turns. | Prevents interrupt storms. |
| **4. Emission guard** | NFKC normalization, content-free phrase suppression, severity-aware FIFO dedupe, per-update quota. | Prevents chatter and repetition. |
| **5. Fail-open isolation** | Timeouts, HTTP errors, and rate limits only drop the advisor's own bounded backlog. | The primary loop is never parked. |

> The circuit breaker (Layer 2) is the **load-bearing** guard. Layers 1, 3–5 are quality-of-life; Layer 2 is the proof.

---

## Severity & Delivery Routing

Each note carries one of three severities, mapped to a distinct delivery channel:

| Severity | Meaning | Delivery | Effect on primary |
|---|---|---|---|
| 🟡 `nit` | Minor style / clarity / quality suggestion | `session.synthetic({ resume: false })` | **Silent.** Enters context; read at the next turn. Zero interruption. |
| 🟠 `concern` | Material risk or a clearly better direction | `session.synthetic({ resume: false })` + UI toast | **Non-waking.** User is alerted; the agent is not derailed. |
| 🔴 `blocker` | Continuing clearly wastes work (contradicts the goal, circular, unsound) | `session.prompt({ delivery: "steer", resume: true })` | **Waking.** The agent is nudged to reconsider — gated by the circuit breaker. |

**Note on OpenCode V2 semantics:** non-waking is `resume: false`; `delivery` only controls *ordering* (`steer` = next step boundary, `queue` = behind queued prompts). A waking `blocker` is a *message*, never a forced permission denial or session interrupt.

---

## Model Routing Strategy

The Advisor is deliberately model-agnostic. Two roles are supported:

| Role | Purpose | Recommended profile | Cadence |
|---|---|---|---|
| **Watchdog** | Background per-turn review of incremental deltas | A **reasoning-capable** mid/large model (e.g. `deepseek-flash`, `gemini-3.8-flash`, `kimi-k3`) | Every turn / every Nth turn |
| **Consult** *(roadmap)* | On-demand escalation the primary agent requests at decision points | The **strongest** available model | Model-driven, rare |

> **Why not a tiny model for the watchdog?** Because a review window is *not* latency-critical: a primary turn plus human reading time gives the background reviewer **10–30 seconds** of slack. A pure Flash model with no thinking budget will only ever catch trivia ("rename this variable"); a reasoning model that spends a few seconds tracing a call chain catches the crash. The watchdog should be *cheap enough to run often*, but *smart enough to be worth listening to*.

**Cost discipline is enforced structurally** — via `reviewMode`, `reviewInterval`, delta truncation, per-update note caps, and fail-open isolation — rather than by starving the model.

---

## Core Modules

| File | Responsibility |
|---|---|
| `src/index.ts` | OpenCode V2 plugin entry (`Plugin.define`), lifecycle, and cleanup. |
| `src/config.ts` | Config loader: merges `~/.config/opencode/advisor.json` + plugin `options`; auto-resolves provider `baseURL`/`apiKey` from `opencode.jsonc`. |
| `src/state.ts` | Per-session state machine: cursor, circuit-breaker counter, user-turn count, cooldown, FIFO dedupe ring, rolling summary. |
| `src/trigger.ts` | Event observer: filters sessions/locations, detects turn-end and genuine user input, debounces review scheduling. |
| `src/transcript.ts` | Delta extraction: goal header + rolling summary + truncated delta + already-raised list; **filters `metadata.advisor` and synthetic parts**. |
| `src/reviewer.ts` | Reviewer agent loop: multi-step tool dispatch, `maxToolSteps` budget, `advise` capture, bounded tool output. |
| `src/guard.ts` | Emission guard: normalization, content-free suppression, severity-aware dedupe, per-update quota, cooldown downgrade. |
| `src/delivery.ts` | Severity routing + **hard circuit breaker** + fail-open error handling. |
| `src/tools/safe-fs.ts` | Workspace containment: blocks directory traversal and symlink escape. |
| `src/tools/read.ts` | Bounded file reading (line ranges, size caps). |
| `src/tools/grep.ts` | Bounded regex content search (ignores `node_modules`, `.git`, `dist`, …). |
| `src/tools/glob.ts` | Bounded filename matching. |
| `src/tools/advise.ts` | The single emission tool: `note` + `severity`. |
| `src/test/advisor.test.ts` | Unit tests: path containment, self-review filtering, guard behavior, circuit breaker. |

---

## Configuration

Resolution order (lowest → highest precedence):

```text
built-in defaults  →  ~/.config/opencode/advisor.json  →  plugin options
```

If `provider.baseURL` / `provider.apiKey` are omitted, they are auto-resolved from the matching provider entry in `~/.config/opencode/opencode.jsonc`.

### `advisor.example.json`

```json
{
  "enabled": true,
  "model": "deepseek/deepseek-flash",
  "provider": {
    "baseURL": "http://127.0.0.1:8084/v1",
    "apiKey": "your-api-key-here"
  },
  "reviewMode": "step",
  "maxToolSteps": 3,
  "maxNotesPerUpdate": 3,
  "immuneTurns": 3,
  "timeoutMs": 25000,
  "tools": ["read", "grep", "glob"],
  "delivery": {
    "nit": "synthetic_noreply",
    "concern": "synthetic_noreply",
    "blocker": "steer_waking"
  }
}
```

### Reference

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch. |
| `model` | string | `deepseek/deepseek-flash` | `provider/model` for the watchdog. |
| `variant` | string | — | Optional model variant/thinking level. |
| `provider.baseURL` | string | auto-resolved | OpenAI-compatible endpoint. |
| `provider.apiKey` | string | auto-resolved | Bearer token. |
| `reviewMode` | `"step"` \| `"idle"` \| `"execution"` | `"step"` | Which event kind triggers a review. |
| `maxToolSteps` | number | `3` | Max tool-call rounds per review. |
| `maxNotesPerUpdate` | number | `3` | Max notes accepted per review. |
| `immuneTurns` | number | `3` | Cooldown window after a waking interrupt. |
| `timeoutMs` | number | `25000` | Hard deadline per review. |
| `tools` | string[] | `["read","grep","glob"]` | Read-only tools granted to the reviewer. |
| `delivery.*` | enum | see above | Delivery channel per severity. |
| `systemPrompt` | string | built-in | Reviewer system prompt. |

---

## Installation

### 1. Build

```bash
npm install
npm run build
```

### 2. Register with OpenCode

Add the plugin to your project or global `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "github:Kayphoon/opencode-advisor"
    // or a local path / package name, optionally with options:
    // { "package": "/root/oc_plugin", "options": { "model": "deepseek/deepseek-flash" } }
  ]
}
```

### 3. (Optional) Dedicated config

Create `~/.config/opencode/advisor.json` (see [Configuration](#configuration)). Credentials are inherited automatically from `opencode.jsonc` when omitted.

---

## Development

```bash
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm test           # node --test dist/test/advisor.test.js
```

### Verification status

The current unit suite covers the four load-bearing safety invariants:

- ✅ **Path containment** — directory traversal and symlink escape are rejected.
- ✅ **Self-review filtering** — `metadata.advisor` messages are excluded from deltas.
- ✅ **Emission guard** — content-free phrases and duplicates are suppressed.
- ✅ **Circuit breaker** — a second consecutive `blocker` cannot wake the session.

Real-session end-to-end verification (live event stream → reviewer → delivered note) is a **planned** validation gate, not yet automated.

---

## Roadmap

| Item | Status | Notes |
|---|---|---|
| OMP-style extrinsic watchdog | ✅ Implemented | Event-driven, per-turn, read-only tools, circuit breaker. |
| Fact-checking pipeline (verification-before-report) | 🟡 Partial | Reviewer has `read`/`grep`; explicit citation-required `advise` schema is planned. |
| Intrinsic `consult_advisor` tool | ⬜ Planned | Let the primary agent request a stronger-model consultation (Claude Code pattern). |
| Dual-model routing (`watchdogModel` / `consultModel`) | ⬜ Planned | Cheap+smart watchdog; strongest model for on-demand consults. |
| Deterministic enrichment (LSP diagnostics, diff stats) | ⬜ Planned | Zero-token, hallucination-proof review context. |
| Actionable patches (`suggestedPatch`) | ⬜ Planned | Attach a ready-to-apply diff to `concern`/`blocker` notes. |
| Multi-advisor roster (specialized reviewers) | ⬜ Planned | Security / architecture / QA reviewers running in parallel. |

---

## License

MIT — see [LICENSE](./LICENSE).

## References

- OpenCode V2 plugin docs — <https://opencode.ai/v2/docs/build/plugins>
- OMP (`oh-my-pi`) Advisor / WATCHDOG — <https://github.com/can1357/oh-my-pi>
- Claude Code Advisor tool — <https://code.claude.com/docs/en/advisor>
- Claude Code Review — <https://code.claude.com/docs/en/code-review>
