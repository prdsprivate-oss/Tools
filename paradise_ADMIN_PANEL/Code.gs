/**
 * Paradise License API + Admin Spreadsheet
 *
 * Pasang pada Apps Script yang terikat ke Spreadsheet license Anda.
 * Setelah mengubah kode, lakukan Deploy > Manage deployments > Edit > New version.
 * COMMERCIAL SECURE: admin actions wajib token + LAST_CHECK terpisah dari schema utama.
 */

const SPREADSHEET_ID = ""; // Kosongkan jika Apps Script terikat langsung ke Spreadsheet.
const SHEET_NAME = "Licenses";
const LAST_CHECK_HEADER = "LAST_CHECK";
const ADMIN_TOKEN_PROPERTY = "PARADISE_ADMIN_TOKEN";
const ADMIN_ACTIONS = ["list", "generate", "import", "block", "unblock", "reset", "delete"];
const HEADERS = [
  "LICENSE",
  "STATUS",
  "OWNER",
  "DEVICE",
  "CREATED",
  "ACTIVATED",
  "LAST_LOGIN",
  "EXPIRED",
  "VERSION"
];

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || "ping").toLowerCase();

    if (action === "ping") {
      return json_({ success: true, valid: true, message: "Paradise License API aktif." });
    }

    if (action === "list") {
      if (!isAdminAuthorized_(params)) return json_(adminDenied_());
      return json_(listLicenses_());
    }

    return json_({ success: false, valid: false, message: "Action GET tidak dikenal: " + action });
  } catch (error) {
    return jsonError_(error);
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || "").toLowerCase();

    if (ADMIN_ACTIONS.indexOf(action) !== -1 && !isAdminAuthorized_(body)) {
      return json_(adminDenied_());
    }

    switch (action) {
      case "list":
        return json_(listLicenses_());
      case "activate":
        return json_(activateLicense_(body.license, body.device, body.version));
      case "validate":
        return json_(validateLicense_(body.license, body.device, body.version));
      case "generate":
        return json_(upsertItems_(body.items, false));
      case "import":
        return json_(upsertItems_(body.items, true));
      case "block":
        return json_(updateLicense_(body.license, { status: "BLOCK" }));
      case "unblock":
        return json_(updateLicense_(body.license, { status: "READY" }));
      case "reset": {
        const result = updateLicense_(body.license, {
          status: "READY",
          device: "",
          activated: "",
          lastLogin: ""
        });
        clearLastCheck_(body.license);
        return json_(result);
      }
      case "delete":
        return json_(deleteLicense_(body.license));
      case "ping":
        return json_({ success: true, valid: true, message: "Paradise License API aktif." });
      default:
        return json_({ success: false, valid: false, message: "Action POST tidak dikenal: " + action });
    }
  } catch (error) {
    return jsonError_(error);
  }
}

function activateLicense_(license, device, requestedVersion) {
  const key = normalizeKey_(license);
  const deviceId = String(device || "").trim();

  if (!key) return invalid_("License wajib diisi.");
  if (!deviceId) return invalid_("Device ID tidak tersedia.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const rowNumber = findLicenseRow_(sheet, key);
    if (!rowNumber) return invalid_("License tidak ditemukan.");

    const row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
    const item = rowToObject_(row);
    const checkTime = new Date();
    touchLastCheck_(sheet, rowNumber, checkTime);
    const commonError = checkLicenseRules_(item, requestedVersion);
    if (commonError) return invalid_(commonError, item);

    if (item.status === "BLOCK") {
      return invalid_("License diblokir oleh admin.", item);
    }

    if (item.status === "ACTIVE" && item.device && item.device !== deviceId) {
      return invalid_("License sudah aktif di perangkat lain. Gunakan RESET dari panel admin.", item);
    }

    if (item.status !== "READY" && item.status !== "ACTIVE") {
      return invalid_("Status license tidak dapat diaktifkan: " + item.status, item);
    }

    const now = new Date();
    item.status = "ACTIVE";
    item.device = deviceId;
    item.activated = item.activated || now;
    item.lastLogin = now;

    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([objectToRow_(item)]);

    return {
      success: true,
      valid: true,
      message: "License berhasil diaktifkan.",
      data: publicLicense_(item)
    };
  } finally {
    lock.releaseLock();
  }
}

