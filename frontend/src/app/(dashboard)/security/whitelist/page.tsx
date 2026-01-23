"use client";

import { useEffect, useState } from "react";
import { api, SecurityIPWhitelist } from "@/lib/api";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash2, Info } from "lucide-react";

export default function WhitelistPage() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<SecurityIPWhitelist[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newIP, setNewIP] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadWhitelist = async () => {
    setLoading(true);
    try {
      const result = await api.listSecurityWhitelist();
      setEntries(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load whitelist");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWhitelist();
  }, []);

  const handleAdd = async () => {
    if (!newIP.trim()) {
      toast.error("IP or CIDR is required");
      return;
    }

    setSubmitting(true);
    try {
      await api.createSecurityWhitelistEntry({
        ip_cidr: newIP.trim(),
        description: newDescription.trim(),
      });
      toast.success("Added to whitelist");
      setShowAddDialog(false);
      setNewIP("");
      setNewDescription("");
      loadWhitelist();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entry: SecurityIPWhitelist) => {
    try {
      await api.deleteSecurityWhitelistEntry(entry.id);
      toast.success("Removed from whitelist");
      loadWhitelist();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const isCIDR = (ip: string) => ip.includes("/") && !ip.endsWith("/32");

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-green-500" />
          <div>
            <h1 className="text-2xl font-bold">IP Whitelist</h1>
            <p className="text-muted-foreground">
              {entries.length} whitelisted {entries.length === 1 ? "entry" : "entries"}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add to Whitelist
        </Button>
      </div>

      {/* Info Box */}
      <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg border">
        <Info className="h-5 w-5 text-blue-500 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">About Whitelist</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Whitelisted IPs can never be banned</li>
            <li>If a whitelisted IP is already banned, the ban is automatically removed</li>
            <li>You can add single IPs or CIDR ranges (e.g., 192.168.1.0/24)</li>
            <li>Whitelist is shared across all machines and agents</li>
          </ul>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">IP / CIDR</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-48">Added</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="h-8 w-8" />
                    <p>No whitelisted IPs</p>
                    <p className="text-sm">Add IPs that should never be banned</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono font-medium">
                    <div className="flex items-center gap-2">
                      {entry.ip_cidr}
                      {isCIDR(entry.ip_cidr) && (
                        <Badge variant="outline" className="text-xs">
                          CIDR
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.description || "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(entry.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(entry)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Whitelist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>IP Address or CIDR</Label>
              <Input
                placeholder="192.168.1.100 or 10.0.0.0/8"
                value={newIP}
                onChange={(e) => setNewIP(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Single IP (e.g., 192.168.1.1) or CIDR range (e.g., 192.168.1.0/24)
              </p>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                placeholder="Office network, VPN server, etc."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={submitting}>
              {submitting ? "Adding..." : "Add to Whitelist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

