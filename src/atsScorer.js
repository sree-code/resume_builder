const STOPWORDS = new Set([
  "a", "an", "and", "the", "to", "for", "of", "in", "on", "at", "by", "with", "or", "as", "is", "are", "be", "from",
  "that", "this", "it", "you", "your", "our", "we", "will", "can", "should", "must", "have", "has", "had", "do", "does",
  "did", "who", "what", "when", "where", "why", "how", "about", "into", "within", "across", "through", "over", "under",
  "required", "preferred", "plus", "experience", "years", "year", "ability", "strong", "excellent", "good", "using",
  "work", "working", "role", "team", "teams", "candidate", "job", "position", "responsibilities", "requirements",
  "including", "knowledge", "understanding", "support", "develop", "development", "design", "build", "building",
  "based", "related", "ability", "preferred", "required", "etc",
]);

const COMMON_SKILLS = [
  "javascript", "typescript", "node.js", "node", "react", "next.js", "nextjs", "angular", "vue", "html", "css", "sass",
  "tailwind", "python", "java", "c#", "c++", "go", "golang", "rust", "sql", "postgresql", "mysql", "mongodb", "redis",
  "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "graphql", "rest", "rest api", "microservices", "ci/cd",
  "git", "github", "gitlab", "jira", "figma", "agile", "scrum", "data analysis", "machine learning", "ai", "openai",
  "llm", "nlp", "excel", "power bi", "tableau", "salesforce", "sap", "testing", "jest", "playwright", "cypress",
];

const SECTION_HEADERS = [
  "summary", "professional summary", "profile", "experience", "work experience", "employment",
  "skills", "technical skills", "projects", "education", "certifications", "achievements",
];

const ROLE_WORDS = ["engineer", "developer", "analyst", "manager", "architect", "scientist", "designer", "consultant"];

