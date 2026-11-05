"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileArchive, UploadCloud, X } from "lucide-react";
import { api, type Landing } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/app";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormField } from "@/components/security/form-field";

const MAX_BYTES = 50 * 1024 * 1024;

/** XHR upload so we get progress events (fetch can't report upload progress). */
function uploadWithProgress(name: string, file: File, onProgress: (pct: number) => void, signal: AbortSignal): Promise<Landing> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${api.getApiUrl()}/api/static`);
    const token = api.getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Unexpected response"));
        }
      } else reject(new Error(xhr.responseText?.trim() || xhr.statusText || "Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    const fd = new FormData();
    fd.append("name", name);
    fd.append("file", file);
    xhr.send(fd);
  });
}

function nameFromFile(f: File) {
  return f.name.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").trim();
}

export function LandingUploadDialog({
  open,
  onOpenChange,
  onUploaded,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUploaded: (l: Landing) => void;
  existingNames: string[];
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (open) {
      setFile(null);
      setName("");
      setNameEdited(false);
      setProgress(null);
      setFileError(null);
    } else abortRef.current?.abort();
  }, [open]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setFileError("Only .zip archives are supported");
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError(`File is ${formatBytes(f.size)} — the limit is 50 MB`);
      return;
    }
    setFileError(null);
    setFile(f);
    if (!nameEdited || !name) setName(nameFromFile(f));
  };

  const uploading = progress !== null;
  const dup = existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress(0);
    try {
      const l = await uploadWithProgress(name.trim(), file, setProgress, ctrl.signal);
      toast.success(`${l.name} uploaded`, { description: `Detected type: ${l.type}` });
      onUploaded(l);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast.info("Upload cancelled");
      else toast.error("Upload failed", { description: err instanceof Error ? err.message : String(err) });
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!uploading || !o ? onOpenChange(o) : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload static content</DialogTitle>
          <DialogDescription>A ZIP with your site. Type is detected from its contents: PHP → HTML → asset.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!file ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2/30 px-4 py-10 text-center outline-none transition-colors hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/30",
                dragging && "border-primary/60 bg-primary/[0.05]",
                fileError && "border-destructive/60"
              )}
            >
              <UploadCloud className={cn("size-6", dragging ? "text-primary" : "text-muted-foreground")} />
              <span className="text-[13px] font-medium">{dragging ? "Drop to upload" : "Drop a .zip here or click to browse"}</span>
              <span className="text-xs text-muted-foreground">Up to 50 MB</span>
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/30 px-3 py-2.5">
              <FileArchive className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-data truncate text-[13px]">{file.name}</div>
                <div className="font-data text-xs text-muted-foreground">{formatBytes(file.size)}</div>
              </div>
              {!uploading && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove file" onClick={() => setFile(null)}>
                  <X />
                </Button>
              )}
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {fileError && <p className="-mt-2 text-xs text-destructive">{fileError}</p>}

          <FormField
            label="Name"
            htmlFor="landing-name"
            required
            hint={dup ? "Another upload already uses this name" : "Shown when picking content for a domain"}
          >
            <Input
              id="landing-name"
              value={name}
              disabled={uploading}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
              placeholder="Spring promo landing"
            />
          </FormField>

          {uploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress! < 100 ? "Uploading…" : "Processing archive…"}</span>
                <span className="font-data">{progress}%</span>
              </div>
              <Progress value={progress!} />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => (uploading ? abortRef.current?.abort() : onOpenChange(false))}
            >
              {uploading ? "Cancel upload" : "Cancel"}
            </Button>
            <Button type="submit" disabled={!file || !name.trim() || uploading}>
              {uploading ? <Spinner /> : <UploadCloud />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
