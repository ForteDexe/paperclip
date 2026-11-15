import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildSkillMentionHref } from "@outpost/shared";
import { spaceSkillsApi } from "../api/spaceSkills";
import { useSpace } from "./SpaceContext";
import { queryKeys } from "../lib/queryKeys";

export interface SkillCommandOption {
  id: string;
  kind: "skill";
  skillId: string;
  key: string;
  name: string;
  slug: string;
  description: string | null;
  href: string;
  aliases: string[];
}

export interface ActionCommandOption {
  id: string;
  kind: "action";
  command: string;
  name: string;
  description: string;
  aliases: string[];
  disabled?: boolean;
  disabledReason?: string | null;
}

export type SlashCommandOption = SkillCommandOption | ActionCommandOption;

interface EditorAutocompleteContextValue {
  slashCommands: SlashCommandOption[];
  /** Starts the skills read. Editors call it when they mount. */
  requestSlashCommands: () => void;
}

const EditorAutocompleteContext = createContext<EditorAutocompleteContextValue>({
  slashCommands: [],
  requestSlashCommands: () => {},
});

/**
 * Slash-command options for Markdown editors. The space skill list is large,
 * and most pages have no editor, so the provider reads it
 * only after the first editor mounts. Once read they stay current through the
 * live-update invalidations for skills.
 */
export function EditorAutocompleteProvider({ children }: { children: ReactNode }) {
  const { selectedSpaceId } = useSpace();
  const [requested, setRequested] = useState(false);
  const requestSlashCommands = useCallback(() => setRequested(true), []);
  const { data: spaceSkills = [] } = useQuery({
    queryKey: selectedSpaceId
      ? queryKeys.spaceSkills.list(selectedSpaceId)
      : ["outpost-skills", "__none__"],
    queryFn: () => spaceSkillsApi.list(selectedSpaceId!),
    enabled: requested && Boolean(selectedSpaceId),
  });
  const value = useMemo<EditorAutocompleteContextValue>(() => ({
    slashCommands: [
      ...spaceSkills.map((skill) => ({
        id: `skill:${skill.id}`,
        kind: "skill" as const,
        skillId: skill.id,
        key: skill.key,
        name: skill.name,
        slug: skill.slug,
        description: skill.description ?? null,
        href: buildSkillMentionHref(skill.id, skill.slug),
        aliases: [skill.slug, skill.name, skill.key],
      })),
    ],
    requestSlashCommands,
  }), [spaceSkills, requestSlashCommands]);

  return (
    <EditorAutocompleteContext.Provider value={value}>
      {children}
    </EditorAutocompleteContext.Provider>
  );
}

/** Returns the slash commands and starts their reads on first use. */
export function useEditorAutocomplete() {
  const value = useContext(EditorAutocompleteContext);
  const { requestSlashCommands } = value;
  useEffect(() => {
    requestSlashCommands();
  }, [requestSlashCommands]);
  return value;
}
