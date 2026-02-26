require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { parseResumeUpload } = require("./src/resumeParser");
const { analyzeResumeAgainstJob } = require("./src/atsScorer");
const {
  generateOptimizedResumeDraft,
  buildEditableLineCandidates,
  applyLineEditsPreservingLayout,
  generateSupplementalPointProposals,
} = require("./src/aiOptimizer");

const execFileAsync = promisify(execFile);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const downloadStore = new Map();
const draftStore = new Map();
const TMP_ROOT = path.join(__dirname, "tmp");
const GENERATED_DIR = path.join(TMP_ROOT, "generated");
fs.mkdirSync(GENERATED_DIR, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "on", "yes"].includes(value.toLowerCase());
}

function getAnalysisOptions(req) {
  return {
    advancedAtsMode: req.body.advancedAtsMode == null ? true : parseBool(req.body.advancedAtsMode),
    aggressivePersonalMode: parseBool(req.body.aggressivePersonalMode),
    aggressiveFileContentMode: parseBool(req.body.aggressiveFileContentMode),
    jdInputMode: parseBool(req.body.jdKeywordListMode) ? "keyword_list" : "auto",
  };
}

function ensureSupportedFormat(file) {
  const originalName = file?.originalname || "resume";
  const ext = path.extname(originalName).toLowerCase();
  if (![".docx", ".pdf"].includes(ext)) {
    throw new Error("Format-preserving file optimization supports only DOCX and PDF uploads.");
  }
  return ext;
}

