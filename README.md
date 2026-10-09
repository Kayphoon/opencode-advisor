# OpenCode Advisor Plugin (`opencode-advisor`)

A faithful **OMP (oh-my-pi) Watchdog Advisor** port for **OpenCode V2**.
It attaches an autonomous background reviewer agent to each session that monitors turns, verifies code facts using built-in read-only tools (`read`, `grep`, `glob`), and delivers severity-ranked advice (`nit`, `concern`, `blocker`) back to the session with mathematical anti-loop guarantees.

---

## 🌟 Key Features (OMP Parity)

1. **Independent Reviewer Agent Loop**:
   - Maintains an isolated review turn per primary step.
   - Equipped with safe, workspace-bounded read-only tools (`read`, `grep`, `glob`) and an `advise` emission tool.
   - Max tool steps budget (default: 3) to prevent runaway model execution.

2. **Slim-Style Flexible Configuration**:
   - Supports `~/.config/opencode/advisor.json` or plugin `options`.
   - Automatically inherits API credentials (`baseURL`, `apiKey`) from `~/.config/opencode/opencode.jsonc` providers (e.g. `deepseek`, `google`, `moonshotai`, `zhipuai`).

3. **Mathematical Anti-Loop & Safety Circuit Breaker**:
   - **Self-Review Guard**: Injected advice is tagged with `metadata.advisor = true`, strictly filtered out from transcript deltas.
   - **Hard Single-Turn Circuit Breaker**: `consecutiveAdvisorTurns <= 1`. If the advisor woke the session with a `blocker`, it is strictly forbidden from waking again until a genuine human user message is admitted.
   - **Emission Guard**: NFKC normalization, content-free phrase suppression ("LGTM", "done", "continue"), and severity-aware FIFO deduplication.
   - **Cooldown (`immuneTurns`)**: Down-ranks repetitive interruptions following severe advice.

4. **Severity-Ranked Delivery**:
   - `nit` & `concern`: Injected via `session.synthetic` with `resume: false` (quiet context addition, zero interruption).
   - `blocker`: Delivered via `session.prompt` with `delivery: "steer"` and `resume: true` to wake the primary agent for immediate remediation.

---

## 📦 Installation & Setup

### 1. Build the Plugin

```bash
cd /root/oc_plugin
npm install
npm run build
```

### 2. Register in OpenCode V2 Configuration

Add `opencode-advisor` to your project or global `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/root/oc_plugin",
    // or with inline options:
    {
      "package": "/root/oc_plugin",
      "options": {
        "model": "deepseek/deepseek-flash",
        "maxToolSteps": 3,
        "maxNotesPerUpdate": 3,
        "immuneTurns": 3
      }
    }
  ]
}
```

### 3. Dedicated Config (`~/.config/opencode/advisor.json`)

You can create a standalone configuration file modeled after `oh-my-opencode-slim.json`:

```json
{
  "enabled": true,
  "model": "deepseek/deepseek-flash",
  "provider": {
    "baseURL": "http://127.0.0.1:8084/v1",
    "apiKey": "your-key"
  },
  "reviewMode": "step",
  "maxToolSteps": 3,
  "maxNotesPerUpdate": 3,
  "immuneTurns": 3,
  "timeoutMs": 25000,
  "tools": ["read", "grep", "glob"]
}
```

*(Note: If `baseURL` or `apiKey` are omitted, the plugin automatically resolves credentials for the matching model provider from `opencode.jsonc`.)*

---

## 🛡️ Security Boundaries

- **Workspace Path Containment**: Built-in path resolution ensures `read`, `grep`, and `glob` cannot access files outside the workspace root or escape via symlinks.
- **Fail-Open Isolation**: If the reviewer model times out, errors, or fails, the primary session is never blocked.
