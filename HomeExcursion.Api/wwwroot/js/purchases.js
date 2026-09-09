let selectedPurchaseIds = new Set();
let purchaseTableSort = { key: "date", direction: "desc" };
let quickReceiptLineItemsDraft = [];

function bindPurchaseEditor() {
  document.querySelector("#addPurchaseButton")?.addEventListener("click", () => openPurchaseDialog());
  document.querySelector("#quickReceiptButton")?.addEventListener("click", openQuickReceiptDialog);
  document.querySelector("#closeQuickReceiptDialog")?.addEventListener("click", closeQuickReceiptDialog);
  document.querySelector("#cancelQuickReceiptButton")?.addEventListener("click", closeQuickReceiptDialog);
  document.querySelector("#quickReceiptForm")?.addEventListener("submit", saveQuickReceipt);
  document.querySelector("#quickReceiptFile")?.addEventListener("change", handleQuickReceiptFileSelection);
  document.querySelector("#quickReceiptLineItems")?.addEventListener("change", handleQuickReceiptAliasChange);
  document.querySelector("#saveQuickReceiptAnywayButton")?.addEventListener("click", () => saveQuickReceipt(null, true));
  document.querySelector("#quickReceiptDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeQuickReceiptDialog();
  });
  document.querySelector("#closePurchaseDialog")?.addEventListener("click", closePurchaseDialog);
  document.querySelector("#cancelPurchaseButton")?.addEventListener("click", closePurchaseDialog);
  document.querySelector("#purchaseForm")?.addEventListener("submit", savePurchase);
  document.querySelector("#deletePurchaseButton")?.addEventListener("click", deletePurchase);
  document.querySelector("#verifyPurchaseButton")?.addEventListener("click", verifyPurchase);
  document.querySelector("#addAllocationButton")?.addEventListener("click", () => addAllocationRow());
  document.querySelector("#purchaseAllocations")?.addEventListener("click", handleAllocationClick);
  document.querySelector("#purchaseAllocations")?.addEventListener("change", handleAllocationChange);
  document.querySelector("#purchaseLineItems")?.addEventListener("change", handlePurchaseLineItemAssignmentChange);
  document.querySelector("#readPurchaseLineItemsButton")?.addEventListener("click", readExistingPurchaseLineItems);
  document.querySelector("#readPurchaseLineItemsEmptyButton")?.addEventListener("click", readExistingPurchaseLineItems);
  document.querySelector("#purchaseTotal")?.addEventListener("input", updateReconciliation);
  document.querySelector("#purchaseReceiptFiles")?.addEventListener("change", handlePurchaseReceiptSelection);
  document.querySelector("#purchaseExistingReceipts")?.addEventListener("click", handlePurchaseReceiptClick);
  document.querySelector("#saveDuplicateAnywayButton")?.addEventListener("click", () => savePurchase(null, true));
  document.querySelector("#purchaseDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closePurchaseDialog();
  });
}

function bindPurchaseFilters() {
  document.querySelector("#purchaseSearch")?.addEventListener("input", event => {
    state.purchaseFilter = event.target.value.trim().toLowerCase();
    renderPurchases();
  });

  document.querySelector("#purchaseStatusFilter")?.addEventListener("change", event => {
    state.purchaseStatus = event.target.value;
    renderPurchases();
  });

  document.querySelector("#deleteSelectedPurchasesButton")?.addEventListener("click", deleteSelectedPurchases);

  document.querySelector("#purchases")?.addEventListener("click", event => {
    const sortButton = event.target.closest("[data-purchase-sort]");
    if (sortButton) {
      setPurchaseTableSort(sortButton.dataset.purchaseSort);
      return;
    }

    const selectAll = event.target.closest("#purchaseSelectAll");
    if (selectAll) {
      toggleSelectAllVisiblePurchases(selectAll.checked);
      return;
    }

    const checkbox = event.target.closest("[data-select-purchase]");
    if (checkbox) {
      const id = Number(checkbox.dataset.selectPurchase);
      if (checkbox.checked) selectedPurchaseIds.add(id);
      else selectedPurchaseIds.delete(id);
      updatePurchaseBulkActions();
      updatePurchaseSelectAllState();
      return;
    }

    const row = event.target.closest("[data-purchase-id]");
    if (!row) return;
    const purchase = state.purchases.find(item => item.id === Number(row.dataset.purchaseId));
    if (purchase) openPurchaseDialog(purchase);
  });
}

function bindPurchaseNavigation() {
  const card = document.querySelector("#spentSummaryCard");
  const panel = document.querySelector(".purchases-panel");
  if (!card || !panel) return;
  const jump = () => panel.scrollIntoView({ behavior: "smooth", block: "start" });
  card.addEventListener("click", jump);
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); jump(); }
  });
}

