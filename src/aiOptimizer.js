let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (_err) {
  OpenAI = null;
}

const HEADER_ALIASES = new Map([
  ["summary", "summary"],
  ["professional summary", "summary"],
  ["profile", "summary"],
  ["skills", "skills"],
  ["technical skills", "skills"],
  ["core skills", "skills"],
  ["experience", "experience"],
  ["work experience", "experience"],
  ["professional experience", "experience"],
  ["employment", "experience"],
  ["achievements", "achievements"],
  ["notable achievements", "achievements"],
  ["projects", "projects"],
  ["education", "education"],
]);

function normalizeHeader(line) {
  return line.toLowerCase().replace(/[:\-\s]+$/g, "").trim();
}

function detectSection(line) {
  const normalized = normalizeHeader(line);
  return HEADER_ALIASES.get(normalized) || null;
}

function isBulletLine(line) {
  return /^\s*[-*•]\s+/.test(line);
}

function extractLeadingWhitespace(line) {
  const match = line.match(/^\s*/);
  return match ? match[0] : "";
}

function buildEditableLineCandidates(resumeText) {
  const lines = String(resumeText || "").replace(/\r/g, "").split("\n");
  const candidates = [];
  let currentSection = null;
  let summaryCount = 0;
  let skillsCount = 0;
  let experienceBulletCount = 0;
  let achievementBulletCount = 0;
  let otherBulletCount = 0;
  let sectionBodyCount = 0;

  lines.forEach((line, index) => {
    const raw = line;
    const trimmed = raw.trim();
    if (!trimmed) return;

    const section = detectSection(trimmed);
    if (section) {
      currentSection = section;
      sectionBodyCount = 0;
      return;
    }

    if (isBulletLine(raw)) {
      const bulletSection =
        currentSection === "experience" ? "experience" :
        /achievement/i.test(currentSection || "") ? "achievements" :
        currentSection || "unknown";

      const isExperienceLike = bulletSection === "experience" || bulletSection === "projects";
      const isAchievementLike = bulletSection === "achievements";
      const canAdd =
        (isExperienceLike && experienceBulletCount < 45) ||
        (isAchievementLike && achievementBulletCount < 20) ||
        (!isExperienceLike && !isAchievementLike && otherBulletCount < 20);

      if (canAdd) {
        const type =
          bulletSection === "experience" ? "experience_bullet" :
          bulletSection === "achievements" ? "achievement_bullet" :
          "bullet";
        candidates.push({
          lineNumber: index + 1,
          type,
          section: bulletSection,
          originalText: raw,
        });
        if (isExperienceLike) experienceBulletCount += 1;
        else if (isAchievementLike) achievementBulletCount += 1;
        else otherBulletCount += 1;
      }
      return;
    }

    if (currentSection === "summary" && summaryCount < 6) {
      candidates.push({
        lineNumber: index + 1,
        type: "summary_line",
        section: currentSection,
        originalText: raw,
      });
      summaryCount += 1;
      sectionBodyCount += 1;
      return;
    }

    if (currentSection === "skills" && skillsCount < 14) {
      candidates.push({
        lineNumber: index + 1,
        type: "skills_line",
        section: currentSection,
        originalText: raw,
      });
      skillsCount += 1;
      sectionBodyCount += 1;
      return;
    }

    // Allow limited non-bullet experience lines (project labels / overview lines) to be refined.
    if (currentSection === "experience" && sectionBodyCount < 10 && trimmed.length >= 12) {
      candidates.push({
        lineNumber: index + 1,
        type: "experience_line",
        section: currentSection,
        originalText: raw,
      });
      sectionBodyCount += 1;
    }
  });

  return { lines, candidates };
}

