UPDATE "agents"
SET "adapter_config" = jsonb_set(
  "adapter_config",
  '{paperclipSkillSync,desiredSkills}',
  COALESCE((
    SELECT jsonb_agg(entry.value ORDER BY entry.ordinality)
    FROM jsonb_array_elements("agents"."adapter_config"#>'{paperclipSkillSync,desiredSkills}') WITH ORDINALITY AS entry(value, ordinality)
    WHERE CASE jsonb_typeof(entry.value)
      WHEN 'string' THEN entry.value#>>'{}'
      WHEN 'object' THEN entry.value->>'key'
      ELSE NULL
    END NOT IN (
      'agentmail',
      'complain',
      'first-task',
      'paperclip-board',
      'paperclip-converting-plans-to-tasks',
      'paperclip-create-agent',
      'para-memory-files',
      'slack',
      'suggestion-box',
      'paperclipai/paperclip/agentmail',
      'paperclipai/paperclip/complain',
      'paperclipai/paperclip/first-task',
      'paperclipai/paperclip/paperclip-board',
      'paperclipai/paperclip/paperclip-converting-plans-to-tasks',
      'paperclipai/paperclip/paperclip-create-agent',
      'paperclipai/paperclip/para-memory-files',
      'paperclipai/paperclip/slack',
      'paperclipai/paperclip/suggestion-box'
    )
  ), '[]'::jsonb),
  false
)
WHERE jsonb_typeof("adapter_config"#>'{paperclipSkillSync,desiredSkills}') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("agents"."adapter_config"#>'{paperclipSkillSync,desiredSkills}') AS entry(value)
    WHERE CASE jsonb_typeof(entry.value)
      WHEN 'string' THEN entry.value#>>'{}'
      WHEN 'object' THEN entry.value->>'key'
      ELSE NULL
    END IN (
      'agentmail', 'complain', 'first-task', 'paperclip-board',
      'paperclip-converting-plans-to-tasks', 'paperclip-create-agent',
      'para-memory-files', 'slack', 'suggestion-box',
      'paperclipai/paperclip/agentmail', 'paperclipai/paperclip/complain',
      'paperclipai/paperclip/first-task', 'paperclipai/paperclip/paperclip-board',
      'paperclipai/paperclip/paperclip-converting-plans-to-tasks',
      'paperclipai/paperclip/paperclip-create-agent',
      'paperclipai/paperclip/para-memory-files', 'paperclipai/paperclip/slack',
      'paperclipai/paperclip/suggestion-box'
    )
  );
--> statement-breakpoint
DELETE FROM "company_skill_mutation_receipts"
WHERE "key" IN (
  'paperclipai/paperclip/agentmail',
  'paperclipai/paperclip/complain',
  'paperclipai/paperclip/first-task',
  'paperclipai/paperclip/paperclip-board',
  'paperclipai/paperclip/paperclip-converting-plans-to-tasks',
  'paperclipai/paperclip/paperclip-create-agent',
  'paperclipai/paperclip/para-memory-files',
  'paperclipai/paperclip/slack',
  'paperclipai/paperclip/suggestion-box'
);
--> statement-breakpoint
DELETE FROM "company_skills"
WHERE "key" IN (
  'paperclipai/paperclip/agentmail',
  'paperclipai/paperclip/complain',
  'paperclipai/paperclip/first-task',
  'paperclipai/paperclip/paperclip-board',
  'paperclipai/paperclip/paperclip-converting-plans-to-tasks',
  'paperclipai/paperclip/paperclip-create-agent',
  'paperclipai/paperclip/para-memory-files',
  'paperclipai/paperclip/slack',
  'paperclipai/paperclip/suggestion-box'
);
