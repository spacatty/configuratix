# Configuratix UI system — read this before building a page

Everything here is exported from `@/components/app` (one import line). shadcn primitives live in
`@/components/ui/*`. Helpers: `@/lib/format`, `@/lib/jobs`, `@/lib/fuzzy`, `@/hooks/use-polling`.

```tsx
import { PageHeader, SectionCard, StatCard, StatusBadge, useConfirm, trackJob, usePolling } from "@/components/app";
```

---

## 1. Conventions (non-negotiable)

| Topic | Rule |
| --- | --- |
| Page root | `<div className="space-y-6">` → `<PageHeader …/>` first, then content blocks. The layout already gives `px-4 md:px-6 lg:px-8 py-6` and `max-w-[1600px]`; never add outer padding. |
| Spacing | Between page blocks `space-y-6`. Inside cards `space-y-4`/`gap-4`. Stat grids `grid gap-3 sm:grid-cols-2 lg:grid-cols-4`. Two-column detail `grid gap-4 lg:grid-cols-3` (main `lg:col-span-2`). |
| Type | Body 13px (`text-[13px]`), meta 12px (`text-xs`), labels sentence case — **no uppercase tracked labels**. Page title is PageHeader's 20px. Section titles 14px (SectionCard). |
| Data text | IPs, hostnames, IDs, versions, ports, durations, paths, counts in tables → `<Mono>` or `className="font-data"` (mono + tabular + slashed zero). Numbers right-aligned in tables: `meta: { align: "right" }`. |
| Colour | Brand red (`primary`) = primary button, focus, active nav, selection only. Status colour comes **only** from `StatusBadge`/`StatusDot`/`Badge` tone variants. Never hardcode `green-500`/`red-500`/`blue-400`. Tokens: `success`, `warning`, `info`, `destructive`, `muted-foreground`, `subtle-foreground`, `surface-2`, `border-strong` — all work with opacity (`bg-success/12`). |
| Danger | `destructive` (vermilion) ≠ brand red. Destructive actions: `<Button variant="destructive">` (tinted) in lists/toolbars, `variant="destructive-solid"` only as the final confirm. Always with an icon (`Trash2`, `Ban`, …). |
| Confirm | **Never** `window.confirm()` / `alert()`. Use `useConfirm()` / `useAlert()`. |
| Jobs | **Every** API call that returns a `Job` (or `{job_id}`) → `trackJob(job, { title })`. Never `toast.success("Job created")`. |
| Entity selection | Machines / domains / nginx configs are chosen with `MachinePicker` / `DomainPicker` / `NginxConfigPicker`, never `<Select>` or checkbox lists. `<Select>` is for small static enums (≤ 8 options). For 2–4 options prefer `ToggleGroup` or `RadioGroup`/`RadioCard`. |
| Sheet vs Dialog | **Dialog**: short focused forms (≤ ~6 fields), confirmations, create flows. **Sheet** (right, `sm:max-w-xl`/`2xl`): inspecting/editing one row from a table without leaving the list, logs, long forms, anything the user reads while referencing the page. Full page: entity detail with tabs (`/machines/[id]`). |
| Tables | `DataTable` with default density (40px rows). Row click → detail (`onRowClick`). Actions column: one ghost `icon-sm` kebab `DropdownMenu` on the right, `meta: { align: "right" }`. Status column uses `StatusText` (dot + label) for density, `StatusBadge` elsewhere. |
| Loading | First load: `PageSkeleton` / `TableSkeleton` / `DataTable loading` / `CardSkeleton`. Background refresh: never flash skeletons (`usePolling` handles it). Buttons doing work: `disabled` + `<Spinner />` inside. |
| Empty / error | `EmptyState` (with a primary action when there is one) and `ErrorState onRetry`. Missing values print `—` (`EM_DASH`), real zeros print `0`. |
| Time | Relative times with `<RelativeTime date=… />` (tooltip shows absolute). Absolute: `formatDateTime()` in mono. Durations `formatDuration(ms)`. |
| Icons | lucide only, 16px default (`size-4`), 14px in dense rows (`size-3.5`). Grey unless they carry status. No icons inside coloured circles. |
| Toasts | `toast.success/error/info/warning` from `sonner` (Toaster is mounted in both layouts). Errors: `toast.error("Couldn't delete domain", { description: errorMessage(e) })`. |
| Breadcrumbs | Top bar derives them from the URL. On detail pages set a human label: `useBreadcrumbLabel(machine ? machineDisplayName(machine) : null)`. |

Status → colour mapping (single source `getStatusMeta` in `status.tsx`):