function validateLicense_(license, device, requestedVersion) {
  const key = normalizeKey_(license);
  const deviceId = String(device || "").trim();

  if (!key) return invalid_("License belum tersimpan.");
  if (!deviceId) return invalid_("Device ID tidak tersedia.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const rowNumber = findLicenseRow_(sheet, key);
    if (!rowNumber) return invalid_("License tidak ditemukan.");

    const row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
    const item = rowToObject_(row);
    const checkTime = new Date();
    touchLastCheck_(sheet, rowNumber, checkTime);
    const commonError = checkLicenseRules_(item, requestedVersion);
    if (commonError) return invalid_(commonError, item);

    if (item.status === "BLOCK") return invalid_("License diblokir oleh admin.", item);
    if (item.status !== "ACTIVE") return invalid_("License belum aktif. Masukkan kembali license pada popup.", item);
    if (!item.device || item.device !== deviceId) return invalid_("Device license tidak cocok.", item);

    item.lastLogin = checkTime;
    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([objectToRow_(item)]);

    return {
      success: true,
      valid: true,
      message: "License valid.",
      data: publicLicense_(item)
    };
  } finally {
    lock.releaseLock();
  }
}

function checkLicenseRules_(item, requestedVersion) {
  const expiry = expiryState_(item.expired);
  if (!expiry.valid) return expiry.message;
  if (expiry.expired) return "Masa aktif license sudah berakhir.";

  const licenseVersion = String(item.version || "").trim().toUpperCase();
  const expected = String(requestedVersion || "").trim().toUpperCase();
  const universal = !licenseVersion || licenseVersion === "*" || licenseVersion === "ALL";

  if (expected && !universal && licenseVersion !== expected) {
    return "License tidak berlaku untuk versi produk ini.";
  }

  return "";
}

function expiryState_(value) {
  if (value instanceof Date) {
    return { valid: true, expired: value.getTime() < Date.now() };
  }

  const text = String(value || "LIFETIME").trim();
  const upper = text.toUpperCase();
  if (!text || upper === "LIFETIME" || upper === "LIFE TIME" || upper === "NEVER" || upper === "-" || upper === "*") {
    return { valid: true, expired: false };
  }

  const parsed = new Date(text.replace(" ", "T"));
  if (isNaN(parsed.getTime())) {
    return { valid: false, expired: true, message: "Format EXPIRED pada Spreadsheet tidak valid." };
  }

  return { valid: true, expired: parsed.getTime() < Date.now() };
}

function invalid_(message, item) {
  return {
    success: false,
    valid: false,
    message: message,
    data: item ? publicLicense_(item) : null
  };
}

function publicLicense_(item) {
  return {
    license: item.license,
    status: item.status,
    owner: item.owner,
    activated: serializeCell_(item.activated),
    lastLogin: serializeCell_(item.lastLogin),
    expired: serializeCell_(item.expired) || "LIFETIME",
    version: item.version || "1"
  };
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return e && e.parameter ? e.parameter : {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return e.parameter || {};
  }
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Spreadsheet tidak ditemukan. Ikat Apps Script ke Spreadsheet atau isi SPREADSHEET_ID.");
  }
  return spreadsheet;
}

function getSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const headerIsValid = HEADERS.every(function(header, index) {
    return String(firstRow[index] || "").toUpperCase() === header;
  });

  if (!headerIsValid) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getAdminToken_() {
  return String(PropertiesService.getScriptProperties().getProperty(ADMIN_TOKEN_PROPERTY) || "").trim();
}

function isAdminAuthorized_(payload) {
  const expected = getAdminToken_();
  if (!expected) return false;
  const provided = String((payload && (payload.adminToken || payload.admin_token || payload.token)) || "").trim();
  return provided.length > 0 && provided === expected;
}

function adminDenied_() {
  const configured = Boolean(getAdminToken_());
  return {
    success: false,
    valid: false,
    code: configured ? "ADMIN_UNAUTHORIZED" : "ADMIN_NOT_CONFIGURED",
    message: configured
      ? "Admin token tidak valid."
      : "Admin token belum dikonfigurasi pada Script Properties."
  };
}

/**
 * Jalankan fungsi ini MANUAL dari Apps Script editor untuk membuat/merotasi token admin.
 * Token tidak pernah dikirim ke extension pelanggan; hanya dipakai oleh Paradise License Admin.
 * Setelah Run, lihat Execution log lalu masukkan token itu ke License Manager.
 */
function createOrRotateAdminToken() {
  const token = (Utilities.getUuid() + "-" + Utilities.getUuid()).replace(/-/g, "").toUpperCase();
  PropertiesService.getScriptProperties().setProperty(ADMIN_TOKEN_PROPERTY, token);
  console.log("PARADISE_ADMIN_TOKEN=" + token);
  return token;
}

function getLastCheckColumn_(sheet, createIfMissing) {
  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (let i = 0; i < headers.length; i += 1) {
    if (String(headers[i] || "").trim().toUpperCase() === LAST_CHECK_HEADER) return i + 1;
  }
  if (!createIfMissing) return 0;
  const column = lastColumn + 1;
  sheet.getRange(1, column).setValue(LAST_CHECK_HEADER);
  return column;
}

