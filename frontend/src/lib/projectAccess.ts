/** Explicit All-projects assignment stored in `user.projects` (not missing). */
export const ALL_PROJECTS_SENTINEL = "*";

export function isAllProjectsAssignment(
  projects: string[] | null | undefined,
): boolean {
  return Array.isArray(projects) && projects.includes(ALL_PROJECTS_SENTINEL);
}

/** Labels to show in Admin tags (hides the sentinel). */
export function projectAccessLabels(
  projects: string[] | null | undefined,
): string[] {
  if (!Array.isArray(projects)) return [];
  return projects.filter((p) => p && p !== ALL_PROJECTS_SENTINEL);
}
