/**
 * Paradise License Admin - Google Apps Script backend
 *
 * Cara pakai:
 * 1. Tempel file ini di Apps Script yang terikat ke Spreadsheet, ATAU isi SPREADSHEET_ID.
 * 2. Deploy > New deployment > Web app.
 * 3. Execute as: Me. Who has access: Anyone (sesuai kebijakan akun Anda).
 * 4. Salin URL /exec ke konstanta API_URL pada script.js.
 */

const SPREADSHEET_ID = ""; // Opsional. Kosongkan jika script terikat langsung ke Spreadsheet.
const SHEET_NAME = "Licenses";
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
    const action = String((e && e.parameter && e.parameter.action) || "list").toLowerCase();

    if (action === "ping") {
      return json_({ success: true, message: "Paradise License API aktif." });
    }

    if (action === "list") {
      return json_(listLicenses_());
    }

    return json_({ success: false, message: "Action GET tidak dikenal: " + action });
  } catch (error) {
    return json_({ success: false, message: error.message, stack: error.stack });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || "").toLowerCase();

    switch (action) {
      case "generate":
        return json_(upsertItems_(body.items, false));
      case "import":
        return json_(upsertItems_(body.items, true));
      case "block":
        return json_(updateLicense_(body.license, { status: "BLOCK" }));
      case "unblock":
        return json_(updateLicense_(body.license, { status: "READY" }));
      case "reset":
        return json_(updateLicense_(body.license, {
          status: "READY",
          device: "",
          activated: "",
          lastLogin: ""
        }));
      case "delete":
        return json_(deleteLicense_(body.license));
      case "ping":
        return json_({ success: true, message: "Paradise License API aktif." });
      default:
        return json_({ success: false, message: "Action POST tidak dikenal: " + action });
    }
  } catch (error) {
    return json_({ success: false, message: error.message, stack: error.stack });
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    // Fallback untuk form-urlencoded jika suatu saat dipakai.
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

function listLicenses_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { success: true, total: 0, data: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const data = values
    .filter(function(row) { return String(row[0] || "").trim() !== ""; })
    .map(rowToObject_);

  return { success: true, total: data.length, data: data };
}

function upsertItems_(items, preserveFields) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Items kosong atau tidak valid.");
  }

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
      const key = String(row[0] || "").trim().toUpperCase();
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

      const key = item.license.toUpperCase();
      const rowNumber = existing[key];

      if (typeof rowNumber === "number" && rowNumber > 0) {
        if (preserveFields) {
          sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([objectToRow_(item)]);
          updated += 1;
        } else {
          skipped += 1;
        }
      } else if (rowNumber === -1) {
        // Duplikat di dalam batch yang sama.
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
  const key = String(license || "").trim();
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
  const key = String(license || "").trim();
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

function normalizeItem_(raw, now) {
  raw = raw || {};
  return {
    license: String(raw.license || "").trim(),
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
    license: String(row[0] || ""),
    status: String(row[1] || "READY").toUpperCase(),
    owner: String(row[2] || "-"),
    device: String(row[3] || ""),
    created: serializeCell_(row[4]),
    activated: serializeCell_(row[5]),
    lastLogin: serializeCell_(row[6]),
    expired: serializeCell_(row[7]) || "LIFETIME",
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

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
