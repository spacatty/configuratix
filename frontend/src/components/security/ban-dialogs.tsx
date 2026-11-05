"use client";

import * as React from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, Download, FileText, FileUp, Sheet as SheetIcon, Upload, XCircle } from "lucide-react";
import { api, type ImportBansResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, errorMessage } from "@/components/app";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormField } from "./form-field";
import { isValidIp } from "./shared";

/* -------------------------------------------------------------------------- */
/* Add ban                                                                    */
/* -------------------------------------------------------------------------- */

const DURATIONS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

export function AddBanDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [ip, setIp] = React.useState("");
  const [reason, setReason] = React.useState("manual");
  const [days, setDays] = React.useState("30");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setIp("");
      setReason("manual");
      setDays("30");
      setTouched(false);
    }
  }, [open]);

  const valid = isValidIp(ip);
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 3650;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || !daysValid) return;
    setSubmitting(true);
    try {
      await api.createSecurityBan({ ip_address: ip.trim(), reason, expires_in_days: daysNum });
      toast.success(`${ip.trim()} banned`, { description: `Expires in ${daysNum} ${daysNum === 1 ? "day" : "days"}` });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error("Couldn't ban IP", { description: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban IP address</DialogTitle>
          <DialogDescription>The ban is pushed to every agent with nftables enabled on the next sync.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <FormField
            label="IP address"
            htmlFor="ban-ip"
            required
            error={touched && !valid ? "Enter a valid IPv4 or IPv6 address" : undefined}
          >
            <Input
              id="ban-ip"
              autoFocus
              placeholder="203.0.113.42"
              className="font-data"
              value={ip}
              aria-invalid={touched && !valid}
              onChange={(e) => setIp(e.target.value)}
              onBlur={() => ip && setTouched(true)}
            />
          </FormField>
          <FormField label="Reason">
            <ToggleGroup type="single" variant="outline" value={reason} onValueChange={(v) => v && setReason(v)}>
              <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
              <ToggleGroupItem value="blocked_ua">Blocked UA</ToggleGroupItem>
              <ToggleGroupItem value="invalid_endpoint">Invalid path</ToggleGroupItem>
            </ToggleGroup>
          </FormField>
          <FormField
            label="Duration"
            error={!daysValid ? "1 – 3650 days" : undefined}
            hint="Expired bans are lifted automatically."
          >
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                value={DURATIONS.some((d) => d.value === days) ? days : ""}
                onValueChange={(v) => v && setDays(v)}
              >
                {DURATIONS.map((d) => (
                  <ToggleGroupItem key={d.value} value={d.value}>
                    {d.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="font-data h-8 w-20"
                  aria-label="Days"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            </div>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || (touched && (!valid || !daysValid))}>
              {submitting ? <Spinner /> : <Ban />}
              Ban IP
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

interface CsvEntry {
  ip_address: string;
  reason: string;
  user_agent: string;
  path: string;
  expires_at: string;
  banned_at: string;
}

interface ParsedImport {
  format: "csv" | "list" | "empty";
  valid: string[];
  csv: CsvEntry[];
  invalid: { line: number; value: string }[];
  duplicates: number;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let q = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '"') {
      if (q && line[j + 1] === '"') {
        cur += '"';
        j++;
      } else q = !q;
    } else if (c === "," && !q) {
      fields.push(cur);
      cur = "";
    } else cur += c;
  }
  fields.push(cur);
  return fields;
}

export function parseBanImport(text: string): ParsedImport {
  const raw = text.split(/\r?\n/).map((l, i) => ({ line: i + 1, value: l.trim() }));
  const lines = raw.filter((l) => l.value && !l.value.startsWith("#"));
  const out: ParsedImport = { format: "empty", valid: [], csv: [], invalid: [], duplicates: 0 };
  if (!lines.length) return out;
  const seen = new Set<string>();
  const isCsv = lines[0].value.toLowerCase().startsWith("ip_address,");
  out.format = isCsv ? "csv" : "list";
  for (const l of isCsv ? lines.slice(1) : lines) {
    if (isCsv) {
      const f = splitCsvLine(l.value);
      const ip = (f[0] ?? "").trim();
      if (!isValidIp(ip)) {
        out.invalid.push({ line: l.line, value: ip || l.value });
        continue;
      }
      if (seen.has(ip)) {
        out.duplicates++;
        continue;
      }
      seen.add(ip);
      out.valid.push(ip);
      out.csv.push({
        ip_address: ip,
        reason: f[1] ?? "",
        user_agent: f[2] ?? "",
        path: f[3] ?? "",
        expires_at: f[4] ?? "",
        banned_at: f[5] ?? "",
      });
    } else {
      // Allow "ip  # comment" and comma/space separated lists.
      for (const token of l.value.split(/[\s,;]+/).filter(Boolean)) {
        if (token.startsWith("#")) break;
        if (!isValidIp(token)) {
          out.invalid.push({ line: l.line, value: token });
          continue;
        }
        if (seen.has(token)) {
          out.duplicates++;
          continue;
        }
        seen.add(token);
        out.valid.push(token);
      }
    }
  }
  return out;
}

export function ImportBansDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: () => void;
}) {
  const [text, setText] = React.useState("");
  const [reason, setReason] = React.useState("imported");
  const [submitting, setSubmitting] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [result, setResult] = React.useState<ImportBansResponse | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setText("");
      setReason("imported");
      setResult(null);
    }
  }, [open]);

  const parsed = React.useMemo(() => parseBanImport(text), [text]);

  const readFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File is too large", { description: "Maximum 20 MB" });
      return;
    }
    setText(await file.text());
    setResult(null);
  };

  const submit = async () => {
    if (!parsed.valid.length) return;
    setSubmitting(true);
    try {
      const res =
        parsed.format === "csv"
          ? await api.importSecurityBans({ ips: [], reason, csv: parsed.csv })
          : await api.importSecurityBans({ ips: parsed.valid, reason });
      setResult(res);
      toast.success(`Imported ${formatNumber(res.imported)} ${res.imported === 1 ? "IP" : "IPs"}`);
      onImported();
    } catch (err) {
      toast.error("Import failed", { description: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import bans</DialogTitle>
          <DialogDescription>
            Paste a list of IPs (one per line, comma or space separated) or a CSV produced by Export. Format is detected
            automatically; whitelisted and already banned IPs are skipped.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>Import finished</AlertTitle>
              <AlertDescription>
                <span className="font-data">{formatNumber(result.imported)}</span> new bans created.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ImportStat label="Imported" value={result.imported} tone="success" />
              <ImportStat label="Already banned" value={result.already_banned} />
              <ImportStat label="Whitelisted" value={result.skipped_whitelist} />
              <ImportStat label="Invalid" value={result.invalid} tone={result.invalid ? "destructive" : undefined} />
            </div>
            {result.skipped_ips && result.skipped_ips.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Skipped</p>
                <div className="font-data max-h-28 overflow-auto rounded-md border border-border bg-surface-2/40 p-2 text-xs text-muted-foreground">
                  {result.skipped_ips.join("  ")}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>
                Import more
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) readFile(f);
              }}
              className={cn(
                "relative rounded-lg border border-dashed border-border-strong transition-colors",
                dragging && "border-primary/60 bg-primary/[0.04]"
              )}
            >
              <Textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setResult(null);
                }}
                rows={9}
                spellCheck={false}
                placeholder={"203.0.113.10\n198.51.100.0, 198.51.100.7\n\n# or CSV from export\nip_address,reason,user_agent,path,expires_at,banned_at"}
                className="font-data min-h-[180px] resize-y border-0 bg-transparent text-xs focus-visible:ring-0"
              />
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <FileUp className="size-3.5" />
                  Drop a .txt or .csv file here, or
                  <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => fileRef.current?.click()}>
                    browse
                  </button>
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readFile(f);
                    e.target.value = "";
                  }}
                />
                {parsed.format !== "empty" && (
                  <Badge variant="muted">{parsed.format === "csv" ? "CSV detected" : "IP list"}</Badge>
                )}
              </div>
            </div>

            {parsed.format !== "empty" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-success" />
                    <span className="font-data">{formatNumber(parsed.valid.length)}</span> valid
                  </span>
                  <span className={cn("flex items-center gap-1.5", parsed.invalid.length === 0 && "text-muted-foreground")}>
                    <XCircle className={cn("size-3.5", parsed.invalid.length ? "text-destructive" : "text-subtle-foreground")} />
                    <span className="font-data">{formatNumber(parsed.invalid.length)}</span> invalid
                  </span>
                  <span className="text-muted-foreground">
                    <span className="font-data">{formatNumber(parsed.duplicates)}</span> duplicates removed
                  </span>
                </div>
                {parsed.invalid.length > 0 && (
                  <div className="font-data max-h-24 overflow-auto rounded-md border border-destructive/25 bg-destructive/[0.06] p-2 text-xs">
                    {parsed.invalid.slice(0, 50).map((x, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="w-10 shrink-0 text-right text-subtle-foreground">L{x.line}</span>
                        <span className="truncate text-destructive">{x.value}</span>
                      </div>
                    ))}
                    {parsed.invalid.length > 50 && (
                      <div className="pt-1 text-muted-foreground">…and {parsed.invalid.length - 50} more</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {parsed.format !== "csv" && (
              <FormField label="Reason" hint="CSV rows keep their own reason and dates.">
                <ToggleGroup type="single" variant="outline" value={reason} onValueChange={(v) => v && setReason(v)}>
                  <ToggleGroupItem value="imported">Imported</ToggleGroupItem>
                  <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
                </ToggleGroup>
              </FormField>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting || parsed.valid.length === 0}>
                {submitting ? <Spinner /> : <Upload />}
                Import {parsed.valid.length > 0 && <span className="font-data">{formatNumber(parsed.valid.length)}</span>}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportStat({ label, value, tone }: { label: string; value: number; tone?: "success" | "destructive" }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-data text-lg font-medium",
          tone === "success" && value > 0 && "text-success",
          tone === "destructive" && "text-destructive"
        )}
      >
        {formatNumber(value)}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

export function ExportBansDialog({
  open,
  onOpenChange,
  activeOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  activeOnly: boolean;
}) {
  const [format, setFormat] = React.useState<"csv" | "txt">("csv");
  const [scope, setScope] = React.useState<"active" | "all">(activeOnly ? "active" : "all");
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    if (open) setScope(activeOnly ? "active" : "all");
  }, [open, activeOnly]);

  const run = async () => {
    setExporting(true);
    try {
      const blob = await api.exportSecurityBans({ format, active_only: scope === "active" });
      const date = new Date().toISOString().split("T")[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ip-bans-${date}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
      onOpenChange(false);
    } catch (err) {
      toast.error("Export failed", { description: errorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export bans</DialogTitle>
          <DialogDescription>Download the blacklist to back it up or move it to another workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Format">
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as "csv" | "txt")} className="grid gap-2 sm:grid-cols-2">
              <RadioCard value="csv" icon={<SheetIcon />} title="CSV" description="IP, reason, UA, path and dates. Re-importable." />
              <RadioCard value="txt" icon={<FileText />} title="Plain text" description="One IP per line." />
            </RadioGroup>
          </FormField>
          <FormField label="Include">
            <ToggleGroup type="single" variant="outline" value={scope} onValueChange={(v) => v && setScope(v as "active" | "all")}>
              <ToggleGroupItem value="active">Active bans</ToggleGroupItem>
              <ToggleGroupItem value="all">All, incl. expired</ToggleGroupItem>
            </ToggleGroup>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={exporting}>
            {exporting ? <Spinner /> : <Download />}
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

