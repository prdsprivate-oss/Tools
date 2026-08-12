PARADISE LICENSE ADMIN — COMMERCIAL SECURE

PERUBAHAN KEAMANAN
1. activate / validate / ping tetap dapat dipakai extension pelanggan.
2. list / generate / import / block / unblock / reset / delete sekarang WAJIB Admin Token.
   License Manager mengirim LIST lewat POST agar token tidak ditempel di query URL.
3. Admin Token disimpan pada Apps Script Script Properties, bukan di source extension pelanggan.
4. License Manager meminta Admin Token pada penggunaan pertama dan menyimpannya lokal memakai chrome.storage.local.
5. Klik tombol 🔐 ADMIN di kanan atas untuk mengganti token.
6. LAST_CHECK tampil di detail License Manager dan dicatat terpisah dari 9 kolom schema utama.

SETUP BACKEND
1. Buka Spreadsheet license > Extensions > Apps Script.
2. Ganti Code.gs dengan Code.gs dari paket ini.
3. Simpan.
4. Dari dropdown function Apps Script pilih createOrRotateAdminToken lalu klik Run.
5. Izinkan permission bila diminta.
6. Buka Execution log dan copy nilai setelah PARADISE_ADMIN_TOKEN=.
7. Deploy > Manage deployments > Edit > New version > Deploy.
   Gunakan deployment lama agar URL /exec tetap sama.

SETUP LICENSE MANAGER
1. Reload extension License Manager dari chrome://extensions.
2. Buka popup License Manager.
3. Saat diminta, paste Admin Token dari langkah backend.
4. Coba Generate 1 license.
5. Coba Reset, Block, Unblock, Delete pada license test.
6. Klik 🔐 ADMIN kapan saja jika token dirotasi.

CATATAN LAST_CHECK
- LAST_CHECK dibuat otomatis di kolom paling kanan saat activate/validate mencapai backend.
- LAST_LOGIN tetap berarti validasi berhasil.
- LAST_CHECK juga bergerak saat license yang ditemukan ternyata BLOCK / EXPIRED / version mismatch / device mismatch.
- RESET mengosongkan LAST_CHECK.

ROTASI TOKEN
- Jalankan createOrRotateAdminToken() lagi di Apps Script.
- Copy token baru.
- Klik 🔐 ADMIN di License Manager dan masukkan token baru.
- Token lama langsung tidak berlaku untuk aksi admin.

PENTING
- Jangan masukkan Admin Token ke extension yang dijual ke pelanggan.
- Extension pelanggan hanya perlu URL /exec untuk activate/validate.
- URL /exec bukan rahasia; keamanan aksi admin bergantung pada Admin Token.
