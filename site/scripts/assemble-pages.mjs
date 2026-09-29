import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.dirname(site);
const destination = path.join(repo, "site-dist");

// Publish only the blog export and the existing public gallery files.
// Do not recursively copy the repository into its own build output.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(site, "out"), destination, { recursive: true });
for (const name of ["index.html", "player.html", "assets", "gallery"]) {
  await cp(path.join(repo, name), path.join(destination, name), { recursive: true });
}
await writeFile(path.join(destination, ".nojekyll"), "");
console.log(`Assembled the blog and gallery in ${destination}`);
