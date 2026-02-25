require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
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

async function optimizeUploadedFilePreservingFormat({ file, jobDescription }) {
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
  });

  const optimization = await generateOptimizedResumeDraft({
    jobDescription,
    resumeText,
    analysis,
  });

  fs.writeFileSync(editsPath, JSON.stringify({ lineEdits: optimization.lineEdits || [] }, null, 2), "utf8");

  await runFormatScript(["apply", "--input", inputPath, "--mapping", mappingPath, "--edits", editsPath, "--output", outputPath]);

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
    optimization,
    output: {
      downloadId,
      fileName: outputName,
      format: ext.slice(1),
      downloadUrl: `/api/download/${downloadId}`,
    },
  };
}

app.post("/api/analyze", upload.single("resumeFile"), async (req, res) => {
  try {
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
    });

    const optimization = await generateOptimizedResumeDraft({
      jobDescription,
      resumeText,
      analysis,
    });

    res.json({
      analysis,
      optimization,
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    console.error("Optimize error:", error);
    res.status(500).json({ error: error.message || "Unexpected server error." });
  }
});

app.post("/api/optimize-file", upload.single("resumeFile"), async (req, res) => {
  try {
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
