"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, NginxConfig, NginxConfigStructured, LocationConfig } from "@/lib/api";
import dynamic from "next/dynamic";

// Dynamically import Monaco to avoid SSR issues
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export default function NginxConfigsPage() {
  const [configs, setConfigs] = useState<NginxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<NginxConfig | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formMode, setFormMode] = useState("auto");
  const [formSslMode, setFormSslMode] = useState("allow_http");
  const [formCorsEnabled, setFormCorsEnabled] = useState(true);
  const [formCorsAllowAll, setFormCorsAllowAll] = useState(true);
  const [formLocations, setFormLocations] = useState<LocationConfig[]>([
    { path: "/", type: "proxy", proxy_url: "" }
  ]);
  const [formRawText, setFormRawText] = useState("");
  
  // Ref to preserve scroll position
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    try {
      const data = await api.listNginxConfigs();
      setConfigs(data);
    } catch (err) {
      console.error("Failed to load configs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setFormName("");
    setFormMode("auto");
    setFormSslMode("allow_http");
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
        locations: formLocations,
        cors: {
          enabled: formCorsEnabled,
          allow_all: formCorsAllowAll,
        },
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
    } catch (err) {
      console.error("Failed to create config:", err);
      alert("Failed to create config");
    }
  };

  const handleUpdateConfig = async () => {
    if (!selectedConfig || !formName.trim()) return;
    
    try {
      const structured: NginxConfigStructured = {
        ssl_mode: formSslMode,
        locations: formLocations,
        cors: {
          enabled: formCorsEnabled,
          allow_all: formCorsAllowAll,
        },
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
    } catch (err) {
      console.error("Failed to update config:", err);
      alert("Failed to update config");
    }
  };

  const handleDeleteConfig = async (id: string) => {
    if (!confirm("Are you sure you want to delete this configuration?")) return;
    try {
      await api.deleteNginxConfig(id);
      loadData();
    } catch (err) {
      console.error("Failed to delete config:", err);
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
      setFormCorsEnabled(structured.cors?.enabled ?? true);
      setFormCorsAllowAll(structured.cors?.allow_all ?? true);
      setFormLocations(structured.locations || [{ path: "/", type: "proxy", proxy_url: "" }]);
    }
    
    setShowEditDialog(true);
  };

  const addLocation = useCallback(() => {
    // Save scroll position before update
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    
    setFormLocations(prev => [...prev, { path: "/api", type: "proxy", proxy_url: "" }]);
    
    // Restore scroll position after update
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollTop;
      }
    });
  }, []);

  const removeLocation = useCallback((index: number) => {
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    setFormLocations(prev => prev.filter((_, i) => i !== index));
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollTop;
      }
    });
  }, []);

  const updateLocation = useCallback((index: number, updates: Partial<LocationConfig>) => {
    setFormLocations(prev => prev.map((loc, i) => 
      i === index ? { ...loc, ...updates } : loc
    ));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Nginx Configurations</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage nginx configuration templates
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setShowCreateDialog(true);
          }}
          className="bg-primary hover:bg-primary/90 neon-glow"
        >
          Create Config
        </Button>
      </div>

      {configs.length === 0 ? (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>No configurations created</CardTitle>
            <CardDescription>
              Create an nginx configuration to use with your domains.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {configs.map((config) => (
            <Card key={config.id} className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{config.name}</CardTitle>
                  <Badge variant={config.mode === "manual" ? "secondary" : "default"}>
                    {config.mode}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {config.structured_json && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>SSL: {(config.structured_json as NginxConfigStructured).ssl_mode}</p>
                    <p>Locations: {(config.structured_json as NginxConfigStructured).locations?.length || 0}</p>
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEditDialog(config)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteConfig(config.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Nginx Configuration</DialogTitle>
            <DialogDescription>
              Configure nginx settings for your domains.
            </DialogDescription>
          </DialogHeader>
          <div ref={scrollContainerRef} className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            <div className="space-y-2">
              <Label htmlFor="create-name">Configuration Name</Label>
              <Input
                id="create-name"
                placeholder="My Proxy Config"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={formMode} onValueChange={setFormMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disabled">Disabled</SelectItem>
                      <SelectItem value="allow_http">Allow Direct HTTP</SelectItem>
                      <SelectItem value="redirect_https">Auto-Redirect to HTTPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

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
                    <Button type="button" variant="outline" size="sm" onClick={addLocation}>
                      Add Location
                    </Button>
                  </div>
                  {formLocations.map((loc, index) => (
                    <Card key={`loc-${index}`} className="border-border/50">
                      <CardContent className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="/"
                            value={loc.path}
                            onChange={(e) => updateLocation(index, { path: e.target.value })}
                            className="flex-1"
                          />
                          <Select
                            value={loc.type}
                            onValueChange={(value) => updateLocation(index, { type: value })}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="proxy">Proxy</SelectItem>
                              <SelectItem value="static">Static</SelectItem>
                            </SelectContent>
                          </Select>
                          {formLocations.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLocation(index)}
                            >
                              ×
                            </Button>
                          )}
                        </div>
                        {loc.type === "proxy" ? (
                          <Input
                            placeholder="http://localhost:3000"
                            value={loc.proxy_url || ""}
                            onChange={(e) => updateLocation(index, { proxy_url: e.target.value })}
                          />
                        ) : (
                          <div className="space-y-2">
                            <Input
                              placeholder="/var/www/html"
                              value={loc.root || ""}
                              onChange={(e) => updateLocation(index, { root: e.target.value })}
                            />
                            <Input
                              placeholder="index.html"
                              value={loc.index || ""}
                              onChange={(e) => updateLocation(index, { index: e.target.value })}
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>Raw Nginx Configuration</Label>
                <div className="border rounded-md overflow-hidden">
                  <MonacoEditor
                    height="300px"
                    language="nginx"
                    theme="vs-dark"
                    value={formRawText}
                    onChange={(value) => setFormRawText(value || "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      padding: { top: 8 },
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateConfig}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Nginx Configuration</DialogTitle>
            <DialogDescription>
              Update nginx settings.
            </DialogDescription>
          </DialogHeader>
          <div ref={scrollContainerRef} className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Configuration Name</Label>
              <Input
                id="edit-name"
                placeholder="My Proxy Config"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={formMode} onValueChange={setFormMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disabled">Disabled</SelectItem>
                      <SelectItem value="allow_http">Allow Direct HTTP</SelectItem>
                      <SelectItem value="redirect_https">Auto-Redirect to HTTPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

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
                    <Button type="button" variant="outline" size="sm" onClick={addLocation}>
                      Add Location
                    </Button>
                  </div>
                  {formLocations.map((loc, index) => (
                    <Card key={`edit-loc-${index}`} className="border-border/50">
                      <CardContent className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="/"
                            value={loc.path}
                            onChange={(e) => updateLocation(index, { path: e.target.value })}
                            className="flex-1"
                          />
                          <Select
                            value={loc.type}
                            onValueChange={(value) => updateLocation(index, { type: value })}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="proxy">Proxy</SelectItem>
                              <SelectItem value="static">Static</SelectItem>
                            </SelectContent>
                          </Select>
                          {formLocations.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLocation(index)}
                            >
                              ×
                            </Button>
                          )}
                        </div>
                        {loc.type === "proxy" ? (
                          <Input
                            placeholder="http://localhost:3000"
                            value={loc.proxy_url || ""}
                            onChange={(e) => updateLocation(index, { proxy_url: e.target.value })}
                          />
                        ) : (
                          <div className="space-y-2">
                            <Input
                              placeholder="/var/www/html"
                              value={loc.root || ""}
                              onChange={(e) => updateLocation(index, { root: e.target.value })}
                            />
                            <Input
                              placeholder="index.html"
                              value={loc.index || ""}
                              onChange={(e) => updateLocation(index, { index: e.target.value })}
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>Raw Nginx Configuration</Label>
                <div className="border rounded-md overflow-hidden">
                  <MonacoEditor
                    height="300px"
                    language="nginx"
                    theme="vs-dark"
                    value={formRawText}
                    onChange={(value) => setFormRawText(value || "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      padding: { top: 8 },
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateConfig}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
