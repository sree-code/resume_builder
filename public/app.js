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
const downloadDocxLink = document.getElementById("downloadDocxLink");
const downloadPdfLink = document.getElementById("downloadPdfLink");
const downloadTxtLink = document.getElementById("downloadTxtLink");
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
const scoreInlineChange = document.getElementById("scoreInlineChange");
const rolePresetSelect = document.getElementById("rolePreset");
const explicitMissingKeywordsInput = document.getElementById("explicitMissingKeywords");
const experienceTargetSelect = document.getElementById("experienceTargetId");
const refreshExperienceTargetsBtn = document.getElementById("refreshExperienceTargetsBtn");
const experienceTargetHint = document.getElementById("experienceTargetHint");
const advancedAtsModeToggle = document.getElementById("advancedAtsMode");
const aggressivePersonalModeToggle = document.getElementById("aggressivePersonalMode");
const jdKeywordListModeToggle = document.getElementById("jdKeywordListMode");
const aggressiveFileContentModeToggle = document.getElementById("aggressiveFileContentMode");
const errorCard = document.getElementById("errorCard");
const errorDetails = document.getElementById("errorDetails");
const proposalReviewCard = document.getElementById("proposalReviewCard");
const proposalReviewSummary = document.getElementById("proposalReviewSummary");
const proposalList = document.getElementById("proposalList");
const applySelectedBtn = document.getElementById("applySelectedBtn");
const proposalSelectionMeta = document.getElementById("proposalSelectionMeta");
const selectAllProposalsBtn = document.getElementById("selectAllProposalsBtn");
const deselectAllProposalsBtn = document.getElementById("deselectAllProposalsBtn");

let loaderTimer = null;
let loaderStartedAt = 0;
let currentDraftSessionId = "";
let currentProposals = [];
let resumeContextTimer = null;
let resumeContextRequestId = 0;

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
  if (rolePresetSelect) rolePresetSelect.disabled = isBusy;
  if (explicitMissingKeywordsInput) explicitMissingKeywordsInput.disabled = isBusy;
  if (experienceTargetSelect) experienceTargetSelect.disabled = isBusy;
  if (refreshExperienceTargetsBtn) refreshExperienceTargetsBtn.disabled = isBusy;
  if (advancedAtsModeToggle) advancedAtsModeToggle.disabled = isBusy;
  if (aggressivePersonalModeToggle) aggressivePersonalModeToggle.disabled = isBusy;
  if (jdKeywordListModeToggle) jdKeywordListModeToggle.disabled = isBusy;
  if (aggressiveFileContentModeToggle) aggressiveFileContentModeToggle.disabled = isBusy;
  if (applySelectedBtn) applySelectedBtn.disabled = isBusy || !currentDraftSessionId || !getProposalSelectionCount();
  if (selectAllProposalsBtn) selectAllProposalsBtn.disabled = isBusy || !currentProposals.length || getProposalSelectionCount() === currentProposals.length;
  if (deselectAllProposalsBtn) deselectAllProposalsBtn.disabled = isBusy || !currentProposals.length || getProposalSelectionCount() === 0;
}

