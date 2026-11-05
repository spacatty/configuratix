"use client"

import * as React from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { fuzzyFilter } from "@/lib/fuzzy"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Skeleton } from "@/components/ui/skeleton"

/* -------------------------------------------------------------------------- */
/* Shared props                                                               */
/* -------------------------------------------------------------------------- */

export interface ComboboxBaseProps<T> {
  items: T[]
  /** Stable unique id of an item (used as the selected value). */
  getValue: (item: T) => string
  /** Plain-text label (trigger text + always searchable). */
  getLabel: (item: T) => string
  /** Extra searchable strings (hostname, ip, group names...). */
  getKeywords?: (item: T) => Array<string | null | undefined>
  /** Custom row rendering inside the list. Defaults to the label. */
  renderItem?: (item: T, state: { selected: boolean }) => React.ReactNode
  /** Group heading for an item; items without a group go in an unnamed group first. */
  getGroup?: (item: T) => string | null | undefined
  /** Explicit order of group headings; unknown groups follow in first-seen order. */
  groupOrder?: string[]
  isItemDisabled?: (item: T) => boolean
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: React.ReactNode
  disabled?: boolean
  loading?: boolean
  /** Trigger className (width etc.). Default `w-full`. */
  className?: string
  /** Popover content className. Default matches trigger width (min 260px). */
  contentClassName?: string
  align?: "start" | "center" | "end"
  /** Keep true when used inside a Dialog/Sheet so the list can scroll. */
  modal?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  id?: string
  "aria-invalid"?: boolean
  /** Rendered at the bottom of the list (e.g. "Create new…" item). */
  footer?: React.ReactNode
  size?: "sm" | "default"
}

export interface ComboboxProps<T> extends ComboboxBaseProps<T> {
  value: string | null | undefined
  onValueChange: (value: string | null, item: T | null) => void
  /** Show an × to clear the selection. */
  clearable?: boolean
  /** Custom trigger content for the selected item. */
  renderValue?: (item: T) => React.ReactNode
}

export interface MultiComboboxProps<T> extends ComboboxBaseProps<T> {
  value: string[]
  onValueChange: (values: string[], items: T[]) => void
  /** Chips shown in the trigger before collapsing into "+N". Default 3. */
  maxChips?: number
  /** Custom chip content. Defaults to the label. */
  renderChip?: (item: T) => React.ReactNode
  /** Show "Select all matching" / "Clear" footer actions. Default true. */
  showBulkActions?: boolean
  clearable?: boolean
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function useGroups<T>(
  items: T[],
  getGroup?: (item: T) => string | null | undefined,
  groupOrder?: string[]
): Array<{ heading: string | null; items: T[] }> {
  return React.useMemo(() => {
    if (!getGroup) return [{ heading: null, items }]
    const map = new Map<string, T[]>()
    const ungrouped: T[] = []
    for (const it of items) {
      const g = getGroup(it)
      if (!g) ungrouped.push(it)
      else {
        if (!map.has(g)) map.set(g, [])
        map.get(g)!.push(it)
      }
    }
    const keys = [...map.keys()]
    if (groupOrder) {
      keys.sort((a, b) => {
        const ia = groupOrder.indexOf(a)
        const ib = groupOrder.indexOf(b)
        return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib)
      })
    }
    const out: Array<{ heading: string | null; items: T[] }> = []
    if (ungrouped.length) out.push({ heading: null, items: ungrouped })
    for (const k of keys) out.push({ heading: k, items: map.get(k)! })
    return out
  }, [items, getGroup, groupOrder])
}

const triggerBase =
  "group/combobox relative flex w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card/60 px-2.5 text-left text-[13px] outline-none transition-[color,box-shadow,border-color] hover:border-border-strong focus-visible:border-ring/80 focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=open]:border-ring/60"

