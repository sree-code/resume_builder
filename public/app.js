const form = document.getElementById("analyzer-form");
const analyzeBtn = document.getElementById("analyzeBtn");
const optimizeAllBtn = document.getElementById("optimizeAllBtn");
const clearJobBtn = document.getElementById("clearJobBtn");
const clearResumeBtn = document.getElementById("clearResumeBtn");
const statusText = document.getElementById("statusText");
const resultsPanel = document.getElementById("resultsPanel");
const optimizedCard = document.getElementById("optimizedCard");
const copyOptimizedBtn = document.getElementById("copyOptimizedBtn");
const downloadCard = document.getElementById("downloadCard");
const downloadLink = document.getElementById("downloadLink");
const downloadHint = document.getElementById("downloadHint");
const scoreCompareGrid = document.getElementById("scoreCompareGrid");
const changesCard = document.getElementById("changesCard");
const changesPreview = document.getElementById("changesPreview");
const loaderCard = document.getElementById("loaderCard");
const loaderTitle = document.getElementById("loaderTitle");
const loaderSubtitle = document.getElementById("loaderSubtitle");
const progressFill = document.getElementById("progressFill");
const progressPercent = document.getElementById("progressPercent");
const progressStep = document.getElementById("progressStep");
const scoreLabel = document.getElementById("scoreLabel");
const aggressivePersonalModeToggle = document.getElementById("aggressivePersonalMode");
const jdKeywordListModeToggle = document.getElementById("jdKeywordListMode");
const errorCard = document.getElementById("errorCard");
const errorDetails = document.getElementById("errorDetails");

let loaderTimer = null;
let loaderStartedAt = 0;

function setStatus(message, type = "info") {
  statusText.textContent = message || "";
  statusText.dataset.type = type;
}

function clearErrorPanel() {
  if (errorCard) errorCard.hidden = true;
  if (errorDetails) errorDetails.textContent = "";
}

function showErrorPanel(detailText) {
  if (!errorCard || !errorDetails || !detailText) return;
  errorDetails.textContent = detailText;
  errorCard.hidden = false;
}

function setBusy(isBusy) {
  analyzeBtn.disabled = isBusy;
  optimizeAllBtn.disabled = isBusy;
  clearJobBtn.disabled = isBusy;
  clearResumeBtn.disabled = isBusy;
  if (aggressivePersonalModeToggle) aggressivePersonalModeToggle.disabled = isBusy;
  if (jdKeywordListModeToggle) jdKeywordListModeToggle.disabled = isBusy;
}

function renderChips(containerId, items, emptyText) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!items || !items.length) {
    container.innerHTML = `<span class="muted">${emptyText}</span>`;
    return;
  }
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = item;
    container.appendChild(chip);
  });
}

function renderList(containerId, items, emptyText) {
  const list = document.getElementById(containerId);
  list.innerHTML = "";
  if (!items || !items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = emptyText;
    list.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = typeof item === "string" ? item : `${item.title}: ${item.detail}`;
    list.appendChild(li);
  });
}

