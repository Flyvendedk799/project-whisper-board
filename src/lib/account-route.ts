const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

export type AccountMatch =
  | { name: "index" }
  | { name: "workspace" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "tickets" }
  | { name: "ticket"; id: string }
  | { name: "ticketTasks"; id: string }
  | { name: "plans" }
  | { name: "plan"; id: string }
  | { name: "planTasks"; id: string };

/** Map an `/api/v1/*` splat onto a workspace resource. */
export function matchAccountRoute(path: string): AccountMatch | null {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  if (cleaned === "" || cleaned === "index") return { name: "index" };
  if (cleaned === "workspace") return { name: "workspace" };
  if (cleaned === "projects") return { name: "projects" };
  if (cleaned === "tickets") return { name: "tickets" };
  if (cleaned === "plans") return { name: "plans" };

  const project = cleaned.match(new RegExp(`^projects/(${UUID})$`));
  if (project) return { name: "project", id: project[1] };

  const ticketTasks = cleaned.match(new RegExp(`^tickets/(${UUID})/tasks$`));
  if (ticketTasks) return { name: "ticketTasks", id: ticketTasks[1] };

  const ticket = cleaned.match(new RegExp(`^tickets/(${UUID})$`));
  if (ticket) return { name: "ticket", id: ticket[1] };

  const planTasks = cleaned.match(new RegExp(`^plans/(${UUID})/tasks$`));
  if (planTasks) return { name: "planTasks", id: planTasks[1] };

  const plan = cleaned.match(new RegExp(`^plans/(${UUID})$`));
  if (plan) return { name: "plan", id: plan[1] };

  return null;
}