async function loadPurchases() {
  try {
    const propertyId = Number(state.data?.property?.id || 0);
    const query = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
    const response = await fetch(`/api/home/purchases${query}`, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(await readError(response));
    state.purchases = await response.json();
    rebuildPurchaseAllocations();
    renderPurchases();
    renderTasks();
    const dialog = document.querySelector("#taskDialog");
    if (dialog?.open) {
      const taskId = Number(document.querySelector("#taskId")?.value || 0);
      renderTaskExpenses(state.data?.tasks?.find(t => t.id === taskId) || null);
    }
  } catch (error) {
    console.error(error);
    const container = document.querySelector("#purchases");
    if (container) container.innerHTML = `<div class="empty">${escapeHtml(error.message || "Could not load purchases.")}</div>`;
  }
}

function rebuildPurchaseAllocations() {
  state.purchaseAllocations = state.purchases.flatMap(purchase =>
    (purchase.allocations || []).map(allocation => ({ ...allocation, purchaseId: purchase.id, purchase }))
  );
}

function getVisiblePurchases() {
  let rows = [...state.purchases];

  if (state.purchaseStatus) {
    if (state.purchaseStatus === "Unassigned") rows = rows.filter(p => p.hasUnassigned);
    else rows = rows.filter(p => p.status === state.purchaseStatus);
  }

  if (state.purchaseFilter) {
    rows = rows.filter(p => {
      const haystack = [
        p.vendorName,
        p.vendor,
        p.purchaseDate,
        p.status,
        ...(p.allocations || []).flatMap(a => [
          a.description,
          a.category,
          a.projectName,
          a.taskTitle
        ])
      ].filter(Boolean).join(" ").toLowerCase();

      return haystack.includes(state.purchaseFilter);
    });
  }

  rows.sort(comparePurchaseTableRows);
  return rows;
}

function renderPurchases() {
  const container = document.querySelector("#purchases");
  const stats = document.querySelector("#purchaseStats");
  if (!container || !stats) return;

  const rows = getVisiblePurchases();

  const existingIds = new Set(state.purchases.map(p => Number(p.id)));
  selectedPurchaseIds = new Set(
    [...selectedPurchaseIds].filter(id => existingIds.has(id))
  );

  const needsReview = state.purchases.filter(
    p => p.status !== "Verified" && p.status !== "Ignored"
  ).length;
  const homeSpend = state.purchases.reduce(
    (sum, p) => sum + Number(p.homeSpend || 0),
    0
  );

  stats.textContent =
    `${state.purchases.length} purchases · ${needsReview} need review · ${moneyExact.format(homeSpend)} Home spend`;

  if (!rows.length) {
    container.innerHTML = `<div class="empty">No purchases in this view.</div>`;
    updatePurchaseBulkActions();
    return;
  }

  const deletableVisible = rows.filter(p => p.canBulkDelete !== false);
  const allVisibleSelected =
    deletableVisible.length > 0 &&
    deletableVisible.every(p => selectedPurchaseIds.has(Number(p.id)));

  container.innerHTML = `
    <div class="purchase-table">
      <div class="purchase-table-header">
        <div class="purchase-select-cell">
          ${deletableVisible.length
            ? `<input id="purchaseSelectAll" type="checkbox" ${allVisibleSelected ? "checked" : ""} aria-label="Select all deletable purchases in this view">`
            : ""}
        </div>
        ${purchaseSortHeader("date", "Date")}
        ${purchaseSortHeader("vendor", "Vendor")}
        ${purchaseSortHeader("status", "Status")}
        ${purchaseSortHeader("amount", "Amount", "purchase-sort-amount")}
      </div>

      ${rows.map(p => {
        const vendor = p.vendorName || p.vendor || "Vendor not recorded";
        const date = p.purchaseDate ? formatDateOnly(p.purchaseDate) : "Date unknown";
        const difference = Number(p.difference || 0);
        const statusClass = p.status === "Verified" ? "verified" : "review";
        const allocationSummary = (p.allocations || []).slice(0, 3).map(a => a.description).join(" · ");
        const extra = (p.allocations || []).length > 3
          ? ` · +${p.allocations.length - 3} more`
          : "";
        const receipt = (p.attachments || []).length
          ? `📎 ${(p.attachments || []).length}`
          : "No receipt";
        const canDelete = p.canBulkDelete !== false;
        const selected = selectedPurchaseIds.has(Number(p.id));

        return `<article class="purchase-table-row" data-purchase-id="${p.id}">
          <div class="purchase-select-cell">
            ${canDelete
              ? `<input type="checkbox" data-select-purchase="${p.id}" ${selected ? "checked" : ""} aria-label="Select ${escapeAttribute(vendor)} for deletion">`
              : ""}
          </div>

          <div class="purchase-date">${escapeHtml(date)}</div>

          <div class="purchase-main">
            <strong class="purchase-vendor">${escapeHtml(vendor)}</strong>
            <div class="purchase-allocation-summary">${escapeHtml(allocationSummary || "Unassigned")}${escapeHtml(extra)}</div>
            <div class="purchase-meta">${receipt}${Math.abs(difference) > .004 ? ` · Difference ${moneyExact.format(difference)}` : ""}</div>
          </div>

          <div class="purchase-status-cell">
            <span class="purchase-status ${statusClass}">${escapeHtml(p.status)}</span>
          </div>

          <div class="purchase-amount">${moneyExact.format(Number(p.total) || 0)}</div>
        </article>`;
      }).join("")}
    </div>`;

  updatePurchaseBulkActions();
  updatePurchaseSelectAllState();
}

function purchaseSortHeader(key, label, extraClass = "") {
  const active = purchaseTableSort.key === key;
  const arrow = active
    ? (purchaseTableSort.direction === "asc" ? " ↑" : " ↓")
    : "";

  return `<button type="button"
    class="purchase-sort-header ${extraClass} ${active ? "active" : ""}"
    data-purchase-sort="${key}">
    ${escapeHtml(label)}${arrow}
  </button>`;
}

function setPurchaseTableSort(key) {
  if (!["date", "vendor", "status", "amount"].includes(key)) return;

  if (purchaseTableSort.key === key) {
    purchaseTableSort.direction =
      purchaseTableSort.direction === "asc" ? "desc" : "asc";
  } else {
    purchaseTableSort.key = key;
    purchaseTableSort.direction =
      key === "date" || key === "amount" ? "desc" : "asc";
  }

  renderPurchases();
}

function comparePurchaseTableRows(a, b) {
  const direction = purchaseTableSort.direction === "asc" ? 1 : -1;
  let result = 0;

  switch (purchaseTableSort.key) {
    case "vendor":
      result = String(a.vendorName || a.vendor || "")
        .localeCompare(String(b.vendorName || b.vendor || ""), undefined, { sensitivity: "base" });
      break;
    case "status":
      result = String(a.status || "")
        .localeCompare(String(b.status || ""), undefined, { sensitivity: "base" });
      break;
    case "amount":
      result = Number(a.total || 0) - Number(b.total || 0);
      break;
    case "date":
    default:
      result = comparePurchaseDates(a, b);
      break;
  }

  return (result || (Number(a.id) - Number(b.id))) * direction;
}

function comparePurchaseDates(a, b) {
  const aa = a?.purchaseDate ? Date.parse(`${a.purchaseDate}T00:00:00`) : 0;
  const bb = b?.purchaseDate ? Date.parse(`${b.purchaseDate}T00:00:00`) : 0;
  return aa - bb;
}

function toggleSelectAllVisiblePurchases(checked) {
  for (const purchase of getVisiblePurchases()) {
    if (purchase.canBulkDelete === false) continue;
    const id = Number(purchase.id);
    if (checked) selectedPurchaseIds.add(id);
    else selectedPurchaseIds.delete(id);
  }

  renderPurchases();
}

function updatePurchaseSelectAllState() {
  const selectAll = document.querySelector("#purchaseSelectAll");
  if (!selectAll) return;

  const deletableVisible = getVisiblePurchases()
    .filter(p => p.canBulkDelete !== false);

  const selectedVisibleCount = deletableVisible
    .filter(p => selectedPurchaseIds.has(Number(p.id)))
    .length;

  selectAll.checked =
    deletableVisible.length > 0 &&
    selectedVisibleCount === deletableVisible.length;

  selectAll.indeterminate =
    selectedVisibleCount > 0 &&
    selectedVisibleCount < deletableVisible.length;
}

function updatePurchaseBulkActions() {
  const bar = document.querySelector("#purchaseBulkActions");
  const count = document.querySelector("#purchaseSelectedCount");
  const button = document.querySelector("#deleteSelectedPurchasesButton");
  if (!bar || !count || !button) return;

  const selectedCount = selectedPurchaseIds.size;
  bar.hidden = selectedCount === 0;
  count.textContent = `${selectedCount} selected`;
  button.disabled = selectedCount === 0;
}

async function deleteSelectedPurchases() {
  const ids = [...selectedPurchaseIds];
  if (!ids.length) return;

  const noun = ids.length === 1 ? "purchase" : "purchases";
  if (!confirm(`Delete ${ids.length} ${noun} and all attached receipt files?`)) return;

  const button = document.querySelector("#deleteSelectedPurchasesButton");
  if (button) {
    button.disabled = true;
    button.textContent = "Deleting…";
  }

  try {
    const response = await fetch("/api/home/purchases/bulk-delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ purchaseIds: ids })
    });

    if (!response.ok) throw new Error(await readError(response));

    const result = await response.json();
    selectedPurchaseIds.clear();
    await loadDashboard();
    showToast(`${result.deletedCount || ids.length} ${noun} deleted.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not delete selected purchases.");
  } finally {
    if (button) {
      button.textContent = "🗑 Delete selected";
    }
    updatePurchaseBulkActions();
  }
}


function localTodayValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function openQuickReceiptDialog() {
  const dialog = document.querySelector("#quickReceiptDialog");
  const form = document.querySelector("#quickReceiptForm");
  if (!dialog || !form) return;

  form.reset();
  document.querySelector("#quickReceiptDate").value = localTodayValue();
  clearQuickReceiptError();
  hideQuickReceiptDuplicateWarning();
  updateQuickReceiptFileLabel();
  resetQuickReceiptAnalysis();
  dialog.showModal();

  window.setTimeout(() => {
    document.querySelector("#quickReceiptFile")?.click();
  }, 80);
}

function closeQuickReceiptDialog() {
  document.querySelector("#quickReceiptDialog")?.close();
  clearQuickReceiptError();
  hideQuickReceiptDuplicateWarning();
  resetQuickReceiptAnalysis();
}

function updateQuickReceiptFileLabel() {
  const input = document.querySelector("#quickReceiptFile");
  const label = document.querySelector("#quickReceiptFileLabel");
  const picker = input?.closest(".quick-receipt-photo");
  const file = input?.files?.[0];

  if (!label) return;

  if (file) {
    label.textContent = file.name;
    picker?.classList.add("has-file");
  } else {
    label.textContent = "Take or choose receipt";
    picker?.classList.remove("has-file");
  }
}


async function handleQuickReceiptFileSelection() {
  updateQuickReceiptFileLabel();
  clearQuickReceiptError();
  hideQuickReceiptDuplicateWarning();

  const file = document.querySelector("#quickReceiptFile")?.files?.[0];
  if (!file) {
    resetQuickReceiptAnalysis();
    return;
  }

  const supportedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  const isSupportedReceiptFile = supportedTypes.includes(
    String(file.type || "").toLowerCase());

  if (!isSupportedReceiptFile) {
    showQuickReceiptAnalysis(
      "AI reading skipped",
      "Automatic reading currently supports JPEG, PNG, WebP and PDF receipts.",
      []);
    return;
  }

  showQuickReceiptAnalysis(
    "Reading receipt…",
    "AI is looking for vendor, date, totals and line items.",
    []);

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/home/receipt-analysis/analyze", {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const result = await response.json();

    if (result.vendor) {
      document.querySelector("#quickReceiptVendor").value = result.vendor;
    }
    if (result.purchaseDate) {
      document.querySelector("#quickReceiptDate").value = result.purchaseDate;
    }
    if (result.total != null) {
      document.querySelector("#quickReceiptTotal").value = Number(result.total).toFixed(2);
    }
    if (result.subtotal != null) {
      document.querySelector("#quickReceiptSubtotal").value = Number(result.subtotal).toFixed(2);
    }
    if (result.tax != null) {
      document.querySelector("#quickReceiptTax").value = Number(result.tax).toFixed(2);
    }

    const lineItemsWithAliases = await resolveQuickReceiptAliases(result.lineItems || []);
    quickReceiptLineItemsDraft = lineItemsWithAliases.map(item => ({ ...item }));
    renderQuickReceiptLineItems(quickReceiptLineItemsDraft);

    const found = [
      result.vendor ? "vendor" : null,
      result.purchaseDate ? "date" : null,
      result.total != null ? "total" : null,
      result.subtotal != null ? "subtotal" : null,
      result.tax != null ? "tax" : null,
      Array.isArray(result.lineItems) && result.lineItems.length
        ? `${result.lineItems.length} line item${result.lineItems.length === 1 ? "" : "s"}`
        : null
    ].filter(Boolean);

    showQuickReceiptAnalysis(
      "Receipt read",
      found.length
        ? `Filled ${found.join(", ")}. Give it a quick look before saving.`
        : "I could not confidently fill any fields. Enter them manually.",
      result.warnings || []);

    document.querySelector("#quickReceiptTotal")?.focus();
  } catch (error) {
    console.error(error);
    showQuickReceiptAnalysis(
      "Could not read receipt",
      error.message || "AI analysis failed. You can still enter the receipt manually.",
      []);
  }
}

function showQuickReceiptAnalysis(title, message, warnings) {
  const status = document.querySelector("#quickReceiptAnalysisStatus");
  const messageElement = document.querySelector("#quickReceiptAnalysisMessage");
  const warningBox = document.querySelector("#quickReceiptAnalysisWarnings");

  if (status) {
    const strong = status.querySelector("strong");
    if (strong) strong.textContent = title;
    if (messageElement) messageElement.textContent = message;
    status.hidden = false;
  }

  if (warningBox) {
    if (warnings?.length) {
      warningBox.innerHTML = `<strong>Check this:</strong> ${warnings.map(w => escapeHtml(w)).join(" · ")}`;
      warningBox.hidden = false;
    } else {
      warningBox.innerHTML = "";
      warningBox.hidden = true;
    }
  }
}


async function resolveQuickReceiptAliases(items) {
  const rows = Array.isArray(items) ? items : [];
  const receiptTexts = rows
    .map(item => String(item?.description || "").trim())
    .filter(Boolean);

  if (!receiptTexts.length) return rows;

  try {
    const response = await fetch("/api/home/purchases/item-aliases/resolve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ receiptTexts })
    });

    if (!response.ok) throw new Error(await readError(response));

    const body = await response.json();
    const aliases = Array.isArray(body.aliases) ? body.aliases : [];
    const byNormalized = new Map(
      aliases.map(alias => [
        normalizeReceiptItemText(alias.normalizedReceiptText || alias.receiptText),
        alias.displayName
      ]));

    return rows.map(item => {
      const receiptText = String(item?.description || "").trim();
      return {
        ...item,
        receiptText,
        displayName: byNormalized.get(normalizeReceiptItemText(receiptText)) || receiptText
      };
    });
  } catch (error) {
    console.error("Could not resolve learned receipt item names.", error);
    return rows.map(item => ({
      ...item,
      receiptText: String(item?.description || "").trim(),
      displayName: String(item?.description || "").trim()
    }));
  }
}

function normalizeReceiptItemText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function renderQuickReceiptLineItems(items) {
  const section = document.querySelector("#quickReceiptLineItemsSection");
  const count = document.querySelector("#quickReceiptLineItemsCount");
  const container = document.querySelector("#quickReceiptLineItems");

  if (!section || !count || !container) return;

  const rows = Array.isArray(items)
    ? items.filter(item => item &&
        (String(item.description || item.receiptText || "").trim() ||
         item.quantity != null ||
         item.unitPrice != null ||
         item.lineTotal != null))
    : [];

  if (!rows.length) {
    section.hidden = true;
    count.textContent = "0 items";
    container.innerHTML = "";
    return;
  }

  count.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;

  container.innerHTML = rows.map((item, index) => {
    const receiptText = String(item.receiptText || item.description || "Item not clearly described").trim();
    const displayName = String(item.displayName || receiptText).trim();
    const quantity = item.quantity != null ? Number(item.quantity) : null;
    const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : null;
    const receiptLineTotal = item.lineTotal != null ? Number(item.lineTotal) : null;

    const calculatedTotal =
      quantity != null && unitPrice != null
        ? Math.round(quantity * unitPrice * 100) / 100
        : null;

    const displayTotal = calculatedTotal ?? receiptLineTotal;

    const details = [
      quantity != null ? `Qty ${escapeHtml(String(quantity))}` : null,
      unitPrice != null ? `${moneyExact.format(unitPrice)} each` : null
    ].filter(Boolean).join(" · ");

    const learned = normalizeReceiptItemText(displayName) !== normalizeReceiptItemText(receiptText);

    return `<div class="quick-receipt-line-item">
      <div class="quick-receipt-line-item-main">
        <span class="quick-receipt-line-number">${index + 1}</span>
        <div>
          <input
            class="quick-receipt-line-description"
            type="text"
            maxlength="300"
            value="${escapeAttribute(displayName)}"
            data-receipt-text="${escapeAttribute(receiptText)}"
            aria-label="Friendly item name">
          ${learned ? `<small class="quick-receipt-original-name">Receipt: ${escapeHtml(receiptText)}</small>` : ""}
          ${details ? `<small>${details}</small>` : ""}
        </div>
      </div>
      <strong class="quick-receipt-line-total">${displayTotal != null ? moneyExact.format(displayTotal) : "—"}</strong>
    </div>`;
  }).join("");

  section.hidden = false;
}

async function handleQuickReceiptAliasChange(event) {
  const input = event.target.closest(".quick-receipt-line-description");
  if (!input) return;

  const receiptText = String(input.dataset.receiptText || "").trim();
  const displayName = String(input.value || "").trim();

  if (!receiptText || !displayName) {
    input.value = displayName || receiptText;
    return;
  }

  input.disabled = true;

  try {
    const response = await fetch("/api/home/purchases/item-aliases", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ receiptText, displayName })
    });

    if (!response.ok) throw new Error(await readError(response));

    const result = await response.json();
    input.value = result.displayName || displayName;

    const draftItem = quickReceiptLineItemsDraft.find(
      item => normalizeReceiptItemText(item.receiptText || item.description) === normalizeReceiptItemText(receiptText)
    );
    if (draftItem) draftItem.displayName = input.value;

    let original = input.parentElement?.querySelector(".quick-receipt-original-name");
    const learned =
      normalizeReceiptItemText(input.value) !== normalizeReceiptItemText(receiptText);

    if (learned && !original) {
      original = document.createElement("small");
      original.className = "quick-receipt-original-name";
      input.insertAdjacentElement("afterend", original);
    }

    if (original) {
      if (learned) {
        original.textContent = `Receipt: ${receiptText}`;
      } else {
        original.remove();
      }
    }

    showToast(result.remembered
      ? "Item name remembered."
      : "Item name reset to receipt text.");
  } catch (error) {
    console.error(error);
    showQuickReceiptError(error.message || "Could not remember that item name.");
  } finally {
    input.disabled = false;
  }
}

function resetQuickReceiptAnalysis() {
  quickReceiptLineItemsDraft = [];
  const status = document.querySelector("#quickReceiptAnalysisStatus");
  const warningBox = document.querySelector("#quickReceiptAnalysisWarnings");
  if (status) status.hidden = true;
  renderQuickReceiptLineItems([]);
  if (warningBox) {
    warningBox.hidden = true;
    warningBox.innerHTML = "";
  }
}

function setQuickReceiptBusy(busy) {
  const save = document.querySelector("#saveQuickReceiptButton");
  const saveAnyway = document.querySelector("#saveQuickReceiptAnywayButton");

  if (save) {
    save.disabled = busy;
    save.textContent = busy ? "Saving…" : "Save receipt";
  }

  if (saveAnyway) saveAnyway.disabled = busy;
}

async function saveQuickReceipt(event, allowPossibleDuplicate = false) {
  event?.preventDefault?.();

  clearQuickReceiptError();
  if (!allowPossibleDuplicate) hideQuickReceiptDuplicateWarning();

  const file = document.querySelector("#quickReceiptFile")?.files?.[0];
  const vendor = document.querySelector("#quickReceiptVendor")?.value?.trim() || "";
  const total = document.querySelector("#quickReceiptTotal")?.value || "";
  const subtotal = document.querySelector("#quickReceiptSubtotal")?.value || "";
  const tax = document.querySelector("#quickReceiptTax")?.value || "";
  const purchaseDate = document.querySelector("#quickReceiptDate")?.value || "";

  if (!file) {
    showQuickReceiptError("Take or choose a receipt first.");
    return;
  }

  if (!total || Number(total) <= 0) {
    showQuickReceiptError("Enter the receipt total.");
    document.querySelector("#quickReceiptTotal")?.focus();
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("vendor", vendor);
  formData.append("total", total);
  formData.append("subtotal", subtotal);
  formData.append("tax", tax);
  formData.append("purchaseDate", purchaseDate);
  formData.append("allowPossibleDuplicate", String(Boolean(allowPossibleDuplicate)));
  formData.append("lineItems", JSON.stringify(
    quickReceiptLineItemsDraft.map(item => ({
      receiptText: String(item.receiptText || item.description || "").trim(),
      displayName: String(item.displayName || item.receiptText || item.description || "").trim(),
      quantity: item.quantity == null ? null : Number(item.quantity),
      unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
      lineTotal: item.lineTotal == null ? null : Number(item.lineTotal)
    }))
  ));

  setQuickReceiptBusy(true);

  try {
    const response = await fetch("/api/home/purchases/quick-receipt", {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json" }
    });

    if (response.status === 409) {
      const body = await response.json();
      if (body.possibleDuplicate) {
        showQuickReceiptDuplicateWarning(body.duplicates || []);
        return;
      }
      throw new Error(body.message || "Quick Receipt could not be saved.");
    }

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    await loadDashboard();
    closeQuickReceiptDialog();
    showToast("Receipt captured — ready to reconcile.");
  } catch (error) {
    console.error(error);
    showQuickReceiptError(error.message || "Could not save Quick Receipt.");
  } finally {
    setQuickReceiptBusy(false);
  }
}

function showQuickReceiptDuplicateWarning(duplicates) {
  const box = document.querySelector("#quickReceiptDuplicateWarning");
  const list = document.querySelector("#quickReceiptDuplicateList");
  const saveAnyway = document.querySelector("#saveQuickReceiptAnywayButton");
  if (!box || !list || !saveAnyway) return;

  list.className = "quick-receipt-duplicate-list";
  list.innerHTML = duplicates.length
    ? duplicates.map(item => `
        <div class="quick-receipt-duplicate-item">
          <strong>${escapeHtml(item.level || "Possible")} match</strong>
          · ${escapeHtml(item.vendor || "Vendor unknown")}
          · ${item.purchaseDate ? escapeHtml(formatDateOnly(item.purchaseDate)) : "Date unknown"}
          · ${moneyExact.format(Number(item.total) || 0)}
        </div>`).join("")
    : `<div class="quick-receipt-duplicate-item">A similar receipt already exists.</div>`;

  box.hidden = false;
  saveAnyway.hidden = false;
}

function hideQuickReceiptDuplicateWarning() {
  const box = document.querySelector("#quickReceiptDuplicateWarning");
  const list = document.querySelector("#quickReceiptDuplicateList");
  const saveAnyway = document.querySelector("#saveQuickReceiptAnywayButton");

  if (box) box.hidden = true;
  if (list) list.innerHTML = "";
  if (saveAnyway) saveAnyway.hidden = true;
}

function showQuickReceiptError(message) {
  const box = document.querySelector("#quickReceiptError");
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearQuickReceiptError() {
  const box = document.querySelector("#quickReceiptError");
  if (!box) return;
  box.textContent = "";
  box.hidden = true;
}


let allocationDraft = [];
let allocationSequence = 0;


let manualReceiptDraft = [];
let manualReceiptPurchaseId = null;

function ensureManualReceiptDialog() {
  let dialog = document.querySelector("#manualReceiptDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "manualReceiptDialog";
  dialog.className = "modal purchase-modal";

  dialog.innerHTML = `
    <form id="manualReceiptForm" class="modal-card manual-receipt-card" method="dialog">
      <div class="modal-head">
        <div>
          <span class="section-kicker">MANUAL RECEIPT REVIEW</span>
          <h2>Fix unreadable receipt</h2>
        </div>
        <button type="button" class="icon-btn" data-close-manual-receipt aria-label="Close">×</button>
      </div>

      <div class="manual-receipt-body">
        <div id="manualReceiptError" class="form-error" hidden></div>

        <div class="manual-receipt-explainer">
          Use the printed totals on the receipt and correct whatever the receipt reader missed.
          The final math still has to reconcile before Home Excursion will accept it.
        </div>

        <div class="manual-receipt-totals">
          <label class="field">
            <span>Subtotal</span>
            <input id="manualReceiptSubtotal" type="text" inputmode="decimal" placeholder="0.00">
          </label>
          <label class="field">
            <span>Tax / fees</span>
            <input id="manualReceiptTax" type="text" inputmode="decimal" placeholder="0.00">
          </label>
          <label class="field">
            <span>Receipt total</span>
            <input id="manualReceiptTotal" type="text" inputmode="decimal" placeholder="0.00">
          </label>
        </div>

        <div class="manual-receipt-items-heading">
          <div>
            <strong>Receipt items</strong>
            <span>Edit an extracted item or add a missing/unreadable line.</span>
          </div>
          <button id="addManualReceiptItemButton" type="button" class="secondary-btn">+ Add missing item</button>
        </div>

        <div id="manualReceiptItems" class="manual-receipt-items"></div>

        <div class="manual-receipt-math">
          <div><span>Items</span><strong id="manualReceiptItemTotal">$0.00</strong></div>
          <div><span>Subtotal difference</span><strong id="manualReceiptSubtotalDifference">$0.00</strong></div>
          <div><span>Total difference</span><strong id="manualReceiptTotalDifference">$0.00</strong></div>
        </div>

        <label class="field">
          <span>Why are you verifying manually? *</span>
          <textarea id="manualReceiptReason" rows="3" maxlength="500"
                    placeholder="Receipt partially unreadable; printed subtotal, tax and total confirmed from original image."></textarea>
        </label>

        <div class="manual-receipt-note">
          Correct the amounts and assign every item here. After saving, the receipt will be ready for
          <strong>Verify receipt</strong>.
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-btn" data-close-manual-receipt>Cancel</button>
        <button id="saveManualReceiptButton" type="submit" class="primary-btn">Save corrections</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);

  dialog.querySelectorAll("[data-close-manual-receipt]").forEach(button =>
    button.addEventListener("click", () => dialog.close())
  );

  dialog.querySelector("#addManualReceiptItemButton")?.addEventListener("click", () => {
    manualReceiptDraft.push({
      _key: Date.now() + Math.random(),
      sourceLineItemId: null,
      receiptText: "Unreadable / unparsed receipt item",
      displayName: "Unreadable / unparsed receipt item",
      lineTotal: "",
      destination: "unassigned"
    });
    renderManualReceiptItems();
  });

  dialog.querySelector("#manualReceiptItems")?.addEventListener("input", event => {
    const row = event.target.closest("[data-manual-item-key]");
    if (!row) return;
    const item = manualReceiptDraft.find(x => String(x._key) === row.dataset.manualItemKey);
    if (!item) return;

    if (event.target.matches("[data-manual-item-name]")) {
      item.displayName = event.target.value;
      item.receiptText = event.target.value || "Manual receipt item";
    } else if (event.target.matches("[data-manual-item-amount]")) {
      item.lineTotal = event.target.value;
    } else if (event.target.matches("[data-manual-item-destination]")) {
      item.destination = event.target.value || "unassigned";
    }
    updateManualReceiptMath();
  });

  dialog.querySelector("#manualReceiptItems")?.addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-manual-item]");
    if (!remove) return;
    manualReceiptDraft = manualReceiptDraft.filter(
      x => String(x._key) !== remove.dataset.removeManualItem
    );
    renderManualReceiptItems();
  });

  ["#manualReceiptSubtotal", "#manualReceiptTax", "#manualReceiptTotal"].forEach(selector => {
    dialog.querySelector(selector)?.addEventListener("input", updateManualReceiptMath);
    dialog.querySelector(selector)?.addEventListener("blur", event => {
      const value = parseManualMoney(event.target.value);
      event.target.value = value == null ? "" : value.toFixed(2);
      updateManualReceiptMath();
    });
  });

  dialog.querySelector("#manualReceiptForm")?.addEventListener("submit", saveManualReceiptCorrections);
  return dialog;
}

