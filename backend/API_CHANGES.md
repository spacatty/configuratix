# API changes: jobs, config apply, nginx view, dashboard

Covers migration `039_jobs_metadata.sql` and the endpoints added or changed with it.
All endpoints need `Authorization: Bearer <jwt>`. Timestamps are RFC3339 UTC. The TypeScript types are in `frontend/src/lib/api.ts`.

## Job model

### Statuses
`pending` → `running` → `completed` | `failed` | `cancelled`

- `cancelled` is new. A pending job is cancelled right away. A running job only gets `cancel_requested=true`, and the agent decides what happens next.
- Terminal statuses are `completed`, `failed` and `cancelled`.

### New columns (jobs)
`title`, `action`, `created_by`, `entity_type`, `entity_id`, `result_json`, `error_message`, `timeout_seconds`, `attempts`, `cancel_requested`, `parent_job_id` (set on retries), and `hooks_processed_at` (internal).

- `action` is the logical operation. Almost every job has `type = "run"`, so filter on `action` (or `type`, which matches either column). Values: template ids (`apply_domain`, `remove_domain`, `apply_passthrough_domain`, `apply_nginx_config`, `write_nginx_config`, `write_php_config`, `read_file`, `install_php_runtime`, `sync_php_extensions`, `remove_php_runtime`, `get_php_runtime_info`, `change_ssh_port`, `change_root_password`, `toggle_ufw`, `ufw_allow_port`, `ufw_delete_port`, `toggle_fail2ban`, `exec_command`, `speedtest_*`, …) plus `deploy_landing`, `passthrough_apply`, `passthrough_remove`, `nginx_inventory`, `nginx_test`, `nginx_reload`, `read_logs`, `reload_service`, and `update_agent` (created by the agent-update code).
- `entity_type` is one of `domain | nginx_config | machine | dns_domain | landing | php_runtime | passthrough | command | file | agent`. `entity_id` holds a domain id for domain jobs, the machine id for `machine`, `passthrough` and `php_runtime`, the path for `file`, and the template id for `command`.

### Title conventions
| action | title |
|---|---|
| apply_domain / apply_nginx_config | `Apply nginx config · shop.example.com` |
| remove_domain | `Remove domain · x.com` |
| remove_nginx_config | `Remove nginx config · x.com` |
| issue_ssl_cert | `Issue SSL certificate · x.com` |
| apply_passthrough_domain | `Apply passthrough · x.com → 10.0.0.5` |
| passthrough_apply / passthrough_remove | `Apply DNS passthrough · <machine>` / `Remove DNS passthrough · <machine>` |
| deploy_landing | `Deploy landing 'Promo' → x.com` |
| toggle_ufw / toggle_fail2ban | `Toggle UFW · enable` / `Toggle Fail2ban · disable` |
| ufw_allow_port / ufw_delete_port | `UFW allow 8080/tcp` / `UFW delete 8080/tcp` |
| change_ssh_port | `Change SSH port → 2222` |
| change_root_password | `Change root password` |
| install_php_runtime / sync_php_extensions / remove_php_runtime | `Install PHP 8.3` / `Update PHP 8.3 extensions` / `Remove PHP 8.3` |
| exec_command, terminal exec, custom reload | `Run command 'systemctl restart nginx'` (cut to 50 chars) |
| restart_service | `Restart service · nginx` |
| other templates | `Run command '<Template Name>'`, or `Network test · <Name>` for speed tests |
| read_file / write_* | `Read file /etc/nginx/nginx.conf` / `Write file /etc/nginx/nginx.conf` |
| nginx_inventory / nginx_test / nginx_reload | `Read nginx configuration` / `Test nginx configuration` / `Reload nginx` |
| read_logs | `Read logs · nginx_error` |
| update_agent | `Update agent → 0.6.0` (agent-update code) |

Jobs created before 039 get a title backfilled from their type and `vars.domain`.

### Result markers (in logs) and result_json
Transactional scripts print these lines:
```
CONFIGURATIX_RESULT|applied
CONFIGURATIX_RESULT|removed
CONFIGURATIX_RESULT|rolled_back|<reason>      (job is failed; previous state restored, nginx kept running)
CONFIGURATIX_RESULT|failed|<reason>
CONFIGURATIX_DISABLED|<path>|missing certificate <cert>
CONFIGURATIX_REENABLED|<path>
```
When a job finishes, `jobhooks.OnJobFinished` parses these lines and merges `{"apply": {"status","reason","disabled":[],"reenabled":[]}}` into `result_json`. It never overwrites keys the agent wrote. If the job failed and the agent set no `error_message`, the hook fills it, for example `Rolled back: nginx -t failed: [emerg] unknown directive "foo" in …`.

