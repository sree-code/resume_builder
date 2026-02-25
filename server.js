require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { parseResumeUpload } = require("./src/resumeParser");
const { analyzeResumeAgainstJob } = require("./src/atsScorer");
const { generateOptimizedResumeDraft } = require("./src/aiOptimizer");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
