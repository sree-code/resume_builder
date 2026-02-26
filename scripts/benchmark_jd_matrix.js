#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");

const API_BASE = process.env.BENCH_API_BASE || "http://localhost:3020";
const RESUME_DOCX =
  process.env.BENCH_RESUME_DOCX || "/Users/sreesumanthgorantla/Downloads/SG_SJFSTA_02222026.docx";
const OUT_DIR = path.join(process.cwd(), "tmp", "benchmark");

const JOBS = [
  {
    id: "cgi_fullstack_java",
    title: "CGI Fullstack Java Developer",
    sourceUrl:
      "https://www.tealhq.com/job/fullstack-java-developer_1f8d4883-dc99-4644-8e16-336f9ea3beb5",
    jd: [
      "CGI is hiring a Fullstack Java Developer to design, implement, test, and deploy scalable enterprise applications.",
      "Responsibilities include analyzing user needs, building backend services in Java/JEE and Spring Boot, and developing modern frontends using Angular or React.",
      "Candidates should have experience with microservices, REST APIs, SQL/NoSQL databases, cloud platforms (AWS/Azure/GCP), CI/CD pipelines, Docker/Kubernetes, and Agile delivery.",
      "Role also expects mentoring/team collaboration and production-quality software practices.",
    ].join(" "),
  },
  {
    id: "oracle_ic3_fullstack_java",
    title: "Oracle Health Full Stack Java Engineer (IC3)",
    sourceUrl:
      "https://www.tealhq.com/job/full-stack-java-engineer_3173f432-82f1-4624-8091-ceb3f265bfab",
    jd: [
      "Oracle Health is hiring a Full Stack Java Engineer (IC3) to build market-leading features on a public cloud platform for highly distributed production systems.",
      "The role focuses on low latency, correctness, and diagnosing data-processing, state, schema/serialization, and pipeline reliability issues.",
      "Requirements emphasize performance tuning, indexing/query patterns, operational considerations, iterative delivery, technical leadership, and guide/support for other engineers.",
      "Preferred experience includes Terraform and big data or stream-processing architectures (Apache Flink preferred).",
    ].join(" "),
  },
  {
    id: "hexaware_fullstack_aws_tech_lead",
    title: "Hexaware Fullstack AWS Tech Lead",
    sourceUrl:
      "https://www.tealhq.com/job/fullstack-aws-tech-lead-java-react_0e8725f0-53f9-4db4-8267-8b59f6c94c31",
    jd: [
      "Hexaware is hiring a Fullstack AWS Tech Lead with Java, Spring Boot, React, and AWS experience.",
      "Responsibilities include designing cloud architecture, implementing APIs and UI features, production support, performance optimization, technical leadership, code review, and guiding developers.",
      "The role expects CI/CD, containerized deployment, Linux/Unix skills, collaboration across teams, and delivery of scalable enterprise solutions.",
    ].join(" "),
  },
  {
    id: "cognizant_java_react",
    title: "Cognizant Java Full Stack Developer (React.js)",
    sourceUrl:
      "https://www.tealhq.com/job/java-full-stack-developer-react-js_2f727eb8-57a6-4748-acce-12f5d5f54f0d",
    jd: [
      "Cognizant is hiring a Java Full Stack Developer with strong React.js frontend and Java/Spring backend experience.",
      "The role includes building and enhancing microservices and REST APIs, implementing UI features, troubleshooting production issues, improving performance, and collaborating in Agile teams.",
      "Preferred skills include cloud services, modern CI/CD practices, testing, code quality, and scalable distributed application design.",
    ].join(" "),
  },
  {
    id: "ltimindtree_java_fullstack",
    title: "LTIMindtree Java Full Stack Developer",
    sourceUrl:
      "https://www.tealhq.com/job/java-full-stack-developer_23b451f3-f414-4ff2-901f-b28a5f4a8b5b",
    jd: [
      "LTIMindtree is hiring a Java Full Stack Developer with 5-8 years of experience in Java/J2EE, Spring Boot, and frontend frameworks such as React or Angular.",
      "Responsibilities include implementing microservices, REST integrations, troubleshooting defects, performance tuning, and building enterprise features aligned to changing business needs.",
      "The role expects collaboration, code reviews, CI/CD, cloud platform familiarity, and strong delivery ownership in Agile teams.",
    ].join(" "),
  },
];

async function postJson(pathname, body) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(json.error || `HTTP ${response.status}`);
    err.response = response;
    err.body = json;
    throw err;
  }
  return json;
}

function countAppliedStarts(text) {
  if (!text) return 0;
  return (text.match(/(^|\n)\s*[-*•]?\s*Applied\b/gi) || []).length;
}

function countYearsMentions(text) {
  if (!text) return 0;
  return (text.match(/\b(\d{1,2})\+?\s*years?\b/gi) || []).length;
}

async function extractResumeText(docxPath) {
  const buffer = fs.readFileSync(docxPath);
  const result = await mammoth.extractRawText({ buffer });
  return String(result.value || "");
}