## Jobs API

### GET /api/jobs
Scoped like the machines list: a superadmin sees every job. Other users see jobs whose machine they own, or whose machine belongs to a project they own or are an approved member of.

Query parameters (all optional): `machine_id`, `agent_id`, `status` (comma list, e.g. `failed,cancelled`), `type` (matches `type` or `action`), `action`, `entity_type`, `entity_id`, `q` (title ILIKE), `since` (RFC3339 or a duration like `24h`), `limit` (default 50, max 200), `cursor`, `include_logs=1` (adds a redacted `logs` tail of 20 KB; kept for the legacy machine page).

Response:
```json
{
  "jobs": [{
    "id": "uuid", "title": "Apply nginx config · shop.example.com", "type": "run", "action": "apply_domain",
    "status": "failed", "agent_id": "uuid", "machine_id": "uuid", "machine_title": "web-1", "machine_hostname": "web-1",
    "entity_type": "domain", "entity_id": "uuid", "created_by_email": "a@b.c",
    "created_at": "…", "started_at": "…", "finished_at": "…", "duration_ms": 5321,
    "error_message": "Rolled back: nginx -t failed: …", "attempts": 0, "cancel_requested": false, "parent_job_id": null
  }],
  "next_cursor": "opaque-or-null",
  "counts": {"pending": 0, "running": 1, "completed": 40, "failed": 2, "cancelled": 0}
}
```
`counts` applies every filter except `status` and `cursor`, so it can drive status tabs. To get the next page, send `cursor=<next_cursor>` with the same filters. List rows never include the payload.

### GET /api/jobs/{id}
Returns the list fields plus:
```json
{ "timeout_seconds": 480, "updated_at": "…", "logs": "full logs, secrets replaced by ••••••",
  "payload": {"steps": […], "vars": {"domain": "x.com", "password": "••••••"}, "on_error": "stop"},
  "result_json": {"apply": {"status": "rolled_back", "reason": "…"}}, "retries": ["uuid"] }
```
Redaction rules:
- Values whose keys match password, passwd, pass, secret, token, key, apikey or credentials (whole word or `_`-separated) become `••••••`, and those values are also removed from the logs.
- File content or config text that contains `password=`, `token:` or a PRIVATE KEY block becomes `[redacted: content contains credentials]`.
- In a command, the value part of `password=...` assignments is masked.

The root password never appears: it travels base64-encoded in `vars.password`, which is masked, and its encoded value is stripped from the logs.

### POST /api/jobs/{id}/cancel
Needs manage rights on the machine.
- Pending job: `200 {"id","status":"cancelled","cancel_requested":true}`.
- Running job: `200 {"id","status":"running","cancel_requested":true}`.
- Finished job: `409`.

### POST /api/jobs/{id}/retry
Works only on `failed` or `cancelled` jobs; anything else returns `409`. The job is cloned with `parent_job_id=<id>`, `attempts+1`, a fresh `vars.txn`, and `created_by` set to the caller. For a domain job, the domain's `last_job_id` points at the new job and `apply_status` becomes `pending`. Response: `201` with a JobCreated object (below).

### GET /api/jobs/stats?hours=24 (max 720)
```json
{ "hours": 24, "since": "…", "total": 120,
  "counts": {"pending":0,"running":1,"completed":110,"failed":9,"cancelled":0},
  "buckets": [{"hour": "2026-11-05T10:00:00Z", "pending":0,"running":0,"completed":4,"failed":1,"cancelled":0}],
  "top_failing": [{"type": "apply_domain", "failed": 5, "total": 20}],
  "avg_duration_ms": 8123 }
```
`buckets` has one entry per hour, including hours with no jobs, in ascending order.

### POST /api/jobs (raw create)
Superadmin only, and nothing in the UI uses it. Body: `{"agent_id","type","payload","title"?}`. Returns `201` with a JobCreated object.

### JobCreated (returned wherever a job is created)
```json
{"id","job_id","agent_id","type","action","title","status","entity_type","entity_id","payload"(redacted),"created_at"}
```
These endpoints now return this object instead of the raw job, which used to include an unredacted payload: `POST /api/commands/execute` (201, and it now requires manage rights on the machine and returns 400 for invalid or unsafe variables), `POST /api/machines/{id}/ssh-port|root-password|ufw|ufw/rules|fail2ban`, `DELETE /api/machines/{id}/ufw/rules`, and `POST /api/machines/{id}/tools/speedtest`.

