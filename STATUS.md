# silat-duel — Status: PROTOTIPE (milestone 2: combo, tepis, animasi halus)

## Apa ini
Game fighting 3D orisinal ala game PS klasik: duel 1 lawan 1 pendekar silat di pelataran padepokan (pendopo joglo, gong, tembok bata + candi bentar, obor, langit sore). Kamera samping 2.5D yang ngikutin dua petarung dan zoom sesuai jarak. Semua karakter, nama, jurus, dan kode buatan sendiri, nggak ada aset atau nama dari game lain. TypeScript + Vite 8 + Three.js, dibungkus **Capacitor 8.5.3** jadi app Android dan iOS (appId `id.morfotech.silatduel`, landscape terkunci, layar penuh).

Dua pendekar, dibangun prosedural dari primitive (badan bersendi + pose keyframe, dikejar per sendi oleh pegas teredam):
- **Jaka** (baju pangsi hitam dengan kerah & manset merah, sabuk merah berekor, kain batik parang, iket dengan ekor, kumis): kuda-kuda rendah, damage ×1,1, jalan lebih pelan. Jurus: **Tapak Harimau** (terjangan dua telapak).
- **Sari** (pangsi biru dengan trim emas, sabuk emas, batik kawung biru, sanggul + pita, anting): lincah, damage ×0,92, jalan lebih cepat. Jurus: **Tendangan Rajawali** (tendangan terbang, lewat di atas serangan bawah).

### Yang baru di milestone 2 (feedback "agak kaku, update asset, bisa combo", lalu "sama bisa parry")
- **Nggak kaku lagi**: tiap sendi ngejar pose target pakai pegas teredam (kaku saat menyerang biar sigap, lentur saat kena biar goyang lalu balik). Serangan punya 4 ketukan: ancang-ancang, tarik, hantam, follow-through (badan terus berputar setelah kena). Idle kembangan silat (berat badan geser kiri-kanan, tangan berputar pelan, lutut napas), langkah kaki beneran saat jalan, ekor sabuk/iket/pita berayun ikut gerakan. Saat kena: korban langsung pose sakit + didorong (impuls pegas) + kilat, kamera goyang tiap hit (lebih keras + zoom sedikit kalau berat), hitstop tetap.
- **Aset lebih bagus (tanpa download)**: proporsi baru (bahu lebar, pinggang ramping), kerah & belahan baju, manset, celana pangsi melebar di pergelangan, kaki telanjang dengan jari, wajah (mata, alis, telinga, mulut), kepalan dengan jempol. Arena: lambang perguruan di lantai, umbul-umbul berkibar, pelita gantung di pendopo, daun kering jatuh, cincin cahaya di hit berat, debu saat dash.
- **Combo**: string baru, cancel ke Jurus, launcher + juggle, damage scaling, buffer input, penghitung "N Hit Kombo! + damage", daftar jurus di menu dan layar jeda. Bot Jago pakai cancel + juggle.
- **Tepis (parry)**: tombol Tepis terpisah (O / tombol abu-abu di HP), menepis serangan atas/tengah yang kena dalam 7 frame setelah dipencet. Lawan terhuyung, kamu bebas 26 frame lebih dulu: cukup buat combo penuh. Kilat emas + cincin + percikan, bunyi "ting", tulisan "Tepis! Balas!", hitstop 10 frame. Bot Jago kadang nepis lalu menghukum.

## Arsitektur (siap online)
- `src/sim/`: seluruh match berupa data JSON + `step(state, [input0, input1])` dengan tick tetap 60 Hz. Tanpa DOM, jam, atau `Math.random` (RNG mulberry32 disimpan di state). Seed dan input sama = match sama persis (ada tesnya, termasuk lewat JSON di tengah match).
- Dua jam: `tick` selalu jalan; `frame` (waktu dunia) berhenti saat hit-stop dan merayap saat slow-motion KO. Frame data dihitung di `frame`, jadi slow-mo dan hit-stop juga deterministik (bisa dipakai server).
- `src/sim/moves.ts`: frame data notasi Tekken (startup = frame aktif pertama, total, hitstun/blockstun, jangkauan, maju, knockdown, rantai kombo).
- `src/bot/`: bot cuma menghasilkan `Input`, sama kayak pemain.
- `src/render/`: Three.js cuma membaca state. `poses.ts` (pose keyframe per aksi/jurus: ancang-ancang, hantam, follow-through), `fighterView.ts` (rig pendekar, pegas per sendi, ekor kain berayun, kilat kena, kaki otomatis napak lantai), `world.ts` (arena), `fx.ts` (percikan, cincin benturan, debu).
- `src/audio.ts`: semua suara sintetis Web Audio.

