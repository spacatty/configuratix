"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, SecurityStats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Shield,
  Ban,
  ShieldCheck,
  Bot,
  TrendingUp,
  Server,
  ArrowRight,
  Activity,
} from "lucide-react";

export default function SecurityDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<SecurityStats | null>(null);

  const loadStats = async () => {
    setLoading(true);
    try {
      const result = await api.getSecurityStats();
      setStats(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    // Refresh every 30 seconds
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="h-10 w-10 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Security</h1>
          <p className="text-muted-foreground">
            IP banning, UA blocking, and endpoint protection
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Ban className="h-4 w-4 text-destructive" />
              Active Bans
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.active_bans || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.total_bans || 0} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Bans Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.bans_today || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.bans_this_week || 0} this week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              Whitelisted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.whitelist_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">IPs/CIDRs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bot className="h-4 w-4 text-orange-500" />
              UA Patterns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.ua_pattern_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Active patterns</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-destructive/10">
                  <Ban className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <h3 className="font-semibold">IP Blacklist</h3>
                  <p className="text-sm text-muted-foreground">
                    View and manage banned IPs
                  </p>
                </div>
              </div>
              <Link href="/security/bans">
                <Button variant="ghost" size="sm">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-green-500/10">
                  <ShieldCheck className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold">Whitelist</h3>
                  <p className="text-sm text-muted-foreground">
                    IPs that can never be banned
                  </p>
                </div>
              </div>
              <Link href="/security/whitelist">
                <Button variant="ghost" size="sm">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-orange-500/10">
                  <Bot className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-semibold">UA Patterns</h3>
                  <p className="text-sm text-muted-foreground">
                    User-agent blocking rules
                  </p>
                </div>
              </div>
              <Link href="/security/ua-patterns">
                <Button variant="ghost" size="sm">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Reasons */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Top Ban Reasons
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!stats?.top_reasons?.length ? (
              <p className="text-muted-foreground text-center py-6">No data yet</p>
            ) : (
              <div className="space-y-3">
                {stats.top_reasons.map((reason, i) => (
                  <div
                    key={reason.reason}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground w-4">{i + 1}.</span>
                      <Badge
                        variant={
                          reason.reason === "blocked_ua"
                            ? "destructive"
                            : reason.reason === "invalid_endpoint"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {reason.reason === "blocked_ua"
                          ? "Blocked UA"
                          : reason.reason === "invalid_endpoint"
                          ? "Invalid Path"
                          : reason.reason === "manual"
                          ? "Manual"
                          : reason.reason}
                      </Badge>
                    </div>
                    <span className="font-medium">{reason.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Machines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5" />
              Top Source Machines
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!stats?.top_machines?.length ? (
              <p className="text-muted-foreground text-center py-6">No data yet</p>
            ) : (
              <div className="space-y-3">
                {stats.top_machines.map((machine, i) => (
                  <div
                    key={machine.machine_id}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground w-4">{i + 1}.</span>
                      <span className="font-medium">{machine.machine_name}</span>
                    </div>
                    <span className="font-medium">{machine.count} bans</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