## Domains

List and detail responses (`GET /api/domains`, `GET /api/domains/{id}`) gain:
```json
"apply_status": null | "pending" | "applying" | "applied" | "failed" | "removing",
"last_job_id": "uuid|null", "last_apply_error": "string|null", "last_applied_at": "…|null",
"last_job_status": "pending|running|completed|failed|cancelled|null",
"config_updated_at": "…|null", "out_of_sync": true
```
`out_of_sync` is true when the domain has a machine and a config and `last_applied_at` is null or older than the config's `updated_at`.

Lifecycle:
- On assign or apply, `apply_status` becomes `pending` (or `removing` when the domain is unassigned).
- `jobhooks.OnJobStarted` sets `applying` or `removing`, but only if the job runner calls it. The UI can also read `last_job_status=running`.
- On success, `applied` and `last_applied_at=now`, and `status` moves from `idle` to `linked`. After a successful removal `apply_status` is cleared.
- On failure, `failed` with `last_apply_error`.

Existing assigned domains are backfilled as `applied` at their `updated_at`.

- `PUT /api/domains/{id}/assign` now returns `{"message":"Domain assigned","job_id":"<main apply job>","jobs":[JobCreated…]}`.
- **New:** `POST /api/domains/{id}/apply` re-applies the domain's current machine and config. It returns `202 {"jobs":[JobCreated…],"job_id":"<apply job>"}`, or `400` when the domain has no machine or config.

## Nginx configs

`GET /api/nginx-configs`, `GET /api/nginx-configs/{id}` and `PUT /api/nginx-configs/{id}` now add:
```json
"domains_count": 3, "out_of_sync_count": 1,
"domains": [{"id","fqdn","machine_id","machine_title","apply_status","last_applied_at","last_apply_error","last_job_id","out_of_sync"}]
```
Updating a config no longer pushes anything to machines; the domains using it become `out_of_sync`.

**New:** `POST /api/nginx-configs/{id}/apply`
- Body (optional): `{"domain_ids":["…"], "only_out_of_sync": true}`.
- Response: `202 {"config_id","results":[{"domain_id","fqdn","job_id"?,"jobs"?,"error"?}],"jobs":[JobCreated…]}`.
- Domains without a machine, or on a machine the caller can't manage, get an `error` entry instead of a job.

## Transactional apply (works with every agent version)

These operations now use one pattern: `apply_domain`, `remove_domain`, `apply_passthrough_domain`, `apply_nginx_config`, `remove_nginx_config`, `write_nginx_config` (the configs write API for `/etc/nginx/*`), `write_php_config` (for `/etc/php/*`), `configure_php_fpm_pool`, and passthrough ApplyToMachine / RemoveFromMachine.

1. New content is written to `/var/lib/configuratix/staging/<txn>/`.
2. Each file that will be touched is recorded (its content, or the fact that it was absent) in `/var/lib/configuratix/backups/<txn>/`. The 30 most recent transactions are kept.
3. The files are installed atomically (temporary file in the same directory, then `mv`), followed by `nginx -t` or `php-fpm -t`.
4. If anything fails, everything is restored, the config is tested again, nginx is reloaded or started so it keeps running, and the script prints `CONFIGURATIX_RESULT|rolled_back|…` and exits non-zero.

For certbot standalone, nginx is stopped only around certbot and is always started again by an EXIT trap. Configs disabled earlier for missing certificates (`*.conf.disabled`) are re-enabled once their certificates exist. Each disable and re-enable is reported with the markers above.

All template variables are validated on the server: FQDN regex, numeric ports, cleaned absolute paths, emails, PHP versions, and so on. Secrets and other free text that ends up in shell are base64-encoded. Invalid input returns `400` from the endpoints, and a job payload built from bad input fails safely without ever reaching shell.

## Machine nginx view

