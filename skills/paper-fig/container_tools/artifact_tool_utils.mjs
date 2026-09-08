import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireRuntimeModule } from "./runtime_helpers.mjs";

export const PREFERRED_PRESENTATION_FONTS = Object.freeze([
  "Helvetica Neue", "Helvetica", "Arial", "Aptos",
]);

// Keep the public font registries, not a snapshot of their families. Registration
// may happen after this helper is imported. Codex App supplies @napi-rs/canvas;
// other runtimes also expose skia-canvas directly.
const runtimeFontLibraries = await Promise.all([
  requireRuntimeModule("skia-canvas")
    .then(({ FontLibrary }) => ({ families: () => FontLibrary?.families }))
    .catch((error) => ({ error })),
  requireRuntimeModule("@napi-rs/canvas")
    .then(({ GlobalFonts }) => ({
      families: () => GlobalFonts?.families?.map((entry) => entry?.family),
    }))
    .catch((error) => ({ error })),
]);

function runtimePresentationFonts() {
  const families = [];
  const errors = [];
  let discovered = false;
  for (const library of runtimeFontLibraries) {
    try {
      const inventory = library.families?.();
      if (Array.isArray(inventory)) {
        discovered = true;
        families.push(...inventory);
      } else if (library.error) errors.push(library.error);
    } catch (error) { errors.push(error); }
  }
  if (discovered) return families;
  throw new Error(
    "Cannot discover presentation fonts from the supplied runtime. Preserve the source/user font with sourceFont or fontFamily, or supply actual availableFonts.",
    { cause: new AggregateError(errors, "Runtime font inventory unavailable") },
  );
}

export function resolvePresentationFont(options = {}) {
  const explicitFont = options.sourceFont ?? options.fontFamily;
  if (explicitFont !== undefined) return fontFamily(explicitFont);
  const candidates = options.availableFonts ?? runtimePresentationFonts();
  if (!Array.isArray(candidates)) {
    throw new Error("availableFonts must be an array of installed font family names.");
  }
  const available = new Map(candidates
    .filter((family) => typeof family === "string" && family.trim())
    .map((family) => [family.trim().toLowerCase(), family.trim()]));
  const preferred = PREFERRED_PRESENTATION_FONTS.find((family) =>
    available.has(family.toLowerCase()));
  if (preferred) return available.get(preferred.toLowerCase());
  const other = [...available.values()].sort()[0];
  if (other) return other;
  throw new Error("No available presentation font families were reported. Supply an installed family or preserve the source/user font explicitly.");
}

/** Chart text does not inherit the font assigned to surrounding slide shapes. */
export function applyPresentationChartFont(chart, options = {}) {
  if (!chart || typeof chart !== "object") throw new Error("A native chart is required");
  const family = resolvePresentationFont(options);
  const styles = [chart.legend?.textStyle, chart.dataLabels?.textStyle,
    chart.xAxis?.textStyle, chart.yAxis?.textStyle];
  if (typeof chart.title === "string" && chart.title.trim()) {
    styles.push(chart.titleTextStyle);
  }
  for (const axis of [chart.xAxis, chart.yAxis]) {
    if (typeof axis?.title?.text === "string" && axis.title.text.trim()) {
      styles.push(axis.title.textStyle);
    }
  }
  if (!styles.some(Boolean)) throw new Error("Chart has no supported text-style facade");
  for (const style of styles) {
    if (style) style.typeface = family;
  }
  return chart;
}

/** Paragraph-object indentation uses EMU; paragraph spacing uses 1/100 pt. */
export function makeNativeBulletParagraphs(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0 ||
      items.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Native bullet items must be nonempty source-backed strings");
  }
  const allowed = new Set(["marginLeftPoints", "hangingPoints", "spaceAfterPoints", "bulletCharacter"]);
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).some((key) => !allowed.has(key))) {
    throw new Error("Use explicit point-based native bullet options");
  }
  const { marginLeftPoints = 18, hangingPoints = 9, spaceAfterPoints = 8,
    bulletCharacter = "•" } = options;
  if (![marginLeftPoints, hangingPoints, spaceAfterPoints].every((value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000) ||
    hangingPoints <= 0 || marginLeftPoints < hangingPoints ||
    typeof bulletCharacter !== "string" || [...bulletCharacter].length !== 1 || !bulletCharacter.trim()) {
    throw new Error("Invalid native bullet geometry or marker");
  }
  return items.map((item) => ({
    bulletCharacter,
    marginLeft: Math.round(marginLeftPoints * 12700),
    indent: -Math.round(hangingPoints * 12700),
    spaceAfter: Math.round(spaceAfterPoints * 100),
    runs: [item],
  }));
}

/** Ordinary requests use explicitTotalSlideCount; content-plus-cover is opt-in. */
export function resolvePresentationSlideCount(options = {}) {
  const kinds = [
    ["requestedContentSlideCount", "Requested content slide count"],
    ["explicitTotalSlideCount", "Explicit total slide count"],
    ["approvedFixedTemplateSlideCount", "Approved fixed-template slide count"],
  ];
  for (const [key, label] of kinds) {
    const value = options[key];
    if (value !== undefined &&
        (!Number.isSafeInteger(value) || value < 1 || value > 9999)) {
      throw new Error(`${label} must be a bounded positive integer`);
    }
  }
  if (options.explicitTotalSlideCount !== undefined &&
      options.approvedFixedTemplateSlideCount !== undefined &&
      options.explicitTotalSlideCount !== options.approvedFixedTemplateSlideCount) {
    throw new Error("Explicit total conflicts with the approved fixed-template slide count");
  }
  if (options.approvedFixedTemplateSlideCount !== undefined) {
    return options.approvedFixedTemplateSlideCount;
  }
  if (options.explicitTotalSlideCount !== undefined) return options.explicitTotalSlideCount;
  if (options.requestedContentSlideCount === undefined) return undefined;
  if (options.requestedContentSlideCount >= 9999) {
    throw new Error("Requested content slides and dedicated cover exceed the safe count limit");
  }
  return options.requestedContentSlideCount + 1;
}

