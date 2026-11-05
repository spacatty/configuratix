# Configuratix agent job & command language (contract)

This file is the contract between the backend (job producers) and the agent
(executor). Agent version: **0.6.0**. Everything marked *v1* behaves exactly as
in agent 0.5.x; *v2* features require the capability listed next to them
(agents report capabilities in every heartbeat, see `agents.capabilities`).

Job rows live in `jobs` (`type`, `payload_json`, `timeout_seconds`, ...). The
agent claims jobs one at a time, executes them sequentially in a dedicated
worker (heartbeats are never blocked), streams logs while running and reports a
structured result at the end.

---

## 1. Job types

| type | payload | notes |
|---|---|---|
| `run` | see §2 | the general-purpose step language (preferred) |
| `update_agent` | `{"action":"update","target_version":"0.6.0"}` | self-update, see §6 |
| `deploy_landing` | `{"landing_id","target_path","index_file","use_php","replace_content"}` | v1 |
| `exec` | `{"command" \| "script", "timeout"}` | v1, runs `bash -c` |
| `file` | `{"action":"write\|append\|delete\|backup","path","content","mode"}` | v1 |
| `service` | `{"name","action"}` | v1, `systemctl <action> <name>` |
| `bootstrap_machine`, `apply_domain`, `remove_domain` | legacy | v1 |

Any payload may carry `"timeout": <seconds>` = whole-job timeout (capability
`job.timeout`). Otherwise the job column `timeout_seconds` is used (agent ≥ 0.6
honours it; `update_agent` is never time-limited by the worker). On timeout the
running step's process group is killed and the job fails with
`job timed out after Ns`.

---

## 2. `run` payload

```json
{
  "vars":     {"domain": "example.com"},
  "on_error": "stop",
  "timeout":  900,
  "steps":    [ ... ],
  "rollback_steps": [ ... ]
}
```

| field | v | meaning |
|---|---|---|
| `steps[]` | v1 | executed in order |
| `vars` | v1 | `{{name}}` substitution (§3) |
| `on_error` | v1 | `stop` (default): fail the job at the first failing step. `continue`: log and go on — **the job still succeeds** (v1 semantics). `rollback`: undo file changes (§5), run `rollback_steps`, fail the job |
| `rollback_steps[]` | v2 `rollback_steps` | steps run after file restoration when a rollback triggers (also on cancel/timeout). Errors are logged, never stop the rollback. Typical: `nginx -t && systemctl reload nginx` |
| `timeout` | v2 `job.timeout` | whole-job timeout in seconds |

### 2.1 Step fields

Common fields (every action):

| field | v | meaning |
|---|---|---|
| `action` | v1 | `exec`, `file`, `service`, `fetch` (v1); `script`, `assert`, `nginx_test`, `list` (v2) |
| `id` | v2 | stable identifier, echoed in `result.steps[].id` |
| `title` | v2 | display label (log header + `result.steps[].name`) |
| `name` | v1 | **service name** for `service` steps; for other actions used as display label when `title` is absent |
| `timeout` | v1 | per-command timeout, seconds (default 300) |
| `if` | v2 `steps.if` | bash condition; the step is **skipped** (status `skipped`) unless it exits 0. 60 s max |
| `capture` | v2 `steps.capture` | store trimmed stdout into var `<capture>` for later steps (`exec`, `script`, `assert`: stdout only; `nginx_test`: combined output; `list`: the JSON) |
| `continue_on_error` | v2 | a failure of this step is recorded (`status: failed`, `continued_on_error: true`) and execution continues regardless of `on_error` |
| `retries` | v2 `steps.retries` | re-run a failing step up to N more times (max 10) |
| `retry_delay` | v2 | seconds between retries (default 5) |
| `env` | v2 `steps.env` | `{"KEY":"value"}` added to the command environment (values get raw var substitution) |
| `escape_vars` | v2 `vars.escape` | when `true`, bare `{{var}}` in shell fields is shell-quoted (§3). Default `false` |
| `log` | v1 | extra command whose output is appended after the step (`"out"` = no-op) |

### 2.2 Actions

**`exec`** (v1) – `command` run with `/bin/bash -c` in its own process group.
Log: `$ <command>` + combined stdout/stderr. Fails on non-zero exit
(`exit status N`) or timeout (`command timed out after Ns`).

**`script`** (v2 `action.script`) – `script`: multi-line bash, executed as
`bash -c "set -euo pipefail\n<script>"`. Same failure rules as `exec`.

**`assert`** (v2 `action.assert`) – `command` must exit 0, otherwise the step
fails with `message` (default `assertion failed: <command>`).

**`nginx_test`** (v2 `action.nginx_test`) – runs `nginx -t`; fails with
`nginx config test failed: ...`. `result.steps[].data = {"ok": bool, "output": "..."}`.