### GET /api/machines/{id}/nginx[?job_id=]
Needs view rights. Runs a read-only inventory job and waits about 20 seconds. If the agent is slower the response is `202 {"pending":true,"job_id","status"}`; call again with `?job_id=` to get the parsed result. It returns `502` if the job ran but produced no inventory.
```json
{ "machine_id","job_id","fetched_at",
  "nginx": {"active": true, "state": "active", "test_ok": true, "test_output": "nginx: … test is successful", "version": "nginx/1.24.0"},
  "files": [{
    "path": "/etc/nginx/conf.d/configuratix/shop.example.com.conf", "name": "shop.example.com.conf",
    "category": "configuratix_domain|configuratix_passthrough|configuratix_stream|configuratix_snippet|system|site|other",
    "state": "active|disabled|backup|inactive", "size": 1234, "mtime": "…", "sha256": "…", "link_target": "",
    "managed": true, "domain_fqdn": "shop.example.com", "domain_id": "uuid", "nginx_config_id": "uuid",
    "expected_sha256": "…", "drift": false }],
  "missing_domains": [{"domain_id","fqdn","expected_path","nginx_config_id"}] }
```
- Files scanned: `/etc/nginx/nginx.conf`, `conf.d/*`, `conf.d/configuratix/*`, `stream.d/*`, `sites-enabled/*`, `sites-available/*`, `snippets/configuratix*`. This includes `*.disabled`, `*.disabled-by-manual`, `*.bak` and `*.configuratix-backup`.
- `state`: `disabled` means a `.disabled*` suffix. `backup` means `.bak`, `.configuratix-backup`, `~` or `.dpkg-*`. `inactive` means the file isn't matched by an nginx include (a non-`.conf` file in conf.d, or a sites-available file with no sites-enabled link).
- `expected_sha256` and `drift` come from rendering what the database would write: for active domain files and for the DNS-passthrough files (`stream.d/configuratix-passthrough.conf`, `passthrough-dns-http.conf`, `passthrough-dns-l7.conf`).
- `missing_domains` lists domains assigned to this machine in the database that have no active config file. Passthrough-mode domains are left out.

### POST /api/machines/{id}/nginx/test[?wait=0]
Needs manage rights. Runs `nginx -t` and waits up to 20 seconds. Returns `{"job_id","status","finished","test_ok","output"}`. With `wait=0` it returns `202` with a JobCreated object instead.

### POST /api/machines/{id}/nginx/reload[?wait=1]
Needs manage rights. Runs `nginx -t` and then reloads, or starts nginx if it isn't running; it never reloads a config that fails the test. By default it returns `202` with a JobCreated object; with `wait=1` it returns the same shape as `/test`.

### File read/write (existing endpoints, now hardened)
- `POST /api/machines/{id}/configs/read` with `{"path"}` returns `{"content","path","job_id"}`. Needs view rights.
- `POST /api/machines/{id}/configs/write` with `{"path","content","async"?}` returns `{"success","path","job_id","logs"|"error"}`, or `202 {"success","path","job_id"}` when `async:true`. Needs manage rights. Writes to nginx files are transactional (backup, `nginx -t`, restore). PHP files are tested with `php-fpm -t`. `sshd_config` is tested with `sshd -t` and the agent rolls it back on failure.
- Paths are cleaned (`path.Clean`, safe characters only) and checked against an allowlist: `/etc/nginx/**`, `/etc/php/**`, `/etc/fail2ban/**`, `/etc/letsencrypt/renewal/**`, `/etc/ssh/sshd_config`, `/root/.ssh/authorized_keys`, plus the machine's custom config paths (exact match). Traversal like `/etc/nginx/../shadow` returns `403`.
- `GET /api/machines/{id}/configs` now fills "Configuratix Sites" with the files of domains assigned to this machine. All configs and category endpoints now check permissions: view rights for list and read, manage rights for write and category changes.

## Dashboard

### GET /api/dashboard
Permission-scoped the same way as the jobs list.
```json
{ "generated_at": "…",
  "machines": {"total","online","offline","outdated_agents": 2|null,"updating","latest_agent_version": "0.6.0"|null},
  "domains": {"total","healthy","unhealthy","unknown","apply_failed","applying","ssl_expiring_soon": 1|null},
  "nginx_configs": {"total","out_of_sync","out_of_sync_domains"},
  "jobs": {"last24h": JobCounts, "total_24h", "buckets": [hourly], "top_failing": […], "running",
           "recent_failed": [{"id","title","machine_id","machine_title","finished_at","error_message"}]},
  "security": {"active_bans","bans_24h"} | null,
  "top_machines_by_cpu": [{"id","title","cpu","mem_pct","disk_pct","online"}] }
```
- A machine is online if the agent was seen in the last 5 minutes.
- `ssl_expiring_soon` counts tracked L7 proxy certificates that expire within 30 days.
- `security` counts the global ban table.
- `nginx_configs.out_of_sync` counts configs that have at least one out-of-sync domain.

