# opencode-superadvisor

> **A dual-engine advisor for OpenCode V2** — an OMP-style background **watchdog** that observes each primary turn, verifies facts against the real codebase, and injects severity-ranked advice (`nit` / `concern` / `blocker`) with **mathematical anti-loop guarantees**; plus an on-demand **`consult_advisor`** tool that lets the primary agent escalate hard decisions to a stronger model.

[![npm](https://img.shields.io/npm/v/opencode-superadvisor)](https://www.npmjs.com/package/opencode-superadvisor)
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

## Two Engines: Watchdog & Consultation

The plugin runs **two complementary engines** (the dual-engine design):

| Engine | Trigger | Direction | Model | Role |
|---|---|---|---|---|
| **Watchdog** | Automatic (`session.step.ended` / `execution.succeeded` / `idle`) | **Push** — fires itself | `watchdogModel` | Background per-turn review; verifies and reports flaws. |
| **Consultation** | The primary agent calls the `consult_advisor` tool | **Pull** — model-driven | `consultModel` | On-demand escalation at decision points. |

### The `consult_advisor` tool

Registered with OpenCode so the primary agent can escalate *before committing to an approach*, *when stuck on a recurring error*, or *before declaring a task done* — mirroring the Claude Code advisor pattern. It receives the question, optional extra context, and the last `includeContextMessages` session messages, then returns concrete guidance. It is **advisory only**; the primary agent decides what to apply.

> Because the watchdog is push-based and the consultation is pull-based, they cover each other's blind spots: the watchdog catches what the agent doesn't realize is wrong; the consultation handles what the agent *knows* it needs help with.

---

## Model Routing Strategy

The Advisor is deliberately model-agnostic. Two roles are supported:

| Role | Purpose | Recommended profile | Cadence |
|---|---|---|---|
| **Watchdog** | Background per-turn review of incremental deltas | A **reasoning-capable** mid/large model (e.g. `deepseek-flash`, `gemini-3.8-flash`, `kimi-k3`) | Every turn / every Nth turn |
| **Consult** | On-demand escalation the primary agent requests at decision points | The **strongest** available model | Model-driven, rare |

> **Why not a tiny model for the watchdog?** Because a review window is *not* latency-critical: a primary turn plus human reading time gives the background reviewer **10–30 seconds** of slack. A pure Flash model with no thinking budget will only ever catch trivia ("rename this variable"); a reasoning model that spends a few seconds tracing a call chain catches the crash. The watchdog should be *cheap enough to run often*, but *smart enough to be worth listening to*.

**Cost discipline is enforced structurally** — via `reviewMode`, `reviewInterval`, delta truncation, per-update note caps, and fail-open isolation — rather than by starving the model.

---

## Core Modules

| File | Responsibility |
|---|---|
| `src/index.ts` | OpenCode V2 plugin entry (`Plugin.define`), registers the consult tool, lifecycle, and cleanup. |
| `src/config.ts` | Config loader + dual-model resolution; merges `advisor.json` + plugin `options`; auto-resolves provider `baseURL`/`apiKey`. |
| `src/llm.ts` | Shared OpenAI-compatible chat-completion caller; never throws on transport errors. |
| `src/state.ts` | Per-session state machine: cursor, circuit-breaker counter, user-turn count, cooldown, eligible-update counter, dedupe ring, diagnostics. |
| `src/trigger.ts` | Event observer: filters sessions/locations, captures LSP diagnostics, detects turn-end and genuine user input, debounces + interval-gates reviews. |
| `src/transcript.ts` | Delta extraction: goal header + deterministic signals + rolling summary + truncated delta; **filters `metadata.advisor` parts**. |
| `src/enrich.ts` | Deterministic enrichment: working-tree diff stat + LSP diagnostics (zero model tokens). |
| `src/reviewer.ts` | Watchdog loop: multi-step tool dispatch, `maxToolSteps` budget, `advise` capture, bounded tool output. |
| `src/guard.ts` | Emission guard: normalization, content-free suppression, **evidence enforcement**, severity-aware dedupe, quota, cooldown downgrade. |
| `src/delivery.ts` | Severity routing + **hard circuit breaker** + evidence/patch formatting + fail-open errors. |
| `src/tools/safe-fs.ts` | Workspace containment: blocks directory traversal and symlink escape. |
| `src/tools/read.ts` | Bounded file reading (line ranges, size caps). |
| `src/tools/grep.ts` | Bounded regex content search (ignores `node_modules`, `.git`, `dist`, …). |
| `src/tools/glob.ts` | Bounded filename matching. |
| `src/tools/advise.ts` | Emission tool: `note` + `severity` + `evidence` + `suggestedPatch`. |
| `src/tools/consult.ts` | The intrinsic `consult_advisor` tool. |
| `src/test/advisor.test.ts` | Unit tests: path containment, self-review filtering, guard, evidence enforcement, circuit breaker. |

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

  "watchdogModel": "deepseek/deepseek-flash",
  "consultModel": "moonshotai/kimi-k3",

  "provider": {
    "baseURL": "http://127.0.0.1:8084/v1",
    "apiKey": "your-api-key-here"
  },

  "reviewMode": "step",
  "reviewInterval": 1,
  "maxToolSteps": 3,
  "maxNotesPerUpdate": 3,
  "immuneTurns": 3,
  "timeoutMs": 25000,
  "requireEvidence": true,
  "tools": ["read", "grep", "glob"],

  "consult": {
    "enabled": true,
    "model": "moonshotai/kimi-k3",
    "maxTokens": 1024,
    "includeContextMessages": 12
  },

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
| `watchdogModel` | string | `deepseek/deepseek-flash` | `provider/model` for the background reviewer. |
| `model` | string | — | Legacy alias for `watchdogModel`. |
| `consultModel` | string | = watchdog | `provider/model` for on-demand consultations. |
| `variant` | string | — | Optional model variant/thinking level. |
| `provider.baseURL` | string | auto-resolved | OpenAI-compatible endpoint. |
| `provider.apiKey` | string | auto-resolved | Bearer token. |
| `reviewMode` | `"step"` \| `"idle"` \| `"execution"` | `"step"` | Which event kind triggers a review. |
| `reviewInterval` | number | `1` | Review every Nth eligible update; skipped deltas are merged into the next review. |
| `maxToolSteps` | number | `3` | Max tool-call rounds per review. |
| `maxNotesPerUpdate` | number | `3` | Max notes accepted per review. |
| `immuneTurns` | number | `3` | Cooldown window after a waking interrupt. |
| `timeoutMs` | number | `25000` | Hard deadline per review. |
| `requireEvidence` | boolean | `true` | Downgrade `blocker` → `concern` when unverified. |
| `tools` | string[] | `["read","grep","glob"]` | Read-only tools granted to the reviewer. |
| `delivery.*` | enum | see above | Delivery channel per severity. |
| `systemPrompt` | string | built-in | Reviewer system prompt. |
| `consult.enabled` | boolean | `true` | Register the `consult_advisor` tool. |
| `consult.model` | string | = watchdog | Model used for consultations. |
| `consult.maxTokens` | number | `1024` | Output budget per consultation. |
| `consult.includeContextMessages` | number | `12` | Recent messages attached to a consultation. |

---

## Installation

### From npm (recommended)

```bash
opencode plugin add opencode-superadvisor
```

Or add it to `~/.config/opencode/opencode.jsonc` (global) or a project config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-superadvisor"
  ]
}
```

> **Note:** depending on your OpenCode build, the config key may be `plugin` (observed working on v2.0.19) or `plugins`. Match whatever key your existing plugin entries already use.

Then restart the background service and verify:

```bash
opencode service restart
opencode api get /api/plugin
# → { "id": "opencode-superadvisor", "source": { "type": "package" }, "state": { "status": "active" } }
```

### From a local checkout

```bash
git clone https://github.com/Kayphoon/opencode-advisor.git
cd opencode-advisor && npm install && npm run build
```

```jsonc
{ "plugin": ["/absolute/path/to/opencode-advisor"] }
```

### From GitHub (⚠️ see the caveat below)

```bash
opencode plugin add github:Kayphoon/opencode-advisor
```

> Prefer npm or a local path. Git-based installs currently hit a bug in some OpenCode builds.

### ⚠️ Known OpenCode CLI bug: git dependencies

On some OpenCode builds (observed on **2.0.19**, a Bun-compiled binary), installing **any** `github:` / `git+https://` plugin fails with:

