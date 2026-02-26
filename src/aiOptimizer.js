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

function detectOverallExperienceYears(resumeText) {
  const text = String(resumeText || "");
  const matches = [...text.matchAll(/(\d{1,2})\s*\+?\s*years?(?:\s+of)?\s+experience/gi)];
  const values = matches
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 45);
  if (!values.length) return 7;
  // Prefer realistic total experience values and avoid tech-specific counts like "Java (18+)" without "experience".
  return values[0];
}

function normalizeSummaryYearsText(text, overallYears) {
  const years = Number.isFinite(overallYears) ? overallYears : 7;
  return String(text || "").replace(/\b(\d{1,2})\s*\+?\s*years?\b/gi, (full, n, offset, src) => {
    const nearby = src.slice(Math.max(0, offset - 20), Math.min(src.length, offset + full.length + 30)).toLowerCase();
    if (!/experience|developer|engineer|software/.test(nearby)) return full;
    return `${years}+ years`;
  });
}

function lineStartsWithWeakVerb(line) {
  return /^(?:[-*•]\s*)?(applied|experienced in)\b/i.test(String(line || "").trim());
}

function isLegacyGeneratedArtifactLine(line) {
  const normalized = String(line || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("improved production engineering outcomes by using ") ||
    normalized.startsWith("- improved production engineering outcomes by using ")
  );
}

function countLegacyGeneratedArtifactLines(resumeText) {
  return String(resumeText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isLegacyGeneratedArtifactLine).length;
}

function improveWeakGeneratedLineStyle(text, candidateType) {
  let line = String(text || "");
  if (!lineStartsWithWeakVerb(line)) return line;
  if (candidateType === "summary_line") {
    line = line.replace(/^\s*experienced in\b/i, "Senior engineer with 7+ years of experience in");
    line = line.replace(/^\s*applied\b/i, "Experienced in");
    return line;
  }
  if (/^\s*[-*•]\s*applied\b/i.test(line)) {
    line = line.replace(/^(\s*[-*•]\s*)applied\b/i, "$1Improved");
  } else {
    line = line.replace(/^\s*applied\b/i, "Improved");
  }
  return line;
}

function isProtectedExperienceMetadataLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return true;
  if (/^(project|overview|client|environment|responsibilities?|role)\s*:/i.test(trimmed)) return true;
  if (/implementation partner\s*-/i.test(trimmed)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(trimmed) && /\b\d{4}\b/.test(trimmed)) return true;
  if (/[A-Za-z]+\s*,\s*[A-Z]{2}\s*[\-|·]\s*/.test(trimmed)) return true;
  if (!/[.!?]/.test(trimmed) && trimmed.split(/\s+/).length <= 7) return true;
  if (/^[A-Z][A-Za-z0-9&/ .-]+$/.test(trimmed) && trimmed.split(/\s+/).length <= 5) return true;
  return false;
}

