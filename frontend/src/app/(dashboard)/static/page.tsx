"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, ExternalLink, FolderArchive, LayoutGrid, Link2, MoreHorizontal, Rows3, Search, Trash2, UploadCloud, X } from "lucide-react";
import { api, type Landing } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CardSkeleton, EmptyState, ErrorState, Mono, PageHeader, RelativeTime, errorMessage, useConfirm, usePolling } from "@/components/app";
import { formatBytes } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { LandingThumbnail, landingPreviewUrl, landingTypeIcon } from "@/components/static/landing-thumbnail";
import { LandingUploadDialog } from "@/components/static/landing-upload-dialog";

type View = "grid" | "table";
const VIEW_KEY = "static.view";

const TYPE_VARIANT: Record<string, "info" | "default" | "warning" | "muted"> = {
  html: "info",
  php: "default",
  asset: "warning",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={TYPE_VARIANT[type] ?? "muted"} className="font-data">
      {type}
    </Badge>
  );
}

export default function StaticContentPage() {
  const confirm = useConfirm();
  const { data, loading, error, refresh, setData } = usePolling(() => api.listLandings(), 60000);
  const landings = useMemo(() => data ?? [], [data]);
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "table") setView(v);
    } catch {
      /* ignore */
    }
  }, []);
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const types = useMemo(() => [...new Set(landings.map((l) => l.type))].sort(), [landings]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return landings.filter(
      (l) =>
        (type === "all" || l.type === type) &&
        (!q || [l.name, l.file_name, l.owner_name, l.owner_email].some((s) => s?.toLowerCase().includes(q)))
    );
  }, [landings, query, type]);

  const download = async (l: Landing) => {
    try {
      await api.downloadStatic(l.id, l.file_name);
    } catch (e) {
      toast.error("Download failed", { description: errorMessage(e) });
    }
  };

  const remove = async (list: Landing[], clear?: () => void) => {
    const one = list.length === 1;
    const ok = await confirm({
      title: one ? `Delete ${list[0].name}?` : `Delete ${list.length} uploads?`,
      description: "The archive and its preview are removed. Domains serving this content stop working until reassigned.",
      destructive: true,
      confirmText: "Delete",
      onConfirm: async () => {
        for (const l of list) await api.deleteLanding(l.id);
      },
    });
    if (ok) {
      toast.success(one ? `${list[0].name} deleted` : `${list.length} uploads deleted`);
      const ids = new Set(list.map((l) => l.id));
      setData((prev) => prev?.filter((l) => !ids.has(l.id)));
      clear?.();
      refresh();
    }
  };

  const actions = (l: Landing) => {
    const url = landingPreviewUrl(l);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Actions" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {url && (
            <>
              <DropdownMenuItem onClick={() => window.open(url, "_blank", "noopener")}>
                <ExternalLink />
                Open preview
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  if (await copyToClipboard(url)) toast.success("Preview link copied");
                }}
              >
                <Link2 />
                Copy preview link
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onClick={() => download(l)}>
            <Download />
            Download ZIP
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => remove([l])}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const columns: ColumnDef<Landing>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const l = row.original;
        const Icon = landingTypeIcon(l.type);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{l.name}</div>
              <Mono muted className="block truncate text-xs">{l.file_name}</Mono>
            </div>
          </div>
        );
      },
    },
    { accessorKey: "type", header: "Type", cell: ({ row }) => <TypeBadge type={row.original.type} /> },
    {
      accessorKey: "file_size",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Size" align="right" />,
      meta: { align: "right" },
      cell: ({ row }) => <Mono>{formatBytes(row.original.file_size)}</Mono>,
    },
    {
      id: "owner",
      accessorFn: (l) => l.owner_name || l.owner_email || "",
      header: "Owner",
      cell: ({ getValue }) => <span className="text-[13px] text-muted-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Uploaded" />,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
      sortingFn: "datetime",
    },
    { id: "actions", enableHiding: false, meta: { align: "right" }, cell: ({ row }) => actions(row.original) },
  ];

  const openPreview = (l: Landing) => {
    const url = landingPreviewUrl(l);
    if (url) window.open(url, "_blank", "noopener");
  };

  const totalSize = landings.reduce((a, l) => a + (l.file_size || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderArchive}
        title="Static content"
        description="Landing pages, PHP apps and asset bundles you can serve from any domain."
        meta={
          data ? (
            <>
              <span>
                <span className="font-data">{landings.length}</span> uploads
              </span>
              <span className="font-data">{formatBytes(totalSize)}</span>
            </>
          ) : undefined
        }
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <UploadCloud />
            Upload
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, file, owner…" className="pl-8" />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {types.length > 1 && (
          <ToggleGroup type="single" variant="outline" value={type} onValueChange={(v) => v && setType(v)}>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            {types.map((t) => (
              <ToggleGroupItem key={t} value={t} className="font-data">
                {t}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && changeView(v as View)}
          className="ml-auto"
          aria-label="View"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGrid />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view">
            <Rows3 />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error && !data ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : !loading && landings.length === 0 ? (
        <EmptyState
          icon={FolderArchive}
          title="No static content yet"
          description="Upload a ZIP with an index.html (or index.php) and assign it to a domain."
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <UploadCloud />
              Upload ZIP
            </Button>
          }
        />
      ) : view === "table" ? (
        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          hideSearch
          getRowId={(l) => l.id}
          initialState={{ sorting: [{ id: "created_at", desc: true }] }}
          onRowClick={openPreview}
          enableRowSelection
          bulkActions={(rows, clear) => (
            <Button size="sm" variant="destructive" onClick={() => remove(rows, clear)}>
              <Trash2 />
              Delete {rows.length}
            </Button>
          )}
          emptyMessage="No uploads match your filters."
        />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} lines={2} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No uploads match" size="compact" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((l) => {
            const url = landingPreviewUrl(l);
            return (
              <div
                key={l.id}
                className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border-strong"
              >
                <button
                  type="button"
                  onClick={() => openPreview(l)}
                  disabled={!url}
                  className={cn("block w-full border-b border-border text-left", url ? "cursor-zoom-in" : "cursor-default")}
                  aria-label={url ? `Open preview of ${l.name}` : undefined}
                >
                  <LandingThumbnail landing={l} />
                </button>
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{l.name}</span>
                      <TypeBadge type={l.type} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-data">{formatBytes(l.file_size)}</span>
                      <span className="text-subtle-foreground">·</span>
                      <RelativeTime date={l.created_at} className="text-xs" />
                      {(l.owner_name || l.owner_email) && (
                        <>
                          <span className="text-subtle-foreground">·</span>
                          <span className="truncate">{l.owner_name || l.owner_email}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {actions(l)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LandingUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        existingNames={landings.map((l) => l.name)}
        onUploaded={(l) => {
          setData((prev) => (prev ? [l, ...prev] : [l]));
          refresh();
        }}
      />
    </div>
  );
}
