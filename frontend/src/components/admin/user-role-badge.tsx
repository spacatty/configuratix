import { Shield, ShieldCheck, User as UserIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export const USER_ROLES = [
  { value: "superadmin", label: "Super admin", icon: ShieldCheck },
  { value: "admin", label: "Admin", icon: Shield },
  { value: "user", label: "User", icon: UserIcon },
] as const;

export function userRoleLabel(role: string): string {
  return USER_ROLES.find((r) => r.value === role)?.label ?? role;
}

/** Workspace role (superadmin / admin / user). */
export function UserRoleBadge({ role }: { role: string }) {
  if (role === "superadmin")
    return (
      <Badge variant="info">
        <ShieldCheck />
        Super admin
      </Badge>
    );
  if (role === "admin")
    return (
      <Badge variant="outline">
        <Shield />
        Admin
      </Badge>
    );
  return <Badge variant="muted">{userRoleLabel(role) || "User"}</Badge>;
}