function summarizeProposalQuality(proposals = []) {
  const afterTexts = proposals.map((p) => String(p.after || ""));
  const startsApplied = afterTexts.filter((t) => /^\s*[-*•]?\s*Applied\b/i.test(t)).length;
  const startsExperienced = afterTexts.filter((t) => /^\s*[-*•]?\s*Experienced in\b/i.test(t)).length;
  const years18 = afterTexts.filter((t) => /\b18\+?\s*years\b/i.test(t)).length;
  return { startsApplied, startsExperienced, years18 };
}

async function runCase({ resumeText, job, advancedAtsMode }) {
  const commonPayload = {
    jobDescription: job.jd,
    resumeText,
    aggressivePersonalMode: true,
    jdKeywordListMode: false,
    advancedAtsMode,
  };

  const analyze = await postJson("/api/analyze", commonPayload);
  const optimize = await postJson("/api/optimize", commonPayload);
  const selectedProposalIds = (optimize.proposals || [])
    .filter((p) => p.selected !== false)
    .map((p) => p.proposalId);
  const apply = await postJson("/api/apply-selected", {
    draftSessionId: optimize.draftSessionId,
    selectedProposalIds,
  });

  const optimizedText = apply?.optimization?.optimizedResumeDraft || "";
  const proposalQuality = summarizeProposalQuality(optimize.proposals || []);

  return {
    advancedAtsMode,
    aiEnabled: Boolean(optimize.aiEnabled),
    analyzeScore: analyze.analysis?.score ?? null,
    beforeScore: optimize.beforeAnalysis?.score ?? null,
    afterScore: apply.afterAnalysis?.score ?? null,
    delta: apply.comparison?.delta ?? null,
    proposals: (optimize.proposals || []).length,
    proposalSummary: optimize.proposalSummary || null,
    appliedProposals: (apply.appliedProposals || []).length,
    lineEdits: apply.optimization?.lineEdits || 0,
    insertedLines: apply.optimization?.insertedLines || 0,
    startsAppliedInOptimizedText: countAppliedStarts(optimizedText),
    proposalQuality,
    yearsMentionsInOptimizedText: countYearsMentions(optimizedText),
    has18PlusYears: /\b18\+?\s*years\b/i.test(optimizedText),
    has7PlusYears: /\b7\+?\s*years\b/i.test(optimizedText),
    notes: apply.optimization?.notes || [],
    topMissingAfter: (apply.afterAnalysis?.keywordInsights?.topMissing || [])
      .slice(0, 10)
      .map((k) => k.keyword || k.term || String(k)),
    error: null,
  };
}

function printTable(results) {
  const rows = results.map((r) => ({
    job: r.jobId,
    mode: r.advancedAtsMode ? "advanced" : "baseline",
    before: r.beforeScore,
    after: r.afterScore,
    delta: r.delta,
    proposals: r.proposals,
    inserted: r.insertedLines,
    appliedStart: r.startsAppliedInOptimizedText,
    pApplied: r.proposalQuality?.startsApplied || 0,
    p18y: r.proposalQuality?.years18 || 0,
    has18y: r.has18PlusYears,
  }));
  console.table(rows);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const resumeText = await extractResumeText(RESUME_DOCX);
  fs.writeFileSync(path.join(OUT_DIR, "resume_mammoth.txt"), resumeText, "utf8");

  const allResults = [];
  for (const job of JOBS) {
    for (const advancedAtsMode of [false, true]) {
      const started = Date.now();
      try {
        const result = await runCase({ resumeText, job, advancedAtsMode });
        allResults.push({
          jobId: job.id,
          jobTitle: job.title,
          sourceUrl: job.sourceUrl,
          runtimeMs: Date.now() - started,
          ...result,
        });
        console.log(
          `[ok] ${job.id} ${advancedAtsMode ? "advanced" : "baseline"} ${result.beforeScore} -> ${result.afterScore} (delta ${result.delta})`
        );
      } catch (error) {
        allResults.push({
          jobId: job.id,
          jobTitle: job.title,
          sourceUrl: job.sourceUrl,
          runtimeMs: Date.now() - started,
          advancedAtsMode,
          error: {
            message: error.message,
            details: error.body?.details || error.body || null,
          },
        });
        console.error(`[error] ${job.id} ${advancedAtsMode ? "advanced" : "baseline"}: ${error.message}`);
      }
    }
  }

  const outPath = path.join(OUT_DIR, `jd-benchmark-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ apiBase: API_BASE, resumeDocx: RESUME_DOCX, results: allResults }, null, 2));
  console.log(`Saved benchmark results to ${outPath}`);
  printTable(allResults.filter((r) => !r.error));

  const summary = allResults
    .filter((r) => !r.error)
    .reduce(
      (acc, r) => {
        acc.count += 1;
        acc.delta += Number(r.delta || 0);
        acc.after += Number(r.afterScore || 0);
        if (r.advancedAtsMode) acc.advanced += 1;
        if (!r.advancedAtsMode) acc.baseline += 1;
        if (r.has18PlusYears) acc.has18 += 1;
        if (r.startsAppliedInOptimizedText > 0) acc.appliedText += 1;
        return acc;
      },
      { count: 0, delta: 0, after: 0, advanced: 0, baseline: 0, has18: 0, appliedText: 0 }
    );
  console.log("Summary:", summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
