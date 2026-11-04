import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { useList } from "../screens/shared";

/**
 * Project-access scope for dashboards / forms.
 * Admin or empty/null `user.projects` = all projects.
 * Otherwise filters are limited to the assigned project labels.
 */
export function useProjectAccess(catalogProjects: string[]) {
  const { user } = useAuth();

  const hasAllProjectAccess = useMemo(() => {
    if (user?.role === "admin") return true;
    const scoped = user?.projects;
    return !scoped || scoped.length === 0;
  }, [user?.role, user?.projects]);

  const accessProjects = useMemo(() => {
    if (hasAllProjectAccess) return catalogProjects;
    const allowed = new Set((user?.projects || []).map(String));
    const matched = catalogProjects.filter((p) => allowed.has(p));
    if (matched.length) return matched;
    return [...allowed];
  }, [hasAllProjectAccess, user?.projects, catalogProjects]);

  const isProjectScoped = !hasAllProjectAccess;
  const singleProject =
    isProjectScoped && accessProjects.length === 1 ? accessProjects[0]! : null;

  return {
    hasAllProjectAccess,
    accessProjects,
    isProjectScoped,
    singleProject,
  };
}

/** Project dropdown scope for registration forms (ids + labels). */
export function useFormProjectScope() {
  const projectList = useList("project");
  const catalog = useMemo(
    () => projectList.items.map((item) => item.label),
    [projectList.items],
  );
  const access = useProjectAccess(catalog);

  const allowedLabels = access.isProjectScoped ? access.accessProjects : null;

  const allowedItems = useMemo(() => {
    if (!allowedLabels) return projectList.items;
    const allowed = new Set(allowedLabels);
    return projectList.items.filter((item) => allowed.has(item.label));
  }, [projectList.items, allowedLabels]);

  const singleProjectId = useMemo(() => {
    if (!access.singleProject) return null;
    return (
      projectList.items.find((item) => item.label === access.singleProject)?.id ?? null
    );
  }, [access.singleProject, projectList.items]);

  return {
    ...access,
    projectList,
    allowedLabels,
    allowedItems,
    singleProjectId,
    lockProjectSelect: Boolean(access.singleProject),
  };
}

/**
 * When a form/drawer opens, auto-select Project + the sole assigned project.
 * With multiple assigned projects, clear any out-of-scope selection.
 */
export function useAutoFormProject(
  open: boolean,
  projectId: string,
  applyPatch: (patch: {
    project_id: string;
    assign_to?: "project" | "department";
    department_id?: string;
  }) => void,
) {
  const scope = useFormProjectScope();
  const applyRef = useRef(applyPatch);
  applyRef.current = applyPatch;

  useEffect(() => {
    if (!open || !scope.isProjectScoped) return;
    if (scope.singleProjectId) {
      if (projectId === scope.singleProjectId) return;
      applyRef.current({
        assign_to: "project",
        project_id: scope.singleProjectId,
        department_id: "",
      });
      return;
    }
    const allowed = new Set(scope.allowedItems.map((item) => item.id));
    if (projectId && !allowed.has(projectId)) {
      applyRef.current({ project_id: "" });
    }
  }, [
    open,
    scope.isProjectScoped,
    scope.singleProjectId,
    scope.allowedItems,
    projectId,
  ]);

  return scope;
}

type Access = ReturnType<typeof useProjectAccess>;

/**
 * Auto-apply project filter for restricted operators:
 * - one assigned project → lock By Project + that project
 * - multiple → clear invalid selection; "All" means all assigned
 */
export function useAutoProjectFilter(
  access: Access,
  project: string,
  setProject: (value: string) => void,
  setView?: (value: "projects") => void,
) {
  const { isProjectScoped, accessProjects, singleProject } = access;

  useEffect(() => {
    if (!isProjectScoped) return;
    if (singleProject) {
      setView?.("projects");
      if (project !== singleProject) setProject(singleProject);
      return;
    }
    if (project && !accessProjects.includes(project)) {
      setProject("");
    }
  }, [isProjectScoped, singleProject, accessProjects, project, setProject, setView]);
}

/** Match backend `filter_cases_for_user`: keep unassigned rows; drop other projects. */
export function rowAllowedForProjects(
  rowProject: string | null | undefined,
  access: Access,
): boolean {
  if (!access.isProjectScoped) return true;
  if (!rowProject) return true;
  return access.accessProjects.includes(rowProject);
}