function touchLastCheck_(sheet, rowNumber, when) {
  const column = getLastCheckColumn_(sheet, true);
  const range = sheet.getRange(rowNumber, column);
  range.setValue(when || new Date());
  range.setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function clearLastCheck_(license) {
  const sheet = getSheet_();
  const rowNumber = findLicenseRow_(sheet, normalizeKey_(license));
  if (!rowNumber) return;
  const column = getLastCheckColumn_(sheet, false);
  if (column) sheet.getRange(rowNumber, column).clearContent();
}

function listLicenses_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, total: 0, data: [] };

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const lastCheckColumn = getLastCheckColumn_(sheet, false);
  const lastChecks = lastCheckColumn
    ? sheet.getRange(2, lastCheckColumn, lastRow - 1, 1).getValues()
    : [];
  const data = [];

  values.forEach(function(row, index) {
    if (String(row[0] || "").trim() === "") return;
    const item = rowToObject_(row);
    item.lastCheck = lastCheckColumn ? serializeCell_(lastChecks[index][0]) : "";
    data.push(item);
  });

  return { success: true, total: data.length, data: data };
}

function upsertItems_(items, preserveFields) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Items kosong atau tidak valid.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    const existingValues = lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues()
      : [];

    const existing = {};
    existingValues.forEach(function(row, index) {
      const key = normalizeKey_(row[0]);
      if (key) existing[key] = index + 2;
    });

    const now = new Date();
    const appendRows = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    items.forEach(function(raw) {
      const item = normalizeItem_(raw, now);
      if (!item.license) {
        skipped += 1;
        return;
      }

      const key = normalizeKey_(item.license);
      const rowNumber = existing[key];

      if (typeof rowNumber === "number" && rowNumber > 0) {
        if (preserveFields) {
          sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([objectToRow_(item)]);
          updated += 1;
        } else {
          skipped += 1;
        }
      } else if (rowNumber === -1) {
        skipped += 1;
      } else {
        appendRows.push(objectToRow_(item));
        existing[key] = -1;
        inserted += 1;
      }
    });

    if (appendRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appendRows.length, HEADERS.length).setValues(appendRows);
    }

    return {
      success: true,
      total: inserted + updated,
      inserted: inserted,
      updated: updated,
      skipped: skipped,
      message: "Sinkronisasi berhasil."
    };
  } finally {
    lock.releaseLock();
  }
}

function updateLicense_(license, changes) {
  const key = normalizeKey_(license);
  if (!key) throw new Error("License wajib diisi.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const rowNumber = findLicenseRow_(sheet, key);
    if (!rowNumber) throw new Error("License tidak ditemukan: " + key);

    const row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
    const item = rowToObject_(row);

    Object.keys(changes).forEach(function(field) {
      item[field] = changes[field];
    });

    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([objectToRow_(item)]);
    return { success: true, message: "License berhasil diperbarui.", data: item };
  } finally {
    lock.releaseLock();
  }
}

function deleteLicense_(license) {
  const key = normalizeKey_(license);
  if (!key) throw new Error("License wajib diisi.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const rowNumber = findLicenseRow_(sheet, key);
    if (!rowNumber) throw new Error("License tidak ditemukan: " + key);
    sheet.deleteRow(rowNumber);
    return { success: true, message: "License berhasil dihapus." };
  } finally {
    lock.releaseLock();
  }
}

function findLicenseRow_(sheet, license) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const match = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(license)
    .matchEntireCell(true)
    .matchCase(false)
    .findNext();

  return match ? match.getRow() : 0;
}

function normalizeKey_(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeItem_(raw, now) {
  raw = raw || {};
  return {
    license: normalizeKey_(raw.license),
    status: String(raw.status || "READY").trim().toUpperCase(),
    owner: String(raw.owner || "-").trim(),
    device: String(raw.device || "").trim(),
    created: raw.created || now,
    activated: raw.activated || "",
    lastLogin: raw.lastLogin || "",
    expired: raw.expired || "LIFETIME",
    version: String(raw.version || "1").trim()
  };
}

function rowToObject_(row) {
  return {
    license: normalizeKey_(row[0]),
    status: String(row[1] || "READY").toUpperCase(),
    owner: String(row[2] || "-"),
    device: String(row[3] || ""),
    created: row[4] || "",
    activated: row[5] || "",
    lastLogin: row[6] || "",
    expired: row[7] || "LIFETIME",
    version: String(row[8] || "1")
  };
}

function objectToRow_(item) {
  return [
    item.license,
    item.status || "READY",
    item.owner || "-",
    item.device || "",
    item.created || new Date(),
    item.activated || "",
    item.lastLogin || "",
    item.expired || "LIFETIME",
    item.version || "1"
  ];
}

function serializeCell_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }
  return value === null || value === undefined ? "" : String(value);
}

function jsonError_(error) {
  return json_({
    success: false,
    valid: false,
    message: String(error && error.message ? error.message : error)
  });
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