function normalizeText(text) {
  return (text || "")
    .replace(/\r/g, "\n")
    .replace(/[•·▪◦]/g, "-")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#./ -]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function unique(arr) {
  return [...new Set(arr)];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countRegex(text, pattern) {
  const match = text.match(pattern);
  return match ? match.length : 0;
}

function extractPhrases(jobDescription) {
  const text = normalizeText(jobDescription);
  const lower = text.toLowerCase();
  const phrases = new Set();

  for (const skill of COMMON_SKILLS) {
    if (lower.includes(skill.toLowerCase())) phrases.add(skill.toLowerCase());
  }

  const acronymMatches = text.match(/\b[A-Z][A-Z0-9]{1,}\b/g) || [];
  acronymMatches.forEach((a) => phrases.add(a.toLowerCase()));

  const phraseMatches = text.match(/\b([A-Za-z][A-Za-z0-9+.#]*(?:[ /-][A-Za-z0-9+.#]+){1,2})\b/g) || [];
  for (const phrase of phraseMatches) {
    const normalized = phrase.toLowerCase().replace(/[.,;:]+$/g, "").trim();
    const tokens = normalized.split(/[ /-]+/).filter(Boolean);
    if (
      tokens.length >= 2 &&
      tokens.length <= 3 &&
      tokens.every((t) => !STOPWORDS.has(t)) &&
      tokens.every((t) => t.length > 1) &&
      !tokens.some((t) => /^\d+$/.test(t))
    ) {
      phrases.add(normalized);
    }
  }

  const singleTokens = tokenize(text)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .filter((t) => /[a-z]/.test(t))
    .filter((t) => !/[.,;:]$/.test(t));

  const freq = new Map();
  for (const token of singleTokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  const topSingles = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([token]) => token);

  topSingles.forEach((t) => phrases.add(t));

  const filtered = [...phrases]
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 2)
    .filter((p) => !STOPWORDS.has(p))
    .filter((p) => p !== "and" && p !== "or")
    .filter((p) => !/[.,;:]$/.test(p))
    .filter((p) => !/\b(with|and|or|for|to)\b/.test(p) || COMMON_SKILLS.includes(p));

  return unique(filtered);
}

function extractLikelyJobTitles(jobDescription) {
  const lines = normalizeText(jobDescription).split("\n").map((l) => l.trim()).filter(Boolean);
  const titles = new Set();

  for (const line of lines.slice(0, 15)) {
    const lower = line.toLowerCase();
    if (ROLE_WORDS.some((w) => lower.includes(w)) && line.length <= 100) {
      titles.add(lower);
    }
  }

  const titlePattern = /\b(senior|sr\.?|lead|principal|staff|junior|jr\.?)?\s*(software|data|product|frontend|front-end|backend|back-end|full[- ]stack|devops|ml|ai)?\s*(engineer|developer|analyst|manager|architect|scientist|designer)\b/gi;
  const matches = normalizeText(jobDescription).match(titlePattern) || [];
  matches.forEach((m) => titles.add(m.toLowerCase().trim()));

  return unique([...titles]).slice(0, 10);
}

function splitSections(resumeText) {
  const lines = normalizeText(resumeText).split("\n");
  const presentHeaders = [];
  for (const header of SECTION_HEADERS) {
    const regex = new RegExp(`(^|\\n)\\s*${escapeRegex(header)}\\s*(:|-)?\\s*(\\n|$)`, "i");
    if (regex.test(resumeText)) presentHeaders.push(header);
  }
  return {
    presentHeaders: unique(presentHeaders),
    lines,
  };
}

function scoreKeywordCoverage(jobKeywords, resumeText) {
  const lowerResume = resumeText.toLowerCase();
  const keywordWeights = jobKeywords.map((keyword) => {
    let weight = 1;
    if (COMMON_SKILLS.includes(keyword)) weight = 3;
    if (keyword.includes(" ") && keyword.split(" ").length >= 2) weight += 1;
    if (/^(aws|gcp|azure|sql|api|react|node|python|java|docker|kubernetes)$/.test(keyword)) weight += 1;
    return { keyword, weight };
  });

  const matched = [];
  const missing = [];
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const item of keywordWeights) {
    totalWeight += item.weight;
    const pattern = new RegExp(`\\b${escapeRegex(item.keyword).replace(/\\ /g, "\\s+")}\\b`, "i");
    if (pattern.test(lowerResume)) {
      matched.push(item);
      matchedWeight += item.weight;
    } else {
      missing.push(item);
    }
  }

  const rawCoverage = totalWeight ? matchedWeight / totalWeight : 0;

  return {
    rawCoverage,
    score: Math.round(rawCoverage * 45),
    matchedKeywords: matched.sort((a, b) => b.weight - a.weight).map((x) => x.keyword),
    missingKeywords: missing.sort((a, b) => b.weight - a.weight).map((x) => x.keyword),
  };
}

function scoreSectionCompleteness(resumeText) {
  const { presentHeaders } = splitSections(resumeText.toLowerCase());
  const baseRequired = ["experience", "skills", "education"];
  const bonus = ["summary", "projects", "certifications"];

  let points = 0;
  const missingSections = [];
  for (const section of baseRequired) {
    if (presentHeaders.some((h) => h.includes(section))) points += 4;
    else missingSections.push(section);
  }

  for (const section of bonus) {
    if (presentHeaders.some((h) => h.includes(section))) points += 1;
  }

  points = Math.min(points + 2, 15); // small bias to avoid over-penalizing simple resumes

  return {
    score: Math.min(15, points),
    presentSections: presentHeaders,
    missingSections,
  };
}

function scoreFormattingReadability(resumeText) {
  const text = normalizeText(resumeText);
  let score = 15;
  const risks = [];

  const longLines = text.split("\n").filter((line) => line.length > 180).length;
  if (longLines > 2) {
    score -= 3;
    risks.push("Very long lines detected; ATS parsers may misread multi-column or compressed formatting.");
  }

  if (/[│┌┐└┘╔╗╚╝]/.test(text)) {
    score -= 4;
    risks.push("Table/box-drawing characters detected; many ATS systems parse these poorly.");
  }

  const bulletCount = countRegex(text, /^\s*[-*]\s+/gm);
  if (bulletCount < 4) {
    score -= 2;
    risks.push("Few bullet points detected; recruiter-facing readability may be low.");
  }

  if ((text.match(/https?:\/\/\S+/g) || []).length > 6) {
    score -= 1;
    risks.push("Too many raw URLs can reduce resume readability.");
  }

  if ((text.match(/\b[A-Z]{8,}\b/g) || []).length > 10) {
    score -= 2;
    risks.push("Excessive ALL CAPS text can hurt parsing and readability.");
  }

  if (text.length < 500) {
    score -= 3;
    risks.push("Resume content is very short for strong keyword matching.");
  }

  if (score === 15) {
    risks.push("Formatting looks ATS-friendly based on text heuristics.");
  }

  return { score: Math.max(0, score), risks };
}

function scoreRoleAlignment(jobTitles, resumeText) {
  const lowerResume = resumeText.toLowerCase();
  if (!jobTitles.length) {
    return { score: 8, matchedTitle: null };
  }

  for (const title of jobTitles) {
    if (lowerResume.includes(title)) {
      return { score: 10, matchedTitle: title };
    }
  }

  const titleTokenSet = new Set(tokenize(jobTitles.join(" ")).filter((t) => !STOPWORDS.has(t)));
  const resumeTokenSet = new Set(tokenize(lowerResume));
  let overlap = 0;
  for (const token of titleTokenSet) {
    if (resumeTokenSet.has(token)) overlap += 1;
  }
  const ratio = titleTokenSet.size ? overlap / titleTokenSet.size : 0;
  return {
    score: Math.round(ratio * 10),
    matchedTitle: null,
  };
}

function scoreImpactEvidence(resumeText) {
  const text = normalizeText(resumeText);
  const numberHits = countRegex(text, /\b\d+(?:\.\d+)?%?\b/g);
  const actionVerbHits = countRegex(
    text.toLowerCase(),
    /\b(led|built|designed|implemented|improved|reduced|increased|developed|optimized|automated|launched|delivered)\b/g
  );

  let score = 0;
  if (numberHits >= 6) score += 3;
  else if (numberHits >= 3) score += 2;
  else if (numberHits >= 1) score += 1;

  if (actionVerbHits >= 6) score += 2;
  else if (actionVerbHits >= 3) score += 1;

  return {
    score: Math.min(5, score),
    signals: { quantifiedBullets: numberHits, actionVerbs: actionVerbHits },
  };
}

function scoreKeywordPlacement(resumeText, topKeywords) {
  const text = normalizeText(resumeText);
  const topSlice = text.slice(0, Math.min(1500, text.length)).toLowerCase();
  const skillsSectionMatch = text.match(/(?:technical\s+skills|skills)\s*[:\n-]([\s\S]{0,800})/i);
  const skillsText = (skillsSectionMatch?.[1] || "").toLowerCase();

  const important = topKeywords.slice(0, 10);
  if (!important.length) return { score: 8 };

  let points = 0;
  for (const keyword of important) {
    const pattern = new RegExp(`\\b${escapeRegex(keyword).replace(/\\ /g, "\\s+")}\\b`, "i");
    if (pattern.test(topSlice)) points += 1;
    if (skillsText && pattern.test(skillsText)) points += 1;
  }

  const maxPoints = important.length * 2;
  return { score: Math.round((points / Math.max(1, maxPoints)) * 10) };
}

function buildSuggestions(analysisParts) {
  const suggestions = [];

  if (analysisParts.keywordCoverage.missingKeywords.length) {
    const topMissing = analysisParts.keywordCoverage.missingKeywords.slice(0, 12);
    suggestions.push({
      type: "keywords",
      priority: "high",
      title: "Add missing JD keywords (only where truthful)",
      detail: `Prioritize these terms in summary, skills, and experience bullets: ${topMissing.join(", ")}.`,
    });
  }

  if (analysisParts.sections.missingSections.length) {
    suggestions.push({
      type: "sections",
      priority: "medium",
      title: "Add standard resume sections",
      detail: `Missing common ATS-friendly sections: ${analysisParts.sections.missingSections.join(", ")}.`,
    });
  }

  const formattingRisks = analysisParts.formatting.risks.filter((r) => !r.includes("looks ATS-friendly"));
  if (formattingRisks.length) {
    suggestions.push({
      type: "formatting",
      priority: "medium",
      title: "Simplify formatting for ATS parsing",
      detail: formattingRisks[0],
    });
  }

  if (analysisParts.impact.score < 3) {
    suggestions.push({
      type: "impact",
      priority: "medium",
      title: "Increase quantified impact",
      detail: "Rewrite experience bullets with metrics (%, $, time saved, scale, latency, users, revenue, incidents).",
    });
  }

  if (analysisParts.keywordPlacement.score < 6) {
    suggestions.push({
      type: "placement",
      priority: "high",
      title: "Improve keyword placement",
      detail: "Mirror top JD terms in your summary/headline and technical skills section to improve early ATS relevance.",
    });
  }

  return suggestions;
}

function analyzeResumeAgainstJob({ jobDescription, resumeText, metadata = {} }) {
  const normalizedJD = normalizeText(jobDescription);
  const normalizedResume = normalizeText(resumeText);

  const jdKeywords = extractPhrases(normalizedJD);
  const jobTitles = extractLikelyJobTitles(normalizedJD);

  const keywordCoverage = scoreKeywordCoverage(jdKeywords, normalizedResume);
  const sections = scoreSectionCompleteness(normalizedResume);
  const formatting = scoreFormattingReadability(normalizedResume);
  const roleAlignment = scoreRoleAlignment(jobTitles, normalizedResume);
  const impact = scoreImpactEvidence(normalizedResume);
  const keywordPlacement = scoreKeywordPlacement(normalizedResume, keywordCoverage.missingKeywords.length ? keywordCoverage.matchedKeywords.concat(keywordCoverage.missingKeywords) : jdKeywords);

  const score = Math.min(
    100,
    keywordCoverage.score +
      sections.score +
      formatting.score +
      roleAlignment.score +
      impact.score +
      keywordPlacement.score
  );

  const scoreBand =
    score >= 85 ? "Excellent match" :
    score >= 70 ? "Strong match" :
    score >= 50 ? "Moderate match" :
    "Needs improvement";

  const suggestions = buildSuggestions({ keywordCoverage, sections, formatting, roleAlignment, impact, keywordPlacement });

  return {
    score,
    scoreBand,
    disclaimer:
      "This is a simulated ATS match score (resume-vs-job alignment). Real ATS systems vary and recruiters still review relevance, truthfulness, and impact.",
    breakdown: {
      keywordCoverage: { max: 45, score: keywordCoverage.score },
      sections: { max: 15, score: sections.score },
      formatting: { max: 15, score: formatting.score },
      roleAlignment: { max: 10, score: roleAlignment.score },
      impactEvidence: { max: 5, score: impact.score },
      keywordPlacement: { max: 10, score: keywordPlacement.score },
    },
    insights: {
      extractedJobTitles: jobTitles,
      matchedTitle: roleAlignment.matchedTitle,
      topMatchedKeywords: keywordCoverage.matchedKeywords.slice(0, 20),
      topMissingKeywords: keywordCoverage.missingKeywords.slice(0, 20),
      presentSections: sections.presentSections,
      missingSections: sections.missingSections,
      formattingNotes: formatting.risks,
      impactSignals: impact.signals,
      estimatedKeywordPoolSize: jdKeywords.length,
    },
    suggestions,
    metadata,
  };
}

module.exports = {
  analyzeResumeAgainstJob,
};
