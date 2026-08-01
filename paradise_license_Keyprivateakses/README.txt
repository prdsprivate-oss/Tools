PARADISE LICENSE ADMIN - FIXED PACKAGE

PERBAIKAN UTAMA
1. ID tombol Generate tidak lagi duplikat.
2. btnGenerate sekarang benar-benar ada.
3. Hanya ada satu proses inisialisasi (DOMContentLoaded), tidak ada window.onload yang saling menimpa.
4. Manifest mengarah ke index.html yang benar.
5. Manifest memiliki host_permissions untuk Google Apps Script dan redirect Google Content Service.
6. POST memakai text/plain agar lebih kompatibel dengan Apps Script.
7. Generate, block, unblock, reset, delete, import, dan list semuanya memakai API Spreadsheet.
8. Event klik list tidak lagi memakai inline onclick (kompatibel dengan CSP Manifest V3).
9. Error timeout, HTTP, dan respons non-JSON ditampilkan dengan jelas.

CARA MEMASANG BACKEND
1. Buka Spreadsheet tujuan.
2. Extensions > Apps Script.
3. Ganti isi Code.gs dengan file Code.gs dalam paket ini.
4. Deploy > New deployment > Web app.
5. Execute as: Me.
6. Who has access: Anyone (atau opsi publik yang tersedia pada akun Anda).
7. Deploy, lalu salin URL yang berakhir /exec.
8. Ganti nilai API_URL pada baris atas script.js dengan URL /exec tersebut.
9. Set timezone Apps Script sesuai kebutuhan, lalu simpan.

CARA MEMASANG EXTENSION
1. Pastikan folder berisi index.html, script.js, style.css, manifest.json, icon_128.png.
2. Buka chrome://extensions.
3. Aktifkan Developer mode.
4. Klik Load unpacked dan pilih folder ini.
5. Jika extension lama masih terpasang, klik Reload setelah mengganti file.

TES CEPAT
- Buka URL /exec?action=ping di browser. Harus muncul JSON success:true.
- Buka URL /exec?action=list. Harus muncul JSON dengan data array.
- Klik Generate 1 license dari extension, lalu periksa sheet bernama Licenses.

CATATAN
- Klik kanan tombol EXPORT untuk import JSON ke Spreadsheet.
- Jika deployment Apps Script diubah, buat deployment baru atau update deployment, lalu gunakan URL /exec yang aktif.