```
NpmInstallFailedError (cause: Error: git dep preparation failed)
```

**Root cause (confirmed from `~/.local/share/opencode/log/opencode.log`):** for a git dependency, npm's `pacote` clones the repo and runs an inner `npm install`. OpenCode spawns that inner install as:

```
/$bunfs/bin/npm-cli.js install --force --cache=/root/.npm --no-save --include=dev ...
```

`/$bunfs/` is Bun's **internal virtual filesystem** inside the single-file binary. In this build the spawn resolves to the OpenCode CLI itself, so it parses `install --force …` as OpenCode arguments, prints help, and exits non-zero:

```
cli starting version=2.0.19 args=["/$bunfs/bin/npm-cli.js","install","--force",...]
cli process failed cause="~effect/cli/CliError/ShowHelp: Help requested"
```

Registry packages (e.g. `oh-my-opencode-slim@latest`) skip this path entirely, which is why only git installs fail. This is an OpenCode packaging bug, not a problem with this package.

**Workarounds:** install from npm (recommended), use a local checkout path, or populate OpenCode's cache manually:

```bash
SLUG="$HOME/.cache/opencode/npm/git-opencode-advisor-39a33a901f74/$(date +%s%3N)"
mkdir -p "$SLUG"
printf '{"dependencies":{"opencode-superadvisor":"github:Kayphoon/opencode-advisor"}}\n' > "$SLUG/package.json"
( cd "$SLUG" && npm install --no-audit --no-fund )
```