function parseManualMoney(value) {
  const text = String(value ?? "").replace(/[$,\s]/g, "").trim();
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function openManualReceiptDialog() {
  const purchase = currentOpenPurchase();
  if (!purchase?.id) return;

  manualReceiptPurchaseId = purchase.id;
  manualReceiptDraft = (purchase.lineItems || []).map(item => {
    const allocation = allocationDraft.find(
      a => Number(a.purchaseLineItemId) === Number(item.id)
    );

    return {
      _key: item.id || `${Date.now()}-${Math.random()}`,
      sourceLineItemId: item.id || null,
      receiptText: item.receiptText || item.displayName || "Receipt item",
      displayName: item.displayName || item.receiptText || "Receipt item",
      lineTotal: item.lineTotal ?? lineItemAmount(item),
      destination: receiptItemDestinationValue(allocation)
    };
  });

  const dialog = ensureManualReceiptDialog();
  dialog.querySelector("#manualReceiptSubtotal").value =
    purchase.subtotal == null ? "" : Number(purchase.subtotal).toFixed(2);
  dialog.querySelector("#manualReceiptTax").value =
    purchase.tax == null ? "" : Number(purchase.tax).toFixed(2);
  dialog.querySelector("#manualReceiptTotal").value =
    Number(purchase.total || 0).toFixed(2);
  dialog.querySelector("#manualReceiptReason").value = "";

  const error = dialog.querySelector("#manualReceiptError");
  error.hidden = true;
  error.textContent = "";

  renderManualReceiptItems();
  dialog.showModal();
}


function manualReceiptDestinationOptions(selectedValue) {
  const option = (value, label) =>
    `<option value="${escapeAttribute(value)}" ${selectedValue === value ? "selected" : ""}>${escapeHtml(label)}</option>`;

  const projectOptionsHtml = [...(state.data?.projects || [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => option(`project:${p.id}`, p.name))
    .join("");

  const taskOptionsHtml = [...(state.data?.tasks || [])]
    .sort((a, b) => {
      const ap = a.projectName || "";
      const bp = b.projectName || "";
      return ap.localeCompare(bp) || a.title.localeCompare(b.title);
    })
    .map(t => {
      const prefix = t.projectName ? `${t.projectName} · ` : "";
      return option(`task:${t.id}`, `${prefix}${t.title}`);
    })
    .join("");

  return [
    option("unassigned", "Unassigned"),
    option("misc", "Misc Household"),
    option("tools", "Tools"),
    option("excluded", "Personal / Excluded"),
    projectOptionsHtml ? `<optgroup label="Projects">${projectOptionsHtml}</optgroup>` : "",
    taskOptionsHtml ? `<optgroup label="Tasks">${taskOptionsHtml}</optgroup>` : ""
  ].join("");
}

function allocationFromManualDestination(destination, item) {
  const allocation = {
    id: null,
    projectId: null,
    taskId: null,
    purchaseLineItemId: item.id,
    amount: lineItemAmount(item),
    description: item.displayName || item.receiptText || "Receipt item",
    category: null,
    allocationType: "Unassigned",
    isIncludedInHomeSpend: false,
    notes: null
  };

  const value = destination || "unassigned";

  if (value === "misc") {
    allocation.allocationType = "GeneralHome";
    allocation.category = "Misc Household";
    allocation.isIncludedInHomeSpend = true;
  } else if (value === "tools") {
    allocation.allocationType = "GeneralHome";
    allocation.category = "Tools";
    allocation.isIncludedInHomeSpend = true;
  } else if (value === "excluded") {
    allocation.allocationType = "PersonalExcluded";
  } else if (value.startsWith("project:")) {
    allocation.projectId = Number(value.split(":")[1]);
    allocation.allocationType = "Project";
    allocation.isIncludedInHomeSpend = true;
  } else if (value.startsWith("task:")) {
    allocation.taskId = Number(value.split(":")[1]);
    const task = state.data?.tasks?.find(t => Number(t.id) === allocation.taskId);
    allocation.projectId = task?.projectId ?? null;
    allocation.allocationType = "Task";
    allocation.isIncludedInHomeSpend = true;
  }

  return allocation;
}

function renderManualReceiptItems() {
  const container = document.querySelector("#manualReceiptItems");
  if (!container) return;

  if (!manualReceiptDraft.length) {
    container.innerHTML = `<div class="empty">No receipt items yet. Add the missing/unreadable amount.</div>`;
    updateManualReceiptMath();
    return;
  }

  container.innerHTML = manualReceiptDraft.map(item => `
    <div class="manual-receipt-item" data-manual-item-key="${escapeAttribute(String(item._key))}">
      <input data-manual-item-name
             maxlength="300"
             value="${escapeAttribute(item.displayName || item.receiptText || "")}"
             placeholder="Receipt item">
      <input data-manual-item-amount
             type="text"
             inputmode="decimal"
             value="${escapeAttribute(item.lineTotal ?? "")}"
             placeholder="0.00">
      <select data-manual-item-destination>
        ${manualReceiptDestinationOptions(item.destination || "unassigned")}
      </select>
      <button type="button"
              class="icon-btn"
              data-remove-manual-item="${escapeAttribute(String(item._key))}"
              aria-label="Remove item">×</button>
    </div>
  `).join("");

  updateManualReceiptMath();
}

function updateManualReceiptMath() {
  const subtotal = parseManualMoney(document.querySelector("#manualReceiptSubtotal")?.value) ?? 0;
  const tax = parseManualMoney(document.querySelector("#manualReceiptTax")?.value) ?? 0;
  const total = parseManualMoney(document.querySelector("#manualReceiptTotal")?.value) ?? 0;
  const itemTotal = manualReceiptDraft.reduce(
    (sum, item) => sum + (parseManualMoney(item.lineTotal) ?? 0),
    0
  );

  const subtotalDifference = Math.round((subtotal - itemTotal) * 100) / 100;
  const totalDifference = Math.round((total - subtotal - tax) * 100) / 100;

  const set = (selector, value, balanced) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.textContent = moneyExact.format(value);
    el.classList.toggle("balanced", balanced);
    el.classList.toggle("unbalanced", !balanced);
  };

  document.querySelector("#manualReceiptItemTotal").textContent = moneyExact.format(itemTotal);
  set("#manualReceiptSubtotalDifference", subtotalDifference, Math.abs(subtotalDifference) < .005);
  set("#manualReceiptTotalDifference", totalDifference, Math.abs(totalDifference) < .005);
}


function cloneManualAllocation(allocation) {
  return {
    id: null,
    projectId: allocation?.projectId || null,
    taskId: allocation?.taskId || null,
    purchaseLineItemId: null,
    amount: Number(allocation?.amount || 0),
    description: String(allocation?.description || "").trim(),
    category: allocation?.category || null,
    allocationType: allocation?.allocationType || "Unassigned",
    isIncludedInHomeSpend: allocation?.isIncludedInHomeSpend !== false,
    notes: allocation?.notes || null
  };
}

function manualCorrectionAllocationSnapshot(purchase) {
  const byLineItemId = new Map(
    (allocationDraft || [])
      .filter(a => a.purchaseLineItemId)
      .map(a => [Number(a.purchaseLineItemId), cloneManualAllocation(a)])
  );

  const nonLineItem = (allocationDraft || [])
    .filter(a => !a.purchaseLineItemId)
    .filter(a =>
      a.allocationType === "TaxFee" ||
      (a.allocationType !== "Unassigned" &&
       !String(a.description || "").toLowerCase().includes("receipt remainder")))
    .map(a => cloneManualAllocation(a));

  return { byLineItemId, nonLineItem };
}

function remapManualCorrectionAllocations(updatedPurchase, snapshot) {
  const updatedItems = updatedPurchase?.lineItems || [];
  const remapped = [];

  manualReceiptDraft.forEach((draftItem, index) => {
    const updatedItem = updatedItems[index];
    if (!updatedItem) return;

    const prior = draftItem.sourceLineItemId
      ? snapshot.byLineItemId.get(Number(draftItem.sourceLineItemId))
      : null;

    if ((draftItem.destination || "unassigned") !== "unassigned") {
      remapped.push(allocationFromManualDestination(draftItem.destination, updatedItem));
    } else if (prior && prior.allocationType !== "Unassigned") {
      remapped.push({
        ...prior,
        purchaseLineItemId: updatedItem.id,
        amount: lineItemAmount(updatedItem),
        description: updatedItem.displayName || updatedItem.receiptText || prior.description || "Receipt item"
      });
    } else {
      remapped.push(allocationFromManualDestination("unassigned", updatedItem));
    }
  });

  const tax = Number(updatedPurchase?.tax || 0);
  const oldTax = snapshot.nonLineItem.find(a => a.allocationType === "TaxFee");

  if (tax > 0) {
    remapped.push({
      ...(oldTax || {
        id: null,
        projectId: null,
        taskId: null,
        category: "Tax / Fees",
        allocationType: "TaxFee",
        isIncludedInHomeSpend: true,
        notes: null
      }),
      purchaseLineItemId: null,
      amount: tax,
      description: "Tax / fees",
      category: "Tax / Fees",
      allocationType: "TaxFee",
      isIncludedInHomeSpend: true
    });
  }

  snapshot.nonLineItem
    .filter(a => a.allocationType !== "TaxFee")
    .forEach(a => remapped.push(a));

  return remapped;
}

async function saveManualReceiptCorrections(event) {
  event.preventDefault();

  const dialog = ensureManualReceiptDialog();
  const error = dialog.querySelector("#manualReceiptError");
  const button = dialog.querySelector("#saveManualReceiptButton");

  const subtotal = parseManualMoney(dialog.querySelector("#manualReceiptSubtotal").value);
  const tax = parseManualMoney(dialog.querySelector("#manualReceiptTax").value);
  const total = parseManualMoney(dialog.querySelector("#manualReceiptTotal").value);
  const reason = dialog.querySelector("#manualReceiptReason").value.trim();

  const lineItems = manualReceiptDraft.map(item => ({
    receiptText: String(item.receiptText || item.displayName || "Manual receipt item").trim(),
    displayName: String(item.displayName || item.receiptText || "Manual receipt item").trim(),
    quantity: null,
    unitPrice: null,
    lineTotal: parseManualMoney(item.lineTotal)
  }));

  const itemTotal = lineItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);

  if (subtotal == null || tax == null || total == null) {
    error.textContent = "Enter subtotal, tax / fees and receipt total.";
    error.hidden = false;
    return;
  }

  if (!reason) {
    error.textContent = "Enter a short reason for manual verification.";
    error.hidden = false;
    return;
  }

  if (lineItems.some(item => !item.displayName || item.lineTotal == null || item.lineTotal < 0)) {
    error.textContent = "Every receipt item needs a description and valid amount.";
    error.hidden = false;
    return;
  }

  if (manualReceiptDraft.some(item => !item.destination || item.destination === "unassigned")) {
    error.textContent = "Assign every receipt item before saving manual verification.";
    error.hidden = false;
    return;
  }

  if (Math.abs(itemTotal - subtotal) >= .005) {
    error.textContent =
      `Receipt items must add to the subtotal. Difference: ${moneyExact.format(subtotal - itemTotal)}.`;
    error.hidden = false;
    return;
  }

  if (Math.abs((subtotal + tax) - total) >= .005) {
    error.textContent =
      `Subtotal + tax must equal the receipt total. Difference: ${moneyExact.format(total - subtotal - tax)}.`;
    error.hidden = false;
    return;
  }

  error.hidden = true;
  button.disabled = true;
  button.textContent = "Saving…";

  try {
    const current = currentOpenPurchase();
    const allocationSnapshot = manualCorrectionAllocationSnapshot(current);

    const lineItemResponse = await fetch(`/api/home/purchases/${manualReceiptPurchaseId}/line-items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        subtotal,
        tax,
        total,
        lineItems
      })
    });

    if (!lineItemResponse.ok)
      throw new Error(await readError(lineItemResponse));

    // The line-item endpoint rebuilds receipt items, so reload once to get the new IDs
    // before restoring assignments to the corrected rows.
    await loadPurchases();
    const correctedPurchase = state.purchases.find(
      p => Number(p.id) === Number(manualReceiptPurchaseId)
    );

    if (!correctedPurchase)
      throw new Error("Corrected purchase could not be reloaded.");

    const correctedAllocations =
      remapManualCorrectionAllocations(correctedPurchase, allocationSnapshot);

    const existingNotes = String(current?.notes || "").trim();
    const marker = `Manual receipt verification: ${reason}`;
    const notes = existingNotes
      ? (existingNotes.includes(marker) ? existingNotes : `${existingNotes}\n${marker}`)
      : marker;

    const noteResponse = await fetch(`/api/home/purchases/${manualReceiptPurchaseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        propertyId: state.data.property.id,
        vendorId: null,
        vendor: document.querySelector("#purchaseVendor")?.value.trim() || null,
        purchaseDate: document.querySelector("#purchaseDate")?.value || null,
        subtotal,
        tax,
        total,
        notes,
        allowPossibleDuplicate: true,
        allocations: correctedAllocations
      })
    });

    if (!noteResponse.ok)
      throw new Error(await readError(noteResponse));

    dialog.close();
    await loadPurchases();

    const updated = state.purchases.find(p => Number(p.id) === Number(manualReceiptPurchaseId));
    if (updated) openPurchaseDialog(updated);

    showToast("Manual receipt corrections saved. Existing assignments were preserved.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save manual receipt corrections.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Save corrections";
  }
}