function renderBreakdown(breakdown) {
  const container = document.getElementById("breakdown");
  container.innerHTML = "";
  Object.entries(breakdown || {}).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <span>${key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}</span>
      <strong>${value.score}/${value.max}</strong>
    `;
    container.appendChild(row);
  });
}

function renderAnalysis(analysis) {
  if (!analysis) return;
  resultsPanel.hidden = false;
  if (scoreLabel) scoreLabel.textContent = "Simulated ATS Match";
  document.getElementById("scoreValue").textContent = analysis.score;
  document.getElementById("scoreBand").textContent = analysis.scoreBand;
  document.getElementById("disclaimerText").textContent = analysis.disclaimer;
  renderBreakdown(analysis.breakdown);

  renderChips("missingKeywords", analysis.insights.topMissingKeywords, "No obvious missing keywords found.");
  renderChips("matchedKeywords", analysis.insights.topMatchedKeywords, "No matched keywords detected yet.");
  renderList("suggestionsList", analysis.suggestions, "No suggestions generated.");
  renderList("formatNotes", analysis.insights.formattingNotes, "No formatting notes.");
}

function renderOptimization(optimization) {
  if (!optimization) {
    optimizedCard.hidden = true;
    return;
  }
  optimizedCard.hidden = false;
  const modeText = optimization.mode === "ai"
    ? "AI-generated format-preserving optimization (review for accuracy)."
    : "Heuristic mode (OpenAI key not configured). Resume text format is preserved.";
  document.getElementById("optimizationMode").textContent = optimization.preserveFormat
    ? `${modeText} Only targeted lines were eligible for edits.`
    : modeText;
  renderList("optimizationNotes", optimization.notes || [], "No optimization notes.");
  document.getElementById("optimizedResumeOutput").value = optimization.optimizedResumeDraft || "";
}

function renderDownloadOutput(output, optimization) {
  if (!output || !output.downloadUrl) {
    downloadCard.hidden = true;
    downloadLink.hidden = true;
    return;
  }
  downloadCard.hidden = false;
  downloadLink.hidden = false;
  downloadLink.href = output.downloadUrl;
  downloadLink.download = output.fileName || "optimized_resume";
  downloadLink.textContent = `Download ${output.fileName || "Updated File"}`;

  if (optimization?.preserveFormat && String(output.format).toLowerCase() !== "txt") {
    downloadHint.textContent = `Generated ${String(output.format || "").toUpperCase()} file with format-preserving updates (same layout target, targeted line edits only).`;
  } else {
    downloadHint.textContent = `Generated ${String(output.format || "").toUpperCase()} optimized resume download.`;
  }
}

function renderScoreComparison(comparison) {
  if (!comparison) {
    scoreCompareGrid.hidden = true;
    return;
  }
  scoreCompareGrid.hidden = false;
  document.getElementById("beforeScoreValue").textContent = comparison.beforeScore ?? 0;
  document.getElementById("afterScoreValue").textContent = comparison.afterScore ?? 0;
  const delta = comparison.delta ?? 0;
  const deltaText = `${delta >= 0 ? "+" : ""}${delta}`;
  document.getElementById("deltaScoreValue").textContent = deltaText;
}

function renderKeywordAddPreview(previewItems) {
  const list = document.getElementById("keywordAddPreview");
  list.innerHTML = "";
  if (!previewItems || !previewItems.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No explicit missing-keyword additions were detected in edited lines.";
    list.appendChild(li);
    return;
  }

  previewItems.slice(0, 8).forEach((item) => {
    const li = document.createElement("li");
    const added = (item.addedKeywords || []).join(", ");
    li.textContent = `Line ${item.lineNumber}: added ${added}`;
    list.appendChild(li);
  });
}

function renderChangesPreview(previewItems) {
  changesPreview.innerHTML = "";
  if (!previewItems || !previewItems.length) {
    changesCard.hidden = true;
    return;
  }

  changesCard.hidden = false;
  previewItems.slice(0, 8).forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "change-item";

    const meta = document.createElement("p");
    meta.className = "line-meta";
    meta.textContent = `Line ${item.lineNumber} • ${item.type || "line"}${item.reason ? ` • ${item.reason}` : ""}`;
    wrapper.appendChild(meta);

    const before = document.createElement("pre");
    before.className = "change-before";
    before.textContent = `Before: ${item.before || ""}`;
    wrapper.appendChild(before);

    const after = document.createElement("pre");
    after.className = "change-after";
    after.textContent = `After:  ${item.after || ""}`;
    wrapper.appendChild(after);

    if (item.addedKeywords?.length) {
      const chipWrap = document.createElement("div");
      chipWrap.className = "inline-chips";
      item.addedKeywords.forEach((k) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = `+ ${k}`;
        chipWrap.appendChild(chip);
      });
      wrapper.appendChild(chipWrap);
    }

    changesPreview.appendChild(wrapper);
  });
}

function resetOptimizeOnlySections() {
  scoreCompareGrid.hidden = true;
  changesCard.hidden = true;
  downloadCard.hidden = true;
  if (scoreLabel) scoreLabel.textContent = "Simulated ATS Match";
}

function startLoader(mode) {
  clearInterval(loaderTimer);
  loaderStartedAt = Date.now();
  loaderCard.hidden = false;

  const hasFile = document.getElementById("resumeFile").files.length > 0;
  const steps = mode === "optimize"
    ? (hasFile
      ? [
          { p: 8, label: "Upload received", sub: "Reading your resume file..." },
          { p: 22, label: "Extracting content", sub: "Parsing DOCX/PDF while preserving structure..." },
          { p: 42, label: "Analyzing ATS match", sub: "Scoring keyword coverage and missing terms..." },
          { p: 67, label: "AI optimization", sub: "Rewriting targeted lines only (truthful edits only)..." },
          { p: 82, label: "Applying file edits", sub: "Updating the original file format in place..." },
          { p: 94, label: "Preparing download", sub: "Re-scoring and generating before/after comparison..." },
        ]
      : [
          { p: 10, label: "Analyzing ATS match", sub: "Scoring current resume against the JD..." },
          { p: 45, label: "AI optimization", sub: "Rewriting targeted summary/skills/bullet lines..." },
          { p: 78, label: "Scoring after optimization", sub: "Comparing before vs after ATS match..." },
          { p: 94, label: "Preparing download", sub: "Creating optimized text download..." },
        ])
    : [
        { p: 15, label: "Analyzing ATS match", sub: "Extracting keywords and scoring alignment..." },
        { p: 80, label: "Preparing insights", sub: "Collecting missing keywords and action plan..." },
      ];

  loaderTitle.textContent = mode === "optimize" ? "Optimizing your resume..." : "Analyzing your resume...";
  progressFill.style.width = "0%";
  progressPercent.textContent = "0%";
  progressStep.textContent = "Queued";
  loaderSubtitle.textContent = steps[0]?.sub || "";

  loaderTimer = setInterval(() => {
    const elapsed = Date.now() - loaderStartedAt;
    const duration = mode === "optimize" ? 12000 : 4500;
    const raw = Math.min(96, Math.round((elapsed / duration) * 100));

    let step = steps[0];
    for (const s of steps) {
      if (raw >= s.p) step = s;
    }

    progressFill.style.width = `${raw}%`;
    progressPercent.textContent = `${raw}%`;
    progressStep.textContent = step?.label || "Working";
    loaderSubtitle.textContent = step?.sub || "";
  }, 160);
}

function finishLoader(success = true) {
  clearInterval(loaderTimer);
  loaderTimer = null;
  progressFill.style.width = success ? "100%" : progressFill.style.width;
  progressPercent.textContent = success ? "100%" : progressPercent.textContent;
  progressStep.textContent = success ? "Completed" : "Stopped";
  loaderSubtitle.textContent = success ? "Review score comparison, keyword adds, and download your updated resume." : "Request failed. Fix the issue and try again.";

  setTimeout(() => {
    loaderCard.hidden = true;
  }, 700);
}

async function submitAnalysis(mode = "analyze") {
  const formData = new FormData(form);
  const hasFile = document.getElementById("resumeFile").files.length > 0;
  const file = document.getElementById("resumeFile").files[0];
  const fileExt = file ? (file.name.split(".").pop() || "").toLowerCase() : "";
  const useFileOptimize = mode === "optimize" && hasFile && ["docx", "pdf"].includes(fileExt);

  const endpoint =
    mode === "optimize"
      ? (useFileOptimize ? "/api/optimize-file" : "/api/optimize")
      : "/api/analyze";

  if (mode === "optimize" && !hasFile && !String(formData.get("resumeText") || "").trim()) {
    setStatus("Please paste resume text or upload a resume file.", "error");
    return;
  }

  setBusy(true);
  startLoader(mode);
  setStatus(
    mode === "optimize"
      ? "Analyzing + optimizing resume. Note: unsupported tech not present in your experience will not be fabricated."
      : "Analyzing resume match..."
  );

  try {
    clearErrorPanel();
    const response = await fetch(endpoint, { method: "POST", body: formData });
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_parseErr) {
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}.`);
      }
      throw new Error("Server returned an invalid response.");
    }

    if (!response.ok) {
      const err = new Error(data.error || `Request failed (${response.status}).`);
      err.details = data.details || data.debug || rawText || "";
      throw err;
    }

    const baseAnalysis = mode === "optimize" ? (data.afterAnalysis || data.analysis) : (data.beforeAnalysis || data.analysis);
    renderAnalysis(baseAnalysis);
    if (mode === "optimize" && scoreLabel) {
      scoreLabel.textContent = "Simulated ATS Match (After Optimization)";
    }
    renderOptimization(data.optimization);
    renderDownloadOutput(data.output, data.optimization);

    if (mode === "optimize") {
      renderScoreComparison(data.comparison);
      renderKeywordAddPreview(data.changePreview);
      renderChangesPreview(data.changePreview);
    } else {
      resetOptimizeOnlySections();
      optimizedCard.hidden = true;
    }

    const aiText = data.aiEnabled ? "AI optimization is enabled." : "AI optimization is not configured (set OPENAI_API_KEY).";
    setStatus(`Completed. ${aiText}`, "success");
    finishLoader(true);
  } catch (error) {
    setStatus(error.message || "Unexpected error.", "error");
    showErrorPanel(error.details || error.stack || "");
    finishLoader(false);
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAnalysis("analyze");
});

optimizeAllBtn.addEventListener("click", () => {
  submitAnalysis("optimize");
});

clearJobBtn.addEventListener("click", () => {
  document.getElementById("jobDescription").value = "";
  setStatus("Job description cleared.");
});

clearResumeBtn.addEventListener("click", () => {
  document.getElementById("resumeText").value = "";
  setStatus("Resume text cleared.");
});

copyOptimizedBtn.addEventListener("click", async () => {
  const text = document.getElementById("optimizedResumeOutput").value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Optimized resume draft copied to clipboard.", "success");
  } catch (_err) {
    setStatus("Could not copy automatically. Please copy manually.", "error");
  }
});

(async function init() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    setStatus(data.aiEnabled ? "Ready. AI optimization is enabled." : "Ready. Local analysis is enabled; AI optimization requires OPENAI_API_KEY.");
  } catch (_err) {
    setStatus("Ready.");
  }
})();
