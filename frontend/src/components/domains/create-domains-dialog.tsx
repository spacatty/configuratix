"use client";

import * as React from "react";
import { CircleCheck, CircleMinus, CircleX } from "lucide-react";
import { toast } from "sonner";

import { api, type Domain } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, errorMessage, invalidatePickerCache } from "@/components/app";
import { cn } from "@/lib/utils";

import { parseDomainList, type ParsedDomainLine } from "./domain-utils";

export interface CreateDomainsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Domain[];
  /** Called with the domains that were created. */
  onCreated: (created: Domain[]) => void;
}

type RowResult = { fqdn: string; ok: boolean; error?: string };

export function CreateDomainsDialog({ open, onOpenChange, existing, onCreated }: CreateDomainsDialogProps) {
  const [text, setText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [results, setResults] = React.useState<RowResult[] | null>(null);

  React.useEffect(() => {
    if (open) {
      setText("");
      setResults(null);
      setProgress(0);
    }
  }, [open]);

  const parsed = React.useMemo<ParsedDomainLine[]>(
    () => parseDomainList(text, existing.map((d) => d.fqdn)),
    [text, existing]
  );
  const valid = parsed.filter((p) => p.status === "ok");
  const skipped = parsed.length - valid.length;

  const submit = async () => {
    if (!valid.length || submitting) return;
    setSubmitting(true);
    setProgress(0);
    const created: Domain[] = [];
    const out: RowResult[] = [];
    for (const p of valid) {
      try {
        created.push(await api.createDomain(p.fqdn));
        out.push({ fqdn: p.fqdn, ok: true });
      } catch (e) {
        out.push({ fqdn: p.fqdn, ok: false, error: errorMessage(e) });
      }
      setProgress((n) => n + 1);
    }
    setSubmitting(false);
    invalidatePickerCache("domains");
    if (created.length) onCreated(created);
    const failed = out.filter((r) => !r.ok);
    if (!failed.length) {
      toast.success(created.length === 1 ? `${created[0].fqdn} added` : `${created.length} domains added`);
      onOpenChange(false);
    } else {
      setResults(out);
      toast.error(`${failed.length} of ${out.length} couldn't be added`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add domains</DialogTitle>
          <DialogDescription>
            One per line — or paste a list separated by commas or spaces. Schemes and paths are stripped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fqdns">Domains</Label>
            <Textarea
              id="fqdns"
              autoFocus
              rows={5}
              spellCheck={false}
              className="font-data min-h-28 text-[12.5px]"
              placeholder={"example.com\nwww.example.com\napi.example.org"}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setResults(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={submitting}
            />
          </div>

          {parsed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="success">{valid.length} to add</Badge>
                {skipped > 0 && <Badge variant="muted">{skipped} skipped</Badge>}
                {submitting && (
                  <span className="font-data ml-auto">
                    {progress}/{valid.length}
                  </span>
                )}
              </div>
              <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface-2/40">
                {(results
                  ? results.map((r) => ({ fqdn: r.fqdn, kind: r.ok ? "done" : "error", note: r.error }))
                  : parsed.map((p) => ({
                      fqdn: p.fqdn,
                      kind: p.status,
                      note: p.status === "ok" ? undefined : p.reason,
                    }))
                ).map((row, i) => {
                  const good = row.kind === "ok" || row.kind === "done";
                  const bad = row.kind === "invalid" || row.kind === "error";
                  const Icon = good ? CircleCheck : bad ? CircleX : CircleMinus;
                  return (
                    <li key={`${row.fqdn}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          good ? "text-success" : bad ? "text-destructive" : "text-muted-foreground"
                        )}
                      />
                      <span className={cn("font-data min-w-0 flex-1 truncate", !good && "text-muted-foreground")}>
                        {row.fqdn}
                      </span>
                      {row.note && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{row.note}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {results ? "Close" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={!valid.length || submitting || !!results}>
            {submitting && <Spinner />}
            {valid.length > 1 ? `Add ${valid.length} domains` : "Add domain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
