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
const LOW_SIGNAL_KEYWORDS = new Set([
  "one area",
  "technical field involving",
  "developers. specify",
  "developers specify",
  "meet future business",
  "basic qualifications",
  "qualifications",
  "basic",
]);
const LOW_SIGNAL_SINGLE_TOKENS = new Set([
  "software", "engineer", "developers", "developer", "division", "provide", "demonstrated",
  "write", "great", "existing", "technical", "field", "involving", "future", "one", "area",
  "market", "features", "meet", "business", "preferably", "similar", "highly", "public", "big", "systematic",
  "market-leading",
  // Generic verbs/adjectives frequently extracted from job prose and harmful for resume-point generation
  "contribute", "acceptance", "necessary", "execute", "detect", "manual", "methodology", "passion",
  "orientated", "driving", "quality", "information", "systems", "system", "product", "products", "services",
  "technicals", "tools", "deliver", "multiple", "projects", "around",
  "basic", "qualifications", "qualification", "deeply", "understand", "different", "such", "verbal",
  "continuously", "innovate", "self-serving", "steps", "step", "compilation", "fix",
]);

const KEYWORD_ALIASES = new Map([
  ["go", ["go", "golang"]],
  ["golang", ["go", "golang"]],
  ["c#", ["c#", "csharp", ".net", "dotnet", "asp.net"]],
  ["csharp", ["c#", "csharp", ".net", "dotnet", "asp.net"]],
  ["ai", ["ai", "artificial intelligence", "machine learning", "llm", "nlp", "openai"]],
  ["public cloud platform", ["aws", "azure", "gcp", "cloud platform", "public cloud"]],
  ["preferably terraform", ["terraform", "infrastructure as code", "iac", "cloudformation"]],
  ["big data technologies", ["big data", "kafka", "spark", "hadoop", "databricks", "data pipelines"]],
  ["highly distributed services", ["microservices", "distributed systems", "distributed services", "scalable services"]],
  ["tier-one livesite", ["production support", "live site", "livesite", "on-call", "incident response", "sev"]],
  ["provide technical leadership", ["technical leadership", "led", "mentored", "guided engineering", "architected"]],
  ["existing software architecture", ["software architecture", "system architecture", "architecture", "system design"]],
  ["systematic problem-solving", ["problem solving", "root cause", "troubleshooting", "debugging"]],
  ["problem-solving", ["problem solving", "root cause", "troubleshooting", "debugging"]],
  ["market-leading features", ["customer-facing features", "flagship features", "platform features"]],
  ["market-leading", ["customer-facing", "flagship", "platform"]],
  ["meet future business", ["scalable", "scalability", "roadmap", "future growth"]],
  ["engineering division", ["engineering org", "engineering organization", "engineering team"]],
  ["technical leadership", ["technical leadership", "led", "mentored", "architected"]],
  ["write great code", ["code quality", "software engineering", "clean code", "production code"]],
  ["livesite", ["livesite", "production support", "on-call", "incident"]],
  ["tier-one", ["tier one", "tier-one", "production", "sev"]],
  ["peer code review", ["code review", "peer review", "review code", "reviewed code", "pull request review"]],
  ["cloud architecture", ["cloud architecture", "aws architecture", "solution architecture", "system architecture"]],
  ["engineering processes", ["engineering processes", "development processes", "sdlc", "process improvements", "procedures"]],
  ["mentoring developers", ["mentored developers", "guided developers", "mentored engineers", "technical leadership"]],
  ["changing needs", ["changing needs", "evolving requirements", "changing business needs", "future needs"]],
  ["senior software engineer", ["senior software engineer", "senior developer", "senior full stack developer", "lead full stack developer"]],
  ["bs", ["b.s", "bs", "bachelor", "bachelors", "bachelor's", "bachelor of"]],
  ["ms", ["m.s", "ms", "master", "masters", "master's", "master of"]],
  ["reactjs", ["reactjs", "react.js", "react"]],
  ["cicd", ["cicd", "ci/cd", "continuous integration", "continuous delivery", "deployment pipeline", "release pipeline"]],
  ["infra", ["infra", "infrastructure", "platform infrastructure"]],
  ["manangers", ["manangers", "managers", "engineering managers"]],
  ["mobile release processes", ["mobile release processes", "release process", "release management", "mobile releases"]],
  ["release platform tools", ["release platform tools", "release tooling", "platform tools"]],
  ["compilation steps", ["compilation steps", "build steps", "compile steps"]],
]);

