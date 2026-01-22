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
import { MoreHorizontal, Pencil, Trash, Copy, FileCode, Cog, Lock, LockOpen, Shield, ShieldOff, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
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
  const [formIsPassthrough, setFormIsPassthrough] = useState(false);
  const [formPassthroughTarget, setFormPassthroughTarget] = useState("");
  const [formSslMode, setFormSslMode] = useState("allow_http");
  const [formSslEmail, setFormSslEmail] = useState("");
  const [formCorsEnabled, setFormCorsEnabled] = useState(true);
  const [formCorsAllowAll, setFormCorsAllowAll] = useState(true);
  const [formEnablePHP, setFormEnablePHP] = useState(false);
  const [formAutoindexOff, setFormAutoindexOff] = useState(true);
  const [formDenyAllCatchall, setFormDenyAllCatchall] = useState(true);
  const [formLocations, setFormLocations] = useState<LocationConfig[]>([{ path: "/", match_type: "prefix", type: "proxy", proxy_url: "" }]);
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
    setFormIsPassthrough(false);
    setFormPassthroughTarget("");
    setFormSslMode("allow_http");
    setFormSslEmail("");
    setFormCorsEnabled(true);
    setFormCorsAllowAll(true);
    setFormEnablePHP(false);
    setFormAutoindexOff(true);
    setFormDenyAllCatchall(true);
    setFormLocations([{ path: "/", type: "proxy", proxy_url: "" }]);
    setFormRawText("");
  };

  const handleCreateConfig = async () => {
    if (!formName.trim()) return;
    try {
      // Apply PHP setting to all static locations
      const locationsWithPHP = formLocations.map(loc => ({
        ...loc,
        use_php: loc.type === "static" ? formEnablePHP : false,
      }));
      const structured: NginxConfigStructured = {
        is_passthrough: formIsPassthrough,
        passthrough_target: formIsPassthrough ? formPassthroughTarget : undefined,
        ssl_mode: formSslMode,
        ssl_email: formSslEmail || undefined,
        locations: formIsPassthrough ? [] : locationsWithPHP,
        cors: formIsPassthrough ? null : { enabled: formCorsEnabled, allow_all: formCorsAllowAll },
        autoindex_off: formIsPassthrough ? undefined : formAutoindexOff,
        deny_all_catchall: formIsPassthrough ? undefined : formDenyAllCatchall,
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
      // Apply PHP setting to all static locations
      const locationsWithPHP = formLocations.map(loc => ({
        ...loc,
        use_php: loc.type === "static" ? formEnablePHP : false,
      }));
      const structured: NginxConfigStructured = {
        is_passthrough: formIsPassthrough,
        passthrough_target: formIsPassthrough ? formPassthroughTarget : undefined,
        ssl_mode: formSslMode,
        ssl_email: formSslEmail || undefined,
        locations: formIsPassthrough ? [] : locationsWithPHP,
        cors: formIsPassthrough ? null : { enabled: formCorsEnabled, allow_all: formCorsAllowAll },
        autoindex_off: formIsPassthrough ? undefined : formAutoindexOff,
        deny_all_catchall: formIsPassthrough ? undefined : formDenyAllCatchall,
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
      // Passthrough settings
      setFormIsPassthrough(structured.is_passthrough ?? false);
      setFormPassthroughTarget(structured.passthrough_target || "");
      // Standard settings
      setFormSslMode(structured.ssl_mode || "allow_http");
      setFormSslEmail(structured.ssl_email || "");
      setFormCorsEnabled(structured.cors?.enabled ?? true);
      setFormCorsAllowAll(structured.cors?.allow_all ?? true);
      setFormAutoindexOff(structured.autoindex_off ?? true);
      setFormDenyAllCatchall(structured.deny_all_catchall ?? true);
      setFormLocations(structured.locations || [{ path: "/", type: "proxy", proxy_url: "" }]);
      // Check if any static location has PHP enabled
      setFormEnablePHP(structured.locations?.some(loc => loc.use_php) ?? false);
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

  const moveLocationUp = useCallback((index: number) => {
    if (index === 0) return;
    setFormLocations(prev => {
      const newLocs = [...prev];
      [newLocs[index - 1], newLocs[index]] = [newLocs[index], newLocs[index - 1]];
      return newLocs;
    });
  }, []);

  const moveLocationDown = useCallback((index: number) => {
    setFormLocations(prev => {
      if (index === prev.length - 1) return prev;
      const newLocs = [...prev];
      [newLocs[index], newLocs[index + 1]] = [newLocs[index + 1], newLocs[index]];
      return newLocs;
    });
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
        <Badge className={row.original.mode === "manual" 
          ? "bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs"
          : "bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs"
        }>
          <Cog className="h-3 w-3 mr-1" />
          {row.original.mode === "manual" ? "Manual" : "Auto"}
        </Badge>
      ),
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        const structured = row.original.structured_json as NginxConfigStructured | null;
        if (structured?.is_passthrough) {
          return (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
              Passthrough
            </Badge>
          );
        }
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
            HTTP
          </Badge>
        );
      },
    },
    {
      accessorKey: "ssl",
      header: "SSL",
      cell: ({ row }) => {
        const structured = row.original.structured_json as NginxConfigStructured | null;
        if (!structured) return <span className="text-muted-foreground">—</span>;
        
        // Passthrough configs don't terminate SSL
        if (structured.is_passthrough) {
          return (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
              Backend
            </Badge>
          );
        }
        
        const sslMode = structured.ssl_mode;
        if (sslMode === "disabled") {
          return (
            <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">
              <LockOpen className="h-3 w-3 mr-1" />
              Disabled
            </Badge>
          );
        }
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
            <Lock className="h-3 w-3 mr-1" />
            {sslMode === "redirect_https" ? "Force HTTPS" : "Allow HTTP"}
          </Badge>
        );
      },
    },
    {
      accessorKey: "cors",
      header: "CORS",
      cell: ({ row }) => {
        const structured = row.original.structured_json as NginxConfigStructured | null;
        return structured?.cors?.enabled ? (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
            <Shield className="h-3 w-3 mr-1" />
            {structured.cors.allow_all ? "Allow All" : "Custom"}
          </Badge>
        ) : (
          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">
            <ShieldOff className="h-3 w-3 mr-1" />
            Disabled
          </Badge>
        );
      },
    },
    {
      accessorKey: "php",
      header: "PHP",
      cell: ({ row }) => {
        const structured = row.original.structured_json as NginxConfigStructured | null;
        const hasPHP = structured?.locations?.some(loc => loc.use_php);
        return hasPHP ? (
          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
            Enabled
          </Badge>
        ) : (
          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">
            —
          </Badge>
        );
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
    <Card key={`${keyPrefix}-${index}`} className="border-border/50 bg-card/30">
      <CardContent className="p-4 space-y-4">
        {/* Header row with order controls */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5">
            <Button 
              type="button" 
              variant="ghost" 
              size="icon" 
              className="h-5 w-5" 
              onClick={() => moveLocationUp(index)}
              disabled={index === 0}
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button 
              type="button" 
              variant="ghost" 
              size="icon" 
              className="h-5 w-5" 
              onClick={() => moveLocationDown(index)}
              disabled={index === formLocations.length - 1}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
          </div>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <Badge variant="outline" className="font-mono text-xs">#{index + 1}</Badge>
          <div className="flex-1" />
          {formLocations.length > 1 && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeLocation(index)}>
              <Trash className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Location path config */}
        <div className="grid grid-cols-[100px_1fr_120px] gap-2">
          <Select value={loc.match_type || "prefix"} onValueChange={(value) => updateLocation(index, { match_type: value })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefix">Prefix</SelectItem>
              <SelectItem value="exact">Exact =</SelectItem>
              <SelectItem value="regex">Regex ~</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="/" value={loc.path} onChange={(e) => updateLocation(index, { path: e.target.value })} className="h-9 font-mono" />
          <Select value={loc.type} onValueChange={(value) => updateLocation(index, { type: value })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="proxy">Proxy</SelectItem>
              <SelectItem value="static">Static</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Type-specific config */}
        {loc.type === "proxy" ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Proxy URL</Label>
            <Input placeholder="http://localhost:3000" value={loc.proxy_url || ""} onChange={(e) => updateLocation(index, { proxy_url: e.target.value })} className="h-9 font-mono" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Source</Label>
                <Select value={loc.static_type || "local"} onValueChange={(value) => updateLocation(index, { static_type: value })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local Path</SelectItem>
                    <SelectItem value="landing">Static Content</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {loc.static_type === "landing" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Content</Label>
                  <Select value={loc.landing_id || ""} onValueChange={(value) => updateLocation(index, { landing_id: value })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {landings.length === 0 ? (
                        <SelectItem value="" disabled>No content</SelectItem>
                      ) : landings.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name} ({l.type.toUpperCase()})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Root Path</Label>
              <Input placeholder="/var/www/html" value={loc.root || ""} onChange={(e) => updateLocation(index, { root: e.target.value })} className="h-9 font-mono" />
            </div>
            {loc.static_type !== "landing" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Index Files</Label>
                <Input placeholder="index.html index.htm" value={loc.index || ""} onChange={(e) => updateLocation(index, { index: e.target.value })} className="h-9 font-mono" />
              </div>
            )}
            {loc.static_type === "landing" && (
              <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <div>
                  <Label className="text-sm">Replace on Deploy</Label>
                  <p className="text-xs text-muted-foreground">Overwrite files when redeploying</p>
                </div>
                <Switch 
                  checked={loc.replace_landing_content ?? true} 
                  onCheckedChange={(checked) => updateLocation(index, { replace_landing_content: checked })} 
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderFormContent = () => (
    <div ref={scrollContainerRef} className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
      {/* Basic Settings */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Configuration Name</Label>
          <Input placeholder="My Nginx Config" value={formName} onChange={(e) => setFormName(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-2">
          <Label>Mode</Label>
          <Select value={formMode} onValueChange={setFormMode}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (UI Builder)</SelectItem>
              <SelectItem value="manual">Manual (Raw Config)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {formMode === "auto" ? (
        <>
          {/* Passthrough Mode Toggle */}
          <Card className={`border-2 transition-colors ${formIsPassthrough ? "border-amber-500/50 bg-amber-500/5" : "border-border/50 bg-card/30"}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">SSL Passthrough Mode</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Forward raw TCP/TLS traffic to backend without SSL termination. 
                    Certificate must be configured on the target server.
                  </p>
                </div>
                <Switch checked={formIsPassthrough} onCheckedChange={setFormIsPassthrough} />
              </div>
              
              {formIsPassthrough && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Backend Target</Label>
                    <Input 
                      placeholder="192.168.1.10:443 or backend.example.com:443" 
                      value={formPassthroughTarget} 
                      onChange={(e) => setFormPassthroughTarget(e.target.value)} 
                      className="h-9 font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      The server that handles SSL and serves the content. Format: host:port
                    </p>
                  </div>
                  
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm space-y-3">
                    <p className="font-medium text-amber-400">⚠️ Backend Configuration Required</p>
                    
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">
                        <strong>Step 1:</strong> Create initial HTTP config to get certificate:
                      </p>
                      <pre className="text-xs bg-black/30 p-2 rounded overflow-x-auto font-mono text-green-300/80">{`server {
    listen 80;
    server_name domain.com;
    
    location / {
        root /var/www/html;
        # Or proxy to your app
    }
}`}</pre>
                    </div>
                    
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">
                        Then run: <code className="bg-black/30 px-1 rounded">certbot --nginx -d domain.com</code>
                      </p>
                    </div>
                    
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">
                        <strong>Step 2:</strong> Update to accept PROXY Protocol for HTTPS:
                      </p>
                      <pre className="text-xs bg-black/30 p-2 rounded overflow-x-auto font-mono text-amber-300/80">{`server {
    listen 80;
    listen 443 ssl proxy_protocol;
    server_name domain.com;
    
    # Real IP from PROXY Protocol
    set_real_ip_from 0.0.0.0/0;
    real_ip_header proxy_protocol;
    
    ssl_certificate /etc/letsencrypt/live/domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/domain.com/privkey.pem;
    
    location / {
        # Your app config
    }
}`}</pre>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Only show standard config if NOT passthrough */}
          {!formIsPassthrough && (
            <>
              {/* SSL & CORS Row */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-4 space-y-3">
                    <Label className="text-sm font-medium">SSL Settings</Label>
                    <Select value={formSslMode} onValueChange={setFormSslMode}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">Disabled</SelectItem>
                        <SelectItem value="allow_http">Allow HTTP</SelectItem>
                        <SelectItem value="redirect_https">Force HTTPS</SelectItem>
                      </SelectContent>
                    </Select>
                    {formSslMode !== "disabled" && (
                      <Input type="email" placeholder="admin@example.com" value={formSslEmail} onChange={(e) => setFormSslEmail(e.target.value)} className="h-9" />
                    )}
                  </CardContent>
                </Card>
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">CORS</Label>
                      <Switch checked={formCorsEnabled} onCheckedChange={setFormCorsEnabled} />
                    </div>
                    {formCorsEnabled && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Allow All Origins</span>
                        <Switch checked={formCorsAllowAll} onCheckedChange={setFormCorsAllowAll} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Features & Security Row */}
              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/30">
                  <div>
                    <Label className="text-sm">PHP Support</Label>
                    <p className="text-xs text-muted-foreground">Process .php files</p>
                  </div>
                  <Switch checked={formEnablePHP} onCheckedChange={setFormEnablePHP} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/30">
                  <div>
                    <Label className="text-sm">No Directory List</Label>
                    <p className="text-xs text-muted-foreground">autoindex off</p>
                  </div>
                  <Switch checked={formAutoindexOff} onCheckedChange={setFormAutoindexOff} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/30">
                  <div>
                    <Label className="text-sm">Deny Catch-all</Label>
                    <p className="text-xs text-muted-foreground">Block undefined paths</p>
                  </div>
                  <Switch checked={formDenyAllCatchall} onCheckedChange={setFormDenyAllCatchall} />
                </div>
              </div>

              {/* Locations Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium">Locations</Label>
                    <p className="text-xs text-muted-foreground">Order matters in Nginx - first match wins. Use arrows to reorder.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addLocation}>+ Add Location</Button>
                </div>
                <div className="space-y-3">
                  {formLocations.map((loc, index) => renderLocationFields(loc, index, "loc"))}
                </div>
              </div>
            </>
          )}
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
        <DialogContent className="max-w-4xl max-h-[90vh]">
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
        <DialogContent className="max-w-4xl max-h-[90vh]">
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
