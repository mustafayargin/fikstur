function yilListesiGuncelle(selectId) {
  const list = readAll();
  const years = new Set();

  list.forEach((r) => {
    const d = parseDate(r.tarih);
    if (d) years.add(d.getFullYear());
  });

  const arr = [...years].sort();
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML =
    `<option value="all">Tümü</option>` +
    arr.map((y) => `<option value="${y}">${y}</option>`).join("");

  if (arr.length) select.value = arr[arr.length - 1];
}
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("dark-mode");

  yilListesiGuncelle("yilSec");
  yilListesiGuncelle("ysYearSelect");
  yilListesiGuncelle("nafYearSelect");
  migrateOldAdvanceIncomeOnce();
  initIncomeDrawerYears();
  const splash = document.getElementById("splash");
  const appRoot = document.getElementById("appRoot");

  // Splash animasyonu bittiğinde asıl uygulamayı göster
  setTimeout(() => {
    if (splash) splash.style.display = "none";
    if (appRoot) appRoot.style.display = "block";
  }, 3); // 4000 ms = 2 saniye
});

// === Electron var mı? (tarayıcıda undefined olur) ===
const isElectron =
  typeof window !== "undefined" && typeof window.electronAPI !== "undefined";
// 👉 Uygulama Electron içinde mi yoksa normal tarayıcıda mı çalışıyor onu anlamak için.
const badgeRemainEl = document.getElementById("ysBadgeRemain");
// ===============================
// === SATIR DÜZENLEME MODALI ===
// ===============================
let editModalOverlay = null;

function ensureEditModal() {
  if (editModalOverlay) return;

  editModalOverlay = document.createElement("div");
  editModalOverlay.id = "editModalOverlay";
  editModalOverlay.style.display = "none";
  editModalOverlay.style.position = "fixed";
  editModalOverlay.style.inset = "0";
  editModalOverlay.style.zIndex = "99999";
  editModalOverlay.style.background = "rgba(0,0,0,0.55)";
  editModalOverlay.style.backdropFilter = "blur(8px)";
  editModalOverlay.style.alignItems = "center";
  editModalOverlay.style.justifyContent = "center";

  editModalOverlay.innerHTML = `
    <div class="edit-modal-box" style="
      width: min(720px, 92vw);
      background: rgba(255,255,255,0.92);
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.35);
      box-shadow: 0 20px 50px rgba(0,0,0,0.35);
      overflow:hidden;
    ">
      <div class="edit-modal-head" style="
        display:flex; align-items:center; justify-content:space-between;
        padding:16px 18px;
        background: rgba(30,60,114,0.85);
        color:#fff;
      ">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <strong style="font-size:16px;">Kayıt Düzenle</strong>
          <span id="emFtrNo" style="font-size:12px; opacity:.9;"></span>
        </div>
        <button id="emClose" style="
          border:none; background:transparent; color:#fff;
          font-size:20px; cursor:pointer; line-height:1;
        ">✕</button>
      </div>

      <div style="padding:16px 18px; display:grid; gap:12px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:700; opacity:.8;">Tarih</label>
            <input id="emDate" type="date" style="width:100%; padding:10px; border-radius:10px; border:1px solid #d0d7e2;">
          </div>
          <div>
            <label style="font-size:12px; font-weight:700; opacity:.8;">Avans</label>
            <select id="emAvans" style="width:100%; padding:10px; border-radius:10px; border:1px solid #d0d7e2;">
              <option value="AVANS 1">AVANS 1</option>
              <option value="AVANS 2">AVANS 2</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-size:12px; font-weight:700; opacity:.8;">Masraf Türü</label>
          <input id="emMasraf" type="text" style="width:100%; padding:10px; border-radius:10px; border:1px solid #d0d7e2;">
        </div>

        <div>
          <label style="font-size:12px; font-weight:700; opacity:.8;">Açıklama</label>
          <input id="emAciklama" type="text" style="width:100%; padding:10px; border-radius:10px; border:1px solid #d0d7e2;">
        </div>

        <div>
          <label style="font-size:12px; font-weight:700; opacity:.8;">Tutar</label>
          <input id="emTutar" type="number" step="0.01" style="width:100%; padding:10px; border-radius:10px; border:1px solid #d0d7e2;">
        </div>

        <div style="display:flex; gap:10px; justify-content:flex-end; padding-top:4px;">
          <button id="emCancel" style="
            padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1;
            background:#fff; cursor:pointer; font-weight:700;
          ">İptal</button>
          <button id="emSave" style="
            padding:10px 14px; border-radius:10px; border:none;
            background: linear-gradient(135deg,#43a047,#66bb6a);
            color:#fff; cursor:pointer; font-weight:800;
          ">Kaydet</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(editModalOverlay);

  // kapatma
  const close = () => (editModalOverlay.style.display = "none");
  editModalOverlay.querySelector("#emClose").addEventListener("click", close);
  editModalOverlay.querySelector("#emCancel").addEventListener("click", close);
  editModalOverlay.addEventListener("click", (e) => {
    if (e.target === editModalOverlay) close();
  });
}

function openEditModal(rec) {
  ensureEditModal();

  // modal alanları
  const emFtrNo = editModalOverlay.querySelector("#emFtrNo");
  const emDate = editModalOverlay.querySelector("#emDate");
  const emAvans = editModalOverlay.querySelector("#emAvans");
  const emMasraf = editModalOverlay.querySelector("#emMasraf");
  const emAciklama = editModalOverlay.querySelector("#emAciklama");
  const emTutar = editModalOverlay.querySelector("#emTutar");

  // doldur
  emFtrNo.textContent = "FTR" + String(rec.faturaNo).padStart(5, "0");

  const d = parseDate(rec.tarih);
  if (d) {
    emDate.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } else {
    emDate.value = "";
  }

  emAvans.value = (rec.avans || "AVANS 1").toUpperCase();
  emMasraf.value = rec.masraf || "";
  emAciklama.value = rec.aciklama || "";
  emTutar.value = Number(rec.tutar || 0);

  // kaydet
  editModalOverlay.querySelector("#emSave").onclick = () => {
    // doğrula
    if (!parseDate(emDate.value)) return showToast("Tarih geçersiz.", "error");
    if (!String(emMasraf.value).trim())
      return showToast("Masraf türü boş.", "error");
    const tut = Number(String(emTutar.value).replace(",", "."));
    if (isNaN(tut)) return showToast("Tutar geçersiz.", "error");

    // listede güncelle
    const all = readAll();
    const idx = all.findIndex((r) => r.faturaNo === rec.faturaNo);
    if (idx === -1) return showToast("Kayıt bulunamadı.", "error");

    all[idx] = {
      ...all[idx],
      avans: String(emAvans.value || "AVANS 1").toUpperCase(),
      tarih: fmtTarih(emDate.value),
      masraf: String(emMasraf.value).trim(),
      aciklama: String(emAciklama.value).trim(),
      tutar: tut,
    };

    writeAll(all);
    autoBackup();

    // UI yenile
    renderTable();
    refreshStats();
    updateNextFaturaNoUI();

    // disk kaydı (Electron)
    if (isElectron && window.electronAPI?.saveData) {
      window.electronAPI
        .saveData(readAll())
        .catch((err) => console.error("Disk yazma hatası:", err));
    }

    showToast("Kayıt güncellendi", "success");
    editModalOverlay.style.display = "none";
  };

  editModalOverlay.style.display = "flex";
}

// --- Türkçe büyük harf dönüştürücü ---
function toUpperTurkish(str) {
  return str
    .replace(/i/g, "İ") // 👉 Türkçe karakterleri doğru büyüten özel fonksiyon
    .replace(/ı/g, "I")
    .replace(/ğ/g, "Ğ")
    .replace(/ü/g, "Ü")
    .replace(/ş/g, "Ş")
    .replace(/ö/g, "Ö")
    .replace(/ç/g, "Ç")
    .toUpperCase();
}

// === Kısa yardımcılar ===
const q = (s) => document.querySelector(s); // 👉 Tek element seçmek için kısayol
const qa = (s) => document.querySelectorAll(s); // 👉 Birden fazla elementi seçmek için

const getYear = (t) => {
  // 👉 Tarihten yılı alan fonksiyon
  const d = parseDate(t);
  return d ? d.getFullYear() : null;
};

const ayAdi = (t) => {
  // 👉 Tarihten ay adını alan fonksiyon
  const d = parseDate(t);
  return d ? AY[d.getMonth()] : null;
};

// Türkçe uppercase (alternatif)
function toUpperTR(text) {
  return text.replace(/i/g, "İ").replace(/ı/g, "I").toLocaleUpperCase("tr-TR");
}

// === Ay dizisi ===
const AY = [
  "OCAK",
  "ŞUBAT",
  "MART",
  "NİSAN",
  "MAYIS",
  "HAZİRAN",
  "TEMMUZ",
  "AĞUSTOS",
  "EYLÜL",
  "EKİM",
  "KASIM",
  "ARALIK",
];
// === Seçili yıl (2023–2039 arası, varsayılan mevcut yıl) ===
let seciliYil = Math.max(2023, Math.min(2039, new Date().getFullYear()));

// 📊 Başlangıç avansı + aylık gelir/gider/kasa hesaplama
function ysMonthCardRows(m, activeType) {
  if (activeType === "AVANS_KASASI") {
    return `
      <div class="ys-break-mini"><span>Avans 1</span><b>${ysMoney(m.avans1)}</b></div>
      <div class="ys-break-mini"><span>Avans 2</span><b>${ysMoney(m.avans2)}</b></div>
    `;
  }
  if (activeType === "ARAÇ AVANS") {
    return `<div class="ys-break-mini"><span>Araç Avans</span><b>${ysMoney(m.arac)}</b></div>`;
  }
  if (activeType === "AVANS HARİCİ") {
    return `<div class="ys-break-mini"><span>Avans Harici</span><b>${ysMoney(m.harici)}</b></div>`;
  }
  return `
    <div class="ys-break-mini"><span>Avans 1</span><b>${ysMoney(m.avans1)}</b></div>
    <div class="ys-break-mini"><span>Avans 2</span><b>${ysMoney(m.avans2)}</b></div>
    <div class="ys-break-mini"><span>Araç</span><b>${ysMoney(m.arac)}</b></div>
    <div class="ys-break-mini"><span>Harici</span><b>${ysMoney(m.harici)}</b></div>
  `;
}

function calcYearSummary(targetYear) {
  const yearSelect = document.getElementById("ysYearSelect");
  const grid = document.getElementById("ysMonthGrid");
  const totalIncEl = document.getElementById("ysTotalIncome");
  const totalExpEl = document.getElementById("ysTotalExpense");
  const totalCashEl = document.getElementById("ysTotalCash");
  const badgeIncEl = document.getElementById("ysBadgeIncome");
  const badgeExpEl = document.getElementById("ysBadgeExpense");

  if (!grid || !yearSelect) return;

  let year = targetYear || yearSelect.value;

  // --- TÜM YILLAR seçiliyse özel toplama modu ---
  const allRecords = readAll();

  if (year === "all") {
    // bütün yılların verisini topla
    const all = allRecords.filter(
      (r) => r.avans === "AVANS 1" || r.avans === "AVANS 2",
    );

    // tek tek yıl yerine direkt genel toplam hesapla
    const totalIncome = all.reduce((s, r) => s + 0, 0); // gelir mantığı yıl bazlı olduğundan 0
    const totalExpense = all.reduce((s, r) => s + (+r.tutar || 0), 0);

    if (totalIncEl) totalIncEl.textContent = "—";
    if (totalCashEl) totalCashEl.textContent = "—";
    if (totalExpEl)
      totalExpEl.textContent = totalExpense.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
      });

    if (badgeExpEl)
      badgeExpEl.textContent =
        totalExpense.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) +
        " ₺";

    // ay kutularını boşalt
    grid.innerHTML =
      "<div style='padding:20px'>Tüm yıllar için detay ay bazında hesaplanmaz.</div>";
    return;
  }

  year = Number(year);

  // Seçili yılı select'e yaz
  yearSelect.value = year;

  // Bu yıla ait, sadece AVANS 1 ve AVANS 2 kayıtlarını çek
  const all = readAll().filter(
    (r) =>
      getYear(r.tarih) === year &&
      (r.avans === "AVANS 1" || r.avans === "AVANS 2"),
  );
  // 12 ay için temel yapı
  const months = AY.map((ad, index) => ({
    ad,
    index,
    gider: 0,
    gelir: 0,
    kasaBas: 0,
    kasaSonu: 0,
  }));

  // Gider: bu sistemde faturalardaki tutarları gider sayıyoruz (pozitif tutar)
  all.forEach((r) => {
    const d = parseDate(r.tarih);
    if (!d) return;
    const m = d.getMonth(); // 0 = Ocak
    const t = Number(r.tutar) || 0;
    if (t > 0) {
      months[m].gider += t;
    }
  });

  // Başlangıç avansını çek (Ocak için, eski sistem)
  const advMap = getYearAdvances();
  const baslangic = Number(advMap[year] || 0);

  // Ay bazlı ek avansları çek (yeni sistem)
  const monthAdvAll = getMonthAdvancesAll();
  const monthAdvYear = monthAdvAll[year] || {}; // { "0": 1000, "5": 2500, ... }

  // Aylık gelir + kasa
  months.forEach((m, i) => {
    if (i === 0) {
      // Ocak: eski başlangıç avansın
      m.gelir = baslangic;
      m.kasaBas = baslangic;
    } else {
      // Sonraki ay: geliri bir önceki ay gideri kadar
      m.gelir = months[i - 1].gider;
      // Kasa başlangıcı: önceki ayın kasa sonu + bu ay geliri
      m.kasaBas = months[i - 1].kasaSonu + m.gelir;
    }

    // 🔹 Seçilen aya ek avans ekle (varsa)
    const ek = Number(monthAdvYear[i] || 0);
    if (!isNaN(ek) && ek !== 0) {
      m.gelir += ek; // Bu ayın gelirine ekle
      m.kasaBas += ek; // Kasaya da aynı tutarı ekle
    }

    // Kasa sonu = kasa başı - bu ay gider
    m.kasaSonu = m.kasaBas - m.gider;
  });

  // Toplamlar
  const totalGelir = months.reduce((s, m) => s + m.gelir, 0);
  const totalGider = months.reduce((s, m) => s + m.gider, 0);
  const yilSonuKasa = totalGelir - totalGider;
  const ocakGider = months[0].gider;

  // Ekrana bas
  grid.innerHTML = "";
  months.forEach((m) => {
    const box = document.createElement("div");
    box.className = "ys-item";
    // Bu aya ait ek avans var mı? (0 veya boşsa yok kabul ediyoruz)
    let hasManualAdv = false;
    if (
      monthAdvYear &&
      Object.prototype.hasOwnProperty.call(monthAdvYear, m.index)
    ) {
      const ekVal = Number(monthAdvYear[m.index] || 0);
      if (!isNaN(ekVal) && ekVal !== 0) {
        hasManualAdv = true;
      }
    }

    // Sınıfı buna göre ver
    box.className = "ys-item" + (hasManualAdv ? " manual-adv" : "");
    // Boş ay → sadece ay adı
    if (m.gelir === 0 && m.gider === 0) {
      box.innerHTML = `
        <div class="ys-month" style="text-align:center; margin:12px 0; font-size:16px;">
          ${m.ad}
        </div>
      `;
    } else {
      // Dolu ay → gelir / gider / kasa
      box.innerHTML = `
        <div class="ys-month">${m.ad}</div>
        <div class="ys-row ys-gelir">
          <span>Gelir</span>
          <span>${m.gelir.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</span>
        </div>
        <div class="ys-row ys-gider">
          <span>Gider</span>
          <span>${m.gider.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</span>
        </div>
        <div class="ys-row ys-kasa">
          <span>Kalan Kasa</span>
          <span>${m.kasaSonu.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</span>
        </div>
      `;
    }

    // Ay balonuna tıklayınca detay popup
    box.addEventListener("click", () => {
      showMonthDetail(year, m.index, m, all);
    });

    grid.appendChild(box);
  });

  const fmt = (v) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2 });

  if (totalIncEl) totalIncEl.textContent = fmt(totalGelir);
  if (totalExpEl) totalExpEl.textContent = fmt(totalGider);
  if (totalCashEl) totalCashEl.textContent = fmt(yilSonuKasa);
  if (badgeIncEl) badgeIncEl.textContent = fmt(totalGelir) + " ₺";
  if (badgeExpEl) badgeExpEl.textContent = fmt(totalGider) + " ₺";
  if (badgeRemainEl) badgeRemainEl.textContent = fmt(yilSonuKasa) + " ₺";
}
// === Tarih parse fonksiyonu ===
const parseDate = (s) => {
  if (s instanceof Date) return !isNaN(s) ? s : null; // 👉 Eğer direkt Date ise

  if (!s) return null; // 👉 Boş değer gelirse

  if (typeof s !== "string") s = String(s); // 👉 Sayı vs gelirse stringe çevir

  // 01.02.2025 formatı
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`);

  // 2025-02-01 formatı
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s);

  // Son çare: Date parse
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

// Tarihi string formatlama
const fmtTarih = (t) => {
  const d = parseDate(t);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

// Belirli yıl + ay için sağ panel detay görünümü
function showMonthDetail(year, monthIndex, monthInfo, allRecords) {
  ysSelectedMonth = monthIndex;

  const titleEl = document.getElementById("ysDetailTitle");
  const subEl = document.getElementById("ysDetailSub");
  const summaryEl = document.getElementById("ysDetailSummary");
  const tbody = document.getElementById("ysMonthDetailTbody");
  if (!titleEl || !summaryEl || !tbody) return;

  const manualIncome = Number(monthInfo.manualIncome || 0);
  const autoIncome = Number(monthInfo.autoIncome || 0);
  const totalIncome = Number(monthInfo.gelir || 0);
  const totalExpense = Number(monthInfo.gider || 0);
  const cash = Number(monthInfo.kasaSonu || 0);

  titleEl.textContent = `${AY[monthIndex]} ${year} – Ay Detayı`;
  if (subEl) subEl.textContent = "Pencere açmadan, seçtiğin ayın kayıtları burada gösterilir";

  const balanceLabel = ysBalanceLabel(ysActiveType, cash);
  const balanceClass = ysBalanceClass(ysActiveType, cash);
  const firstIncomeLabel = ysIsMonthlyClosingType(ysActiveType) ? "Şirketin Yatırdığı" : "Manuel / Ek Yatan";
  const autoBlock = ysIsMonthlyClosingType(ysActiveType)
    ? `<div class="ys-detail-kpi"><span>Otomatik Devir</span><b>Yok</b></div>`
    : `<div class="ys-detail-kpi"><span>Önceki Aydan Otomatik</span><b>${ysMoney(autoIncome)}</b></div>`;

  summaryEl.innerHTML = `
    <div class="ys-detail-kpi"><span>${firstIncomeLabel}</span><b>${ysMoney(manualIncome)}</b></div>
    ${autoBlock}
    <div class="ys-detail-kpi"><span>Toplam Gelir</span><b>${ysMoney(totalIncome)}</b></div>
    <div class="ys-detail-kpi danger"><span>Bu Ay Harcama</span><b>${ysMoney(totalExpense)}</b></div>
    <div class="ys-detail-kpi ${balanceClass}"><span>${balanceLabel}</span><b>${ysMoney(cash)}</b></div>
  `;

  const list = (allRecords || [])
    .filter((r) => ysMonthIndex(r) === monthIndex)
    .sort((a, b) => parseDate(a.tarih) - parseDate(b.tarih));

  const detailCount = document.getElementById("ysDetailCount");
  if (detailCount) detailCount.textContent = `${list.length} kayıt`;

  tbody.innerHTML = list.length ? list.slice(0, 8).map((r) => `
    <tr>
      <td>${fmtTarih(r.tarih)}</td>
      <td><span class="ys-type-chip">${r.type || r.avans || '-'}</span></td>
      <td>${r.masraf || '-'}</td>
      <td>${r.aciklama || '-'}</td>
      <td>${ysMoney(r.tutar)}</td>
    </tr>
  `).join("") : `<tr><td colspan="5" style="text-align:center;opacity:.7;padding:22px;">Bu ayda seçili filtreye ait kayıt yok</td></tr>`;
}

// === LOCALSTORAGE ANAHTARLARI ve GENEL FONKSİYONLAR ===
const LS_KEY = "fatura_kayitlari_v2"; // 👉 Tüm kayıtlar
const LS_NO = "fatura_next_no_v2"; // 👉 Ana fatura sayacı
const LS_YEAR_ADV = "yil_baslangic_avanslari_v1"; // 👉 Yıla göre başlangıç avansı
const LS_MONTH_ADV = "yil_ay_ek_avanslari_v1"; // 👉 Yıl + ay bazlı ek avanslar
const LS_NON_ADV = "avans_harici_faturalar_v1"; // 👉 Avans harici faturalar
const LS_INCOME = "kasa_gelirleri_v2"; // 👉 Kategori bazlı ay/yıl gelirleri

// Ana kayıtlar (mevcut sistem)
const readAll = () => JSON.parse(localStorage.getItem(LS_KEY) || "[]");
const writeAll = (a) => localStorage.setItem(LS_KEY, JSON.stringify(a));
const getNextNo = () => +localStorage.getItem(LS_NO) || 1;
const incNextNo = () => localStorage.setItem(LS_NO, String(getNextNo() + 1));
const autoBackup = () =>
  localStorage.setItem("yedek_veri", JSON.stringify(readAll()));
function getMonthAdvancesAll() {
  try {
    return JSON.parse(localStorage.getItem(LS_MONTH_ADV) || "{}");
  } catch (e) {
    return {};
  }
}

function saveMonthAdvancesAll(obj) {
  localStorage.setItem(LS_MONTH_ADV, JSON.stringify(obj || {}));
}

function getIncomeAll() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_INCOME) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    return {};
  }
}

