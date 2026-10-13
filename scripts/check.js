// Syntax-checks every .js file in the API without running it. Usage: npm run check
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = ["server", "scripts", "shared"].flatMap(walk).filter((f) => f.endsWith(".js"));
for (const f of files) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
console.log(`${files.length} files OK`);
