"use client";

import * as React from "react";
import { HeartPulse } from "lucide-react";
import { toast } from "sonner";

import { api, type Domain } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyValueList, RelativeTime, Spinner, StatusBadge, errorMessage } from "@/components/app";

import { HEALTH_LABEL, domainHealth } from "./domain-utils";

const COMMON = ["200", "204", "301", "302", "401", "403", "404"];

export interface HealthCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: Domain | null;
  onChanged: () => void;
}

export function HealthCheckDialog({ open, onOpenChange, domain, onChanged }: HealthCheckDialogProps) {
  const [expected, setExpected] = React.useState("200");
  const [path, setPath] = React.useState("/");
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && domain) {
      setExpected(String(domain.health_check_expected_status ?? 200));
      setPath(domain.health_check_path || "/");
      setLastResult(null);
    }
  }, [open, domain]);

  const code = Number.parseInt(expected, 10);
  const invalid = Number.isNaN(code) || code < 100 || code > 599;
  const pathInvalid = !path.startsWith("/") || /\s/.test(path) || path.length > 512;
  const dirty =
    !!domain &&
    !invalid &&
    !pathInvalid &&
    (code !== (domain.health_check_expected_status ?? 200) || path !== (domain.health_check_path || "/"));

  const runCheck = async () => {
    if (!domain) return;
    setChecking(true);
    try {
      const res = await api.triggerDomainHealthCheck(domain.id);
      setLastResult(res.status);
      onChanged();
    } catch (e) {
      toast.error("Health check failed to run", { description: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  const save = async (andCheck: boolean) => {
    if (!domain || invalid) return;
    setSaving(true);
    try {
      await api.updateDomainHealthCheck(domain.id, code, path);
      toast.success("Health check updated", { description: `https://${domain.fqdn}${path === "/" ? "" : path} → HTTP ${code}` });
      onChanged();
      if (andCheck) await runCheck();
      else onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't update health check", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const health = domain ? domainHealth(domain) : "unknown";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Health check</DialogTitle>
          <DialogDescription>
            An HTTPS request is sent to <span className="font-data text-foreground">{domain?.fqdn}</span>. The domain is
            healthy when the response status matches.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <KeyValueList
            labelWidth={110}
            items={[
              {
                label: "Current",
                value: (
                  <span className="inline-flex items-center gap-2">
                    <StatusBadge status={health === "unassigned" ? "unknown" : health} label={HEALTH_LABEL[health]} />
                    {lastResult && <span className="text-xs text-muted-foreground">just checked</span>}
                  </span>
                ),
              },
              { label: "Last check", value: <RelativeTime date={domain?.last_check_at} /> },
              {
                label: "Last response",
                value:
                  typeof domain?.last_check_status_code === "number" ? (
                    <span className="font-data">
                      HTTP {domain.last_check_status_code}
                      {typeof domain.last_check_response_ms === "number" && (
                        <span className="text-muted-foreground"> · {domain.last_check_response_ms} ms</span>
                      )}
                    </span>
                  ) : (
                    "—"
                  ),
                hidden: typeof domain?.last_check_status_code !== "number",
              },
              {
                label: "Last error",
                value: <span className="font-data text-[12px] text-destructive">{domain?.last_check_error}</span>,
                hidden: !domain?.last_check_error,
              },
            ]}
          />

          <div className="space-y-2">
            <Label htmlFor="check-path">Path</Label>
            <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring/40">
              <span className="font-data max-w-[45%] shrink-0 truncate pl-3 text-[12px] text-subtle-foreground">
                https://{domain?.fqdn}
              </span>
              <Input
                id="check-path"
                className="font-data border-0 pl-0.5 focus-visible:ring-0"
                value={path}
                aria-invalid={pathInvalid}
                placeholder="/"
                onChange={(e) => setPath(e.target.value.trim() || "/")}
              />
            </div>
            {pathInvalid && <p className="text-xs text-destructive">Must start with / and contain no spaces.</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="expected-status">Expected HTTP status</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="expected-status"
                inputMode="numeric"
                className="font-data w-24"
                value={expected}
                aria-invalid={invalid}
                onChange={(e) => setExpected(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              />
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={COMMON.includes(expected) ? expected : ""}
                onValueChange={(v) => v && setExpected(v)}
              >
                {COMMON.map((c) => (
                  <ToggleGroupItem key={c} value={c} className="font-data px-2 text-[12px]">
                    {c}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <p className="text-xs text-muted-foreground">
              {invalid
                ? "Enter a status between 100 and 599."
                : "Use 401/403 for protected apps, 301/302 when the root redirects."}
            </p>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={runCheck}
            disabled={!domain?.assigned_machine_id || checking || saving}
            title={!domain?.assigned_machine_id ? "Assign the domain to a machine first" : undefined}
          >
            {checking ? <Spinner /> : <HeartPulse />}
            Check now
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Close
            </Button>
            <Button onClick={() => save(!!domain?.assigned_machine_id)} disabled={!dirty || saving}>
              {saving && <Spinner />}
              Save{domain?.assigned_machine_id ? " & check" : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
