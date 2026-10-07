const state = {
  records: [],
  bySerial: new Map(),
  recent: [],
  currentRecord: null,
  data: null,
};

const $ = (selector) => document.querySelector(selector);
const input = $("#serialInput");
const form = $("#searchForm");
const resultCard = $("#resultCard");
const resultContent = $(".result-content");
const emptyResult = $(".empty-result");
const toast = $("#toast");
const RECENT_KEY = "serial-insight-recent-v1";

function normalizeSerial(value) {
  return String(value || "").replace(/\u200b/g, "").trim().toUpperCase();
}

function displayValue(value) {
  return value === null || value === undefined || String(value).trim() === "" ? "未提供" : String(value).trim();
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = displayValue(value);
}

function setLinkText(selector, value, href) {
  const element = $(selector);
  if (!element) return;
  element.replaceChildren();
  const cleanValue = String(value || "").trim();
  if (!cleanValue) {
    element.textContent = "未提供";
    return;
  }
  const link = document.createElement("a");
  link.textContent = cleanValue;
  link.href = href;
  element.append(link);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function setSyncStatus(status, type = "ready") {
  const label = $("#syncStatus");
  const dot = document.querySelector(".status-dot");
  label.textContent = status;
  dot.classList.toggle("is-loading", type === "loading");
  dot.classList.toggle("is-error", type === "error");
}

function updateInputState() {
  $("#inputClearButton").hidden = !input.value;
}

function updateStats(data) {
  const stats = data.stats || {};
  $("#heroRecordCount").textContent = stats.searchableRecords ?? "—";
  $("#statRecords").textContent = stats.searchableRecords ?? "—";
  $("#statCustomers").textContent = stats.customerCount ?? "—";
  $("#statRegions").textContent = stats.regionCount ?? "—";
  $("#rawRowCount").textContent = stats.rawRows ?? "—";
  const sheets = data.sourceSheets?.length ?? 0;
  $("#sourceSheetCount").textContent = sheets;
  $("#footerSheetCount").textContent = sheets;

  const counts = new Map();
  state.records.forEach((record) => {
    const warranty = displayValue(record.warrantyType);
    counts.set(warranty, (counts.get(warranty) || 0) + 1);
  });
  const breakdown = $("#warrantyBreakdown");
  breakdown.replaceChildren();
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0]?.[1] || 1;
  sorted.forEach(([name, count]) => {
    const row = document.createElement("div");
    row.className = "breakdown-row-wrap";
    row.innerHTML = `<div class="breakdown-row"><span>${escapeHtml(name)}</span><span>${count}</span></div><div class="breakdown-bar"><span style="width:${Math.round((count / maxCount) * 100)}%"></span></div>`;
    breakdown.append(row);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function expiryState(expiry) {
  const cleanExpiry = String(expiry || "").trim();
  if (!cleanExpiry) return { label: "期限未提供", className: "is-neutral" };
  const parsed = new Date(`${cleanExpiry.replaceAll("/", "-")}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return { label: "期限已登錄", className: "is-neutral" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((parsed.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: "已過期", className: "is-expired" };
  if (days <= 90) return { label: "即將到期", className: "is-warning" };
  return { label: "保固有效", className: "" };
}

function renderRecord(record, searchedSerial) {
  state.currentRecord = record;
  resultCard.classList.remove("is-not-found");
  emptyResult.hidden = true;
  resultContent.hidden = false;
  $("#resultCount").textContent = "找到 1 筆紀錄";
  $("#resultTitle").textContent = "已找到設備紀錄";
  $("#resultMessage").textContent = "";
  setText("#recordModel", record.model);
  setText("#recordSerial", record.serialNumber);
  setText("#recordCustomer", record.customerName);
  setText("#recordRegion", record.region);
  setText("#recordWarranty", record.warrantyType);
  setText("#recordExpiry", record.expiry);
  setText("#recordCluster", record.clusterName);
  setText("#recordVersion", record.systemVersion);
  setText("#recordContact", record.contactName);
  setLinkText("#recordEmail", record.contactEmail, `mailto:${record.contactEmail}`);
  setLinkText("#recordPhone", record.contactPhone, `tel:${record.contactPhone}`);
  setText("#recordSales", record.sales);
  setText("#recordSe1", record.accountSe1);
  setText("#recordSe2", record.accountSe2);
  setText("#recordSource", record.sourceSheet);
  setText("#recordRow", record.sourceRow);
  const badge = $("#expiryBadge");
  const expiry = expiryState(record.expiry);
  badge.textContent = expiry.label;
  badge.className = `expiry-badge ${expiry.className}`.trim();
  input.value = searchedSerial;
  updateInputState();
}

function renderNotFound(searchedSerial) {
  state.currentRecord = null;
  resultCard.classList.add("is-not-found");
  emptyResult.hidden = false;
  resultContent.hidden = true;
  $("#resultCount").textContent = "查無紀錄";
  $("#resultTitle").textContent = "這筆序號尚未建立在清單中";
  $("#resultMessage").textContent = `找不到「${searchedSerial}」的完全相符資料，請確認序號是否正確，或改用清單中的完整序號查詢。`;
  $(".empty-result .eyebrow").textContent = "NO MATCH FOUND";
  input.value = searchedSerial;
  updateInputState();
}

function renderReady() {
  state.currentRecord = null;
  resultCard.classList.remove("is-not-found");
  emptyResult.hidden = false;
  resultContent.hidden = true;
  $("#resultCount").textContent = "尚未查詢";
  $(".empty-result .eyebrow").textContent = "READY WHEN YOU ARE";
  $("#resultTitle").textContent = "等待輸入序號";
  $("#resultMessage").textContent = "輸入上方的產品序號，系統會從整合設備清單中定位對應紀錄。";
}

function renderRecent() {
  const container = $("#recentList");
  const clearButton = $("#clearRecentButton");
  container.replaceChildren();
  clearButton.hidden = state.recent.length === 0;
  if (!state.recent.length) {
    const empty = document.createElement("p");
    empty.className = "empty-rail";
    empty.textContent = "完成第一次查詢後，紀錄會顯示在這裡。";
    container.append(empty);
    return;
  }
  state.recent.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.dataset.serial = item.serial;
    button.innerHTML = `<span class="recent-index">${String(index + 1).padStart(2, "0")}</span><span class="recent-copy"><strong>${escapeHtml(item.serial)}</strong><span>${escapeHtml(item.model || "設備紀錄")}</span></span>`;
    button.addEventListener("click", () => runSearch(item.serial));
    container.append(button);
  });
}

function saveRecent(record) {
  const serial = record.serialNumber;
  state.recent = [{ serial, model: record.model }, ...state.recent.filter((item) => normalizeSerial(item.serial) !== normalizeSerial(serial))].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  renderRecent();
}

function runSearch(value) {
  const searchedSerial = String(value || "").trim();
  if (!searchedSerial) {
    renderReady();
    input.focus();
    showToast("請先輸入產品序號", true);
    return;
  }
  const record = state.bySerial.get(normalizeSerial(searchedSerial));
  if (record) {
    renderRecord(record, searchedSerial);
    saveRecent(record);
  } else {
    renderNotFound(searchedSerial);
  }
}

async function copyCurrentSerial() {
  const serial = state.currentRecord?.serialNumber;
  if (!serial) return;
  try {
    await navigator.clipboard.writeText(serial);
    $("#copyLabel").textContent = "已複製";
    showToast("產品序號已複製");
    window.setTimeout(() => { $("#copyLabel").textContent = "複製序號"; }, 1500);
  } catch {
    showToast("瀏覽器未允許複製，請手動選取序號", true);
  }
}

async function loadData() {
  setSyncStatus("正在載入資料", "loading");
  try {
    const response = await fetch("/data/equipment.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.data = data;
    state.records = data.records || [];
    state.bySerial = new Map(state.records.map((record) => [normalizeSerial(record.serialNumber), record]));
    updateStats(data);
    setSyncStatus("資料已載入");
  } catch (error) {
    console.error(error);
    setSyncStatus("資料載入失敗", "error");
    $("#resultCount").textContent = "資料錯誤";
    $("#resultTitle").textContent = "目前無法載入查詢資料";
    $("#resultMessage").textContent = "請重新整理頁面；若問題持續，請確認 data/equipment.json 是否存在。";
    showToast("資料載入失敗，請重新整理頁面", true);
  }
}

function restoreRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    state.recent = Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    state.recent = [];
  }
  renderRecent();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(input.value);
});
input.addEventListener("input", updateInputState);
$("#inputClearButton").addEventListener("click", () => {
  input.value = "";
  updateInputState();
  renderReady();
  input.focus();
});
$("#clearRecentButton").addEventListener("click", () => {
  state.recent = [];
  localStorage.removeItem(RECENT_KEY);
  renderRecent();
  showToast("最近查詢已清除");
});
$("#copySerialButton").addEventListener("click", copyCurrentSerial);
document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.example;
    updateInputState();
    runSearch(input.value);
  });
});

restoreRecent();
updateInputState();
loadData();