function saveIncomeAll(obj) {
  localStorage.setItem(LS_INCOME, JSON.stringify(obj || {}));
}

function incomeTypeLabel(type) {
  if (type === "AVANS_KASASI") return "Avans 1 + Avans 2";
  if (type === "ARAC_KASASI") return "Araç Avans";
  if (type === "HARICI_KASASI") return "Avans Harici";
  return type || "-";
}

function getIncomeForMonth(year, monthIndex, type) {
  const data = getIncomeAll();
  const y = data[String(year)] || {};
  const m = y[String(monthIndex)] || {};
  return Number(m[type] || 0);
}

function getIncomeTotalForMonth(year, monthIndex) {
  return getIncomeForMonth(year, monthIndex, "AVANS_KASASI") +
         getIncomeForMonth(year, monthIndex, "ARAC_KASASI") +
         getIncomeForMonth(year, monthIndex, "HARICI_KASASI");
}

function migrateOldAdvanceIncomeOnce() {
  if (localStorage.getItem("kasa_gelirleri_v2_migrated") === "1") return;
  const data = getIncomeAll();
  const monthAdv = getMonthAdvancesAll();
  Object.entries(monthAdv || {}).forEach(([year, months]) => {
    Object.entries(months || {}).forEach(([mi, val]) => {
      const n = Number(val || 0);
      if (!n) return;
      data[year] = data[year] || {};
      data[year][mi] = data[year][mi] || {};
      data[year][mi].AVANS_KASASI = Number(data[year][mi].AVANS_KASASI || 0) + n;
    });
  });
  const yearAdv = getYearAdvances();
  Object.entries(yearAdv || {}).forEach(([year, val]) => {
    const n = Number(val || 0);
    if (!n) return;
    data[year] = data[year] || {};
    data[year]["0"] = data[year]["0"] || {};
    data[year]["0"].AVANS_KASASI = Number(data[year]["0"].AVANS_KASASI || 0) + n;
  });
  saveIncomeAll(data);
  localStorage.setItem("kasa_gelirleri_v2_migrated", "1");
}


// Yıllık başlangıç avansı (mevcut sistem)
function getYearAdvances() {
  try {
    return JSON.parse(localStorage.getItem(LS_YEAR_ADV) || "{}");
  } catch (e) {
    return {};
  }
}

function saveYearAdvances(obj) {
  localStorage.setItem(LS_YEAR_ADV, JSON.stringify(obj));
}

// === AVANS HARİCİ FATURALAR – LİSTE OKU / KAYDET ===

// Avans harici tüm kayıtları oku
function getNonAdvAll() {
  try {
    return JSON.parse(localStorage.getItem(LS_NON_ADV) || "[]");
  } catch (e) {
    return [];
  }
}

// Avans harici tüm kayıtları kaydet
function saveNonAdvAll(list) {
  localStorage.setItem(LS_NON_ADV, JSON.stringify(list || []));
}

// --- Avans harici faturaları diske (JSON) yaz / oku için helper ---
async function syncNonAdvToDisk() {
  try {
    if (isElectron && window.electronAPI?.saveNonAdv) {
      await window.electronAPI.saveNonAdv(getNonAdvAll());
    }
  } catch (err) {
    console.error("NonAdv kaydetme hatası:", err);
  }
}

async function loadNonAdvFromDisk() {
  try {
    if (isElectron && window.electronAPI?.loadNonAdv) {
      const res = await window.electronAPI.loadNonAdv();
      if (res && res.success && Array.isArray(res.data)) {
        saveNonAdvAll(res.data); // LocalStorage’e yaz
      }
    }
  } catch (err) {
    console.error("NonAdv yükleme hatası:", err);
  }
}

// FTR0001, FTR0002 ... şeklinde NUMARA üret
// 🔹 Liste uzunluğuna göre çalışır → kaç kayıt varsa +1
function generateNonAdvInvoiceNo() {
  const list = getNonAdvAll();
  const next = (Array.isArray(list) ? list.length : 0) + 1;
  return "FTR" + String(next).padStart(4, "0");
}

// Silme işleminden sonra numaraları 1,2,3 diye yeniden dizmek için
function reindexNonAdvNumbers() {
  const list = getNonAdvAll();
  if (!Array.isArray(list)) return;

  list.forEach((item, index) => {
    item.invoiceNo = "FTR" + String(index + 1).padStart(4, "0");
  });

  saveNonAdvAll(list);
}

// Avans harici popup açıldığında Fatura No inputunu otomatik doldurmak için
// HTML tarafında input id'si: nafInvoiceNo
function nafPrepareNewInvoiceNo() {
  const input = document.getElementById("nafInvoiceNo");
  if (!input) return;

  input.value = generateNonAdvInvoiceNo(); // Örn: FTR0001
  input.readOnly = true; // Elle değişmesin
}