## Mekanik
- Jalan ← → (A/D), dobel tap maju = **dash**, dobel tap mundur = mundur cepat. ↓ jongkok, ↑ lompat kecil.
- **Tangkis = tahan mundur**. Berdiri menahan serangan atas & tengah; **jongkok + mundur** menahan serangan bawah. Serangan atas lewat di atas yang jongkok; serangan bawah lewat di bawah yang lompat. Diam (nggak nahan mundur) = nggak nangkis.
- Frame data (± = keuntungan frame):

  | Tombol | Jurus | Tinggi | Startup | Kena | Ditangkis |
  |---|---|---|---|---|---|
  | J (Pukul) | Pukul | atas | i10 | +8 | +1 |
  | J, J | Pukul Kedua | atas | i9 | kombo | |
  | J, J, K | Tendangan Melambung | tengah | i13 | **melambung** (juggle) | −9 |
  | J, K | Tendang Sambung | tengah | i12 | kombo | −6 |
  | J, K, ↓+K | Sapuan Sambung | bawah | i14 | jatuh | −16 |
  | K (Tendang) | Tendang | tengah | i14 | +4 | −5 |
  | K, K | Tendangan Putar | atas | i12 | jatuh | −13 |
  | ↓ + J | Pukul Bawah | bawah | i11 | +5 | −1 |
  | ↓ + K | Sapuan | bawah | i16 | jatuh | −14 |
  | U, atau ↓ lalu → + J | Jurus (Tapak Harimau / Tendangan Rajawali) | tengah | i20 / i18 | jatuh | −14 |
  | Pukul/Tendang di udara | Tendang Lompat | tengah | i7 | | |
  | L, atau J + K | Bantingan | lempar | i10 | jatuh, 22 dmg | tembus tangkisan |

- **Kombo**: tiga string yang nyambung kalau hit pertama kena: **Pukul, Pukul, Tendang** (3 hit, lawan melambung), **Pukul, Tendang, ↓+Tendang** (3 hit, sapuan), **Tendang, Tendang** (2 hit, jatuh). Tombol berikutnya boleh dipencet dari frame pertama, keluarnya otomatis di frame yang pas.
- **Cancel ke Jurus**: Pukul/Pukul Kedua/Tendang/Tendang Sambung/Pukul Bawah yang kena atau ditangkis bisa langsung disambung **Jurus**; jurusnya lewati ancang-ancang dan kena 10 frame kemudian, jadi nyambung (mis. Pukul → Jurus = 2 hit). Pencet Jurus agak duluan juga boleh (diingat 12 frame).
- **Launcher + juggle**: Tendangan Melambung melempar lawan ke atas (act `air`, bisa dipukul, nggak bisa nangkis). Tiap hit di udara memantulkan lagi tapi makin lemah (×0,78), jadi juggle pasti selesai; mendarat = jatuh. Contoh: Pukul, Pukul, Tendang → Pukul, Pukul (5 hit) atau → Pukul → Jurus.
- **Damage scaling**: hit ke-n dalam kombo kena 100/90/80/70/62/55/50/45/40 %. Contoh 5 hit di atas (Jaka): 6+6+11+4+4 = 31.
- **Buffer input**: tombol yang dipencet ≤8 frame sebelum pendekar bebas (habis serangan, mendarat, kena, tangkis, dash, bangun) tetap keluar di frame pertama dia bisa gerak. Enak buat sentuh.
- **Counter**: kena saat lagi nyerang (atau saat terhuyung habis ditepis) = damage ×1,25 + hitstun lebih lama (cuma hit pertama, bukan di tengah kombo).
- **Tepis** (O, atau tombol Tepis): jendela 7 frame mulai frame dipencet (termasuk frame itu). Serangan atas/tengah yang kena di jendela itu ditepis: 0 damage, penyerang **terhuyung 32 frame**, yang menepis bebas lagi setelah 6 frame (+26). Pukulan pertama ke lawan yang terhuyung dihitung counter. **Kepagian/telat**: Tepis jadi terbuka sampai frame 26; kalau sambil tahan mundur tetap jadi tangkisan biasa, kalau nggak ya kena. **Nggak bisa ditepis**: serangan bawah (sapuan, pukul bawah) dan bantingan.
- **Bantingan** tembus tangkisan, meleset kalau lawan jongkok/lompat, kalah sama pukulan yang lebih cepat. Dibanting? Pencet **Pukul** (atau Banting) dalam 20 frame = lepas.
- **Jatuh**: kebal di lantai, pencet apa saja buat bangun (paling cepat frame 42), bangun sendiri di frame 84.
- Darah 100, ronde 60 detik, menang 2 ronde = juara. Waktu habis: darah lebih banyak menang (sama = seri, nggak ada poin; maksimal 5 ronde). **KO**: kilat putih, gong, slow-motion ±1,75 detik, kamera mendekat ke yang jatuh, lalu pose hormat/kemenangan.
- **Lawan PC** Mudah / Sedang / Jago: beda telat reaksi (24 / 15 / 9 frame), peluang nangkis, baca serangan bawah, lepas bantingan, menghukum serangan yang minus, dan combo: cancel ke Jurus setelah hit (0 / 25 / 65 %) dan ngejar juggle (10 / 45 / 90 %). Semua string dipakai. Tepis: dari serangan atas/tengah yang dia putuskan ditangkis, sebagian ditepis (0 / 8 / 35 %) dengan timing pas, lalu dibalas Pukul, Pukul, Tendang.
- Kontrol: keyboard (panah/WASD + J Pukul, K Tendang, U Jurus, L Banting, O Tepis, P/Esc jeda, M suara) dan sentuh di HP landscape: joystick mengambang di kiri, tombol Pukul/Tendang/Jurus/Banting di kanan + Tepis (abu-abu, pojok kiri atas tombol), multi-touch. Tap yang lebih pendek dari 1 tick tetap kebaca.
- Suara sintetis (tanpa file): whoosh, pukulan, tangkisan, "ting" tepisan, bantingan/jatuh, gong KO, ambience gamelan slendro pelan (saron + kendang + gong kecil tiap 16 ketukan, lebih rame waktu duel). 🔊 / M = mute. AudioContext nyala di sentuhan/tombol pertama (iOS). Jeda otomatis kalau app/tab ke background.

