"use client";

import { useState, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { api, CommandTemplate, Machine } from "@/lib/api";
import { toast } from "sonner";
import { 
  Play, 
  Terminal,
  Cog,
  Shield,
  FileCode,
  Zap
} from "lucide-react";

export default function CommandsPage() {
  const [commands, setCommands] = useState<CommandTemplate[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<CommandTemplate | null>(null);
  const [selectedMachine, setSelectedMachine] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [commandsData, machinesData] = await Promise.all([
        api.listCommands(),
        api.listMachines(),
      ]);
      setCommands(commandsData);
      setMachines(machinesData);
    } catch (err) {
      console.error("Failed to load data:", err);
      toast.error("Failed to load commands");
    } finally {
      setLoading(false);
    }
  };

  const openExecuteDialog = (command: CommandTemplate) => {
    setSelectedCommand(command);
    const defaultVars: Record<string, string> = {};
    command.variables.forEach(v => {
      defaultVars[v.name] = v.default || "";
    });
    setVariables(defaultVars);
    setSelectedMachine("");
    setShowExecuteDialog(true);
  };

  const handleExecute = async () => {
    if (!selectedCommand || !selectedMachine) {
      toast.error("Please select a machine");
      return;
    }

    // Validate required variables
    for (const v of selectedCommand.variables) {
      if (v.required && !variables[v.name]) {
        toast.error(`Variable "${v.name}" is required`);
        return;
      }
    }

    setExecuting(true);
    try {
      await api.executeCommand(selectedMachine, selectedCommand.id, variables);
      setShowExecuteDialog(false);
      toast.success(`Command "${selectedCommand.name}" sent to machine`);
    } catch (err) {
      console.error("Failed to execute command:", err);
      toast.error("Failed to execute command");
    } finally {
      setExecuting(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "system":
        return <Cog className="h-4 w-4" />;
      case "security":
        return <Shield className="h-4 w-4" />;
      case "nginx":
        return <FileCode className="h-4 w-4" />;
      default:
        return <Terminal className="h-4 w-4" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "system":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "security":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "nginx":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const columns: ColumnDef<CommandTemplate>[] = [
    {
      accessorKey: "name",
      header: "Command",
      cell: ({ row }) => {
        const cmd = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 flex items-center justify-center">
              <Zap className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <div className="font-medium">{cmd.name}</div>
              <div className="text-xs text-muted-foreground max-w-md truncate">
                {cmd.description}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => {
        const category = row.original.category;
        return (
          <Badge className={`${getCategoryColor(category)} text-xs capitalize`}>
            {getCategoryIcon(category)}
            <span className="ml-1">{category}</span>
          </Badge>
        );
      },
    },
    {
      accessorKey: "variables",
      header: "Variables",
      cell: ({ row }) => {
        const vars = row.original.variables;
        const required = vars.filter(v => v.required).length;
        const optional = vars.length - required;
        return (
          <div className="text-sm">
            {vars.length === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              <span>
                {required > 0 && (
                  <Badge variant="outline" className="mr-1 text-xs">
                    {required} required
                  </Badge>
                )}
                {optional > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {optional} optional
                  </Badge>
                )}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "steps",
      header: "Steps",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.steps.length} step(s)
        </span>
      ),
    },
    {
      accessorKey: "on_error",
      header: "On Error",
      cell: ({ row }) => {
        const onError = row.original.on_error;
        return (
          <Badge 
            variant="outline" 
            className={`text-xs ${
              onError === "rollback" 
                ? "border-yellow-500/30 text-yellow-500" 
                : onError === "stop"
                ? "border-red-500/30 text-red-500"
                : "border-gray-500/30"
            }`}
          >
            {onError}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button size="sm" onClick={() => openExecuteDialog(row.original)}>
          <Play className="h-4 w-4 mr-1" />
          Execute
        </Button>
      ),
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
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Commands</h1>
          <p className="text-muted-foreground mt-1">
            Execute predefined commands on your machines. {commands.length} template(s) available.
          </p>
        </div>
      </div>

      {/* Commands Table */}
      <Card className="border-border/50 bg-card/50 flex-1 flex flex-col overflow-hidden">
        <CardContent className="p-6">
          <DataTable 
            columns={columns} 
            data={commands}
            searchKey="name"
            searchPlaceholder="Search commands..."
          />
        </CardContent>
      </Card>

      {/* Execute Dialog */}
      <Dialog open={showExecuteDialog} onOpenChange={setShowExecuteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Execute: {selectedCommand?.name}</DialogTitle>
            <DialogDescription>
              {selectedCommand?.description}
            </DialogDescription>
          </DialogHeader>
          
          {selectedCommand && (
            <div className="space-y-4">
              {/* Machine Selection */}
              <div className="space-y-2">
                <Label>Target Machine</Label>
                <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a machine" />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map(machine => {
                      const isOnline = machine.last_seen && 
                        (Date.now() - new Date(machine.last_seen).getTime()) / 1000 / 60 < 5;
                      return (
                        <SelectItem key={machine.id} value={machine.id}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
                            {machine.title || machine.hostname || machine.ip_address}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Variables */}
              {selectedCommand.variables.length > 0 && (
                <div className="space-y-3">
                  <Label>Variables</Label>
                  <div className="space-y-3 p-4 rounded-lg bg-muted/50">
                    {selectedCommand.variables.map(v => (
                      <div key={v.name} className="space-y-1">
                        <Label htmlFor={`var-${v.name}`} className="text-sm">
                          {v.name}
                          {v.required && <span className="text-red-500 ml-1">*</span>}
                        </Label>
                        <Input
                          id={`var-${v.name}`}
                          type={v.type === "password" ? "password" : "text"}
                          value={variables[v.name] || ""}
                          onChange={(e) => setVariables({...variables, [v.name]: e.target.value})}
                          placeholder={v.description}
                        />
                        <p className="text-xs text-muted-foreground">{v.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Steps Preview */}
              <div className="space-y-2">
                <Label>Steps ({selectedCommand.steps.length})</Label>
                <div className="max-h-32 overflow-y-auto text-xs font-mono p-3 rounded-lg bg-black text-green-400">
                  {selectedCommand.steps.map((step, i) => (
                    <div key={i} className="mb-1">
                      <span className="text-muted-foreground">{i + 1}.</span>{" "}
                      <span className="text-yellow-400">{step.action}</span>
                      {step.command && <span>: {step.command}</span>}
                      {step.path && <span>: {step.path}</span>}
                      {step.name && <span>: {step.name}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* On Error */}
              <div className="text-sm text-muted-foreground">
                On error: <Badge variant="outline" className="ml-1">{selectedCommand.on_error}</Badge>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExecuteDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleExecute} disabled={executing || !selectedMachine}>
              {executing ? "Executing..." : "Execute Command"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
