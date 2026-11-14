import {canonicalSpaceSecretKey,validSpaceSecretMetadata} from "./external-space-secret-confirmation.js";
import { readFile } from "node:fs/promises";
import { chromium, type Page } from "@playwright/test";
import { stripTypeScriptTypes } from "node:module";
import { expect, it } from "vitest";

it.skipIf(process.env.OUTPOST_CHAT_EVAL_SECRET_ROUTE_CANARY !== "1")("waits for the actual space create form to close while its details sheet stays open", async () => {
  const source = await readFile(new URL("./external-private-browser-worker.ts", import.meta.url), "utf8");
  const start = source.indexOf('    if(input.mode === "space-secret-create"){');
  const end = source.indexOf('    if (input.mode === "gateway-token-rotation")', start);
  expect(start >= 0 && end > start).toBe(true);
  const code = stripTypeScriptTypes(`async function operation(input:any,page:any){${source.slice(start, end)}}`);
  const operation = new Function("validSpaceSecretMetadata","canonicalSpaceSecretKey",`${code};return operation`)(validSpaceSecretMetadata,canonicalSpaceSecretKey) as (input: unknown, page: Page) => Promise<{ secretId: string; storageClean: boolean }>;
  const ui = await readFile(new URL("../../../ui/src/pages/Secrets.tsx", import.meta.url), "utf8");
  expect(ui).toContain('<DialogTitle>{editingDefinition ? "Edit user-provided secret" : "Create secret"}</DialogTitle>');
  expect(ui).toContain("setCreateOpen(false)");
  expect(ui).toContain("setDetailSelection(result.item.id)");
  const browser = await chromium.launch({ headless: true, ...(process.env.OUTPOST_RUNNER_E2E_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OUTPOST_RUNNER_E2E_CHROMIUM_EXECUTABLE } : {}) });
  const spaceId = "11111111-1111-4111-8111-111111111111", secretId = "22222222-2222-4222-8222-222222222222";
  try {
    for (const scenario of ["created", "requested metadata", "wrong stored metadata", "failed POST", "missing form"]) {
      const page = await browser.newPage(); page.setDefaultTimeout(700);
      const spaceMetadata=scenario==="requested metadata"||scenario==="wrong stored metadata"?{name:"Deployment API Key",key:"DEPLOYMENT_API_KEY"}:undefined,expectedName=spaceMetadata?.name??"Deployment API key";
      await page.route("**/*", async route => {
        if (route.request().method() === "POST") {const posted=route.request().postDataJSON();return route.fulfill({ status: scenario === "failed POST" ? 400 : 201, contentType: "application/json", body: JSON.stringify({ id:secretId,spaceId,name:posted.name,key:scenario==="wrong stored metadata"?"other-key":canonicalSpaceSecretKey(posted.key),scope:"space",status:"active" }) });}
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<button onclick="${scenario === "missing form" ? "" : "document.querySelector('#create').hidden=false"}">New secret</button><section id="create" role="dialog" aria-labelledby="create-title" hidden><h2 id="create-title">Create secret</h2><label for="new-secret-name">Name</label><input id="new-secret-name" oninput="if(!window.keyDirty)document.querySelector('#new-secret-key').value=this.value.toLowerCase().replaceAll(' ','-')"><label for="new-secret-key">Key</label><input id="new-secret-key" readonly><button onclick="window.keyDirty=true;document.querySelector('#new-secret-key').readOnly=false">Edit</button><label for="new-secret-provider">Provider</label><select id="new-secret-provider"><option value="local_encrypted">Encrypted</option></select><label for="new-secret-value">Value</label><textarea id="new-secret-value"></textarea><button onclick="fetch('/api/spaces/${spaceId}/secrets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.querySelector('#new-secret-name').value,key:document.querySelector('#new-secret-key').value})}).then(r=>{if(r.status===201){document.querySelector('#create').remove();document.querySelector('#details').hidden=false}})">Create secret</button></section><section id="details" role="dialog" aria-labelledby="details-title" hidden><h2 id="details-title">${expectedName}</h2></section>` });
      });
      const result = operation({ mode: "space-secret-create", spaceId, setupURL: "http://127.0.0.1:3300/RUN/space/settings/secrets", credential: "synthetic-private-value",spaceMetadata }, page);
      if (scenario === "created"||scenario==="requested metadata") {
        expect(await result).toMatchObject({ secretId, storageClean: true,...(spaceMetadata?{requestedSpaceName:"Deployment API Key",requestedSpaceKey:"DEPLOYMENT_API_KEY",savedSpaceName:"Deployment API Key",savedSpaceKey:"deployment_api_key"}:{}) });
        expect(await page.getByRole("dialog", { name: expectedName, exact: true }).isVisible()).toBe(true);
      } else await expect(result).rejects.toThrow();
      await page.close();
    }
  } finally { await browser.close(); }
}, 15000);
it("admits canonical Space metadata only through the actual closed receipt guard",async()=>{
 const source=await readFile(new URL("./external-private-browser.ts",import.meta.url),"utf8"),start=source.indexOf("    if (receipt.processIsolation"),end=source.indexOf('    if (input.mode === "gateway-token-rotation")',start);
 expect(start>=0&&end>start).toBe(true);
 const code=stripTypeScriptTypes(`function validate(input:any,receipt:any){${source.slice(start,end)};return receipt;}`),validate=new Function("validSpaceSecretMetadata","canonicalSpaceSecretKey",`${code};return validate`)(validSpaceSecretMetadata,canonicalSpaceSecretKey) as (input:unknown,receipt:unknown)=>unknown;
 const input={mode:"space-secret-create",spaceMetadata:{name:"Deployment API Key",key:"DEPLOYMENT_API_KEY"}},receipt={processIsolation:true,testRunnerAttached:false,tracingEnabled:false,videoEnabled:false,apiStepRecorder:false,secretUiVisible:true,humanSubmittedSecurely:true,storageClean:true,requestedSpaceName:"Deployment API Key",requestedSpaceKey:"DEPLOYMENT_API_KEY",savedSpaceName:"Deployment API Key",savedSpaceKey:"deployment_api_key"};
 expect(validate(input,receipt)).toBe(receipt);
 for(const bad of [{...receipt,savedSpaceKey:"other"},{...receipt,requestedSpaceName:"different"},{...receipt,humanSubmittedSecurely:false},{...receipt,privateValue:"not permitted"}])expect(()=>validate(input,bad)).toThrow();
 expect(()=>validate({mode:"personal-secret-create"},receipt)).toThrow();
});
