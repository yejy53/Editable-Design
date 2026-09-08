#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  return parseNodeArgs({
    args: argv,
    options: {
      help: { type: "boolean" },
      workspace: { type: "string" },
      map: { type: "string" },
      inspect: { type: "string" },
      "source-slide-count": { type: "string" },
      "no-report": { type: "boolean" },
    },
    allowPositionals: false,
    strict: true,
  }).values;
}

function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required --${key}`);
  return value;
}

const ALLOWED_ACTIONS = new Set(["rewrite", "rewrite-and-reposition", "replace", "delete", "keep", "fill-placeholder"]);
const PLACEHOLDER_HANDLING_ACTIONS = new Set([
  "rewrite",
  "rewrite-and-reposition",
  "replace",
  "delete",
  "fill-placeholder",
]);
const CONTENT_ROLE_PATTERN =
  /\b(synthesis|timeline|proof|summary|map|analysis|evidence|body|content|callout|comparison|metric|chart|table|arc|engine|expansion|technology|standards|portfolio|purpose|thesis)\b/i;
const PRESERVE_ONLY_ROLE_PATTERN = /\b(brand|logo|bumper|divider|separator|section|chrome|blank)\b/i;
const PLACEHOLDER_PATTERNS = [
  /^slide number$/i,
  /^date$/i,
  /^footer$/i,
  /^click to add (title|subtitle|text)$/i,
  /^(title|subtitle|name|text|body) goes here$/i,
  /^lorem ipsum\b/i,
  /\btemplate instruction\b/i,
];

function usage() {
  return [
    "Usage:",
    "  $RUNTIME_NODE template_following_scripts/validate_template_plan.mjs --workspace <dir> --map <template-frame-map.json> [options]",
    "",
    "Options:",
    "  --inspect <path>             template-inspect.ndjson. Defaults to <workspace>/template-inspect/template-inspect.ndjson.",
    "  --source-slide-count <n>     Optional source slide count check.",
    "  --no-report                  Validate without writing qa/template-plan-check.*.",
    "",
    "Validates a template-following frame map before starter deck creation.",
  ].join("\n");
}

function normalizeId(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function textOf(value) {
  if (!value || typeof value !== "object") return "";
  return String(
    value.textPreview ??
      value.text ??
      value.plainText ??
      value.rawText ??
      value.value ??
      value.content ??
      "",
  ).trim();
}

function firstString(value, keys) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return "";
}

function nameOf(value) {
  const keys = ["name", "shapeName", "shape_name", "label", "title", "objectName", "object_name"];
  return firstString(value, keys) || firstString(value?.raw, keys);
}

function placeholderLike(text) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function placeholderMetadataOf(value) {
  if (!value || typeof value !== "object") return undefined;
  const candidates = [value, value.raw].filter((candidate) => candidate && typeof candidate === "object");
  for (const candidate of candidates) {
    const explicitKeys = [
      "placeholder",
      "placeholderType",
      "placeholder_type",
      "placeholderKind",
      "placeholder_kind",
      "placeholderRole",
      "placeholder_role",
      "ph",
      "phType",
      "ph_type",
    ];
    for (const key of explicitKeys) {
      const item = candidate[key];
      if (item === undefined || item === null || item === false) continue;
      return { source: key, value: item === true ? "true" : item };
    }

    const type = firstString(candidate, ["type", "kind", "shapeType", "shape_type"]);
    if (/\bplaceholder\b/i.test(type)) return { source: "type", value: type };
  }

  const name = nameOf(value);
  if (/\bplaceholder\b/i.test(name)) return { source: "name", value: name };
  return undefined;
}

function placeholderDescription(record) {
  if (record.text) return `source text "${record.text}"`;
  const placeholder = record.placeholder;
  const name = record.name ? ` name="${record.name}"` : "";
  if (placeholder?.value && typeof placeholder.value === "object") {
    const type = placeholder.value.type || placeholder.value.placeholderType || placeholder.value.placeholder_type;
    const idx = placeholder.value.idx || placeholder.value.index || placeholder.value.placeholderIndex;
    return `structural placeholder${name}${type ? ` type="${type}"` : ""}${idx ? ` idx="${idx}"` : ""}`;
  }
  if (placeholder?.value) return `structural placeholder${name} ${placeholder.source}="${String(placeholder.value)}"`;
  return `structural placeholder${name}`;
}

function slideNumberFromObject(value, inherited) {
  if (!value || typeof value !== "object") return inherited;
  const directKeys = ["slide", "slideNumber", "slide_number", "sourceSlide", "page", "pageNumber"];
  for (const key of directKeys) {
    const n = Number(value[key]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const indexKeys = ["slideIndex", "slide_index", "pageIndex", "page_index"];
  for (const key of indexKeys) {
    const n = Number(value[key]);
    if (Number.isInteger(n) && n >= 0) return n + 1;
  }
  return inherited;
}

function idsFromObject(value) {
  if (!value || typeof value !== "object") return [];
  return [
    value.shapeId,
    value.shape_id,
    value.sourceElementId,
    value.source_element_id,
    value.elementId,
    value.element_id,
    value.objectId,
    value.object_id,
    value.id,
  ]
    .map(normalizeId)
    .filter(Boolean);
}

function flattenObjects(value, inheritedSlide, out) {
  if (!value || typeof value !== "object") return;
  const slide = slideNumberFromObject(value, inheritedSlide);
  const ids = idsFromObject(value);
  const text = textOf(value);
  const name = nameOf(value);
  const placeholder = placeholderMetadataOf(value);
  if (ids.length || text || placeholder) {
    out.push({ slide, ids, text, name, placeholder, raw: value });
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) flattenObjects(item, slide, out);
    } else if (child && typeof child === "object") {
      flattenObjects(child, slide, out);
    }
  }
}

async function readInspectInventory(inspectPath) {
  const text = await fs.readFile(inspectPath, "utf8");
  const records = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      flattenObjects(JSON.parse(line), undefined, records);
    } catch (error) {
      records.push({ slide: undefined, ids: [], text: "", parseError: `line ${index + 1}: ${error.message}` });
    }
  }

  const bySlide = new Map();
  const parseErrors = [];
  for (const record of records) {
    if (record.parseError) {
      parseErrors.push(record.parseError);
      continue;
    }
    if (!Number.isInteger(record.slide) || record.slide < 1) continue;
    if (!bySlide.has(record.slide)) bySlide.set(record.slide, { ids: new Set(), placeholders: [] });
    const slide = bySlide.get(record.slide);
    for (const id of record.ids) slide.ids.add(id);
    if (record.placeholder || (record.text && placeholderLike(record.text))) {
      slide.placeholders.push({
        ids: record.ids,
        text: record.text,
        name: record.name,
        placeholder: record.placeholder,
        description: placeholderDescription(record),
      });
    }
  }
  return { bySlide, parseErrors };
}

function targetIds(target) {
  return [
    ...asArray(target.shapeId),
    ...asArray(target.shapeIds),
    ...asArray(target.sourceElementId),
    ...asArray(target.sourceElementIds),
    ...asArray(target.elementId),
    ...asArray(target.elementIds),
  ]
    .map(normalizeId)
    .filter(Boolean);
}

function hasNewPrimitivePermission(target) {
  const zone = target.zone || target.bbox || target.bounds;
  const hasZone =
    zone &&
    typeof zone === "object" &&
    (["left", "top", "width", "height"].every((key) => Number.isFinite(Number(zone[key]))) ||
      ["x", "y", "w", "h"].every((key) => Number.isFinite(Number(zone[key]))));
  return (
    (target.newPrimitiveAllowed === true || target.newPrimitivesAllowed === true || target.allowed === true) &&
    target.mustNotOverlapInherited === true &&
    typeof target.reason === "string" &&
    target.reason.trim().length > 0 &&
    hasZone
  );
}

function issue(severity, id, message, context = {}) {
  return { severity, id, message, ...context };
}

export async function validateTemplatePlan(options) {
  const workspace = path.resolve(options.workspace);
  const mapPath = path.resolve(options.mapPath);
  const inspectPath = path.resolve(options.inspectPath || path.join(workspace, "template-inspect", "template-inspect.ndjson"));
  const sourceSlideCount =
    options.sourceSlideCount === undefined || options.sourceSlideCount === null
      ? undefined
      : Number(options.sourceSlideCount);
  const writeReport = options.writeReport !== false;
  const issues = [];

  const map = await readJson(mapPath);
  const inspectExists = await fs
    .stat(inspectPath)
    .then((stat) => stat.isFile())
    .catch(() => false);
  if (!inspectExists) {
    issues.push(
      issue(
        "fail",
        "missing-template-inspect",
        `Missing template inspection file: ${inspectPath}. Run inspect_template_deck.mjs before preparing the starter deck.`,
      ),
    );
  }

  const inventory = inspectExists ? await readInspectInventory(inspectPath) : { bySlide: new Map(), parseErrors: [] };
  for (const parseError of inventory.parseErrors) {
    issues.push(issue("fail", "invalid-template-inspect", `Could not parse ${parseError}.`, { inspectPath }));
  }

  if (!Array.isArray(map.outputSlides) || map.outputSlides.length === 0) {
    issues.push(issue("fail", "missing-output-slides", "template-frame-map.json must include a non-empty outputSlides array."));
  }

  const outputSlides = Array.isArray(map.outputSlides)
    ? [...map.outputSlides].sort((a, b) => Number(a.outputSlide) - Number(b.outputSlide))
    : [];

  for (let index = 0; index < outputSlides.length; index += 1) {
    const entry = outputSlides[index];
    const expectedOutputSlide = index + 1;
    const outputSlide = Number(entry.outputSlide);
    const sourceSlide = Number(entry.sourceSlide);
    const context = { outputSlide: entry.outputSlide, sourceSlide: entry.sourceSlide };

    if (!Number.isInteger(outputSlide) || outputSlide !== expectedOutputSlide) {
      issues.push(
        issue("fail", "nonsequential-output-slide", `Expected outputSlide ${expectedOutputSlide}.`, context),
      );
    }
    if (!Number.isInteger(sourceSlide) || sourceSlide < 1) {
      issues.push(issue("fail", "invalid-source-slide", "Each output slide must reference a positive sourceSlide.", context));
    } else if (Number.isInteger(sourceSlideCount) && sourceSlide > sourceSlideCount) {
      issues.push(
        issue("fail", "invalid-source-slide", `sourceSlide must be 1-${sourceSlideCount}; got ${sourceSlide}.`, context),
      );
    }
    if (entry.reuseMode !== "duplicate-slide") {
      issues.push(
        issue(
          "fail",
          "invalid-reuse-mode",
          `outputSlide ${outputSlide || expectedOutputSlide} must use reuseMode "duplicate-slide".`,
          context,
        ),
      );
    }
    if (typeof entry.narrativeRole !== "string" || entry.narrativeRole.trim().length === 0) {
      issues.push(issue("fail", "missing-narrative-role", "Each output slide must include narrativeRole.", context));
    }
    if (!Array.isArray(entry.editTargets)) {
      issues.push(issue("fail", "missing-edit-targets", "Each output slide must include editTargets as an array.", context));
      continue;
    }

    const handledIds = new Map();
    let addTargetCount = 0;
    let inheritedTargetCount = 0;
    const slideInventory = inventory.bySlide.get(sourceSlide);
    const role = entry.narrativeRole || "";
    if (
      entry.editTargets.length === 0 &&
      CONTENT_ROLE_PATTERN.test(role) &&
      !PRESERVE_ONLY_ROLE_PATTERN.test(role)
    ) {
      issues.push(
        issue(
          "fail",
          "preserve-only-content-role",
          `editTargets: [] means preserve-only, but narrativeRole "${role}" appears content-bearing.`,
          context,
        ),
      );
    }

    for (const [targetIndex, target] of entry.editTargets.entries()) {
      const targetContext = { ...context, targetIndex, target };
      if (!target || typeof target !== "object" || Array.isArray(target)) {
        issues.push(issue("fail", "invalid-edit-target", "Each edit target must be an object.", targetContext));
        continue;
      }
      const action = String(target.action || "").trim();
      if (!action) {
        issues.push(issue("fail", "missing-edit-action", "Each edit target must include action.", targetContext));
        continue;
      }
      if (action === "add") {
        addTargetCount += 1;
        if (!hasNewPrimitivePermission(target)) {
          issues.push(
            issue(
              "fail",
              "unresolved-add-target",
              'action: "add" is rejected by default. Map content to inherited shapeId/shapeIds or provide explicit newPrimitiveAllowed, zone, reason, and mustNotOverlapInherited.',
              targetContext,
            ),
          );
        }
        continue;
      }
      if (!ALLOWED_ACTIONS.has(action)) {
        issues.push(issue("fail", "unsupported-edit-action", `Unsupported edit action "${action}".`, targetContext));
      }

      const ids = targetIds(target);
      if (ids.length === 0) {
        issues.push(
          issue(
            "fail",
            "unresolved-edit-target",
            "Template edit targets must resolve to inherited shapeId/shapeIds or sourceElementId/sourceElementIds.",
            targetContext,
          ),
        );
        continue;
      }

      inheritedTargetCount += 1;
      for (const id of ids) {
        if (!handledIds.has(id)) handledIds.set(id, new Set());
        handledIds.get(id).add(action);
        if (slideInventory && slideInventory.ids.size > 0 && !slideInventory.ids.has(id)) {
          issues.push(
            issue("fail", "unknown-shape-id", `Referenced inherited shape id "${id}" was not found on source slide ${sourceSlide}.`, {
              ...targetContext,
              shapeId: id,
            }),
          );
        }
      }
    }

    if (addTargetCount > 0 && inheritedTargetCount === 0) {
      if (CONTENT_ROLE_PATTERN.test(role) && !PRESERVE_ONLY_ROLE_PATTERN.test(role)) {
        issues.push(
          issue(
            "fail",
            "add-only-content-slide",
            `narrativeRole "${role}" uses only action: "add"; map content to inherited template elements instead of building over a copied slide.`,
            context,
          ),
        );
      }
      if (PRESERVE_ONLY_ROLE_PATTERN.test(role)) {
        issues.push(
          issue(
            "fail",
            "add-on-preserve-only-slide",
            `narrativeRole "${role}" is preserve-only; do not turn brand/bumper/divider/blank slides into content canvases with action: "add".`,
            context,
          ),
        );
      }
    }

    if (slideInventory) {
      for (const placeholder of slideInventory.placeholders) {
        const ids = placeholder.ids.filter(Boolean);
        if (ids.length === 0) {
          issues.push(
            issue(
              "fail",
              "unresolved-template-placeholder",
              `${placeholder.description} was detected but has no resolved inherited shape id in template-inspect.ndjson.`,
              context,
            ),
          );
          continue;
        }
        const hasPlaceholderHandlingAction = ids.some((id) =>
          [...(handledIds.get(id) || [])].some((action) => PLACEHOLDER_HANDLING_ACTIONS.has(action)),
        );
        if (!hasPlaceholderHandlingAction) {
          issues.push(
            issue(
              "fail",
              "unhandled-placeholder",
              `${placeholder.description} must be assigned rewrite/rewrite-and-reposition/replace/delete/fill-placeholder in editTargets; keep and add do not satisfy inherited placeholder handling.`,
              { ...context, shapeIds: ids },
            ),
          );
        }
      }
    }
  }

  const status = issues.some((item) => item.severity === "fail")
    ? "fail"
    : issues.length > 0
      ? "warning"
      : "pass";
  const report = {
    status,
    checkedAt: new Date().toISOString(),
    workspace,
    mapPath,
    inspectPath,
    sourceSlideCount,
    issueCount: issues.length,
    issues,
  };

  if (writeReport) {
    const qaDir = path.join(workspace, "qa");
    await fs.mkdir(qaDir, { recursive: true });
    await writeJson(path.join(qaDir, "template-plan-check.json"), report);
    await fs.writeFile(
      path.join(qaDir, "template-plan-check.txt"),
      [
        `Template plan check: ${status}`,
        ...issues.map((item) =>
          `${item.severity.toUpperCase()} ${item.id}: ${item.message}` +
          (item.outputSlide ? ` outputSlide=${item.outputSlide}` : "") +
          (item.sourceSlide ? ` sourceSlide=${item.sourceSlide}` : ""),
        ),
        "",
      ].join("\n"),
      "utf8",
    );
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const workspace = path.resolve(requireArg(args, "workspace"));
  const report = await validateTemplatePlan({
    workspace,
    mapPath: requireArg(args, "map"),
    inspectPath: args.inspect,
    sourceSlideCount: args["source-slide-count"],
    writeReport: !args["no-report"],
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "fail") process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    console.error(usage());
    process.exit(1);
  });
}
