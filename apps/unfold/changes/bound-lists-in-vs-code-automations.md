---
type: added
---
ClickUp Lists bound in Connect ClickUp show in VS Code's Automations view, and a Tenant admin can remove a List's binding there with Delete.

Removing one does what Connect ClickUp does: Ploeg drops the binding, the removal is audited, and the List disappears from every connected VS Code. VS Code asks for confirmation first, unless your tool-approval policy approves its delete-automation tool automatically. Its dialog mentions run history and sessions, which do not apply: removing a binding deletes no Work Item or session.
