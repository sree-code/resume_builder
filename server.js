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
const { generateOptimizedResumeDraft } = require("./src/aiOptimizer");

const execFileAsync = promisify(execFile);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const downloadStore = new Map();
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
    aggressivePersonalMode: parseBool(req.body.aggressivePersonalMode),
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
  const { stdout, stderr } = await execFileAsync("python3", [scriptPath, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout?.trim(), stderr: stderr?.trim() };
}

async function optimizeUploadedFilePreservingFormat({ file, jobDescription, analysisOptions }) {
  const ext = ensureSupportedFormat(file);
  const workId = crypto.randomUUID();
  const workDir = path.join(TMP_ROOT, workId);
  fs.mkdirSync(workDir, { recursive: true });

  const safeName = (file.originalname || `resume${ext}`).replace(/[^\w.\-]+/g, "_");
  const inputPath = path.join(workDir, `input${ext}`);
  const mappingPath = path.join(workDir, "mapping.json");
  const editsPath = path.join(workDir, "edits.json");
  const outputName = safeName.replace(new RegExp(`${ext.replace(".", "\\.")}$`, "i"), "") + `_optimized${ext}`;
  const outputPath = path.join(GENERATED_DIR, `${workId}_${outputName}`);

  fs.writeFileSync(inputPath, file.buffer);

  await runFormatScript(["extract", "--input", inputPath, "--output", mappingPath]);
  const mappingPayload = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
  const resumeText = (mappingPayload.text || "").trim();
  if (!resumeText) {
    throw new Error("Could not extract text from uploaded file for optimization.");
  }

  const analysis = analyzeResumeAgainstJob({
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
    analysis,
    options: analysisOptions,
  });

  fs.writeFileSync(editsPath, JSON.stringify({ lineEdits: optimization.lineEdits || [] }, null, 2), "utf8");

  await runFormatScript(["apply", "--input", inputPath, "--mapping", mappingPath, "--edits", editsPath, "--output", outputPath]);

  const afterMappingPath = path.join(workDir, "after_mapping.json");
  await runFormatScript(["extract", "--input", outputPath, "--output", afterMappingPath]);
  const afterMappingPayload = JSON.parse(fs.readFileSync(afterMappingPath, "utf8"));
  const afterResumeText = (afterMappingPayload.text || optimization.optimizedResumeDraft || "").trim();
  const afterAnalysis = analyzeResumeAgainstJob({
    jobDescription,
    resumeText: afterResumeText,
    metadata: {
      fileName: outputName,
      source: `${afterMappingPayload.kind || mappingPayload.kind || "file"}-structured-optimized`,
      formatPreservingFileFlow: true,
      optimized: true,
    },
    options: analysisOptions,
  });

  const downloadId = crypto.randomUUID();
  downloadStore.set(downloadId, {
    filePath: outputPath,
    fileName: outputName,
    mimeType:
      ext === ".docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    createdAt: Date.now(),
    originalName: file.originalname,
  });

  return {
    analysis,
    beforeAnalysis: analysis,
    afterAnalysis,
    comparison: buildScoreComparison(analysis, afterAnalysis),
    changePreview: buildKeywordAdditionPreview(analysis, optimization),
    optimization,
    output: {
      downloadId,
      fileName: outputName,
      format: ext.slice(1),
      downloadUrl: `/api/download/${downloadId}`,
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
  return {
    downloadId: id,
    fileName,
    format: extension,
    downloadUrl: `/api/download/${id}`,
  };
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
    console.error("Analyze error:", error);
    res.status(500).json({ error: error.message || "Unexpected server error." });
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

    const analysis = analyzeResumeAgainstJob({
      jobDescription,
      resumeText,
      metadata: { fileName: req.file?.originalname, source: parsedResume.source },
      options: analysisOptions,
    });

    const optimization = await generateOptimizedResumeDraft({
      jobDescription,
      resumeText,
      analysis,
      options: analysisOptions,
    });

    const afterAnalysis = analyzeResumeAgainstJob({
      jobDescription,
      resumeText: optimization.optimizedResumeDraft || resumeText,
      metadata: { source: "optimized-text", optimized: true },
      options: analysisOptions,
    });

    const output = registerTextDownload({
      text: optimization.optimizedResumeDraft || resumeText,
      extension: "txt",
      baseName: "optimized_resume",
    });

    res.json({
      analysis,
      beforeAnalysis: analysis,
      afterAnalysis,
      comparison: buildScoreComparison(analysis, afterAnalysis),
      changePreview: buildKeywordAdditionPreview(analysis, optimization),
      optimization,
      output,
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    console.error("Optimize error:", error);
    res.status(500).json({ error: error.message || "Unexpected server error." });
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

    const result = await optimizeUploadedFilePreservingFormat({
      file: req.file,
      jobDescription,
      analysisOptions,
    });

    res.json({
      ...result,
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    console.error("Optimize-file error:", error);
    res.status(500).json({ error: error.message || "Unexpected server error." });
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
