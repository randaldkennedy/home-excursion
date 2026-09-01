function bindImageViewer() {
  document.querySelector("#closeImageViewer")?.addEventListener("click", closeImageViewer);
  document.querySelector("#imageViewerDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeImageViewer();
  });
}

function openImageViewer(attachmentId, fileName) {
  if (!attachmentId) return;

  const dialog = document.querySelector("#imageViewerDialog");
  const image = document.querySelector("#imageViewerImage");
  const original = document.querySelector("#imageViewerOpenOriginal");

  document.querySelector("#imageViewerFileName").textContent = fileName || "Receipt";
  image.alt = fileName || "Receipt";
  image.src = `/api/attachments/${attachmentId}`;
  original.href = `/api/attachments/${attachmentId}`;

  dialog.showModal();
}

function closeImageViewer() {
  const dialog = document.querySelector("#imageViewerDialog");
  const image = document.querySelector("#imageViewerImage");
  if (image) image.removeAttribute("src");
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
