---
name: Project authorization policy
description: Owner's daily-report visibility choice and fail-closed project-assignment requirement.
---

Project-scoped users' daily reports must show authorized projects only. Do not make daily reports Admin-only or expose all-project data to scoped users. Preserve saved report records and the reporting generation/signature workflow.

**Why:** The owner explicitly selected “Show authorized projects only” when resolving the conflict between shared daily packets and project isolation.

**How to apply:** Scope report views and exports to the caller's authorized project data without treating a shared saved packet as permission to disclose other projects.

Missing or empty project assignments must not silently default to all projects. Preserve genuinely global Admin permissions and the existing role/capability requirements.

**Why:** This is an explicit requirement of the owner's P0 project-isolation fix.

**How to apply:** Keep assignment checks separate from role/capability checks; neither a missing assignment nor a PM/HSE role alone grants access to every project.