function openPurchaseDialog(purchase = null, defaults = {}) {
  const isEdit = Boolean(purchase);
  document.querySelector("#purchaseDialogTitle").textContent = isEdit ? "Reconcile purchase" : "Add purchase";
  document.querySelector("#purchaseId").value = purchase?.id ?? "";
  document.querySelector("#purchaseDate").value = purchase?.purchaseDate ?? new Date().toISOString().slice(0, 10);
  document.querySelector("#purchaseTotal").value = formatMoneyInput(purchase?.total);
  document.querySelector("#purchaseSubtotal").value = formatMoneyInput(purchase?.subtotal);
  document.querySelector("#purchaseTax").value = formatMoneyInput(purchase?.tax);
  document.querySelector("#purchaseVendor").value = purchase?.vendorName || purchase?.vendor || "";
  document.querySelector("#purchaseNotes").value = purchase?.notes ?? "";
  document.querySelector("#purchaseStatusBadge").textContent = purchase?.status || "New";
  document.querySelector("#deletePurchaseButton").hidden = !isEdit;
  document.querySelector("#verifyPurchaseButton").hidden = !isEdit || purchase?.status === "Verified";

  let manualButton = document.querySelector("#manualVerifyPurchaseButton");
  if (!manualButton) {
    manualButton = document.createElement("button");
    manualButton.id = "manualVerifyPurchaseButton";
    manualButton.type = "button";
    manualButton.className = "secondary-btn";
    manualButton.textContent = "Verify manually";
    manualButton.addEventListener("click", openManualReceiptDialog);

    const verifyButton = document.querySelector("#verifyPurchaseButton");
    verifyButton?.parentElement?.insertBefore(manualButton, verifyButton);
  }
  manualButton.hidden = !isEdit || purchase?.status === "Verified" || !(purchase?.attachments || []).length;

  document.querySelector("#purchaseReceiptFiles").value = "";
  document.querySelector("#purchaseReceiptSelection").textContent = "";
  hideDuplicateWarning();
  clearPurchaseError();

  allocationDraft = (purchase?.allocations || []).map(a => ({ ...a, _key: ++allocationSequence }));

  if (purchase?.lineItems?.length) {
    allocationDraft = buildReceiptItemAllocations(purchase, allocationDraft);
  }

  if (!allocationDraft.length) {
    allocationDraft.push(newAllocation(defaults));
  }

  renderPurchaseLineItems(purchase);
  renderAllocationRows();
  renderPurchaseReceipts(purchase?.attachments || []);
  updateOtherAllocationVisibility();
  updateReconciliation();
  document.querySelector("#purchaseDialog").showModal();
}

