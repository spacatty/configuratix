"use client";

import { useEffect, useState } from "react";
import { api, UAPatternsByCategory, SecurityUAPattern } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bot, Plus, Trash2, Shield, Info, Code, Search, Zap, Globe, Lock, Eye } from "lucide-react";

const categoryInfo: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  http_clients: {
    label: "HTTP Clients",
    icon: <Code className="h-4 w-4" />,
    description: "Programming libraries like requests, axios, httpx",
  },
  scrapers: {
    label: "Scrapers & Headless",
    icon: <Search className="h-4 w-4" />,
    description: "Web scrapers and headless browsers",
  },
  scanners: {
    label: "Security Scanners",
    icon: <Lock className="h-4 w-4" />,
    description: "Vulnerability and port scanners",
  },
  seo_bots: {
    label: "SEO & Marketing",
    icon: <Zap className="h-4 w-4" />,
    description: "Aggressive SEO crawlers",
  },
  ai_crawlers: {
    label: "AI Crawlers",
    icon: <Bot className="h-4 w-4" />,
    description: "AI training data collectors",
  },
  generic_bad: {
    label: "Generic Bad",
    icon: <Eye className="h-4 w-4" />,
    description: "Generic bot/spider identifiers",
  },
  suspicious: {
    label: "Suspicious",
    icon: <Shield className="h-4 w-4" />,
    description: "Empty or missing user agents",
  },
  custom: {
    label: "Custom Patterns",
    icon: <Globe className="h-4 w-4" />,
    description: "Your custom patterns",
  },
};

export default function UAPatternsPage() {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<UAPatternsByCategory[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newCategory, setNewCategory] = useState("custom");
  const [newMatchType, setNewMatchType] = useState("contains");
  const [newDescription, setNewDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const loadPatterns = async () => {
    setLoading(true);
    try {
      const result = await api.listSecurityUAPatterns();
      setCategories(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load patterns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatterns();
  }, []);

  const handleToggleCategory = async (category: string, enabled: boolean) => {
    try {
      await api.toggleSecurityUACategory(category, enabled);
      setCategories((prev) =>
        prev.map((c) =>
          c.category === category ? { ...c, is_enabled: enabled } : c
        )
      );
      toast.success(`${categoryInfo[category]?.label || category} ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle");
    }
  };

  const handleAddPattern = async () => {
    if (!newPattern.trim()) {
      toast.error("Pattern is required");
      return;
    }

    setSubmitting(true);
    try {
      await api.createSecurityUAPattern({
        pattern: newPattern.trim(),
        category: newCategory,
        match_type: newMatchType,
        description: newDescription.trim(),
      });
      toast.success("Pattern added");
      setShowAddDialog(false);
      setNewPattern("");
      setNewDescription("");
      loadPatterns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add pattern");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePattern = async (pattern: SecurityUAPattern) => {
    if (pattern.is_system) {
      toast.error("Cannot delete system patterns");
      return;
    }

    try {
      await api.deleteSecurityUAPattern(pattern.id);
      toast.success("Pattern deleted");
      loadPatterns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const getCategoryInfo = (category: string) => {
    return categoryInfo[category] || {
      label: category,
      icon: <Bot className="h-4 w-4" />,
      description: "",
    };
  };

  const systemPatternCount = categories.reduce(
    (acc, c) => acc + c.patterns.filter((p) => p.is_system).length,
    0
  );
  const customPatternCount = categories.reduce(
    (acc, c) => acc + c.patterns.filter((p) => !p.is_system).length,
    0
  );

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="h-8 w-8 text-orange-500" />
          <div>
            <h1 className="text-2xl font-bold">User-Agent Patterns</h1>
            <p className="text-muted-foreground">
              {systemPatternCount} system patterns, {customPatternCount} custom
            </p>
          </div>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Pattern
        </Button>
      </div>

      {/* Info Box */}
      <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg border">
        <Info className="h-5 w-5 text-blue-500 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">How UA Blocking Works</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Enable/disable entire categories with the toggle</li>
            <li>When a request matches a pattern, the IP is permanently banned</li>
            <li>System patterns cannot be deleted, but categories can be disabled</li>
            <li>Patterns are synced to all agents every 2 minutes</li>
          </ul>
        </div>
      </div>

      {/* Categories */}
      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <Accordion
          type="multiple"
          value={expandedCategories}
          onValueChange={setExpandedCategories}
          className="space-y-3"
        >
          {categories.map((cat) => {
            const info = getCategoryInfo(cat.category);
            return (
              <AccordionItem
                key={cat.category}
                value={cat.category}
                className="border rounded-lg overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-2 bg-muted/30">
                  <AccordionTrigger className="flex-1 hover:no-underline">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{info.icon}</span>
                      <div className="text-left">
                        <div className="font-medium">{info.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {cat.pattern_count} patterns
                          {!cat.is_enabled && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              Disabled
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Label className="text-xs text-muted-foreground">
                      {cat.is_enabled ? "Enabled" : "Disabled"}
                    </Label>
                    <Switch
                      checked={cat.is_enabled}
                      onCheckedChange={(checked) =>
                        handleToggleCategory(cat.category, checked)
                      }
                    />
                  </div>
                </div>
                <AccordionContent className="px-4 py-3">
                  <p className="text-sm text-muted-foreground mb-3">
                    {info.description}
                  </p>
                  <div className="space-y-2">
                    {cat.patterns.map((pattern) => (
                      <div
                        key={pattern.id}
                        className="flex items-center justify-between p-2 rounded border bg-background"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded truncate">
                            {pattern.pattern}
                          </code>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {pattern.match_type}
                          </Badge>
                          {pattern.is_system && (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              System
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {pattern.description && (
                            <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                              {pattern.description}
                            </span>
                          )}
                          {!pattern.is_system && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeletePattern(pattern)}
                              className="text-destructive hover:text-destructive h-6 w-6 p-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {cat.patterns.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No patterns in this category
                      </p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Pattern</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Pattern</Label>
              <Input
                placeholder="python-httpx"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                className="font-mono"
              />
            </div>
            <div>
              <Label>Match Type</Label>
              <Select value={newMatchType} onValueChange={setNewMatchType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">Contains (substring)</SelectItem>
                  <SelectItem value="exact">Exact Match</SelectItem>
                  <SelectItem value="regex">Regex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryInfo).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                placeholder="Describe this pattern"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPattern} disabled={submitting}>
              {submitting ? "Adding..." : "Add Pattern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

