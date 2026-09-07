function bindImageViewer() {
  document.querySelector("#closeImageViewer")?.addEventListener("click", closeImageViewer);
  document.querySelector("#imageViewerDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeImageViewer();
  });
}

function openImageViewer(attachmentId, fileName, contentType = "") {
  if (!attachmentId) return;

  const dialog = document.querySelector("#imageViewerDialog");
  const image = document.querySelector("#imageViewerImage");
  const pdf = document.querySelector("#imageViewerPdf");
  const original = document.querySelector("#imageViewerOpenOriginal");
  const url = `/api/attachments/${attachmentId}`;
  const isPdf =
    String(contentType || "").toLowerCase() === "application/pdf" ||
    String(fileName || "").toLowerCase().endsWith(".pdf");

  document.querySelector("#imageViewerFileName").textContent = fileName || "Receipt";
  original.href = url;

  if (isPdf) {
    if (image) {
      image.hidden = true;
      image.removeAttribute("src");
    }
    if (pdf) {
      pdf.hidden = false;
      pdf.src = `${url}#page=1&toolbar=0&navpanes=0`;
    }
  } else {
    if (pdf) {
      pdf.hidden = true;
      pdf.removeAttribute("src");
    }
    if (image) {
      image.hidden = false;
      image.alt = fileName || "Receipt";
      image.src = url;
    }
  }

  dialog.showModal();
}

function closeImageViewer() {
  const dialog = document.querySelector("#imageViewerDialog");
  const image = document.querySelector("#imageViewerImage");
  const pdf = document.querySelector("#imageViewerPdf");

  if (image) image.removeAttribute("src");
  if (pdf) pdf.removeAttribute("src");

  dialog?.close();
}

function formatDateOnly(value) {
  if (!value) return "Date unknown";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleDateString();
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}


async function readError(response) {
  try {
    const body = await response.json();
    return body.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function escapeAttribute(value) { return escapeHtml(value); }