function applyLineEditsPreservingLayout(lines, candidates, edits) {
  const byLine = new Map(candidates.map((c) => [c.lineNumber, c]));
  const seen = new Set();
  const updated = [...lines];
  const applied = [];

  for (const edit of edits || []) {
    if (!edit || typeof edit.lineNumber !== "number" || typeof edit.newText !== "string") continue;
    if (seen.has(edit.lineNumber)) continue;
    const candidate = byLine.get(edit.lineNumber);
    if (!candidate) continue;

    let newText = edit.newText.replace(/\r?\n/g, " ").trimEnd();
    if (!newText.trim()) continue;

    if (candidate.type === "bullet") {
      const prefixMatch = candidate.originalText.match(/^(\s*[-*•]\s+)/);
      const prefix = prefixMatch ? prefixMatch[1] : "- ";
      newText = newText.replace(/^\s*[-*•]\s+/, "");
      newText = prefix + newText.trim();
    } else if (candidate.type === "experience_bullet" || candidate.type === "achievement_bullet") {
      const prefixMatch = candidate.originalText.match(/^(\s*[-*•]\s+)/);
      const prefix = prefixMatch ? prefixMatch[1] : "- ";
      newText = newText.replace(/^\s*[-*•]\s+/, "");
      newText = prefix + newText.trim();
    } else {
      const indent = extractLeadingWhitespace(candidate.originalText);
      newText = indent + newText.trim();
    }

    // Prevent extreme rewrites while allowing long summary/experience lines present in real resumes.
    const maxLen =
      candidate.type === "summary_line" ? 520 :
      candidate.type === "experience_line" ? 420 :
      candidate.type === "experience_bullet" ? 360 :
      candidate.type === "achievement_bullet" ? 340 :
      candidate.type === "skills_line" ? 320 :
      300;
    if (newText.length > maxLen) continue;
    if (newText === candidate.originalText) continue;

    updated[edit.lineNumber - 1] = newText;
    seen.add(edit.lineNumber);
    applied.push({
      lineNumber: edit.lineNumber,
      type: candidate.type,
      before: candidate.originalText,
      after: newText,
      reason: typeof edit.reason === "string" ? edit.reason : "",
    });
  }

  return { optimizedResumeDraft: updated.join("\n"), appliedEdits: applied };
}

function buildFallbackOptimization({ analysis, resumeText }) {
  const missing = (analysis?.insights?.topMissingKeywords || []).slice(0, 12);
  const suggestions = analysis?.suggestions || [];
  const { candidates } = buildEditableLineCandidates(resumeText);

  return {
    mode: "heuristic",
    preserveFormat: true,
    lineEdits: [],
    notes: [
      "Format-preserving mode is enabled. No OpenAI API key detected, so the resume text is left unchanged.",
      "Only bullet/summary/skills lines are eligible for editing when AI is enabled; headings and line order are preserved.",
      ...(analysis?.metadata?.source && analysis.metadata.source !== "textarea"
        ? ["Exact DOCX/PDF page layout is not preserved in extracted text output; this mode preserves text structure only."]
        : []),
      missing.length ? `Top missing keywords to add truthfully: ${missing.join(", ")}.` : "No high-priority missing keywords detected.",
      candidates.length ? `Detected ${candidates.length} editable lines (bullets/summary/skills).` : "No editable bullet/summary/skills lines detected.",
      ...suggestions.slice(0, 4).map((s) => `${s.title}: ${s.detail}`),
    ],
    optimizedResumeDraft: resumeText,
  };
}

