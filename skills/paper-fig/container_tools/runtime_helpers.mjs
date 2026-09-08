import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runtimeNodeModules() {
  const nodeModules = process.env.RUNTIME_NODE_MODULES;
  if (!nodeModules) throw new Error("RUNTIME_NODE_MODULES is required.");
  if (!path.isAbsolute(nodeModules)) {
    throw new Error("RUNTIME_NODE_MODULES must be an absolute path.");
  }
  const stat = await fs.stat(nodeModules).catch(() => undefined);
  if (!stat?.isDirectory()) {
    throw new Error(`RUNTIME_NODE_MODULES is not a directory: ${nodeModules}`);
  }
  return nodeModules;
}

async function runtimeRequire() {
  const nodeModules = await runtimeNodeModules();
  return {
    nodeModules,
    requireFromRuntime: createRequire(path.join(nodeModules, "__runtime__.cjs")),
  };
}

export async function requireRuntimeModule(packageName) {
  const { nodeModules, requireFromRuntime } = await runtimeRequire();
  try {
    return requireFromRuntime(packageName);
  } catch (error) {
    throw new Error(`Could not resolve ${packageName} from RUNTIME_NODE_MODULES: ${nodeModules}`, {
      cause: error,
    });
  }
}

export async function importRuntimeModule(packageName) {
  const { nodeModules, requireFromRuntime } = await runtimeRequire();
  let entrypoint;
  try {
    entrypoint = requireFromRuntime.resolve(packageName);
  } catch (error) {
    throw new Error(`Could not resolve ${packageName} from RUNTIME_NODE_MODULES: ${nodeModules}`, {
      cause: error,
    });
  }
  return import(pathToFileURL(entrypoint).href);
}