function uniqueStrings(items) {
  const seen = new Set();
  const out = [];
  (items || []).forEach((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(String(item).trim());
  });
  return out;
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

function setExperienceTargetHint(message, type = "info") {
  if (!experienceTargetHint) return;
  experienceTargetHint.textContent = message || "";
  experienceTargetHint.dataset.type = type;
}

function populateExperienceTargets(targets, preserveSelection = true) {
  if (!experienceTargetSelect) return;
  const previous = preserveSelection ? experienceTargetSelect.value : "auto";
  experienceTargetSelect.innerHTML = "";

  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = "Auto-detect best experience block";
  experienceTargetSelect.appendChild(autoOption);

  (targets || []).forEach((target) => {
    const option = document.createElement("option");
    option.value = target.id;
    const bullets = target.bulletCount ? ` • ${target.bulletCount} bullets` : "";
    option.textContent = `${target.label}${bullets}`;
    experienceTargetSelect.appendChild(option);
  });

  if (previous && [...experienceTargetSelect.options].some((option) => option.value === previous)) {
    experienceTargetSelect.value = previous;
  }
}

async function loadResumeContext({ silent = false } = {}) {
  if (!experienceTargetSelect) return;
  const resumeText = String(document.getElementById("resumeText").value || "").trim();
  const fileInput = document.getElementById("resumeFile");
  const hasFile = fileInput.files.length > 0;
  if (!resumeText && !hasFile) {
    populateExperienceTargets([], false);
    setExperienceTargetHint("Paste/upload resume content to detect experience blocks for targeted point insertion.");
    return;
  }

  const requestId = ++resumeContextRequestId;
  const payload = new FormData();
  if (resumeText) payload.append("resumeText", resumeText);
  if (hasFile) payload.append("resumeFile", fileInput.files[0]);

  try {
    const response = await fetch("/api/resume-context", { method: "POST", body: payload });
    const data = await response.json();
    if (requestId !== resumeContextRequestId) return;
    if (!response.ok) {
      throw new Error(data.error || `Resume context failed (${response.status}).`);
    }
    const targets = Array.isArray(data.experienceTargets) ? data.experienceTargets : [];
    populateExperienceTargets(targets);
    if (targets.length) {
      setExperienceTargetHint(`Detected ${targets.length} experience block${targets.length > 1 ? "s" : ""} from ${data.source || "resume"}.`, "success");
      if (!silent) setStatus("Experience targets refreshed from resume.", "success");
    } else {
      setExperienceTargetHint("No distinct experience blocks detected. Auto-target mode will be used.");
      if (!silent) setStatus("No distinct experience blocks detected. Auto-target mode remains enabled.");
    }
  } catch (error) {
    populateExperienceTargets([], false);
    setExperienceTargetHint(error.message || "Could not load experience targets.", "error");
    if (!silent) setStatus(error.message || "Could not load experience targets.", "error");
  }
}

function scheduleResumeContextLoad(delayMs = 550) {
  clearTimeout(resumeContextTimer);
  resumeContextTimer = setTimeout(() => {
    loadResumeContext({ silent: true });
  }, delayMs);
}

function renderAnalysis(analysis) {
  if (!analysis) return;
  resultsPanel.hidden = false;
  if (scoreLabel) scoreLabel.textContent = "Simulated ATS Match";
  if (scoreInlineChange) {
    scoreInlineChange.hidden = true;
    scoreInlineChange.textContent = "";
  }
  document.getElementById("scoreValue").textContent = analysis.score;
  document.getElementById("scoreBand").textContent = analysis.scoreBand;
  document.getElementById("disclaimerText").textContent = analysis.disclaimer;
  renderBreakdown(analysis.breakdown);

  const missingKeywords = uniqueStrings([
    ...(analysis?.insights?.topMissingTechnologies || []),
    ...(analysis?.insights?.topMissingKeywords || []),
  ]);
  renderChips("missingKeywords", missingKeywords, "No obvious missing keywords found.");
  renderChips("matchedKeywords", analysis.insights.topMatchedKeywords, "No matched keywords detected yet.");
  renderList("suggestionsList", analysis.suggestions, "No suggestions generated.");
  renderList("formatNotes", analysis.insights.formattingNotes, "No formatting notes.");
}

function renderOptimization(optimization) {
  if (!optimization || optimization.reviewRequired) {
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
  const allLinks = [downloadDocxLink, downloadPdfLink, downloadTxtLink].filter(Boolean);
  const hideAllLinks = () => {
    allLinks.forEach((link) => {
      link.hidden = true;
      link.removeAttribute("href");
      link.classList.remove("is-disabled");
    });
  };
  if (!output) {
    downloadCard.hidden = true;
    hideAllLinks();
    return;
  }

  const downloads = output.downloads || {};
  if (!downloads.docx && !downloads.pdf && !downloads.txt && output.downloadUrl) {
    downloads[String(output.format || "").toLowerCase()] = output;
  }

  const bindLink = (el, entry, label, options = {}) => {
    if (!el) return;
    const { showDisabled = false, unavailableLabel = `${label} (Unavailable)` } = options;
    if (!entry?.downloadUrl) {
      el.hidden = !showDisabled;
      el.removeAttribute("href");
      el.classList.toggle("is-disabled", showDisabled);
      if (showDisabled) el.textContent = unavailableLabel;
      return;
    }
    el.hidden = false;
    el.classList.remove("is-disabled");
    el.href = entry.downloadUrl;
    el.download = entry.fileName || label;
    el.textContent = label;
  };

  const hasAny = Boolean(downloads.docx?.downloadUrl || downloads.pdf?.downloadUrl || downloads.txt?.downloadUrl);
  if (!hasAny) {
    downloadCard.hidden = true;
    hideAllLinks();
    return;
  }

  downloadCard.hidden = false;
  const fileFlow = Boolean(downloads.docx || downloads.pdf);
  bindLink(downloadDocxLink, downloads.docx, `Download DOCX${downloads.docx?.fileName ? ` (${downloads.docx.fileName})` : ""}`, {
    showDisabled: fileFlow,
    unavailableLabel: "Download DOCX (Unavailable for this output)",
  });
  bindLink(downloadPdfLink, downloads.pdf, `Download PDF${downloads.pdf?.fileName ? ` (${downloads.pdf.fileName})` : ""}`, {
    showDisabled: fileFlow,
    unavailableLabel: "Download PDF (Unavailable for this output)",
  });
  bindLink(downloadTxtLink, downloads.txt, `Download TXT${downloads.txt?.fileName ? ` (${downloads.txt.fileName})` : ""}`);

  const hasDocx = Boolean(downloads.docx?.downloadUrl);
  const hasPdf = Boolean(downloads.pdf?.downloadUrl);
  if (optimization?.preserveFormat && (hasDocx || hasPdf)) {
    downloadHint.textContent = hasDocx && hasPdf
      ? "Generated DOCX and PDF downloads after applying selected changes. DOCX/PDF format-preserving flow may merge generated new points into nearby lines to protect layout."
      : "Generated format-preserving file output after applying selected changes. New generated points may be merged into nearby lines to preserve layout.";
  } else {
    downloadHint.textContent = "Generated optimized resume download after applying selected changes.";
  }
}

function renderScoreComparison(comparison) {
  if (!comparison) {
    scoreCompareGrid.hidden = true;
    if (scoreInlineChange) {
      scoreInlineChange.hidden = true;
      scoreInlineChange.textContent = "";
    }
    return;
  }
  scoreCompareGrid.hidden = false;
  document.getElementById("beforeScoreValue").textContent = comparison.beforeScore ?? 0;
  document.getElementById("afterScoreValue").textContent = comparison.afterScore ?? 0;
  const delta = comparison.delta ?? 0;
  const deltaText = `${delta >= 0 ? "+" : ""}${delta}`;
  document.getElementById("deltaScoreValue").textContent = deltaText;
  if (scoreInlineChange) {
    scoreInlineChange.hidden = false;
    scoreInlineChange.textContent = `${comparison.beforeScore ?? 0} -> ${comparison.afterScore ?? 0}${delta ? ` (${deltaText})` : ""}`;
  }
}

function renderKeywordAddPreview(previewItems) {
  const list = document.getElementById("keywordAddPreview");
  list.innerHTML = "";
  if (!previewItems || !previewItems.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No explicit missing-keyword additions were detected in selected changes.";
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

function resetProposalState() {
  currentDraftSessionId = "";
  currentProposals = [];
  if (proposalReviewCard) proposalReviewCard.hidden = true;
  if (proposalList) proposalList.innerHTML = "";
  if (proposalSelectionMeta) proposalSelectionMeta.textContent = "0 selected";
}

function resetOptimizeOnlySections() {
  renderScoreComparison(null);
  changesCard.hidden = true;
  downloadCard.hidden = true;
  optimizedCard.hidden = true;
  resetProposalState();
  if (scoreLabel) scoreLabel.textContent = "Simulated ATS Match";
  if (scoreInlineChange) {
    scoreInlineChange.hidden = true;
    scoreInlineChange.textContent = "";
  }
}

function getProposalSelectionCount() {
  return currentProposals.filter((p) => p.selected !== false).length;
}

function updateProposalSelectionMeta() {
  const selectedCount = getProposalSelectionCount();
  if (proposalSelectionMeta) {
    proposalSelectionMeta.textContent = `${selectedCount} selected of ${currentProposals.length}`;
  }
  if (applySelectedBtn) {
    applySelectedBtn.disabled = !currentDraftSessionId || !selectedCount;
  }
  if (selectAllProposalsBtn) {
    selectAllProposalsBtn.disabled = !currentProposals.length || selectedCount === currentProposals.length;
  }
  if (deselectAllProposalsBtn) {
    deselectAllProposalsBtn.disabled = !currentProposals.length || selectedCount === 0;
  }
}

function proposalTypeLabel(proposal) {
  if (!proposal) return "Resume";
  if (proposal.operation === "insert_after_line") {
    return `${proposal.targetArea || "Resume"} (New Point)`;
  }
  return proposal.targetArea || proposal.type || "Resume";
}

function renderProposalReview({ proposals, proposalSummary }) {
  currentProposals = Array.isArray(proposals) ? proposals.map((p) => ({ ...p, selected: p.selected !== false })) : [];
  if (!currentProposals.length) {
    if (proposalReviewCard) {
      proposalReviewCard.hidden = false;
      proposalList.innerHTML = `<p class="muted">No editable summary/experience/skills changes were generated for review. Try a full JD text or a different resume version.</p>`;
    }
    if (proposalReviewSummary) {
      proposalReviewSummary.textContent = "No proposed changes available for approval.";
    }
    updateProposalSelectionMeta();
    return;
  }

  if (proposalReviewCard) proposalReviewCard.hidden = false;
  if (proposalReviewSummary) {
    const summaryBits = [];
    if (proposalSummary?.mandatoryAffected != null) summaryBits.push(`${proposalSummary.mandatoryAffected} keyword-targeted`);
    if (proposalSummary?.experienceTargeted != null) summaryBits.push(`${proposalSummary.experienceTargeted} experience edits`);
    if (proposalSummary?.summaryTargeted != null) summaryBits.push(`${proposalSummary.summaryTargeted} summary edits`);
    if (proposalSummary?.generatedNewPoints != null) summaryBits.push(`${proposalSummary.generatedNewPoints} generated new points`);
    proposalReviewSummary.textContent = `Review and approve generated changes before applying them to the resume. ${summaryBits.join(" • ")}`;
  }

  proposalList.innerHTML = "";
  currentProposals.forEach((proposal) => {
    const row = document.createElement("div");
    row.className = `proposal-item ${proposal.selected !== false ? "is-selected" : "is-rejected"}`;
    row.dataset.proposalId = proposal.proposalId;

    const header = document.createElement("div");
    header.className = "proposal-head";
    header.innerHTML = `
      <div>
        <p class="proposal-title">${proposalTypeLabel(proposal)} • Line ${proposal.lineNumber}</p>
        <p class="proposal-meta">${proposal.reason || "Keyword alignment improvement"}</p>
      </div>
      <div class="proposal-actions-inline">
        <button type="button" class="icon-btn approve ${proposal.selected !== false ? "active" : ""}" data-action="approve" title="Approve">✓</button>
        <button type="button" class="icon-btn reject ${proposal.selected === false ? "active" : ""}" data-action="reject" title="Reject">✕</button>
      </div>
    `;
    row.appendChild(header);

    if (proposal.addedKeywords?.length) {
      const chips = document.createElement("div");
      chips.className = "inline-chips";
      proposal.addedKeywords.forEach((k) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = `+ ${k}`;
        chips.appendChild(chip);
      });
      row.appendChild(chips);
    }

    const before = document.createElement("pre");
    before.className = "change-before";
    before.textContent = `Before: ${proposal.before || ""}`;
    row.appendChild(before);

    const after = document.createElement("pre");
    after.className = "change-after";
    after.textContent = `After:  ${proposal.after || ""}`;
    row.appendChild(after);

    proposalList.appendChild(row);
  });

  updateProposalSelectionMeta();
}

function setProposalSelection(proposalId, selected) {
  currentProposals = currentProposals.map((p) => (p.proposalId === proposalId ? { ...p, selected } : p));
  const row = proposalList.querySelector(`[data-proposal-id="${CSS.escape(proposalId)}"]`);
  if (!row) return;
  row.classList.toggle("is-selected", selected);
  row.classList.toggle("is-rejected", !selected);
  row.querySelector('[data-action="approve"]')?.classList.toggle("active", selected);
  row.querySelector('[data-action="reject"]')?.classList.toggle("active", !selected);
  updateProposalSelectionMeta();
}

function setAllProposals(selected) {
  if (!currentProposals.length) return;
  currentProposals = currentProposals.map((p) => ({ ...p, selected }));
  renderProposalReview({ proposals: currentProposals });
}

function getSelectedProposalIds() {
  return currentProposals.filter((p) => p.selected !== false).map((p) => p.proposalId);
}

function startLoader(mode) {
  clearInterval(loaderTimer);
  loaderStartedAt = Date.now();
  loaderCard.hidden = false;

  const hasFile = document.getElementById("resumeFile").files.length > 0;
  const steps =
    mode === "optimize-apply"
      ? (hasFile
        ? [
            { p: 10, label: "Applying approvals", sub: "Applying selected changes to your DOCX/PDF..." },
            { p: 45, label: "Format-preserving update", sub: "Updating file lines in-place while preserving layout..." },
            { p: 72, label: "Re-analyzing ATS score", sub: "Computing before vs after match score..." },
            { p: 92, label: "Preparing download", sub: "Generating final file download link..." },
          ]
        : [
            { p: 12, label: "Applying approvals", sub: "Applying approved line changes to resume text..." },
            { p: 58, label: "Re-analyzing ATS score", sub: "Computing before vs after ATS match..." },
            { p: 92, label: "Preparing download", sub: "Creating optimized text download..." },
          ])
      : mode === "optimize-propose"
        ? (hasFile
          ? [
              { p: 8, label: "Upload received", sub: "Reading your resume file..." },
              { p: 25, label: "Extracting content", sub: "Parsing DOCX/PDF while preserving structure..." },
              { p: 48, label: "Analyzing ATS match", sub: "Scoring keyword coverage and missing terms..." },
              { p: 78, label: "Generating proposals", sub: "AI is drafting summary/experience/skills changes for approval..." },
              { p: 94, label: "Preparing review", sub: "Building approve/reject list of proposed points..." },
            ]
          : [
              { p: 12, label: "Analyzing ATS match", sub: "Scoring current resume against the JD..." },
              { p: 55, label: "Generating proposals", sub: "AI is drafting line updates for summary/experience/skills..." },
              { p: 92, label: "Preparing review", sub: "Building approve/reject list..." },
            ])
        : [
            { p: 15, label: "Analyzing ATS match", sub: "Extracting keywords and scoring alignment..." },
            { p: 80, label: "Preparing insights", sub: "Collecting missing keywords and action plan..." },
          ];

  loaderTitle.textContent =
    mode === "optimize-apply"
      ? "Applying selected resume changes..."
      : mode === "optimize-propose"
        ? "Generating optimization proposals..."
        : "Analyzing your resume...";
  progressFill.style.width = "0%";
  progressPercent.textContent = "0%";
  progressStep.textContent = "Queued";
  loaderSubtitle.textContent = steps[0]?.sub || "";

  loaderTimer = setInterval(() => {
    const elapsed = Date.now() - loaderStartedAt;
    const duration = mode === "analyze" ? 4500 : 12000;
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
  loaderSubtitle.textContent = success
    ? "Review the generated changes, ATS comparison, and final download."
    : "Request failed. Fix the issue and try again.";

  setTimeout(() => {
    loaderCard.hidden = true;
  }, 700);
}

function getOptimizeEndpoint() {
  const fileInput = document.getElementById("resumeFile");
  const hasFile = fileInput.files.length > 0;
  const file = fileInput.files[0];
  const fileExt = file ? (file.name.split(".").pop() || "").toLowerCase() : "";
  const useFileOptimize = hasFile && ["docx", "pdf"].includes(fileExt);
  return useFileOptimize ? "/api/optimize-file" : "/api/optimize";
}

async function submitAnalyze() {
  const formData = new FormData(form);
  setBusy(true);
  startLoader("analyze");
  setStatus("Analyzing resume match...");

  try {
    clearErrorPanel();
    const response = await fetch("/api/analyze", { method: "POST", body: formData });
    const rawText = await response.text();
    const data = rawText ? JSON.parse(rawText) : {};
    if (!response.ok) {
      const err = new Error(data.error || `Request failed (${response.status}).`);
      err.details = data.details || data.debug || rawText || "";
      throw err;
    }

    renderAnalysis(data.analysis || data.beforeAnalysis);
    if (Array.isArray(data.experienceTargets)) {
      populateExperienceTargets(data.experienceTargets);
      if (data.experienceTargets.length) {
        setExperienceTargetHint(`Detected ${data.experienceTargets.length} experience block${data.experienceTargets.length > 1 ? "s" : ""} from your resume.`, "success");
      }
    }
    resetOptimizeOnlySections();
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

async function requestOptimizeProposals() {
  const formData = new FormData(form);
  const resumeText = String(formData.get("resumeText") || "").trim();
  const hasFile = document.getElementById("resumeFile").files.length > 0;
  if (!resumeText && !hasFile) {
    setStatus("Please paste resume text or upload a resume file.", "error");
    return;
  }

  setBusy(true);
  startLoader("optimize-propose");
  setStatus("Analyzing + generating optimization proposals for your approval...");

  try {
    clearErrorPanel();
    const response = await fetch(getOptimizeEndpoint(), { method: "POST", body: formData });
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_err) {
      throw new Error(response.ok ? "Server returned an invalid response." : `Request failed (${response.status}).`);
    }
    if (!response.ok) {
      const err = new Error(data.error || `Request failed (${response.status}).`);
      err.details = data.details || data.debug || rawText || "";
      throw err;
    }

    currentDraftSessionId = data.draftSessionId || "";
    renderAnalysis(data.beforeAnalysis || data.analysis);
    if (Array.isArray(data.experienceTargets)) {
      populateExperienceTargets(data.experienceTargets);
      if (data.experienceTargets.length) {
        setExperienceTargetHint(`Detected ${data.experienceTargets.length} experience block${data.experienceTargets.length > 1 ? "s" : ""}; proposals can target your selected block.`, "success");
      }
    }
    if (scoreLabel) scoreLabel.textContent = "Simulated ATS Match (Before Optimization)";
    renderOptimization(null);
    renderDownloadOutput(null);
    renderScoreComparison(null);
    renderChangesPreview(null);
    renderProposalReview(data);
    setStatus("Review the generated changes. Approve or reject each point, then click Apply Selected Changes.", "success");
    finishLoader(true);
  } catch (error) {
    resetProposalState();
    setStatus(error.message || "Unexpected error.", "error");
    showErrorPanel(error.details || error.stack || "");
    finishLoader(false);
  } finally {
    setBusy(false);
  }
}

async function applySelectedChanges() {
  if (!currentDraftSessionId) {
    setStatus("No optimization draft is active. Click Analyze + Optimize first.", "error");
    return;
  }
  const selectedProposalIds = getSelectedProposalIds();
  if (!selectedProposalIds.length) {
    setStatus("Select at least one proposed change to apply.", "error");
    return;
  }

  setBusy(true);
  startLoader("optimize-apply");
  setStatus("Applying selected changes and generating final optimized resume...");

  try {
    clearErrorPanel();
    const response = await fetch("/api/apply-selected", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftSessionId: currentDraftSessionId, selectedProposalIds }),
    });
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_err) {
      throw new Error(response.ok ? "Server returned an invalid response." : `Request failed (${response.status}).`);
    }
    if (!response.ok) {
      const err = new Error(data.error || `Request failed (${response.status}).`);
      err.details = data.details || data.debug || rawText || "";
      throw err;
    }

    renderAnalysis(data.afterAnalysis || data.analysis);
    if (scoreLabel) scoreLabel.textContent = "Simulated ATS Match (After Optimization)";
    renderOptimization(data.optimization);
    renderDownloadOutput(data.output, data.optimization);
    renderScoreComparison(data.comparison);
    renderKeywordAddPreview(data.changePreview);
    renderChangesPreview(data.changePreview);
    setStatus("Selected changes applied. Review before vs after score and download the updated resume.", "success");
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
  submitAnalyze();
});

optimizeAllBtn.addEventListener("click", () => {
  requestOptimizeProposals();
});

clearJobBtn.addEventListener("click", () => {
  document.getElementById("jobDescription").value = "";
  setStatus("Job description cleared.");
});

clearResumeBtn.addEventListener("click", () => {
  document.getElementById("resumeText").value = "";
  setStatus("Resume text cleared.");
  scheduleResumeContextLoad(100);
});

document.getElementById("resumeText").addEventListener("input", () => {
  scheduleResumeContextLoad();
});

document.getElementById("resumeFile").addEventListener("change", () => {
  scheduleResumeContextLoad(120);
});

refreshExperienceTargetsBtn?.addEventListener("click", () => {
  loadResumeContext({ silent: false });
});

proposalList?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = event.target.closest("[data-proposal-id]");
  if (!row) return;
  const action = button.dataset.action;
  const proposalId = row.dataset.proposalId;
  if (action === "approve") setProposalSelection(proposalId, true);
  if (action === "reject") setProposalSelection(proposalId, false);
});

applySelectedBtn?.addEventListener("click", () => {
  applySelectedChanges();
});

selectAllProposalsBtn?.addEventListener("click", () => {
  setAllProposals(true);
});

deselectAllProposalsBtn?.addEventListener("click", () => {
  setAllProposals(false);
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
  loadResumeContext({ silent: true });
})();
