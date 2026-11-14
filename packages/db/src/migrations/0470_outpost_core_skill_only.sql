UPDATE "agents"
SET "adapter_config" = jsonb_set(
  "adapter_config",
  '{outpostSkillSync,desiredSkills}',
  COALESCE((
    SELECT jsonb_agg(entry.value ORDER BY entry.ordinality)
    FROM jsonb_array_elements("agents"."adapter_config"#>'{outpostSkillSync,desiredSkills}') WITH ORDINALITY AS entry(value, ordinality)
    WHERE CASE jsonb_typeof(entry.value)
      WHEN 'string' THEN entry.value#>>'{}'
      WHEN 'object' THEN entry.value->>'key'
      ELSE NULL
    END NOT IN (
      'agentmail',
      'complain',
      'first-task',
      'outpost-operator',
      'outpost-converting-plans-to-tasks',
      'outpost-create-agent',
      'para-memory-files',
      'slack',
      'suggestion-box',
      'outpost/outpost/agentmail',
      'outpost/outpost/complain',
      'outpost/outpost/first-task',
      'outpost/outpost/outpost-operator',
      'outpost/outpost/outpost-converting-plans-to-tasks',
      'outpost/outpost/outpost-create-agent',
      'outpost/outpost/para-memory-files',
      'outpost/outpost/slack',
      'outpost/outpost/suggestion-box'
    )
  ), '[]'::jsonb),
  false
)
WHERE jsonb_typeof("adapter_config"#>'{outpostSkillSync,desiredSkills}') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("agents"."adapter_config"#>'{outpostSkillSync,desiredSkills}') AS entry(value)
    WHERE CASE jsonb_typeof(entry.value)
      WHEN 'string' THEN entry.value#>>'{}'
      WHEN 'object' THEN entry.value->>'key'
      ELSE NULL
    END IN (
      'agentmail', 'complain', 'first-task', 'outpost-operator',
      'outpost-converting-plans-to-tasks', 'outpost-create-agent',
      'para-memory-files', 'slack', 'suggestion-box',
      'outpost/outpost/agentmail', 'outpost/outpost/complain',
      'outpost/outpost/first-task', 'outpost/outpost/outpost-operator',
      'outpost/outpost/outpost-converting-plans-to-tasks',
      'outpost/outpost/outpost-create-agent',
      'outpost/outpost/para-memory-files', 'outpost/outpost/slack',
      'outpost/outpost/suggestion-box'
    )
  );
--> statement-breakpoint
DELETE FROM "space_skill_mutation_receipts"
WHERE "key" IN (
  'outpost/outpost/agentmail',
  'outpost/outpost/complain',
  'outpost/outpost/first-task',
  'outpost/outpost/outpost-operator',
  'outpost/outpost/outpost-converting-plans-to-tasks',
  'outpost/outpost/outpost-create-agent',
  'outpost/outpost/para-memory-files',
  'outpost/outpost/slack',
  'outpost/outpost/suggestion-box'
);
--> statement-breakpoint
DELETE FROM "space_skills"
WHERE "key" IN (
  'outpost/outpost/agentmail',
  'outpost/outpost/complain',
  'outpost/outpost/first-task',
  'outpost/outpost/outpost-operator',
  'outpost/outpost/outpost-converting-plans-to-tasks',
  'outpost/outpost/outpost-create-agent',
  'outpost/outpost/para-memory-files',
  'outpost/outpost/slack',
  'outpost/outpost/suggestion-box'
);