## Tes
- `npm run verify`: **49 tes** vitest. Tepis nambah 9: tepis tepat waktu (0 damage, penyerang terhuyung), jendela (frame kena masih masuk, kepagian kena), salah timing + tahan mundur = tangkis, keuntungan frame +26 lalu balas P-P-K dengan hit pertama counter, jurus bisa ditepis, bantingan nggak, serangan bawah nggak, Tepis meleset = kena penuh, bot Jago kadang nepis (Mudah nggak pernah). Combo nambah 9: Tendang-Tendang 2 hit, Pukul-Tendang-↓Tendang 3 hit, tanpa ↓ nggak jadi sapuan, cancel Jurus saat kena (2 hit + damage diskala), cancel saat ditangkis tapi nggak saat meleset, juggle ≥5 hit dengan damage diskala tiap hit lalu mendarat, juggle panjang tetap selesai, counter cuma hit pertama, buffer input (≤8 frame keluar, kepagian nggak). Tes milestone 1: (tangkis atas/tengah/bawah, high lewat yang jongkok, low lewat yang lompat, jangkauan, counter, frame advantage pukul/tendang/sapuan, kombo 3 hit, string ditangkis, jurus lewat tombol & gerakan ↓→, Rajawali lewat atas sapuan, dash, badan nggak tembus/arena, bantingan + lepas + telat + meleset + kalah cepat, jatuh/kebal/bangun, KO + slow-mo + ronde baru, waktu habis menang/seri, best of 3, determinisme + JSON, bot vs bot semua tingkat, Jago vs Mudah) + typecheck + build. Lulus 2026-11-06.
- Simulasi 20 match per pasangan bot setelah combo + tepis (2026-11-06): ronde rata-rata 14–29 detik. Sedang vs Sedang 11:9, Jago vs Jago 9:11, Jago vs Sedang 20:0, Jago vs Mudah 20:0. Kombo terpanjang 5–7 hit. Tepis per 20 match: Jago 8–24 (sekitar 1 per match), Sedang 0–1, Mudah 0.
- Browser milestone 2 (keyboard, PC dibikin diam): Tendang-Tendang (12+13), Pukul → cancel Tapak Harimau (6+20), Pukul-Tendang-↓Tendang (6+9+9), Pukul-Pukul-Tendang → Pukul-Pukul di udara = 5 hit 31 damage, HUD "5 Hit Kombo! 31 damage". Layar jeda menampilkan daftar jurus. Tepis lewat **tombol sentuh** (event pointer) pas tendangan Sari: 0 damage, Sari terhuyung, lalu Pukul (counter 7) → Pukul (6) → Tendangan Melambung (11). Screenshot: `screenshots/web-juggle.jpg`, `web-cancel.jpg` (bot Jago cancel ke Rajawali), `web-daftar-jurus.jpg`, `web-tepis.jpg`.
- Browser (preview 844×390 + desktop): menu (latarnya demo PC vs PC), intro hormat, HUD, pose semua jurus, percikan counter, jatuh/bangun, KO + slow-mo + banner, layar hasil "Kamu menang! 2 – 1", jeda. Keyboard dan sentuh (joystick ditahan + tap Pukul bareng) dicek lewat event; AudioContext jalan.
- **Android** (emulator Mogi_Phone, 2026-11-06): APK debug ter-install dan jalan landscape layar penuh, menu → duel → kombo PC 3 hit → KO → banner. Screenshot: `screenshots/android-menu.jpg`, `android-intro.jpg`, `android-duel.jpg`, `android-round.jpg`. Build milestone 2 juga di-install dan jalan: arena baru, PC Sedang mendaratkan "4 Hit Kombo! 26 damage" (`android-combo.jpg`). Build dengan Tepis juga jalan, tombol Tepis tampil (`android-tepis-button.jpg`).
- **iOS** (Simulator iPhone 17, iOS 26.2, 2026-11-06): build xcodebuild tanpa signing, app jalan landscape, status bar hilang, HUD aman dari Dynamic Island, joystick sentuh menggerakkan Jaka, tombol Jurus memicu Tapak Harimau (dan kena counter pukul bawah PC). Screenshot: `screenshots/ios-menu.jpg`, `ios-duel.jpg`, `ios-touch.jpg`, `ios-jurus.jpg`. Build milestone 2 juga jalan di simulator (`ios-combo.jpg`, Jaka terlempar kena Sari), termasuk build dengan Tepis (`ios-tepis-button.jpg`).

