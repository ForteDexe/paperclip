import { createDb } from "@outpost/db";
import { createAgentLifecycle } from "../src/services/agent-lifecycle.js";
import {
  spaces,
  goals,
  projects,
  issues,
} from "@outpost/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createDb(url);

console.log("Seeding database...");

const [space] = await db
  .insert(spaces)
  .values({
    name: "Outpost Demo Space",
    description: "A demo autonomous space",
    status: "active",
    budgetMonthlyCents: 50000,
  })
  .returning();

const defaultAgent = await createAgentLifecycle(db).requestCreation(space!.id, {
    name: "Default agent",
    role: "lead",
    title: "Default agent",
    status: "idle",
    adapterType: "process",
    adapterConfig: { command: "echo", args: ["hello from default agent"] },
    budgetMonthlyCents: 15000,
  });

const engineer = await createAgentLifecycle(db).requestCreation(space!.id, {
    name: "Engineer Agent",
    role: "engineer",
    title: "Software Engineer",
    status: "idle",
    leadAgentId: defaultAgent!.id,
    adapterType: "process",
    adapterConfig: { command: "echo", args: ["hello from engineer"] },
    budgetMonthlyCents: 10000,
  });

const [goal] = await db
  .insert(goals)
  .values({
    spaceId: space!.id,
    title: "Ship V1",
    description: "Deliver first control plane release",
    level: "space",
    status: "active",
    ownerAgentId: defaultAgent!.id,
  })
  .returning();

const [project] = await db
  .insert(projects)
  .values({
    spaceId: space!.id,
    goalId: goal!.id,
    name: "Control Plane MVP",
    description: "Implement the core operator and agent loop",
    status: "in_progress",
    leadAgentId: defaultAgent!.id,
  })
  .returning();

await db.insert(issues).values([
  {
    spaceId: space!.id,
    projectId: project!.id,
    goalId: goal!.id,
    title: "Implement atomic task checkout",
    description: "Ensure in_progress claiming is conflict-safe",
    status: "todo",
    priority: "high",
    assigneeAgentId: engineer!.id,
    createdByAgentId: defaultAgent!.id,
  },
  {
    spaceId: space!.id,
    projectId: project!.id,
    goalId: goal!.id,
    title: "Add budget auto-pause",
    description: "Pause agent at hard budget ceiling",
    status: "backlog",
    priority: "medium",
    createdByAgentId: defaultAgent!.id,
  },
]);

console.log("Seed complete");
process.exit(0);
