"use client";

import { useState, useEffect, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { api, Landing } from "@/lib/api";
import { toast } from "sonner";
import { 
  Plus, 
  FileArchive,
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Download,
  Eye,
  Upload
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function LandingsPage() {
  const [landings, setLandings] = useState<Landing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [landingName, setLandingName] = useState("");
  const [landingType, setLandingType] = useState<string>("html");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadLandings();
  }, []);

  const loadLandings = async () => {
    try {
      const data = await api.listLandings();
      setLandings(data);
    } catch (err) {
      console.error("Failed to load landings:", err);
      toast.error("Failed to load landings");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!landingName.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!selectedFile) {
      toast.error("Please select a ZIP file");
      return;
    }
    if (!selectedFile.name.toLowerCase().endsWith(".zip")) {
      toast.error("Only ZIP files are allowed");
      return;
    }

    setUploading(true);
    try {
      await api.uploadLanding(landingName, landingType, selectedFile);
      toast.success("Landing page uploaded successfully");
      setShowUploadDialog(false);
      setLandingName("");
      setLandingType("html");
      setSelectedFile(null);
      loadLandings();
    } catch (err) {
      console.error("Failed to upload landing:", err);
      toast.error("Failed to upload landing page");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (landing: Landing) => {
    if (!confirm(`Are you sure you want to delete "${landing.name}"?`)) {
      return;
    }

    try {
      await api.deleteLanding(landing.id);
      toast.success("Landing page deleted");
      loadLandings();
    } catch (err) {
      console.error("Failed to delete landing:", err);
      toast.error("Failed to delete landing page");
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const columns: ColumnDef<Landing>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const landing = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-purple-500/5 flex items-center justify-center">
              <FileArchive className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <div className="font-medium">{landing.name}</div>
              <div className="text-xs text-muted-foreground">{landing.file_name}</div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge className={row.original.type === "php" ? "bg-purple-500/20 text-purple-400 border-purple-500/30" : "bg-blue-500/20 text-blue-400 border-blue-500/30"}>
          {row.original.type.toUpperCase()}
        </Badge>
      ),
    },
    {
      accessorKey: "file_size",
      header: "Size",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatFileSize(row.original.file_size)}
        </span>
      ),
    },
    {
      accessorKey: "owner_name",
      header: "Owner",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.owner_name || row.original.owner_email || "-"}
        </span>
      ),
    },
    {
      accessorKey: "created_at",
      header: "Uploaded",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const landing = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {landing.preview_path && (
                <DropdownMenuItem 
                  onClick={() => window.open(api.getApiUrl() + landing.preview_path, "_blank")}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </DropdownMenuItem>
              )}
              <DropdownMenuItem 
                onClick={() => window.open(api.getLandingDownloadUrl(landing.id), "_blank")}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive"
                onClick={() => handleDelete(landing)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

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
          <h1 className="text-3xl font-semibold tracking-tight">Landing Pages</h1>
          <p className="text-muted-foreground mt-1">
            Upload and manage static HTML/PHP landing pages for your domains.
          </p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Upload Landing
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Landings</CardTitle>
            <FileArchive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{landings.length}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">HTML Pages</CardTitle>
            <FileArchive className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">
              {landings.filter(l => l.type === "html").length}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">PHP Pages</CardTitle>
            <FileArchive className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-500">
              {landings.filter(l => l.type === "php").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Landings Table */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Your Landing Pages</CardTitle>
          <CardDescription>
            Upload ZIP files containing your landing pages. They can be assigned to nginx locations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable 
            columns={columns} 
            data={landings}
            searchKey="name"
            searchPlaceholder="Search landings..."
          />
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Landing Page</DialogTitle>
            <DialogDescription>
              Upload a ZIP file containing your landing page files.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="landing-name">Name</Label>
              <Input
                id="landing-name"
                placeholder="e.g., Marketing Page v2"
                value={landingName}
                onChange={(e) => setLandingName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="landing-type">Type</Label>
              <Select value={landingType} onValueChange={setLandingType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="html">HTML (Static)</SelectItem>
                  <SelectItem value="php">PHP (Requires PHP-FPM)</SelectItem>
                </SelectContent>
              </Select>
              {landingType === "php" && (
                <p className="text-xs text-muted-foreground">
                  PHP pages require PHP-FPM to be installed on the target machine.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>ZIP File</Label>
              <input
                type="file"
                ref={fileInputRef}
                accept=".zip"
                className="hidden"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              <div 
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileArchive className="h-5 w-5 text-primary" />
                    <span className="font-medium">{selectedFile.name}</span>
                    <span className="text-muted-foreground">
                      ({formatFileSize(selectedFile.size)})
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Click to select a ZIP file
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Max 50MB
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

