"use client";

import * as React from "react";
import { Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner, errorMessage } from "@/components/app/states";

export interface ConfirmOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra body content (list of affected items, warnings). */
  details?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button + warning icon. */
  destructive?: boolean;
  icon?: LucideIcon;
  /**
   * Require the user to type this exact string (e.g. the machine name) before
   * confirming. Use for irreversible deletes of important resources.
   */
  typeToConfirm?: string;
  /**
   * Optional async action. The dialog stays open with a spinner until it
   * resolves; on throw it shows a toast and stays open. The promise from
   * confirm() then resolves true only after success.
   */
  onConfirm?: () => Promise<unknown> | unknown;
  /** Alert mode: only one button (confirmText, default "OK"). */
  alertOnly?: boolean;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the final result when the dialog closes. */
  onResult?: (confirmed: boolean) => void;
}

/** Controlled confirm dialog. Most code should use `useConfirm()` instead. */
export function ConfirmDialog({
  open,
  onOpenChange,
  onResult,
  title,
  description,
  details,
  confirmText,
  cancelText = "Cancel",
  destructive,
  icon,
  typeToConfirm,
  onConfirm,
  alertOnly,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const resolved = React.useRef(false);

  React.useEffect(() => {
    if (open) {
      resolved.current = false;
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  const finish = (ok: boolean) => {
    if (resolved.current) return;
    resolved.current = true;
    onResult?.(ok);
    onOpenChange(false);
  };

  const Icon = icon ?? (destructive ? TriangleAlert : alertOnly ? Info : null);
  const canConfirm = !typeToConfirm || typed.trim() === typeToConfirm;

  const handleConfirm = async () => {
    if (!canConfirm || busy) return;
    if (!onConfirm) return finish(true);
    setBusy(true);
    try {
      await onConfirm();
      finish(true);
    } catch (e) {
      toast.error("Action failed", { description: errorMessage(e) });
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) return;
        if (!o) finish(false);
        else onOpenChange(o);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[440px]"
        onKeyDown={(e) => {
          // Enter confirms non-destructive dialogs, and destructive ones only from the type-to-confirm input
          const fromInput = (e.target as HTMLElement).tagName === "INPUT";
          if (e.key === "Enter" && !e.shiftKey && (!destructive || (typeToConfirm && fromInput))) {
            e.preventDefault();
            void handleConfirm();
          }
        }}
      >
        <div className="flex gap-3.5">
          {Icon && (
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg border",
                destructive
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border-strong bg-surface-2 text-muted-foreground"
              )}
            >
              <Icon className="size-4" />
            </div>
          )}
          <DialogHeader className="min-w-0 flex-1 pr-0">
            <DialogTitle className="pt-1.5">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="text-[13px] leading-relaxed">{description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">Confirm action</DialogDescription>
            )}
          </DialogHeader>
        </div>
        {details && <div className={cn("text-[13px]", Icon && "pl-[50px]")}>{details}</div>}
        {typeToConfirm && (
          <div className={cn("space-y-1.5", Icon && "pl-[50px]")}>
            <label className="text-xs text-muted-foreground">
              Type <span className="font-data text-foreground">{typeToConfirm}</span> to confirm
            </label>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="font-data"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <DialogFooter className="mt-1">
          {!alertOnly && (
            <Button variant="ghost" onClick={() => finish(false)} disabled={busy}>
              {cancelText}
            </Button>
          )}
          <Button
            variant={destructive ? "destructive-solid" : "default"}
            onClick={() => void handleConfirm()}
            disabled={!canConfirm || busy}
          >
            {busy && <Spinner />}
            {confirmText ?? (alertOnly ? "OK" : destructive ? "Delete" : "Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Provider + hooks                                                           */
/* -------------------------------------------------------------------------- */

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = React.createContext<ConfirmFn | null>(null);

interface PendingState extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

/** Mount once (dashboard + auth layouts). */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = React.useState<PendingState | null>(null);
  const [open, setOpen] = React.useState(false);

  const confirm = React.useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setCurrent({ ...options, resolve });
      setOpen(true);
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <ConfirmDialog
          {...current}
          open={open}
          onOpenChange={setOpen}
          onResult={(ok) => current.resolve(ok)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Promise-based confirm. Replaces window.confirm().
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete domain?", description: fqdn, destructive: true }))) return;
 */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

/**
 * Promise-based alert. Replaces window.alert().
 *   const alert = useAlert(); await alert({ title: "Token created", description: "..." });
 */
export function useAlert(): (options: Omit<ConfirmOptions, "alertOnly" | "onConfirm" | "typeToConfirm">) => Promise<void> {
  const confirm = useConfirm();
  return React.useCallback(
    async (options) => {
      await confirm({ ...options, alertOnly: true });
    },
    [confirm]
  );
}
