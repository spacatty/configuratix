"use client";

import { useState, useEffect, useCallback } from "react";
import { api, PHPRuntime, PHPExtensionTemplate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Download, Trash2, RefreshCw, Package, Settings, AlertCircle, CheckCircle2, Clock, Server } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PHPRuntimeTabProps {
  machineId: string;
}

const PHP_VERSIONS = ["8.4", "8.3", "8.2", "8.1", "8.0"];

const AVAILABLE_EXTENSIONS = [
  "bcmath", "bz2", "curl", "dba", "enchant", "exif", "ffi", "gd", "gmp",
  "imap", "imagick", "intl", "ldap", "mbstring", "memcached", "mongodb",
  "mysqli", "odbc", "opcache", "pdo_mysql", "pdo_odbc", "pdo_pgsql",
  "pgsql", "pspell", "readline", "redis", "soap", "sockets", "sqlite3",
  "ssh2", "tidy", "xml", "xmlrpc", "xsl", "yaml", "zip", "apcu",
  "igbinary", "msgpack", "uuid", "xdebug"
];

export function PHPRuntimeTab({ machineId }: PHPRuntimeTabProps) {
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [runtime, setRuntime] = useState<PHPRuntime | null>(null);
  const [installed, setInstalled] = useState(false);
  const [templates, setTemplates] = useState<PHPExtensionTemplate[]>([]);
  
  // Form state
  const [selectedVersion, setSelectedVersion] = useState("8.3");
  const [selectedExtensions, setSelectedExtensions] = useState<string[]>(["mysqli", "curl", "mbstring", "xml", "zip"]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const loadRuntime = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getPHPRuntime(machineId);
      setInstalled(response.installed);
      if (response.runtime) {
        setRuntime(response.runtime);
        setSelectedVersion(response.runtime.version);
        setSelectedExtensions(response.runtime.extensions || []);
      }
    } catch (error) {
      console.error("Failed to load PHP runtime:", error);
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  const loadTemplates = useCallback(async () => {
    try {
      const tmpl = await api.listPHPExtensionTemplates();
      setTemplates(tmpl);
    } catch (error) {
      console.error("Failed to load templates:", error);
    }
  }, []);

  useEffect(() => {
    loadRuntime();
    loadTemplates();
  }, [loadRuntime, loadTemplates]);

  // Reload runtime status periodically when installing/removing
  useEffect(() => {
    if (runtime?.status === "installing" || runtime?.status === "removing") {
      const interval = setInterval(loadRuntime, 5000);
      return () => clearInterval(interval);
    }
  }, [runtime?.status, loadRuntime]);

  const handleInstall = async () => {
    try {
      setInstalling(true);
      await api.installPHPRuntime(machineId, selectedVersion, selectedExtensions);
      toast.success("PHP installation started");
      await loadRuntime();
    } catch (error) {
      toast.error("Failed to start PHP installation: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setInstalling(false);
    }
  };

  const handleUpdate = async () => {
    try {
      setInstalling(true);
      await api.updatePHPRuntime(machineId, selectedVersion, selectedExtensions);
      toast.success("PHP update started");
      await loadRuntime();
    } catch (error) {
      toast.error("Failed to start PHP update: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setInstalling(false);
    }
  };

  const handleRemove = async () => {
    try {
      setRemoving(true);
      await api.removePHPRuntime(machineId);
      toast.success("PHP removal started");
      await loadRuntime();
    } catch (error) {
      toast.error("Failed to start PHP removal: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setRemoving(false);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedExtensions(template.extensions);
    }
  };

  const toggleExtension = (ext: string) => {
    setSelectedExtensions(prev => 
      prev.includes(ext) 
        ? prev.filter(e => e !== ext)
        : [...prev, ext]
    );
    setSelectedTemplate(""); // Clear template selection when manually editing
  };

  const getStatusBadge = () => {
    if (!runtime) return null;
    
    switch (runtime.status) {
      case "installed":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Installed</Badge>;
      case "installing":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Installing</Badge>;
      case "removing":
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Removing</Badge>;
      case "failed":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><AlertCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">{runtime.status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Runtime Status */}
      {installed && runtime && (
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
                  <Server className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    PHP {runtime.version}
                    {getStatusBadge()}
                  </CardTitle>
                  <CardDescription>
                    {runtime.socket_path && (
                      <span className="font-mono text-xs">{runtime.socket_path}</span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={loadRuntime}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={removing || runtime.status === "removing"}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove PHP Runtime?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove PHP {runtime.version} and all its extensions from this machine.
                        Any PHP applications will stop working.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Remove PHP
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {runtime.status === "failed" && runtime.error_message && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-400">{runtime.error_message}</p>
              </div>
            )}
            
            {runtime.status === "installed" && runtime.extensions && runtime.extensions.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Installed Extensions</Label>
                <div className="flex flex-wrap gap-2">
                  {runtime.extensions.map(ext => (
                    <Badge key={ext} variant="secondary" className="text-xs">
                      <Package className="h-3 w-3 mr-1" />
                      {ext}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {runtime.installed_at && (
              <p className="text-xs text-muted-foreground mt-4">
                Installed on {new Date(runtime.installed_at).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Install/Update Configuration */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {installed ? "Update PHP Configuration" : "Install PHP Runtime"}
          </CardTitle>
          <CardDescription>
            {installed 
              ? "Change PHP version or add/remove extensions"
              : "Install PHP-FPM on this machine with your preferred version and extensions"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Version Selection */}
          <div className="space-y-2">
            <Label>PHP Version</Label>
            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select version" />
              </SelectTrigger>
              <SelectContent>
                {PHP_VERSIONS.map(v => (
                  <SelectItem key={v} value={v}>PHP {v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Uses Ondřej Surý's PPA for the latest PHP versions
            </p>
          </div>

          {/* Extension Template */}
          <div className="space-y-2">
            <Label>Extension Template</Label>
            <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Choose a preset..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.is_default && <Badge className="ml-2 text-xs" variant="secondary">Default</Badge>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTemplate && (
              <p className="text-xs text-muted-foreground">
                {templates.find(t => t.id === selectedTemplate)?.description}
              </p>
            )}
          </div>

          {/* Extension Selection */}
          <div className="space-y-2">
            <Label>Extensions ({selectedExtensions.length} selected)</Label>
            <ScrollArea className="h-[200px] border rounded-lg p-3">
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {AVAILABLE_EXTENSIONS.map(ext => (
                  <div key={ext} className="flex items-center space-x-2">
                    <Checkbox
                      id={`ext-${ext}`}
                      checked={selectedExtensions.includes(ext)}
                      onCheckedChange={() => toggleExtension(ext)}
                    />
                    <Label
                      htmlFor={`ext-${ext}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {ext}
                    </Label>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-4 border-t">
            {installed ? (
              <Button 
                onClick={handleUpdate} 
                disabled={installing || runtime?.status === "installing" || runtime?.status === "removing"}
              >
                {(installing || runtime?.status === "installing") ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2" />Update PHP</>
                )}
              </Button>
            ) : (
              <Button 
                onClick={handleInstall} 
                disabled={installing}
              >
                {installing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Installing...</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" />Install PHP</>
                )}
              </Button>
            )}
            
            <p className="text-xs text-muted-foreground">
              {installed 
                ? "Changing version will remove the old version and install the new one"
                : "This will add the PHP PPA and install PHP-FPM with selected extensions"
              }
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Socket Path Info */}
      <Card className="border-border/50 bg-muted/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Nginx Integration</p>
              <p className="text-xs text-muted-foreground">
                When PHP is installed, the socket path <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">/run/php/php{selectedVersion}-fpm.sock</code> will be 
                automatically used for Nginx configurations with PHP enabled.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Enable "Use PHP" on any static location in your Nginx configs to route .php files to PHP-FPM.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

