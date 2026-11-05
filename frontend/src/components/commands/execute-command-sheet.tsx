"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Play } from "lucide-react";
import { api, type CommandTemplate, type Machine } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MachinePicker, Spinner, errorMessage, machineDisplayName, machineLiveness, openJobLogs, trackJob } from "@/components/app";
import { FormField } from "@/components/security/form-field";
import { cn } from "@/lib/utils";
import { OnErrorBadge, Templated, categoryMeta, describeStep, validateVariable } from "./command-meta";

export function ExecuteCommandSheet({
  command,
  open,
  onOpenChange,
  initialMachineId,
  onStarted,
}: {
  command: CommandTemplate | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialMachineId?: string | null;
  onStarted?: () => void;
}) {
  const [machineId, setMachineId] = React.useState<string | null>(null);
  const [machine, setMachine] = React.useState<Machine | null>(null);
  const [vars, setVars] = React.useState<Record<string, string>>({});
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    if (open && command) {
      const d: Record<string, string> = {};
      command.variables.forEach((v) => (d[v.name] = v.default ?? (v.type === "bool" ? "true" : "")));
      setVars(d);
      setTouched({});
      setSubmitted(false);
      setMachineId((prev) => initialMachineId ?? prev);
    }
  }, [open, command, initialMachineId]);

  if (!command) return null;
  const meta = categoryMeta(command.category);
  const errors = Object.fromEntries(command.variables.map((v) => [v.name, validateVariable(v, vars[v.name])]));
  const hasErrors = Object.values(errors).some(Boolean);
  const offline = machine ? machineLiveness(machine) === "offline" : false;

  const run = async () => {
    setSubmitted(true);
    if (!machineId || hasErrors) return;
    setRunning(true);
    try {
      const payload = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.trim()]));
      const job = await api.executeCommand(machineId, command.id, payload);
      const target = machine ? machineDisplayName(machine) : undefined;
      trackJob(job, { title: command.name, description: target, onDone: () => onStarted?.() });
      openJobLogs(job);
      onStarted?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Couldn't run ${command.name}`, { description: errorMessage(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <meta.icon className="size-4 text-muted-foreground" />
            {command.name}
          </SheetTitle>
          <SheetDescription>{command.description}</SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge variant="outline">{meta.label}</Badge>
            <OnErrorBadge value={command.on_error} />
            <Badge variant="muted" className="font-data">{command.id}</Badge>
          </div>
        </SheetHeader>

        <form
          id="execute-command"
          className="flex-1 space-y-6 overflow-y-auto px-4"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <section className="space-y-3">
            <h3 className="text-[13px] font-medium">Target</h3>
            <FormField label="Machine" required error={submitted && !machineId ? "Choose a machine" : undefined}>
              <MachinePicker
                value={machineId}
                onValueChange={(id, m) => {
                  setMachineId(id);
                  setMachine(m);
                }}
                groupBy="status"
                placeholder="Search machines by name, host or IP…"
                aria-invalid={submitted && !machineId}
              />
            </FormField>
            {offline && (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertDescription>This machine hasn&apos;t checked in for over an hour. The job will wait until its agent reconnects.</AlertDescription>
              </Alert>
            )}
          </section>

          {command.variables.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-[13px] font-medium">Variables</h3>
              {command.variables.map((v) => {
                const show = submitted || touched[v.name];
                const err = show ? errors[v.name] : null;
                const set = (val: string) => setVars((p) => ({ ...p, [v.name]: val }));
                const blur = () => setTouched((p) => ({ ...p, [v.name]: true }));
                const id = `var-${v.name}`;
                return (
                  <FormField
                    key={v.name}
                    label={<span className="font-data">{v.name}</span>}
                    htmlFor={id}
                    required={v.required}
                    hint={v.description}
                    error={err ?? undefined}
                    aside={<span className="font-data text-[11px] text-subtle-foreground">{v.type}</span>}
                  >
                    {v.type === "bool" ? (
                      <ToggleGroup type="single" variant="outline" value={vars[v.name]} onValueChange={(x) => x && set(x)}>
                        <ToggleGroupItem value="true">true</ToggleGroupItem>
                        <ToggleGroupItem value="false">false</ToggleGroupItem>
                      </ToggleGroup>
                    ) : v.type === "text" ? (
                      <Textarea
                        id={id}
                        rows={6}
                        spellCheck={false}
                        className="font-data text-xs"
                        value={vars[v.name] ?? ""}
                        aria-invalid={!!err}
                        onChange={(e) => set(e.target.value)}
                        onBlur={blur}
                      />
                    ) : (
                      <Input
                        id={id}
                        inputMode={v.type === "int" ? "numeric" : undefined}
                        className="font-data"
                        placeholder={v.default || undefined}
                        value={vars[v.name] ?? ""}
                        aria-invalid={!!err}
                        onChange={(e) => set(e.target.value)}
                        onBlur={blur}
                      />
                    )}
                  </FormField>
                );
              })}
            </section>
          )}

          <section className="space-y-3 pb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium">Steps</h3>
              <span className="text-xs text-muted-foreground">
                <span className="font-data">{command.steps.length}</span> {command.steps.length === 1 ? "step" : "steps"} · preview with your values
              </span>
            </div>
            <ol className="overflow-hidden rounded-lg border border-border bg-surface-2/30">
              {command.steps.map((s, i) => {
                const d = describeStep(s);
                return (
                  <li key={i} className={cn("flex gap-3 px-3 py-2", i > 0 && "border-t border-border")}>
                    <span className="font-data w-5 shrink-0 pt-px text-right text-[11px] text-subtle-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-data">{d.kind}</Badge>
                        {s.timeout ? <span className="font-data text-[11px] text-subtle-foreground">timeout {s.timeout}s</span> : null}
                      </div>
                      {d.text && (
                        <pre className="font-data whitespace-pre-wrap break-all text-[11.5px] leading-relaxed text-muted-foreground">
                          <Templated text={d.text} vars={vars} />
                        </pre>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="execute-command" disabled={running || (submitted && (hasErrors || !machineId))}>
            {running ? <Spinner /> : <Play />}
            Run command
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