function newAllocation(defaults = {}) {
  const taskId = defaults.taskId ?? null;
  const projectId = defaults.projectId ?? null;
  return {
    _key: ++allocationSequence,
    id: null,
    projectId,
    taskId,
    purchaseLineItemId: defaults.purchaseLineItemId ?? null,
    amount: "",
    description: taskId ? (state.data?.tasks?.find(t => t.id === taskId)?.title || "") : "",
    category: "",
    allocationType: taskId ? "Task" : (projectId ? "Project" : "Unassigned"),
    isIncludedInHomeSpend: Boolean(taskId || projectId),
    notes: ""
  };
}

function addAllocationRow(defaults = {}) {
  const purchase = currentOpenPurchase();
  if (purchase?.lineItems?.length) {
    showToast("Receipt items are already handling the allocation.");
    return;
  }

  allocationDraft.push(newAllocation(defaults));
  renderAllocationRows();
  updateOtherAllocationVisibility();
  updateReconciliation();
}

function renderAllocationRows() {
  const container = document.querySelector("#purchaseAllocations");
  const rows = allocationDraft.filter(a => !a.purchaseLineItemId);

  if (!rows.length) {
    container.innerHTML = "";
    updateOtherAllocationVisibility();
    return;
  }

  container.innerHTML = rows.map((a, index) => {
    const typeOptions = [
      ["Task","Task"],
      ["Project","Project"],
      ["GeneralHome","General Home"],
      ["Maintenance","Maintenance"],
      ["TaxFee","Tax / Fees"],
      ["PersonalExcluded","Personal / Excluded"],
      ["Unassigned","Unassigned"]
    ].map(([value,label]) =>
      `<option value="${value}" ${a.allocationType === value ? "selected" : ""}>${label}</option>`
    ).join("");

    return `<div class="allocation-row" data-allocation-key="${a._key}">
      <div class="allocation-row-top">
        <strong>Other allocation ${index + 1}</strong>
        <button type="button" class="icon-btn allocation-remove" data-remove-allocation="${a._key}" aria-label="Remove allocation">×</button>
      </div>
      <div class="allocation-grid">
        <label class="field"><span>Type</span><select data-allocation-field="allocationType">${typeOptions}</select></label>
        <label class="field"><span>Amount</span><input data-allocation-field="amount" type="number" min="0" step="0.01" value="${escapeAttribute(a.amount ?? "")}" placeholder="0.00"></label>
        <label class="field field-wide"><span>Description</span><input data-allocation-field="description" maxlength="300" value="${escapeAttribute(a.description || "")}" placeholder="What was this money for?"></label>
        <label class="field"><span>Project</span><select data-allocation-field="projectId">${projectOptions(a.projectId)}</select></label>
        <label class="field"><span>Task</span><select data-allocation-field="taskId">${taskOptions(a.taskId, a.projectId)}</select></label>
        <label class="field field-wide"><span>Category</span><input data-allocation-field="category" maxlength="60" value="${escapeAttribute(a.category || "")}" placeholder="Materials, Tools, Paint…"></label>
      </div>
    </div>`;
  }).join("");
}

