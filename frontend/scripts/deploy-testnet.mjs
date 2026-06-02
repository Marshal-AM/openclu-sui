import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Prefer main package dir; on Windows if Move.lock is locked, copy sources to ../contracts/openclu_skill_publish (no lock) and publish there.
const contractDir = resolve(frontendRoot, "../contracts/openclu_skill");
const outDir = resolve(frontendRoot, "deployments");

console.log(`Publishing openclu_skill from ${contractDir}`);
console.log("(Requires ~0.2 SUI gas; package must be v1 for Seal encryption.)");
const result = spawnSync("sui", ["client", "publish", "--gas-budget", "200000000", "--json"], {
  cwd: contractDir,
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});

if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(1);
}

const json = JSON.parse(result.stdout);
const packageId = json.objectChanges?.find((c) => c.type === "published")?.packageId;
if (!packageId) {
  console.error("Could not find packageId in publish output");
  process.exit(1);
}

const deployer = json.transaction?.data?.sender ?? "";
const deployment = {
  network: "testnet",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  deployer,
  publishedAt: new Date().toISOString(),
  packageId,
  publishDigest: json.digest,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "testnet.json"), `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify(deployment, null, 2));
console.log("\nSet NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID=" + packageId);
