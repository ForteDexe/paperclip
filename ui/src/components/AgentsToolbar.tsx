import { List, Network, Plus } from "lucide-react";
import { ToolbarSearch } from "./ToolbarSearch";
import { Button } from "./ui/button";

export interface AgentsToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  view: "list" | "agent-hierarchy";
  onViewChange: (value: "list" | "agent-hierarchy") => void;
  hideViewToggle?: boolean;
  onNewAgent: () => void;
}

/** Shared roster search, view controls and actions for the page and stories. */
export function AgentsToolbar({ query, onQueryChange, view, onViewChange, hideViewToggle, onNewAgent }: AgentsToolbarProps) {
  return <div data-canonical-toolbar="agents" role="toolbar" aria-label="Agents controls" className="flex flex-wrap items-center gap-3">
    <div className="design-toolbar-controls flex w-full flex-wrap items-center gap-4">
      <ToolbarSearch query={query} onQueryChange={onQueryChange} label="Search agents" placeholder="Search agents…" />
      {!hideViewToggle && <div className="design-view-toggle" role="group" aria-label="Agent view">
          <Button type="button" size="icon-sm" variant={view === "list" ? "secondary" : "ghost"} className="design-toolbar-icon" onClick={() => onViewChange("list")} title="List view" aria-label="List view" aria-pressed={view === "list"}><List aria-hidden /></Button>
          <Button type="button" size="icon-sm" variant={view === "agent-hierarchy" ? "secondary" : "ghost"} className="design-toolbar-icon" onClick={() => onViewChange("agent-hierarchy")} title="Agent hierarchy view" aria-label="Agent hierarchy view" aria-pressed={view === "agent-hierarchy"}><Network aria-hidden /></Button>
      </div>}
      <div className="design-toolbar-actions">
        <Button size="sm" variant="outline" data-toolbar-primary onClick={onNewAgent}><Plus aria-hidden />New Agent</Button>
      </div>
    </div>
  </div>;
}