function shouldSeedReceiptItemAllocations(purchase, allocations) {
  if (!purchase?.lineItems?.length) return false;
  if (!allocations.length) return true;

  return allocations.length === 1 &&
    allocations[0].allocationType === "Unassigned" &&
    !allocations[0].purchaseLineItemId &&
    String(allocations[0].description || "").toLowerCase().includes("quick receipt");
}

function lineItemAmount(item) {
  const quantity = item.quantity == null ? null : Number(item.quantity);
  const unitPrice = item.unitPrice == null ? null : Number(item.unitPrice);
  const lineTotal = item.lineTotal == null ? null : Number(item.lineTotal);

  if (quantity != null && unitPrice != null) {
    return Math.round(quantity * unitPrice * 100) / 100;
  }

  return lineTotal ?? 0;
}

function buildReceiptItemAllocations(purchase, existingAllocations = []) {
  const existingByLineItem = new Map(
    existingAllocations
      .filter(a => a.purchaseLineItemId)
      .map(a => [Number(a.purchaseLineItemId), a])
  );

  const allocations = (purchase.lineItems || []).map(item => {
    const existing = existingByLineItem.get(Number(item.id));

    if (existing) {
      return {
        ...existing,
        _key: ++allocationSequence,
        purchaseLineItemId: item.id,
        amount: lineItemAmount(item),
        description: item.displayName || item.receiptText || existing.description || "Receipt item"
      };
    }

    return {
      _key: ++allocationSequence,
      id: null,
      projectId: null,
      taskId: null,
      purchaseLineItemId: item.id,
      amount: lineItemAmount(item),
      description: item.displayName || item.receiptText || "Receipt item",
      category: "",
      allocationType: "Unassigned",
      isIncludedInHomeSpend: false,
      notes: ""
    };
  });

  const itemTotal = allocations.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const tax = Number(purchase.tax || 0);

  if (tax > 0) {
    allocations.push({
      _key: ++allocationSequence,
      id: null,
      projectId: null,
      taskId: null,
      purchaseLineItemId: null,
      amount: tax,
      description: "Tax / fees",
      category: "Tax / Fees",
      allocationType: "TaxFee",
      isIncludedInHomeSpend: true,
      notes: ""
    });
  }

  const currentTotal = itemTotal + tax;
  const remainder = Math.round((Number(purchase.total || 0) - currentTotal) * 100) / 100;

  if (Math.abs(remainder) >= .005) {
    allocations.push({
      _key: ++allocationSequence,
      id: null,
      projectId: null,
      taskId: null,
      purchaseLineItemId: null,
      amount: remainder,
      description: "Receipt remainder — unassigned",
      category: "",
      allocationType: "Unassigned",
      isIncludedInHomeSpend: false,
      notes: ""
    });
  }

  return allocations;
}

function renderPurchaseLineItems(purchase) {
  const section = document.querySelector("#purchaseLineItemSection");
  const empty = document.querySelector("#purchaseLineItemEmpty");
  const container = document.querySelector("#purchaseLineItems");
  const readButton = document.querySelector("#readPurchaseLineItemsButton");
  const emptyReadButton = document.querySelector("#readPurchaseLineItemsEmptyButton");

  if (!section || !empty || !container) return;

  const items = purchase?.lineItems || [];
  const hasReceipt = (purchase?.attachments || []).length > 0;

  if (!items.length) {
    section.hidden = true;
    empty.hidden = !purchase?.id || !hasReceipt;
    if (emptyReadButton) emptyReadButton.disabled = false;
    return;
  }

  empty.hidden = true;
  section.hidden = false;
  if (readButton) {
    const itemTotal = items.reduce((sum, item) => sum + lineItemAmount(item), 0);
    const knownTax = purchase?.tax == null ? null : Number(purchase.tax);
    const expected = itemTotal + (knownTax ?? 0);
    const needsReceiptRefresh =
      purchase?.subtotal == null ||
      purchase?.tax == null ||
      Math.abs(Number(purchase?.total || 0) - expected) >= .005;

    readButton.hidden = !hasReceipt || !needsReceiptRefresh;
    readButton.textContent = "Fix totals from receipt";
  }

  container.innerHTML = items.map(item => {
    const allocation = allocationDraft.find(
      a => Number(a.purchaseLineItemId) === Number(item.id)
    );

    const amount = allocation ? Number(allocation.amount || 0) : lineItemAmount(item);
    const details = [
      item.quantity != null ? `Qty ${item.quantity}` : null,
      item.unitPrice != null ? `${moneyExact.format(Number(item.unitPrice))} each` : null
    ].filter(Boolean).join(" · ");

    return `<div class="purchase-line-item-row" data-purchase-line-item="${item.id}">
      <div class="purchase-line-item-copy">
        <strong>${escapeHtml(item.displayName || item.receiptText || "Receipt item")}</strong>
        ${item.displayName && item.receiptText && normalizeReceiptItemText(item.displayName) !== normalizeReceiptItemText(item.receiptText)
          ? `<small>Receipt: ${escapeHtml(item.receiptText)}</small>`
          : ""}
        ${details ? `<small>${escapeHtml(details)}</small>` : ""}
      </div>
      <strong class="purchase-line-item-amount">${moneyExact.format(amount)}</strong>
      <label class="purchase-line-item-destination">
        <span>Assign to</span>
        <select data-line-item-destination="${item.id}">
          ${receiptItemDestinationOptions(allocation)}
        </select>
      </label>
    </div>`;
  }).join("");
}