function ComboboxList<T>({
  props,
  isSelected,
  onSelect,
  multi,
  search,
  setSearch,
  bottom,
}: {
  props: ComboboxBaseProps<T>
  isSelected: (v: string) => boolean
  onSelect: (item: T) => void
  multi?: boolean
  search: string
  setSearch: (s: string) => void
  bottom?: React.ReactNode
}) {
  const {
    items,
    getValue,
    getLabel,
    getKeywords,
    renderItem,
    getGroup,
    groupOrder,
    isItemDisabled,
    searchPlaceholder = "Search…",
    emptyText = "No results.",
    loading,
    footer,
  } = props
  const groups = useGroups(items, getGroup, groupOrder)

  return (
    <Command filter={fuzzyFilter} loop>
      <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
      <CommandList>
        {loading ? (
          <div className="space-y-1.5 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : (
          <>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((g, gi) => (
              <CommandGroup key={g.heading ?? `__${gi}`} heading={g.heading ?? undefined}>
                {g.items.map((item) => {
                  const v = getValue(item)
                  const selected = isSelected(v)
                  const label = getLabel(item)
                  const kw = [label, ...(getKeywords?.(item) ?? [])].filter(Boolean) as string[]
                  return (
                    <CommandItem
                      key={v}
                      value={v}
                      keywords={kw}
                      disabled={isItemDisabled?.(item)}
                      onSelect={() => onSelect(item)}
                      data-checked={selected || undefined}
                      className="gap-2"
                    >
                      {multi ? (
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong transition-colors",
                            selected && "border-primary bg-primary text-primary-foreground"
                          )}
                        >
                          {selected && <Check className="size-3 text-primary-foreground!" strokeWidth={3} />}
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        {renderItem ? renderItem(item, { selected }) : <span className="truncate">{label}</span>}
                      </div>
                      {!multi && (
                        <Check className={cn("size-4 shrink-0 text-primary!", selected ? "opacity-100" : "opacity-0")} />
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
            {footer && (
              <>
                <CommandSeparator />
                <div className="p-1">{footer}</div>
              </>
            )}
          </>
        )}
      </CommandList>
      {bottom}
    </Command>
  )
}

function useOpenState(open?: boolean, onOpenChange?: (o: boolean) => void) {
  const [inner, setInner] = React.useState(false)
  const isOpen = open ?? inner
  const setOpen = React.useCallback(
    (o: boolean) => {
      if (open === undefined) setInner(o)
      onOpenChange?.(o)
    },
    [open, onOpenChange]
  )
  return [isOpen, setOpen] as const
}

/* -------------------------------------------------------------------------- */
/* Combobox (single)                                                          */
/* -------------------------------------------------------------------------- */

export function Combobox<T>(props: ComboboxProps<T>) {
  const {
    items,
    getValue,
    getLabel,
    value,
    onValueChange,
    clearable,
    renderValue,
    placeholder = "Select…",
    disabled,
    className,
    contentClassName,
    align = "start",
    modal = true,
    id,
    size = "default",
  } = props
  const [open, setOpen] = useOpenState(props.open, props.onOpenChange)
  const [search, setSearch] = React.useState("")
  const selectedItem = React.useMemo(
    () => (value ? items.find((i) => getValue(i) === value) ?? null : null),
    [items, value, getValue]
  )

  React.useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <div className={cn("relative w-full", className)}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-invalid={props["aria-invalid"]}
            className={cn(triggerBase, size === "sm" ? "h-7" : "h-8", clearable && selectedItem && "pr-12")}
          >
            <span className={cn("min-w-0 flex-1 truncate", !selectedItem && "text-muted-foreground")}>
              {selectedItem ? (renderValue ? renderValue(selectedItem) : getLabel(selectedItem)) : placeholder}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {clearable && selectedItem && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onValueChange(null, null)}
            className="absolute top-1/2 right-7 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent
        align={align}
        className={cn("w-(--radix-popover-trigger-width) min-w-[260px] p-0", contentClassName)}
      >
        <ComboboxList
          props={props}
          search={search}
          setSearch={setSearch}
          isSelected={(v) => v === value}
          onSelect={(item) => {
            const v = getValue(item)
            if (v === value && clearable) onValueChange(null, null)
            else onValueChange(v, item)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/* -------------------------------------------------------------------------- */
/* MultiCombobox                                                              */
/* -------------------------------------------------------------------------- */

export function MultiCombobox<T>(props: MultiComboboxProps<T>) {
  const {
    items,
    getValue,
    getLabel,
    getKeywords,
    value,
    onValueChange,
    maxChips = 3,
    renderChip,
    placeholder = "Select…",
    disabled,
    className,
    contentClassName,
    align = "start",
    modal = true,
    id,
    showBulkActions = true,
    clearable = true,
    size = "default",
  } = props
  const [open, setOpen] = useOpenState(props.open, props.onOpenChange)
  const [search, setSearch] = React.useState("")
  const selectedSet = React.useMemo(() => new Set(value), [value])
  const byId = React.useMemo(() => {
    const m = new Map<string, T>()
    for (const i of items) m.set(getValue(i), i)
    return m
  }, [items, getValue])
  const selectedItems = React.useMemo(
    () => value.map((v) => byId.get(v)).filter(Boolean) as T[],
    [value, byId]
  )

  React.useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const emit = (ids: string[]) => {
    onValueChange(ids, ids.map((v) => byId.get(v)).filter(Boolean) as T[])
  }
  const toggle = (item: T) => {
    const v = getValue(item)
    if (selectedSet.has(v)) emit(value.filter((x) => x !== v))
    else emit([...value, v])
  }
  const matching = React.useMemo(() => {
    if (!search.trim()) return items
    return items.filter((i) =>
      fuzzyFilter("", search, [getLabel(i), ...((getKeywords?.(i) ?? []).filter(Boolean) as string[])]) > 0
    )
  }, [items, search, getLabel, getKeywords])

  const visible = selectedItems.slice(0, maxChips)
  const overflow = selectedItems.length - visible.length

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild disabled={disabled}>
        <div
          id={id}
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          aria-expanded={open}
          aria-disabled={disabled}
          aria-invalid={props["aria-invalid"]}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
            }
          }}
          className={cn(
            triggerBase,
            "cursor-pointer flex-wrap py-1",
            size === "sm" ? "min-h-7" : "min-h-8",
            disabled && "pointer-events-none opacity-50",
            className
          )}
        >
          {selectedItems.length === 0 ? (
            <span className="flex-1 truncate text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {visible.map((item) => (
                <span
                  key={getValue(item)}
                  className="inline-flex h-5 max-w-[180px] items-center gap-1 rounded-[4px] border border-border-strong bg-surface-2 pr-0.5 pl-1.5 text-xs"
                >
                  <span className="truncate">{renderChip ? renderChip(item) : getLabel(item)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${getLabel(item)}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(item)
                    }}
                    className="rounded-[3px] p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {overflow > 0 && (
                <span className="inline-flex h-5 items-center rounded-[4px] bg-muted px-1.5 font-data text-[11px] text-muted-foreground">
                  +{overflow}
                </span>
              )}
            </span>
          )}
          {clearable && selectedItems.length > 0 && (
            <button
              type="button"
              aria-label="Clear selection"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                emit([])
              }}
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-(--radix-popover-trigger-width) min-w-[280px] p-0", contentClassName)}
      >
        <ComboboxList
          multi
          props={props}
          search={search}
          setSearch={setSearch}
          isSelected={(v) => selectedSet.has(v)}
          onSelect={toggle}
          bottom={
            showBulkActions ? (
              <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5 text-xs">
                <span className="font-data text-muted-foreground tabular-nums">
                  {value.length} selected
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    disabled={matching.length === 0}
                    onClick={() => {
                      const ids = new Set(value)
                      for (const i of matching) if (!props.isItemDisabled?.(i)) ids.add(getValue(i))
                      emit([...ids])
                    }}
                  >
                    {search.trim() ? `Select ${matching.length} matching` : "Select all"}
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    disabled={value.length === 0}
                    onClick={() => emit([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : null
          }
        />
      </PopoverContent>
    </Popover>
  )
}
