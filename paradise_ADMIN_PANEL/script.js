"use strict";

const API_URL = "https://script.google.com/macros/s/AKfycbx5791BscLcgfwNqarj6JvQGbSHWmsRL2MmBzsT_Ta04w6BYyViYAZ_3iLX0i8rt3sy/exec";
const REQUEST_TIMEOUT_MS = 30000;
const ADMIN_TOKEN_STORAGE_KEY = "paradiseAdminToken";
const ADMIN_ACTIONS = new Set(["list", "generate", "import", "block", "unblock", "reset", "delete"]);

let licenses = [];
let selectedIndex = -1;
let searchTerm = "";
let confirmCallback = null;
let requestInProgress = false;

const $ = (id) => document.getElementById(id);

function normalizeLicense(item = {}) {
    return {
        license: String(item.license || "").trim(),
        status: String(item.status || "READY").trim().toUpperCase(),
        owner: String(item.owner || "-").trim(),
        device: String(item.device || "").trim(),
        created: formatDisplayValue(item.created),
        activated: formatDisplayValue(item.activated),
        lastLogin: formatDisplayValue(item.lastLogin),
        lastCheck: formatDisplayValue(item.lastCheck),
        expired: formatDisplayValue(item.expired),
        version: String(item.version || "1").trim()
    };
}

function formatDisplayValue(value) {
    if (value === null || value === undefined || value === "") return "";
    return String(value);
}

async function readAdminToken() {
    try {
        if (globalThis.chrome?.storage?.local) {
            const data = await chrome.storage.local.get(ADMIN_TOKEN_STORAGE_KEY);
            return String(data?.[ADMIN_TOKEN_STORAGE_KEY] || "").trim();
        }
    } catch (_error) {}
    try { return String(localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "").trim(); } catch (_error) { return ""; }
}

async function saveAdminToken(token) {
    const clean = String(token || "").trim();
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [ADMIN_TOKEN_STORAGE_KEY]: clean });
    else localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, clean);
    return clean;
}

async function clearAdminToken() {
    try {
        if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(ADMIN_TOKEN_STORAGE_KEY);
        else localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    } catch (_error) {}
}

async function promptAdminToken(message = "Masukkan Paradise Admin Token") {
    const current = await readAdminToken();
    const value = window.prompt(`${message}\n\nToken disimpan lokal di browser License Manager ini.`, current);
    if (value === null) throw new Error("Admin token diperlukan untuk membuka License Manager.");
    const token = String(value).trim();
    if (!token) throw new Error("Admin token tidak boleh kosong.");
    await saveAdminToken(token);
    return token;
}

async function ensureAdminToken() {
    return (await readAdminToken()) || promptAdminToken();
}