function receiptItemDestinationOptions(allocation) {
  const selected = receiptItemDestinationValue(allocation);

  const option = (value, label) =>
    `<option value="${escapeAttribute(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`;

  const projectOptionsHtml = [...(state.data?.projects || [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => option(`project:${p.id}`, p.name))
    .join("");

  const taskOptionsHtml = [...(state.data?.tasks || [])]
    .sort((a, b) => {
      const ap = a.projectName || "";
      const bp = b.projectName || "";
      return ap.localeCompare(bp) || a.title.localeCompare(b.title);
    })
    .map(t => {
      const prefix = t.projectName ? `${t.projectName} · ` : "";
      return option(`task:${t.id}`, `${prefix}${t.title}`);
    })
    .join("");

  return [
    option("unassigned", "Unassigned"),
    option("misc", "Misc Household"),
    option("tools", "Tools"),
    option("excluded", "Personal / Excluded"),
    projectOptionsHtml ? `<optgroup label="Projects">${projectOptionsHtml}</optgroup>` : "",
    taskOptionsHtml ? `<optgroup label="Tasks">${taskOptionsHtml}</optgroup>` : ""
  ].join("");
}

function receiptItemDestinationValue(allocation) {
  if (!allocation || allocation.allocationType === "Unassigned") return "unassigned";
  if (allocation.allocationType === "PersonalExcluded") return "excluded";
  if (allocation.allocationType === "Task" && allocation.taskId) return `task:${allocation.taskId}`;
  if (allocation.allocationType === "Project" && allocation.projectId) return `project:${allocation.projectId}`;
  if (allocation.allocationType === "GeneralHome" && allocation.category === "Tools") return "tools";
  if (allocation.allocationType === "GeneralHome") return "misc";
  return "unassigned";
}

function handlePurchaseLineItemAssignmentChange(event) {
  const select = event.target.closest("[data-line-item-destination]");
  if (!select) return;

  const lineItemId = Number(select.dataset.lineItemDestination);
  const item = currentPurchaseLineItem(lineItemId);
  if (!item) return;

  let allocation = allocationDraft.find(
    a => Number(a.purchaseLineItemId) === lineItemId
  );

  if (!allocation) {
    allocation = {
      _key: ++allocationSequence,
      id: null,
      projectId: null,
      taskId: null,
      purchaseLineItemId: lineItemId,
      amount: lineItemAmount(item),
      description: item.displayName || item.receiptText || "Receipt item",
      category: "",
      allocationType: "Unassigned",
      isIncludedInHomeSpend: false,
      notes: ""
    };
    allocationDraft.push(allocation);
  }

  const value = select.value;
  allocation.projectId = null;
  allocation.taskId = null;
  allocation.category = "";
  allocation.isIncludedInHomeSpend = false;

  if (value === "misc") {
    allocation.allocationType = "GeneralHome";
    allocation.category = "Misc Household";
    allocation.isIncludedInHomeSpend = true;
  } else if (value === "tools") {
    allocation.allocationType = "GeneralHome";
    allocation.category = "Tools";
    allocation.isIncludedInHomeSpend = true;
  } else if (value === "excluded") {
    allocation.allocationType = "PersonalExcluded";
  } else if (value.startsWith("project:")) {
    allocation.projectId = Number(value.split(":")[1]);
    allocation.allocationType = "Project";
    allocation.isIncludedInHomeSpend = true;
  } else if (value.startsWith("task:")) {
    allocation.taskId = Number(value.split(":")[1]);
    const task = state.data?.tasks?.find(t => Number(t.id) === allocation.taskId);
    allocation.projectId = task?.projectId ?? null;
    allocation.allocationType = "Task";
    allocation.isIncludedInHomeSpend = true;
  } else {
    allocation.allocationType = "Unassigned";
  }

  renderPurchaseLineItems(currentOpenPurchase());
  updateOtherAllocationVisibility();
  updateReconciliation();
}

function currentOpenPurchase() {
  const id = Number(document.querySelector("#purchaseId")?.value || 0);
  return state.purchases?.find(p => Number(p.id) === id) || null;
}

function currentPurchaseLineItem(id) {
  return currentOpenPurchase()?.lineItems?.find(item => Number(item.id) === Number(id)) || null;
}

async function readExistingPurchaseLineItems() {
  const purchase = currentOpenPurchase();
  const attachment = purchase?.attachments?.[0];

  clearPurchaseError();
  if (!purchase || !attachment) {
    showPurchaseError("Attach a receipt before reading line items.");
    return;
  }

  const buttons = [
    document.querySelector("#readPurchaseLineItemsButton"),
    document.querySelector("#readPurchaseLineItemsEmptyButton")
  ].filter(Boolean);

  buttons.forEach(button => {
    button.disabled = true;
    button.textContent = "Reading…";
  });

  try {
    const fileResponse = await fetch(`/api/attachments/${attachment.id}`);
    if (!fileResponse.ok) throw new Error(await readError(fileResponse));

    const blob = await fileResponse.blob();
    const formData = new FormData();
    formData.append("file", new File(
      [blob],
      attachment.fileName || "receipt",
      { type: attachment.contentType || blob.type || "application/octet-stream" }
    ));

    const analysisResponse = await fetch("/api/home/receipt-analysis/analyze", {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json" }
    });

    if (!analysisResponse.ok)
      throw new Error(await readError(analysisResponse));

    const analysis = await analysisResponse.json();
    const resolved = await resolveQuickReceiptAliases(analysis.lineItems || []);

    if (!resolved.length)
      throw new Error("I couldn't find any receipt line items.");

    const saveResponse = await fetch(`/api/home/purchases/${purchase.id}/line-items`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        subtotal: analysis.subtotal == null ? null : Number(analysis.subtotal),
        tax: analysis.tax == null ? null : Number(analysis.tax),
        total: analysis.total == null ? null : Number(analysis.total),
        lineItems: resolved.map(item => ({
          receiptText: String(item.receiptText || item.description || "").trim(),
          displayName: String(item.displayName || item.receiptText || item.description || "").trim(),
          quantity: item.quantity == null ? null : Number(item.quantity),
          unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
          lineTotal: item.lineTotal == null ? null : Number(item.lineTotal)
        }))
      })
    });

    if (!saveResponse.ok)
      throw new Error(await readError(saveResponse));

    await loadDashboard();
    const refreshed = state.purchases.find(p => Number(p.id) === Number(purchase.id));
    if (refreshed) openPurchaseDialog(refreshed);

    showToast("Receipt items loaded.");
  } catch (error) {
    console.error(error);
    showPurchaseError(error.message || "Could not read receipt items.");
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
      button.textContent = button.id === "readPurchaseLineItemsButton"
        ? "Fix totals from receipt"
        : "Read receipt items";
    });
  }
}


function updateOtherAllocationVisibility() {
  const container = document.querySelector("#purchaseAllocations");
  const heading = container?.previousElementSibling;
  const addButton = document.querySelector("#addAllocationButton");
  const purchase = currentOpenPurchase();
  const hasReceiptItems = Boolean(purchase?.lineItems?.length);
  const hasOtherAllocations = allocationDraft.some(a => !a.purchaseLineItemId);

  // Once a receipt has item-level detail, tax/remainder allocations are
  // bookkeeping details handled automatically. Do not make the user manage
  // a second allocation system underneath the receipt items.
  const showOtherAllocations = !hasReceiptItems && hasOtherAllocations;

  if (heading?.classList.contains("allocation-heading")) {
    heading.hidden = !showOtherAllocations;
  }

  if (container) container.hidden = !showOtherAllocations;
  if (addButton) addButton.hidden = hasReceiptItems;
}