const MAX_PRESENTATION_BYTES = 250 * 1024 * 1024;
const VALUE_FLAGS = new Map([
  ["--expected-aspect", /^\d{1,4}:\d{1,4}$/],
  ["--expected-slide-size-emu", /^\d{1,12},\d{1,12}$/],
  ["--expected-slide-count", /^[1-9]\d{0,3}$/],
  ["--require-native-table-slide", /^[1-9]\d{0,3}$/],
  ["--require-editorial-slide", /^[1-9]\d{0,3}$/],
  ["--approved-heading-slide", /^[1-9]\d{0,3}$/],
  ["--approved-bullet-slide", /^[1-9]\d{0,3}$/],
  ["--cover-role", /^(none|cover|explicit_hybrid)$/],
  ["--cover-word-limit", /^[1-9]\d{0,4}$/],
  ["--max-redundant-table-charts", /^\d{1,3}$/],
  ["--approved-redundant-chart-slide", /^[1-9]\d{0,3}$/],
  ["--max-content-prose-words", /^[1-9]\d{0,4}$/],
  ["--approved-dense-slide", /^[1-9]\d{0,3}$/],
  ["--approved-image-sha256", /^[a-fA-F0-9]{64}$/],
  ["--approved-icon-slide", /^[1-9]\d{0,3}$/],
  ["--approved-logo-sha256", /^[a-fA-F0-9]{64}$/],
  ["--max-logo-area", /^(?:0(?:\.\d{1,8})?|1(?:\.0{1,8})?)$/],
  ["--approved-logo-placement-slide", /^[1-9]\d{0,3}$/],
  ["--folio-mode", /^(none|actual_unpadded)$/],
]);
const BOOLEAN_FLAGS = new Set([
  "--allow-cover-chart",
  "--allow-cover-table",
  "--forbid-unapproved-decorative-icons",
  "--require-uniform-font-family",
  "--validate-bullet-geometry",
  "--validate-heading-fit",
  "--validate-heading-punctuation",
  "--require-logo-bottom-left",
]);

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return path.resolve(value);
}