// --- İlk boş fatura numarasını bulur (ör: ana tabloda 1,2,4 varsa → 3 döner) ---
function getNextFaturaNumber(list) {
  const nums = list
    .map((r) => Number(r.faturaNo))
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  let expected = 1;
  for (const n of nums) {
    if (n !== expected) return expected; // 👉 Eksik numarayı buldu
    expected++;
  }
  return expected;
}

// === Sağ üst köşe toast mesajı ===
function showToast(msg, type = "error", dur = 2000) {
  const el = q("#popup");
  el.textContent = msg; // 👉 Mesaj yaz
  el.style.background =
    type === "success"
      ? "linear-gradient(135deg,#46a758,#66bb6a)"
      : "linear-gradient(135deg,#f44336,#ff6f61)";

  el.classList.add("show"); // 👉 Göster
  setTimeout(() => el.classList.remove("show"), dur);
}

// === Orta ekran toast (daha modern) ===
function showCenterToast(msg, type = "success", dur = 1500) {
  const t = document.createElement("div");
  Object.assign(t.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    padding: "16px 30px",
    borderRadius: "10px",
    fontWeight: "bold",
    zIndex: "999999",
    color: "#fff",
    fontSize: "16px",
    background:
      type === "success"
        ? "linear-gradient(135deg,#43a047,#66bb6a)"
        : "linear-gradient(135deg,#e53935,#b71c1c)",
    transition: "opacity .3s,transform .3s",
    opacity: "0",
  });

  t.textContent = msg;
  document.body.appendChild(t);

  setTimeout(() => {
    t.style.opacity = "1";
    t.style.transform = "translate(-50%,-50%) scale(1.05)";
  }, 10);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translate(-50%,-50%) scale(0.9)";
    setTimeout(() => t.remove(), 300);
  }, dur);
}
document.addEventListener("DOMContentLoaded", async () => {
  // 👉 Sayfa tamamen yüklendiğinde tüm uygulamayı başlatan ana blok.

  // --- Electron içindeysek JSON’dan içeri veri yükle ---
  if (
    isElectron &&
    window.electronAPI &&
    typeof window.electronAPI.loadData === "function"
  ) {
    try {
      const res = await window.electronAPI.loadData();
      // 👉 JSON dosyasını oku

      if (res && res.success && Array.isArray(res.data)) {
        // 👉 Eğer veri düzgün geldiyse LocalStorage’e yaz
        localStorage.setItem(LS_KEY, JSON.stringify(res.data));

        // 👉 En büyük fatura numarasını bul, sayaç oradan devam etsin
        const maxNo = res.data.reduce((max, r) => {
          const n = Number(r.faturaNo);
          return isNaN(n) ? max : Math.max(max, n);
        }, 0);

        localStorage.setItem(LS_NO, String(maxNo + 1 || 1));
      }
    } catch (err) {
      console.error("JSON verisi yüklenirken hata:", err);
    }
  }
  // Avans harici faturaları JSON'dan yükle
  await loadNonAdvFromDisk();

  // === Formdaki inputları label adına göre bulan fonksiyon ===
  const findInput = (label) => {
    // 👉 label textine göre input bulabilmek için
    for (const g of qa(".input-group")) {
      const l = g.querySelector("label");
      const i = g.querySelector("input");
      if (l && i && l.textContent.trim().toUpperCase().startsWith(label))
        return i;
    }
    return null;
  };

  // 👉 Form alanlarını seçiyoruz
  const tarihInput = findInput("TARİH");
  const masrafInput = findInput("MASRAF TÜRÜ");
  const aciklamaInput = findInput("AÇIKLAMA");
  const tutarInput = findInput("TOPLAM");

  // --- Türkçe büyük harf dönüştürme alanları ---
  masrafInput.addEventListener("input", () => {
    masrafInput.value = toUpperTR(masrafInput.value);
  });
  aciklamaInput.addEventListener("input", () => {
    aciklamaInput.value = toUpperTR(aciklamaInput.value);
  });

  // === ENTER ile alanlar arası geçiş + Sonunda otomatik kayıt ===
  const inputOrder = [tarihInput, masrafInput, aciklamaInput, tutarInput];

  inputOrder.forEach((input, index) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault(); // 👉 Enter sayfayı yenilemesin

        if (index === inputOrder.length - 1) {
          // 👉 Son inputtaysa → kaydet
          saveRecord();
          tarihInput.focus();
        } else {
          // 👉 Diğer inputa geç
          inputOrder[index + 1].focus();
        }
      }
    });
  });

  // === Butonlar ve UI elementleri ===
  const kaydetIkonu = q(".fa-save");
  const silButonu = q(".fa-trash-alt");
  const searchBtn = q("#searchButton") || q(".fa-search");
  const temizleBtn = q(".fa-redo-alt");
  const themeToggle = q("#themeToggle");
  const themeToggleIcon = themeToggle ? themeToggle.querySelector("i") || themeToggle : null;
  const backupBtn = q("#backupButton");

  const tabloBody = q(".data-table tbody"); // 👉 Tablodaki satırlar
  const faturaNoEl = q("#faturaNo"); // 👉 Ekrandaki fatura no kutusu
  const adetEl = q(".count-value"); // 👉 Fatura adedi
  const toplamEl = q(".total-value"); // 👉 Tutar
  const seciliAvansBilgi = q("#seciliAvansBilgi"); // 👉 Sağ üst seçili avans yazısı
  const dateTextEl = q("#dateText"); // 👉 Üstte AY yazısı
  const ayKutulari = qa(".month-item"); // 👉 Ay butonları
  const avansRadios = qa('input[name="avans"]'); // 👉 Avans seçim butonları

  // === Durum değişkenleri (state) ===
  let currentEditNo = null;
  // 👉 Düzenlenen fatura numarası (null ise yeni kayıt ekleniyor)

  let seciliAy =
    q(".month-item.selected .name")?.textContent?.toUpperCase() || "OCAK";
  // 👉 Hangi ay seçili

  let seciliAvans = (
    q('input[name="avans"]:checked')?.value || "AVANS 1"
  ).toUpperCase();
  // 👉 Seçili yıl (UI ile uyumlu)

  seciliAvansBilgi.textContent = `Seçili Avans: ${seciliAvans}`;
  // 👉 Sağ üst bilgi yazısı

  // === YIL SEÇİMİ ===

  const yilSelect = document.getElementById("yilSec");
  if (yilSelect) {
    yilSelect.value = seciliYil;

    yilSelect.addEventListener("change", () => {
      seciliYil = yilSelect.value;
      renderTable();
      refreshStats();
      updateNextFaturaNoUI();
    });
  }

  // === UI'deki fatura numarasını güncelleyen fonksiyon ===
  const updateNextFaturaNoUI = () => {
    const list = readAll();
    const nextNo = getNextFaturaNumber(list); // 👉 İlk boş numara
    const displayNo = currentEditNo ?? nextNo;
    faturaNoEl.textContent = "FTR" + String(displayNo).padStart(5, "0");
  };

  // === Electron → Verileri açılışta yükle ===
  if (isElectron) {
    window.electronAPI.loadData().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        writeAll(res.data);
        renderTable();
        refreshStats();
        updateNextFaturaNoUI();
        showToast("Veriler dosyadan yüklendi", "success");
      }
    });
  }

  // === AY DEĞİŞTİRME ===
  ayKutulari.forEach((ay) =>
    ay.addEventListener("click", () => {
      ayKutulari.forEach((i) => i.classList.remove("selected"));
      ay.classList.add("selected");

      seciliAy = ay.querySelector(".name")?.textContent.toUpperCase();
      if (dateTextEl) dateTextEl.textContent = seciliAy;

      renderTable();
      refreshStats();
      updateNextFaturaNoUI();
    }),
  );

  // === AVANS DEĞİŞTİRME ===
  avansRadios.forEach((r) =>
    r.addEventListener("change", () => {
      seciliAvans = q('input[name="avans"]:checked').value.toUpperCase();
      seciliAvansBilgi.textContent = `Seçili Avans: ${seciliAvans}`;
      renderTable();
      refreshStats();
    }),
  );

  // === Filtreleme fonksiyonu (YIL + AY + AVANS) ===
  const withFilters = (list) => {
    // 1) Tarihe göre sırala
    list.sort((a, b) => {
      const da = parseDate(a.tarih);
      const db = parseDate(b.tarih);
      return da - db; // 👉 Küçük tarih önce gelir
    });

    // 2) Filtre uygula
    return list.filter(
      (r) =>
        (r.ay || ayAdi(r.tarih)) === seciliAy && // 👉 Ay
        (seciliYil === "all" || getYear(r.tarih) == seciliYil) && // 👉 Yıl
        r.avans === seciliAvans, // 👉 Avans
    );
  };

  // === TABLOYU ÇİZEN FONKSİYON ===
  const renderTable = () => {
    tabloBody.innerHTML = ""; // 👉 Eski satırları temizle

    const filtered = withFilters(readAll()); // 👉 Filtreli kayıtlar

    for (const v of filtered) {
      const tr = document.createElement("tr");
      tr.dataset.faturaNo = v.faturaNo;

      // 👉 Her satırın HTML içeriği
      tr.innerHTML = `
        <td>${v.avans}</td>
        <td>${fmtTarih(v.tarih)}</td>
        <td>${v.masraf}</td>
        <td>${v.aciklama}</td>
        <td class="money-cell">${Number(v.tutar || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</td>
        <td>FTR${String(v.faturaNo).padStart(5, "0")}</td>
        <td class="row-actions">
          <button type="button" class="table-action-btn edit-row-btn" title="Bu satırı düzenle">
            <i class="fas fa-pen"></i>
            <span>Düzenle</span>
          </button>

        </td>
      `;

      // === TEK TIK: satırı seç ve alttaki sil butonunun çalışması için numarayı kaydet
      tr.addEventListener("click", () => {
        document
          .querySelectorAll(".data-table tbody tr")
          .forEach((a) => a.classList.remove("selected-row"));
        tr.classList.add("selected-row");
        currentEditNo = Number(v.faturaNo);
        updateNextFaturaNoUI();
      });

      // === ÇİFT TIK: modal ile düzenle
      tr.addEventListener("dblclick", () => {
        currentEditNo = Number(v.faturaNo);
        openEditModal(v);
      });

      // Satır içindeki Düzenle butonu
      tr.querySelector(".edit-row-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        currentEditNo = Number(v.faturaNo);
        tr.classList.add("selected-row");
        openEditModal(v);
      });

      tabloBody.appendChild(tr);
    }

    enableRowDrag(); // 👉 Sürükle-bırak aktif olsun
  };
  renderTable();
  // ===============================
  // === SATIR DÜZENLEME MODALI  ===
  // ===============================
  let editOverlay = null;

  function ensureEditModal() {
    if (editOverlay) return;

    editOverlay = document.createElement("div");
    editOverlay.id = "editModalOverlay";
    editOverlay.style.display = "none";
    editOverlay.style.position = "fixed";
    editOverlay.style.inset = "0";
    editOverlay.style.zIndex = "99999";
    editOverlay.style.background = "rgba(0,0,0,0.55)";
    editOverlay.style.backdropFilter = "blur(8px)";
    editOverlay.style.alignItems = "center";
    editOverlay.style.justifyContent = "center";

    editOverlay.innerHTML = `
      <div class="edit-modal-box" style="
        width:min(720px,92vw);
        background: rgba(255,255,255,0.96);
        border-radius:18px;
        border:1px solid rgba(255,255,255,0.35);
        box-shadow:0 20px 50px rgba(0,0,0,0.35);
        overflow:hidden;
      ">
        <div style="
          display:flex; align-items:center; justify-content:space-between;
          padding:14px 16px;
          background: linear-gradient(135deg,#1e3c72,#2a5298);
          color:#fff;
        ">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <strong style="font-size:15px;">Kayıt Düzenle</strong>
            <span id="emNo" style="font-size:12px; opacity:.9;"></span>
          </div>
          <button id="emClose" style="border:none;background:transparent;color:#fff;font-size:20px;cursor:pointer;">✕</button>
        </div>
  
        <div style="padding:14px 16px; display:grid; gap:10px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="font-size:12px; font-weight:700; opacity:.75;">Tarih</label>
              <input id="emDate" type="date" style="width:100%;padding:10px;border-radius:10px;border:1px solid #d0d7e2;">
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; opacity:.75;">Avans</label>
              <select id="emAvans" style="width:100%;padding:10px;border-radius:10px;border:1px solid #d0d7e2;">
                <option value="AVANS 1">AVANS 1</option>
                <option value="AVANS 2">AVANS 2</option>
              </select>
            </div>
          </div>
  
          <div>
            <label style="font-size:12px; font-weight:700; opacity:.75;">Masraf</label>
            <input id="emMasraf" type="text" style="width:100%;padding:10px;border-radius:10px;border:1px solid #d0d7e2;">
          </div>
  
          <div>
            <label style="font-size:12px; font-weight:700; opacity:.75;">Açıklama</label>
            <input id="emAciklama" type="text" style="width:100%;padding:10px;border-radius:10px;border:1px solid #d0d7e2;">
          </div>
  
          <div>
            <label style="font-size:12px; font-weight:700; opacity:.75;">Tutar</label>
            <input id="emTutar" type="number" step="0.01" style="width:100%;padding:10px;border-radius:10px;border:1px solid #d0d7e2;">
          </div>
  
          <div style="display:flex; justify-content:flex-end; gap:10px; padding-top:4px;">
            <button id="emCancel" style="padding:10px 14px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-weight:700;">İptal</button>
            <button id="emSave" style="padding:10px 14px;border-radius:10px;border:none;background:linear-gradient(135deg,#43a047,#66bb6a);color:#fff;cursor:pointer;font-weight:800;">Kaydet</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(editOverlay);

    const close = () => (editOverlay.style.display = "none");
    editOverlay.querySelector("#emClose").addEventListener("click", close);
    editOverlay.querySelector("#emCancel").addEventListener("click", close);
    editOverlay.addEventListener("click", (e) => {
      if (e.target === editOverlay) close();
    });
  }

  function openEditModal(rec) {
    ensureEditModal();

    // doldur
    editOverlay.querySelector("#emNo").textContent =
      "FTR" + String(rec.faturaNo).padStart(5, "0");

    const d = parseDate(rec.tarih);
    editOverlay.querySelector("#emDate").value = d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      : "";

    editOverlay.querySelector("#emAvans").value = (
      rec.avans || "AVANS 1"
    ).toUpperCase();
    editOverlay.querySelector("#emMasraf").value = rec.masraf || "";
    editOverlay.querySelector("#emAciklama").value = rec.aciklama || "";
    editOverlay.querySelector("#emTutar").value = Number(rec.tutar || 0);

    // KAYDET
    editOverlay.querySelector("#emSave").onclick = () => {
      const dateVal = editOverlay.querySelector("#emDate").value;
      const avVal = editOverlay.querySelector("#emAvans").value;
      const msVal = editOverlay.querySelector("#emMasraf").value.trim();
      const acVal = editOverlay.querySelector("#emAciklama").value.trim();
      const ttRaw = String(editOverlay.querySelector("#emTutar").value).replace(
        ",",
        ".",
      );
      const ttVal = Number(ttRaw);

      if (!parseDate(dateVal)) return showToast("Tarih geçersiz.", "error");
      if (!msVal) return showToast("Masraf boş.", "error");
      if (isNaN(ttVal)) return showToast("Tutar geçersiz.", "error");

      const all = readAll();
      const i = all.findIndex((r) => r.faturaNo === rec.faturaNo);
      if (i === -1) return showToast("Kayıt bulunamadı.", "error");

      const yeniTarih = fmtTarih(dateVal);

      // 🔥 KRİTİK: senin filtre (r.ay || ayAdi(r.tarih)) kullandığı için
      // drag-drop ile ay set edilmiş kayıtlar tarih değişince kaybolmasın:
      const yeniAy = ayAdi(yeniTarih);

      all[i] = {
        ...all[i],
        avans: String(avVal || "AVANS 1").toUpperCase(),
        tarih: yeniTarih,
        ay: yeniAy,
        masraf: msVal,
        aciklama: acVal,
        tutar: ttVal,
      };

      writeAll(all);
      autoBackup();

      // ✅ Arkadaki listeyi ANLIK güncelle
      renderTable();
      refreshStats();
      updateNextFaturaNoUI();

      if (isElectron && window.electronAPI?.saveData) {
        window.electronAPI
          .saveData(readAll())
          .catch((err) => console.error("Disk yazma hatası:", err));
      }

      showToast("Kayıt güncellendi", "success");
      editOverlay.style.display = "none";
    };

    editOverlay.style.display = "flex";
  }

  // === TEMİZLE / FORM SIFIRLAMA BUTONU ===
  if (temizleBtn) {
    temizleBtn.addEventListener("click", (e) => {
      e.preventDefault();

      // Satır seçimini kaldır
      qa("tr").forEach((tr) => tr.classList.remove("selected-row"));

      // Inputları temizle
      tarihInput.value = "";
      masrafInput.value = "";
      aciklamaInput.value = "";
      tutarInput.value = "";

      // Düzenleme modu kapat
      currentEditNo = null;

      // Tabloları yenile
      renderTable();
      refreshStats();
      updateNextFaturaNoUI();

      showToast("Form ve seçimler sıfırlandı", "success");
    });
  }

  // === ÖZET BİLGİLERİ YENİLEYEN FONKSİYON ===
  const refreshStats = () => {
    const l = withFilters(readAll());
    adetEl.textContent = l.length;

    const toplam = l.reduce((s, r) => s + (r.tutar || 0), 0);
    toplamEl.textContent =
      toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";
  };
  // === FORM DOĞRULAMA ===
  const validate = () => {
    // 👉 Basit ama yeterli doğrulama kuralları
    if (!parseDate(tarihInput.value))
      return { ok: false, msg: "Tarih geçersiz." };

    if (!masrafInput.value.trim())
      return { ok: false, msg: "Masraf türü boş." };

    if (isNaN(parseFloat(tutarInput.value)))
      return { ok: false, msg: "Tutar geçersiz." };

    return { ok: true };
  };
  refreshStats();
  updateNextFaturaNoUI();

  // === FORMU KAYIT OBJESİNE DÖNÜŞTÜR ===
  const toRec = () => ({
    faturaNo: currentEditNo ?? null, // 👉 Düzenlemede no sabit olur, yenide null
    avans: seciliAvans, // 👉 Avans grubu
    tarih: fmtTarih(tarihInput.value), // 👉 Tarih formatla
    masraf: masrafInput.value.trim(), // 👉 Masraf türü
    aciklama: aciklamaInput.value.trim(), // 👉 Açıklama
    tutar: +tutarInput.value || 0, // 👉 Tutar (sayı)
  });

  // === FORM TEMİZLEYİCİ ===
  const clearForm = () => {
    tarihInput.value = "";
    masrafInput.value = "";
    aciklamaInput.value = "";
    tutarInput.value = "";
    currentEditNo = null; // 👉 Düzenleme modu kapat
    updateNextFaturaNoUI(); // 👉 Bir sonraki no göster
  };

  // ==========================================================
  // === KAYDETME / GÜNCELLEME İŞLEMİ ===
  // ==========================================================
  function saveRecord() {
    const v = validate();
    if (!v.ok) return showToast(v.msg, "error"); // 👉 Hata varsa işlem durur

    let all = readAll(); // 👉 Tüm mevcut kayıtlar
    let rec = toRec(); // 👉 Formdaki değerlerden objeyi oluştur

    if (currentEditNo) {
      // === GÜNCELLEME MODU ===
      const i = all.findIndex((r) => r.faturaNo === currentEditNo);
      if (i > -1) all[i] = rec; // 👉 Kayıtı değiştir
      showToast("Kayıt güncellendi", "success");
    } else {
      // === YENİ KAYIT MODU ===
      const nextNo = getNextFaturaNumber(all); // 👉 İlk boş numarayı bul
      rec.faturaNo = nextNo; // 👉 Faturaya numarayı ata
      all.push(rec); // 👉 Kaydı ekle
      incNextNo(); // 👉 Sayaç yine de +1
      showToast("Kayıt eklendi", "success");
    }

    writeAll(all); // 👉 LocalStorage’e yaz
    autoBackup(); // 👉 Otomatik yedek
    renderTable(); // 👉 Tabloyu yenile
    refreshStats(); // 👉 Adet + toplam güncelle
    clearForm(); // 👉 Formu sıfırla

    // === JSON dosyasına otomatik kayıt (Electron) ===
    if (isElectron && window.electronAPI?.saveData) {
      window.electronAPI
        .saveData(readAll())
        .catch((err) => console.error("Otomatik kayıt hatası:", err));
    }

    // Windows tarafında veri yazma (tekrar güvence)
    if (isElectron) {
      window.electronAPI.saveData(readAll()).then((res) => {
        if (!res.success) console.error("Disk yazma hatası:", res.error);
      });
    }
  }
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      saveRecord(); // Enter’ın yaptığı işlemin aynısı
    });
  }

  // ==========================================================
  // === KAYIT SİLME ===
  // ==========================================================
  const deleteRecord = (no) => {
    const all = readAll();
    const filtered = all.filter((r) => r.faturaNo !== no); // 👉 Silinecek kaydı listeden çıkar
    writeAll(filtered);
    autoBackup();

    // 👉 Eğer silinen numara en büyük numara ise sayaç bir geri alınır
    const lastNo = getNextNo() - 1;
    if (no === lastNo && lastNo > 1) {
      localStorage.setItem(LS_NO, String(lastNo));
    }

    renderTable();
    refreshStats();
    clearForm();
    updateNextFaturaNoUI();
    showToast("Kayıt silindi", "success");

    // === Electron JSON güncelleme ===
    if (isElectron && window.electronAPI?.saveData) {
      window.electronAPI
        .saveData(readAll())
        .catch((err) =>
          console.error("Silme sonrası otomatik kayıt hatası:", err),
        );
    }

    // Güvenlik için ikinci kez yazma
    if (isElectron && window.electronAPI?.saveData) {
      window.electronAPI
        .saveData(readAll())
        .then((res) => {
          if (!res.success)
            console.error("Silme sonrası diske yazma hatası:", res.error);
        })
        .catch((err) => console.error("Silme sonrası hata:", err));
    }
  };

  // ==========================================================
  // === SİL BUTONU POPUP KUTUSU ===
  // ==========================================================
  silButonu.addEventListener("click", (e) => {
    e.preventDefault();

    if (!currentEditNo) return showToast("Silmek için önce tablodan bir satır seç", "error");

    // Önceki popup varsa temizle
    document.querySelector(".confirm-popup")?.remove();

    const p = document.createElement("div");
    p.className = "confirm-popup";

    p.innerHTML = `
      <h3>Bu kaydı silmek istiyor musun?</h3>
      <div class="buttons">
          <button class="yes-btn">Evet, Sil</button>
          <button class="no-btn">İptal</button>
      </div>
    `;

    document.body.appendChild(p);
    setTimeout(() => p.classList.add("show"), 10); // 👉 Açılma animasyonu

    // Evet → sil
    p.querySelector(".yes-btn").onclick = () => {
      deleteRecord(currentEditNo);
      p.remove();
      showCenterToast("Kayıt silindi ✔", "success");
    };

    // İptal → kapat
    p.querySelector(".no-btn").onclick = () => {
      p.remove();
      showCenterToast("Silme iptal edildi", "error");
    };
  });

  // ==========================================================
  // === ARAMA MODALINI AÇAN BUTON ===
  // ==========================================================
  // Search ikonuna tıklayınca gelişmiş arama modalı açılır
  // ==========================================================
  // === GELİŞMİŞ ARAMA MODALI (MODAL YAPI) ===
  // ==========================================================
  if (searchBtn) {
    // Eğer modal HTML daha önce eklenmediyse → oluştur
    let modalOverlay = document.querySelector(".advanced-modal-overlay");

    if (!modalOverlay) {
      modalOverlay = document.createElement("div");
      modalOverlay.className = "advanced-modal-overlay";

      // 👉 Modalın HTML yapısını JS ile oluşturuyoruz
      modalOverlay.innerHTML = `
        <div class="advanced-modal">

            <!-- === ÜST BAR (YIL + ÖZET + KAPAT) === -->
            <div class="am-header">

                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:30px; opacity:0.9;">RAPOR YILI</span>
                    <select id="amYearSelect" class="am-year-select"></select>
                </div>

                <!-- Özet kutuları -->
                <div class="am-summary">
                    <div class="am-badge">
                        <span>TOPLAM FATURA</span>
                        <strong id="amTotalCount">0</strong>
                    </div>
                    <div class="am-badge" style="background:rgba(206, 42, 42, 0.25);">
                        <span>TOPLAM TUTAR</span>
                        <strong id="amTotalAmount">0.00 ₺</strong>
                    </div>
                </div>

                <!-- Kapat ikon -->
                <i class="fas fa-times am-close" id="amCloseBtn"></i>
            </div>


            <!-- === ARAMA ÇUBUĞU === -->
            <div class="am-search-bar">
                <i class="fas fa-search am-search-icon"></i>
                <input type="text" id="amSearchInput" placeholder="Masraf, açıklama veya ay adı ara... (Türkçe destekli)">
            </div>


            <!-- === ANA İÇERİK (Dashboard veya SplitView) === -->
            <div class="am-body">

                <!-- Yıllık genel görünüm -->
                <div id="amDashboard" class="am-dashboard"></div>

                <!-- Arama aktifken açılan iki panel -->
                <div id="amSplitView" class="am-split-view">
                    <div class="am-sidebar" id="amSidebar"></div>

                    <div class="am-table-wrapper">
                        <div class="am-table-scroll">
                            <table class="am-table">
                                <thead>
                                    <tr>
                                        <th>Ay</th>
                                        <th>Tarih</th>
                                        <th>Masraf</th>
                                        <th>Açıklama</th>
                                        <th>Tutar</th>
                                        <th>FTR No</th>
                                    </tr>
                                </thead>
                                <tbody id="amTableBody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
        </div>
        `;

      document.body.appendChild(modalOverlay); // 👉 Modalı ekrana ekle
    }

    // Modaldaki elementlerin seçimi
    const amOverlay = q(".advanced-modal-overlay");
    const amYearSelect = q("#amYearSelect");
    const amTotalCount = q("#amTotalCount");
    const amTotalAmount = q("#amTotalAmount");
    const amCloseBtn = q("#amCloseBtn");
    const amSearchInput = q("#amSearchInput");
    const amDashboard = q("#amDashboard");
    const amSplitView = q("#amSplitView");
    const amSidebar = q("#amSidebar");
    const amTableBody = q("#amTableBody");

    // === Yılları doldurma (en fazla 4 yıl göster)
    yilListesiGuncelle("amYearSelect");

    // === Belirli yılın bütün kayıtlarını döndürür ===
    const getYearData = (year) => {
      const all = readAll();
      if (year === "all") return all;
      return all.filter((r) => getYear(r.tarih) == year);
    };

    // ======================================================
    // === DASHBOARD (Yıllık 12 ayın özet kutucukları) ===
    // ======================================================
    const renderDashboard = () => {
      const year = amYearSelect.value;
      const data = getYearData(year);

      // Toplam yıl özet
      const totalSum = data.reduce((a, b) => a + (b.tutar || 0), 0);
      amTotalAmount.textContent =
        totalSum.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";
      amTotalCount.textContent = data.length;

      // Ay ay dağılım
      const ayMap = {};
      AY.forEach((a) => (ayMap[a] = { count: 0, sum: 0 }));

      data.forEach((r) => {
        const ayIsim = r.ay || ayAdi(r.tarih);
        if (ayIsim) {
          ayMap[ayIsim].count++;
          ayMap[ayIsim].sum += r.tutar || 0;
        }
      });

      // Kartları çiz
      amDashboard.innerHTML = "";
      AY.forEach((ay) => {
        const info = ayMap[ay];
        const card = document.createElement("div");

        card.className = `am-month-card ${info.count === 0 ? "empty" : ""}`;

        card.innerHTML = `
                <h4>${ay}</h4>
                <div class="am-month-data">
                    <div class="am-val">${info.sum.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</div>
                    <div class="am-count">${info.count} Adet</div>
                </div>
            `;

        amDashboard.appendChild(card);
      });
    };

    // ======================================================
    // === ARAMA (SplitView) ===
    // ======================================================
    const handleSearch = () => {
      const query = toUpperTurkish(amSearchInput.value.trim());
      const year = amYearSelect.value;
      const data = getYearData(year);

      // === BOŞ ARAMA → Dashboard moduna dön ===
      if (!query) {
        amDashboard.style.display = "grid";
        amSplitView.style.display = "none";
        return;
      }

      // === Arama → SplitView aç ===
      amDashboard.style.display = "none";
      amSplitView.style.display = "flex";

      // === Filtrele ===
      const results = data.filter(
        (r) =>
          (r.masraf && toUpperTurkish(r.masraf).includes(query)) ||
          (r.aciklama && toUpperTurkish(r.aciklama).includes(query)) ||
          (ayAdi(r.tarih) && ayAdi(r.tarih).includes(query)),
      );

      // === HEADER ÖZET GÜNCELLE ===
      amTotalCount.textContent = results.length;
      amTotalAmount.textContent =
        results
          .reduce((a, b) => a + (b.tutar || 0), 0)
          .toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";

      // === SOL TARAFTAKİ AY KUTULARI ===
      const foundMonths = [...new Set(results.map((r) => ayAdi(r.tarih)))];

      amSidebar.innerHTML = "";

      if (foundMonths.length === 0) {
        amSidebar.innerHTML =
          "<div style='padding:10px; color:#999; text-align:center;'>Sonuç yok</div>";
      } else {
        // Ayları doğru sıraya diz
        foundMonths.sort((a, b) => AY.indexOf(a) - AY.indexOf(b));

        foundMonths.forEach((m) => {
          const count = results.filter((r) => ayAdi(r.tarih) === m).length;

          const div = document.createElement("div");
          div.className = "am-mini-month";

          div.innerHTML = `
                    <span class="m-name">${m}</span>
                    <span class="m-badge">${count}</span>
                `;

          amSidebar.appendChild(div);
        });
      }

      // === SAĞ TARAFTAKİ TABLO ===
      amTableBody.innerHTML = "";

      if (results.length === 0) {
        amTableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; padding:20px; color:#999;">
                    "${query}" için kayıt bulunamadı.
                </td>
            </tr>`;
      } else {
        // Tarihe göre sırala
        results.sort((a, b) => parseDate(a.tarih) - parseDate(b.tarih));

        results.forEach((r) => {
          const tr = document.createElement("tr");

          tr.innerHTML = `
                    <td><b>${ayAdi(r.tarih)}</b></td>
                    <td>${fmtTarih(r.tarih)}</td>
                    <td>${r.masraf}</td>
                    <td>${r.aciklama}</td>
                    <td style="font-weight:bold; color:#2a5298;">
                        ${r.tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                    </td>
                    <td>
                        <span style="font-size:11px; background:#eee; padding:2px 4px; border-radius:3px;">
                            ${r.faturaNo}
                        </span>
                    </td>
                `;
          amTableBody.appendChild(tr);
        });
      }
    };

    // === Modal açma ===
    searchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      amOverlay.style.display = "flex";

      renderDashboard(); // İlk ekran
      amSearchInput.value = "";
      amDashboard.style.display = "grid";
      amSplitView.style.display = "none";
      amSearchInput.focus();
    });

    // === Modal kapatma ===
    amCloseBtn.addEventListener(
      "click",
      () => (amOverlay.style.display = "none"),
    );

    // Modal dışına tıklayınca kapat
    amOverlay.addEventListener("click", (e) => {
      if (e.target === amOverlay) amOverlay.style.display = "none";
    });

    // Arama yazıldıkça filtrele
    amSearchInput.addEventListener("input", handleSearch);

    // Yıl değişince dashboard veya arama güncellenir
    amYearSelect.addEventListener("change", () => {
      if (amSearchInput.value.trim() !== "") {
        handleSearch();
      } else {
        renderDashboard();
      }
    });
  } // === Arama modal sonu ===

  // ======== // === TEMA DEĞİŞİMİ (Koyu / Açık)============
  if (themeToggle) {
    // Önceki tema tercihini yükle
    if (localStorage.getItem("darkMode") === "true") {
      document.body.classList.add("dark-mode");
      themeToggleIcon?.classList.replace("fa-moon", "fa-sun");
      localStorage.setItem("darkMode", "true");

    }

    // Butona basınca tema değiştir
    themeToggle.addEventListener("click", () => {
      document.body.classList.add("theme-transition");
      document.body.classList.toggle("dark-mode");

      const isDark = document.body.classList.contains("dark-mode");
      localStorage.setItem("darkMode", isDark);

      themeToggleIcon?.classList.replace(
        isDark ? "fa-moon" : "fa-sun",
        isDark ? "fa-sun" : "fa-moon",
      );

      showToast(isDark ? "Koyu mod aktif" : "Aydınlık mod aktif", "success");

      setTimeout(() => document.body.classList.remove("theme-transition"), 400);
    });
  }

  const closeAppBtn = document.getElementById("closeAppBtn");
  closeAppBtn?.addEventListener("click", () => {
    if (window.api && typeof window.api.closeApp === "function") {
      window.api.closeApp();
    } else {
      window.close();
    }
  });

  // === // === YEDEK MENÜSÜ (İçe/Dışa Aktarma + Temizleme)
  const backupMenu = q(".backup-menu, .yedek-menu");
  const exportBtn = q("#exportData");
  const importBtn = q("#importData");
  const clearBtn = q("#clearData");
  const openBackupBtn = q("#openBackupFolder");

  const positionBackupMenu = () => {
    if (!backupBtn || !backupMenu) return;

    const btn = backupBtn.getBoundingClientRect();
    const gap = 8;

    // Menü önce CSS ile görünür olsun ki gerçek genişlik/yükseklik ölçülsün.
    backupMenu.classList.add("show");
    backupMenu.style.display = "";
    backupMenu.style.position = "fixed";

    const menuW = backupMenu.offsetWidth || 268;
    const menuH = backupMenu.offsetHeight || 190;

    const top = Math.max(8, Math.min(window.innerHeight - menuH - 8, btn.bottom + gap));
    const left = Math.max(8, Math.min(window.innerWidth - menuW - 8, btn.left));

    backupMenu.style.top = `${top}px`;
    backupMenu.style.left = `${left}px`;
  };

  const closeBackupMenu = () => {
    if (!backupMenu) return;
    backupMenu.classList.remove("show");
    backupMenu.style.display = "";
  };

  if (backupBtn && backupMenu) {
    backupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!backupMenu.classList.contains("show")) {
        positionBackupMenu();
      } else {
        closeBackupMenu();
      }
    });

    backupMenu.addEventListener("click", (e) => e.stopPropagation());

    document.addEventListener("click", () => {
      if (backupMenu.classList.contains("show")) closeBackupMenu();
    });

    window.addEventListener("resize", () => {
      if (backupMenu.classList.contains("show")) positionBackupMenu();
    });

    window.addEventListener("scroll", () => {
      if (backupMenu.classList.contains("show")) positionBackupMenu();
    }, true);
  }

  // === dışa aktar ===
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      try {
        const data = readAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "gider_yedek.json";
        a.click();

        URL.revokeObjectURL(url);

        showCenterToast("Veriler dışa aktarıldı", "success");
      } catch (e) {
        showCenterToast("Dışa aktarma hatası", "error");
      }
    });
  }

  // === içe aktar ===
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "application/json";

      file.addEventListener("change", (e) => {
        const f = e.target.files?.[0];
        if (!f) return;

        const r = new FileReader();

        r.onload = (ev) => {
          try {
            const json = JSON.parse(ev.target.result);
            if (!Array.isArray(json)) throw new Error("Geçersiz JSON");

            writeAll(json);
            autoBackup();
            renderTable();
            refreshStats();
            updateNextFaturaNoUI();

            showCenterToast("Veriler içe aktarıldı", "success");
          } catch (err) {
            showCenterToast("JSON okunamadı", "error");
          }
        };

        r.readAsText(f, "utf-8");
      });

      file.click();
    });
  }
  // === Yedek klasörünü aç ===
  if (openBackupBtn && isElectron) {
    openBackupBtn.addEventListener("click", () => {
      window.electronAPI.openBackupFolder();
      backupMenu.classList.remove("show");
      backupMenu.style.display = "none";
    });
  }

  // === TÜM VERİLERİ TEMİZLE ===
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!confirm("Tüm veriler silinecek. Emin misiniz?")) return;

      try {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_NO);

        renderTable();
        refreshStats();
        updateNextFaturaNoUI();

        showCenterToast("Tüm kayıtlar silindi", "success");

        if (isElectron && window.electronAPI?.saveData) {
          window.electronAPI.saveData([]).catch((err) => console.error(err));
        }
      } catch (err) {
        showCenterToast("Silme hatası", "error");
      }
    });
  }

  // ==========================================================
  // === EXCEL AKTARMA (AVANS + BAYBURT) ===
  // ==========================================================
  const excelBtn = document.getElementById("exportToXlsm");

  if (excelBtn) {
    excelBtn.addEventListener("click", async () => {
      try {
        const all = readAll();

        // filtrele
        let filtered = all.filter(
          (r) =>
            (r.ay || ayAdi(r.tarih)) === seciliAy &&
            (seciliYil === "all" || getYear(r.tarih) == seciliYil) &&
            r.avans === seciliAvans,
        );

        filtered.sort((a, b) => parseDate(a.tarih) - parseDate(b.tarih));

        if (filtered.length === 0) {
          showCenterToast("Bu filtrelerde yazdırılacak veri yok!", "error");
          return;
        }

        const templatePath =
          await window.electronAPI.getResourcePath("sablon.xlsx");
        const varsayilanDosya = `Avans_${seciliAy}_${seciliYil}.xlsx`;

        const outPath =
          await window.electronAPI.selectSavePath(varsayilanDosya);
        if (!outPath) {
          showCenterToast("Kaydetme iptal edildi!", "error");
          return;
        }

        // AVANS sayfası
        const payloadAvans = {
          templatePath,
          outPath,
          sheetName: "AVANS",
          startRow: 3,
          data: filtered,
        };

        // BAYBURT sayfası
        const payloadBayburt = {
          templatePath,
          outPath,
          sheetName: "BAYBURT",
          startRow: 11,
          data: filtered,
        };

        // Yaz
        const r1 = await window.electronAPI.writeXlsx(payloadAvans);
        const r2 = await window.electronAPI.writeXlsx(payloadBayburt);

        if (r1.success && r2.success) {
          showCenterToast("Excel başarıyla oluşturuldu ✔", "success");
        } else {
          showCenterToast("Excel yazarken hata oluştu!", "error");
        }
      } catch (err) {
        console.error(err);
        showCenterToast("Excel oluşturulurken hata!", "error");
      }
    });
  }

  // ==========================================================
  // === DRAG & DROP İLE SATIRI BAŞKA AYA TAŞIMA ===
  // ==========================================================
  function enableRowDrag() {
    document.querySelectorAll(".data-table tbody tr").forEach((tr) => {
      tr.setAttribute("draggable", "true");

      tr.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("faturaNo", tr.dataset.faturaNo);
        tr.classList.add("dragging");
      });

      tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
    });
  }

  document.querySelectorAll(".month-item").forEach((box) => {
    box.addEventListener("dragover", (e) => {
      e.preventDefault();
      box.classList.add("drop-hover");
    });

    box.addEventListener("dragleave", () => box.classList.remove("drop-hover"));

    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("drop-hover");

      const faturaNo = Number(e.dataTransfer.getData("faturaNo"));
      const hedefAy = box
        .querySelector(".name")
        .textContent.trim()
        .toUpperCase();

      let all = readAll();
      const rec = all.find((r) => r.faturaNo === faturaNo);
      if (!rec) return;

      // SADECE AYI DEĞİŞTİR
      rec.ay = hedefAy;

      writeAll(all);
      autoBackup();

      // UI güncelle
      seciliAy = hedefAy;
      document
        .querySelectorAll(".month-item")
        .forEach((m) => m.classList.remove("selected"));
      box.classList.add("selected");

      if (dateTextEl) dateTextEl.textContent = hedefAy;

      renderTable();
      refreshStats();
      showCenterToast("Satır yeni aya taşındı ✔", "success");
    });
  });
}); // === DOMContentLoaded sonu ===

