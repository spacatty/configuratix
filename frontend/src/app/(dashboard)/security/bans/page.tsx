"use client";

import { useEffect, useState } from "react";
import { api, SecurityIPBan, BanListPage, ImportBansResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  AlertTriangle,
  Shield,
} from "lucide-react";

export default function IPBlacklistPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BanListPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(true);

  // Dialogs
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);

  // Form state
  const [newBanIP, setNewBanIP] = useState("");
  const [newBanReason, setNewBanReason] = useState("manual");
  const [newBanExpiry, setNewBanExpiry] = useState(30);
  const [importText, setImportText] = useState("");
  const [importReason, setImportReason] = useState("imported");
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      // Reload bans from database
      await loadBans();
      toast.success("Bans reloaded from database");
    } catch (err) {
      toast.error("Failed to refresh");
    } finally {
      setSyncing(false);
    }
  };

  const loadBans = async () => {
    setLoading(true);
    try {
      const result = await api.listSecurityBans({
        page,
        page_size: pageSize,
        search: search || undefined,
        reason: reasonFilter || undefined,
        active_only: activeOnly,
      });
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load bans");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBans();
  }, [page, pageSize, search, reasonFilter, activeOnly]);

  const handleAddBan = async () => {
    if (!newBanIP.trim()) {
      toast.error("IP address is required");
      return;
    }

    setSubmitting(true);
    try {
      await api.createSecurityBan({
        ip_address: newBanIP.trim(),
        reason: newBanReason,
        expires_in_days: newBanExpiry,
      });
      toast.success("IP banned successfully");
      setShowAddDialog(false);
      setNewBanIP("");
      loadBans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to ban IP");
    } finally {
      setSubmitting(false);
    }
  };

  const handleImport = async () => {
    const ips = importText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    if (ips.length === 0) {
      toast.error("No valid IPs found");
      return;
    }

    setSubmitting(true);
    try {
      const result: ImportBansResponse = await api.importSecurityBans({
        ips,
        reason: importReason,
      });
      toast.success(
        `Imported ${result.imported} IPs. Skipped: ${result.skipped_whitelist} (whitelisted), ${result.already_banned} (already banned), ${result.invalid} (invalid)`
      );
      setShowImportDialog(false);
      setImportText("");
      loadBans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (ban: SecurityIPBan) => {
    try {
      await api.deleteSecurityBan(ban.id);
      toast.success("IP unbanned");
      loadBans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unban");
    }
  };

  const handleClearAll = async () => {
    setSubmitting(true);
    try {
      const result = await api.deleteAllSecurityBans();
      toast.success(`Unbanned ${result.unbanned} IPs`);
      setShowClearAllDialog(false);
      loadBans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear bans");
    } finally {
      setSubmitting(false);
    }
  };

  const getReasonBadge = (reason: string) => {
    switch (reason) {
      case "blocked_ua":
        return <Badge variant="destructive">Blocked UA</Badge>;
      case "invalid_endpoint":
        return <Badge variant="destructive">Invalid Path</Badge>;
      case "manual":
        return <Badge variant="secondary">Manual</Badge>;
      case "imported":
        return <Badge variant="outline">Imported</Badge>;
      default:
        return <Badge>{reason}</Badge>;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatExpiry = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    if (diff <= 0) return "Expired";
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days > 30) return `${Math.ceil(days / 30)} months`;
    return `${days} days`;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-destructive" />
          <div>
            <h1 className="text-2xl font-bold">IP Blacklist</h1>
            <p className="text-muted-foreground">
              {data ? `${data.total} total bans` : "Loading..."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? "Syncing..." : "Sync & Refresh"}
          </Button>
          <Button variant="outline" onClick={() => setShowImportDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Ban IP
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap items-end">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs text-muted-foreground">Search IP</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="192.168..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-10"
            />
          </div>
        </div>

        <div className="w-40">
          <Label className="text-xs text-muted-foreground">Reason</Label>
          <Select
            value={reasonFilter}
            onValueChange={(v) => {
              setReasonFilter(v === "all" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="All reasons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              <SelectItem value="blocked_ua">Blocked UA</SelectItem>
              <SelectItem value="invalid_endpoint">Invalid Path</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="imported">Imported</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={activeOnly ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveOnly(true);
              setPage(1);
            }}
          >
            Active
          </Button>
          <Button
            variant={!activeOnly ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveOnly(false);
              setPage(1);
            }}
          >
            All
          </Button>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowClearAllDialog(true)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Unban All
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">IP Address</TableHead>
              <TableHead className="w-32">Reason</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="w-40">Source</TableHead>
              <TableHead className="w-40">Banned</TableHead>
              <TableHead className="w-32">Expires</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data?.bans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Ban className="h-8 w-8" />
                    <p>No banned IPs found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data?.bans.map((ban) => (
                <TableRow key={ban.id} className={!ban.is_active ? "opacity-50" : ""}>
                  <TableCell className="font-mono font-medium">
                    {ban.ip_address}
                  </TableCell>
                  <TableCell>{getReasonBadge(ban.reason)}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                    {ban.details?.user_agent || ban.details?.path || "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ban.source_machine_name || "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDate(ban.banned_at)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatExpiry(ban.expires_at)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleDelete(ban)}>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Unban
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.total_pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.total_pages}
              onClick={() => setPage(page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Add Ban Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban IP Address</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>IP Address</Label>
              <Input
                placeholder="192.168.1.100"
                value={newBanIP}
                onChange={(e) => setNewBanIP(e.target.value)}
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Select value={newBanReason} onValueChange={setNewBanReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual Ban</SelectItem>
                  <SelectItem value="blocked_ua">Blocked UA</SelectItem>
                  <SelectItem value="invalid_endpoint">Invalid Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expires In (days)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={newBanExpiry}
                onChange={(e) => setNewBanExpiry(parseInt(e.target.value) || 30)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddBan} disabled={submitting}>
              {submitting ? "Banning..." : "Ban IP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import IP Addresses</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>IPs (one per line)</Label>
              <Textarea
                placeholder={"192.168.1.100\n10.0.0.1\n# Comments are ignored"}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={10}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Select value={importReason} onValueChange={setImportReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="imported">Imported</SelectItem>
                  <SelectItem value="manual">Manual Ban</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={submitting}>
              {submitting ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear All Confirmation Dialog */}
      <Dialog open={showClearAllDialog} onOpenChange={setShowClearAllDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Unban All IPs
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            This will remove all {data?.total || 0} banned IPs from the blacklist. 
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearAllDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearAll} disabled={submitting}>
              {submitting ? "Clearing..." : "Unban All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