## Machines
`GET /api/machines` and `GET /api/machines/{id}` add `group_names: [{"id","name","color","emoji"}]`.

## PHP runtime
Install, update and remove jobs are linked as `entity_type=php_runtime` with `entity_id=<machine id>`. Runtime status (`installed`/`failed`, or deletion after a remove) is updated by `jobhooks.OnJobFinished` instead of in-memory goroutines, so it survives server restarts. These endpoints now check view or manage rights on the machine.

## Backend internals (for other backend work)
- `internal/jobs`: `jobs.Create(ctx, q, jobs.Spec{…})` is the only way to insert a job. `jobs.FromTemplate(id, vars)` validates the variables and builds payload, title and action. `jobs.UserID(r)` returns the caller's user id.
- `internal/jobhooks`:
  - `OnJobFinished(ctx, db, jobID)` is idempotent: it claims the job through `hooks_processed_at`.
  - `OnJobStarted(ctx, db, jobID)` is optional.
  - `StartSweeper(ctx, db)` runs every 15 seconds and processes terminal jobs whose hooks haven't run.
- `models.JobColumns` is an explicit column list; use it instead of `SELECT * FROM jobs`.
- `templates.ShellQuote`, `templates.ValidFQDN`, `templates.CleanAbsPath`, `templates.TxnPrelude(txn)` and `templates.TxnShellLib` are the helpers for building shell scripts in Go.

## Follow-up changes

### Domain delete removes the config from the machine
- `DELETE /api/domains/{id}` requires access to the domain and now returns `200 {"deleted":1,"jobs":[JobCreated…],"warnings":[…]}` instead of `204`. It returns `404` if the domain doesn't exist.
- `POST /api/domains/bulk/delete` returns the same shape, with `deleted` set to the number of rows deleted.
- Each assigned domain gets a transactional `remove_domain` job (`Remove domain · x.com`) on its machine, created in the same database transaction as the delete.
- When a domain's name can't be cleaned up safely (an invalid legacy name), the domain is still deleted and a `warnings` entry explains why.

### Nginx config permissions
`GET`, `PUT`, `DELETE` and `POST …/apply` on `/api/nginx-configs/{id}` follow the list visibility rule: superadmin, the owner, or configs with no owner (legacy shared configs).
- `GET` on a config the caller can't see returns `404`.
- `PUT`, `DELETE` and `apply` return `403`.
- `apply` also needs manage rights on each domain's machine; any domain that fails this gets a per-domain `error` entry.

### Retry
- Retrying a `passthrough_apply` or `passthrough_remove` job doesn't clone the payload. It renders the config again from the current database state, with a fresh transaction id and fresh backups. The response is `201` with a JobCreated object, which has `parent_job_id` set.
- It returns `409` if the machine has nothing left to configure.
- Retries of template jobs get a fresh `vars.txn`.

### Validation rules (400 messages are meant to be shown to users)
Errors are plain text, for example:
- `"a.b" is not a valid domain name (use letters, digits, hyphens or underscores per label, …)`
- `"x" is not a valid email address`
- `port must be a port number between 1 and 65535 (got "x")`
- `"…" must be an absolute path without spaces, quotes or shell characters`

Rules:
- **Domains** are trimmed, lowercased, and have a trailing dot removed. IDN names are converted to punycode (`bücher.de` → `xn--bcher-kva.de`), and that punycode form is used for `server_name`, file names and certbot. Underscores are allowed in labels (`_dmarc.example.com`).
- **Wildcards** (`*.example.com`) work for HTTP configs. SSL needs an existing certificate at `/etc/letsencrypt/live/*.example.com/`, because certbot standalone can't issue wildcards; the job fails with a clear reason and restores the previous state. Passthrough configs reject wildcards with `400`.
- **Emails** follow RFC 5322 addr-spec (via `net/mail`), so `o'brien@example.com` and `first.last+tag@sub.example.co` are valid. Emails are sent base64-encoded to the machine.
- **Assign:** `PUT /api/domains/{id}/assign` returns `400` (not `500`) for validation errors.

### Other fixes
- `PUT /api/machines/{id}/php` with no existing runtime now installs correctly. It used to try to read the request body a second time.
- Job rows with a NULL `result_json`, `payload_json`, `status` or `created_at` scan correctly. `models.NullRawMessage` is a new type for nullable JSONB.