// 📊 YILLIK ÖZET POPUP – aç / kapa

// 2023–2039 arası yıl listesini doldur
function initYearSelectForSummary() {
  const yearSelect = document.getElementById("ysYearSelect");
  if (!yearSelect) return;

  const currentYear = Number(seciliYil || new Date().getFullYear());
  const currentValue = yearSelect.value && yearSelect.value !== "all" ? Number(yearSelect.value) : currentYear;
  yearSelect.innerHTML = "";

  for (let y = 2023; y <= 2039; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === currentValue) opt.selected = true;
    yearSelect.appendChild(opt);
  }
}

// Yıllık özet ekranı kaldırıldı.
// 🧾 Avans harici faturalar popup
const nonAdvBtn = document.getElementById("nonAdvModalBtn");
const nonAdvModal = document.getElementById("nonAdvModal");

// Avans harici için yıl seçiciyi doldur
function initNafYearSelect() {
  const sel = document.getElementById("nafYearSelect");
  if (!sel) return;
  if (sel.options.length > 0) return;

  const currentYear = seciliYil || new Date().getFullYear();
  for (let y = 2023; y <= 2039; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y === currentYear) opt.selected = true;
    sel.appendChild(opt);
  }
}
if (nonAdvBtn && nonAdvModal) {
  nonAdvBtn.addEventListener("click", () => {
    initNafYearSelect();

    const sel = document.getElementById("nafYearSelect");
    if (sel) sel.value = String(seciliYil);

    nafPrepareNewInvoiceNo(); // ⭐ FTR0001, FTR0002... buradan geliyor
    nonAdvModal.style.display = "flex";
  });

  // Arka plana tıklayınca kapansın
  nonAdvModal.addEventListener("click", (e) => {
    if (e.target === nonAdvModal) {
      nonAdvModal.style.display = "none";
    }
  });
  // ==========================================================
  // 🧾 AVANS HARİCİ FATURALAR – KAYDET / GÜNCELLE / SİL / TABLO
  // ==========================================================
  (function () {
    const nafDate = document.getElementById("nafDate");
    const nafType = document.getElementById("nafType");
    const nafCompany = document.getElementById("nafCompany"); // Tek açıklama/firma alanı
    const nafAmount = document.getElementById("nafAmount");
    const nafInvoiceInp = document.getElementById("nafInvoiceNo");

    const nafSaveBtn = document.getElementById("nafSaveBtn");
    const nafClearBtn = document.getElementById("nafClearBtn");
    const nafYearSelect = document.getElementById("nafYearSelect");

    const nafTableBody = document.querySelector("#nafTable tbody");
    const nafTotalEl = document.getElementById("nafTotalAmount");
    const nafCountEl = document.getElementById("nafInvoiceCount");
    const nafLastDateEl = document.getElementById("nafLastDate");
    const nafModal = document.getElementById("nonAdvModal");
    const nafDeleteBtn = document.getElementById("nafDeleteBtn");
    const nafOpenBtn = document.getElementById("nonAdvModalBtn");

    // Sağ alttaki "Seçili Kaydı Sil" butonu
    if (nafDeleteBtn) {
      nafDeleteBtn.addEventListener("click", (e) => {
        e.preventDefault();

        const selRow = document.querySelector(
          "#nafTable tbody tr.selected-row",
        );
        if (!selRow) {
          showToast("Silmek için önce bir satır seç", "error");
          return;
        }

        const invoiceNo = selRow.dataset.invoiceNo;
        if (!invoiceNo) {
          showToast("Seçili kaydın fatura numarası bulunamadı", "error");
          return;
        }

        document.querySelector(".confirm-popup")?.remove();

        const p = document.createElement("div");
        p.className = "confirm-popup";

        p.innerHTML = `
        <h3>Bu faturayı silmek istiyor musun?</h3>
        <p style="font-size:12px; opacity:0.8; margin-top:-6px; margin-bottom:6px;">
          Fatura No: <strong>${invoiceNo}</strong>
        </p>
        <div class="buttons">
          <button class="yes-btn">Evet, Sil</button>
          <button class="no-btn">Vazgeç</button>
        </div>
      `;

        document.body.appendChild(p);
        setTimeout(() => p.classList.add("show"), 10);

        p.querySelector(".yes-btn").onclick = () => {
          nafDeleteByInvoice(invoiceNo);
          p.remove();
          showCenterToast("Fatura silindi ✔", "success");
        };

        p.querySelector(".no-btn").onclick = () => {
          p.remove();
        };
      });
    }

    // Eğer popup HTML'de yoksa hiç devam etme
    if (
      !nafDate ||
      !nafType ||
      !nafCompany ||
      !nafAmount ||
      !nafInvoiceInp ||
      !nafTableBody
    ) {
      return;
    }

    // Düzenleme modu (hangi fatura no)
    let nafCurrentInvoice = null;

    // Türkçe büyük harf
    if (typeof toUpperTR === "function") {
      nafType.addEventListener("input", () => {
        nafType.value = toUpperTR(nafType.value);
      });
      nafCompany.addEventListener("input", () => {
        nafCompany.value = toUpperTR(nafCompany.value);
      });
    }

    function nafGetYear() {
      if (nafYearSelect && nafYearSelect.value) {
        return Number(nafYearSelect.value);
      }
      return seciliYil || new Date().getFullYear();
    }

    function nafValidate() {
      if (!parseDate(nafDate.value)) {
        return { ok: false, msg: "Tarih geçersiz." };
      }
      if (!nafType.value.trim()) {
        return { ok: false, msg: "Masraf türü boş." };
      }
      if (nafAmount.value === "") {
        return { ok: false, msg: "Tutar boş." };
      }
      const num = Number(String(nafAmount.value).replace(",", "."));
      if (isNaN(num)) {
        return { ok: false, msg: "Tutar geçersiz." };
      }
      return { ok: true };
    }

    // Formu kayıt objesine çevir
    function nafFormToRecord() {
      const d = parseDate(nafDate.value);
      if (!d) return null;

      const iso = nafDate.value; // YYYY-MM-DD
      const yil = d.getFullYear();
      const tutarNum = Number(String(nafAmount.value).replace(",", ".")) || 0;

      const inv =
        nafCurrentInvoice || nafInvoiceInp.value || generateNonAdvInvoiceNo();

      return {
        invoiceNo: inv,
        tarih: iso,
        masraf: nafType.value.trim(),
        firma: nafCompany.value.trim(), // sadece firma/açıklama
        tutar: tutarNum,
        yil: yil,
      };
    }

    // Formu doldur
    function nafLoadToForm(rec) {
      const d = parseDate(rec.tarih);
      if (d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        nafDate.value = `${yyyy}-${mm}-${dd}`;
      } else {
        nafDate.value = "";
      }

      nafType.value = rec.masraf || "";
      nafCompany.value = rec.firma || "";
      nafAmount.value = String(rec.tutar ?? "").replace(".", ",");
      nafInvoiceInp.value = rec.invoiceNo || "";
      nafCurrentInvoice = rec.invoiceNo || null;
    }

    // Formu sıfırla
    function nafClearForm() {
      nafDate.value = "";
      nafType.value = "";
      nafCompany.value = "";
      nafAmount.value = "";
      nafCurrentInvoice = null;

      nafPrepareNewInvoiceNo();

      document
        .querySelectorAll("#nafTable tbody tr")
        .forEach((tr) => tr.classList.remove("selected-row"));
    }

    // Tablo + badge’ler
    function nafRender() {
      const all = getNonAdvAll();
      const year = nafGetYear();

      const list = all.filter((r) => {
        const y = r.yil ?? parseDate(r.tarih)?.getFullYear();
        return y === year;
      });

      list.sort((a, b) => {
        const da = parseDate(a.tarih);
        const db = parseDate(b.tarih);
        return da - db;
      });

      nafTableBody.innerHTML = "";

      let total = 0;
      let lastDt = null;

      list.forEach((rec) => {
        const tr = document.createElement("tr");
        tr.dataset.invoiceNo = rec.invoiceNo;

        const d = parseDate(rec.tarih);
        if (d) {
          if (!lastDt || d > lastDt) lastDt = d;
        }
        const tutar = Number(rec.tutar || 0);
        total += tutar;

        // TABLODAKİ SÜTUNLAR: TARİH – MASRAF – FİRMA – TUTAR – FTR NO
        tr.innerHTML = `
        <td>${fmtTarih(rec.tarih)}</td>
        <td>${rec.masraf || ""}</td>
        <td>${rec.firma || ""}</td>
        <td>${tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</td>
        <td>${rec.invoiceNo || ""}</td>
      `;

        tr.addEventListener("click", () => {
          document
            .querySelectorAll("#nafTable tbody tr")
            .forEach((row) => row.classList.remove("selected-row"));
          tr.classList.add("selected-row");
        });

        nafTableBody.appendChild(tr);
      });

      if (nafCountEl) {
        nafCountEl.textContent = String(list.length);
      }
      if (nafTotalEl) {
        nafTotalEl.textContent =
          total.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";
      }
      if (nafLastDateEl) {
        nafLastDateEl.textContent = lastDt ? fmtTarih(lastDt) : "-";
      }
    }

    // Kaydet
    function nafSave() {
      const v = nafValidate();
      if (!v.ok) {
        showToast(v.msg, "error");
        return;
      }

      const rec = nafFormToRecord();
      if (!rec) {
        showToast("Kayıt oluşturulamadı", "error");
        return;
      }

      let list = getNonAdvAll();
      const idx = list.findIndex((r) => r.invoiceNo === rec.invoiceNo);

      if (idx > -1) {
        list[idx] = rec;
        showToast("Kayıt güncellendi", "success");
      } else {
        list.push(rec);
        showToast("Kayıt eklendi", "success");
      }

      saveNonAdvAll(list);
      syncNonAdvToDisk();
      nafClearForm();
      nafRender();
    }

    // Sil
    function nafDeleteByInvoice(invoiceNo) {
      if (!invoiceNo) return;

      let list = getNonAdvAll();
      const before = list.length;
      list = list.filter((r) => r.invoiceNo !== invoiceNo);

      if (list.length === before) {
        showToast("Kayıt bulunamadı", "error");
        return;
      }
      saveNonAdvAll(list);
      reindexNonAdvNumbers();

      nafClearForm();
      nafRender();
      syncNonAdvToDisk();
      showToast("Kayıt silindi", "success");
    }

    // Event’ler
    if (nafSaveBtn) {
      nafSaveBtn.addEventListener("click", nafSave);
    }

    if (nafAmount) {
      nafAmount.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nafSave();
        }
      });
    }

    if (nafClearBtn) {
      nafClearBtn.addEventListener("click", () => {
        nafClearForm();
      });
    }

    if (nafYearSelect) {
      nafYearSelect.addEventListener("change", () => {
        nafRender();
      });
    }

    if (nafOpenBtn) {
      nafOpenBtn.addEventListener("click", () => {
        nafClearForm();
        nafRender();
      });
    }

    // Delete tuşu vs. burada devam edebilir...
  })();

  document.getElementById("nafCloseBtn")?.addEventListener("click", () => {
    nonAdvModal.style.display = "none";
  });
}
// === MERKEZİ ESC KISAYOLU ===
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;

  const active = document.activeElement;

  // 1️⃣ Ay detayı popup'ı (ysMonthOverlay) açıksa önce onu kapat
  const monthOverlay = document.getElementById("ysMonthOverlay");
  if (monthOverlay && monthOverlay.style.display === "flex") {
    monthOverlay.style.display = "none";
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // 3️⃣ Arama ekranı (gelişmiş modal) açıksa kapat
  const searchOverlay = document.querySelector(".advanced-modal-overlay");
  if (searchOverlay && searchOverlay.style.display === "flex") {
    searchOverlay.style.display = "none";
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // 3️⃣ Avans harici faturalar popup'ı açıksa kapat
  const nafModal = document.getElementById("nonAdvModal");
  if (nafModal && nafModal.style.display === "flex") {
    nafModal.style.display = "none";
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // 4️⃣ Bir input / textarea / select içindeysek → sadece fokusu kaldır
  if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) {
    active.blur();
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // 5️⃣ Hepsi kapalı ise → Ana ekrandaki Yenile butonunu tetikle
  const refreshBtn = document.getElementById("refreshBtn") || document.querySelector(".fa-redo-alt.icon-button");
  if (refreshBtn) {
    e.preventDefault();
    e.stopPropagation();
    refreshBtn.click();
  }
});
// ======================================================
// 💾 Program kapanırken verileri diske (veriler.json) yaz
// ======================================================
if (isElectron && window.electronAPI) {
  window.addEventListener("beforeunload", () => {
    try {
      if (window.electronAPI.saveData) {
        window.electronAPI.saveData(readAll());
      }

      if (window.electronAPI.saveNonAdv) {
        window.electronAPI.saveNonAdv(getNonAdvAll());
      }
    } catch (err) {
      console.error("Kapanışta kayıt hatası:", err);
    }
  });
}
const saveStatusEl = document.getElementById("saveStatus");
const saveDot = document.getElementById("saveDot");

function setSaveText(t, ok = null) {
  if (saveStatusEl) saveStatusEl.textContent = t;
  if (saveDot && ok !== null) {
    saveDot.style.background = ok ? "#22c55e" : "#ef4444"; // yeşil / kırmızı
  }
}

let saveTimer = null;
function scheduleAutosave() {
  if (!isElectron || !window.electronAPI?.saveData) return;

  setSaveText("Kaydediliyor...", true);
  clearTimeout(saveTimer);

  // 400ms debounce: kullanıcı hızlı işlem yaparken sürekli disk yazmasın
  saveTimer = setTimeout(async () => {
    try {
      await window.electronAPI.saveData(readAll());
      if (window.electronAPI.saveNonAdv)
        await window.electronAPI.saveNonAdv(getNonAdvAll());
      // başarı metni main’den de gelecek; burada da yazıyoruz:
      const d = new Date();
      setSaveText("Kaydedildi: " + d.toLocaleTimeString());
    } catch (e) {
      setSaveText("Kayıt Hatası!");
      console.error(e);
    }
  }, 400);
}

// Main’den gelen durum
if (isElectron && window.electronAPI?.onSaveStatus) {
  window.electronAPI.onSaveStatus((s) => {
    if (s?.ok) {
      const d = new Date(s.at || Date.now());
      setSaveText("Kaydedildi: " + d.toLocaleTimeString(), true);
    } else {
      setSaveText("Kayıt Hatası!", false);
    }
  });
}

// Ek güvenlik: 60 sn’de bir “ne olur ne olmaz” kayıt
if (isElectron) {
  setInterval(() => {
    try {
      scheduleAutosave();
    } catch (_) {}
  }, 60000);
}

// ==========================================================
// ✅ YENİ HIZLI YILLIK ANALİZ DASHBOARDU
// ==========================================================
let ysActiveType = "ALL";
let ysSelectedMonth = 0;

function ysMoney(v) {
  return (Number(v) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";
}

function ysGetDashboardData(year) {
  const normal = readAll()
    .filter((r) => getYear(r.tarih) === Number(year))
    .map((r) => ({
      tarih: r.tarih,
      masraf: r.masraf || "-",
      aciklama: r.aciklama || "",
      tutar: Number(r.tutar) || 0,
      type: r.avans || "AVANS 1",
      faturaNo: r.faturaNo ? `FTR${String(r.faturaNo).padStart(5, "0")}` : "-",
    }));

  const harici = getNonAdvAll()
    .filter((r) => Number(r.yil ?? parseDate(r.tarih)?.getFullYear()) === Number(year))
    .map((r) => ({
      tarih: r.tarih,
      masraf: r.masraf || "-",
      aciklama: r.firma || "",
      tutar: Number(r.tutar) || 0,
      type: "AVANS HARİCİ",
      faturaNo: r.invoiceNo || "-",
    }));

  return normal.concat(harici).filter((r) => parseDate(r.tarih));
}

function ysMonthIndex(rec) {
  const d = parseDate(rec.tarih);
  return d ? d.getMonth() : -1;
}

function ysTypeLabel(type) {
  if (type === "ALL") return "TÜMÜ";
  if (type === "AVANS_KASASI") return "AVANS 1 + AVANS 2";
  return type;
}

function ysTypeHint(type) {
  if (type === "AVANS_KASASI") return "Ana avans kasası: Avans 1 ve Avans 2 birlikte hesaplanır.";
  if (type === "ARAÇ AVANS") return "Araç avans aylık kapatılır; kalan para sonraki aya devretmez, iade/fark olarak görünür.";
  if (type === "AVANS HARİCİ") return "Avans harici aylık kapatılır; kalan para sonraki aya devretmez, iade/fark olarak görünür.";
  return "Tüm kasaların genel toplamını gösterir.";
}

function ysRecordMatchesType(r, activeType) {
  if (activeType === "ALL") return true;
  if (activeType === "AVANS_KASASI") return r.type === "AVANS 1" || r.type === "AVANS 2";
  return r.type === activeType;
}

function ysExpenseForIncomeType(month, incomeType) {
  if (!month) return 0;
  if (incomeType === "AVANS_KASASI") return (Number(month.avans1) || 0) + (Number(month.avans2) || 0);
  if (incomeType === "ARAC_KASASI") return Number(month.arac) || 0;
  if (incomeType === "HARICI_KASASI") return Number(month.harici) || 0;
  return 0;
}

function ysManualIncomeByFilter(year, monthIndex, activeType) {
  if (activeType === "ALL") return getIncomeTotalForMonth(year, monthIndex);
  if (activeType === "AVANS_KASASI") return getIncomeForMonth(year, monthIndex, "AVANS_KASASI");
  if (activeType === "ARAÇ AVANS") return getIncomeForMonth(year, monthIndex, "ARAC_KASASI");
  if (activeType === "AVANS HARİCİ") return getIncomeForMonth(year, monthIndex, "HARICI_KASASI");
  return 0;
}

function ysAutoIncomeByFilter(months, monthIndex, activeType) {
  // ÖNEMLİ MANTIK:
  // Sadece ana avans kasası (Avans 1 + Avans 2) devirli çalışır.
  // Araç Avans ve Avans Harici aylık kapatılır; bir sonraki aya otomatik gelir aktarılmaz.
  if (monthIndex <= 0) return 0;
  const prev = months[monthIndex - 1];

  if (activeType === "AVANS_KASASI") return ysExpenseForIncomeType(prev, "AVANS_KASASI");

  // Genel görünümde otomatik devir sadece ana avans için hesaplanır.
  // Araç/Harici gelirleri şirket tarafından ayrı yatırılır ve manuel gelir panelinden girilir.
  if (activeType === "ALL") return ysExpenseForIncomeType(prev, "AVANS_KASASI");

  return 0;
}

function ysIsMonthlyClosingType(activeType) {
  return activeType === "ARAÇ AVANS" || activeType === "AVANS HARİCİ";
}

function ysBalanceLabel(activeType, value) {
  if (ysIsMonthlyClosingType(activeType)) {
    if (value > 0) return "İade Edilecek";
    if (value < 0) return "Eksik / Fark";
    return "Kapandı";
  }
  if (activeType === "AVANS_KASASI") return "Ay Sonu Kasa";
  return "Net Durum";
}

function ysBalanceClass(activeType, value) {
  if (ysIsMonthlyClosingType(activeType)) {
    if (value > 0) return "warn";
    if (value < 0) return "danger";
    return "good";
  }
  return value < 0 ? "danger" : "good";
}

function ysMonthCardRows(m, activeType) {
  if (activeType === "AVANS_KASASI") {
    return `
      <div class="ys-break-mini"><span>Avans 1</span><b>${ysMoney(m.avans1)}</b></div>
      <div class="ys-break-mini"><span>Avans 2</span><b>${ysMoney(m.avans2)}</b></div>
    `;
  }
  if (activeType === "ARAÇ AVANS") {
    return `<div class="ys-break-mini"><span>Araç Avans</span><b>${ysMoney(m.arac)}</b></div>`;
  }
  if (activeType === "AVANS HARİCİ") {
    return `<div class="ys-break-mini"><span>Avans Harici</span><b>${ysMoney(m.harici)}</b></div>`;
  }
  return `
    <div class="ys-break-mini"><span>Avans 1</span><b>${ysMoney(m.avans1)}</b></div>
    <div class="ys-break-mini"><span>Avans 2</span><b>${ysMoney(m.avans2)}</b></div>
    <div class="ys-break-mini"><span>Araç</span><b>${ysMoney(m.arac)}</b></div>
    <div class="ys-break-mini"><span>Harici</span><b>${ysMoney(m.harici)}</b></div>
  `;
}


function calcYearSummary(targetYear) {
  const yearSelect = document.getElementById("ysYearSelect");
  const grid = document.getElementById("ysMonthGrid");
  if (!grid || !yearSelect) return;

  const year = Number(targetYear || yearSelect.value || seciliYil);
  yearSelect.value = String(year);

  const allRecords = ysGetDashboardData(year);
  const filtered = allRecords.filter((r) => ysRecordMatchesType(r, ysActiveType));

  const months = AY.map((ad, index) => ({
    ad, index,
    avans1: 0,
    avans2: 0,
    arac: 0,
    harici: 0,
    total: 0,
    gelir: 0,
    kasaSonu: 0,
    count: 0,
  }));

  allRecords.forEach((r) => {
    const i = ysMonthIndex(r);
    if (i < 0) return;
    const t = Number(r.tutar) || 0;
    if (r.type === "AVANS 1") months[i].avans1 += t;
    else if (r.type === "AVANS 2") months[i].avans2 += t;
    else if (r.type === "ARAÇ AVANS") months[i].arac += t;
    else if (r.type === "AVANS HARİCİ") months[i].harici += t;
    months[i].total += t;
    months[i].count += 1;
  });

  const selectedExpenseByMonth = months.map((m) => {
    if (ysActiveType === "AVANS_KASASI") return m.avans1 + m.avans2;
    if (ysActiveType === "ARAÇ AVANS") return m.arac;
    if (ysActiveType === "AVANS HARİCİ") return m.harici;
    return m.total;
  });

  months.forEach((m, i) => {
    m.manualIncome = ysManualIncomeByFilter(year, i, ysActiveType);
    m.autoIncome = ysAutoIncomeByFilter(months, i, ysActiveType);
    m.gelir = m.manualIncome + m.autoIncome;

    if (ysIsMonthlyClosingType(ysActiveType)) {
      m.kasaSonu = m.gelir - selectedExpenseByMonth[i];
    } else {
      const prevKasa = i === 0 ? 0 : months[i - 1].kasaSonu;
      m.kasaSonu = prevKasa + m.gelir - selectedExpenseByMonth[i];
    }

    m.balanceLabel = ysBalanceLabel(ysActiveType, m.kasaSonu);
  });

  const totalGelir = months.reduce((s, m) => s + m.gelir, 0);
  const totalGider = selectedExpenseByMonth.reduce((s, v) => s + v, 0);
  const yilSonu = totalGelir - totalGider;
  const bestMonth = months.reduce((best, m) => (m.kasaSonu > best.kasaSonu ? m : best), months[0]);
  const worstMonth = months.reduce((worst, m) => (m.kasaSonu < worst.kasaSonu ? m : worst), months[0]);

  document.getElementById("ysBadgeIncome").textContent = ysMoney(totalGelir);
  document.getElementById("ysBadgeExpense").textContent = ysMoney(totalGider);
  document.getElementById("ysBadgeRemain").textContent = ysMoney(yilSonu);
  syncCyberCashMirror?.();
  document.getElementById("ysActiveTypeLabel").textContent = ysTypeLabel(ysActiveType);

  const modeName = document.getElementById("ysSelectedModeName");
  const modeHint = document.getElementById("ysSelectedModeHint");
  const riskText = document.getElementById("ysRiskText");
  const riskStatusText = document.getElementById("ysRiskStatusText");
  const incomeTrend = document.getElementById("ysIncomeTrend");
  const expenseTrend = document.getElementById("ysExpenseTrend");
  const cashTrend = document.getElementById("ysCashTrend");

  if (modeName) modeName.textContent = ysTypeLabel(ysActiveType);
  if (modeHint) modeHint.textContent = ysTypeHint(ysActiveType);
  if (incomeTrend) incomeTrend.textContent = `${months.filter((m)=>m.gelir>0).length} ay gelir girişi var`;
  if (expenseTrend) expenseTrend.textContent = `${filtered.length} kayıt / ${ysMoney(totalGider)}`;
  if (cashTrend) cashTrend.textContent = yilSonu >= 0 ? "Kasada para var" : "Kasada açık var";
  if (riskText) riskText.textContent = yilSonu >= 0 ? `Kasa pozitif / açık yok` : `Kasada açık var`;
  if (riskStatusText) {
    riskStatusText.textContent = yilSonu >= 0 ? "Pozitif" : "Açık Var";
    riskStatusText.classList.toggle("danger", yilSonu < 0);
  }

  grid.innerHTML = "";
  months.forEach((m) => {
    const selectedExpense = selectedExpenseByMonth[m.index];
    const net = m.gelir - selectedExpense;
    const balanceClass = net < 0 ? "danger" : net > 0 ? "good" : "neutral";
    const count = filtered.filter((r)=>ysMonthIndex(r)===m.index).length;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ys-month-row" + (selectedExpense === 0 && count === 0 ? " empty" : "") + (m.index === ysSelectedMonth ? " selected" : "");
    row.innerHTML = `
      <span class="ys-m-name">${m.ad.slice(0,3)}</span>
      <span class="ys-m-money good">${ysMoney(m.gelir)}</span>
      <span class="ys-m-money danger">${ysMoney(selectedExpense)}</span>
      <span class="ys-m-money ${balanceClass}">${ysMoney(net)}</span>
      <span class="ys-m-status">${count ? count + " kayıt" : "boş"}</span>
    `;
    row.addEventListener("click", () => {
      ysSelectedMonth = m.index;
      grid.querySelectorAll(".ys-month-row").forEach((x) => x.classList.remove("selected"));
      row.classList.add("selected");
      const monthFiltered = filtered.filter((r) => ysMonthIndex(r) === m.index);
      showMonthDetail(year, m.index, { ...m, gider: selectedExpense, gelir: m.gelir }, monthFiltered);
    });
    grid.appendChild(row);
  });

  ysRenderCharts(months, selectedExpenseByMonth, allRecords, filtered);

  if (ysSelectedMonth < 0 || ysSelectedMonth > 11) ysSelectedMonth = 0;
  const selectedRow = grid.querySelectorAll(".ys-month-row")[ysSelectedMonth];
  if (selectedRow) selectedRow.classList.add("selected");
  const m = months[ysSelectedMonth];
  const monthFiltered = filtered.filter((r) => ysMonthIndex(r) === ysSelectedMonth);
  showMonthDetail(year, ysSelectedMonth, { ...m, gider: selectedExpenseByMonth[ysSelectedMonth], gelir: m.gelir }, monthFiltered);

  const alerts = document.getElementById("ysAlerts");
  if (alerts) {
    const alertItems = [];
    if (yilSonu < 0) alertItems.push({type:"danger", text:`Toplam gelir - toplam gider sonucu ${ysMoney(yilSonu)} açık görünüyor.`});
    if (worstMonth && worstMonth.kasaSonu < 0) alertItems.push({type:"warning", text:`${worstMonth.ad} ayında kapanış negatif: ${ysMoney(worstMonth.kasaSonu)}.`});
    if (yilSonu >= 0) alertItems.push({type:"success", text:`Toplam gelir - toplam gider sonucu kasada ${ysMoney(yilSonu)} görünüyor.`});
    if (!filtered.length) alertItems.push({type:"info", text:"Seçili filtre için kayıt bulunamadı."});
    if (alertItems.length < 3) alertItems.push({type:"info", text:`Aktif görünüm: ${ysTypeLabel(ysActiveType)}.`});
    alerts.innerHTML = alertItems.slice(0,4).map((a)=>`<div class="ys-alert ${a.type}"><i></i><span>${a.text}</span></div>`).join("");
  }

  const scrollBtn = document.getElementById("ysScrollToDetail");
  scrollBtn?.addEventListener("click", () => {
    document.querySelector(".ys-month-detail-card")?.scrollIntoView({behavior:"smooth", block:"nearest"});
  }, { once: true });
}

function ysRenderCharts(months, selectedExpenseByMonth, allRecords, filtered) {
  const chart = document.getElementById("ysBarChart");
  const breakdown = document.getElementById("ysBreakdown");
  if (!chart) return;

  const incomeVals = months.map((m) => Number(m.gelir || 0));
  const expenseVals = selectedExpenseByMonth.map((v) => Number(v || 0));
  const netVals = months.map((m, i) => incomeVals[i] - expenseVals[i]);
  const maxAbs = Math.max(...incomeVals, ...expenseVals, ...netVals.map(Math.abs), 1);

  const width = 920;
  const height = 250;
  const pad = { left: 46, right: 24, top: 20, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xStep = plotW / Math.max(months.length - 1, 1);
  const y = (v) => pad.top + plotH - ((Number(v || 0) / maxAbs) * plotH);
  const x = (i) => pad.left + (i * xStep);
  const makePoints = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const incomePoints = makePoints(incomeVals);
  const expensePoints = makePoints(expenseVals);
  const gridLines = [0, .25, .5, .75, 1].map((n) => {
    const gy = pad.top + plotH - (plotH * n);
    return `<line x1="${pad.left}" y1="${gy}" x2="${width-pad.right}" y2="${gy}" class="ys-line-grid"/>`;
  }).join("");
  const labels = months.map((m, i) => `<text x="${x(i)}" y="${height-12}" class="ys-line-label">${m.ad.slice(0,3).toUpperCase()}</text>`).join("");
  const dots = months.map((m, i) => {
    const net = netVals[i];
    const netClass = net < 0 ? "neg" : "pos";
    return `
      <g class="ys-line-hit" tabindex="0" aria-label="${m.ad} gelir ${ysMoney(incomeVals[i])}, gider ${ysMoney(expenseVals[i])}, net ${ysMoney(net)}">
        <title>${m.ad} | Gelir: ${ysMoney(incomeVals[i])} | Gider: ${ysMoney(expenseVals[i])} | Net: ${ysMoney(net)}</title>
        <circle cx="${x(i)}" cy="${y(incomeVals[i])}" r="5.5" class="ys-dot income"></circle>
        <circle cx="${x(i)}" cy="${y(expenseVals[i])}" r="5.5" class="ys-dot expense"></circle>
        <rect x="${x(i)-9}" y="${y(Math.abs(net))-2}" width="18" height="4" rx="2" class="ys-net-marker ${netClass}"></rect>
      </g>`;
  }).join("");

  chart.innerHTML = `
    <div class="ys-line-legend">
      <span><i class="income"></i>Gelir</span>
      <span><i class="expense"></i>Gider</span>
      <span><i class="net"></i>Net</span>
    </div>
    <svg class="ys-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gelir ve gider çizgi grafiği" preserveAspectRatio="none">
      ${gridLines}
      <polyline points="${incomePoints}" class="ys-line income"></polyline>
      <polyline points="${expensePoints}" class="ys-line expense"></polyline>
      ${dots}
      ${labels}
    </svg>`;

  const sums = {
    "AVANS 1": 0,
    "AVANS 2": 0,
    "ARAÇ AVANS": 0,
    "AVANS HARİCİ": 0,
  };
  allRecords.forEach((r) => sums[r.type] = (sums[r.type] || 0) + (Number(r.tutar) || 0));
  const total = Object.values(sums).reduce((a,b)=>a+b,0);
  const grand = Math.max(total, 1);
  const colors = ["#36d37e", "#3b82f6", "#f59e0b", "#8b5cf6"];
  const parts = Object.entries(sums).map(([name, val], idx) => {
    const pct = Math.round((val / grand) * 100);
    return {name, val, pct, color: colors[idx]};
  });

  const donut = document.getElementById("ysDonut");
  const donutTotal = document.getElementById("ysDonutTotal");
  if (donut) {
    let cursor = 0;
    const gradient = parts.map((p) => {
      const start = cursor;
      cursor += p.pct;
      return `${p.color} ${start}% ${cursor}%`;
    }).join(", ");
    donut.style.background = `conic-gradient(${gradient || "#24324c 0% 100%"})`;
  }
  if (donutTotal) donutTotal.textContent = ysMoney(total);

  if (breakdown) {
    breakdown.innerHTML = parts.map((p) => {
      return `<div class="ys-dist-row cockpit"><div><strong>${p.name}</strong><span>${ysMoney(p.val)}</span></div><div class="ys-dist-track"><i style="width:${p.pct}%; background:${p.color}"></i></div><em>${p.pct}%</em></div>`;
    }).join("");
  }
}


function initIncomeDrawerYears() {
  const sel = document.getElementById("incomeYearSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const current = seciliYil || new Date().getFullYear();
  for (let y = 2023; y <= 2039; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderIncomeList() {
  const list = document.getElementById("incomeList");
  const yearSel = document.getElementById("incomeYearSelect");
  if (!list || !yearSel) return;
  const year = String(yearSel.value || seciliYil);
  const data = getIncomeAll()[year] || {};
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const m = data[String(i)] || {};
    ["AVANS_KASASI", "ARAC_KASASI", "HARICI_KASASI"].forEach((type) => {
      const val = Number(m[type] || 0);
      if (val) rows.push({ month: i, type, val });
    });
  }
  list.innerHTML = rows.length ? rows.map((r) => `
    <div class="income-list-row">
      <span>${AY[r.month]}</span>
      <strong>${incomeTypeLabel(r.type)}</strong>
      <b>${ysMoney(r.val)}</b>
    </div>`).join("") : `<div class="income-empty">Bu yıl için gelir kaydı yok.</div>`;
}

function openIncomeDrawer() {
  initIncomeDrawerYears();
  const drawer = document.getElementById("incomeDrawer");
  const overlay = document.getElementById("incomeDrawerOverlay");
  if (!drawer || !overlay) return;
  drawer.classList.add("open");
  overlay.classList.add("open");
  renderIncomeList();
}

function closeIncomeDrawer() {
  document.getElementById("incomeDrawer")?.classList.remove("open");
  document.getElementById("incomeDrawerOverlay")?.classList.remove("open");
}

(function initIncomeDrawerEvents(){
  const openBtn = document.getElementById("incomeDrawerBtn");
  const closeBtn = document.getElementById("incomeDrawerClose");
  const overlay = document.getElementById("incomeDrawerOverlay");
  const saveBtn = document.getElementById("incomeSaveBtn");
  const clearBtn = document.getElementById("incomeClearBtn");
  const yearSel = document.getElementById("incomeYearSelect");
  const monthSel = document.getElementById("incomeMonthSelect");
  const typeSel = document.getElementById("incomeTypeSelect");
  const amountInp = document.getElementById("incomeAmountInput");

  openBtn?.addEventListener("click", openIncomeDrawer);
  closeBtn?.addEventListener("click", closeIncomeDrawer);
  overlay?.addEventListener("click", closeIncomeDrawer);
  yearSel?.addEventListener("change", renderIncomeList);

  saveBtn?.addEventListener("click", () => {
    const year = String(yearSel?.value || seciliYil);
    const month = String(monthSel?.value || 0);
    const type = String(typeSel?.value || "AVANS_KASASI");
    const val = Number(String(amountInp?.value || "").replace(",", "."));
    if (!amountInp?.value || isNaN(val) || val <= 0) return showToast("Lütfen geçerli bir tutar girin", "error");
    const data = getIncomeAll();
    data[year] = data[year] || {};
    data[year][month] = data[year][month] || {};
    data[year][month][type] = Number(data[year][month][type] || 0) + val;
    saveIncomeAll(data);
    amountInp.value = "";
    renderIncomeList();
    calcYearSummary(Number(document.getElementById("ysYearSelect")?.value || year));
    showToast(`${AY[Number(month)]} ${incomeTypeLabel(type)} gelirine ${ysMoney(val)} eklendi`, "success");
  });

  clearBtn?.addEventListener("click", () => {
    const year = String(yearSel?.value || seciliYil);
    const month = String(monthSel?.value || 0);
    const type = String(typeSel?.value || "AVANS_KASASI");
    const data = getIncomeAll();
    if (data[year]?.[month]) {
      delete data[year][month][type];
      if (Object.keys(data[year][month]).length === 0) delete data[year][month];
      saveIncomeAll(data);
    }
    renderIncomeList();
    calcYearSummary(Number(document.getElementById("ysYearSelect")?.value || year));
    showToast(`${AY[Number(month)]} ${incomeTypeLabel(type)} geliri sıfırlandı`, "success");
  });
})();






// ==========================================================
// CYBER DASHBOARD AÇ/KAPA + YENİ EKRAN BAĞLANTILARI
// ==========================================================
function openYearSummaryDashboard() {
  initYearSelectForSummary();
  const page = document.getElementById("yearSummaryPage");
  const yearSelect = document.getElementById("ysYearSelect");
  if (!page) return;
  if (yearSelect && (!yearSelect.value || yearSelect.value === "all")) {
    yearSelect.value = String(seciliYil || new Date().getFullYear());
  }
  page.classList.add("open");
  page.setAttribute("aria-hidden", "false");
  document.body.classList.add("ys-dashboard-open");
  document.getElementById("openYearSummaryBtn")?.classList.add("active");
  calcYearSummary(Number(yearSelect?.value || seciliYil || new Date().getFullYear()));
  syncCyberCashMirror();
}

function closeYearSummaryDashboard() {
  const page = document.getElementById("yearSummaryPage");
  if (!page) return;
  page.classList.remove("open");
  page.setAttribute("aria-hidden", "true");
  document.body.classList.remove("ys-dashboard-open");
  document.getElementById("openYearSummaryBtn")?.classList.remove("active");
}

function syncCyberCashMirror() {
  const source = document.getElementById("ysBadgeRemain");
  const mirror = document.getElementById("ysCoreCashMirror");
  if (source && mirror) mirror.textContent = source.textContent;
}

(function initCyberDashboardEvents(){
  const openBtn = document.getElementById("openYearSummaryBtn");
  const backBtn = document.getElementById("ysBackBtn");
  const yearSelect = document.getElementById("ysYearSelect");
  const tabs = document.getElementById("ysTypeTabs");

  openBtn?.addEventListener("click", openYearSummaryDashboard);
  backBtn?.addEventListener("click", closeYearSummaryDashboard);

  // Asıl sol menüde dashboard dışındaki bir butona basılırsa dashboard kapanır.
  document.querySelectorAll(".app-sidebar .sidebar-action").forEach((btn) => {
    if (btn.id === "openYearSummaryBtn") return;
    btn.addEventListener("click", () => {
      if (document.getElementById("yearSummaryPage")?.classList.contains("open")) {
        closeYearSummaryDashboard();
      }
    });
  });
  yearSelect?.addEventListener("change", () => {
    calcYearSummary(Number(yearSelect.value || seciliYil));
    syncCyberCashMirror();
  });

  tabs?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-ys-type]");
    if (!btn) return;
    ysActiveType = btn.dataset.ysType || "ALL";
    tabs.querySelectorAll("button").forEach((b)=>b.classList.remove("active"));
    btn.classList.add("active");
    calcYearSummary(Number(yearSelect?.value || seciliYil));
    syncCyberCashMirror();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("yearSummaryPage")?.classList.contains("open")) {
      closeYearSummaryDashboard();
    }
  });
})();
