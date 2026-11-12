# Generated artifacts

Upload a file only when the user needs to inspect or download it outside the
agent workspace. Source-code changes already present in the Space repository do
not need an artifact upload.

Use the absolute installed skill directory supplied by the runtime and invoke
the helper with Bash. If that location is unavailable, use the documented API
instead of searching the task repository:

```bash
bash "$paperclip_skill_dir/scripts/paperclip-upload-artifact.sh" path/to/result.png \
  --title "Result" \
  --summary "Requested output"
```

The helper uses `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`,
`PAPERCLIP_COMPANY_ID`, `PAPERCLIP_TASK_ID`, and `PAPERCLIP_RUN_ID`. It:

1. uploads the file as a task attachment;
2. registers an attachment-backed work product; and
3. prints Markdown links suitable for the task update.

For a file requested in an active chat response, bind it to that response:

```bash
bash "$paperclip_skill_dir/scripts/paperclip-upload-artifact.sh" path/to/result.png \
  --chat-comment "Here is the requested image."
```

Use `--no-work-product` only when the caller explicitly wants a raw attachment.
Use `--retry-unknown-upload` only after the helper reports an ambiguous prior
upload and you have reconciled the existing task attachments. Do not claim
external delivery merely because storage succeeded.

The helper's success output is the receipt. On failure, report that the file was
not delivered instead of substituting a local path.