| Tone | Statuses |
| --- | --- |
| success (green) | online, completed, succeeded, healthy, success, ok, active, enabled, approved |
| info (blue, pulses) | running, checking |
| warning (amber) | stale, degraded, paused, warning, rolled_back |
| destructive (vermilion) | offline, failed, unhealthy, error, denied, expired |
| muted (grey) | pending, queued, cancelled, unknown, disabled, inactive, anything unknown |

Pulse: `online`, `running`, `checking`. Machine liveness (`machineLiveness(m)` in `@/lib/jobs`): seen ≤ 5 min → `online`, ≤ 60 min → `stale`, else/never → `offline`.

---

## 2. Layout primitives

### `PageHeader`
```ts
{ title: ReactNode; description?: ReactNode; icon?: LucideIcon | ReactElement; actions?: ReactNode;
  back?: { href: string; label?: string }; breadcrumbs?: { label: ReactNode; href?: string }[];
  badge?: ReactNode; meta?: ReactNode }
```
```tsx
<PageHeader icon={Server} title="Machines" description="Agents enrolled in this workspace."
  actions={<><Button variant="outline" onClick={refresh}><RefreshCw />Refresh</Button><Button><Plus />Enroll machine</Button></>} />
<PageHeader back={{ href: "/machines", label: "Machines" }} title={name} badge={<StatusBadge status={live} />}
  meta={<><Mono>{ip}</Mono><span>Agent <Mono>{m.agent_version}</Mono></span></>} actions={…} />
```
Primary action last (right-most). At most one `default` (red) button per header.

### `SectionCard`
```ts
{ title?; description?; icon?: LucideIcon; actions?: ReactNode; footer?: ReactNode; flush?: boolean; bodyClassName?; …section props }
```
Body has `p-4`; `flush` removes it for edge-to-edge tables/lists. Prefer this over raw `Card`.

### `StatCard` / `StatStrip`
```ts
StatCard { label; value; suffix?; sub?; delta?: number | ReactNode; deltaInverse?: boolean; icon?: LucideIcon;
  tone?: "default"|"primary"|"success"|"warning"|"destructive"|"info"; progress?: number (0–100);
  progressTone?: "default"|"success"|"warning"|"destructive"|"info"|"muted"|"auto"; children?; href?; loading? }
```
`tone` colours the number + a 2px left bar — use only when the value needs attention (e.g. unhealthy > 0). `delta` number shows signed, green when good (`deltaInverse` for "lower is better"). `children` slot for a mini chart. `StatStrip` = one divided card holding several `StatCard`s.

---

## 3. Status

```ts
StatusBadge { status: string; label?; indicator?: "dot"|"icon"|"none"; tone?: StatusTone; size?: "sm"|"md" }
StatusDot   { status?: string; tone?: StatusTone; pulse?: boolean; size?: "xs"|"sm"|"md" }
StatusText  { status: string; label? }          // dot + plain text, for tables
getStatusMeta(status) → { tone, label, pulse, icon }
```
`<StatusBadge status={job.status} />`, `<StatusDot status={machineLiveness(m)} />`, `<StatusText status={domain.status} />`.

`Badge` variants (generic labels, not statuses): `default` (brand tint), `solid`, `secondary`, `outline`, `muted`, `success`, `warning`, `info`, `destructive`.

---

## 4. States

```ts
EmptyState { icon?: LucideIcon; title; description?; action?; secondaryAction?; size?: "compact"|"default"; bordered? }
ErrorState { title?; error?: unknown; onRetry?: () => unknown; size?; bordered? (default true) }
LoadingState { label?; size? }      Spinner (svg, size-4)
TableSkeleton { rows?=6; columns?=5; showHeader? }   CardSkeleton { lines?; header? }
StatGridSkeleton { count?=4 }       PageSkeleton { stats? }
errorMessage(e: unknown): string
```
Pattern:
```tsx
const { data, loading, error, refresh } = usePolling(() => api.listDomains(), 15000);
if (loading) return <PageSkeleton />;
if (error && !data) return <ErrorState error={error} onRetry={refresh} />;
```

---

## 5. Confirm / alert

```ts
useConfirm(): (o: ConfirmOptions) => Promise<boolean>
useAlert():   (o) => Promise<void>
ConfirmOptions { title; description?; details?: ReactNode; confirmText?; cancelText?; destructive?; icon?;
                 typeToConfirm?: string; onConfirm?: () => Promise<unknown>; alertOnly? }
<ConfirmDialog open onOpenChange … /> (controlled variant)
```
```tsx
const confirm = useConfirm();
const ok = await confirm({ title: `Delete ${d.fqdn}?`, description: "Nginx config is removed from the machine.",
  destructive: true, confirmText: "Delete domain", onConfirm: () => api.deleteDomain(d.id) });
if (ok) { toast.success("Domain deleted"); refresh(); }
```
With `onConfirm` the dialog shows a spinner, stays open and toasts on error; resolves `true` only after success.
Use `typeToConfirm={machineName}` for deleting machines, projects, DNS zones, “unban all”.