function looksLikeExperienceBulletText(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || isProtectedExperienceMetadataLine(trimmed)) return false;
  if (trimmed.length < 45) return false;
  if (/^(this project|the project|responsible for)\b/i.test(trimmed)) return false;
  const startsWithAction = /^(architected|built|owned|delivered|implemented|improved|optimized|designed|developed|led|modernized|created|diagnosed|reduced|increased|collaborated|standardized|guided|strengthened)\b/i.test(trimmed);
  const hasSignal = /(?:\b\d+%|\bmillions?\b|\blatency\b|\bperformance\b|\breliability\b|\bscal\w+\b|\bproduction\b|\bapi\b|\bservices?\b)/i.test(trimmed);
  return startsWithAction || hasSignal;
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

    if (isLegacyGeneratedArtifactLine(raw)) {
      if (currentSection === "experience") sectionBodyCount += 1;
      return;
    }

    if (isBulletLine(raw) || (currentSection === "experience" && looksLikeExperienceBulletText(raw))) {
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

    // Do not rewrite non-bullet experience lines in line-preserving mode.
    // These are often company/title/date/project metadata and can corrupt layout when edited.
    if (currentSection === "experience" && !isProtectedExperienceMetadataLine(trimmed)) {
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
  const overallYears = detectOverallExperienceYears(lines.join("\n"));

  for (const edit of edits || []) {
    if (!edit || typeof edit.lineNumber !== "number" || typeof edit.newText !== "string") continue;
    if (seen.has(edit.lineNumber)) continue;
    const candidate = byLine.get(edit.lineNumber);
    if (!candidate) continue;

    let newText = edit.newText.replace(/\r?\n/g, " ").trimEnd();
    if (!newText.trim()) continue;
    newText = improveWeakGeneratedLineStyle(newText, candidate.type);
    if (
      candidate.type === "summary_line" ||
      candidate.type === "experience_line" ||
      candidate.type === "experience_bullet" ||
      candidate.type === "achievement_bullet"
    ) {
      newText = normalizeSummaryYearsText(newText, overallYears);
    }

    if (candidate.type === "bullet") {
      const prefixMatch = candidate.originalText.match(/^(\s*[-*•]\s+)/);
      const prefix = prefixMatch ? prefixMatch[1] : "- ";
      newText = newText.replace(/^\s*[-*•]\s+/, "");
      newText = prefix + newText.trim();
    } else if (candidate.type === "experience_bullet" || candidate.type === "achievement_bullet") {
      const prefixMatch = candidate.originalText.match(/^(\s*[-*•]\s+)/);
      const prefix = prefixMatch ? prefixMatch[1] : "";
      newText = newText.replace(/^\s*[-*•]\s+/, "");
      newText = prefix ? prefix + newText.trim() : extractLeadingWhitespace(candidate.originalText) + newText.trim();
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
    if (candidate.type === "experience_bullet" && lineStartsWithWeakVerb(newText)) continue;
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

function normalizeKeywordPhrase(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

const LOW_SIGNAL_GENERATOR_KEYWORDS = new Set([
  "contribute",
  "acceptance",
  "necessary",
  "execute",
  "detect",
  "manual",
  "methodology",
  "passion",
  "driving",
  "orientated",
  "quality",
  "information",
  "systems",
  "system",
  "product",
  "products",
  "services",
  "technical tools",
  "manual test cases",
  "deliver multiple projects",
  "methodology while reviewing",
  "passion around driving",
  "orientated language",
  "product quality",
  "information systems",
  "system/product/services",
  "basic",
  "qualifications",
  "basic qualifications",
  "deeply",
  "understand",
  "different",
  "such",
  "verbal",
  "continuously",
  "innovate",
  "self-serving",
  "steps",
  "step",
  "compilation",
  "fix",
  "degree",
  "masters",
  "computer engineering",
  "electrical engineering",
  "excel",
]);

const STRONG_SINGLE_GENERATOR_KEYWORDS = new Set([
  "java", "go", "golang", "c#", "aws", "azure", "gcp", "terraform", "kafka", "redis", "sql",
  "latency", "reliability", "correctness", "mentoring", "architecture", "observability", "livesite",
  "indexing", "ttl", "consistency", "performance", "cloud", "ios", "android", "reactjs", "cicd", "infra",
]);

function normalizeLineForDedupe(text) {
  return String(text || "")
    .replace(/^\s*[-*•]\s+/, "")
    .toLowerCase()
    .replace(/[^\w#+/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForDedupe(text) {
  return normalizeLineForDedupe(text)
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .filter((t) => !["the", "and", "for", "with", "using", "into", "from", "across", "under", "while"].includes(t));
}

function jaccardSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function isLowSignalKeywordForGenerator(keyword) {
  const normalized = normalizeKeywordPhrase(keyword).toLowerCase();
  if (!normalized) return true;
  if (LOW_SIGNAL_GENERATOR_KEYWORDS.has(normalized)) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const token = tokens[0];
    if (STRONG_SINGLE_GENERATOR_KEYWORDS.has(token)) return false;
    if (token.length <= 3 && !["ai", "go", "bs", "ms"].includes(token)) return true;
    if (/(ed|ing|ive|ary|ory|able|tion|sion)$/.test(token) && !/(indexing|tuning|monitoring|messaging)$/.test(token)) {
      return true;
    }
  }

  return false;
}

function hasTechnicalSignal(keyword) {
  const lower = normalizeKeywordPhrase(keyword).toLowerCase();
  return /(api|service|cloud|distributed|latency|reliability|pipeline|stream|schema|serialization|index|query|cache|ttl|consistency|terraform|kafka|redis|java|go|c#|architecture|operational|performance|monitor|observability|release|mobile|ios|android|reactjs|cicd|ci\/cd|infra|compilation|deploy)/.test(lower);
}

function generatedBulletHasMetric(text) {
  return /\b\d+%|\bp\d+\b|\b\d+x\b|\bmillions?\b|\bMTTR\b/i.test(String(text || ""));
}

function ensureGeneratedBulletMetric(text, category) {
  let line = String(text || "").trim();
  if (!line) return line;
  if (generatedBulletHasMetric(line)) return line;
  const base = line.replace(/\s*\.\s*$/, "");
  const suffixByCategory = {
    mobile_release: ", reducing release turnaround time by 35% and improving release success rate by 25%.",
    process_improvement: ", reducing rollout defects by 25% and improving release predictability by 30%.",
    communication: ", reducing release blockers by 20% and accelerating issue resolution by 25%.",
    performance: ", improving response times by 25% and reducing production bottlenecks by 20%.",
    diagnostics: ", reducing MTTR by 30% and improving pipeline reliability across production workflows.",
    distributed: ", improving service stability by 20% and reducing operational incidents during peak traffic.",
    architecture: ", improving scalability and deployment consistency by 25% across production environments.",
    delivery: ", reducing release cycle time by 20% and improving delivery predictability across teams.",
    mentoring: ", improving delivery quality and review turnaround by 20% across the engineering team.",
    scope: ", improving execution predictability by 20% and reducing handoff delays across dependent teams.",
    generic: ", improving operational efficiency by 20% and reducing manual effort by 25%.",
  };
  return `${base}${suffixByCategory[category] || suffixByCategory.generic}`;
}

function shouldSkipDuplicateGeneratedInsert(afterText, existingCanonicalLines, existingTokenSets, proposedCanonicalLines) {
  const canonical = normalizeLineForDedupe(afterText);
  if (!canonical) return true;
  if (existingCanonicalLines.has(canonical)) return true;
  if (proposedCanonicalLines.has(canonical)) return true;

  // Suppress repeated generic fallback stems even if the keyword token changes.
  if (canonical.startsWith("improved production engineering outcomes by using")) {
    for (const line of existingCanonicalLines) {
      if (line.startsWith("improved production engineering outcomes by using")) return true;
    }
    for (const line of proposedCanonicalLines) {
      if (line.startsWith("improved production engineering outcomes by using")) return true;
    }
  }

  const tokens = tokenizeForDedupe(afterText);
  if (tokens.length >= 6) {
    for (const tokenSet of existingTokenSets) {
      if (jaccardSimilarity(tokens, tokenSet) >= 0.78) {
        return true;
      }
    }
  }
  return false;
}

function classifyMissingKeyword(keyword) {
  const k = normalizeKeywordPhrase(keyword).toLowerCase();
  if (!k) return "generic";
  if (/apache flink/.test(k)) return "skip";
  if (/basic qualifications|qualifications|degree|masters|computer engineering|electrical engineering/.test(k)) return "qualification";
  if (/senior software developer|technical leadership|leadership|write great code|ensuring correctness|exercising sound judgment|ic3/.test(k)) return "summary";
  if (/mobile release|release platform|high quality release|cicd|ci\/cd|compilation steps|deploying|infra|ios|android|reactjs/.test(k)) return "mobile_release";
  if (/engineering best practices|engineering process(?:es)?|engineering process improvement|improvement|continuously|innovate/.test(k)) return "process_improvement";
  if (/verbal communication skills|cross-functional communication|collaborate|manangers|managers/.test(k)) return "communication";
  if (/low latency|performance|tuning|indexing|query|cache-aside|ttl strategy|performance troubleshooting|storage(?:\/|\s+)indexing/.test(k)) return "performance";
  if (/distributed|production systems|reliability|operational|operational best practices|operational considerations|consistency tradeoffs/.test(k)) return "distributed";
  if (/diagnos|schema|serialization|state issues|data-processing|pipeline|stream-processing|enrichment(?:\/|\s+)augmentation/.test(k)) return "diagnostics";
  if (/architecture|cloud architecture|public cloud/.test(k)) return "architecture";
  if (/iterative delivery|changing needs/.test(k)) return "delivery";
  if (/guide other engineers|lower-level engineers/.test(k)) return "mentoring";
  if (/complex tasks/.test(k)) return "scope";
  return "generic";
}

function buildKeywordGroups(rawKeywords) {
  const normalized = [...new Set((rawKeywords || []).map(normalizeKeywordPhrase).filter(Boolean))];
  const lowerSet = new Set(normalized.map((k) => k.toLowerCase()));
  const used = new Set();
  const groups = [];

  const compositeGroups = [
    {
      needsAll: ["review", "written", "peers"],
      label: "review code written by peers",
    },
    {
      needsAll: ["meet changing needs", "changing needs"],
      label: "meet changing needs",
    },
    {
      needsAll: ["processes", "procedures"],
      label: "processes and procedures",
    },
    {
      needsAll: ["operational considerations", "operational best practices"],
      label: "operational considerations and best practices",
    },
    {
      needsAll: ["indexing/query patterns", "storage/indexing"],
      label: "storage/indexing and query patterns",
    },
    {
      needsAll: ["guide other engineers", "lower-level engineers"],
      label: "guide lower-level engineers",
    },
    {
      needsAll: ["improving performance", "performance troubleshooting"],
      label: "performance troubleshooting and optimization",
    },
    {
      needsAll: ["ttl strategy", "consistency tradeoffs"],
      label: "ttl strategy and consistency tradeoffs",
    },
    {
      needsAll: ["ios", "android", "reactjs"],
      label: "ios android reactjs release workflows",
    },
  ];

  for (const g of compositeGroups) {
    const present = g.needsAll.filter((token) => lowerSet.has(token));
    if (present.length === g.needsAll.length) {
      present.forEach((token) => {
        const original = normalized.find((k) => k.toLowerCase() === token);
        if (original) used.add(original);
      });
      groups.push({
        keyword: g.label,
        sourceKeywords: normalized.filter((k) => g.needsAll.includes(k.toLowerCase())),
      });
    }
  }

  const anyGroups = [
    {
      needsAny: ["mobile release processes", "release platform tools", "high quality release", "deploying"],
      minAny: 2,
      label: "mobile release process and platform tooling",
    },
    {
      needsAny: ["cicd", "compilation steps", "deploying", "infra"],
      minAny: 2,
      label: "mobile ci/cd compilation and deployment",
    },
    {
      needsAny: ["engineering best practices", "engineering processes", "improvement", "continuously", "innovate"],
      minAny: 2,
      label: "engineering best practices and continuous process improvement",
    },
    {
      needsAny: ["verbal communication skills", "collaborate", "manangers", "managers"],
      minAny: 2,
      label: "cross-functional collaboration and verbal communication",
    },
  ];

  for (const g of anyGroups) {
    const present = g.needsAny.filter((token) => lowerSet.has(token));
    if (present.length < (g.minAny || 2)) continue;
    present.forEach((token) => {
      const original = normalized.find((k) => k.toLowerCase() === token);
      if (original) used.add(original);
    });
    groups.push({
      keyword: g.label,
      sourceKeywords: normalized.filter((k) => present.includes(k.toLowerCase())),
    });
  }

  for (const keyword of normalized) {
    if (used.has(keyword)) continue;
    groups.push({ keyword, sourceKeywords: [keyword] });
  }
  return groups;
}

function buildSummaryProposalText(keyword) {
  const k = normalizeKeywordPhrase(keyword);
  const lower = k.toLowerCase();
  if (/senior software developer/.test(lower)) {
    return `Senior software developer with 7+ years of experience building scalable distributed systems, modern web applications, and production-grade backend services.`;
  }
  if (/technical leadership|leadership/.test(lower)) {
    return `Provide technical leadership across design reviews, architecture decisions, and iterative delivery for customer-facing distributed services.`;
  }
  if (/ensuring correctness/.test(lower)) {
    return `Focused on ensuring correctness, production reliability, and systematic problem-solving across high-scale application and service workflows.`;
  }
  if (/write great code/.test(lower)) {
    return `Known for write great code standards through pragmatic design, maintainable implementations, and strong peer collaboration.`;
  }
  if (/exercising sound judgment|sound judgment/.test(lower)) {
    return `Exercises sound judgment across complex tasks, production tradeoffs, and incremental delivery decisions in distributed systems.`;
  }
  if (/ic3/.test(lower)) {
    return `Senior IC-level engineer with strong ownership across design, implementation, operational reliability, and delivery of complex software tasks.`;
  }
  return `Senior engineer with 7+ years of experience in ${k}, distributed application development, and production-focused delivery.`;
}

function buildExperienceInsertText(keyword) {
  const k = normalizeKeywordPhrase(keyword);
  const lower = k.toLowerCase();
  if (!k || isLowSignalKeywordForGenerator(k)) return null;
  if (/qualification/.test(lower) || /computer engineering|electrical engineering|degree|masters/.test(lower)) return null;
  if (/mobile release process and platform tooling|mobile release engineering|mobile release processes|release platform tools|high quality release/.test(lower)) {
    return `- Standardized mobile release processes across customer-facing applications by defining release platform tooling, quality gates, and deployment checklists, reducing failed releases by 35% and improving on-time release completion by 30%.`;
  }
  if (/mobile ci\/cd compilation and deployment|cicd|ci\/cd|compilation steps|deploying|infra/.test(lower)) {
    return `- Automated CI/CD compilation and deployment steps for mobile/web release pipelines using release tooling and infrastructure checks, cutting manual release effort by 50% and reducing deployment turnaround time by 40%.`;
  }
  if (/ios android reactjs release workflows|ios|android|reactjs/.test(lower)) {
    return `- Improved cross-platform iOS/Android release workflows for ReactJS-based features by standardizing build validation and rollout coordination, reducing platform-specific release defects by 30% and improving release consistency.`;
  }
  if (/engineering best practices and continuous process improvement|engineering best practices|engineering process improvement|engineering processes/.test(lower)) {
    return `- Established engineering best practices and release engineering processes with continuous improvement loops and quality reviews, reducing rollback incidents by 30% and increasing release predictability by 25%.`;
  }
  if (/cross-functional collaboration and verbal communication|verbal communication skills|collaborate|manangers|managers/.test(lower)) {
    return `- Collaborated with engineering managers and cross-functional teams to communicate release readiness, risks, and deployment plans, reducing release blockers by 25% and improving incident triage turnaround by 20%.`;
  }
  if (/low latency|performance tuning|improving performance/.test(lower)) {
    return `- Improved low latency API and UI response paths through profiling, performance tuning, and iterative optimization in distributed production systems.`;
  }
  if (/performance troubleshooting/.test(lower)) {
    return `- Performed performance troubleshooting across APIs, database access paths, and service interactions to identify bottlenecks and improve production responsiveness.`;
  }
  if (/distributed production systems|highly distributed systems|distributed systems/.test(lower)) {
    return `- Built and supported highly distributed systems in production, improving service resilience, observability, and operational response for customer-facing workflows.`;
  }
  if (/diagnosing data-processing|schema\/serialization problems|state issues/.test(lower)) {
    return `- Diagnosed data-processing and state issues, including schema/serialization problems, to restore pipeline reliability and improve correctness in production integrations.`;
  }
  if (/pipeline reliability issues/.test(lower)) {
    return `- Investigated pipeline reliability issues across service integrations and implemented fixes that improved stability, retries, and operational visibility.`;
  }
  if (/stream-processing architectures/.test(lower)) {
    return `- Designed and supported stream-processing architectures for near real-time workflows, emphasizing reliability, monitoring, and operational recovery paths.`;
  }
  if (/enrichment(?:\/|\s+)augmentation/.test(lower)) {
    return `- Built enrichment/augmentation steps in data and service workflows to improve downstream processing quality, consistency, and business usability.`;
  }
  if (/indexing\/query patterns|indexing|query patterns/.test(lower)) {
    return `- Improved indexing/query patterns and backend access paths to reduce latency and improve performance under high-scale workloads.`;
  }
  if (/storage(?:\/|\s+)indexing/.test(lower)) {
    return `- Optimized storage/indexing design and query access patterns to improve throughput, reduce latency, and support high-scale production usage.`;
  }
  if (/ttl strategy/.test(lower)) {
    return `- Implemented TTL strategy in caching/data retention flows to balance data freshness, performance, and operational simplicity for production workloads.`;
  }
  if (/consistency tradeoffs/.test(lower)) {
    return `- Evaluated consistency tradeoffs in distributed workflows and selected pragmatic designs aligned with reliability, performance, and business needs.`;
  }
  if (/cache-aside patterns/.test(lower)) {
    return `- Implemented cache-aside patterns for frequently accessed data to improve throughput, reduce backend load, and support low latency responses.`;
  }
  if (/cloud architecture|public cloud platform/.test(lower)) {
    return `- Contributed to cloud architecture decisions on public cloud platform services, aligning implementation choices with scalability and operational considerations.`;
  }
  if (/iterative delivery model/.test(lower)) {
    return `- Delivered features using an iterative delivery model with phased rollouts, validation feedback, and continuous improvement across production services.`;
  }
  if (/operational considerations/.test(lower)) {
    return `- Incorporated operational considerations into service design, including monitoring, failure handling, deployment safety, and support readiness.`;
  }
  if (/operational best practices/.test(lower)) {
    return `- Standardized operational best practices for observability, incident response readiness, and deployment hygiene across distributed services.`;
  }
  if (/ensuring correctness/.test(lower)) {
    return `- Strengthened service correctness with defensive validation, testing, and production diagnostics for distributed APIs and data flows.`;
  }
  if (/guide other engineers|lower-level engineers/.test(lower)) {
    return `- Guided other engineers, including lower-level engineers, through design reviews, implementation tradeoffs, and delivery of complex production tasks.`;
  }
  if (/complex tasks/.test(lower)) {
    return `- Owned complex tasks end-to-end by breaking scope into iterative deliverables, coordinating dependencies, and driving implementation to production readiness.`;
  }
  if (/exercising sound judgment/.test(lower)) {
    return `- Exercised sound judgment during production incidents and delivery decisions, balancing correctness, timelines, and operational risk.`;
  }
  if (/changing needs/.test(lower)) {
    return `- Adapted designs and implementation plans to changing needs while maintaining delivery momentum, service reliability, and code quality.`;
  }
  if (!hasTechnicalSignal(lower)) return null;
  if (lower.split(/\s+/).length === 1 && !STRONG_SINGLE_GENERATOR_KEYWORDS.has(lower)) return null;
  return `- Strengthened distributed service reliability and delivery quality by applying ${k} in production engineering workflows and operational support improvements.`;
}

function generateSupplementalPointProposals({ analysis, resumeText, maxProposals = 24 }) {
  const missingKeywords = (analysis?.insights?.topMissingKeywords || []).slice(0, 30);
  if (!missingKeywords.length) return [];

  const { candidates } = buildEditableLineCandidates(resumeText);
  const overallYears = detectOverallExperienceYears(resumeText);
  const summaryCandidates = candidates.filter((c) => c.type === "summary_line");
  const experienceAnchors = candidates.filter((c) => c.type === "experience_bullet" && !isLegacyGeneratedArtifactLine(c.originalText));
  const existingCanonicalLines = new Set(
    String(resumeText || "")
      .split(/\r?\n/)
      .map((line) => normalizeLineForDedupe(line))
      .filter(Boolean)
  );
  const existingExperienceTokenSets = experienceAnchors
    .map((c) => tokenizeForDedupe(c.originalText))
    .filter((tokens) => tokens.length >= 4);

  if (!summaryCandidates.length && !experienceAnchors.length) return [];

  const groups = buildKeywordGroups(missingKeywords);
  const proposals = [];
  const proposedInsertCanonicals = new Set();
  const usedSummaryLines = new Set();
  let summaryCursor = 0;
  let experienceCursor = 0;

  for (const group of groups) {
    if (proposals.length >= maxProposals) break;
    const keyword = group.keyword;
    if (isLowSignalKeywordForGenerator(keyword)) continue;
    const category = classifyMissingKeyword(keyword);
    if (category === "skip" || category === "qualification") continue;

    const sourceKeywords = group.sourceKeywords || [keyword];
    if (category === "summary" && summaryCandidates.length) {
      let anchor = summaryCandidates.find((c) => !usedSummaryLines.has(c.lineNumber));
      if (!anchor) {
        anchor = summaryCandidates[summaryCursor % summaryCandidates.length];
      }
      summaryCursor += 1;
      usedSummaryLines.add(anchor.lineNumber);
      proposals.push({
        operation: "replace_line",
        lineNumber: anchor.lineNumber,
        type: "summary_line",
        targetArea: "Professional Summary",
        reason: `Add explicit senior-level evidence for missing keyword(s): ${sourceKeywords.join(", ")}`,
        before: anchor.originalText,
        after: normalizeSummaryYearsText(buildSummaryProposalText(keyword), overallYears),
        addedKeywords: sourceKeywords,
        affectsMandatoryKeyword: true,
        generatedBy: "mandatory_keyword_generator",
        anchorText: anchor.originalText,
      });
      continue;
    }

    if (experienceAnchors.length) {
      const anchor = experienceAnchors[experienceCursor % experienceAnchors.length];
      experienceCursor += 1;
      let afterText = buildExperienceInsertText(keyword);
      if (!afterText) continue;
      afterText = ensureGeneratedBulletMetric(afterText, category);
      if (shouldSkipDuplicateGeneratedInsert(afterText, existingCanonicalLines, existingExperienceTokenSets, proposedInsertCanonicals)) {
        continue;
      }
      proposedInsertCanonicals.add(normalizeLineForDedupe(afterText));
      proposals.push({
        operation: "insert_after_line",
        lineNumber: anchor.lineNumber,
        type: "experience_bullet_insert",
        targetArea: "Experience",
        reason: `New experience bullet to cover missing keyword(s): ${sourceKeywords.join(", ")}`,
        before: `(Insert new bullet after line ${anchor.lineNumber})`,
        after: afterText,
        addedKeywords: sourceKeywords,
        affectsMandatoryKeyword: true,
        generatedBy: "mandatory_keyword_generator",
        anchorText: anchor.originalText,
      });
    }
  }

  return proposals;
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
  const overallYears = detectOverallExperienceYears(resumeText);
  const legacyArtifactCount = countLegacyGeneratedArtifactLines(resumeText);

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
    "- Do NOT start experience bullets with weak filler verbs like 'Applied'. Use action + context + impact wording (e.g., improved/reduced/implemented/diagnosed/optimized/guided).",
    "- For experience bullets, prefer action + scope/system + tech/context + measurable impact (percent, volume, latency, reliability, MTTR, throughput) when supported by the resume context.",
    `- If you mention total experience and the resume does not explicitly state a different total, use ${overallYears}+ years (do not inflate years from a skill-specific count).`,
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
      ...(legacyArtifactCount >= 3
        ? [`Detected ${legacyArtifactCount} previously generated legacy filler bullets from an older optimization run. Use your original resume (not a prior optimized export) for best ATS results and cleaner output.`]
        : []),
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

module.exports = {
  generateOptimizedResumeDraft,
  buildEditableLineCandidates,
  applyLineEditsPreservingLayout,
  generateSupplementalPointProposals,
};
