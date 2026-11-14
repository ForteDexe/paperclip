// Controlled ordinary run-token acceptance helper; normal run token only.
const peer = new URL(process.env.SLACK_FORM_FIXTURE_PEER_ORIGIN ?? "invalid:");
const base = new URL(process.env.OUTPOST_API_URL ?? "invalid:");
if (peer.protocol !== "http:" || peer.hostname !== "127.0.0.1" || peer.origin !== base.origin || peer.pathname !== "/") throw Error("unexpected scoped agent API peer");
if (process.env.SLACK_GATE_GUARD_PID !== String(process.pid)) throw Error("missing actual process guard");
const runId=process.env.OUTPOST_RUN_ID, agentId=process.env.OUTPOST_AGENT_ID, spaceId=process.env.OUTPOST_SPACE_ID, token=process.env.OUTPOST_API_KEY;
if (!runId || !agentId || !spaceId || !token) throw Error("missing normal run identity");
const headers={authorization:`Bearer ${token}`,"x-outpost-run-id":runId,"content-type":"application/json"};
async function request(path, method="GET", body) { const response=await fetch(new URL(path,base),{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});if(!response.ok)throw Error(`normal agent API refused ${method} ${response.status}`);return response.json(); }
const run=await request(`/api/heartbeat-runs/${encodeURIComponent(runId)}`);
if(run.id!==runId || run.spaceId!==spaceId || run.agentId!==agentId || typeof run.contextSnapshot?.issueId!=="string")throw Error("run scope changed");
const issueId=run.contextSnapshot.issueId, route=`/api/issues/${encodeURIComponent(issueId)}`;
const issue=await request(route);if(issue.spaceId!==spaceId || issue.assigneeAgentId!==agentId || !["todo","in_progress"].includes(issue.status))throw Error("task authority changed");
await request(`${route}/checkout`,"POST",{agentId,expectedStatuses:["todo","in_progress"]});
const body=`Scoped Slack useful reply for run ${runId}`;
const comment=await request(`${route}/comments`,"POST",{body});
if(comment.issueId!==issueId || comment.createdByRunId!==runId || comment.authorAgentId!==agentId || comment.body!==body)throw Error("useful result attribution changed");
const completed=await request(route,"PATCH",{status:"done"});
if(completed.id!==issueId || completed.spaceId!==spaceId || completed.status!=="done")throw Error("normal completion missing");
console.log(JSON.stringify({event:"scoped-useful-turn-completed",runId,issueId,commentId:comment.id}));
// Actual Codex CLI wire format, parsed by the normal adapter. The text is
// exactly the already-authorized run comment; normal presentation can reuse it.
console.log(JSON.stringify({type:"item.completed",item:{id:`controlled-final-${runId}`,type:"agent_message",text:body}}));
console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0}}));
