"use client";

import React, { useState, useEffect, use, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, Machine, UFWRule, Job, ConfigFile, ConfigCategory, ConfigPath, SecurityMachineSettings } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { ChevronDown, ChevronRight, RefreshCw, FileCode, Save, RotateCcw, Loader2, FileText, Settings, Lock, Copy, Plus, Trash2, Pencil, Ban } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const UFW_PAGE_SIZE = 8;

// UFW Rules Table Component with pagination
function UFWRulesTable({ 
  rules, 
  sshPort, 
  onDelete 
}: { 
  rules: UFWRule[]; 
  sshPort: number; 
  onDelete: (port: string, protocol: string) => void;
}) {
  const [page, setPage] = useState(1);
  
  const totalPages = Math.ceil(rules.length / UFW_PAGE_SIZE);
  const paginatedRules = rules.slice((page - 1) * UFW_PAGE_SIZE, page * UFW_PAGE_SIZE);

  const getPortLabel = (port: string) => {
    if (port === "80") return "HTTP";
    if (port === "443") return "HTTPS";
    if (port === String(sshPort) || port === "22") return "SSH";
    return null;
  };

  if (rules.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No firewall rules detected. Agent may need to report rules.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border overflow-hidden" style={{ height: "320px" }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Protocol</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>From</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedRules.map((rule, idx) => {
              const isSSHPort = rule.port === String(sshPort) || rule.port === "22";
              const portLabel = getPortLabel(rule.port);
              return (
                <TableRow key={`${rule.port}-${rule.protocol}-${idx}`}>
                  <TableCell>
                    <Badge variant="outline" className="uppercase">
                      {rule.protocol}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono font-medium">
                    {rule.port}
                    {portLabel && (
                      <span className="text-xs text-muted-foreground ml-2">({portLabel})</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={
                      rule.action === "ALLOW" 
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-red-500/20 text-red-400 border-red-500/30"
                    }>
                      {rule.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {rule.from || "Anywhere"}
                  </TableCell>
                  <TableCell className="text-right">
                    {isSSHPort ? (
                      <span className="text-xs text-muted-foreground">Protected</span>
                    ) : (
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-6 px-2 text-destructive hover:text-destructive"
                        onClick={() => onDelete(rule.port, rule.protocol)}
                      >
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {/* Fill empty rows to maintain fixed height */}
            {Array.from({ length: Math.max(0, UFW_PAGE_SIZE - paginatedRules.length) }).map((_, idx) => (
              <TableRow key={`empty-${idx}`}>
                <TableCell colSpan={5} className="h-10">&nbsp;</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const JOBS_PAGE_SIZE = 8;

// Machine Jobs Tab Component
function MachineJobsTab({ machineId, agentId }: { machineId: string; agentId: string | null }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState("all");

  const loadJobs = async () => {
    if (!agentId) return;
    try {
      setLoading(true);
      const allJobs = await api.listJobs();
      // Filter to only this machine's jobs
      const machineJobs = allJobs.filter(j => j.agent_id === agentId);
      setJobs(machineJobs);
    } catch (err) {
      console.error("Failed to load jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [agentId]);

  const toggleExpanded = (id: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Completed</Badge>;
      case "failed":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
      case "running":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse">Running</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return "-";
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const diffMs = endDate.getTime() - startDate.getTime();
    if (diffMs < 1000) return `${diffMs}ms`;
    if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
    return `${(diffMs / 60000).toFixed(1)}m`;
  };

  const filteredJobs = jobs.filter(job => 
    statusFilter === "all" || job.status === statusFilter
  );

  const totalPages = Math.ceil(filteredJobs.length / JOBS_PAGE_SIZE);
  const paginatedJobs = filteredJobs.slice((page - 1) * JOBS_PAGE_SIZE, page * JOBS_PAGE_SIZE);

  if (!agentId) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="py-8 text-center text-muted-foreground">
          No agent connected. Jobs will appear after the agent enrolls.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Execution Jobs</CardTitle>
            <CardDescription>
              {filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""} for this machine
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={loadJobs} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border" style={{ minHeight: "400px" }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {loading ? "Loading..." : "No jobs found"}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedJobs.map((job) => (
                  <React.Fragment key={job.id}>
                    <TableRow 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleExpanded(job.id)}
                    >
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          {expandedJobs.has(job.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{job.type}</TableCell>
                      <TableCell>{getStatusBadge(job.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(job.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDuration(job.started_at, job.finished_at)}
                      </TableCell>
                    </TableRow>
                    {expandedJobs.has(job.id) && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={5} className="p-0">
                          <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">Job ID:</span>{" "}
                                <span className="font-mono text-xs">{job.id}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Finished:</span>{" "}
                                {formatDate(job.finished_at)}
                              </div>
                            </div>
                            
                            {job.logs ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-sm font-medium">Execution Log:</div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={async () => {
                                      await copyToClipboard(job.logs || "");
                                      toast.success("Copied to clipboard");
                                    }}
                                  >
                                    <Copy className="h-3 w-3 mr-1" />
                                    Copy
                                  </Button>
                                </div>
                                <pre className="bg-black rounded-lg p-4 text-xs font-mono text-gray-300 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                                  {job.logs}
                                </pre>
                              </div>
                            ) : (
                              <div className="text-sm text-muted-foreground italic">
                                {job.status === "pending" ? "Job is pending execution..." : "No logs available"}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Dynamically import terminal to avoid SSR issues
const WebSocketTerminal = dynamic(
  () => import("@/components/terminal").then((mod) => mod.WebSocketTerminal),
  { ssr: false, loading: () => <div className="h-[400px] bg-black rounded-lg animate-pulse" /> }
);

// Dynamically import PHP runtime tab
const PHPRuntimeTab = dynamic(
  () => import("@/components/php-runtime-tab").then((mod) => mod.PHPRuntimeTab),
  { ssr: false, loading: () => <div className="h-[300px] bg-muted/30 rounded-lg animate-pulse" /> }
);

// Dynamically import Monaco Editor
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { 
  ssr: false, 
  loading: () => <div className="h-[500px] bg-muted/30 rounded-lg animate-pulse" /> 
});

// Config Editor Component
function ConfigEditorTab({ machineId }: { machineId: string }) {
  const [categories, setCategories] = useState<ConfigCategory[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSubcats, setExpandedSubcats] = useState<Set<string>>(new Set());
  const [selectedConfig, setSelectedConfig] = useState<ConfigFile | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Custom category management
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showAddPathDialog, setShowAddPathDialog] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", emoji: "📁", color: "#6366f1" });
  const [pathForm, setPathForm] = useState({ name: "", path: "", file_type: "text", reload_command: "" });
  const [selectedCategoryForPath, setSelectedCategoryForPath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // Edit mode state
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      setLoadingConfigs(true);
      const data = await api.listMachineConfigs(machineId);
      let cats = data.categories || [];
      
      // Scan for PHP versions using the fast file module
      try {
        const phpResult = await api.listDirectory(machineId, "/etc/php", false);
        if (phpResult.success && Array.isArray(phpResult.result)) {
          const phpVersions = (phpResult.result as { name: string; is_dir: boolean }[])
            .filter(f => f.is_dir && /^\d+\.\d+$/.test(f.name))
            .map(f => f.name)
            .sort((a, b) => parseFloat(b) - parseFloat(a)); // Newest first
          
          // Find and update the PHP category
          const phpCatIndex = cats.findIndex(c => c.id === "php");
          if (phpCatIndex >= 0 && phpVersions.length > 0) {
            cats[phpCatIndex] = {
              ...cats[phpCatIndex],
              subcategories: phpVersions.map(version => ({
                id: `php_${version}`,
                name: `PHP ${version}`,
                files: [
                  { name: "php.ini", path: `/etc/php/${version}/fpm/php.ini`, type: "php", readonly: false },
                  { name: "www.conf", path: `/etc/php/${version}/fpm/pool.d/www.conf`, type: "php", readonly: false },
                ],
              })),
            };
          } else if (phpCatIndex >= 0 && phpVersions.length === 0) {
            // Remove PHP category if no versions found
            cats = cats.filter(c => c.id !== "php");
          }
        }
      } catch (phpErr) {
        console.log("PHP scan failed (file module may not be connected):", phpErr);
        // If file module not available, remove empty PHP category
        cats = cats.filter(c => c.id !== "php" || (c.subcategories && c.subcategories.length > 0));
      }
      
      // Similarly scan for nginx sites-enabled
      try {
        const sitesResult = await api.listDirectory(machineId, "/etc/nginx/sites-enabled", false);
        if (sitesResult.success && Array.isArray(sitesResult.result)) {
          const siteFiles = (sitesResult.result as { name: string; is_dir: boolean; path: string }[])
            .filter(f => !f.is_dir && f.name !== "." && f.name !== "..")
            .map(f => ({ name: f.name, path: f.path, type: "nginx_site", readonly: false }));
          
          // Find and update nginx category's sites-enabled subcategory
          const nginxCatIndex = cats.findIndex(c => c.id === "nginx");
          if (nginxCatIndex >= 0) {
            const sitesSubcatIndex = cats[nginxCatIndex].subcategories?.findIndex(s => s.id === "nginx_sites_enabled") ?? -1;
            if (sitesSubcatIndex >= 0 && cats[nginxCatIndex].subcategories) {
              cats[nginxCatIndex].subcategories[sitesSubcatIndex] = {
                ...cats[nginxCatIndex].subcategories[sitesSubcatIndex],
                files: siteFiles,
              };
            }
          }
        }
      } catch (sitesErr) {
        console.log("Sites-enabled scan failed:", sitesErr);
      }
      
      setCategories(cats);
      // Auto-expand first category
      if (cats.length > 0) {
        setExpandedCategories(new Set([cats[0].id]));
      }
    } catch (err) {
      console.error("Failed to load configs:", err);
      toast.error("Failed to load config list");
    } finally {
      setLoadingConfigs(false);
    }
  }, [machineId]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const loadConfigContent = async (config: ConfigFile) => {
    try {
      setLoading(true);
      setSelectedConfig(config);
      const result = await api.readMachineConfig(machineId, config.path);
      setContent(result.content);
      setOriginalContent(result.content);
    } catch (err) {
      console.error("Failed to read config:", err);
      toast.error("Failed to read config file");
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!selectedConfig) return;
    try {
      setSaving(true);
      const result = await api.writeMachineConfig(machineId, selectedConfig.path, content);
      if (result.success) {
        toast.success("Config saved and reloaded");
        setOriginalContent(content);
      } else {
        toast.error("Failed to save config");
      }
    } catch (err: unknown) {
      console.error("Failed to save config:", err);
      const message = err instanceof Error ? err.message : "Failed to save config";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const resetConfig = () => {
    setContent(originalContent);
    toast.info("Changes reverted");
  };

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSubcat = (id: string) => {
    setExpandedSubcats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Custom category handlers
  const handleCreateCategory = async () => {
    if (!categoryForm.name.trim()) {
      toast.error("Category name is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.createConfigCategory(machineId, categoryForm);
      toast.success("Category created");
      setShowAddCategoryDialog(false);
      setCategoryForm({ name: "", emoji: "📁", color: "#6366f1" });
      loadConfigs();
    } catch (err) {
      console.error("Failed to create category:", err);
      toast.error("Failed to create category");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm("Delete this category and all its paths?")) return;
    try {
      await api.deleteConfigCategory(machineId, categoryId);
      toast.success("Category deleted");
      loadConfigs();
    } catch (err) {
      console.error("Failed to delete category:", err);
      toast.error("Failed to delete category");
    }
  };

  const handleAddPath = async () => {
    if (!pathForm.name.trim() || !pathForm.path.trim()) {
      toast.error("Name and path are required");
      return;
    }
    if (!selectedCategoryForPath) return;
    setSubmitting(true);
    try {
      await api.addConfigPath(machineId, selectedCategoryForPath, {
        name: pathForm.name,
        path: pathForm.path,
        file_type: pathForm.file_type,
        reload_command: pathForm.reload_command || undefined,
      });
      toast.success("File path added");
      setShowAddPathDialog(false);
      setPathForm({ name: "", path: "", file_type: "text", reload_command: "" });
      setSelectedCategoryForPath(null);
      loadConfigs();
    } catch (err) {
      console.error("Failed to add path:", err);
      toast.error("Failed to add file path");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePath = async (categoryId: string, pathId: string) => {
    if (!confirm("Remove this file path from the category?")) return;
    try {
      await api.removeConfigPath(machineId, categoryId, pathId);
      toast.success("File path removed");
      loadConfigs();
    } catch (err) {
      console.error("Failed to remove path:", err);
      toast.error("Failed to remove file path");
    }
  };

  const openAddPathDialog = (categoryId: string) => {
    setEditingPathId(null);
    setPathForm({ name: "", path: "", file_type: "text", reload_command: "" });
    setSelectedCategoryForPath(categoryId);
    setShowAddPathDialog(true);
  };

  // Edit category
  const openEditCategoryDialog = (category: ConfigCategory) => {
    setEditingCategoryId(category.id);
    setCategoryForm({ name: category.name, emoji: category.emoji || "📁", color: category.color || "#6366f1" });
    setShowAddCategoryDialog(true);
  };

  const handleUpdateCategory = async () => {
    if (!editingCategoryId || !categoryForm.name.trim()) {
      toast.error("Category name is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.updateConfigCategory(machineId, editingCategoryId, {
        ...categoryForm,
        position: 0 // Keep current position
      });
      toast.success("Category updated");
      setShowAddCategoryDialog(false);
      setCategoryForm({ name: "", emoji: "📁", color: "#6366f1" });
      setEditingCategoryId(null);
      loadConfigs();
    } catch (err) {
      console.error("Failed to update category:", err);
      toast.error("Failed to update category");
    } finally {
      setSubmitting(false);
    }
  };

  // Edit path
  const openEditPathDialog = (categoryId: string, file: ConfigFile) => {
    if (!file.id) return;
    setEditingPathId(file.id);
    setSelectedCategoryForPath(categoryId);
    setPathForm({
      name: file.name,
      path: file.path,
      file_type: file.file_type || file.type || "text",
      reload_command: file.reload_command || "",
    });
    setShowAddPathDialog(true);
  };

  const handleUpdatePath = async () => {
    if (!editingPathId || !selectedCategoryForPath || !pathForm.name.trim() || !pathForm.path.trim()) {
      toast.error("Name and path are required");
      return;
    }
    setSubmitting(true);
    try {
      await api.updateConfigPath(machineId, selectedCategoryForPath, editingPathId, {
        name: pathForm.name,
        path: pathForm.path,
        file_type: pathForm.file_type,
        reload_command: pathForm.reload_command || undefined,
      });
      toast.success("File path updated");
      setShowAddPathDialog(false);
      setPathForm({ name: "", path: "", file_type: "text", reload_command: "" });
      setEditingPathId(null);
      setSelectedCategoryForPath(null);
      loadConfigs();
    } catch (err) {
      console.error("Failed to update path:", err);
      toast.error("Failed to update file path");
    } finally {
      setSubmitting(false);
    }
  };

  const openAddCategoryDialog = () => {
    setEditingCategoryId(null);
    setCategoryForm({ name: "", emoji: "📁", color: "#6366f1" });
    setShowAddCategoryDialog(true);
  };

  // Handle sidebar resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = Math.max(180, Math.min(450, e.clientX - containerRect.left));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const hasChanges = content !== originalContent;

  const getConfigIcon = (type: string) => {
    switch (type) {
      case "nginx":
      case "nginx_site":
        return <Settings className="h-4 w-4 text-green-500" />;
      case "ssh":
        return <Lock className="h-4 w-4 text-yellow-500" />;
      case "php":
        return <FileCode className="h-4 w-4 text-purple-500" />;
      default:
        return <FileText className="h-4 w-4 text-blue-500" />;
    }
  };

  const getEditorLanguage = (config: ConfigFile | null) => {
    if (!config) return "plaintext";
    if (config.type === "nginx" || config.type === "nginx_site") return "nginx";
    if (config.type === "ssh") return "ini";
    if (config.type === "php") return "ini";
    return "plaintext";
  };

  const copyPath = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await copyToClipboard(path);
    toast.success("Path copied to clipboard");
  };

  if (loadingConfigs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderFileItem = (file: ConfigFile, category?: ConfigCategory) => {
    const isCustom = category && !category.is_built_in;
    return (
      <div
        key={file.path}
        className={`group/file w-full py-2 px-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-2 text-sm ${
          selectedConfig?.path === file.path ? "bg-primary/10 border-l-2 border-l-primary" : ""
        }`}
      >
        <button
          onClick={() => loadConfigContent(file)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          {getConfigIcon(file.type)}
          <span className="truncate flex-1">{file.name}</span>
        </button>
        {isCustom && file.id && (
          <div className="opacity-0 group-hover/file:opacity-100 transition-opacity flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); openEditPathDialog(category.id, file); }}
              className="p-0.5 rounded hover:bg-muted"
              title="Edit path"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeletePath(category.id, file.id!); }}
              className="p-0.5 rounded hover:bg-destructive hover:text-white"
              title="Remove path"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="flex h-[600px] gap-0">
      {/* Sidebar with categories */}
      <Card 
        className="border-border/50 bg-card/50 overflow-hidden flex-shrink-0 flex flex-col"
        style={{ width: sidebarWidth }}
      >
        <CardHeader className="pb-2 flex-shrink-0 border-b border-border/30">
          <CardTitle className="text-sm flex items-center justify-between">
            Config Files
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={openAddCategoryDialog} 
                className="h-7 w-7 p-0"
                title="Add custom category"
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={loadConfigs} className="h-7 w-7 p-0">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-auto flex-1">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">
              No config files found. Make sure the agent is running.
            </p>
          ) : (
            <div className="py-2">
              {categories.map((category) => {
                const isCustom = !category.is_built_in;
                return (
                <div key={category.id} className="mb-1 group/cat">
                  {/* Category Header */}
                  <div className="flex items-center hover:bg-muted/50 transition-colors">
                    <button
                      onClick={() => toggleCategory(category.id)}
                      className="flex-1 px-3 py-2 flex items-center gap-2"
                    >
                      {expandedCategories.has(category.id) ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span 
                        className="text-sm"
                        style={{ color: category.color }}
                      >
                        {category.emoji}
                      </span>
                      <span className="font-medium text-sm flex-1 text-left">{category.name}</span>
                    </button>
                    {/* Custom category actions */}
                    {isCustom && (
                      <div className="opacity-0 group-hover/cat:opacity-100 transition-opacity flex items-center gap-0.5 pr-2">
                        <button
                          onClick={() => openAddPathDialog(category.id)}
                          className="p-1 rounded hover:bg-muted"
                          title="Add file path"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => openEditCategoryDialog(category)}
                          className="p-1 rounded hover:bg-muted"
                          title="Edit category"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category.id)}
                          className="p-1 rounded hover:bg-destructive hover:text-white"
                          title="Delete category"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Category Content */}
                  {expandedCategories.has(category.id) && (
                    <div className="ml-4 border-l border-border/30">
                      {/* Subcategories */}
                      {category.subcategories?.map((subcat) => (
                        <div key={subcat.id}>
                          <button
                            onClick={() => toggleSubcat(subcat.id)}
                            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-muted/30 transition-colors text-xs text-muted-foreground"
                          >
                            {expandedSubcats.has(subcat.id) ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            <span>{subcat.name}</span>
                            <span className="ml-auto text-xs opacity-60">{subcat.files.length}</span>
                          </button>
                          {expandedSubcats.has(subcat.id) && (
                            <div className="ml-4">
                              {subcat.files.map((file) => renderFileItem(file, category))}
                            </div>
                          )}
                        </div>
                      ))}
                      
                      {/* Direct files (no subcategory) */}
                      {category.files?.map((file) => renderFileItem(file, category))}
                      
                      {/* Add file hint for empty custom categories */}
                      {isCustom && (!category.files || category.files.length === 0) && (!category.subcategories || category.subcategories.length === 0) && (
                        <button
                          onClick={() => openAddPathDialog(category.id)}
                          className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <Plus className="h-3 w-3" />
                          Add file path...
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );})}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resize Handle */}
      <div
        className={`w-1 cursor-col-resize hover:bg-primary/50 transition-colors ${isResizing ? "bg-primary" : "bg-transparent"}`}
        onMouseDown={handleMouseDown}
      />

      {/* Editor */}
      <Card className="border-border/50 bg-card/50 flex-1 overflow-hidden flex flex-col">
        <CardHeader className="pb-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                {selectedConfig ? (
                  <>
                    {getConfigIcon(selectedConfig.type)}
                    {selectedConfig.name}
                    {hasChanges && <Badge variant="outline" className="ml-2 text-xs">Modified</Badge>}
                  </>
                ) : (
                  "Select a config file"
                )}
              </CardTitle>
              {selectedConfig && (
                <button 
                  onClick={(e) => copyPath(selectedConfig.path, e)}
                  className="text-xs text-muted-foreground mt-1 hover:text-foreground transition-colors flex items-center gap-1 group"
                  title="Click to copy path"
                >
                  {selectedConfig.path}
                  <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
            </div>
            {selectedConfig && (
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={resetConfig} 
                  disabled={!hasChanges || saving}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
                <Button 
                  size="sm" 
                  onClick={saveConfig} 
                  disabled={!hasChanges || saving}
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3 mr-1" />
                  )}
                  Save & Reload
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : selectedConfig ? (
            <MonacoEditor
              height="100%"
              language={getEditorLanguage(selectedConfig)}
              theme="vs-dark"
              value={content}
              onChange={(value) => setContent(value || "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                padding: { top: 8, bottom: 8 },
                automaticLayout: true,
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FileCode className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Select a configuration file from the list</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Category Dialog */}
      <Dialog open={showAddCategoryDialog} onOpenChange={(open) => { setShowAddCategoryDialog(open); if (!open) setEditingCategoryId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCategoryId ? "Edit Category" : "Add Custom Category"}</DialogTitle>
            <DialogDescription>
              {editingCategoryId ? "Update category name, emoji, or color." : "Create a new category to organize custom config files."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="My App Configs"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Emoji</Label>
                <div className="flex flex-wrap gap-1">
                  {["📁", "⚙️", "🔧", "📄", "🗂️", "💾", "🔒", "🌐"].map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setCategoryForm(prev => ({ ...prev, emoji }))}
                      className={`p-2 rounded border ${categoryForm.emoji === emoji ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-1">
                  {["#6366f1", "#22c55e", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4"].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCategoryForm(prev => ({ ...prev, color }))}
                      className={`w-8 h-8 rounded ${categoryForm.color === color ? "ring-2 ring-white ring-offset-2 ring-offset-background" : ""}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddCategoryDialog(false); setEditingCategoryId(null); }}>
              Cancel
            </Button>
            <Button onClick={editingCategoryId ? handleUpdateCategory : handleCreateCategory} disabled={submitting}>
              {submitting ? (editingCategoryId ? "Saving..." : "Creating...") : (editingCategoryId ? "Save Changes" : "Create Category")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Path Dialog */}
      <Dialog open={showAddPathDialog} onOpenChange={(open) => { setShowAddPathDialog(open); if (!open) setEditingPathId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPathId ? "Edit File Path" : "Add File Path"}</DialogTitle>
            <DialogDescription>
              {editingPathId ? "Update the file path configuration." : "Add a configuration file to this category."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                placeholder="app.conf"
                value={pathForm.name}
                onChange={(e) => setPathForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Full File Path</Label>
              <Input
                placeholder="/etc/myapp/app.conf"
                value={pathForm.path}
                onChange={(e) => setPathForm(prev => ({ ...prev, path: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>File Type</Label>
                <Select
                  value={pathForm.file_type}
                  onValueChange={(v) => setPathForm(prev => ({ ...prev, file_type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Plain Text</SelectItem>
                    <SelectItem value="nginx">Nginx</SelectItem>
                    <SelectItem value="php">PHP</SelectItem>
                    <SelectItem value="yaml">YAML</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="shell">Shell</SelectItem>
                    <SelectItem value="ini">INI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reload Command (optional)</Label>
                <Input
                  placeholder="systemctl reload myapp"
                  value={pathForm.reload_command}
                  onChange={(e) => setPathForm(prev => ({ ...prev, reload_command: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddPathDialog(false); setEditingPathId(null); }}>
              Cancel
            </Button>
            <Button onClick={editingPathId ? handleUpdatePath : handleAddPath} disabled={submitting}>
              {submitting ? (editingPathId ? "Saving..." : "Adding...") : (editingPathId ? "Save Changes" : "Add File")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DEFAULT_FAIL2BAN_CONFIG = `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
`;

const LOG_TYPES = [
  { value: "nginx_access", label: "Nginx Access" },
  { value: "nginx_error", label: "Nginx Error" },
  { value: "syslog", label: "System Log" },
  { value: "auth", label: "Auth Log" },
  { value: "fail2ban", label: "Fail2ban" },
];

export default function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Local state for edits (to prevent refresh issues)
  const [localNotes, setLocalNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  // Optimistic UI states
  const [ufwEnabled, setUfwEnabled] = useState(false);
  const [fail2banEnabled, setFail2banEnabled] = useState(false);
  const [pendingUFW, setPendingUFW] = useState(false);
  const [pendingFail2ban, setPendingFail2ban] = useState(false);
  
  // Machine security settings (nftables)
  const [machineSecuritySettings, setMachineSecuritySettings] = useState<SecurityMachineSettings | null>(null);

  // Title editing state
  const [showTitleDialog, setShowTitleDialog] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");

  // Dialogs
  const [showAddPortDialog, setShowAddPortDialog] = useState(false);
  const [showSSHPortDialog, setShowSSHPortDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showFail2banDialog, setShowFail2banDialog] = useState(false);
  const [showConfirmUFWDialog, setShowConfirmUFWDialog] = useState(false);
  const [showConfirmFail2banDialog, setShowConfirmFail2banDialog] = useState(false);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [pendingToggleValue, setPendingToggleValue] = useState(false);

  // Form states
  const [newPort, setNewPort] = useState("");
  const [newProtocol, setNewProtocol] = useState("tcp");
  const [sshPort, setSSHPort] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fail2banConfig, setFail2banConfig] = useState(DEFAULT_FAIL2BAN_CONFIG);

  // Logs state
  const [selectedLogType, setSelectedLogType] = useState("nginx_access");
  const [logLines, setLogLines] = useState(100);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);

  // Initial load
  useEffect(() => {
    loadMachine();
    loadMachineSecuritySettings();
  }, [id]);

  // Periodic refresh for stats only (not notes)
  useEffect(() => {
    const interval = setInterval(() => {
      loadMachineStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  // Auto-refresh logs
  useEffect(() => {
    if (autoRefreshLogs && activeTab === "logs") {
      const interval = setInterval(loadLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefreshLogs, activeTab, selectedLogType, logLines]);

  const loadMachine = async () => {
    try {
      const data = await api.getMachine(id);
      setMachine(data);
      // Only set notes if not dirty (user hasn't made edits)
      if (!notesDirty) {
        setLocalNotes(data.notes_md || "");
      }
      if (data.fail2ban_config) {
        setFail2banConfig(data.fail2ban_config);
      }
      setUfwEnabled(data.ufw_enabled);
      setFail2banEnabled(data.fail2ban_enabled);
    } catch (err) {
      console.error("Failed to load machine:", err);
      toast.error("Failed to load machine");
    } finally {
      setLoading(false);
    }
  };

  const loadMachineStats = async () => {
    try {
      const data = await api.getMachine(id);
      // Only update stats, not notes or config (preserve local edits)
      setMachine(prev => prev ? {
        ...prev,
        cpu_percent: data.cpu_percent,
        memory_used: data.memory_used,
        memory_total: data.memory_total,
        disk_used: data.disk_used,
        disk_total: data.disk_total,
        last_seen: data.last_seen,
        ssh_port: data.ssh_port,
        // Only update these if not pending
        ufw_enabled: pendingUFW ? prev.ufw_enabled : data.ufw_enabled,
        fail2ban_enabled: pendingFail2ban ? prev.fail2ban_enabled : data.fail2ban_enabled,
      } : null);
      
      // Sync optimistic state with server if not pending
      if (!pendingUFW) setUfwEnabled(data.ufw_enabled);
      if (!pendingFail2ban) setFail2banEnabled(data.fail2ban_enabled);
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

  const loadMachineSecuritySettings = async () => {
    try {
      const settings = await api.getMachineSecuritySettings(id);
      setMachineSecuritySettings(settings);
    } catch (err) {
      console.error("Failed to load machine security settings:", err);
    }
  };

  const loadLogs = useCallback(async () => {
    if (!machine) return;
    setLogsLoading(true);
    try {
      const data = await api.getMachineLogs(machine.id, selectedLogType, logLines);
      setLogs(data.logs);
      // Auto-scroll to bottom
      if (logsRef.current) {
        logsRef.current.scrollTop = logsRef.current.scrollHeight;
      }
    } catch (err) {
      console.error("Failed to load logs:", err);
      toast.error("Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  }, [machine, selectedLogType, logLines]);

  const handleSaveNotes = async () => {
    if (!machine) return;
    setSaving(true);
    try {
      await api.updateMachineNotes(machine.id, localNotes);
      setNotesDirty(false);
      toast.success("Notes saved successfully");
    } catch (err) {
      console.error("Failed to save notes:", err);
      toast.error("Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTitle = async () => {
    if (!machine) return;
    setSaving(true);
    try {
      await api.updateMachine(machine.id, { title: editingTitle || null });
      setMachine(prev => prev ? { ...prev, title: editingTitle || null } : null);
      setShowTitleDialog(false);
      toast.success("Machine name updated");
    } catch (err) {
      console.error("Failed to update machine name:", err);
      toast.error("Failed to update machine name");
    } finally {
      setSaving(false);
    }
  };

  const openTitleDialog = () => {
    setEditingTitle(machine?.title || machine?.hostname || "");
    setShowTitleDialog(true);
  };

  const handleNotesChange = (value: string) => {
    setLocalNotes(value);
    setNotesDirty(true);
  };

  const handleDelete = async () => {
    if (!machine) return;
    if (!confirm("Are you sure you want to delete this machine? This action cannot be undone.")) return;
    try {
      await api.deleteMachine(machine.id);
      toast.success("Machine deleted");
      router.push("/machines");
    } catch (err) {
      console.error("Failed to delete machine:", err);
      toast.error("Failed to delete machine");
    }
  };

  const handleUFWToggleRequest = (newValue: boolean) => {
    setPendingToggleValue(newValue);
    setShowConfirmUFWDialog(true);
  };

  const handleConfirmUFWToggle = async () => {
    if (!machine) return;
    setShowConfirmUFWDialog(false);
    
    // Optimistic update
    setUfwEnabled(pendingToggleValue);
    setPendingUFW(true);
    
    try {
      await api.toggleUFW(machine.id, pendingToggleValue);
      toast.success(`Firewall ${pendingToggleValue ? "enabled" : "disabled"} job created`);
      // Wait a bit then allow server sync
      setTimeout(() => setPendingUFW(false), 10000);
    } catch (err) {
      console.error("Failed to toggle UFW:", err);
      // Revert optimistic update
      setUfwEnabled(!pendingToggleValue);
      setPendingUFW(false);
      toast.error("Failed to toggle firewall");
    }
  };

  const handleFail2banToggleRequest = (newValue: boolean) => {
    setPendingToggleValue(newValue);
    setShowConfirmFail2banDialog(true);
  };

  const handleConfirmFail2banToggle = async () => {
    if (!machine) return;
    setShowConfirmFail2banDialog(false);
    
    // Optimistic update
    setFail2banEnabled(pendingToggleValue);
    setPendingFail2ban(true);
    
    try {
      await api.toggleFail2ban(machine.id, pendingToggleValue, fail2banConfig);
      toast.success(`Fail2ban ${pendingToggleValue ? "enabled" : "disabled"} job created`);
      setTimeout(() => setPendingFail2ban(false), 10000);
    } catch (err) {
      console.error("Failed to toggle fail2ban:", err);
      setFail2banEnabled(!pendingToggleValue);
      setPendingFail2ban(false);
      toast.error("Failed to toggle Fail2ban");
    }
  };

  const handleChangeSSHPort = async () => {
    if (!machine) return;
    const port = parseInt(sshPort);
    if (isNaN(port) || port < 1024 || port > 65535) {
      toast.error("Port must be between 1024 and 65535");
      return;
    }
    try {
      await api.changeSSHPort(machine.id, port);
      setShowSSHPortDialog(false);
      setSSHPort("");
      toast.success("SSH port change job created");
    } catch (err) {
      console.error("Failed to change SSH port:", err);
      toast.error("Failed to change SSH port");
    }
  };

  const handleChangePassword = async () => {
    if (!machine) return;
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    try {
      await api.changeRootPassword(machine.id, newPassword);
      setShowPasswordDialog(false);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Root password change job created");
    } catch (err) {
      console.error("Failed to change password:", err);
      toast.error("Failed to change password");
    }
  };

  const handleAddPort = async () => {
    if (!machine || !newPort) return;
    try {
      await api.addUFWRule(machine.id, newPort, newProtocol);
      setShowAddPortDialog(false);
      setNewPort("");
      toast.success("UFW rule job created");
    } catch (err) {
      console.error("Failed to add UFW rule:", err);
      toast.error("Failed to add UFW rule");
    }
  };

  const handleRemoveUFWRule = async (port: string, protocol: string) => {
    if (!machine) return;
    if (!confirm(`Are you sure you want to remove the rule for port ${port}/${protocol}?`)) return;
    try {
      await api.removeUFWRule(machine.id, port, protocol);
      toast.success("UFW rule removal job created");
    } catch (err) {
      console.error("Failed to remove UFW rule:", err);
      toast.error("Failed to remove UFW rule");
    }
  };

  const handleSaveFail2banConfig = async () => {
    if (!machine) return;
    try {
      await api.toggleFail2ban(machine.id, fail2banEnabled, fail2banConfig);
      setShowFail2banDialog(false);
      toast.success("Fail2ban config update job created");
    } catch (err) {
      console.error("Failed to update fail2ban config:", err);
      toast.error("Failed to update fail2ban config");
    }
  };

  const handleDownloadLogs = () => {
    const blob = new Blob([logs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${machine?.hostname || "machine"}-${selectedLogType}-${new Date().toISOString()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Logs downloaded");
  };

  const filteredLogs = logSearch
    ? logs.split("\n").filter(line => line.toLowerCase().includes(logSearch.toLowerCase())).join("\n")
    : logs;

  const getStatusBadge = () => {
    if (!machine?.last_seen) {
      return <Badge variant="secondary">Never connected</Badge>;
    }
    const lastSeen = new Date(machine.last_seen);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / 1000 / 60;
    
    if (diffMinutes < 5) {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Online</Badge>;
    } else if (diffMinutes < 60) {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Idle</Badge>;
    }
    return <Badge variant="destructive">Offline</Badge>;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (date: string | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!machine) {
    return (
      <div className="space-y-6">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Machine Not Found</CardTitle>
            <CardDescription>The requested machine could not be found.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/machines")}>Back to Machines</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/machines")}>
            ← Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <button 
                onClick={openTitleDialog}
                className="text-3xl font-semibold tracking-tight hover:text-primary/80 transition-colors flex items-center gap-2"
                title="Click to edit machine name"
              >
                {machine.title || machine.hostname || "Unknown"}
                <span className="text-sm text-muted-foreground">✎</span>
              </button>
              {getStatusBadge()}
              {(pendingUFW || pendingFail2ban) && (
                <Badge variant="outline" className="animate-pulse">
                  Applying changes...
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {machine.hostname && machine.title && machine.hostname !== machine.title && (
                <>
                  <span>{machine.hostname}</span>
                  <span className="mx-2">•</span>
                </>
              )}
              {machine.ip_address || "No IP address"}
            </p>
          </div>
        </div>
        <Button variant="destructive" onClick={handleDelete}>
          Delete Machine
        </Button>
      </div>

      {/* Title Edit Dialog */}
      <Dialog open={showTitleDialog} onOpenChange={setShowTitleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Machine Name</DialogTitle>
            <DialogDescription>
              Give this machine a friendly name. Leave empty to use the hostname.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Machine Name</Label>
              <Input 
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                placeholder={machine.hostname || "Machine name"}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Hostname: {machine.hostname || "Unknown"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTitleDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTitle} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="configs">Configs</TabsTrigger>
          <TabsTrigger value="runtimes">Runtimes</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Machine Info */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle>Machine Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Hostname</p>
                    <p className="font-medium">{machine.hostname || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">IP Address</p>
                    <p className="font-medium font-mono">{machine.ip_address || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">OS Version</p>
                    <p className="font-medium">{machine.ubuntu_version || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Agent Version</p>
                    <p className="font-medium font-mono">{machine.agent_version || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last Seen</p>
                    <p className="font-medium">{formatDate(machine.last_seen)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Owner</p>
                    <p className="font-medium">{machine.owner_name || machine.owner_email || "Unassigned"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* System Stats */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle>System Resources</CardTitle>
                <CardDescription>Real-time hardware utilization</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">CPU Usage</span>
                    <span className="font-mono">{machine.cpu_percent?.toFixed(1) || 0}%</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${(machine.cpu_percent || 0) > 80 ? 'bg-red-500' : (machine.cpu_percent || 0) > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${machine.cpu_percent || 0}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Memory</span>
                    <span className="font-mono">{formatBytes(machine.memory_used || 0)} / {formatBytes(machine.memory_total || 0)}</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${machine.memory_total > 0 && (machine.memory_used / machine.memory_total) > 0.8 ? 'bg-red-500' : machine.memory_total > 0 && (machine.memory_used / machine.memory_total) > 0.5 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: machine.memory_total > 0 ? `${(machine.memory_used / machine.memory_total) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Disk</span>
                    <span className="font-mono">{formatBytes(machine.disk_used || 0)} / {formatBytes(machine.disk_total || 0)}</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${machine.disk_total > 0 && (machine.disk_used / machine.disk_total) > 0.9 ? 'bg-red-500' : machine.disk_total > 0 && (machine.disk_used / machine.disk_total) > 0.7 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: machine.disk_total > 0 ? `${(machine.disk_used / machine.disk_total) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Status Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${machine.last_seen && new Date(machine.last_seen).getTime() > Date.now() - 60000 ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="font-medium text-sm">{machine.last_seen && new Date(machine.last_seen).getTime() > Date.now() - 60000 ? 'Online' : 'Offline'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${ufwEnabled ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">Firewall</p>
                    <p className="font-medium text-sm">{ufwEnabled ? 'Active' : 'Inactive'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${fail2banEnabled ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">Fail2ban</p>
                    <p className="font-medium text-sm">{fail2banEnabled ? 'Active' : 'Inactive'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div>
                  <p className="text-xs text-muted-foreground">SSH Port</p>
                  <p className="font-medium text-sm font-mono">{machine.ssh_port || 22}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Notes Section in Overview */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Notes</CardTitle>
                <CardDescription>Markdown notes about this machine</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowNotesDialog(true)}>
                Edit Notes
              </Button>
            </CardHeader>
            <CardContent>
              <div className="min-h-[100px] p-4 border rounded-md bg-muted/30 prose prose-invert prose-sm max-w-none">
                {localNotes ? (
                  <ReactMarkdown>{localNotes}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">No notes yet. Click Edit Notes to add.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6 mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Security Settings */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle>Authentication</CardTitle>
                <CardDescription>SSH access and password management</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* SSH Port */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium text-sm">SSH Port</p>
                    <p className="text-xs text-muted-foreground">
                      Currently: <span className="font-mono">{machine.ssh_port || 22}</span>
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowSSHPortDialog(true)}>
                    Change
                  </Button>
                </div>

                {/* Root Password */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium text-sm">Root Password</p>
                    <p className="text-xs text-muted-foreground">
                      {machine.root_password_set ? "Password has been changed" : "Using default password"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowPasswordDialog(true)}>
                    Change
                  </Button>
                </div>

                {/* Fail2ban */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium text-sm">Fail2ban</p>
                      <p className="text-xs text-muted-foreground">SSH brute-force protection</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowFail2banDialog(true)}>
                      Configure
                    </Button>
                    <Switch 
                      checked={fail2banEnabled} 
                      onCheckedChange={handleFail2banToggleRequest}
                      disabled={pendingFail2ban}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* UFW Firewall */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Firewall (UFW)</CardTitle>
                  <CardDescription>
                    {machine.ufw_rules?.length || 0} rules total
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {ufwEnabled ? "Active" : "Inactive"}
                    </span>
                    <Switch 
                      checked={ufwEnabled} 
                      onCheckedChange={handleUFWToggleRequest}
                      disabled={pendingUFW}
                    />
                  </div>
                  <Button size="sm" onClick={() => setShowAddPortDialog(true)} disabled={!ufwEnabled}>
                    Add Rule
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <UFWRulesTable 
                  rules={machine.ufw_rules || []} 
                  sshPort={machine.ssh_port || 22}
                  onDelete={handleRemoveUFWRule}
                />
                <p className="text-xs text-muted-foreground text-center mt-4">
                  Rules sync every 5 seconds from agent. SSH port is protected from deletion.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* IP Banning (nftables) Section */}
          <Card className="border-destructive/30 bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Ban className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <CardTitle>IP Banning (nftables)</CardTitle>
                  <CardDescription>
                    Automatic IP blocking for malicious requests
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {machineSecuritySettings?.nftables_enabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch 
                    checked={machineSecuritySettings?.nftables_enabled ?? false}
                    onCheckedChange={async (checked) => {
                      try {
                        const updated = await api.updateMachineSecuritySettings(machine.id, {
                          nftables_enabled: checked,
                        });
                        setMachineSecuritySettings(updated);
                        toast.success(checked ? "nftables enabled" : "nftables disabled");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed to update");
                      }
                    }}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-sm text-muted-foreground">Active Bans</p>
                  <p className="text-2xl font-bold">{machineSecuritySettings?.ban_count ?? 0}</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-sm text-muted-foreground">Last Sync</p>
                  <p className="text-sm font-medium">
                    {machineSecuritySettings?.last_sync_at 
                      ? new Date(machineSecuritySettings.last_sync_at).toLocaleString()
                      : "Never"
                    }
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-sm text-muted-foreground">Sync Interval</p>
                  <p className="text-sm font-medium">Every 2 minutes</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={async () => {
                    try {
                      await loadMachineSecuritySettings();
                      toast.success("Settings refreshed");
                    } catch {
                      toast.error("Failed to refresh");
                    }
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  asChild
                >
                  <a href="/security/bans">
                    View All Bans
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                When enabled, the agent will automatically ban IPs that trigger security rules (blocked UA, invalid paths).
                Bans are synced across all machines every 2 minutes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4 mt-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Server Logs</CardTitle>
                  <CardDescription>View and search log files</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={selectedLogType} onValueChange={setSelectedLogType}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOG_TYPES.map(lt => (
                        <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={logLines.toString()} onValueChange={(v) => setLogLines(parseInt(v))}>
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50 lines</SelectItem>
                      <SelectItem value="100">100 lines</SelectItem>
                      <SelectItem value="500">500 lines</SelectItem>
                      <SelectItem value="1000">1000 lines</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Switch checked={autoRefreshLogs} onCheckedChange={setAutoRefreshLogs} />
                    <span className="text-sm text-muted-foreground">Auto</span>
                  </div>
                  <Button onClick={loadLogs} disabled={logsLoading} size="sm">
                    {logsLoading ? "Loading..." : "Refresh"}
                  </Button>
                  <Button onClick={handleDownloadLogs} disabled={!logs} size="sm" variant="outline">
                    Download
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Input
                  placeholder="Search logs..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="max-w-sm"
                />
                <pre 
                  ref={logsRef}
                  className="bg-black/50 text-green-400 p-4 rounded-lg font-mono text-xs overflow-auto max-h-[500px] whitespace-pre-wrap"
                >
                  {filteredLogs || "Click Refresh to load logs..."}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Terminal Tab */}
        <TabsContent value="terminal" className="space-y-4 mt-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Terminal</CardTitle>
              <CardDescription>
                Real-time shell access via WebSocket. Full PTY support.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[450px] rounded-lg overflow-hidden border border-border/50">
                <WebSocketTerminal
                  machineId={machine.id}
                  apiUrl={api.getApiUrl()}
                  token={localStorage.getItem("auth_token") || ""}
                  isActive={activeTab === "terminal"}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Connected via WebSocket. Supports interactive commands, colors, and full shell features.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Configs Tab */}
        <TabsContent value="configs" className="mt-6">
          <ConfigEditorTab machineId={machine.id} />
        </TabsContent>

        {/* Runtimes Tab */}
        <TabsContent value="runtimes" className="space-y-4 mt-6">
          <PHPRuntimeTab machineId={machine.id} />
        </TabsContent>

        {/* Jobs Tab */}
        <TabsContent value="jobs" className="space-y-4 mt-6">
          <MachineJobsTab machineId={machine.id} agentId={machine.agent_id} />
        </TabsContent>
      </Tabs>

      {/* Add Port Dialog */}
      <Dialog open={showAddPortDialog} onOpenChange={setShowAddPortDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Firewall Rule</DialogTitle>
            <DialogDescription>
              Allow a new port through the firewall.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                placeholder="8080"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Protocol</Label>
              <div className="flex gap-2">
                <Button
                  variant={newProtocol === "tcp" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNewProtocol("tcp")}
                >
                  TCP
                </Button>
                <Button
                  variant={newProtocol === "udp" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNewProtocol("udp")}
                >
                  UDP
                </Button>
                <Button
                  variant={newProtocol === "both" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNewProtocol("both")}
                >
                  Both
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddPortDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPort}>
              Add Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change SSH Port Dialog */}
      <Dialog open={showSSHPortDialog} onOpenChange={setShowSSHPortDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change SSH Port</DialogTitle>
            <DialogDescription>
              Change the SSH daemon port. Current port: {machine.ssh_port || 22}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ssh-port">New SSH Port</Label>
              <Input
                id="ssh-port"
                type="number"
                placeholder="2222"
                min="1024"
                max="65535"
                value={sshPort}
                onChange={(e) => setSSHPort(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Must be between 1024 and 65535. UFW will be updated automatically.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSSHPortDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangeSSHPort}>
              Change Port
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Root Password</DialogTitle>
            <DialogDescription>
              Set a new root password for this machine.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Password must be at least 8 characters.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword}>
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fail2ban Config Dialog */}
      <Dialog open={showFail2banDialog} onOpenChange={setShowFail2banDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fail2ban Configuration</DialogTitle>
            <DialogDescription>
              Configure the fail2ban jail settings. This protects SSH from brute-force attacks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              className="min-h-[300px] font-mono text-sm"
              value={fail2banConfig}
              onChange={(e) => setFail2banConfig(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setFail2banConfig(DEFAULT_FAIL2BAN_CONFIG)}>
                Reset to Default
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFail2banDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveFail2banConfig}>
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm UFW Toggle Dialog */}
      <Dialog open={showConfirmUFWDialog} onOpenChange={setShowConfirmUFWDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingToggleValue ? "Enable" : "Disable"} Firewall?
            </DialogTitle>
            <DialogDescription>
              {pendingToggleValue
                ? "Enabling the firewall will block all incoming connections except allowed ports. Make sure SSH is allowed to avoid lockout."
                : "Disabling the firewall will allow all incoming connections. This may expose your server to security risks."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmUFWDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant={pendingToggleValue ? "default" : "destructive"} 
              onClick={handleConfirmUFWToggle}
            >
              {pendingToggleValue ? "Enable Firewall" : "Disable Firewall"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Fail2ban Toggle Dialog */}
      <Dialog open={showConfirmFail2banDialog} onOpenChange={setShowConfirmFail2banDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingToggleValue ? "Enable" : "Disable"} Fail2ban?
            </DialogTitle>
            <DialogDescription>
              {pendingToggleValue
                ? "Fail2ban will monitor authentication logs and ban IPs with too many failed login attempts."
                : "Disabling Fail2ban will stop monitoring for brute-force attacks. Your server may be more vulnerable to SSH attacks."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmFail2banDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant={pendingToggleValue ? "default" : "destructive"} 
              onClick={handleConfirmFail2banToggle}
            >
              {pendingToggleValue ? "Enable Fail2ban" : "Disable Fail2ban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Edit Dialog */}
      <Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Machine Notes</DialogTitle>
            <DialogDescription>
              Use markdown to document server info, expiry dates, etc.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Edit</Label>
              <Textarea
                className="min-h-[300px] font-mono text-sm resize-none"
                placeholder="# Server Notes&#10;&#10;**Hosting:** DigitalOcean&#10;**Expiry:** 2025-12-31"
                value={localNotes}
                onChange={(e) => handleNotesChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="min-h-[300px] p-4 border rounded-md bg-muted/30 prose prose-invert prose-sm max-w-none overflow-auto">
                {localNotes ? (
                  <ReactMarkdown>{localNotes}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">No notes yet...</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNotesDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => { handleSaveNotes(); setShowNotesDialog(false); }} disabled={saving || !notesDirty}>
              {saving ? "Saving..." : "Save Notes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
