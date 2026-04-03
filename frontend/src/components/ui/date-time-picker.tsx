"use client"

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DateTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatLocalDateTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDisplayValue(value: string) {
  const parsed = parseLocalDateTime(value);
  if (!parsed) return "";
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function sameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = firstDay.getDay();
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Select date and time",
  className,
}: DateTimePickerProps) {
  const selected = useMemo(() => parseLocalDateTime(value), [value]);
  const [open, setOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => selected ?? new Date());
  const [timeValue, setTimeValue] = useState(() =>
    selected ? `${pad(selected.getHours())}:${pad(selected.getMinutes())}` : "00:00"
  );

  const days = useMemo(() => buildCalendarDays(displayMonth), [displayMonth]);
  const monthLabel = displayMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const updateDate = (base: Date) => {
    const [hours, minutes] = timeValue.split(":").map((part) => parseInt(part, 10));
    const next = new Date(base);
    next.setHours(Number.isNaN(hours) ? 12 : hours, Number.isNaN(minutes) ? 0 : minutes, 0, 0);
    onChange(formatLocalDateTime(next));
  };

  const handleTimeChange = (nextTime: string) => {
    setTimeValue(nextTime);
    if (selected) {
      const [hours, minutes] = nextTime.split(":").map((part) => parseInt(part, 10));
      const next = new Date(selected);
      next.setHours(Number.isNaN(hours) ? 12 : hours, Number.isNaN(minutes) ? 0 : minutes, 0, 0);
      onChange(formatLocalDateTime(next));
    }
  };

  const handleToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setDisplayMonth(now);
    setTimeValue("00:00");
    onChange(formatLocalDateTime(now));
  };

  const handleClear = () => {
    onChange("");
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && selected) {
      setDisplayMonth(selected);
      setTimeValue(`${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-between rounded-lg border-border/60 bg-background px-3 font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate text-left">
            {value ? formatDisplayValue(value) : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] overflow-hidden rounded-2xl border-border/70 p-0">
        <div className="bg-background">
          <div className="flex items-center justify-between border-b px-3 py-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">{monthLabel}</div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 px-3 pt-3 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 px-3 pb-3">
            {days.map((day) => {
              const isCurrentMonth = day.getMonth() === displayMonth.getMonth();
              const isSelected = sameDay(day, selected);
              const isToday = sameDay(day, new Date());

              return (
                <Button
                  key={day.toISOString()}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "h-9 w-full rounded-lg text-sm",
                    !isCurrentMonth && "text-muted-foreground/45",
                    isToday && !isSelected && "border border-border/70",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  )}
                  onClick={() => updateDate(day)}
                >
                  {day.getDate()}
                </Button>
              );
            })}
          </div>

          <div className="border-t bg-muted/20 px-3 py-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Time
              </Label>
              <Input type="time" step={60} value={timeValue} onChange={(e) => handleTimeChange(e.target.value)} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={handleToday}>
                  Today
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
                  <X className="h-3.5 w-3.5" />
                  Clear
                </Button>
              </div>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