const LANGUAGE_ALTERNATIVE_GROUPS = [
  ["java", "go", "golang", "c#", "csharp", "python", "c++"],
];

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

function normalizeKeyword(keyword) {
  return String(keyword || "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
    .filter((t) => !/[.,;:]$/.test(t))
    .filter((t) => !LOW_SIGNAL_SINGLE_TOKENS.has(normalizeKeyword(t)));

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
    .filter((p) => !/[.;:]\s/.test(p) || COMMON_SKILLS.includes(p))
    .filter((p) => !/\b(with|and|or|for|to)\b/.test(p) || COMMON_SKILLS.includes(p))
    .filter((p) => !LOW_SIGNAL_KEYWORDS.has(normalizeKeyword(p)))
    .filter((p) => !/^\w+\.$/.test(p))
    .filter((p) => {
      const tokens = p.split(/\s+/);
      const generic = tokens.filter((t) => STOPWORDS.has(t) || ["existing", "future", "one", "area", "involving", "field", "division"].includes(t)).length;
      return !(tokens.length >= 2 && generic >= tokens.length - 1);
    });

  return unique(filtered);
}

function normalizeJobKeywords(keywords, jobDescription) {
  const text = normalizeKeyword(jobDescription);
  const norms = new Set(keywords.map((k) => normalizeKeyword(k)));
  const items = [...keywords];

  if (/\breview code\b/.test(text) || (norms.has("review") && (norms.has("written") || norms.has("peers")))) {
    items.push("peer code review");
  }
  if (/\bcloud architecture\b/.test(text) || (norms.has("cloud") && norms.has("architecture"))) {
    items.push("cloud architecture");
  }
  if (/\bprocesses?\b/.test(text) || /\bprocedures?\b/.test(text)) {
    items.push("engineering processes");
  }
  if ((norms.has("mobile release processes") || norms.has("release platform tools") || norms.has("high quality release")) &&
      (norms.has("ios") || norms.has("android") || norms.has("reactjs"))) {
    items.push("mobile release engineering");
  }
  if (norms.has("cicd") || (norms.has("compilation steps") && (norms.has("deploying") || norms.has("infra")))) {
    items.push("mobile ci/cd compilation and deployment");
  }
  if (norms.has("verbal communication skills") || norms.has("collaborate") || norms.has("manangers") || norms.has("managers")) {
    items.push("cross-functional communication");
  }
  if (norms.has("engineering best practices") || norms.has("engineering processes") || norms.has("continuously") || norms.has("innovate") || norms.has("improvement")) {
    items.push("engineering process improvement");
  }
  if (/\bother software developers\b/.test(text) || /\bguide\b/.test(text) || /\bassist\b/.test(text)) {
    items.push("mentoring developers");
  }
  if (/\bchanging needs\b/.test(text) || /\bmeet changing needs\b/.test(text)) {
    items.push("changing needs");
  }

  const removeNoisy = new Set([
    "other", "specify", "changing", "includes", "define", "implement", "member", "assist",
    "architects", "guide", "processes", "procedures", "review", "written", "peers",
    "other software developers", "meet changing needs",
    "contribute", "acceptance", "necessary", "execute", "detect",
    "basic", "qualifications", "basic qualifications", "deeply", "understand", "different", "such",
    "verbal", "continuously", "innovate", "fix", "steps", "step", "compilation",
  ]);

  const out = [];
  const seen = new Set();
  for (const keyword of items) {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) continue;
    if (removeNoisy.has(normalized)) continue;
    if (LOW_SIGNAL_SINGLE_TOKENS.has(normalized)) continue;
    const key = getAlternativeGroupKey(normalized) || normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

function detectKeywordListMode(jobDescription) {
  const normalized = normalizeText(jobDescription);
  const nonEmptyLines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!nonEmptyLines.length) return false;

  const commaSegments = normalized.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (nonEmptyLines.length <= 3 && commaSegments.length >= 8) {
    return true;
  }

  if (nonEmptyLines.length < 6) return false;

  const shortLines = nonEmptyLines.filter((line) => line.split(/\s+/).filter(Boolean).length <= 5).length;
  const sentenceLike = nonEmptyLines.filter((line) => /[.!?]$/.test(line)).length;
  return shortLines / nonEmptyLines.length >= 0.65 && sentenceLike / nonEmptyLines.length <= 0.35;
}

function extractKeywordsFromKeywordListText(jobDescription) {
  const chunks = normalizeText(jobDescription)
    .split("\n")
    .flatMap((line) => line.split(/[,;]+/))
    .map((s) => s.replace(/^[\-*•]\s*/, "").trim())
    .filter(Boolean)
    .map((s) => s.replace(/[.]+$/g, "").trim())
    .filter(Boolean)
    .filter((s) => s.length >= 2)
    .filter((s) => s.split(/\s+/).length <= 8)
    .filter((s) => {
      const normalized = normalizeKeyword(s);
      if (!normalized) return false;
      if (LOW_SIGNAL_SINGLE_TOKENS.has(normalized)) return false;
      if (normalized.split(/\s+/).length === 1 && normalized.length <= 3 && !["ai", "go", "c#", "bs", "ms"].includes(normalized)) {
        return false;
      }
      return true;
    });

  return unique(chunks.map((s) => s.toLowerCase()));
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
  const normalizedResume = normalizeKeyword(resumeText);
  const resumeTokens = new Set(tokenize(resumeText).map(normalizeKeyword));
  const presentGroups = new Set();
  for (const group of LANGUAGE_ALTERNATIVE_GROUPS) {
    const hasAny = group.some((kw) => keywordMatchesResume(lowerResume, normalizedResume, resumeTokens, kw));
    if (hasAny) group.forEach((kw) => presentGroups.add(normalizeKeyword(kw)));
  }

  const keywordWeights = jobKeywords.map((keyword) => {
    const normalized = normalizeKeyword(keyword);
    let weight = 1;
    if (COMMON_SKILLS.includes(keyword)) weight = 3;
    if (keyword.includes(" ") && keyword.split(" ").length >= 2) weight += 1;
    if (/^(aws|gcp|azure|sql|api|react|node|python|java|docker|kubernetes|terraform)$/.test(normalized)) weight += 1;
    if (LOW_SIGNAL_KEYWORDS.has(normalized)) weight = 0;
    if (/^(basic qualifications|qualifications|basic)$/.test(normalized)) weight = 0;
    if (/(^degree$|^masters?$|computer engineering|electrical engineering)/.test(normalized)) weight = Math.min(weight, 1);
    if (/\b(division|field|one area|developers specify)\b/.test(normalized)) weight = Math.min(weight, 1);
    if (normalized.length <= 2 && !["ai", "go", "bs", "ms"].includes(normalized)) weight = 0;
    return { keyword, normalized, weight };
  });

  const groupWeightCaps = new Map();
  for (const item of keywordWeights) {
    if (item.weight <= 0) continue;
    const groupKey = getAlternativeGroupKey(item.normalized);
    if (!groupKey) continue;
    groupWeightCaps.set(groupKey, Math.max(groupWeightCaps.get(groupKey) || 0, item.weight));
  }

  const matched = [];
  const missing = [];
  let totalWeight = 0;
  let matchedWeight = 0;
  const groupCounted = new Set();
  const groupTotalAdded = new Set();

  for (const item of keywordWeights) {
    if (item.weight <= 0) continue;
    const groupKey = getAlternativeGroupKey(item.normalized);
    if (groupKey) {
      if (!groupTotalAdded.has(groupKey)) {
        totalWeight += groupWeightCaps.get(groupKey) || item.weight;
        groupTotalAdded.add(groupKey);
      }
    } else {
      totalWeight += item.weight;
    }

    if (groupKey && presentGroups.has(item.normalized)) {
      if (!groupCounted.has(groupKey)) {
        matchedWeight += groupWeightCaps.get(groupKey) || item.weight;
        groupCounted.add(groupKey);
      }
      matched.push(item);
      continue;
    }

    if (keywordMatchesResume(lowerResume, normalizedResume, resumeTokens, item.keyword)) {
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
    matchedKeywords: dedupeKeywordsForDisplay(matched.sort((a, b) => b.weight - a.weight).map((x) => x.keyword)),
    missingKeywords: dedupeKeywordsForDisplay(missing.sort((a, b) => b.weight - a.weight).map((x) => x.keyword)),
  };
}

function dedupeKeywordsForDisplay(keywords) {
  const out = [];
  const seen = new Set();
  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword);
    if (!normalized || LOW_SIGNAL_SINGLE_TOKENS.has(normalized)) continue;
    const key = getAlternativeGroupKey(normalized) || normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

function scoreAggressivePersonalBonus({ resumeText, jobKeywords, jobTitles, impact, roleAlignment }) {
  const lowerResume = resumeText.toLowerCase();
  const normalizedResume = normalizeKeyword(resumeText);
  const resumeTokens = new Set(tokenize(resumeText).map(normalizeKeyword));

  const concepts = [
    "technical leadership",
    "mentoring developers",
    "cloud architecture",
    "existing software architecture",
    "highly distributed services",
    "tier-one livesite",
    "peer code review",
    "engineering processes",
    "changing needs",
    "problem-solving",
    "write great code",
  ];

  let score = 0;
  const matchedConcepts = [];
  for (const concept of concepts) {
    const conceptRequested =
      jobKeywords.some((k) => normalizeKeyword(k) === normalizeKeyword(concept)) ||
      jobKeywords.some((k) => {
        const nk = normalizeKeyword(k);
        return nk.includes(normalizeKeyword(concept)) || normalizeKeyword(concept).includes(nk);
      });
    if (!conceptRequested) continue;
    if (keywordMatchesResume(lowerResume, normalizedResume, resumeTokens, concept)) {
      score += 2;
      matchedConcepts.push(concept);
    }
  }

  if (jobTitles.some((t) => /senior|staff|lead|principal/.test(t)) && roleAlignment.score >= 7) score += 2;
  if (impact.score >= 3) score += 2;
  if (impact.score >= 4) score += 1;

  return { score: Math.min(20, score), matchedConcepts };
}

function getAlternativeGroupKey(normalizedKeyword) {
  for (const group of LANGUAGE_ALTERNATIVE_GROUPS) {
    if (group.map(normalizeKeyword).includes(normalizedKeyword)) {
      return group.map(normalizeKeyword).sort().join("|");
    }
  }
  return null;
}

function keywordMatchesResume(lowerResume, normalizedResume, resumeTokens, keyword) {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) return false;

  const patterns = new Set([normalizedKeyword]);
  const aliases = KEYWORD_ALIASES.get(normalizedKeyword) || [];
  aliases.forEach((a) => patterns.add(normalizeKeyword(a)));

  for (const patternValue of patterns) {
    if (!patternValue) continue;

    if (patternValue.includes(" ")) {
      const pattern = new RegExp(`\\b${escapeRegex(patternValue).replace(/\\ /g, "\\s+")}\\b`, "i");
      if (pattern.test(lowerResume) || pattern.test(normalizedResume)) return true;
    } else {
      if (resumeTokens.has(patternValue)) return true;
      const pattern = new RegExp(`\\b${escapeRegex(patternValue)}\\b`, "i");
      if (pattern.test(lowerResume) || pattern.test(normalizedResume)) return true;
    }
  }

  return false;
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

function analyzeResumeAgainstJob({ jobDescription, resumeText, metadata = {}, options = {} }) {
  const normalizedJD = normalizeText(jobDescription);
  const normalizedResume = normalizeText(resumeText);
  const requestedMode = options.jdInputMode || "auto";
  const keywordListDetected = requestedMode === "keyword_list" || (requestedMode === "auto" && detectKeywordListMode(normalizedJD));
  const advancedAtsMode = options.advancedAtsMode !== false;
  const aggressivePersonalMode = Boolean(options.aggressivePersonalMode);

  const rawJdKeywords = keywordListDetected ? extractKeywordsFromKeywordListText(normalizedJD) : extractPhrases(normalizedJD);
  const jdKeywords = advancedAtsMode ? normalizeJobKeywords(rawJdKeywords, normalizedJD) : rawJdKeywords;
  const jobTitles = extractLikelyJobTitles(normalizedJD);

  const keywordCoverage = scoreKeywordCoverage(jdKeywords, normalizedResume);
  const sections = scoreSectionCompleteness(normalizedResume);
  const formatting = scoreFormattingReadability(normalizedResume);
  const roleAlignment = scoreRoleAlignment(jobTitles, normalizedResume);
  const impact = scoreImpactEvidence(normalizedResume);
  const keywordPlacement = scoreKeywordPlacement(normalizedResume, keywordCoverage.missingKeywords.length ? keywordCoverage.matchedKeywords.concat(keywordCoverage.missingKeywords) : jdKeywords);
  const aggressiveBonus = aggressivePersonalMode
    ? scoreAggressivePersonalBonus({ resumeText: normalizedResume, jobKeywords: jdKeywords, jobTitles, impact, roleAlignment })
    : { score: 0, matchedConcepts: [] };

  const score = Math.min(
    100,
    keywordCoverage.score +
      sections.score +
      formatting.score +
      roleAlignment.score +
      impact.score +
      keywordPlacement.score +
      aggressiveBonus.score
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
      `This is a simulated ATS match score (resume-vs-job alignment). Real ATS systems vary and recruiters still review relevance, truthfulness, and impact.${advancedAtsMode ? " Advanced ATS mode is enabled (expanded keyword parsing/grouping)." : ""}${aggressivePersonalMode ? " Aggressive personal mode is enabled (equivalence-friendly scoring)." : ""}`,
    breakdown: {
      keywordCoverage: { max: 45, score: keywordCoverage.score },
      sections: { max: 15, score: sections.score },
      formatting: { max: 15, score: formatting.score },
      roleAlignment: { max: 10, score: roleAlignment.score },
      impactEvidence: { max: 5, score: impact.score },
      keywordPlacement: { max: 10, score: keywordPlacement.score },
      ...(aggressivePersonalMode ? { aggressiveBonus: { max: 20, score: aggressiveBonus.score } } : {}),
    },
    insights: {
      extractedJobTitles: jobTitles,
      matchedTitle: roleAlignment.matchedTitle,
      topMatchedKeywords: keywordCoverage.matchedKeywords.slice(0, advancedAtsMode ? 40 : 20),
      topMissingKeywords: keywordCoverage.missingKeywords.slice(0, advancedAtsMode ? 40 : 20),
      presentSections: sections.presentSections,
      missingSections: sections.missingSections,
      formattingNotes: formatting.risks,
      impactSignals: impact.signals,
      estimatedKeywordPoolSize: jdKeywords.length,
      keywordListDetected,
      jdInputModeUsed: keywordListDetected ? "keyword_list" : "standard_jd",
      advancedAtsMode,
      aggressivePersonalMode,
      aggressiveMatchedConcepts: aggressiveBonus.matchedConcepts,
    },
    suggestions,
    metadata: { ...metadata, analysisOptions: { requestedMode, keywordListDetected, advancedAtsMode, aggressivePersonalMode } },
  };
}

module.exports = {
  analyzeResumeAgainstJob,
};