async function runFormatScript(args) {
  const scriptPath = path.join(__dirname, "scripts", "format_preserve_resume.py");
  try {
    const { stdout, stderr } = await execFileAsync("python3", [scriptPath, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout?.trim(), stderr: stderr?.trim() };
  } catch (error) {
    const detail = [error.stderr, error.stdout].filter(Boolean).join("\n").trim();
    const wrapped = new Error(`Format-preserving file processing failed.${detail ? ` ${detail}` : ""}`);
    wrapped.details = detail;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function tryConvertDocxToPdf(docxPath, targetPdfPath) {
  const outDir = path.dirname(targetPdfPath);
  const tmpProfile = path.join(TMP_ROOT, `lo_profile_${crypto.randomUUID()}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(tmpProfile, { recursive: true });
  try {
    await execFileAsync("soffice", [
      `-env:UserInstallation=file://${tmpProfile}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      docxPath,
    ], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const expected = path.join(outDir, `${path.basename(docxPath, path.extname(docxPath))}.pdf`);
    if (!fs.existsSync(expected)) return null;
    if (expected !== targetPdfPath) {
      if (fs.existsSync(targetPdfPath)) fs.unlinkSync(targetPdfPath);
      fs.renameSync(expected, targetPdfPath);
    }
    return targetPdfPath;
  } catch (_err) {
    return null;
  } finally {
    try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (_e) {}
  }
}

function sendApiError(res, label, error) {
  console.error(`${label}:`, error);
  const details =
    error?.details ||
    [error?.stderr, error?.stdout].filter(Boolean).join("\n").trim() ||
    (process.env.NODE_ENV !== "production" ? error?.stack : "");
  res.status(500).json({
    error: error?.message || "Unexpected server error.",
    ...(details ? { details } : {}),
  });
}

function registerFileDownload({ filePath, fileName, ext, originalName }) {
  const downloadId = crypto.randomUUID();
  downloadStore.set(downloadId, {
    filePath,
    fileName,
    mimeType:
      ext === ".docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    createdAt: Date.now(),
    originalName: originalName || fileName,
  });
  return {
    downloadId,
    fileName,
    format: ext.slice(1),
    downloadUrl: `/api/download/${downloadId}`,
  };
}

async function prepareFileOptimizationDraft({ file, jobDescription, analysisOptions }) {
  const ext = ensureSupportedFormat(file);
  const workId = crypto.randomUUID();
  const workDir = path.join(TMP_ROOT, workId);
  fs.mkdirSync(workDir, { recursive: true });

  const safeName = (file.originalname || `resume${ext}`).replace(/[^\w.\-]+/g, "_");
  const inputPath = path.join(workDir, `input${ext}`);
  const mappingPath = path.join(workDir, "mapping.json");
  fs.writeFileSync(inputPath, file.buffer);

  await runFormatScript(["extract", "--input", inputPath, "--output", mappingPath]);
  const mappingPayload = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
  const resumeText = (mappingPayload.text || "").trim();
  if (!resumeText) {
    throw new Error("Could not extract text from uploaded file for optimization.");
  }

  const beforeAnalysis = analyzeResumeAgainstJob({
    jobDescription,
    resumeText,
    metadata: {
      fileName: file.originalname,
      source: `${mappingPayload.kind || "file"}-structured`,
      formatPreservingFileFlow: true,
    },
    options: analysisOptions,
  });

  const optimization = await generateOptimizedResumeDraft({
    jobDescription,
    resumeText,
    analysis: beforeAnalysis,
    options: analysisOptions,
  });

  const proposals = combineOptimizationAndMandatoryProposals(beforeAnalysis, optimization, resumeText, analysisOptions);
  const outputName = safeName.replace(new RegExp(`${ext.replace(".", "\\.")}$`, "i"), "") + `_optimized${ext}`;

  const draftSessionId = registerDraftSession({
    kind: "file",
    ext,
    originalName: file.originalname,
    outputName,
    inputPath,
    mappingPath,
    workDir,
    jobDescription,
    analysisOptions,
    resumeText,
    beforeAnalysis,
    proposals,
    optimizationMeta: {
      mode: optimization.mode,
      preserveFormat: optimization.preserveFormat,
      notes: [
        ...(optimization.notes || []),
        "Mandatory keyword proposal generator is enabled (review generated experience points carefully before applying).",
        ...(analysisOptions?.aggressiveFileContentMode
          ? [ext === ".docx"
            ? "Aggressive ATS Content Mode enabled: approved generated points can be inserted as new DOCX paragraphs (layout/pagination may shift)."
            : "Aggressive ATS Content Mode requested, but PDF applies strict line-preserving updates (new points will be merged/skipped to protect layout)."]
          : []),
      ],
    },
  });

  return {
    draftSessionId,
    analysis: beforeAnalysis,
    beforeAnalysis,
    proposals,
    changePreview: buildChangePreviewFromProposals(proposals),
    proposalSummary: buildProposalSummary(proposals),
    optimization: {
      ...draftStore.get(draftSessionId).optimizationMeta,
      optimizedResumeDraft: "",
      lineEdits: (optimization.lineEdits || []).length,
      appliedEdits: optimization.appliedEdits || [],
      reviewRequired: true,
    },
  };
}

async function finalizeFileOptimizationDraft({ draft, selectedProposalIds }) {
  const { selectedProposals, lineEdits, insertions } = getSelectedEditsFromDraft(draft, selectedProposalIds);
  const aggressiveFileContentMode = draft.analysisOptions?.aggressiveFileContentMode === true;
  const useAggressiveDocxInsertion = aggressiveFileContentMode && draft.ext === ".docx";

  let finalLineEdits = lineEdits;
  let fileApplyPayload = { lineEdits };
  let skippedFileInsertions = [];
  let appliedProposals = selectedProposals;
  let fileApplyStrategy = "strict_merge";

  if (insertions.length && useAggressiveDocxInsertion) {
    fileApplyPayload = {
      lineEdits,
      insertions,
      options: {
        aggressiveInsertions: true,
      },
    };
    fileApplyStrategy = "docx_aggressive_insert";
  } else {
    const fileMerge = mergeFileInsertionsIntoLineEdits(lineEdits, insertions);
    finalLineEdits = fileMerge.lineEdits;
    fileApplyPayload = { lineEdits: finalLineEdits };
    skippedFileInsertions = fileMerge.skippedInsertions || [];
    const skippedInsertionKeys = new Set(
      skippedFileInsertions.map((ins) => `${ins.afterLineNumber}|${String(ins.newText || "").trim()}`)
    );
    appliedProposals = selectedProposals.filter((p) => {
      if ((p.operation || "replace_line") !== "insert_after_line") return true;
      const key = `${p.lineNumber}|${String(p.after || "").trim()}`;
      return !skippedInsertionKeys.has(key);
    });
    if (insertions.length && aggressiveFileContentMode && draft.ext === ".pdf") {
      fileApplyStrategy = "pdf_strict_fallback";
    }
  }

  const editsPath = path.join(draft.workDir, "selected_edits.json");
  const outputToken = crypto.randomUUID();
  const outputPath = path.join(GENERATED_DIR, `${outputToken}_${draft.outputName}`);
  const afterMappingPath = path.join(draft.workDir, `after_mapping_${outputToken}.json`);

  fs.writeFileSync(editsPath, JSON.stringify(fileApplyPayload, null, 2), "utf8");
  await runFormatScript(["apply", "--input", draft.inputPath, "--mapping", draft.mappingPath, "--edits", editsPath, "--output", outputPath]);
  await runFormatScript(["extract", "--input", outputPath, "--output", afterMappingPath]);

  const afterMappingPayload = JSON.parse(fs.readFileSync(afterMappingPath, "utf8"));
  const afterResumeText = (afterMappingPayload.text || "").trim();
  const afterAnalysis = analyzeResumeAgainstJob({
    jobDescription: draft.jobDescription,
    resumeText: afterResumeText || draft.resumeText,
    metadata: {
      fileName: draft.outputName,
      source: `${afterMappingPayload.kind || "file"}-structured-optimized`,
      formatPreservingFileFlow: true,
      optimized: true,
    },
    options: draft.analysisOptions,
  });

  const output = registerFileDownload({
    filePath: outputPath,
    fileName: draft.outputName,
    ext: draft.ext,
    originalName: draft.originalName,
  });
  const downloads = {
    docx: null,
    pdf: null,
  };
  if (draft.ext === ".docx") {
    downloads.docx = output;
    const altPdfName = draft.outputName.replace(/\.docx$/i, ".pdf");
    const altPdfPath = path.join(GENERATED_DIR, `${crypto.randomUUID()}_${altPdfName}`);
    const convertedPdfPath = await tryConvertDocxToPdf(outputPath, altPdfPath);
    if (convertedPdfPath) {
      downloads.pdf = registerFileDownload({
        filePath: convertedPdfPath,
        fileName: altPdfName,
        ext: ".pdf",
        originalName: altPdfName,
      });
    }
  } else if (draft.ext === ".pdf") {
    downloads.pdf = output;
  }

  return {
    beforeAnalysis: draft.beforeAnalysis,
    afterAnalysis,
    comparison: buildScoreComparison(draft.beforeAnalysis, afterAnalysis),
    changePreview: buildChangePreviewFromProposals(appliedProposals),
    appliedProposals,
    optimization: {
      ...(draft.optimizationMeta || {}),
      appliedEdits: appliedProposals.map((p) => ({
        lineNumber: p.lineNumber,
        type: p.type,
        before: p.before,
        after: p.after,
        reason: p.reason || "",
      })),
      lineEdits: finalLineEdits.length,
      selectedProposalCount: appliedProposals.length,
      fileApplyStrategy,
      reviewRequired: false,
      optimizedResumeDraft: afterResumeText,
      notes: [
        ...(draft.optimizationMeta?.notes || []),
        ...(insertions.length && !useAggressiveDocxInsertion ? ["Format-preserving file apply merged generated new bullets into nearby existing lines to preserve DOCX/PDF layout."] : []),
        ...(useAggressiveDocxInsertion && insertions.length ? ["Aggressive DOCX content mode inserted approved generated points as new paragraphs (layout or page breaks may shift)."] : []),
        ...(aggressiveFileContentMode && draft.ext === ".pdf" && insertions.length ? ["PDF aggressive insertion is not supported yet; used strict line merge/skip behavior to preserve layout."] : []),
        ...(skippedFileInsertions.length ? [`Skipped ${skippedFileInsertions.length} generated new-point insertions in file mode to protect layout or avoid overlong merged lines.`] : []),
      ],
    },
    output: {
      ...output,
      downloads,
    },
  };
}

async function prepareTextOptimizationDraft({ parsedResume, jobDescription, analysisOptions }) {
  const resumeText = (parsedResume?.text || "").trim();
  if (!resumeText) {
    throw new Error("Resume text or a supported resume file is required.");
  }

  const beforeAnalysis = analyzeResumeAgainstJob({
    jobDescription,
    resumeText,
    metadata: { fileName: parsedResume?.fileName, source: parsedResume?.source || "textarea" },
    options: analysisOptions,
  });

  const optimization = await generateOptimizedResumeDraft({
    jobDescription,
    resumeText,
    analysis: beforeAnalysis,
    options: analysisOptions,
  });

  const proposals = combineOptimizationAndMandatoryProposals(beforeAnalysis, optimization, resumeText, analysisOptions);
  const draftSessionId = registerDraftSession({
    kind: "text",
    jobDescription,
    analysisOptions,
    resumeText,
    beforeAnalysis,
    proposals,
    optimizationMeta: {
      mode: optimization.mode,
      preserveFormat: optimization.preserveFormat,
      notes: [
        ...(optimization.notes || []),
        "Mandatory keyword proposal generator can create new summary/experience points for review.",
      ],
    },
  });

  return {
    draftSessionId,
    analysis: beforeAnalysis,
    beforeAnalysis,
    proposals,
    changePreview: buildChangePreviewFromProposals(proposals),
    proposalSummary: buildProposalSummary(proposals),
    optimization: {
      ...draftStore.get(draftSessionId).optimizationMeta,
      optimizedResumeDraft: "",
      lineEdits: (optimization.lineEdits || []).length,
      appliedEdits: optimization.appliedEdits || [],
      reviewRequired: true,
    },
  };
}

async function finalizeTextOptimizationDraft({ draft, selectedProposalIds }) {
  const { lines, candidates } = buildEditableLineCandidates(draft.resumeText);
  const { selectedProposals, lineEdits, insertions } = getSelectedEditsFromDraft(draft, selectedProposalIds);
  const applied = applyTextDraftWithInsertions(lines, candidates, lineEdits, insertions);
  const optimizedResumeDraft = applied.optimizedResumeDraft || draft.resumeText;

  const afterAnalysis = analyzeResumeAgainstJob({
    jobDescription: draft.jobDescription,
    resumeText: optimizedResumeDraft,
    metadata: { source: "optimized-text", optimized: true },
    options: draft.analysisOptions,
  });

  const output = registerTextDownload({
    text: optimizedResumeDraft,
    extension: "txt",
    baseName: "optimized_resume",
  });

  return {
    beforeAnalysis: draft.beforeAnalysis,
    afterAnalysis,
    comparison: buildScoreComparison(draft.beforeAnalysis, afterAnalysis),
    changePreview: buildChangePreviewFromProposals(selectedProposals),
    appliedProposals: selectedProposals,
    optimization: {
      ...(draft.optimizationMeta || {}),
      appliedEdits: applied.appliedEdits || [],
      lineEdits: lineEdits.length,
      insertedLines: insertions.length,
      appliedInsertedLines: applied.insertedCount || 0,
      selectedProposalCount: selectedProposals.length,
      reviewRequired: false,
      optimizedResumeDraft,
      notes: [
        ...(draft.optimizationMeta?.notes || []),
        ...(applied.skippedInsertions ? [`Skipped ${applied.skippedInsertions} generated insertions because they could not be safely placed.`] : []),
      ],
    },
    output: {
      ...output,
      downloads: {
        txt: output,
      },
    },
  };
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordInText(text, keyword) {
  if (!text || !keyword) return false;
  const pattern = new RegExp(`\\b${escapeRegex(keyword).replace(/\\ /g, "\\s+")}\\b`, "i");
  return pattern.test(text);
}

function buildKeywordAdditionPreview(beforeAnalysis, optimization) {
  const missingKeywords = beforeAnalysis?.insights?.topMissingKeywords || [];
  const edits = optimization?.appliedEdits || [];
  const preview = [];

  for (const edit of edits) {
    const before = edit.before || "";
    const after = edit.after || "";
    const addedKeywords = missingKeywords.filter((keyword) => keywordInText(after, keyword) && !keywordInText(before, keyword));
    if (!addedKeywords.length) continue;
    preview.push({
      lineNumber: edit.lineNumber,
      type: edit.type,
      reason: edit.reason || "",
      addedKeywords,
      before,
      after,
    });
  }

  return preview.slice(0, 20);
}

function buildScoreComparison(beforeAnalysis, afterAnalysis) {
  const beforeScore = beforeAnalysis?.score ?? 0;
  const afterScore = afterAnalysis?.score ?? 0;
  return {
    beforeScore,
    afterScore,
    delta: afterScore - beforeScore,
    improved: afterScore > beforeScore,
  };
}

function buildProposalsFromOptimization(beforeAnalysis, optimization) {
  const edits = optimization?.appliedEdits || [];
  const missingKeywords = beforeAnalysis?.insights?.topMissingKeywords || [];

  return edits.map((edit, index) => {
    const before = edit.before || "";
    const after = edit.after || "";
    const addedKeywords = missingKeywords.filter((keyword) => keywordInText(after, keyword) && !keywordInText(before, keyword));
    const targetArea =
      edit.type === "summary_line" ? "Professional Summary" :
      edit.type === "skills_line" ? "Technical Skills" :
      edit.type === "experience_bullet" || edit.type === "experience_line" ? "Experience" :
      edit.type === "achievement_bullet" ? "Achievements" :
      "Resume";

    return {
      proposalId: `p_${index + 1}_${edit.lineNumber}`,
      selected: true,
      operation: "replace_line",
      lineNumber: edit.lineNumber,
      type: edit.type,
      targetArea,
      reason: edit.reason || "",
      before,
      after,
      addedKeywords,
      affectsMandatoryKeyword: addedKeywords.length > 0,
      anchorText: before,
    };
  });
}

function buildChangePreviewFromProposals(proposals) {
  return (proposals || [])
    .filter((p) => (p.addedKeywords || []).length > 0)
    .slice(0, 20)
    .map((p) => ({
      lineNumber: p.lineNumber,
      type: p.type,
      reason: p.reason,
      addedKeywords: p.addedKeywords,
      before: p.before,
      after: p.after,
    }));
}

function dedupeAndRenumberProposals(proposals) {
  const seen = new Set();
  const unique = [];
  for (const proposal of proposals || []) {
    if (!proposal || typeof proposal.lineNumber !== "number") continue;
    const key = [
      proposal.operation || "replace_line",
      proposal.lineNumber,
      String(proposal.type || ""),
      String(proposal.after || "").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(proposal);
  }
  return unique.map((p, index) => ({
    selected: p.selected !== false,
    operation: p.operation || "replace_line",
    ...p,
    proposalId: `p_${index + 1}_${p.lineNumber}_${(p.operation || "replace_line") === "insert_after_line" ? "ins" : "rep"}`,
  }));
}

function combineOptimizationAndMandatoryProposals(beforeAnalysis, optimization, resumeText, analysisOptions = {}) {
  const base = buildProposalsFromOptimization(beforeAnalysis, optimization);
  const advancedAtsMode = analysisOptions.advancedAtsMode !== false;
  const generated = generateSupplementalPointProposals({
    analysis: beforeAnalysis,
    resumeText,
    maxProposals: advancedAtsMode ? 30 : 10,
  });
  return dedupeAndRenumberProposals(advancedAtsMode ? [...base, ...generated] : base);
}

function buildProposalSummary(proposals) {
  return {
    total: proposals.length,
    mandatoryAffected: proposals.filter((p) => p.affectsMandatoryKeyword).length,
    experienceTargeted: proposals.filter((p) => p.targetArea === "Experience").length,
    summaryTargeted: proposals.filter((p) => p.targetArea === "Professional Summary").length,
    generatedNewPoints: proposals.filter((p) => p.operation === "insert_after_line").length,
  };
}

function registerDraftSession(payload) {
  const draftId = crypto.randomUUID();
  draftStore.set(draftId, {
    ...payload,
    createdAt: Date.now(),
  });
  return draftId;
}

function getSelectedEditsFromDraft(draft, selectedProposalIds) {
  const selectedSet = new Set(
    Array.isArray(selectedProposalIds) && selectedProposalIds.length
      ? selectedProposalIds
      : (draft.proposals || []).filter((p) => p.selected !== false).map((p) => p.proposalId)
  );
  const selectedProposals = (draft.proposals || []).filter((p) => selectedSet.has(p.proposalId));
  const lineEditsByLine = new Map();
  const insertions = [];
  for (const p of selectedProposals) {
    if ((p.operation || "replace_line") === "insert_after_line") {
      insertions.push({
        afterLineNumber: p.lineNumber,
        newText: p.after,
        reason: p.reason || "",
        type: p.type,
        anchorText: p.anchorText || "",
      });
      continue;
    }
    lineEditsByLine.set(p.lineNumber, {
      lineNumber: p.lineNumber,
      newText: p.after,
      reason: p.reason || "",
      type: p.type,
    });
  }
  const lineEdits = [...lineEditsByLine.values()].sort((a, b) => a.lineNumber - b.lineNumber);
  return { selectedProposals, lineEdits, insertions };
}

function stripBulletPrefix(text) {
  return String(text || "").replace(/^\s*[-*•]\s+/, "").trim();
}

function mergeFileInsertionsIntoLineEdits(lineEdits, insertions) {
  const byLine = new Map();
  const insertionCounts = new Map();
  const skippedInsertions = [];
  for (const edit of lineEdits || []) {
    if (!edit || typeof edit.lineNumber !== "number") continue;
    byLine.set(edit.lineNumber, { ...edit });
  }

  for (const insertion of insertions || []) {
    const lineNumber = insertion.afterLineNumber;
    if (typeof lineNumber !== "number") continue;
    const prior = byLine.get(lineNumber);
    const baseText = (prior?.newText || insertion.anchorText || "").trim();
    const insertedText = String(insertion.newText || "").trim();
    if (!baseText || !insertedText) {
      skippedInsertions.push({ ...insertion, skipReason: "missing_anchor_or_text" });
      continue;
    }
    if (!/^\s*[-*•]\s+/.test(baseText)) {
      skippedInsertions.push({ ...insertion, skipReason: "anchor_not_bullet" });
      continue;
    }
    const countForLine = insertionCounts.get(lineNumber) || 0;
    if (countForLine >= 1) {
      skippedInsertions.push({ ...insertion, skipReason: "line_insertion_limit" });
      continue;
    }

    const merged =
      /^\s*[-*•]\s+/.test(baseText)
        ? `${baseText.replace(/\s+$/, "")}; ${stripBulletPrefix(insertedText)}`
        : `${baseText.replace(/\s+$/, "")} ${stripBulletPrefix(insertedText)}`;
    if (merged.length > 320) {
      skippedInsertions.push({ ...insertion, skipReason: "merged_line_too_long" });
      continue;
    }

    byLine.set(lineNumber, {
      lineNumber,
      newText: merged,
      reason: `${prior?.reason ? `${prior.reason}; ` : ""}${insertion.reason || "Merged generated point to preserve file layout"}`.trim(),
      type: prior?.type || "experience_line",
    });
    insertionCounts.set(lineNumber, countForLine + 1);
  }

  return {
    lineEdits: [...byLine.values()].sort((a, b) => a.lineNumber - b.lineNumber),
    skippedInsertions,
  };
}

function applyTextDraftWithInsertions(lines, candidates, lineEdits, insertions) {
  const appliedReplacements = applyLineEditsPreservingLayout(lines, candidates, lineEdits);
  const updatedLines = String(appliedReplacements.optimizedResumeDraft || lines.join("\n")).split("\n");
  const sortedInsertions = [...(insertions || [])].sort((a, b) => a.afterLineNumber - b.afterLineNumber);
  let offset = 0;
  const insertedApplied = [];

  for (const insertion of sortedInsertions) {
    const baseIdx = Number(insertion.afterLineNumber) - 1;
    if (!Number.isInteger(baseIdx) || baseIdx < 0) continue;
    let newLine = String(insertion.newText || "").replace(/\r?\n/g, " ").trimEnd();
    if (!newLine.trim()) continue;
    if (/^\s*[-*•]?\s*applied\b/i.test(newLine)) {
      newLine = newLine.replace(/^(\s*[-*•]?\s*)applied\b/i, "$1Improved");
    }
    if (!/^\s*[-*•]\s+/.test(newLine)) {
      newLine = `- ${newLine.trim()}`;
    }
    const insertAt = Math.min(updatedLines.length, baseIdx + 1 + offset);
    updatedLines.splice(insertAt, 0, newLine);
    offset += 1;
    insertedApplied.push({
      lineNumber: insertion.afterLineNumber,
      type: insertion.type || "experience_bullet_insert",
      before: `(Inserted after line ${insertion.afterLineNumber})`,
      after: newLine,
      reason: insertion.reason || "",
    });
  }

  return {
    optimizedResumeDraft: updatedLines.join("\n"),
    appliedEdits: [...(appliedReplacements.appliedEdits || []), ...insertedApplied],
    insertedCount: insertedApplied.length,
    skippedInsertions: Math.max(0, (insertions || []).length - insertedApplied.length),
  };
}

function registerTextDownload({ text, extension = "txt", baseName = "optimized_resume" }) {
  const id = crypto.randomUUID();
  const fileName = `${baseName}.${extension}`;
  const filePath = path.join(GENERATED_DIR, `${id}_${fileName}`);
  fs.writeFileSync(filePath, text, "utf8");
  downloadStore.set(id, {
    filePath,
    fileName,
    mimeType: "text/plain; charset=utf-8",
    createdAt: Date.now(),
    originalName: fileName,
  });
  const payload = {
    downloadId: id,
    fileName,
    format: extension,
    downloadUrl: `/api/download/${id}`,
  };
  return payload;
}

app.post("/api/analyze", upload.single("resumeFile"), async (req, res) => {
  try {
    const analysisOptions = getAnalysisOptions(req);
    const jobDescription = (req.body.jobDescription || "").trim();
    const resumeTextInput = (req.body.resumeText || "").trim();

    if (!jobDescription) {
      return res.status(400).json({ error: "Job description is required." });
    }

    let parsedResume = { text: resumeTextInput, source: "textarea" };
    if (req.file) {
      parsedResume = await parseResumeUpload(req.file);
    }

    const resumeText = (parsedResume.text || "").trim();
    if (!resumeText) {
      return res.status(400).json({ error: "Resume text or a supported resume file is required." });
    }

    const analysis = analyzeResumeAgainstJob({
      jobDescription,
      resumeText,
      metadata: { fileName: req.file?.originalname, source: parsedResume.source },
      options: analysisOptions,
    });

    res.json({
      analysis,
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    sendApiError(res, "Analyze error", error);
  }
});

app.post("/api/optimize", upload.single("resumeFile"), async (req, res) => {
  try {
    const analysisOptions = getAnalysisOptions(req);
    const jobDescription = (req.body.jobDescription || "").trim();
    const resumeTextInput = (req.body.resumeText || "").trim();

    if (!jobDescription) {
      return res.status(400).json({ error: "Job description is required." });
    }

    let parsedResume = { text: resumeTextInput, source: "textarea" };
    if (req.file) {
      parsedResume = await parseResumeUpload(req.file);
    }

    const resumeText = (parsedResume.text || "").trim();
    if (!resumeText) {
      return res.status(400).json({ error: "Resume text or a supported resume file is required." });
    }

    const result = await prepareTextOptimizationDraft({
      parsedResume: { ...parsedResume, fileName: req.file?.originalname },
      jobDescription,
      analysisOptions,
    });

    res.json({
      ...result,
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    sendApiError(res, "Optimize error", error);
  }
});

app.post("/api/optimize-file", upload.single("resumeFile"), async (req, res) => {
  try {
    const analysisOptions = getAnalysisOptions(req);
    const jobDescription = (req.body.jobDescription || "").trim();
    if (!jobDescription) {
      return res.status(400).json({ error: "Job description is required." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a DOCX or PDF resume file." });
    }

    const result = await prepareFileOptimizationDraft({
      file: req.file,
      jobDescription,
      analysisOptions,
    });

    res.json({
      ...result,
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    sendApiError(res, "Optimize-file error", error);
  }
});

app.post("/api/apply-selected", async (req, res) => {
  try {
    const draftSessionId = String(req.body.draftSessionId || "").trim();
    if (!draftSessionId) {
      return res.status(400).json({ error: "draftSessionId is required." });
    }
    const draft = draftStore.get(draftSessionId);
    if (!draft) {
      return res.status(404).json({ error: "Optimization draft not found or expired. Please run Analyze + Optimize again." });
    }

    const selectedProposalIds = Array.isArray(req.body.selectedProposalIds)
      ? req.body.selectedProposalIds.map((v) => String(v))
      : [];

    const result =
      draft.kind === "file"
        ? await finalizeFileOptimizationDraft({ draft, selectedProposalIds })
        : await finalizeTextOptimizationDraft({ draft, selectedProposalIds });

    res.json({
      draftSessionId,
      ...result,
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    sendApiError(res, "Apply-selected error", error);
  }
});

app.get("/api/download/:id", (req, res) => {
  const entry = downloadStore.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Download not found or expired." });
  }
  if (!fs.existsSync(entry.filePath)) {
    downloadStore.delete(req.params.id);
    return res.status(404).json({ error: "Generated file is no longer available." });
  }
  res.setHeader("Content-Type", entry.mimeType);
  return res.download(entry.filePath, entry.fileName);
});

app.use((req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send("Not found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Resume analyzer running at http://localhost:${PORT}`);
});