async function apiRequest(action, payload = {}, method = "POST", allowAuthRetry = true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const needsAdmin = ADMIN_ACTIONS.has(String(action || "").toLowerCase());
        const adminToken = needsAdmin ? await ensureAdminToken() : "";
        const securedPayload = needsAdmin ? { ...payload, adminToken } : payload;

        let url = API_URL;
        const options = {
            method,
            redirect: "follow",
            cache: "no-store",
            signal: controller.signal
        };

        if (method === "GET") {
            const params = new URLSearchParams({ action, ...securedPayload, _: Date.now().toString() });
            url += `?${params.toString()}`;
        } else {
            // text/plain avoids an unnecessary CORS preflight with Apps Script.
            options.headers = { "Content-Type": "text/plain;charset=UTF-8" };
            options.body = JSON.stringify({ action, ...securedPayload });
        }

        const response = await fetch(url, options);
        const text = await response.text();

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 180) || response.statusText}`);
        }

        let result;
        try {
            result = JSON.parse(text);
        } catch (_error) {
            throw new Error("Endpoint Apps Script tidak mengembalikan JSON. Periksa deployment dan izin akses Web App.");
        }

        if (result?.code === "ADMIN_NOT_CONFIGURED") {
            throw new Error("Admin token belum dibuat di Apps Script. Jalankan fungsi createOrRotateAdminToken() sekali, lalu copy token ke License Manager.");
        }

        if (result?.code === "ADMIN_UNAUTHORIZED") {
            await clearAdminToken();
            if (allowAuthRetry) {
                await promptAdminToken("Admin token salah. Masukkan token yang benar");
                return apiRequest(action, payload, method, false);
            }
            throw new Error("Admin token tidak valid.");
        }

        if (!result || result.success !== true) {
            throw new Error(result?.message || `Aksi '${action}' gagal.`);
        }

        return result;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("Koneksi ke Spreadsheet timeout. Periksa URL deployment Apps Script.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function runRequest(task) {
    if (requestInProgress) {
        toast("Permintaan sebelumnya masih diproses.", "warning");
        return null;
    }

    requestInProgress = true;
    document.querySelectorAll(".actionCard").forEach((el) => el.classList.add("busy"));

    try {
        return await task();
    } finally {
        requestInProgress = false;
        document.querySelectorAll(".actionCard").forEach((el) => el.classList.remove("busy"));
    }
}

function randomPart(length) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < length; i += 1) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function createLicense(prefix) {
    return `${prefix}-${randomPart(4)}-${randomPart(4)}-${randomPart(4)}`;
}

function renderLicenseList() {
    const list = $("licenseList");
    list.replaceChildren();

    const visibleItems = licenses
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
            if (!searchTerm) return true;
            const haystack = `${item.license} ${item.owner} ${item.device} ${item.status}`.toLowerCase();
            return haystack.includes(searchTerm);
        });

    if (!visibleItems.length) {
        const empty = document.createElement("div");
        empty.className = "emptyState";
        empty.textContent = licenses.length ? "Tidak ada hasil pencarian." : "Database Spreadsheet masih kosong.";
        list.appendChild(empty);
        return;
    }

    visibleItems.forEach(({ item, index }) => {
        const card = document.createElement("div");
        const statusClass = item.status === "READY" ? "cardReady" : item.status === "ACTIVE" ? "cardActive" : "cardBlock";
        card.className = `licenseCard ${statusClass}${selectedIndex === index ? " selectedCard" : ""}`;
        card.addEventListener("click", () => showDetail(index));

        const key = document.createElement("div");
        key.className = "licenseKey";
        key.textContent = item.license;

        const status = document.createElement("div");
        const badgeClass = item.status === "READY" ? "ready" : item.status === "ACTIVE" ? "active" : "block";
        status.className = `licenseStatus ${badgeClass}`;
        status.textContent = item.status;

        const owner = document.createElement("div");
        owner.className = "licenseOwner";
        owner.textContent = `👤 ${item.owner || "-"}`;

        const device = document.createElement("div");
        device.className = "licenseDevice";
        device.textContent = `💻 ${item.device || "-"}`;

        card.append(key, status, owner, device);
        list.appendChild(card);
    });
}

function statusIcon(status) {
    if (status === "ACTIVE") return "🔵";
    if (status === "BLOCK") return "🔴";
    return "🟢";
}

function showDetail(index) {
    if (!licenses[index]) return;
    selectedIndex = index;
    const item = licenses[index];

    $("profileStatus").textContent = `${statusIcon(item.status)} ${item.status}`;
    $("profileLicense").textContent = item.license;
    $("profileOwner").textContent = `👤 ${item.owner || "-"}`;
    $("profileDevice").textContent = `💻 ${item.device || "-"}`;

    $("detailLicense").textContent = item.license || "-";
    $("detailStatus").textContent = item.status || "-";
    $("detailOwner").textContent = item.owner || "-";
    $("detailDevice").textContent = item.device || "-";
    $("detailCreated").textContent = item.created || "-";
    $("detailActivated").textContent = item.activated || "-";
    $("detailLastLogin").textContent = item.lastLogin || "-";
    $("detailLastCheck").textContent = item.lastCheck || "-";
    $("detailExpired").textContent = item.expired || "LIFETIME";
    $("detailVersion").textContent = item.version || "1";

    renderLicenseList();
}

function clearDetail() {
    selectedIndex = -1;
    $("profileStatus").textContent = "🟢 READY";
    $("profileLicense").textContent = "PLP-XXXX-XXXX-XXXX";
    $("profileOwner").textContent = "👤 Paradise";
    $("profileDevice").textContent = "💻 -";

    ["detailLicense", "detailStatus", "detailOwner", "detailDevice", "detailCreated", "detailActivated", "detailLastLogin", "detailLastCheck", "detailExpired", "detailVersion"]
        .forEach((id) => { $(id).textContent = "-"; });
}

function updateDashboard() {
    const counts = licenses.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
    }, {});

    $("totalLicense").textContent = String(licenses.length);
    $("readyLicense").textContent = String(counts.READY || 0);
    $("activeLicense").textContent = String(counts.ACTIVE || 0);
    $("blockLicense").textContent = String(counts.BLOCK || 0);
}

async function loadDatabase({ quiet = false, preserveLicense = "" } = {}) {
    if (!quiet) toast("Mengambil database Spreadsheet...", "info");

    const result = await apiRequest("list");
    licenses = Array.isArray(result.data) ? result.data.map(normalizeLicense) : [];

    updateDashboard();

    const preservedIndex = preserveLicense
        ? licenses.findIndex((item) => item.license === preserveLicense)
        : -1;

    if (preservedIndex >= 0) {
        showDetail(preservedIndex);
    } else if (licenses.length) {
        showDetail(0);
    } else {
        clearDetail();
        renderLicenseList();
    }

    if (!quiet) toast(`${licenses.length} License berhasil dimuat.`, "success");
    return result;
}

async function handleGenerate() {
    const prefix = $("genPrefix").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const total = Number($("genTotal").value);
    const owner = $("genOwner").value.trim();
    const version = $("genVersion").value.trim();

    if (!prefix) return toast("Prefix wajib diisi.", "warning");
    if (!Number.isInteger(total) || total < 1 || total > 500) return toast("Jumlah harus 1 sampai 500.", "warning");
    if (!owner) return toast("Owner wajib diisi.", "warning");

    const items = Array.from({ length: total }, () => ({
        license: createLicense(prefix),
        owner,
        version: version || "1"
    }));

    await runRequest(async () => {
        toast("Mengirim license ke Spreadsheet...", "info");
        const result = await apiRequest("generate", { items });
        $("generateOverlay").style.display = "none";
        await loadDatabase({ quiet: true });
        toast(`${result.total ?? total} License berhasil dibuat dan disinkronkan.`, "success");
    });
}

function requireSelected() {
    if (selectedIndex < 0 || !licenses[selectedIndex]) {
        toast("Pilih License terlebih dahulu.", "warning");
        return null;
    }
    return licenses[selectedIndex];
}

function showConfirm(message, callback) {
    $("confirmMessage").textContent = message;
    $("confirmOverlay").classList.remove("hidden");
    confirmCallback = callback;
}

function hideConfirm() {
    $("confirmOverlay").classList.add("hidden");
    confirmCallback = null;
}

async function changeLicense(action, successMessage, allowed) {
    const item = requireSelected();
    if (!item) return;
    if (allowed && !allowed(item)) return;

    showConfirm(`${action.toUpperCase()} LICENSE\n\n${item.license}\n\nLanjutkan?`, async () => {
        await runRequest(async () => {
            toast("Menyinkronkan perubahan...", "info");
            await apiRequest(action, { license: item.license });
            await loadDatabase({ quiet: true, preserveLicense: item.license });
            toast(successMessage, "success");
        });
    });
}

function exportDatabase() {
    if (!licenses.length) return toast("Database masih kosong.", "warning");

    const blob = new Blob([JSON.stringify(licenses, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `Paradise-License-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Database berhasil di-export.", "success");
}