function isInside(root, child) {
  const relative = path.relative(root, child);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

async function inspectRegularFile(file, label, { executable = false } = {}) {
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be an existing regular non-symlink file`);
  }
  if (executable && process.platform !== "win32") await fs.access(file, fsConstants.X_OK);
  return stat;
}

function fontFamily(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().startsWith("-") ||
      value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("A font family must be a bounded, nonempty name");
  }
  return value.trim();
}

/** Freeze actual task typography; a source exception is never inferred from output. */
export async function normalizePresentationFontPolicy(value, runtime = {}) {
  if (value === undefined) return { basis: "unspecified", families: [], scriptFonts: {} };
  const input = value;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Font policy must be an explicit object");
  }
  const keys = new Set(["basis", "families", "referencePath", "referenceSha256", "scriptFonts"]);
  if (Object.keys(input).some((key) => !keys.has(key))) {
    throw new Error("Unknown font-policy property");
  }
  const basis = input.basis ?? "default";
  if (!["default", "design", "user_request", "reference"].includes(basis)) {
    throw new Error("Font policy must name default, design, user_request, or reference basis");
  }
  let families;
  if (basis === "default") {
    if (input.families !== undefined) throw new Error("Default font must use the ordered installed-font resolver");
    families = [resolvePresentationFont()];
  } else {
    if (!Array.isArray(input.families) || input.families.length < 1 || input.families.length > 16) {
      throw new Error("Chosen typography needs explicit bounded font families");
    }
    families = [...new Set(input.families.map(fontFamily))];
  }
  let reference;
  if (basis === "reference") {
    const source = requireAbsolute(input.referencePath, "Typography reference");
    if (!/\.(pptx|pdf)$/iu.test(source) || !/^[a-f0-9]{64}$/u.test(input.referenceSha256 ?? "")) {
      throw new Error("Typography reference must be a SHA-bound PPTX or PDF");
    }
    const stat = await inspectRegularFile(source, "Typography reference");
    if (stat.size < 5 || stat.size > MAX_PRESENTATION_BYTES) throw new Error("Typography reference is not bounded");
    const bytes = await fs.readFile(source);
    const signatureValid = source.toLowerCase().endsWith(".pdf")
      ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
      : bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!signatureValid || createHash("sha256").update(bytes).digest("hex") !== input.referenceSha256) {
      throw new Error("Typography reference bytes differ from the approved source hash/type");
    }
    reference = { path: await fs.realpath(source), sha256: input.referenceSha256 };
    const python = requireAbsolute(runtime.pythonExecutable, "Reference-font inspection Python");
    await inspectRegularFile(await fs.realpath(python), "Reference-font inspection Python", { executable: true });
    const inspector = path.join(path.dirname(fileURLToPath(import.meta.url)), "inspect_presentation_layout_geometry.py");
    const checked = spawnSync(python, ["-B", inspector, reference.path, "--inspect-font-families"], {
      shell: false, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 60_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    if (checked.error || checked.signal || checked.status !== 0) {
      throw processFailure("reference-fonts", checked, "Cannot verify font families in the supplied PPTX/PDF reference");
    }
    let sourceFonts;
    try { sourceFonts = JSON.parse(checked.stdout); } catch {
      throw processFailure("reference-fonts", checked, "Invalid reference-font inspection result");
    }
    const normalized = (family) => {
      const name = family.trim().replace(/^[A-Z]{6}\+/u, "")
        .replace(/-(?:BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Roman)(?:MT)?$/iu, "")
        .replace(/[\s_-]+/gu, " ").toLowerCase();
      return ({ arialmt: "arial", helveticaneue: "helvetica neue" })[name] ?? name;
    };
    if (!Array.isArray(sourceFonts.normalized_font_families) ||
        families.some((family) => !sourceFonts.normalized_font_families.includes(normalized(family)))) {
      throw new Error("An approved font family is not used in the supplied typography reference");
    }
    reference.fontsVerifiedInEncodedText = true;
  } else if (input.referencePath !== undefined || input.referenceSha256 !== undefined) {
    throw new Error("Only reference typography may declare a source file");
  }
  const scripts = input.scriptFonts ?? {};
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts) ||
      Object.keys(scripts).some((script) => !["ea", "cs", "symbol"].includes(script))) {
    throw new Error("Script fallback is limited to ea, cs, or symbol glyphs");
  }
  const scriptFonts = Object.fromEntries(Object.entries(scripts).map(([script, family]) => [script, fontFamily(family)]));
  return { basis, families, scriptFonts, ...(reference ? { reference } : {}) };
}

function applyPresentationFontPolicy(policy, fontPolicy) {
  if (fontPolicy.basis === "unspecified") return;
  // Callers cannot bypass this with layoutArgs; only the validated task policy
  // supplies these flags. Script/source exceptions replace the old one-family test.
  if (fontPolicy.basis !== "default" || Object.keys(fontPolicy.scriptFonts).length) {
    for (let index = policy.length - 1; index >= 0; index -= 1) {
      if (policy[index] === "--require-uniform-font-family") policy.splice(index, 1);
    }
  }
  if (fontPolicy.basis === "default") {
    policy.push("--required-default-font-family", fontPolicy.families[0]);
  } else {
    for (const family of fontPolicy.families) policy.push("--approved-font-family", family);
  }
  for (const [script, family] of Object.entries(fontPolicy.scriptFonts)) {
    policy.push("--approved-script-font", `${script}=${family}`);
  }
}

function validateLayoutArgs(args) {
  if (!Array.isArray(args) || args.length > 96) {
    throw new Error("Layout policy must contain a bounded array of approved arguments");
  }
  const normalized = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (typeof flag !== "string") throw new Error("Layout policy arguments must be strings");
    if (BOOLEAN_FLAGS.has(flag)) {
      normalized.push(flag);
      continue;
    }
    const format = VALUE_FLAGS.get(flag);
    const value = args[index + 1];
    if (!format || typeof value !== "string" || !format.test(value)) {
      throw new Error(`Invalid or unsupported source-derived layout policy: ${flag}`);
    }
    normalized.push(flag, value);
    index += 1;
  }
  return normalized;
}

function normalizeCoverAndSlideCountPolicy(policy, options) {
  const roleIndexes = [];
  const countIndexes = [];
  for (let index = 0; index < policy.length; index += 1) {
    if (policy[index] === "--cover-role") roleIndexes.push(index);
    if (policy[index] === "--expected-slide-count") countIndexes.push(index);
  }
  if (roleIndexes.length > 1 || countIndexes.length > 1) {
    throw new Error("Cover role and expected slide count must not be declared more than once");
  }
  const role = roleIndexes.length ? policy[roleIndexes[0] + 1] : "none";
  if (roleIndexes.length === 0) policy.push("--cover-role", role);
  if ((policy.includes("--allow-cover-chart") || policy.includes("--allow-cover-table")) &&
      role !== "explicit_hybrid") {
    throw new Error("Cover charts and tables require an explicitly approved hybrid cover");
  }
  const count = resolvePresentationSlideCount(options);
  if (count !== undefined) {
    if (countIndexes.length && Number(policy[countIndexes[0] + 1]) !== count) {
      throw new Error("Expected slide count conflicts with content-plus-cover or explicit source total");
    }
    if (countIndexes.length === 0) policy.push("--expected-slide-count", String(count));
  }
  return policy;
}

function verifyRequiredNativeTableOwners(owners, layoutArgs) {
  if (owners === undefined) return;
  if (!Array.isArray(owners) || owners.length > 256 ||
      owners.some((owner) => !Number.isSafeInteger(owner) || owner < 1 || owner > 9999)) {
    throw new Error("Source-derived native-table owners must be bounded positive slide numbers");
  }
  const expected = new Set(owners);
  if (expected.size !== owners.length) {
    throw new Error("Source-derived native-table owners must not contain duplicate slides");
  }
  const declared = [];
  for (let index = 0; index < layoutArgs.length; index += 1) {
    if (layoutArgs[index] === "--require-native-table-slide") {
      declared.push(Number(layoutArgs[index + 1]));
      index += 1;
    }
  }
  if (declared.length !== expected.size || declared.some((owner) => !expected.has(owner)) ||
      new Set(declared).size !== expected.size) {
    throw new Error("Every source-required native-table owner must have exactly one validation policy");
  }
}

function normalizeRequiredSlideOwners(owners, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(owners) || owners.length > 256 || (!allowEmpty && owners.length === 0) ||
      owners.some((owner) => !Number.isSafeInteger(owner) || owner < 1 || owner > 9999)) {
    throw new Error(`${label} must contain bounded positive slide numbers`);
  }
  if (new Set(owners).size !== owners.length) {
    throw new Error(`${label} must not contain duplicate slide numbers`);
  }
  return [...owners];
}

function normalizeNativeChartPolicy(options) {
  const declared = options.requiredNativeChartOwnerSlides !== undefined;
  const exceptionsDeclared = options.approvedSourceFigureExceptionSlides !== undefined;
  const targetDeclared = options.nativeChartTargetApplication !== undefined;
  const durableDeclared = options.requiredEmbeddedWorkbookChartOwnerSlides !== undefined;
  if (!declared) {
    if (exceptionsDeclared || targetDeclared || durableDeclared) {
      throw new Error("Native-chart target, durability, and exceptions require explicit chart owners");
    }
    return undefined;
  }
  const owners = normalizeRequiredSlideOwners(
    options.requiredNativeChartOwnerSlides,
    "Source-approved native-chart owners",
    { allowEmpty: true },
  );
  const exceptions = exceptionsDeclared
    ? normalizeRequiredSlideOwners(
      options.approvedSourceFigureExceptionSlides,
      "Explicit user-approved source-figure exceptions",
      { allowEmpty: true },
    )
    : [];
  if (exceptions.some((slide) => !owners.includes(slide))) {
    throw new Error("An approved source-figure exception must target a declared native-chart owner");
  }
  let targetApplication;
  if (targetDeclared) {
    targetApplication = options.nativeChartTargetApplication;
    if (typeof targetApplication !== "string" ||
        !["portable", "powerpoint"].includes(targetApplication)) {
      throw new Error("Native-chart target must be explicitly portable or PowerPoint");
    }
  }
  const durableOwners = durableDeclared
    ? normalizeRequiredSlideOwners(
      options.requiredEmbeddedWorkbookChartOwnerSlides,
      "Explicit durable embedded-workbook chart owners",
      { allowEmpty: true },
    )
    : [];
  if (durableOwners.some((slide) => !owners.includes(slide))) {
    throw new Error("A durable embedded-workbook owner must target a declared native-chart slide");
  }
  return { owners, exceptions, targetApplication, durableOwners };
}

function normalizeTemplateSourcePolicy(options) {
  const sourceDeclared = options.sourceTemplatePath !== undefined;
  const referencesDeclared = options.requiredTemplateReferenceSlides !== undefined;
  const ratioDeclared = options.minimumTemplateCoverageRatio !== undefined;
  const flags = [
    ["requireExactTemplateDimensions", "--require-exact-dimensions"],
    ["requireTemplatePlaceholderGeometry", "--require-placeholder-geometry"],
    ["requirePhotographicBackground", "--require-photographic-background"],
  ];
  const explicitFlags = [];
  for (const [option, flag] of flags) {
    if (options[option] !== undefined) {
      if (typeof options[option] !== "boolean") {
        throw new Error("Source-derived template requirements must be explicit boolean values");
      }
      if (options[option]) explicitFlags.push(flag);
    }
  }
  const explicitCoverage = referencesDeclared || ratioDeclared;
  if (!explicitCoverage && explicitFlags.length === 0) return undefined;
  if (!sourceDeclared || !referencesDeclared || !ratioDeclared) {
    throw new Error("Template fidelity requires an approved source, reference slides, and an explicit ratio");
  }
  const references = referencesDeclared
    ? normalizeRequiredSlideOwners(
      options.requiredTemplateReferenceSlides,
      "Source-approved template reference slides",
    )
    : [];
  let ratio;
  if (ratioDeclared) {
    ratio = options.minimumTemplateCoverageRatio;
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1 ||
        references.length === 0) {
      throw new Error("Template coverage requires an explicit ratio from zero to one and reference slides");
    }
  }
  return {
    source: requireAbsolute(options.sourceTemplatePath, "Approved source template"),
    references,
    ratio,
    flags: explicitFlags,
  };
}

function processFailure(name, result, message = `${name} validator did not pass`) {
  let report;
  try { report = JSON.parse(result.stdout); } catch { /* Preserve non-JSON output below. */ }
  const details = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()]
    .filter(Boolean).join("\n");
  const error = new Error(`${message}${details ? `\n${details.slice(0, 8000)}` : ""}`, {
    cause: result.error,
  });
  error.code = "PRESENTATION_VALIDATION_FAILED";
  error.validator = name;
  error.exitCode = result.status;
  error.signal = result.signal;
  error.stdout = result.stdout ?? "";
  error.stderr = result.stderr ?? "";
  error.report = report;
  return error;
}

function reportFailure(name, report, message) {
  return processFailure(name, { status: 0, stdout: JSON.stringify(report) }, message);
}

function executeValidator(python, validator, candidate, args, name) {
  const result = spawnSync(python, ["-B", validator, candidate, "--fail-on-findings", ...args], {
    shell: false,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error || result.signal || result.status !== 0) {
    throw processFailure(name, result);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw processFailure(name, result, `${name} validator returned an invalid report`);
  }
  if (report.finding_count !== 0 || !Array.isArray(report.findings) || report.findings.length !== 0) {
    throw reportFailure(name, report, `${name} validator returned unresolved findings`);
  }
  const warnings = report.warnings ?? [];
  if (!Array.isArray(warnings) || warnings.some((warning) =>
    !warning || typeof warning !== "object" || typeof warning.kind !== "string")) {
    throw reportFailure(name, report, `${name} validator returned invalid review warnings`);
  }
  return { ...report, exitCode: result.status, findingCount: report.finding_count,
    warnings,
    ...(report.font_policy ? { fontPolicy: report.font_policy } : {}) };
}

function executeOptionalValidator(python, validator, args, name) {
  const result = spawnSync(python, ["-B", validator, ...args], {
    shell: false,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 90_000,
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error || result.signal || result.status !== 0) {
    throw processFailure(name, result);
  }
  try {
    return { exitCode: result.status, report: JSON.parse(result.stdout) };
  } catch {
    throw processFailure(name, result, `${name} validator returned an invalid report`);
  }
}

function normalizeTableArithmeticContracts(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) {
    throw new Error("Table arithmetic contracts must be a bounded array");
  }
  const keys = ["slide", "table", "label_column", "total_row", "value_columns", "component_rows"];
  return value.map((contract) => {
    if (!contract || typeof contract !== "object" || Array.isArray(contract) ||
        Object.keys(contract).length !== keys.length ||
        Object.keys(contract).some((key) => !keys.includes(key))) {
      throw new Error("Table arithmetic contracts must declare exactly the supported coordinates");
    }
    for (const [key, minimum, maximum] of [
      ["slide", 1, 10000], ["table", 1, 100], ["label_column", 0, 99], ["total_row", 0, 1999],
    ]) {
      if (!Number.isSafeInteger(contract[key]) || contract[key] < minimum || contract[key] > maximum) {
        throw new Error("Invalid table arithmetic coordinates");
      }
    }
    for (const [key, minimum, maximum, bound] of [
      ["value_columns", 1, 100, 99], ["component_rows", 2, 2000, 1999],
    ]) {
      const values = contract[key];
      if (!Array.isArray(values) || values.length < minimum || values.length > maximum ||
          values.some((index) => !Number.isSafeInteger(index) || index < 0 || index > bound) ||
          new Set(values).size !== values.length) {
        throw new Error("Invalid table arithmetic row or column list");
      }
    }
    if (contract.value_columns.includes(contract.label_column) ||
        contract.component_rows.some((row) => row >= contract.total_row)) {
      throw new Error("Arithmetic components must precede the total and exclude the label column");
    }
    return { ...contract, value_columns: [...contract.value_columns], component_rows: [...contract.component_rows] };
  });
}

function executeNativeTableArithmeticValidator(python, validator, candidate, contracts, slideCount) {
  const args = [candidate];
  for (const contract of contracts) args.push("--contract-json", JSON.stringify(contract));
  const { report } = executeOptionalValidator(python, validator, args, "native-table-arithmetic");
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (report.schema_version !== "presentation-native-table-arithmetic.v1" || report.passed !== true ||
      report.slide_count !== slideCount || !count(report.native_table_count) ||
      !count(report.eligible_table_count) || report.eligible_table_count > report.native_table_count ||
      !count(report.checked_column_count) || !Array.isArray(report.checks) ||
      report.checks.length !== report.checked_column_count ||
      report.checks.some((check) => typeof check.passed !== "boolean" ||
        (check.explicit_contract === true && check.passed !== true) || !count(check.component_count) ||
        check.component_count < 2 || !count(check.slide) || check.slide < 1 || check.slide > slideCount) ||
      !Array.isArray(report.skipped_tables) || report.finding_count !== 0 ||
      !Array.isArray(report.findings) || report.findings.length !== 0) {
    throw reportFailure("native-table-arithmetic", report,
      "Native-table arithmetic validator returned inconsistent coverage or unresolved totals");
  }
  return { performed: true, ...report };
}

function executeNativeChartTitleValidator(python, validator, candidate, discovered) {
  const { report } = executeOptionalValidator(python, validator, [candidate], "native-chart-titles");
  if (report.schema_version !== "presentation-native-chart-titles.v1" || report.passed !== true ||
      report.slide_count !== discovered.slideCount || report.native_chart_count !== discovered.count ||
      !/^[a-f0-9]{64}$/u.test(report.presentation_sha256 ?? "") ||
      !Array.isArray(report.checks) || report.checks.length !== discovered.count ||
      report.checks.some((check) => !["absent", "present", "linked_title_unresolved", "explicitly_suppressed"].includes(check.status)) ||
      report.finding_count !== 0 || !Array.isArray(report.findings) || report.findings.length !== 0 ||
      report.native_powerpoint_verified !== false || report.source_text_emitted !== false) {
    throw reportFailure("native-chart-titles", report,
      "Native chart-title validator returned inconsistent coverage or unresolved placeholders");
  }
  return { performed: true, ...report };
}

function executeNativeChartValidator(python, validator, candidate, policy) {
  const args = [candidate, "--expected-chart-slides", policy.owners.join(",")];
  if (policy.targetApplication !== undefined) {
    args.push("--target-application", policy.targetApplication);
  }
  for (const slide of policy.durableOwners) {
    args.push("--require-embedded-workbook-slide", String(slide));
  }
  for (const slide of policy.exceptions) {
    args.push("--approved-source-figure", String(slide));
  }
  const { exitCode, report } = executeOptionalValidator(
    python, validator, args, "native-quantitative-chart",
  );
  const expected = [...policy.owners].sort((left, right) => left - right);
  const actual = report.expected_quantitative_chart_slides;
  if (report.passed !== true || report.failed_slide_count !== 0 ||
      report.validated_slide_count !== expected.length || !Array.isArray(actual) ||
      actual.length !== expected.length || actual.some((slide, index) => slide !== expected[index]) ||
      !Array.isArray(report.results) || report.results.length !== expected.length ||
      report.results.some((item) => item.approved_source_figure_exception === true &&
        !policy.exceptions.includes(item.slide_number)) ||
      (policy.targetApplication === "powerpoint" &&
        report.target_application !== policy.targetApplication) ||
      (policy.durableOwners.length > 0 && (!Array.isArray(report.required_embedded_workbook_slides) ||
        report.required_embedded_workbook_slides.length !== policy.durableOwners.length ||
        report.required_embedded_workbook_slides.some((slide, index) =>
          slide !== [...policy.durableOwners].sort((left, right) => left - right)[index])))) {
    throw reportFailure("native-quantitative-chart", report,
      "native-quantitative-chart validator returned unresolved source-owner findings");
  }
  return {
    report,
    exitCode,
    validatedSlideCount: expected.length,
    requiredOwnerSlides: expected,
    approvedSourceFigureExceptionSlides: [...policy.exceptions].sort((left, right) => left - right),
    ...(policy.targetApplication === undefined
      ? {}
      : { targetApplication: policy.targetApplication }),
    ...(policy.durableOwners.length === 0
      ? {}
      : { requiredEmbeddedWorkbookChartOwnerSlides: [...policy.durableOwners].sort(
        (left, right) => left - right,
      ) }),
  };
}

function discoverActualNativeCharts(python, validator, candidate) {
  const { exitCode, report } = executeOptionalValidator(
    python, validator, [candidate, "--discover-chart-slides"],
    "actual-native-chart-discovery",
  );
  const owners = report.chart_owner_slides;
  const counts = report.chart_counts;
  if (exitCode !== 0 || report.schema_version !== "owner-private.actual-native-chart-discovery.v1" ||
      !Array.isArray(owners) || typeof counts !== "object" || counts === null ||
      !Number.isSafeInteger(report.chart_count) || report.chart_count < 0 ||
      owners.some((owner) => !Number.isSafeInteger(owner) || owner < 1) ||
      new Set(owners).size !== owners.length ||
      owners.some((owner, index) => index > 0 && owners[index - 1] >= owner) ||
      Object.keys(counts).length !== owners.length ||
      owners.some((owner) => !Number.isSafeInteger(counts[String(owner)]) ||
        counts[String(owner)] < 1) ||
      owners.reduce((sum, owner) => sum + counts[String(owner)], 0) !== report.chart_count ||
      report.source_attachments_accessed !== false ||
      report.source_required_chart_owners_inferred !== false) {
    throw reportFailure("actual-native-chart-discovery", report,
      "actual-native-chart-discovery returned malformed or unsafe findings");
  }
  if (!Number.isSafeInteger(report.slide_count) || report.slide_count < 1) {
    throw reportFailure("actual-native-chart-discovery", report, "Actual presentation slide count is missing");
  }
  return { owners, count: report.chart_count, slideCount: report.slide_count };
}

function verifyFirstPartyImport(candidate, expectedSlideCount) {
  const helperUrl = new URL("./runtime_helpers.mjs", import.meta.url).href;
  const script = `
    import fs from "node:fs/promises";
    import { createHash } from "node:crypto";
    const [helperUrl, source] = process.argv.slice(1);
    const { importRuntimeModule } = await import(helperUrl);
    const before = createHash("sha256").update(await fs.readFile(source)).digest("hex");
    const { PresentationFile, FileBlob } = await importRuntimeModule("@oai/artifact-tool");
    const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
    const after = createHash("sha256").update(await fs.readFile(source)).digest("hex");
    if (before !== after) throw new Error("Staged input changed during first-party import");
    process.stdout.write(JSON.stringify({ passed: true, slideCount: presentation.slides.items.length, sha256: after }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, helperUrl, candidate], {
    shell: false, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 90_000,
    windowsHide: true, env: process.env,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw processFailure("first-party-import", result,
      "Exact staged presentation failed first-party Artifact Tool import");
  }
  let report;
  try { report = JSON.parse(result.stdout); } catch {
    throw processFailure("first-party-import", result, "First-party importer returned an invalid report");
  }
  if (report.passed !== true || report.slideCount !== expectedSlideCount ||
      typeof report.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(report.sha256)) {
    throw reportFailure("first-party-import", report, "First-party import changed the expected slide inventory");
  }
  return { performed: true, ...report, runtimeNodeModules: process.env.RUNTIME_NODE_MODULES,
    nodeExecutable: process.execPath };
}

async function preparePortableChartData(python, packageDirectory, candidate, workspace, discovered, policy) {
  const helper = path.join(packageDirectory, "materialize_literal_chart_workbooks.py");
  await inspectRegularFile(helper, "Packaged literal-chart snapshot adapter");
  const staging = await fs.mkdtemp(path.join(workspace, ".chart-data-"));
  if (process.platform !== "win32") await fs.chmod(staging, 0o700);
  const prepared = path.join(staging, "candidate.pptx");
  const receiptPath = path.join(staging, "chart-data-snapshot.json");
  const args = [candidate, prepared, "--workspace", workspace, "--receipt", receiptPath];
  for (const slide of policy.durableOwners) {
    // An explicitly source-required workbook/formula cannot be replaced by a snapshot.
    args.push("--require-source-workbook-slide", String(slide));
    args.push("--require-source-formulas-slide", String(slide));
  }
  const { report } = executeOptionalValidator(python, helper, args, "chart-data-snapshot");
  const preparedStat = await inspectRegularFile(prepared, "Prepared chart-data presentation");
  const inputHash = createHash("sha256").update(await fs.readFile(candidate)).digest("hex");
  const preparedHash = createHash("sha256").update(await fs.readFile(prepared)).digest("hex");
  if (report.schema_version !== "experimental.literal-chart-workbook-snapshot.v1" ||
      report.conversion !== "chart_data_snapshot" || report.experimental !== true ||
      report.source_formulas_preserved !== false || report.source_workbook_preserved !== false ||
      report.new_formulas_describe_snapshot_only !== true ||
      report.input_sha256 !== inputHash || report.output_sha256 !== preparedHash ||
      report.output_bytes !== preparedStat.size || report.portable_chart_validation_passed !== true ||
      !Number.isSafeInteger(report.converted_chart_count) || report.converted_chart_count < 0 ||
      !Number.isSafeInteger(report.preserved_existing_workbook_chart_count) ||
      report.preserved_existing_workbook_chart_count < 0 ||
      report.converted_chart_count + report.preserved_existing_workbook_chart_count !== discovered.count ||
      JSON.stringify(report.detected_chart_owner_slides) !== JSON.stringify(discovered.owners) ||
      JSON.stringify(report.portable_validated_owner_slides) !== JSON.stringify(discovered.owners)) {
    throw reportFailure("chart-data-snapshot", report,
      "Chart-data snapshot did not preserve its exact data and provenance contract");
  }
  return { candidate: prepared, candidateStat: preparedStat, report };
}

function executeTemplateSourceValidator(python, validator, candidate, policy) {
  const args = [policy.source, candidate];
  for (const slide of policy.references) {
    args.push("--reference-slide", String(slide));
  }
  if (policy.ratio !== undefined) {
    args.push("--minimum-ratio", String(policy.ratio));
  }
  args.push(...policy.flags);
  const { exitCode, report } = executeOptionalValidator(
    python, validator, args, "template-source-fidelity",
  );
  if (report.schema_version !== "template_source_fidelity.v1" || report.passed !== true ||
      report.status !== "passed" || !Array.isArray(report.issue_codes) ||
      report.issue_codes.length !== 0 ||
      (policy.references.length > 0 && (!Number.isSafeInteger(report.reference_family_count) ||
        report.reference_family_count < 1 || report.reference_family_count > policy.references.length)) ||
      (policy.ratio !== undefined && (report.minimum_coverage_ratio !== policy.ratio ||
        typeof report.coverage_ratio !== "number" || report.coverage_ratio < policy.ratio))) {
    throw reportFailure("template-source-fidelity", report,
      "template-source-fidelity validator returned unresolved source-template findings");
  }
  return {
    report,
    exitCode,
    referenceFamilyCount: report.reference_family_count,
    matchedFamilyCount: report.matched_family_count,
    coverageRatio: report.coverage_ratio,
    minimumCoverageRatio: report.minimum_coverage_ratio,
  };
}

/**
 * Validate one staged presentation and atomically publish it without overwrite.
 * Paths, source-derived policies, and immutable validator locations are explicit.
 */
export async function finalizePresentation(options = {}) {
  for (const key of ["motionPolicy", "explanatoryMotion", "realWorldMotion", "verifiedStrokeMotion"]) {
    if (options[key] !== undefined) {
      throw new Error(`${key} is not supported by this presentation finalizer. Motion requires a separate supported workflow and validation.`);
    }
  }
  const workspacePath = requireAbsolute(options.workspaceDir, "Workspace");
  const workspaceStat = await fs.lstat(workspacePath).catch(() => undefined);
  if (!workspaceStat || !workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
    throw new Error("Workspace must be an existing non-symlink directory");
  }
  const workspace = await fs.realpath(workspacePath);
  const candidatePath = requireAbsolute(options.candidatePath, "Candidate presentation");
  const finalPath = requireAbsolute(options.finalPath, "Final presentation");
  if (!candidatePath.toLowerCase().endsWith(".pptx") || !finalPath.toLowerCase().endsWith(".pptx")) {
    throw new Error("Candidate and final presentation must both use the .pptx extension");
  }
  let candidateStat = await inspectRegularFile(candidatePath, "Candidate presentation");
  let candidate = await fs.realpath(candidatePath);
  if (!isInside(workspace, candidate) || candidateStat.size < 1 || candidateStat.size > MAX_PRESENTATION_BYTES) {
    throw new Error("Candidate presentation must be a bounded regular file inside its task workspace");
  }
  const parent = await fs.realpath(path.dirname(finalPath)).catch(() => undefined);
  const canonicalFinal = parent ? path.join(parent, path.basename(finalPath)) : undefined;
  if (!parent || !(parent === workspace || isInside(workspace, parent)) ||
      !canonicalFinal || !isInside(workspace, canonicalFinal)) {
    throw new Error("Final presentation must remain inside the real task workspace");
  }
  if (candidate === canonicalFinal) throw new Error("Candidate presentation must be staged separately");
  const originalCandidate = candidate;
  const originalCandidateStat = candidateStat;
  const originalCandidateHash = createHash("sha256").update(await fs.readFile(candidate)).digest("hex");
  if (await fs.lstat(finalPath).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  })) {
    throw new Error("Final presentation already exists and cannot be overwritten");
  }

  const integrity = requireAbsolute(options.integrityValidatorPath, "Package-integrity validator");
  const layout = requireAbsolute(options.layoutValidatorPath, "Presentation-layout validator");
  if (path.basename(integrity) !== "inspect_presentation_package_integrity.py" ||
      path.basename(layout) !== "inspect_presentation_layout_geometry.py") {
    throw new Error("Unexpected presentation validator filenames");
  }
  await inspectRegularFile(integrity, "Package-integrity validator");
  await inspectRegularFile(layout, "Presentation-layout validator");
  if (path.dirname(await fs.realpath(integrity)) !== path.dirname(await fs.realpath(layout))) {
    throw new Error("Presentation validators must come from the same immutable package");
  }
  const pythonPath = requireAbsolute(options.pythonExecutable, "Python executable");
  // Resolving the invocation path would bypass virtualenv/bundled environments.
  const python = pythonPath;
  await inspectRegularFile(await fs.realpath(python), "Python executable", { executable: true });
  const policy = normalizeCoverAndSlideCountPolicy(
    validateLayoutArgs(options.layoutArgs ?? []), options,
  );
  const fontPolicy = await normalizePresentationFontPolicy(options.fontPolicy, { pythonExecutable: python });
  if (fontPolicy.reference && [candidate, canonicalFinal].includes(fontPolicy.reference.path)) {
    throw new Error("A generated presentation cannot approve its own typography");
  }
  applyPresentationFontPolicy(policy, fontPolicy);
  verifyRequiredNativeTableOwners(options.requiredNativeTableOwnerSlides, policy);
  let chartPolicy = normalizeNativeChartPolicy(options);
  const sourceChartOwnersDeclared = chartPolicy !== undefined;
  const templatePolicy = normalizeTemplateSourcePolicy(options);
  const packageDirectory = path.dirname(await fs.realpath(integrity));
  const ownPackageDirectory = await fs.realpath(path.dirname(fileURLToPath(import.meta.url)));
  if (packageDirectory !== ownPackageDirectory) {
    throw new Error("Finalizer and validators must come from the same immutable skill package");
  }
  const chartValidator = path.join(packageDirectory, "native_quantitative_chart_gate.py");
  const chartTitleValidator = path.join(packageDirectory, "native_chart_title_gate.py");
  await inspectRegularFile(chartTitleValidator, "Packaged native-chart title validator");
  const tableArithmeticValidator = path.join(packageDirectory, "native_table_arithmetic_gate.py");
  await inspectRegularFile(tableArithmeticValidator, "Packaged native-table arithmetic validator");
  const tableArithmeticContracts = normalizeTableArithmeticContracts(options.tableArithmeticContracts);
  if (options.materializeLiteralChartWorkbooks !== undefined &&
      typeof options.materializeLiteralChartWorkbooks !== "boolean") {
    throw new Error("Literal-chart snapshot setting must be an explicit boolean");
  }
  if (options.verifyArtifactToolImport !== undefined && typeof options.verifyArtifactToolImport !== "boolean") {
    throw new Error("First-party import setting must be an explicit boolean");
  }
  let templateValidator;
  await inspectRegularFile(chartValidator, "Packaged native-quantitative-chart validator");
  if (templatePolicy !== undefined) {
    if (!templatePolicy.source.toLowerCase().endsWith(".pptx")) {
      throw new Error("The approved source template must be an existing PowerPoint file");
    }
    await inspectRegularFile(templatePolicy.source, "Approved source template");
    templatePolicy.source = await fs.realpath(templatePolicy.source);
    if ([candidate, canonicalFinal].includes(templatePolicy.source)) {
      throw new Error("A generated presentation cannot approve its own template fidelity");
    }
    templatePolicy.sha256 = createHash("sha256").update(await fs.readFile(templatePolicy.source)).digest("hex");
    templateValidator = path.join(packageDirectory, "template_source_fidelity_gate.py");
    await inspectRegularFile(templateValidator, "Packaged template-source-fidelity validator");
  }

  // Reject malformed packages before chart traversal or any opt-in conversion.
  let integrityResult = executeValidator(python, integrity, candidate, [], "package-integrity");
  const discoveredCharts = discoverActualNativeCharts(python, chartValidator, candidate);
  if (chartPolicy === undefined && discoveredCharts.owners.length > 0) {
    chartPolicy = {
      owners: discoveredCharts.owners,
      exceptions: [],
      targetApplication: undefined,
      durableOwners: [],
    };
  }
  if (chartPolicy !== undefined) {
    // A source-owner subset must never exempt other charts actually present in the file.
    chartPolicy.owners = [...new Set([...chartPolicy.owners, ...discoveredCharts.owners])]
      .sort((left, right) => left - right);
  }
  let chartDataPackaging;
  let chartResult;
  if (discoveredCharts.count > 0 && chartPolicy?.targetApplication !== "powerpoint" &&
      options.materializeLiteralChartWorkbooks === true) {
    try {
      // Healthy workbook-backed charts need neither repackaging nor changed bytes.
      chartResult = executeNativeChartValidator(python, chartValidator, candidate, chartPolicy);
    } catch (error) {
      if (error.code !== "PRESENTATION_VALIDATION_FAILED" || error.validator !== "native-quantitative-chart") {
        throw error;
      }
      // The adapter itself rejects broken references and source-required lineage;
      // only complete literal data can be converted into an honest new snapshot.
      const prepared = await preparePortableChartData(
        python, packageDirectory, candidate, workspace, discoveredCharts, chartPolicy,
      );
      candidate = prepared.candidate;
      candidateStat = prepared.candidateStat;
      chartDataPackaging = prepared.report;
    }
  }
  if (chartDataPackaging !== undefined) {
    integrityResult = executeValidator(python, integrity, candidate, [], "package-integrity");
  }
  const validationHash = createHash("sha256").update(await fs.readFile(candidate)).digest("hex");
  const chartTitleResult = executeNativeChartTitleValidator(python, chartTitleValidator, candidate, discoveredCharts);
  const layoutResult = executeValidator(python, layout, candidate, policy, "presentation-layout");
  if (fontPolicy.basis !== "unspecified" &&
      (layoutResult.fontPolicy?.performed !== true || layoutResult.fontPolicy?.passed !== true)) {
    throw reportFailure("presentation-layout", layoutResult, "Delivered typography was not validated");
  }
  // Unconditional: source-declared contracts add coverage, never replace the
  // discovery of plainly additive totals in the actual delivered native tables.
  const tableArithmeticResult = executeNativeTableArithmeticValidator(
    python, tableArithmeticValidator, candidate, tableArithmeticContracts, discoveredCharts.slideCount,
  );
  if (chartResult === undefined && chartPolicy !== undefined && chartPolicy.owners.length > 0) {
    chartResult = executeNativeChartValidator(python, chartValidator, candidate, chartPolicy);
  }
  const templateResult = templatePolicy === undefined
    ? undefined
    : executeTemplateSourceValidator(python, templateValidator, candidate, templatePolicy);
  const firstPartyImport = options.verifyArtifactToolImport === false
    ? { performed: false, passed: null, reason: "explicitly_not_requested" }
    : verifyFirstPartyImport(candidate, discoveredCharts.slideCount);
  if (fontPolicy.reference && createHash("sha256").update(
    await fs.readFile(fontPolicy.reference.path),
  ).digest("hex") !== fontPolicy.reference.sha256) {
    throw new Error("Approved typography reference changed during finalization");
  }
  if (templatePolicy && createHash("sha256").update(
    await fs.readFile(templatePolicy.source),
  ).digest("hex") !== templatePolicy.sha256) {
    throw new Error("Approved source template changed during finalization");
  }
  const originalAfter = await fs.lstat(originalCandidate);
  if (!originalAfter.isFile() || originalAfter.isSymbolicLink() ||
      originalAfter.ino !== originalCandidateStat.ino || originalAfter.size !== originalCandidateStat.size ||
      originalAfter.mtimeMs !== originalCandidateStat.mtimeMs ||
      createHash("sha256").update(await fs.readFile(originalCandidate)).digest("hex") !== originalCandidateHash) {
    throw new Error("Original presentation changed during finalization");
  }
  const beforePublish = await fs.lstat(candidate);
  if (!beforePublish.isFile() || beforePublish.isSymbolicLink() ||
      beforePublish.ino !== candidateStat.ino || beforePublish.size !== candidateStat.size ||
      beforePublish.mtimeMs !== candidateStat.mtimeMs ||
      createHash("sha256").update(await fs.readFile(candidate)).digest("hex") !== validationHash) {
    throw new Error("Candidate presentation changed during validation");
  }
  const stage = path.join(parent, `.${path.basename(finalPath)}.${randomUUID()}.validated`);
  const receiptRequested = options.receiptPath
    ? requireAbsolute(options.receiptPath, "Private validation receipt")
    : path.join(path.dirname(candidate), `.${path.basename(finalPath)}.validation.json`);
  const receiptParent = await fs.realpath(path.dirname(receiptRequested)).catch(() => undefined);
  const receiptPath = receiptParent
    ? path.join(receiptParent, path.basename(receiptRequested))
    : undefined;
  if (!receiptParent || !receiptPath || !isInside(workspace, receiptPath) ||
      receiptParent === parent || isInside(parent, receiptParent)) {
    throw new Error("Private validation receipt must stay inside the task workspace and outside final output");
  }
  let published = false;
  let stagedIdentity;
  try {
    await fs.copyFile(candidate, stage, fsConstants.COPYFILE_EXCL);
    if (process.platform !== "win32") await fs.chmod(stage, 0o600);
    stagedIdentity = await fs.lstat(stage);
    const bytes = await fs.readFile(stage);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== validationHash) {
      throw new Error("Prepared presentation differs from its validated bytes");
    }
    if (firstPartyImport.performed && firstPartyImport.sha256 !== sha256) {
      throw new Error("Prepared presentation differs from the first-party imported bytes");
    }
    if (chartTitleResult.presentation_sha256 !== sha256) {
      throw new Error("Prepared presentation differs from its chart-title validated bytes");
    }
    await fs.link(stage, finalPath);
    published = true;
    const finalBytes = await fs.readFile(finalPath);
    if (createHash("sha256").update(finalBytes).digest("hex") !== sha256) {
      throw new Error("Published presentation hash differs from its validated staged bytes");
    }
    const receipt = {
      schemaVersion: "presentation-finalization.v1",
      finalSha256: sha256,
      byteCount: bytes.byteLength,
      packageIntegrity: integrityResult,
      presentationLayout: layoutResult,
      fontSelection: {
        basis: fontPolicy.basis,
        approvedFamilies: fontPolicy.families,
        scriptFonts: fontPolicy.scriptFonts,
        referenceSha256: fontPolicy.reference?.sha256 ?? null,
        referenceFontsVerifiedInEncodedText: fontPolicy.reference?.fontsVerifiedInEncodedText ?? false,
        ...layoutResult.fontPolicy,
      },
      firstPartyImport,
      nativeTableArithmetic: tableArithmeticResult,
      nativeChartTitles: chartTitleResult,
      sourceDerivedPolicyFlags: policy,
      nativeChartValidation: {
        detectedOwnerSlides: discoveredCharts.owners,
        detectedChartCount: discoveredCharts.count,
        targetApplication: chartPolicy === undefined
          ? null
          : chartPolicy.targetApplication ?? "portable",
        sourceChartOwnersExplicitlyDeclared: sourceChartOwnersDeclared,
        validatorRan: chartResult !== undefined,
        passed: chartResult === undefined ? discoveredCharts.count === 0 : chartResult.exitCode === 0,
      },
      ...(chartResult === undefined ? {} : { nativeQuantitativeCharts: chartResult }),
      ...(chartDataPackaging === undefined ? {} : { chartDataPackaging }),
      ...(templateResult === undefined ? {} : { sourceTemplateFidelity: {
        ...templateResult, sourceSha256: templatePolicy.sha256,
      } }),
    };
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return { finalPath, receiptPath, ...receipt };
  } catch (error) {
    if (published) {
      const current = await fs.lstat(finalPath).catch(() => undefined);
      // Do not remove a user save or other file that replaced our published link.
      if (current?.isFile() && !current.isSymbolicLink() &&
          current.dev === stagedIdentity.dev && current.ino === stagedIdentity.ino) {
        await fs.unlink(finalPath).catch(() => {});
      }
    }
    throw error;
  } finally {
    await fs.unlink(stage).catch(() => {});
  }
}