**`file`** (v1, atomic since v2 `file.atomic`) – `op`:
- `write` (default): content = `content` (or downloaded from `url`). Written
  atomically (temp file in the same dir → fsync → rename; symlinks are followed
  so the link target is replaced). Existing files keep their mode and owner
  unless `mode` (octal string, e.g. `"0600"`) is given; new files default to
  0644. Parent dirs are created.
- `append`: append `content` (file created if missing).
- `delete`: remove the file (missing file is not an error).
- `backup`: copy to `<path>.configuratix-backup` (not used for rollback).
- `validate` (v2 `file.validate`, write/append): command run after the write
  with `{{path}}` / `{{q:path}}` bound to the file path. On failure the file is
  immediately restored (or removed if it was new) and the step fails.

**`service`** (v1) – `systemctl <op> <name>`; `op` ∈ start, stop, restart
(default), reload, enable, disable, status.

**`fetch`** (v1) – download `url` to `path` (HTTP 200 required), `mode`
optional. Atomic and tracked for rollback since v2.

**`list`** (v2 `action.list`) – inspect managed files. `path` is an absolute
glob (Go `filepath.Glob` syntax), `recursive: true` also walks matched
directories, `hash: false` skips sha256. Allowed roots only:
`/etc/nginx`, `/etc/php`, `/etc/ssh`, `/etc/letsencrypt/live` (names, type and
mtime only — no size/hash/link target), `/var/www`. Symlinks are only followed
(for size/hash) when they resolve inside an allowed content root. Max 5000
entries, files > 16 MiB are not hashed. The JSON goes to
`result.steps[].data` (and to `capture` if set); the log only gets a summary.

```json
{"pattern":"/etc/nginx/sites-enabled/*","root":"/etc/nginx","truncated":false,
 "entries":[{"path":"/etc/nginx/sites-enabled/a.conf","name":"a.conf","type":"symlink",
   "size":512,"mode":"0777","mtime":"2026-11-05T10:00:00Z","sha256":"…","link_target":"../sites-available/a.conf"}]}
```
`type` ∈ `file`, `dir`, `symlink`, `other`.

---

## 3. Variables

Substitution is a **single pass** (substituted values are never re-scanned) and
unknown placeholders are left untouched.

| syntax | where | result |
|---|---|---|
| `{{name}}` | all fields | raw value (v1). In shell fields with `escape_vars: true`: single-quoted |
| `{{q:name}}` | all fields (v2 `vars.quote`) | always single-quoted for POSIX shells: `it's` → `'it'\''s'` |

Shell fields: `command`, `script`, `if`, `log`, `validate`.
Raw fields: `path`, `content`, `url`, `name`, `title`, `message`, `env` values.

Vars = payload `vars` + values captured by earlier steps (`capture`) +
`path` inside `validate`. **Always use `{{q:var}}` (or `escape_vars`) for values
that come from users** (domains, paths, passwords).

---

## 4. Logs, result, cancellation

### 4.1 Streaming (v2 `logs.stream`)
While a job runs the agent POSTs `/api/agent/jobs/update` every ~1.5 s when
there is new output (at least every 5 s otherwise):
```json
{"job_id":"…","status":"running","append_logs":"<new text, appended verbatim>"}
```
Response:
```json
{"status":"ok","job_status":"running","cancel_requested":false}
```
Final update:
```json
{"job_id":"…","status":"completed|failed|cancelled","append_logs":"…",
 "result":{…},"error":"…"}
```
Old agents send `{"job_id","status","logs"}` (logs appended with a newline);
the backend accepts both. Log text format is unchanged from v1 (`=== Step N:
action ===`, `$ cmd`, output, `ERROR: …`, `=== Rolling back ===`,
`=== All steps completed ===`, final `Error: …` line on failure), so
`CONFIGURATIX_*|…` marker lines keep working.

### 4.2 Structured result (v2 `result.structured`) → `jobs.result_json`
```json
{
  "version": 1,
  "job_type": "run",
  "status": "completed|failed|cancelled",
  "error": "exit status 1",
  "duration_ms": 1234,
  "steps": [
    {"index":0,"id":"write-conf","name":"Write config","action":"file","status":"ok|failed|skipped",
     "exit_code":-1,"duration_ms":3,"attempts":1,"output_tail":"…last 4 KiB…",
     "error":"…","continued_on_error":false,"data":{…}}
  ],
  "rolled_back": false,
  "rollback_log": "Restored /etc/nginx/…\nRemoved new file …",
  "data": {…}
}
```
`exit_code` is -1 for non-process steps or killed processes. `data` (job level)
is set by `update_agent` (`from_version`, `to_version`, `arch`, `checksum`,
`binary`, `rollback_unit`, `restarting`). `error` is also stored in
`jobs.error_message`.

### 4.3 Cancellation (v2 `job.cancel`)
Set `jobs.cancel_requested = true`. Pending jobs with the flag are never
claimed. For a running job the agent sees `cancel_requested: true` in the next
update response (≤ 5 s), kills the running step's process group, runs the
rollback if `on_error` is `rollback`, and reports `status: "cancelled"`
(`error: "cancelled by user"`). `update_agent` cannot be cancelled once started.

