const form = document.getElementById("analyzer-form");
const analyzeBtn = document.getElementById("analyzeBtn");
const optimizeBtn = document.getElementById("optimizeBtn");
const statusText = document.getElementById("statusText");
const resultsPanel = document.getElementById("resultsPanel");
const optimizedCard = document.getElementById("optimizedCard");
const copyOptimizedBtn = document.getElementById("copyOptimizedBtn");

function setStatus(message, type = "info") {
  statusText.textContent = message || "";
  statusText.dataset.type = type;
}

function setBusy(isBusy) {
  analyzeBtn.disabled = isBusy;
  optimizeBtn.disabled = isBusy;
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
  Object.entries(breakdown).forEach(([key, value]) => {
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
  resultsPanel.hidden = false;
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

async function submitAnalysis(mode = "analyze") {
  const formData = new FormData(form);
  const endpoint = mode === "optimize" ? "/api/optimize" : "/api/analyze";
  setBusy(true);
  setStatus(mode === "optimize" ? "Analyzing + generating optimized draft..." : "Analyzing resume match...");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    renderAnalysis(data.analysis);
    renderOptimization(data.optimization);

    if (mode === "analyze") {
      optimizedCard.hidden = true;
    }

    const aiText = data.aiEnabled ? "AI optimization is enabled." : "AI optimization is not configured (set OPENAI_API_KEY).";
    setStatus(`Completed. ${aiText}`, "success");
  } catch (error) {
    setStatus(error.message || "Unexpected error.", "error");
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAnalysis("analyze");
});

optimizeBtn.addEventListener("click", () => {
  submitAnalysis("optimize");
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