async function generateOptimizedResumeDraft({ jobDescription, resumeText, analysis }) {
  if (!process.env.OPENAI_API_KEY || !OpenAI) {
    return buildFallbackOptimization({ analysis, resumeText });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const missingKeywords = (analysis?.insights?.topMissingKeywords || []).slice(0, 20);
  const topMatchedKeywords = (analysis?.insights?.topMatchedKeywords || []).slice(0, 20);
  const { lines, candidates } = buildEditableLineCandidates(resumeText);

  if (!candidates.length) {
    return {
      mode: "heuristic",
      preserveFormat: true,
      lineEdits: [],
      notes: [
        "Format-preserving mode is enabled, but no editable bullet/summary/skills lines were detected.",
        "Add bullet points or a skills/summary section to enable targeted AI rewrites without changing the format.",
      ],
      optimizedResumeDraft: resumeText,
    };
  }

  const candidatePayload = candidates.map((c) => ({
    lineNumber: c.lineNumber,
    type: c.type,
    section: c.section,
    priority:
      c.type === "summary_line" ? "high" :
      c.type === "experience_bullet" ? "high" :
      c.type === "experience_line" ? "medium" :
      c.type === "achievement_bullet" ? "medium" :
      c.type === "skills_line" ? "medium" :
      "low",
    text: c.originalText,
  }));

  const prompt = [
    "You are an expert resume editor optimizing for ATS and recruiter relevance.",
    "IMPORTANT: Preserve the resume format and structure exactly.",
    "You may ONLY rewrite the provided editable lines. Do not add/remove/reorder lines, sections, or headings.",
    "This is a line-preserving optimization task: same line count, same order, same headings, same non-editable text.",
    "Prioritize meaningful ATS improvements in PROFESSIONAL SUMMARY and EXPERIENCE bullets before editing skills lines.",
    "Rules:",
    "- Do not invent employers, degrees, dates, certifications, or achievements.",
    "- Only improve wording, keyword alignment, and bullet impact in provided lines.",
    "- Preserve bullet prefixes (`-`, `*`, `•`) and avoid multi-line outputs.",
    "- Include job-description keywords only when they can be reasonably supported by the existing resume.",
    "- Keep each rewritten line concise and readable.",
    "- Edit summary and experience lines aggressively enough to improve ATS score; do not spend all edits on skill lists.",
    "- If the JD lists alternative languages (e.g., Java, Go, C#), do not fabricate experience with all of them. Strengthen evidence of the strongest truthful OO language and architecture/service experience.",
    "- You may add generic senior-engineering leadership phrasing (technical leadership, architecture, problem-solving, distributed services, production support) only if it plausibly matches the existing experience.",
    "- Return JSON with keys: edits (array), changes (array of strings), cautionNotes (array of strings).",
    "- Each item in edits must have: lineNumber (number), newText (string), reason (string).",
    "- Only include lineNumber values from the editable lines list.",
    "- Prefer 10-20 edits when enough eligible lines exist.",
    "- Include at least 2 summary_line edits and at least 5 experience_bullet/experience_line edits if such lines are available.",
    "",
    `Current simulated match score: ${analysis?.score ?? "n/a"}/100`,
    `Missing keywords to consider: ${missingKeywords.join(", ") || "none"}`,
    `Already matched keywords: ${topMatchedKeywords.join(", ") || "none"}`,
    "",
    "Job Description:",
    jobDescription,
    "",
    "Editable lines (the only lines you may rewrite):",
    JSON.stringify(candidatePayload, null, 2),
    "",
    "Full resume text for context (non-editable lines must remain unchanged):",
    resumeText,
  ].join("\n");
  const responseFormat = {
    format: {
      type: "json_schema",
      name: "resume_optimization",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          edits: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                lineNumber: { type: "integer" },
                newText: { type: "string" },
                reason: { type: "string" },
              },
              required: ["lineNumber", "newText", "reason"],
            },
          },
          changes: { type: "array", items: { type: "string" } },
          cautionNotes: { type: "array", items: { type: "string" } },
        },
        required: ["edits", "changes", "cautionNotes"],
      },
    },
  };

  async function requestParsed(promptText) {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: promptText,
      max_output_tokens: 2600,
      text: responseFormat,
    });
    const raw = response.output_text;
    return { raw, parsed: JSON.parse(raw) };
  }

  let parsed;
  let raw;
  try {
    ({ raw, parsed } = await requestParsed(prompt));
  } catch (_err) {
    return {
      mode: "ai",
      preserveFormat: true,
      lineEdits: [],
      notes: ["AI response returned non-JSON output. Returning original resume to preserve format."],
      optimizedResumeDraft: resumeText,
      rawResponse: typeof raw === "string" ? raw : "",
    };
  }

  let { optimizedResumeDraft, appliedEdits } = applyLineEditsPreservingLayout(lines, candidates, parsed.edits || []);

  const summaryCandidates = candidates.filter((c) => c.type === "summary_line");
  const experienceCandidates = candidates.filter((c) => c.type === "experience_bullet" || c.type === "experience_line");
  const summaryEdits = appliedEdits.filter((e) => e.type === "summary_line").length;
  const experienceEdits = appliedEdits.filter((e) => e.type === "experience_bullet" || e.type === "experience_line").length;
  const summaryTarget = Math.min(2, summaryCandidates.length);
  const experienceTarget = Math.min(5, experienceCandidates.length);

  const needsRetry =
    (summaryTarget > 0 && summaryEdits < summaryTarget) ||
    (experienceTarget > 0 && experienceEdits < Math.min(3, experienceTarget));

  if (needsRetry) {
    const retryPrompt = [
      prompt,
      "",
      "RETRY INSTRUCTIONS (you under-edited key sections in the previous attempt):",
      `- Must include summary edits on these lineNumbers when available: ${summaryCandidates.slice(0, 4).map((c) => c.lineNumber).join(", ") || "none"}`,
      `- Must include experience edits on these lineNumbers when available: ${experienceCandidates.slice(0, 12).map((c) => c.lineNumber).join(", ") || "none"}`,
      "- Do not return no-op edits.",
      "- Prioritize summary + experience changes first, then skills.",
    ].join("\n");

    try {
      const retry = await requestParsed(retryPrompt);
      const retryApplied = applyLineEditsPreservingLayout(lines, candidates, retry.parsed.edits || []);
      const retrySummaryEdits = retryApplied.appliedEdits.filter((e) => e.type === "summary_line").length;
      const retryExperienceEdits = retryApplied.appliedEdits.filter((e) => e.type === "experience_bullet" || e.type === "experience_line").length;
      const retryIsBetter =
        retrySummaryEdits > summaryEdits ||
        (retrySummaryEdits === summaryEdits && retryExperienceEdits > experienceEdits) ||
        (retrySummaryEdits === summaryEdits && retryExperienceEdits === experienceEdits && retryApplied.appliedEdits.length > appliedEdits.length);

      if (retryIsBetter) {
        parsed = retry.parsed;
        raw = retry.raw;
        optimizedResumeDraft = retryApplied.optimizedResumeDraft;
        appliedEdits = retryApplied.appliedEdits;
      }
    } catch (_retryErr) {
      // Keep the first valid structured result if retry fails.
    }
  }

  return {
    mode: "ai",
    preserveFormat: true,
    lineEdits: appliedEdits.map((e) => ({
      lineNumber: e.lineNumber,
      newText: e.after,
      type: e.type,
      reason: e.reason,
    })),
    notes: [
      "Format-preserving mode: only selected bullet/summary/skills lines were updated; headings/order/layout text structure was kept.",
      ...(analysis?.metadata?.source && analysis.metadata.source !== "textarea"
        ? ["For uploaded DOCX/PDF resumes, this preserves extracted text structure, not the original visual page layout."]
        : []),
      `Applied ${appliedEdits.length} line edits out of ${candidates.length} eligible lines.`,
      ...(parsed.changes || []),
      ...(parsed.cautionNotes || []),
    ].slice(0, 12),
    optimizedResumeDraft,
    appliedEdits: appliedEdits.map((e) => ({
      lineNumber: e.lineNumber,
      type: e.type,
      reason: e.reason,
      before: e.before,
      after: e.after,
    })),
  };
}

module.exports = { generateOptimizedResumeDraft };
