"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, CommandTemplate, Machine } from "@/lib/api";

const categoryColors: Record<string, string> = {
  security: "bg-red-500/20 text-red-400 border-red-500/30",
  firewall: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  nginx: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ssl: "bg-green-500/20 text-green-400 border-green-500/30",
  system: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  files: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

export default function CommandsPage() {
  const [commands, setCommands] = useState<CommandTemplate[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCommand, setSelectedCommand] = useState<CommandTemplate | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<string>("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("all");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [cmds, mchs] = await Promise.all([
        api.listCommands(),
        api.listMachines(),
      ]);
      setCommands(cmds || []);
      setMachines(mchs || []);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const openExecuteDialog = (cmd: CommandTemplate) => {
    setSelectedCommand(cmd);
    // Initialize variables with defaults
    const vars: Record<string, string> = {};
    cmd.variables.forEach(v => {
      vars[v.name] = v.default || "";
    });
    setVariables(vars);
  };

  const handleExecute = async () => {
    if (!selectedCommand || !selectedMachine) return;
    
    setExecuting(true);
    try {
      await api.executeCommand(selectedMachine, selectedCommand.id, variables);
      alert("Job created successfully! Check the machine's job history.");
      setSelectedCommand(null);
      setSelectedMachine("");
      setVariables({});
    } catch (err) {
      console.error("Failed to execute command:", err);
      alert("Failed to create job: " + err);
    } finally {
      setExecuting(false);
    }
  };

  const categories = [...new Set(commands.map(c => c.category))];
  const filteredCommands = filterCategory === "all" 
    ? commands 
    : commands.filter(c => c.category === filterCategory);

  // Group by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, CommandTemplate[]>);

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
          <h1 className="text-3xl font-semibold tracking-tight">Commands</h1>
          <p className="text-muted-foreground mt-1">
            Built-in command templates for managing machines
          </p>
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {Object.entries(groupedCommands).map(([category, cmds]) => (
        <div key={category} className="space-y-4">
          <h2 className="text-xl font-semibold capitalize flex items-center gap-2">
            <Badge className={categoryColors[category] || ""}>{category}</Badge>
            <span className="text-muted-foreground text-sm font-normal">({cmds.length} commands)</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cmds.map(cmd => (
              <Card key={cmd.id} className="border-border/50 bg-card/50 hover:border-primary/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{cmd.name}</CardTitle>
                      <CardDescription className="mt-1">{cmd.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {cmd.variables.length > 0 && (
                      <div className="text-sm">
                        <p className="text-muted-foreground mb-1">Variables:</p>
                        <div className="flex flex-wrap gap-1">
                          {cmd.variables.map(v => (
                            <Badge key={v.name} variant="outline" className="font-mono text-xs">
                              {v.name}{v.required && <span className="text-red-400">*</span>}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {cmd.steps.length} step{cmd.steps.length !== 1 ? 's' : ''} • on_error: {cmd.on_error}
                    </div>
                    <Button 
                      size="sm" 
                      className="w-full"
                      onClick={() => openExecuteDialog(cmd)}
                      disabled={machines.length === 0}
                    >
                      Execute
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {commands.length === 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>No Commands Available</CardTitle>
            <CardDescription>
              Command templates will appear here once the backend is configured.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Execute Command Dialog */}
      <Dialog open={!!selectedCommand} onOpenChange={(open) => !open && setSelectedCommand(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Execute: {selectedCommand?.name}</DialogTitle>
            <DialogDescription>
              {selectedCommand?.description}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Target Machine</Label>
              <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a machine" />
                </SelectTrigger>
                <SelectContent>
                  {machines.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.hostname || m.ip_address || m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedCommand?.variables.map(v => (
              <div key={v.name} className="space-y-2">
                <Label htmlFor={v.name}>
                  {v.name}
                  {v.required && <span className="text-red-400 ml-1">*</span>}
                </Label>
                {v.type === "text" ? (
                  <Textarea
                    id={v.name}
                    placeholder={v.description}
                    value={variables[v.name] || ""}
                    onChange={(e) => setVariables({...variables, [v.name]: e.target.value})}
                    className="font-mono text-sm"
                    rows={4}
                  />
                ) : (
                  <Input
                    id={v.name}
                    type={v.type === "int" ? "number" : "text"}
                    placeholder={v.description}
                    value={variables[v.name] || ""}
                    onChange={(e) => setVariables({...variables, [v.name]: e.target.value})}
                  />
                )}
                <p className="text-xs text-muted-foreground">{v.description}</p>
              </div>
            ))}

            {selectedCommand && selectedCommand.steps.length > 0 && (
              <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium">Steps Preview:</p>
                <div className="text-xs font-mono space-y-1 max-h-32 overflow-auto">
                  {selectedCommand.steps.map((step, i) => (
                    <div key={i} className="text-muted-foreground">
                      {i + 1}. {step.action}: {step.command || step.path || step.name || step.url}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCommand(null)}>
              Cancel
            </Button>
            <Button 
              onClick={handleExecute} 
              disabled={!selectedMachine || executing}
            >
              {executing ? "Creating Job..." : "Execute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