### (Optional) Dedicated config

Create `~/.config/opencode/advisor.json` (see [Configuration](#configuration)). Credentials are inherited automatically from `opencode.jsonc` when omitted.

### Or: let an AI agent install it

Copy the prompt below into any coding agent that has shell access on the target machine. It handles the config edit, the CLI workaround, and verification.

<details>
<summary><b>Install prompt (English)</b></summary>

```text
Install and enable the OpenCode plugin "opencode-superadvisor" on this machine.

Context:
- OpenCode V2 plugin. npm package: opencode-superadvisor. Source: https://github.com/Kayphoon/opencode-advisor
- Prefer the npm registry path. Do NOT use `github:` — on some OpenCode builds git installs
  fail with "NpmInstallFailedError (cause: Error: git dep preparation failed)" (a CLI packaging bug).

Steps:
1. Locate the global config at ~/.config/opencode/opencode.jsonc (create it if missing).
   BACK IT UP first (e.g. copy to opencode.jsonc.bak). Preserve all existing settings.
2. Add "opencode-superadvisor" to the plugin array.
   - Match the key already present in the file: `plugin` or `plugins`. If neither exists, use `plugin`.
   - If the array already contains other plugins, append; do not replace.
3. Install it:  opencode plugin add opencode-superadvisor
   If that command is unavailable, the config entry from step 2 is enough — OpenCode installs it on startup.
4. Restart the service:  opencode service restart
5. Verify:  opencode api get /api/plugin
   Expect an entry: { "id": "opencode-superadvisor", "state": { "status": "active" } }
6. (Optional) To use a stronger consultation model, create ~/.config/opencode/advisor.json
   with { "watchdogModel": "deepseek/deepseek-flash", "consultModel": "<stronger-model-id>" }.
   If omitted, provider baseURL/apiKey are auto-resolved from opencode.jsonc.

Fallback if npm is unavailable: clone https://github.com/Kayphoon/opencode-advisor,
run `npm install && npm run build`, and set the plugin entry to the absolute local path.

Constraints:
- Never delete or overwrite unrelated plugin/config entries.
- If step 5 does not show "active", paste the FULL error back to me. Do not loop retrying.
```

</details>

<details>
<summary><b>安装提示词（中文）</b></summary>

```text
请在这台机器上安装并启用 OpenCode 插件 opencode-superadvisor。

背景：
- OpenCode V2 插件。npm 包名：opencode-superadvisor；源码：https://github.com/Kayphoon/opencode-advisor
- 请优先走 npm 注册表安装，不要用 `github:` —— 某些 OpenCode 版本安装 git 依赖会报
  "NpmInstallFailedError (cause: Error: git dep preparation failed)"（CLI 打包器的 bug）。

步骤：
1. 找到全局配置 ~/.config/opencode/opencode.jsonc（不存在则创建）。
   先备份（例如复制为 opencode.jsonc.bak），并完整保留其他已有配置。
2. 在插件数组中加入 "opencode-superadvisor"。
   - 匹配文件中已存在的键名：`plugin` 或 `plugins`；若都不存在则用 `plugin`。
   - 若数组里已有其他插件，请追加，不要覆盖。
3. 安装：opencode plugin add opencode-superadvisor
   若该命令不可用，第 2 步写入的配置项本身也够用 —— OpenCode 会在启动时自动安装。
4. 重启服务：opencode service restart
5. 验证：opencode api get /api/plugin
   应出现：{ "id": "opencode-superadvisor", "state": { "status": "active" } }
6. （可选）若想用更强的顾问模型，创建 ~/.config/opencode/advisor.json，
   内容如 { "watchdogModel": "deepseek/deepseek-flash", "consultModel": "<更强的模型ID>" }。
   不创建时会自动继承 opencode.jsonc 中对应 provider 的 baseURL 与 apiKey。

若 npm 不可用：克隆 https://github.com/Kayphoon/opencode-advisor，
执行 `npm install && npm run build`，再把插件项指向本地绝对路径。

约束：
- 绝对不要删除或覆盖无关的插件与配置项。
- 若第 5 步没有显示 active，请把完整报错原样贴给我，不要循环重试。
```

</details>

---

## Development

```bash
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm test           # node --test dist/test/advisor.test.js
```

### Verification status

The unit suite covers the load-bearing safety and quality invariants:

- ✅ **Path containment** — directory traversal and symlink escape are rejected.
- ✅ **Self-review filtering** — `metadata.advisor` messages are excluded from deltas.
- ✅ **Deterministic signals** — enrichment is appended to the review context.
- ✅ **Emission guard** — content-free phrases and duplicates are suppressed.
- ✅ **Fact-checking enforcement** — a `blocker` without evidence is downgraded to `concern`.
- ✅ **Evidence rendering** — delivered notes carry `file:line` evidence and suggested patches.
- ✅ **Circuit breaker** — a second consecutive `blocker` cannot wake the session.

Real-session end-to-end verification (live event stream → reviewer → delivered note) is a **planned** validation gate, not yet automated.

---

## Roadmap

| Item | Status | Notes |
|---|---|---|
| OMP-style extrinsic watchdog | ✅ Implemented | Event-driven, per-turn, read-only tools, circuit breaker. |
| Fact-checking pipeline (verification-before-report) | ✅ Implemented | `advise` carries `evidence {file,line,observedFact}`; unverified `blocker` is downgraded to `concern`. |
| Intrinsic `consult_advisor` tool | ✅ Implemented | Primary agent can escalate hard decisions to a stronger model. |
| Dual-model routing (`watchdogModel` / `consultModel`) | ✅ Implemented | Independent provider/model resolution per role. |
| Deterministic enrichment (VCS diff stat, LSP diagnostics) | ✅ Implemented | Injected into review context; no model tokens spent. |
| Actionable patches (`suggestedPatch`) | ✅ Implemented | Attached to and rendered with `concern`/`blocker` notes. |
| Multi-advisor roster (specialized reviewers) | ⬜ Planned | Security / architecture / QA reviewers running in parallel. |
| Real-session end-to-end test harness | ⬜ Planned | Live event stream → reviewer → delivered note. |

---

## License

MIT — see [LICENSE](./LICENSE).

## References

- OpenCode V2 plugin docs — <https://opencode.ai/v2/docs/build/plugins>
- OMP (`oh-my-pi`) Advisor / WATCHDOG — <https://github.com/can1357/oh-my-pi>
- Claude Code Advisor tool — <https://code.claude.com/docs/en/advisor>
- Claude Code Review — <https://code.claude.com/docs/en/code-review>