### 4.4 Claiming / ordering / reaping
`GET /api/agent/jobs?limit=1` atomically moves pending jobs to `running`
(`FOR UPDATE SKIP LOCKED`, ordered by `created_at, seq`, `attempts += 1`,
`claimed_at = NOW()`). The server reaper fails `running` jobs whose
`started_at + COALESCE(timeout_seconds, 900) + 60 s` passed unless the agent's
heartbeat still reports the job in `running_job_id` (error_message
`timed out`).

---

## 5. Rollback semantics (`on_error: "rollback"`)

1. Every file touched by `file`/`fetch` is backed up once (first touch, so the
   pre-job state is restored even when a file is written several times;
   backup file `<path>.configuratix-backup`, mode 0600).
2. On failure: backups are restored atomically (newest first, original mode),
   files that did not exist before the job are **deleted** (v2), backups removed.
3. `rollback_steps` run (v2).
4. `result.rolled_back = true`, `result.rollback_log` = what happened.

---

## 6. Agent self-update (`update.v2`)

Server-driven only (the agent's periodic version check just reports
`update_available` / `latest_version` in heartbeats).

1. `GET /api/agent/version?arch=<arch>` (per-arch checksums) and
   `GET /api/agent/download?arch=<arch>` (headers `X-Agent-Version`,
   `X-Agent-Checksum`, `X-Agent-Arch`).
2. Temp file next to the binary → sha256 verified (**mandatory**) → chmod →
   `<new> --self-test` must print `version=<target>` → current binary copied to
   `<binary>.old` → atomic rename over the (symlink-resolved) binary.
3. Marker `/var/lib/configuratix/update-marker.json` + rollback watchdog
   (`systemd-run --on-active=120 --unit configuratix-agent-rollback-<ts>`,
   fallback: detached `sleep 120` shell). If the marker still exists when it
   fires: restore `.old`, write `update-rolled-back.json`, restart the service.
4. Final job update `completed` (the server keeps the job `running`), then
   `systemctl --no-block restart configuratix-agent` (or re-exec without systemd).
5. New process: first successful heartbeat → marker removed, watchdog unit
   stopped, `update_state: confirmed`. The server completes the job when a
   heartbeat reports the target version; reports `rolled_back` / `failed`, or
   5 minutes without confirmation, fail it.

Heartbeat `update_state` values: `downloading`, `verifying`, `installing`,
`restarting`, `confirmed`, `rolled_back`, `failed` (server additionally uses
`pending`).

---

## 7. Capabilities

`run.v2`, `steps.if`, `steps.capture`, `steps.retries`, `steps.env`,
`steps.continue_on_error`, `rollback_steps`, `file.atomic`, `file.validate`,
`vars.quote`, `vars.escape`, `action.nginx_test`, `action.assert`,
`action.script`, `action.list`, `logs.stream`, `job.cancel`, `job.timeout`,
`result.structured`, `update.v2`, `terminal.persistent`.

Agents < 0.6 report none (`agents.capabilities IS NULL`): send only v1 fields
to them (unknown v2 fields are ignored by old agents, which may change
semantics — e.g. an `if` step would run unconditionally).

---

## 8. Examples

Apply an nginx site with validation and rollback:
```json
{
  "vars": {"domain": "shop.example.com", "conf": "server { … }"},
  "on_error": "rollback",
  "timeout": 600,
  "steps": [
    {"id":"write","title":"Write site config","action":"file",
     "path":"/etc/nginx/conf.d/configuratix/{{domain}}.conf","content":"{{conf}}"},
    {"id":"test","title":"Test nginx","action":"nginx_test"},
    {"id":"reload","action":"service","name":"nginx","op":"reload"},
    {"id":"cert","title":"Issue certificate","action":"exec","timeout":600,"retries":2,"retry_delay":30,
     "if":"! test -d /etc/letsencrypt/live/{{q:domain}}",
     "command":"certbot --nginx -d {{q:domain}} --non-interactive --agree-tos -m admin@{{q:domain}}"}
  ],
  "rollback_steps": [
    {"action":"exec","command":"nginx -t && systemctl reload nginx"}
  ]
}
```

Capture and assert:
```json
{"steps":[
  {"action":"exec","command":"php -r 'echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;'","capture":"php"},
  {"action":"assert","command":"test -d /etc/php/{{q:php}}/fpm","message":"php-fpm {{php}} not installed"},
  {"action":"script","escape_vars":true,"script":"cd /etc/php/{{php}}/fpm\nsed -i 's/^memory_limit.*/memory_limit = 256M/' php.ini\nsystemctl reload php{{php}}-fpm"}
]}
```

List managed configs:
```json
{"steps":[{"id":"sites","action":"list","path":"/etc/nginx/conf.d/configuratix/*.conf"},
          {"id":"certs","action":"list","path":"/etc/letsencrypt/live/*"}]}
```
→ read `result_json.steps[0].data.entries`.
