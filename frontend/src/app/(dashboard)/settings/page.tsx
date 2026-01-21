"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const [checkInterval, setCheckInterval] = useState("1");
  const [autoBootstrap, setAutoBootstrap] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    // Settings would be saved to backend/env in production
    setTimeout(() => {
      setSaving(false);
      alert("Settings saved! Note: CHECK_INTERVAL_HOURS requires backend restart.");
    }, 500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure application settings
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Domain Health Checks</CardTitle>
            <CardDescription>
              Configure how often domains are checked for health status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="check-interval">Check Interval (hours)</Label>
              <Input
                id="check-interval"
                type="number"
                value={checkInterval}
                onChange={(e) => setCheckInterval(e.target.value)}
                min={1}
                max={24}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                How often to check domain health. Set CHECK_INTERVAL_HOURS in .env
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Agent Defaults</CardTitle>
            <CardDescription>
              Default settings for new agents
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto Bootstrap</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically run bootstrap job on new agents
                </p>
              </div>
              <Switch checked={autoBootstrap} onCheckedChange={setAutoBootstrap} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>About</CardTitle>
            <CardDescription>
              Application information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Application</span>
                <span className="font-medium">Configuratix</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Environment</span>
                <span className="font-medium">Development</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Support</CardTitle>
            <CardDescription>
              Get help with Configuratix
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              For configuration help, refer to the .env.example file in the project root.
            </p>
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