function importDatabase(file) {
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const data = JSON.parse(String(reader.result));
            if (!Array.isArray(data)) throw new Error("Format JSON harus berupa array.");

            const items = data.map(normalizeLicense).filter((item) => item.license);
            if (!items.length) throw new Error("Tidak ada license valid di file JSON.");

            await runRequest(async () => {
                toast("Meng-import dan menyinkronkan ke Spreadsheet...", "info");
                const result = await apiRequest("import", { items });
                await loadDatabase({ quiet: true });
                toast(`${result.total ?? items.length} License berhasil di-import.`, "success");
            });
        } catch (error) {
            toast(error.message || "File JSON rusak.", "error");
        } finally {
            $("importFile").value = "";
        }
    };
    reader.readAsText(file);
}

function toast(message, type = "info") {
    const container = $("toastContainer");
    const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
    const box = document.createElement("div");
    box.className = `toast ${type}`;

    const title = document.createElement("div");
    title.className = "toastTitle";
    title.textContent = `${icons[type] || "ℹ️"} Paradise License`;

    const text = document.createElement("div");
    text.textContent = String(message);

    const bar = document.createElement("div");
    bar.className = "toastBar";

    box.append(title, text, bar);
    container.appendChild(box);

    setTimeout(() => { box.style.animation = "toastOut .25s forwards"; }, 4200);
    setTimeout(() => box.remove(), 4500);
}

