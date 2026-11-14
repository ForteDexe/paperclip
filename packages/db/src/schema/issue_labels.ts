import { pgTable, uuid, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";
import { labels } from "./labels.js";

export const issueLabels = pgTable(
  "issue_labels",
  {
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    labelId: uuid("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.issueId, table.labelId], name: "issue_labels_pk" }),
    issueIdx: index("issue_labels_issue_idx").on(table.issueId),
    labelIdx: index("issue_labels_label_idx").on(table.labelId),
    spaceIdx: index("issue_labels_space_idx").on(table.spaceId),
  }),
);
