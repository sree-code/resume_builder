const mammoth = require("mammoth");

let pdfParse = null;
try {
  // Lazy-loaded fallback; newer versions may require Node >=20.
  // We keep parsing optional and return a clear message if unavailable.
  pdfParse = require("pdf-parse");
} catch (_error) {
  pdfParse = null;
}

async function parseResumeUpload(file) {
  const name = (file.originalname || "").toLowerCase();
  const mime = file.mimetype || "";
  const buffer = file.buffer;

  if (!buffer || !buffer.length) {
    throw new Error("Uploaded file is empty.");
  }

  if (name.endsWith(".txt") || mime === "text/plain") {
    return { text: buffer.toString("utf8"), source: "txt-upload" };
  }

  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value || "", source: "docx-upload" };
  }

  if (name.endsWith(".pdf") || mime === "application/pdf") {
    if (!pdfParse) {
      throw new Error("PDF parsing is not available on this Node version. Paste resume text or use DOCX/TXT.");
    }
    const result = await pdfParse(buffer);
    return { text: result.text || "", source: "pdf-upload" };
  }

  throw new Error("Unsupported resume file type. Use TXT, DOCX, or PDF.");
}

module.exports = { parseResumeUpload };