---

## 6. Data display

```ts
Mono { muted?; truncate?; fallback? (default "—"); …span }
CopyButton { value; toastMessage?: string|false; label?; size?: "xs"|"sm"|"md"; onCopied? }
CopyableMono { value; display?; className?; monoClassName?; copyLabel? }   // mono + copy on hover
RelativeTime { date; fallback?; noTooltip?; mono? (default true) }          // "3m ago", refreshes every 15s
KeyValueList { items: KeyValueItem[]; columns?: 1|2|3; labelWidth?: number (140) }
KeyValueItem { label; value; mono?; copy?: string|null; hint?; full?; hidden? }
LogViewer { logs; live?; maxHeight?; emptyText?; title?; actions?; className? }
```
`LogViewer`: line numbers, error/warn/success colouring, sticky auto-scroll ("Follow" when the user scrolls up), wrap toggle, copy. Use for job logs, command output, file previews.

---

## 7. Pickers (cmdk, fuzzy)

Generic (`@/components/ui/combobox`):
```ts
Combobox<T>      { items; getValue; getLabel; getKeywords?; renderItem?; renderValue?; getGroup?; groupOrder?;
                   isItemDisabled?; value: string|null; onValueChange(id|null, item|null); clearable?;
                   placeholder?; searchPlaceholder?; emptyText?; disabled?; loading?; className?;
                   contentClassName?; align?; modal? (default true — keep inside Dialog/Sheet); footer?; size?: "sm"|"default" }
MultiCombobox<T> { …same; value: string[]; onValueChange(ids, items); maxChips? (3); renderChip?; showBulkActions? (true); clearable? }
```
Search is fuzzy over label + keywords; multi-word queries AND (`"fra 49.12"`).

Entity pickers (`@/components/app`) — load themselves (cached 30s) when the list prop is omitted:
```tsx
<MachinePicker value={machineId} onValueChange={(id, m) => setMachineId(id)} clearable />
<MachinePicker multiple value={ids} onValueChange={setIds} machines={machines} groupBy="status" disableOffline />
<DomainPicker value={domainId} onValueChange={(id) => …} filter={(d) => !d.assigned_machine_id} />
<NginxConfigPicker value={configId} onValueChange={(id) => …} clearable />
```
MachinePicker props: `machines?`, `projectId?`, `groupsByMachine?: Record<id, string[]>` (group names → hints + search), `filter?`, `disableOffline?`, `groupBy?: "project"|"status"|"none"`. Rows: status dot, title, hostname (mono), IP (mono, right), project · groups.
DomainPicker: `domains?`, `filter?`, `groupBy?: "machine"|"none"`. NginxConfigPicker: `configs?`, `filter?`.
After creating/deleting entities call `invalidatePickerCache("machines" | "domains" | "nginx-configs")`.

---

## 8. DataTable (`@/components/ui/data-table`)

Backwards compatible with the old props. New ones:
```ts
searchKeys?: (keyof T | (row) => string|…)[]   // global search fields (default: all primitive fields)
search? / onSearchChange?                         // controlled search (e.g. ?q=)
hideSearch?; toolbar?: ReactNode (left); toolbarActions?: ReactNode (right)
facets?: { columnId; title; options?: { label; value; icon? }[] }[]   // multi-select chips with counts
columnFilters? / onColumnFiltersChange?            // controlled facet state (e.g. sync to URL, see /machines)
loading?; skeletonRows?; emptyState?: ReactNode (when data is empty); emptyMessage? (when filtered to 0)
onRowClick?(row, e)       // ignores clicks on buttons/links/checkboxes/[data-no-row-click]
density?: "compact"|"default"; stickyHeader? (true); maxHeight? (scroll area; "none" disables)
enableRowSelection + getRowId + bulkActions?: (selected: T[], clear) => ReactNode   // floating bar
initialState?: { sorting?; columnVisibility? }; bordered? (true)
```
Column `meta`: `{ label?, align?: "left"|"center"|"right", className?, headerClassName? }`.
A selection checkbox column is added automatically when `enableRowSelection` and no column has `id: "select"` (or use `selectionColumn<T>()`).
String headers on sortable columns get a sort button automatically; for custom headers use
`header: ({ column }) => <DataTableColumnHeader column={column} title="Last seen" align="right" />`.
Facet columns need a value accessor (`accessorKey` or `accessorFn`) returning a string (or string[]).
Also exported: `DataTableFacetedFilter`, `DataTableViewOptions`, `DataTablePagination`, `BulkActionBar`, `SortableHeader` (legacy).

