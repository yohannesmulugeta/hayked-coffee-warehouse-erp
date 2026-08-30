import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist", "client");
const limitBytes = 500 * 1024;

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  }));
  return nested.flat();
}

const files = await javascriptFiles(root);
const sizes = await Promise.all(files.map(async (file) => ({ file, bytes: (await stat(file)).size })));
const oversized = sizes.filter((item) => item.bytes > limitBytes);
const largest = sizes.sort((left, right) => right.bytes - left.bytes)[0];

if (oversized.length) {
  for (const item of oversized) console.error(`${path.relative(root, item.file)} is ${(item.bytes / 1024).toFixed(1)} KB`);
  throw new Error("A client JavaScript bundle exceeds the 500 KB production budget.");
}

console.log(`Client bundle budget passed. Largest chunk: ${path.basename(largest.file)} (${(largest.bytes / 1024).toFixed(1)} KB).`);
