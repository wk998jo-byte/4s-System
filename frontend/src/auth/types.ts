export type UserRole = "admin" | "operator" | "dept_hse" | "receiver" | string;

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  badge_number?: string | null;
  role: UserRole;
  capabilities: Record<string, boolean>;
  projects?: string[] | null;
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  operator: "Operator",
  dept_hse: "Dept HSE",
  receiver: "Project PM",
};
