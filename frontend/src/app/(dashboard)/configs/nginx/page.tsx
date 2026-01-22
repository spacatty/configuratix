"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, NginxConfig, NginxConfigStructured, LocationConfig, Landing } from "@/lib/api";
import { MoreHorizontal, Pencil, Trash, Copy, FileCode } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export default function NginxConfigsPage() {
  const [configs, setConfigs] = useState<NginxConfig[]>([]);
  const [landings, setLandings] = useState<Landing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<NginxConfig | null>(null);
  
  const [formName, setFormName] = useState("");
  const [formMode, setFormMode] = useState("auto");
  const [formSslMode, setFormSslMode] = useState("allow_http");
  const [formSslEmail, setFormSslEmail] = useState("");
  const [formCorsEnabled, setFormCorsEnabled] = useState(true);
  const [formCorsAllowAll, setFormCorsAllowAll] = useState(true);
  const [formLocations, setFormLocations] = useState<LocationConfig[]>([{ path: "/", type: "proxy", proxy_url: "" }]);
  const [formRawText, setFormRawText] = useState("");
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    try {
      const [configsData, landingsData] = await Promise.all([
        api.listNginxConfigs(),
        api.listLandings(),
      ]);
      setConfigs(configsData);
      setLandings(landingsData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => {
    setFormName("");
    setFormMode("auto");
    setFormSslMode("allow_http");
    setFormSslEmail("");
    setFormCorsEnabled(true);
    setFormCorsAllowAll(true);
    setFormLocations([{ path: "/", type: "proxy", proxy_url: "" }]);
    setFormRawText("");
  };

  const handleCreateConfig = async () => {
    if (!formName.trim()) return;
    try {
      const structured: NginxConfigStructured = {
        ssl_mode: formSslMode,
        ssl_email: formSslEmail || undefined,
        locations: formLocations,
        cors: { enabled: formCorsEnabled, allow_all: formCorsAllowAll },
      };
      await api.createNginxConfig({
        name: formName,
        mode: formMode,
        structured_json: formMode === "auto" ? structured : undefined,
        raw_text: formMode === "manual" ? formRawText : undefined,
      });
      setShowCreateDialog(false);
      resetForm();
      loadData();
      toast.success("Configuration created");
    } catch (err) {
      console.error("Failed to create config:", err);
      toast.error("Failed to create config");
    }
  };

  const handleUpdateConfig = async () => {
    if (!selectedConfig || !formName.trim()) return;
    try {
      const structured: NginxConfigStructured = {
        ssl_mode: formSslMode,
        ssl_email: formSslEmail || undefined,
        locations: formLocations,
        cors: { enabled: formCorsEnabled, allow_all: formCorsAllowAll },
      };
      await api.updateNginxConfig(selectedConfig.id, {
        name: formName,
        mode: formMode,
        structured_json: formMode === "auto" ? structured : undefined,
        raw_text: formMode === "manual" ? formRawText : undefined,
      });
      setShowEditDialog(false);
      setSelectedConfig(null);
      resetForm();
      loadData();
      toast.success("Configuration updated");
    } catch (err) {
      console.error("Failed to update config:", err);
      toast.error("Failed to update config");
    }
  };

  const handleDeleteConfig = async () => {
    if (!selectedConfig) return;
    try {
      await api.deleteNginxConfig(selectedConfig.id);
      setShowDeleteDialog(false);
      setSelectedConfig(null);
      loadData();
      toast.success("Configuration deleted");
    } catch (err) {
      console.error("Failed to delete config:", err);
      toast.error("Failed to delete config");
    }
  };

  const openEditDialog = (config: NginxConfig) => {
    setSelectedConfig(config);
    setFormName(config.name);
    setFormMode(config.mode);
    setFormRawText(config.raw_text || "");
    if (config.structured_json) {
      const structured = config.structured_json as NginxConfigStructured;
      setFormSslMode(structured.ssl_mode || "allow_http");
      setFormSslEmail(structured.ssl_email || "");
      setFormCorsEnabled(structured.cors?.enabled ?? true);
      setFormCorsAllowAll(structured.cors?.allow_all ?? true);
      setFormLocations(structured.locations || [{ path: "/", type: "proxy", proxy_url: "" }]);
    }
    setShowEditDialog(true);
  };

  const openDeleteDialog = (config: NginxConfig) => {
    setSelectedConfig(config);
    setShowDeleteDialog(true);
  };

  const addLocation = useCallback(() => {
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    setFormLocations(prev => [...prev, { path: "/api", type: "proxy", proxy_url: "" }]);
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = scrollTop;
    });
  }, []);

  const removeLocation = useCallback((index: number) => {
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    setFormLocations(prev => prev.filter((_, i) => i !== index));
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = scrollTop;
    });
  }, []);

  const updateLocation = useCallback((index: number, updates: Partial<LocationConfig>) => {
    setFormLocations(prev => prev.map((loc, i) => i === index ? { ...loc, ...updates } : loc));
  }, []);

  const columns: ColumnDef<NginxConfig>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const config = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-green-500/20 to-green-500/5 flex items-center justify-center">
              <FileCode className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <div className="font-medium">{config.name}</div>
              <div className="text-xs text-muted-foreground">
                {(config.structured_json as NginxConfigStructured | null)?.locations?.length || 0} location(s)
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "mode",
      header: "Mode",
      cell: ({ row }) => (
        <Badge variant={row.original.mode === "manual" ? "secondary" : "default"}>
          {row.original.mode}
        </Badge>
      ),
    },
    {
      accessorKey: "ssl",
      header: "SSL",
      cell: ({ row }) => {
        const structured = row.original.structured_json as NginxConfigStructured | null;
        return structured ? (
          <Badge variant="outline" className="text-xs">{structured.ssl_mode}</Badge>
        ) : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: "cors",
      header: "CORS",
      cell: ({ row }) => {
        const structured = row.original.structured_json as NginxConfigStructured | null;
        return structured?.cors?.enabled ? (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
            {structured.cors.allow_all ? "Allow All" : "Custom"}
          </Badge>
        ) : <span className="text-muted-foreground text-sm">Disabled</span>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const config = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEditDialog(config)}>
                <Pencil className="h-4 w-4 mr-2" />Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(config.id)}>
                <Copy className="h-4 w-4 mr-2" />Copy ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openDeleteDialog(config)} className="text-destructive focus:text-destructive">
                <Trash className="h-4 w-4 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const renderLocationFields = (loc: LocationConfig, index: number, keyPrefix: string) => (
    <Card key={`${keyPrefix}-${index}`} className="border-border/50">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Input placeholder="/" value={loc.path} onChange={(e) => updateLocation(index, { path: e.target.value })} className="flex-1" />
          <Select value={loc.type} onValueChange={(value) => updateLocation(index, { type: value })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="proxy">Proxy</SelectItem>
              <SelectItem value="static">Static</SelectItem>
            </SelectContent>
          </Select>
          {formLocations.length > 1 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLocation(index)}>×</Button>
          )}
        </div>
        {loc.type === "proxy" ? (
          <Input placeholder="http://localhost:3000" value={loc.proxy_url || ""} onChange={(e) => updateLocation(index, { proxy_url: e.target.value })} />
        ) : (
          <div className="space-y-2">
            <Select value={loc.static_type || "local"} onValueChange={(value) => updateLocation(index, { static_type: value })}>
              <SelectTrigger><SelectValue placeholder="Static type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local Path</SelectItem>
                <SelectItem value="landing">Landing Page</SelectItem>
              </SelectContent>
            </Select>
            {loc.static_type === "landing" ? (
              <>
                <Select value={loc.landing_id || ""} onValueChange={(value) => updateLocation(index, { landing_id: value })}>
                  <SelectTrigger><SelectValue placeholder="Select a landing page" /></SelectTrigger>
                  <SelectContent>
                    {landings.length === 0 ? (
                      <SelectItem value="" disabled>No landings available</SelectItem>
                    ) : landings.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name} ({l.type.toUpperCase()})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input placeholder="/var/www/html/landing" value={loc.root || ""} onChange={(e) => updateLocation(index, { root: e.target.value })} />
                <p className="text-xs text-muted-foreground">Target path where landing will be extracted</p>
              </>
            ) : (
              <>
                <Input placeholder="/var/www/html" value={loc.root || ""} onChange={(e) => updateLocation(index, { root: e.target.value })} />
                <Input placeholder="index.html" value={loc.index || ""} onChange={(e) => updateLocation(index, { index: e.target.value })} />
              </>
            )}
            <div className="flex items-center justify-between pt-2 border-t">
              <Label className="text-sm">Enable PHP</Label>
              <Switch checked={loc.use_php || false} onCheckedChange={(checked) => updateLocation(index, { use_php: checked })} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderFormContent = () => (
    <div ref={scrollContainerRef} className="space-y-4 max-h-[65vh] overflow-y-auto pr-2">
      <div className="space-y-2">
        <Label>Configuration Name</Label>
        <Input placeholder="My Proxy Config" value={formName} onChange={(e) => setFormName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Mode</Label>
        <Select value={formMode} onValueChange={setFormMode}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (UI Builder)</SelectItem>
            <SelectItem value="manual">Manual (Raw Config)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {formMode === "auto" ? (
        <>
          <div className="space-y-2">
            <Label>SSL Mode</Label>
            <Select value={formSslMode} onValueChange={setFormSslMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">Disabled</SelectItem>
                <SelectItem value="allow_http">Allow Direct HTTP</SelectItem>
                <SelectItem value="redirect_https">Auto-Redirect to HTTPS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {formSslMode !== "disabled" && (
            <div className="space-y-2">
              <Label>SSL Certificate Email</Label>
              <Input type="email" placeholder="admin@yourdomain.com" value={formSslEmail} onChange={(e) => setFormSslEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">Required for Let&apos;s Encrypt certificate issuance</p>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>CORS</Label>
              <Switch checked={formCorsEnabled} onCheckedChange={setFormCorsEnabled} />
            </div>
            {formCorsEnabled && (
              <div className="flex items-center justify-between pl-4">
                <Label className="text-sm text-muted-foreground">Allow All Origins (*)</Label>
                <Switch checked={formCorsAllowAll} onCheckedChange={setFormCorsAllowAll} />
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Locations</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLocation}>Add Location</Button>
            </div>
            {formLocations.map((loc, index) => renderLocationFields(loc, index, "loc"))}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label>Raw Nginx Configuration</Label>
          <div className="border rounded-md overflow-hidden">
            <MonacoEditor
              height="350px"
              language="nginx"
              theme="vs-dark"
              value={formRawText}
              onChange={(value) => setFormRawText(value || "")}
              options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", padding: { top: 8 } }}
            />
          </div>
        </div>
      )}
    </div>
  );

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Nginx Configurations</h1>
          <p className="text-muted-foreground mt-1">Create and manage nginx configuration templates.</p>
        </div>
        <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>+ Create Config</Button>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Your Configurations</CardTitle>
          <CardDescription>Nginx config templates that can be assigned to domains.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={configs} searchKey="name" searchPlaceholder="Search configurations..." />
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Create Nginx Configuration</DialogTitle>
            <DialogDescription>Configure nginx settings for your domains.</DialogDescription>
          </DialogHeader>
          {renderFormContent()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateConfig}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Edit Nginx Configuration</DialogTitle>
            <DialogDescription>Update nginx settings.</DialogDescription>
          </DialogHeader>
          {renderFormContent()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleUpdateConfig}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedConfig?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfig} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
