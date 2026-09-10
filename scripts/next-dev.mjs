import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getPreviewIdentity } from "./preview-identity.mjs";

const forwarded = process.argv.slice(2);
const nextArgs = ["dev"];
let hostname = "localhost";
let port = "3000";

for (let index = 0; index < forwarded.length; index += 1) {
  const argument = forwarded[index];
  if (argument === "--host") {
    hostname = forwarded[index + 1];
    nextArgs.push("--hostname", hostname);
    index += 1;
  } else if (argument === "--hostname") {
    hostname = forwarded[index + 1];
    nextArgs.push(argument, hostname);
    index += 1;
  } else if (argument === "--port" || argument === "-p") {
    port = forwarded[index + 1];
    nextArgs.push(argument, port);
    index += 1;
  } else if (argument !== "--strictPort") {
    nextArgs.push(argument);
  }
}

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const identity = getPreviewIdentity(fileURLToPath(new URL("../", import.meta.url)));
const reviewHost = ["0.0.0.0", "::"].includes(hostname) ? "localhost" : hostname;
const reviewUrl = `http://${reviewHost}:${port}/?demo=1`;
console.log(`[preview] checkout ${identity.checkout}`);
console.log(`[preview] branch ${identity.branch} · revision ${identity.identifier}`);
console.log(`[preview] review ${reviewUrl}`);
const child = spawn(process.execPath, [nextCli, ...nextArgs], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_BRONTIDE_PREVIEW_ID: identity.identifier },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