## Build & jalanin
Web:
```bash
npm install
npm run dev        # atau lewat preview "silat-duel-dev" (port 5186)
npm run verify     # tes + typecheck + build
```
`?touch` di URL memaksa tombol sentuh tampil di desktop.

Capacitor CLI 8 butuh **Node 22+** (default mesin ini 20, Node 24 ada di nvm). `npm run cap:sync` = build + `npx cap sync` pakai Node 24.

Android (JDK 21 dari Android Studio, SDK di `~/Library/Android/sdk`):
```bash
npm run cap:sync
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleDebug
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
~/Library/Android/sdk/platform-tools/adb shell am start -n id.morfotech.silatduel/.MainActivity
```

iOS (simulator, tanpa akun Apple):
```bash
npm run cap:sync
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted id.morfotech.silatduel
```
Atau buka `ios/App/App.xcodeproj` di Xcode. Native yang diubah dari template: `AndroidManifest.xml` (`sensorLandscape`), `MainActivity.java` (layar tetap nyala), `Info.plist` (cuma landscape, full screen, status bar hilang), `AppDelegate.swift` (layar tetap nyala). Bar sistem disembunyikan lewat `SystemBars.hidden` di `capacitor.config.ts`.

## Berikutnya
1. Main online: sim sudah deterministik dan JSON, tinggal pola server-authoritative seperti layangan-duel (mirror untuk slot 1)
2. Model 3D ber-rig (mis. paket CC0 Quaternius/Kenney) kalau kamu oke download aset: perlu izin + pemetaan pose ke tulang modelnya. Sekarang tetap prosedural
3. Lebih banyak jurus per pendekar (tepis bawah buat sapuan, sapuan berputar, jurus kedua), wall combo, pendekar ketiga
4. Mode latihan (lawan diam/nangkis terus, tampilan frame data + input yang kebaca)
5. Icon + splash screen sendiri (sekarang masih default Capacitor), lalu build release kalau mau dibagi

## Gap
- Tepis butuh timing ±0,1 detik: belum dicoba pakai jari di HP (tool simulator terlalu lambat buat itu), cuma lewat event di browser. Jendela 7 frame mungkin perlu dilonggarkan setelah kamu coba
- Combo belum pernah dimainkan pakai jari di HP: tool simulator/emulator ngasih jeda ±1–3 detik antar tap, jadi string (jendelanya ±0,4 detik) cuma bisa dicek lewat keyboard/event di browser dan lewat bot di app. Buffer input harusnya bikin sentuh enak, tapi belum dirasakan langsung
- Animasi dinilai dari screenshot dan main di browser, bukan dari rekaman video; rasa "nggak kaku" perlu kamu coba sendiri
- Font "Lilita One"/"Nunito" dari Google Fonts: di app tanpa internet jatuh ke font sistem. Kalau mau offline penuh, font perlu dibundel (perlu izin unduh aset)
- Belum dites di HP fisik sama sekali, juga performa WebGL + bayangan + kain berkibar di HP kelas bawah
- Badan yang dempet sekarang digeser sedikit di kedalaman biar nggak saling tembus, tapi lengan masih bisa tumpang tindih; kena/nggak-nya tetap dari sim
- Di iPhone, saklar silent ikut membisukan Web Audio
- Icon dan splash masih default Capacitor; belum ada build release/signing (sengaja)
