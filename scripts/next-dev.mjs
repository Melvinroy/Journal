import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const forwarded = process.argv.slice(2);
const nextArgs = ["dev"];

for (let index = 0; index < forwarded.length; index += 1) {
  const argument = forwarded[index];
  if (argument === "--host") {
    nextArgs.push("--hostname", forwarded[index + 1]);
    index += 1;
  } else if (argument !== "--strictPort") {
    nextArgs.push(argument);
  }
}

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextCli, ...nextArgs], { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