```tsx
<DataTable columns={columns} data={machines ?? []} loading={loading} getRowId={(m) => m.id}
  searchKeys={["title", "hostname", "ip_address", "project_name"]} searchPlaceholder="Search machines…"
  facets={[{ columnId: "status", title: "Status" }, { columnId: "project_name", title: "Project" }]}
  onRowClick={(m) => router.push(`/machines/${m.id}`)}
  enableRowSelection bulkActions={(rows, clear) => <Button size="sm" variant="destructive" onClick={…}><Trash2 />Delete</Button>}
  emptyState={<EmptyState icon={Server} title="No machines yet" action={…} />} />
```

---

## 9. Jobs

```ts
trackJob(job: Job | {id} | {job_id} | string, opts?: TrackJobOptions): Promise<Job | null>
TrackJobOptions { title?; description?; onDone?(job); onSuccess?(job); onFailure?(job); intervalMs? (1500); timeoutMs? (15 min); quietSuccess? }
useJobTracker(): { trackJob, openJobLogs, trackedIds }
openJobLogs(job | id)
<JobLogsSheet jobId initialJob? open onOpenChange />   // usually opened via openJobLogs
<JobsIndicator />                                      // top bar, already mounted
humanizeJobType(type) · jobTitle(job) · isJobActive(job) · jobDurationMs(job)
```
```tsx
const job = await api.changeSSHPort(machine.id, port);
trackJob(job, { title: `Change SSH port → ${port}`, description: machineDisplayName(machine), onSuccess: () => refresh() });
```
The toast shows pending → running (with elapsed time) → completed/failed with a “View logs” action. Don't await it
unless the next step depends on the result. `Job` has optional `title, target, machine_id, machine_name,
machine_title, triggered_by, error_message, duration_ms, rollback_status` — always display `jobTitle(job)`.

---

## 10. Polling

```ts
usePolling<T>(fn: () => Promise<T>, intervalMs: number, { enabled?, immediate?, pauseWhenHidden?, deps? })
  → { data, error, loading /* first load only */, refreshing, updatedAt, refresh(), setData }
```
Pauses while the tab is hidden, refetches on return, never overlaps requests, `loading` never flips back on
background ticks. Use `interval 0` to fetch once. After a mutation call `refresh()` (or `setData` optimistically).

---

## 11. Shell (already mounted — don't re-mount)

`(dashboard)/layout.tsx` mounts: `TooltipProvider`, `ConfirmProvider`, `JobTrackerProvider`, `BreadcrumbLabelProvider`,
`CommandPaletteProvider` (⌘K / Ctrl+K: pages, machines, domains), `Toaster`, sidebar, sticky top bar
(`RouteBreadcrumbs`, `CommandPaletteTrigger`, `JobsIndicator`). `(auth)/layout.tsx` mounts Toaster + ConfirmProvider and
the centered grid backdrop; auth pages use `AuthCard`, `AuthField`, `AuthError`.
Other exports: `useCommandPalette().open()`, `useBreadcrumbLabel(label, href?)`, `BrandedLoader`, `AppBackdrop`,
`NAV_SECTIONS` (single nav config — add new pages there, sidebar + palette + breadcrumbs pick them up).
Command palette domain results navigate to `/domains?q=<fqdn>` — the domains page should read `q` into its table search.

## 12. New shadcn components

`command`, `combobox`, `breadcrumb`, `progress` (`tone`, `tone="auto"` for usage bars, `size="sm"`), `hover-card`,
`radio-group` (+ `RadioCard`), `toggle`, `toggle-group` (segmented control), `alert` (`default|info|success|warning|destructive`,
icon first child), `kbd` (`Kbd`, `KbdGroup`), `sonner` (`Toaster`). Button sizes: `xs, sm, default (32px), lg, icon-xs, icon-sm, icon, icon-lg`;
variants: `default, destructive, destructive-solid, outline, secondary, ghost, link`.

Utilities in `globals.css`: `bg-grid`, `bg-grid-fade`, `bg-noise`, `font-data`, `glow-primary`, `skeleton-shimmer`,
`animate-fade-in-up`, `animate-pulse-dot`, `shadow-elevated`, `shadow-glow`.