function init() {
    $("title").textContent = "🔐 ADMIN";
    $("title").title = "Klik untuk mengganti Admin Token";
    $("title").addEventListener("click", async () => {
        try {
            await promptAdminToken("Masukkan / ganti Paradise Admin Token");
            toast("Admin token tersimpan lokal.", "success");
            await loadDatabase({ quiet: true });
        } catch (error) {
            toast(error.message || String(error), "warning");
        }
    });

    $("btnGenerate").addEventListener("click", () => { $("generateOverlay").style.display = "flex"; });
    $("generateCancel").addEventListener("click", () => { $("generateOverlay").style.display = "none"; });
    $("generateOk").addEventListener("click", () => handleGenerate().catch((error) => toast(error.message, "error")));

    $("btnReset").addEventListener("click", () => changeLicense("reset", "License berhasil di-reset dan disinkronkan."));
    $("btnBlock").addEventListener("click", () => changeLicense("block", "License berhasil di-block dan disinkronkan.", (item) => {
        if (item.status === "BLOCK") {
            toast("License sudah dalam status BLOCK.", "warning");
            return false;
        }
        return true;
    }));
    $("btnUnblock").addEventListener("click", () => changeLicense("unblock", "License berhasil di-unblock dan disinkronkan.", (item) => {
        if (item.status !== "BLOCK") {
            toast("License tidak sedang di-block.", "warning");
            return false;
        }
        return true;
    }));
    $("btnDelete").addEventListener("click", () => changeLicense("delete", "License berhasil dihapus dari Spreadsheet."));

    $("btnExport").addEventListener("click", exportDatabase);
    $("btnExport").addEventListener("contextmenu", (event) => {
        event.preventDefault();
        $("importFile").click();
    });
    $("importFile").addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file) importDatabase(file);
    });

    $("searchBox").addEventListener("input", (event) => {
        searchTerm = event.target.value.trim().toLowerCase();
        renderLicenseList();
    });

    $("confirmCancel").addEventListener("click", hideConfirm);
    $("confirmOk").addEventListener("click", async () => {
        const callback = confirmCallback;
        hideConfirm();
        if (callback) {
            try {
                await callback();
            } catch (error) {
                toast(error.message || String(error), "error");
            }
        }
    });

    $("generateOverlay").addEventListener("click", (event) => {
        if (event.target === $("generateOverlay")) $("generateOverlay").style.display = "none";
    });

    loadDatabase().catch((error) => {
        console.error(error);
        toast(error.message || String(error), "error");
        renderLicenseList();
    });
}

document.addEventListener("DOMContentLoaded", init);