function projectOptions(selected) {
  return [`<option value="">No project</option>`, ...[...(state.data?.projects || [])]
    .sort((a,b) => a.name.localeCompare(b.name))
    .map(p => `<option value="${p.id}" ${Number(selected) === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)].join("");
}

function taskOptions(selected, projectId) {
  let tasks = [...(state.data?.tasks || [])];
  if (projectId) tasks = tasks.filter(t => Number(t.projectId) === Number(projectId));
  return [`<option value="">No task</option>`, ...tasks.sort((a,b) => a.title.localeCompare(b.title)).map(t => {
    const areas = taskAreaValues(t).join(", ");
    const label = areas ? `${areas} · ${t.title}` : t.title;
    return `<option value="${t.id}" ${Number(selected) === t.id ? "selected" : ""}>${escapeHtml(label)}</option>`;
  })].join("");
}

function handleAllocationClick(event) {
  const remove = event.target.closest("[data-remove-allocation]");
  if (!remove) return;
  allocationDraft = allocationDraft.filter(a => a._key !== Number(remove.dataset.removeAllocation));
  if (!allocationDraft.length) allocationDraft.push(newAllocation());
  renderAllocationRows();
  updateOtherAllocationVisibility();
  updateReconciliation();
}

function handleAllocationChange(event) {
  const field = event.target.dataset.allocationField;
  if (!field) return;
  const row = event.target.closest("[data-allocation-key]");
  const allocation = allocationDraft.find(a => a._key === Number(row.dataset.allocationKey));
  if (!allocation) return;

  let value = event.target.value;
  if (["projectId","taskId"].includes(field)) value = value ? Number(value) : null;
  allocation[field] = value;

  if (field === "allocationType") {
    allocation.isIncludedInHomeSpend = !["PersonalExcluded", "Unassigned"].includes(value);
    if (value !== "Task") allocation.taskId = null;
    if (!["Task","Project"].includes(value)) allocation.projectId = null;
    renderAllocationRows();
  } else if (field === "projectId") {
    allocation.taskId = null;
    renderAllocationRows();
  } else if (field === "taskId" && value) {
    const task = state.data.tasks.find(t => t.id === value);
    if (task?.projectId) allocation.projectId = task.projectId;
    allocation.allocationType = "Task";
    if (!allocation.description) allocation.description = task?.title || "";
    renderAllocationRows();
  }
  updateReconciliation();
}

function updateReconciliation() {
  const total = Number(document.querySelector("#purchaseTotal")?.value || 0);
  const allocated = allocationDraft.reduce((sum,a) => sum + Number(a.amount || 0), 0);
  const home = allocationDraft.filter(a => a.allocationType !== "PersonalExcluded" && a.isIncludedInHomeSpend !== false)
    .reduce((sum,a) => sum + Number(a.amount || 0), 0);
  const excluded = allocated - home;
  const difference = total - allocated;
  document.querySelector("#reconcileReceiptTotal").textContent = moneyExact.format(total);
  document.querySelector("#reconcileAllocated").textContent = moneyExact.format(allocated);
  document.querySelector("#reconcileHomeSpend").textContent = moneyExact.format(home);
  document.querySelector("#reconcileExcluded").textContent = moneyExact.format(excluded);
  const differenceElement = document.querySelector("#reconcileDifference");
  differenceElement.textContent = moneyExact.format(difference);
  const balanced = Math.abs(difference) < .005;
  differenceElement.classList.toggle("balanced", balanced);
  differenceElement.classList.toggle("unbalanced", !balanced);

  const hasUnassigned = allocationDraft.some(a => a.allocationType === "Unassigned");
  const verifyButton = document.querySelector("#verifyPurchaseButton");
  if (verifyButton && !verifyButton.hidden) {
    verifyButton.disabled = !balanced || hasUnassigned;
    verifyButton.title = !balanced
      ? "Receipt must balance before verification."
      : (hasUnassigned ? "Assign every receipt item before verification." : "");
  }
}

function collectPurchasePayload(allowPossibleDuplicate = false) {
  return {
    propertyId: state.data.property.id,
    vendorId: null,
    vendor: document.querySelector("#purchaseVendor").value.trim() || null,
    purchaseDate: document.querySelector("#purchaseDate").value || null,
    subtotal: nullableNumber(document.querySelector("#purchaseSubtotal").value),
    tax: nullableNumber(document.querySelector("#purchaseTax").value),
    total: Number(document.querySelector("#purchaseTotal").value || 0),
    notes: document.querySelector("#purchaseNotes").value.trim() || null,
    allowPossibleDuplicate,
    allocations: allocationDraft.map(a => ({
      id: a.id || null,
      projectId: a.projectId || null,
      taskId: a.taskId || null,
      purchaseLineItemId: a.purchaseLineItemId || null,
      amount: Number(a.amount || 0),
      description: String(a.description || "").trim(),
      category: String(a.category || "").trim() || null,
      allocationType: a.allocationType || "Unassigned",
      isIncludedInHomeSpend: ["PersonalExcluded", "Unassigned"].includes(a.allocationType)
        ? false
        : a.isIncludedInHomeSpend !== false,
      notes: a.notes || null
    }))
  };
}

async function savePurchase(event, allowPossibleDuplicate = false) {
  event?.preventDefault?.();
  clearPurchaseError();
  hideDuplicateWarning();
  const id = Number(document.querySelector("#purchaseId").value || 0);
  const payload = collectPurchasePayload(allowPossibleDuplicate);

  try {
    const response = await fetch(id ? `/api/home/purchases/${id}` : "/api/home/purchases", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });

    if (response.status === 409) {
      const body = await response.json();
      if (body.possibleDuplicate) { showDuplicateWarning(body.duplicates || []); return; }
      throw new Error(body.message || "Purchase could not be saved.");
    }
    if (!response.ok) throw new Error(await readError(response));

    const saved = await response.json();
    const purchaseId = id || Number(saved.id);
    await uploadStagedPurchaseReceipts(purchaseId);
    await loadDashboard();
    closePurchaseDialog();
    showToast("Purchase saved.");
  } catch (error) {
    console.error(error);
    showPurchaseError(error.message || "Could not save purchase.");
  }
}

async function verifyPurchase() {
  const id = Number(document.querySelector("#purchaseId").value || 0);
  if (!id) return;

  clearPurchaseError();
  hideDuplicateWarning();

  const payload = collectPurchasePayload(false);
  const allocated = allocationDraft.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const difference = Number(payload.total || 0) - allocated;

  if (Math.abs(difference) >= .005) {
    showPurchaseError(`Receipt must balance before verification. Difference: ${moneyExact.format(difference)}.`);
    return;
  }

  if (allocationDraft.some(a => a.allocationType === "Unassigned")) {
    showPurchaseError("Assign every receipt item before verifying this receipt.");
    return;
  }

  const button = document.querySelector("#verifyPurchaseButton");
  if (button) {
    button.disabled = true;
    button.textContent = "Verifying…";
  }

  try {
    const response = await fetch(`/api/home/purchases/${id}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (response.status === 409) {
      const body = await response.json();

      if (body.possibleDuplicate) {
        showDuplicateWarning(body.duplicates || []);
        return;
      }

      throw new Error(body.message || "Receipt could not be verified.");
    }

    if (!response.ok)
      throw new Error(await readError(response));

    await uploadStagedPurchaseReceipts(id);
    await loadDashboard();
    closePurchaseDialog();
    showToast("Purchase saved and receipt verified.");
  } catch (error) {
    console.error(error);
    showPurchaseError(error.message || "Could not verify receipt.");
  } finally {
    if (button) {
      button.textContent = "Verify receipt";
      updateReconciliation();
    }
  }
}

async function deletePurchase() {
  const id = Number(document.querySelector("#purchaseId").value || 0);
  if (!id || !confirm("Delete this purchase and its receipt attachments?")) return;
  try {
    const response = await fetch(`/api/home/purchases/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response));
    await loadDashboard(); closePurchaseDialog(); showToast("Purchase deleted.");
  } catch (error) { showPurchaseError(error.message); }
}

function showDuplicateWarning(duplicates) {
  const box = document.querySelector("#purchaseDuplicateWarning");
  const list = document.querySelector("#purchaseDuplicateList");
  list.innerHTML = duplicates.map(d => `<button type="button" class="duplicate-purchase" data-existing-purchase="${d.id}">
    <strong>${escapeHtml(d.level)} match</strong> · ${escapeHtml(d.vendor || "Vendor unknown")} · ${d.purchaseDate ? formatDateOnly(d.purchaseDate) : "Date unknown"} · ${moneyExact.format(Number(d.total) || 0)}
  </button>`).join("");
  list.querySelectorAll("[data-existing-purchase]").forEach(button => button.addEventListener("click", () => {
    const existing = state.purchases.find(p => p.id === Number(button.dataset.existingPurchase));
    if (existing) openPurchaseDialog(existing);
  }));
  box.hidden = false;
}
function hideDuplicateWarning() { const box=document.querySelector("#purchaseDuplicateWarning"); if(box) box.hidden=true; }

async function handlePurchaseReceiptSelection() {
  const input = document.querySelector("#purchaseReceiptFiles");
  const message = document.querySelector("#purchaseReceiptSelection");
  const files = [...(input.files || [])];
  if (!files.length) { message.textContent=""; return; }
  const id = Number(document.querySelector("#purchaseId").value || 0);
  if (!id) { message.textContent = `${files.length} file${files.length===1?"":"s"} selected — attaches when purchase is saved.`; return; }
  try {
    message.textContent = "Uploading…";
    await uploadPurchaseReceipts(id, files);
    input.value="";
    await loadPurchases();
    const purchase=state.purchases.find(p=>p.id===id);
    renderPurchaseReceipts(purchase?.attachments || []);
    message.textContent = "Receipt uploaded.";
  } catch(error) { showPurchaseError(error.message); }
}

async function uploadStagedPurchaseReceipts(id) {
  const input=document.querySelector("#purchaseReceiptFiles");
  const files=[...(input?.files || [])];
  if(files.length) await uploadPurchaseReceipts(id, files);
}
async function uploadPurchaseReceipts(id, files) {
  for (const file of files) {
    const formData=new FormData(); formData.append("file",file);
    const response=await fetch(`/api/home/purchases/${id}/attachments`,{method:"POST",body:formData});
    if(!response.ok) throw new Error(await readError(response));
  }
}

function renderPurchaseReceipts(attachments) {
  const container=document.querySelector("#purchaseExistingReceipts");
  if(!attachments.length){container.innerHTML=`<div class="empty compact">No receipt attached yet.</div>`;return;}
  container.innerHTML=attachments.map(a=>{
    const image=(a.contentType||"").startsWith("image/");
    const pdf=(a.contentType||"").toLowerCase()==="application/pdf";
    const preview = image
      ? `<button type="button" class="expense-receipt-preview" data-view-purchase-receipt="${a.id}"><img src="/api/attachments/${a.id}/thumbnail" alt=""></button>`
      : pdf
        ? `<a class="expense-receipt-preview expense-receipt-pdf-preview" href="/api/attachments/${a.id}" target="_blank" rel="noopener" aria-label="Open ${escapeAttribute(a.fileName)}">
             <iframe src="/api/attachments/${a.id}#page=1&toolbar=0&navpanes=0&scrollbar=0" title="PDF preview" tabindex="-1"></iframe>
             <span>PDF</span>
           </a>`
        : `<a class="expense-receipt-document" href="/api/attachments/${a.id}" target="_blank" rel="noopener">FILE</a>`;
    return `<div class="expense-receipt-card" data-attachment-id="${a.id}">
      ${preview}
      <div class="expense-receipt-info"><strong>${escapeHtml(a.fileName)}</strong><small>${formatFileSize(a.fileSizeBytes)}</small></div>
      <button type="button" class="attachment-delete" data-delete-purchase-receipt="${a.id}">×</button>
    </div>`;
  }).join("");
}

async function handlePurchaseReceiptClick(event) {
  const view=event.target.closest("[data-view-purchase-receipt]");
  if(view){ const attachmentId=Number(view.dataset.viewPurchaseReceipt); const p=state.purchases.find(x=>(x.attachments||[]).some(a=>a.id===attachmentId)); const a=p?.attachments.find(a=>a.id===attachmentId); if(a) openImageViewer(a.id, a.fileName, a.contentType); return; }
  const del=event.target.closest("[data-delete-purchase-receipt]");
  if(!del) return;
  const id=Number(del.dataset.deletePurchaseReceipt);
  if(!confirm("Delete this receipt attachment?")) return;
  const response=await fetch(`/api/attachments/${id}`,{method:"DELETE"});
  if(!response.ok){showPurchaseError(await readError(response));return;}
  const purchaseId=Number(document.querySelector("#purchaseId").value||0);
  await loadPurchases();
  renderPurchaseReceipts(state.purchases.find(p=>p.id===purchaseId)?.attachments||[]);
}

function closePurchaseDialog(){document.querySelector("#purchaseDialog")?.close();clearPurchaseError();hideDuplicateWarning();}
function showPurchaseError(message){const e=document.querySelector("#purchaseFormError");e.textContent=message;e.hidden=false;}
function clearPurchaseError(){const e=document.querySelector("#purchaseFormError");if(e){e.textContent="";e.hidden=true;}}
function formatMoneyInput(value) {
  if (value === "" || value == null) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "";
}

function nullableNumber(value){return value===""||value==null?null:Number(value);}
