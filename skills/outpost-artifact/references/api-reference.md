# Artifact API

The helper requires `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`,
`PAPERCLIP_COMPANY_ID`, `PAPERCLIP_TASK_ID`, and `PAPERCLIP_RUN_ID`.

For Codex:

```bash
skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/outpost-artifact"
bash "$skill_dir/scripts/outpost-upload-artifact.sh" path/to/result.png \
  --title "Stage 2 - after" \
  --summary "Layout after the requested change"
```

For Claude, use `$HOME/.claude/skills/outpost-artifact` as `skill_dir`.

The helper:

1. lists current task attachments to make a same-run retry idempotent;
2. uploads with `POST /api/companies/:spaceId/issues/:taskId/attachments`;
3. registers the attachment with `POST /api/issues/:taskId/work-products`; and
4. prints Markdown links and ids as the receipt.

Useful options:

- `--title` and `--summary` describe the result.
- `--no-primary` prevents this result replacing the primary result of its type.
- `--no-work-product` stores only a raw attachment.
- `--output json` returns a structured receipt.
- `--dry-run` validates resolved inputs without calling the API.

Use `--retry-unknown-upload` only after reconciling an ambiguous prior upload;
it accepts duplicate-file risk. On failure, report that delivery failed instead
of substituting a local path.

