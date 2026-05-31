/**
 * RedBox Barbershop — Generator Presentasi Update Sistem 2026
 * Untuk Admin & Kapster Internal
 * Jalankan: node generate_update_2026.js
 */

const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "RedBox Barbershop — Update Sistem 2026";

// ─── Color Palette ───────────────────────────────────────────────
const C = {
  bg:      "0D0D12",
  card:    "161820",
  card2:   "1E2028",
  red:     "C1121F",
  redDim:  "5C0B14",
  redBright:"E8192A",
  white:   "F0F0F0",
  offW:    "C8C8D4",
  gray:    "7A7A8A",
  gold:    "FBBF24",
  goldDim: "92700F",
  green:   "4ADE80",
  purple:  "A78BFA",
  border:  "2A2A38",
};

const W = 10, H = 5.625;
const mkShadow = () => ({ type:"outer", blur:6, offset:2, angle:135, color:"000000", opacity:0.35 });

// ─── Helper: slide background ────────────────────────────────────
function bgDark(slide) {
  slide.addShape(pres.ShapeType.rect, { x:0,y:0,w:W,h:H, fill:{color:C.bg}, line:{color:C.bg} });
}

// ─── Helper: section divider slide ──────────────────────────────
function sectionSlide(num, title, sub) {
  const s = pres.addSlide();
  // Full red gradient-like bg via two shapes
  s.addShape(pres.ShapeType.rect, { x:0,y:0,w:W,h:H, fill:{color:C.red}, line:{color:C.red} });
  s.addShape(pres.ShapeType.rect, { x:0,y:0,w:W,h:H, fill:{color:"000000", transparency:55}, line:{color:"000000",transparency:100} });
  // Section number
  s.addText(`0${num}`, { x:0.5,y:0.5, w:1.5,h:1.2, fontSize:64, bold:true, color:"FFFFFF", transparency:20, fontFace:"Arial Black" });
  // Title
  s.addText(title, { x:0.5,y:1.6, w:9,h:1.2, fontSize:38, bold:true, color:"FFFFFF", fontFace:"Arial Black" });
  // Sub
  if (sub) s.addText(sub, { x:0.5,y:2.9, w:8,h:0.6, fontSize:16, color:"FFFFFF", transparency:25 });
  // Bottom bar
  s.addShape(pres.ShapeType.rect, { x:0,y:H-0.08,w:W,h:0.08, fill:{color:"FFFFFF",transparency:40}, line:{color:"FFFFFF",transparency:100} });
  return s;
}

// ─── Helper: card box ────────────────────────────────────────────
function card(slide, x, y, w, h, opts={}) {
  slide.addShape(pres.ShapeType.roundRect, {
    x,y,w,h,
    fill:{color: opts.fill || C.card},
    line:{color: opts.border || C.border, width:1},
    rectRadius:0.08,
    shadow: opts.shadow ? mkShadow() : undefined,
  });
}

// ─── Helper: red accent bar (left) ──────────────────────────────
function redBar(slide, x, y, h) {
  slide.addShape(pres.ShapeType.rect, { x,y, w:0.045,h, fill:{color:C.red}, line:{color:C.red} });
}

// ─── Helper: badge ───────────────────────────────────────────────
function badge(slide, txt, x, y, opts={}) {
  const bg = opts.bg || C.red;
  slide.addShape(pres.ShapeType.roundRect, { x,y, w:opts.w||1.4, h:0.28, fill:{color:bg}, line:{color:bg}, rectRadius:0.04 });
  slide.addText(txt, { x,y, w:opts.w||1.4, h:0.28, fontSize:8.5, bold:true, color:"FFFFFF", align:"center", valign:"middle" });
}

// ─── Helper: step circle ─────────────────────────────────────────
function stepCircle(slide, n, x, y, color) {
  slide.addShape(pres.ShapeType.ellipse, { x,y, w:0.42,h:0.42, fill:{color:color||C.red}, line:{color:color||C.red} });
  slide.addText(String(n), { x,y, w:0.42,h:0.42, fontSize:13, bold:true, color:"FFFFFF", align:"center", valign:"middle" });
}

// ─── Helper: arrow right ─────────────────────────────────────────
function arrowRight(slide, x, y) {
  slide.addShape(pres.ShapeType.rightArrow, { x,y, w:0.38,h:0.22, fill:{color:C.gray}, line:{color:C.gray} });
}

// ─── Helper: header section label ────────────────────────────────
function slideHeader(slide, label, title, sub) {
  redBar(slide, 0.42, 0.32, sub ? 1.15 : 0.9);
  slide.addText(label.toUpperCase(), { x:0.55,y:0.3, w:9,h:0.25, fontSize:8, bold:true, color:C.red, charSpacing:3 });
  slide.addText(title, { x:0.55,y:0.55, w:9,h:0.55, fontSize:22, bold:true, color:C.white, fontFace:"Arial Black" });
  if (sub) slide.addText(sub, { x:0.55,y:1.12, w:8.5,h:0.32, fontSize:11, color:C.gray });
}

// ─── Helper: footer ──────────────────────────────────────────────
function footer(slide, pageNum) {
  slide.addShape(pres.ShapeType.rect, { x:0,y:H-0.3,w:W,h:0.3, fill:{color:"000000",transparency:40}, line:{color:C.border} });
  slide.addText("REDBOX BARBERSHOP  ·  UPDATE SISTEM 2026  ·  INTERNAL", { x:0.4,y:H-0.28, w:8,h:0.26, fontSize:7, color:C.gray, charSpacing:1 });
  slide.addText(String(pageNum), { x:9.4,y:H-0.28, w:0.4,h:0.26, fontSize:8, color:C.gray, align:"right" });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 1 — COVER
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bgDark(s);

  // Diagonal red accent shape
  s.addShape(pres.ShapeType.rect, { x:7.2,y:0,w:2.8,h:H, fill:{color:C.red}, line:{color:C.red} });
  s.addShape(pres.ShapeType.rect, { x:7.0,y:0,w:0.5,h:H, fill:{color:C.redDim}, line:{color:C.redDim} });
  s.addShape(pres.ShapeType.rect, { x:0,y:H-0.06,w:7.0,h:0.06, fill:{color:C.red}, line:{color:C.red} });

  // Tag
  s.addShape(pres.ShapeType.roundRect, { x:0.55,y:0.5, w:2.1,h:0.32, fill:{color:C.red}, line:{color:C.red}, rectRadius:0.05 });
  s.addText("UPDATE SISTEM 2026", { x:0.55,y:0.5, w:2.1,h:0.32, fontSize:9, bold:true, color:"FFFFFF", align:"center", valign:"middle", charSpacing:1.5 });

  // Main title
  s.addText("REDBOX", { x:0.5,y:0.95, w:6.3,h:1.1, fontSize:68, bold:true, color:C.white, fontFace:"Arial Black" });
  s.addText("BARBERSHOP", { x:0.5,y:1.9, w:6.3,h:0.8, fontSize:44, bold:true, color:C.red, fontFace:"Arial Black" });

  // Subtitle
  s.addText("Panduan Fitur Terbaru untuk Tim Internal\nAdmin · Kapster · Operasional 5 Cabang", {
    x:0.5, y:2.85, w:6.3, h:0.85,
    fontSize:13.5, color:C.offW, lineSpacingMultiple:1.5,
  });

  // Right panel text
  s.addText("2026", { x:7.25,y:0.6, w:2.6,h:1.4, fontSize:72, bold:true, color:"FFFFFF", transparency:15, align:"center", fontFace:"Arial Black" });
  s.addText("Sistem\nBaru", { x:7.3,y:1.9, w:2.5,h:1.0, fontSize:22, bold:true, color:"FFFFFF", align:"center", lineSpacingMultiple:1.4 });
  s.addText("5 Fitur Unggulan\nSiap Digunakan", { x:7.3,y:3.05, w:2.5,h:0.8, fontSize:12, color:"FFFFFF", transparency:20, align:"center", lineSpacingMultiple:1.5 });

  // Bottom
  s.addText("Dokumen Internal — Tidak untuk Disebarluaskan", {
    x:0.5, y:H-0.52, w:6.5, h:0.3, fontSize:8.5, color:C.gray,
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 2 — AGENDA
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Overview", "Yang Akan Kita Bahas Hari Ini", "5 topik utama update sistem terbaru RedBox Barbershop");
  footer(s, 2);

  const topics = [
    { n:"01", icon:"🏠", title:"Home Service",      sub:"Kapster datang ke lokasi kamu" },
    { n:"02", icon:"💬", title:"WA Bot 5 Cabang",   sub:"AI auto-reply 24/7" },
    { n:"03", icon:"💍", title:"Wedding Package",   sub:"Grooming untuk pengantin & rombongan" },
    { n:"04", icon:"⭐", title:"Membership",         sub:"Poin, tier & reward eksklusif" },
    { n:"05", icon:"🤖", title:"AI Grooming",        sub:"Khusus member — analisis & simulasi" },
  ];

  topics.forEach((t, i) => {
    const x = 0.42 + i * 1.92;
    card(s, x, 1.65, 1.78, 3.3, { shadow:true });
    s.addText(t.n, { x, y:1.75, w:1.78, h:0.3, fontSize:9, bold:true, color:C.red, align:"center", charSpacing:2 });
    s.addText(t.icon, { x, y:2.1, w:1.78, h:0.55, fontSize:28, align:"center" });
    s.addText(t.title, { x, y:2.72, w:1.78, h:0.42, fontSize:12, bold:true, color:C.white, align:"center", lineSpacingMultiple:1.3 });
    s.addShape(pres.ShapeType.rect, { x:x+0.65, y:3.2, w:0.48, h:0.025, fill:{color:C.red}, line:{color:C.red} });
    s.addText(t.sub, { x, y:3.32, w:1.78, h:0.5, fontSize:9, color:C.gray, align:"center", lineSpacingMultiple:1.35 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 3 — BIG PICTURE
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Ekosistem", "Semua Fitur Saling Terhubung", "Setiap fitur mendukung satu sama lain untuk pengalaman pelanggan terbaik");
  footer(s, 3);

  // Center node
  s.addShape(pres.ShapeType.ellipse, { x:4.25,y:2.05, w:1.5,h:1.05, fill:{color:C.red}, line:{color:C.red}, shadow:mkShadow() });
  s.addText("REDBOX\nSYSTEM", { x:4.25,y:2.05, w:1.5,h:1.05, fontSize:11, bold:true, color:"FFFFFF", align:"center", valign:"middle", lineSpacingMultiple:1.3 });

  // Surrounding nodes
  const nodes = [
    { label:"Home\nService",    x:0.5,  y:1.55, c:C.card2 },
    { label:"WA Bot\n5 Cabang", x:1.7,  y:0.62, c:C.card2 },
    { label:"Wedding\nPackage", x:7.2,  y:0.62, c:C.card2 },
    { label:"Member-\nship",    x:8.3,  y:1.55, c:C.card2 },
    { label:"AI\nGrooming",     x:4.25, y:3.42, c:C.card2 },
  ];

  // Lines to center
  const centerX = 5.0, centerY = 2.58;
  const lineTargets = [
    [1.5, 2.0], [2.9, 1.15], [7.5, 1.15], [8.6, 2.0], [5.0, 3.42]
  ];
  lineTargets.forEach(([lx, ly]) => {
    s.addShape(pres.ShapeType.line, {
      x:centerX, y:centerY, w:lx-centerX, h:ly-centerY,
      line:{color:C.border, width:1.2, dashType:"dash"}
    });
  });

  nodes.forEach(n => {
    card(s, n.x, n.y, 1.55, 0.72, { fill:n.c, border:C.red });
    s.addText(n.label, { x:n.x, y:n.y, w:1.55, h:0.72, fontSize:11, bold:true, color:C.white, align:"center", valign:"middle", lineSpacingMultiple:1.3 });
  });

  // Flow label
  s.addText("Pelanggan chat WA  →  Booking  →  Kunjungan / Home Service / Wedding  →  Review  →  Poin Member  →  AI Grooming", {
    x:0.42, y:4.68, w:9.2, h:0.42,
    fontSize:9.5, color:C.gray, align:"center",
  });
}

// ════════════════════════════════════════════════════════════════
// SECTION 2 — HOME SERVICE
// ════════════════════════════════════════════════════════════════
sectionSlide(2, "Home Service", "Kapster datang ke lokasi kamu — Gentleman Grooming di mana saja");

// ─── Slide 4: Konsep & Coverage ──────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Home Service", "Apa itu Home Service?", "Layanan potong rambut premium — kapster kami yang datang ke tempatmu");
  footer(s, 4);

  // Left: key points
  const pts = [
    { icon:"📍", bold:"Radius Layanan", detail:"Maks. 5 KM dari cabang terdekat" },
    { icon:"🕐", bold:"Jam Operasional", detail:"06.00 – 23.00 WIB (setiap hari)" },
    { icon:"💈", bold:"Pilih Kapster", detail:"Dari 5 cabang, kapster favoritmu bisa datang" },
    { icon:"✅", bold:"Termasuk",       detail:"Biaya kunjungan kapster sudah dalam harga" },
  ];

  pts.forEach((p, i) => {
    const y = 1.65 + i * 0.88;
    card(s, 0.42, y, 5.0, 0.72, { shadow:true });
    s.addText(p.icon, { x:0.52, y:y+0.12, w:0.55, h:0.5, fontSize:20, align:"center" });
    s.addText(p.bold, { x:1.18, y:y+0.1, w:4.1, h:0.28, fontSize:12, bold:true, color:C.white });
    s.addText(p.detail, { x:1.18, y:y+0.36, w:4.1, h:0.28, fontSize:10.5, color:C.gray });
  });

  // Right: 5 cabang coverage
  card(s, 5.65, 1.65, 4.0, 3.08, { fill:C.card2, shadow:true });
  s.addText("5 CABANG COVERAGE", { x:5.75, y:1.78, w:3.8, h:0.28, fontSize:8.5, bold:true, color:C.red, charSpacing:2 });

  const branches = [
    "🏢  RedBox Bypass (Pusat)",
    "🏢  RedBox Samadikun",
    "🏢  RedBox CSB Mall",
    "🏢  RedBox Sumber",
    "🏢  RedBox Tegal",
  ];
  branches.forEach((b, i) => {
    s.addText(b, { x:5.85, y:2.14 + i*0.44, w:3.6, h:0.38, fontSize:11.5, color:C.white });
  });
}

// ─── Slide 5: Paket & Harga ──────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Home Service", "Paket & Harga", "2 pilihan paket sesuai kebutuhan — bayar, duduk, dan tunggu kapster datang");
  footer(s, 5);

  // Single card
  card(s, 0.42, 1.6, 4.3, 3.4, { shadow:true });
  s.addShape(pres.ShapeType.rect, { x:0.42,y:1.6,w:4.3,h:0.55, fill:{color:C.card2}, line:{color:C.border} });
  s.addText("SINGLE", { x:0.52,y:1.62, w:4.1,h:0.5, fontSize:18, bold:true, color:C.white, fontFace:"Arial Black", align:"center" });
  s.addText("Rp", { x:1.2,y:2.4, w:0.6,h:0.5, fontSize:14, color:C.gray, valign:"middle" });
  s.addText("250.000", { x:1.6,y:2.2, w:2.5,h:0.9, fontSize:42, bold:true, color:C.white, fontFace:"Arial Black" });
  s.addText("per orang", { x:1.2,y:3.1, w:2.5,h:0.3, fontSize:11, color:C.gray, align:"center" });
  s.addShape(pres.ShapeType.rect, { x:0.72,y:3.5, w:3.7,h:0.02, fill:{color:C.border}, line:{color:C.border} });

  const singleItems = ["1 orang", "Pilih kapster favorit", "Radius maks. 5 KM", "Jam 06.00–23.00 WIB"];
  singleItems.forEach((it, i) => {
    s.addShape(pres.ShapeType.ellipse, { x:0.75, y:3.65+i*0.4, w:0.16,h:0.16, fill:{color:C.red}, line:{color:C.red} });
    s.addText(it, { x:1.05, y:3.6+i*0.4, w:3.4,h:0.32, fontSize:11, color:C.offW });
  });

  // Family card (featured)
  card(s, 5.3, 1.6, 4.3, 3.4, { fill:"1A1010", border:C.red, shadow:true });
  s.addShape(pres.ShapeType.rect, { x:5.3,y:1.6,w:4.3,h:0.55, fill:{color:C.redDim}, line:{color:C.red} });
  s.addText("FAMILY", { x:5.4,y:1.62, w:4.1,h:0.5, fontSize:18, bold:true, color:C.white, fontFace:"Arial Black", align:"center" });

  // Recommended badge
  s.addShape(pres.ShapeType.roundRect, { x:6.7,y:1.48, w:1.2,h:0.24, fill:{color:C.gold}, line:{color:C.gold}, rectRadius:0.04 });
  s.addText("⭐ HEMAT", { x:6.7,y:1.48, w:1.2,h:0.24, fontSize:8, bold:true, color:"000000", align:"center", valign:"middle" });

  s.addText("Rp", { x:6.05,y:2.4, w:0.6,h:0.5, fontSize:14, color:C.gray, valign:"middle" });
  s.addText("200.000", { x:6.45,y:2.2, w:2.5,h:0.9, fontSize:42, bold:true, color:C.red, fontFace:"Arial Black" });
  s.addText("per orang", { x:6.05,y:3.1, w:2.5,h:0.3, fontSize:11, color:C.gray, align:"center" });
  s.addShape(pres.ShapeType.rect, { x:5.6,y:3.5, w:3.7,h:0.02, fill:{color:C.border}, line:{color:C.border} });

  const famItems = ["Min. 2 orang", "Hemat Rp 50.000/orang", "Kapster sesuai pilihan", "Cocok untuk keluarga"];
  famItems.forEach((it, i) => {
    s.addShape(pres.ShapeType.ellipse, { x:5.63, y:3.65+i*0.4, w:0.16,h:0.16, fill:{color:C.green}, line:{color:C.green} });
    s.addText(it, { x:5.93, y:3.6+i*0.4, w:3.4,h:0.32, fontSize:11, color:C.offW });
  });
}

// ─── Slide 6: Flow Booking ───────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Home Service", "Flow Booking — 4 Langkah Mudah", "Sama seperti booking biasa, hanya tambahkan pilihan Home Service di awal");
  footer(s, 6);

  const steps = [
    { n:1, icon:"🏠", title:"Pilih Paket",   detail:"Kunjungi home-service.html\nPilih Single atau Family\nKlik tombol Booking" },
    { n:2, icon:"💈", title:"Pilih Kapster",  detail:"Pilih kapster favorit\ndari cabang manapun\nLihat slot tersedia" },
    { n:3, icon:"📅", title:"Pilih Jadwal",   detail:"Tentukan tanggal & jam\nJam 06.00 – 23.00 WIB\nKonfirmasi alamat tujuan" },
    { n:4, icon:"✅", title:"Konfirmasi",      detail:"Booking tersimpan\nKapster dihubungi admin\nReminder WA otomatis" },
  ];

  steps.forEach((st, i) => {
    const x = 0.42 + i * 2.38;
    // Arrow between steps
    if (i < 3) arrowRight(s, x + 1.88, 2.68);
    // Card
    card(s, x, 1.55, 2.25, 3.3, { fill: i===3?"1A1A10":C.card, border: i===3?C.red:C.border, shadow:true });
    // Step number circle
    s.addShape(pres.ShapeType.ellipse, { x:x+0.88,y:1.68, w:0.5,h:0.5, fill:{color:C.red}, line:{color:C.red} });
    s.addText(String(st.n), { x:x+0.88,y:1.68, w:0.5,h:0.5, fontSize:14, bold:true, color:"FFFFFF", align:"center", valign:"middle" });
    s.addText(st.icon, { x:x,y:2.3, w:2.25,h:0.48, fontSize:24, align:"center" });
    s.addText(st.title, { x:x,y:2.85, w:2.25,h:0.38, fontSize:12.5, bold:true, color:C.white, align:"center" });
    s.addShape(pres.ShapeType.rect, { x:x+0.78,y:3.28, w:0.68,h:0.025, fill:{color:C.red}, line:{color:C.red} });
    s.addText(st.detail, { x:x+0.08,y:3.38, w:2.1,h:1.25, fontSize:9.5, color:C.gray, align:"center", lineSpacingMultiple:1.5 });
  });
}

// ─── Slide 7: Peran Admin & Kapster ─────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Home Service", "Peran Admin & Kapster", "Siapa bertanggung jawab atas apa dalam alur Home Service");
  footer(s, 7);

  // Admin col
  card(s, 0.42, 1.6, 4.3, 3.4, { fill:C.card2, shadow:true });
  s.addShape(pres.ShapeType.rect, { x:0.42,y:1.6,w:4.3,h:0.45, fill:{color:C.card2}, line:{color:C.border} });
  s.addText("👨‍💼  ADMIN", { x:0.52,y:1.62, w:4.1,h:0.4, fontSize:14, bold:true, color:C.white });

  const adminTasks = [
    "Terima notifikasi booking masuk via WA",
    "Konfirmasi ketersediaan kapster",
    "Koordinasi dengan kapster untuk waktu & lokasi",
    "Kirim update ke pelanggan bila ada perubahan",
    "Monitor status booking di dashboard",
  ];
  adminTasks.forEach((t, i) => {
    s.addShape(pres.ShapeType.ellipse, { x:0.62,y:2.22+i*0.52, w:0.16,h:0.16, fill:{color:C.red}, line:{color:C.red} });
    s.addText(t, { x:0.88,y:2.16+i*0.52, w:3.7,h:0.44, fontSize:10.5, color:C.offW, lineSpacingMultiple:1.3 });
  });

  // Kapster col
  card(s, 5.3, 1.6, 4.3, 3.4, { fill:C.card2, shadow:true });
  s.addShape(pres.ShapeType.rect, { x:5.3,y:1.6,w:4.3,h:0.45, fill:{color:C.card2}, line:{color:C.border} });
  s.addText("💈  KAPSTER", { x:5.4,y:1.62, w:4.1,h:0.4, fontSize:14, bold:true, color:C.white });

  const kapsterTasks = [
    "Terima info booking dari admin",
    "Siapkan peralatan sebelum keberangkatan",
    "Berangkat sesuai jadwal yang disepakati",
    "Lakukan grooming di lokasi pelanggan",
    "Konfirmasi selesai kepada admin cabang",
  ];
  kapsterTasks.forEach((t, i) => {
    s.addShape(pres.ShapeType.ellipse, { x:5.48,y:2.22+i*0.52, w:0.16,h:0.16, fill:{color:C.gold}, line:{color:C.gold} });
    s.addText(t, { x:5.76,y:2.16+i*0.52, w:3.7,h:0.44, fontSize:10.5, color:C.offW, lineSpacingMultiple:1.3 });
  });
}

// ════════════════════════════════════════════════════════════════
// SECTION 3 — WA AI BOT
// ════════════════════════════════════════════════════════════════
sectionSlide(3, "WA AI Bot 5 Cabang", "AI auto-reply 24/7 — setiap cabang punya asisten pintar sendiri");

// ─── Slide 8: Konsep WA Bot ──────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "WA Bot", "Apa itu WA AI Bot?", "Asisten virtual berbasis AI yang menjawab chat pelanggan secara otomatis");
  footer(s, 8);

  const features = [
    { icon:"🤖", title:"Auto-Reply 24/7",     detail:"Bot AI aktif sepanjang hari tanpa istirahat, membalas chat pelanggan real-time" },
    { icon:"🧠", title:"Memori Percakapan",    detail:"Bot ingat konteks obrolan — tidak perlu pelanggan mengulang informasi yang sama" },
    { icon:"🔀", title:"Routing ke Booking",   detail:"Semua pertanyaan booking diarahkan ke website agar data tercatat di sistem" },
    { icon:"📩", title:"Forward ke Admin",      detail:"Setiap booking yang masuk langsung diteruskan ke WA admin cabang yang bersangkutan" },
  ];

  features.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.42 + col * 4.82, y = 1.58 + row * 1.68;
    card(s, x, y, 4.6, 1.52, { shadow:true });
    s.addText(f.icon, { x:x+0.15,y:y+0.25, w:0.7,h:0.7, fontSize:26, align:"center", valign:"middle" });
    s.addText(f.title, { x:x+0.95,y:y+0.15, w:3.5,h:0.42, fontSize:13, bold:true, color:C.white });
    s.addText(f.detail, { x:x+0.95,y:y+0.58, w:3.5,h:0.7, fontSize:10, color:C.gray, lineSpacingMultiple:1.4 });
  });
}

// ─── Slide 9: 5 Nomor Cabang ─────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "WA Bot", "5 Nomor WA per Cabang", "Setiap cabang punya nomor WA sendiri — bot otomatis tahu cabang mana yang menerima pesan");
  footer(s, 9);

  const branches = [
    { name:"RedBox Bypass (Pusat)",  num:"0818-2025-69", status:"Aktif",   color:C.green },
    { name:"RedBox Samadikun",       num:"0818-2025-89", status:"Aktif",   color:C.green },
    { name:"RedBox CSB Mall",        num:"0818-2028-89", status:"Aktif",   color:C.green },
    { name:"RedBox Sumber",          num:"0818-2025-99", status:"Aktif",   color:C.green },
    { name:"RedBox Tegal",           num:"0818-268-883", status:"Aktif",   color:C.green },
  ];

  branches.forEach((b, i) => {
    const y = 1.55 + i * 0.76;
    card(s, 0.42, y, 9.2, 0.66, { shadow: i===0 });
    // No indicator
    s.addShape(pres.ShapeType.ellipse, { x:0.55,y:y+0.24, w:0.2,h:0.2, fill:{color:b.color}, line:{color:b.color} });
    // Name
    s.addText(`0${i+1}  ${b.name}`, { x:0.9,y:y+0.1, w:4.5,h:0.44, fontSize:13, bold:true, color:C.white });
    // Number
    s.addText(b.num, { x:5.5,y:y+0.1, w:2.4,h:0.44, fontSize:13, color:C.offW, fontFace:"Courier New" });
    // Status badge
    s.addShape(pres.ShapeType.roundRect, { x:8.3,y:y+0.14, w:1.15,h:0.36, fill:{color:"0D2A16"}, line:{color:b.color}, rectRadius:0.05 });
    s.addText(b.status, { x:8.3,y:y+0.14, w:1.15,h:0.36, fontSize:9.5, bold:true, color:b.color, align:"center", valign:"middle" });
  });
}

// ─── Slide 10: Flow Percakapan ───────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "WA Bot", "Flow Percakapan WA Bot", "Bagaimana bot AI menangani pesan dari pelanggan hingga booking terkonfirmasi");
  footer(s, 10);

  const steps = [
    { icon:"💬", label:"Pelanggan\nKirim Pesan",    detail:"Tanya info, minta\nbooking, atau ngobrol" },
    { icon:"🤖", label:"AI Analisis\n& Balas",       detail:"GPT-4o memproses\n& menjawab dalam detik" },
    { icon:"🔗", label:"Redirect ke\nWebsite Booking",detail:"Semua booking diarahkan\nke sistem online" },
    { icon:"📩", label:"Notif ke\nAdmin Cabang",     detail:"Booking masuk langsung\ndikirim ke WA admin" },
    { icon:"✅", label:"Booking\nTerkonfirmasi",      detail:"Data tersimpan di\nSupabase & dashboard" },
  ];

  steps.forEach((st, i) => {
    const x = 0.42 + i * 1.88;
    if (i < 4) arrowRight(s, x+1.52, 2.72);
    card(s, x, 1.55, 1.78, 3.22, { fill: i===4?"111A0D":C.card, border: i===4?C.green:C.border, shadow:true });
    s.addText(st.icon, { x,y:1.68, w:1.78,h:0.55, fontSize:26, align:"center" });
    s.addText(st.label, { x,y:2.3, w:1.78,h:0.62, fontSize:10.5, bold:true, color:C.white, align:"center", lineSpacingMultiple:1.35 });
    s.addShape(pres.ShapeType.rect, { x:x+0.58,y:2.96, w:0.62,h:0.025, fill:{color:C.red}, line:{color:C.red} });
    s.addText(st.detail, { x,y:3.1, w:1.78,h:0.88, fontSize:9, color:C.gray, align:"center", lineSpacingMultiple:1.4 });
  });
}

// ─── Slide 11: Human Takeover ────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "WA Bot", "Human Takeover — Admin Bisa Ambil Alih", "Saat admin perlu balas manual, AI otomatis berhenti sementara");
  footer(s, 11);

  // Visual timeline
  const items = [
    { icon:"💬", y:1.68, label:"Pelanggan kirim pesan", detail:"Bot AI biasanya auto-balas", color:C.gray },
    { icon:"👨‍💼", y:2.58, label:"ADMIN membalas dari HP", detail:"Sistem deteksi — ini bukan bot", color:C.gold, highlight:true },
    { icon:"⏸️",  y:3.48, label:"AI pause selama 30 menit", detail:"Bot tidak aktif, admin handle manual", color:C.red },
    { icon:"▶️",  y:4.38, label:"AI aktif kembali otomatis", detail:"Setelah 30 menit, bot langsung siap lagi", color:C.green },
  ];

  items.forEach((it, i) => {
    if (i < items.length-1) {
      s.addShape(pres.ShapeType.rect, { x:0.87,y:it.y+0.42, w:0.04,h:0.82, fill:{color:C.border}, line:{color:C.border} });
    }
    s.addShape(pres.ShapeType.ellipse, { x:0.72,y:it.y+0.03, w:0.36,h:0.36, fill:{color:it.color}, line:{color:it.color} });
    s.addText(it.icon, { x:0.72,y:it.y+0.03, w:0.36,h:0.36, fontSize:14, align:"center", valign:"middle" });

    if (it.highlight) {
      card(s, 1.28,it.y-0.06, 8.2,0.54, { fill:"201800", border:C.gold });
    }
    s.addText(it.label, { x:1.35,y:it.y, w:5.5,h:0.28, fontSize:12.5, bold:true, color:it.highlight?C.gold:C.white });
    s.addText(it.detail, { x:1.35,y:it.y+0.28, w:5.5,h:0.26, fontSize:10, color:C.gray });
  });

  // Note box
  card(s, 6.2, 1.6, 3.4, 3.42, { fill:"0D1520", border:"334466" });
  s.addText("💡  TIPS ADMIN", { x:6.3,y:1.72, w:3.2,h:0.3, fontSize:9, bold:true, color:"6699CC", charSpacing:1 });
  const tips = [
    "Balas hanya saat perlu handle\nkasus khusus atau komplain",
    "AI akan otomatis aktif lagi,\ntidak perlu setting apapun",
    "Cukup 1 balasan dari HP admin\nuntuk aktivasi human takeover",
  ];
  tips.forEach((t, i) => {
    s.addShape(pres.ShapeType.ellipse, { x:6.32,y:2.2+i*0.88, w:0.14,h:0.14, fill:{color:"6699CC"}, line:{color:"6699CC"} });
    s.addText(t, { x:6.55,y:2.14+i*0.88, w:2.9,h:0.72, fontSize:9.5, color:C.offW, lineSpacingMultiple:1.4 });
  });
}

// ─── Slide 12: 4 Jenis Reminder ─────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "WA Bot", "4 Jenis Reminder Otomatis via WA", "Semua dikirim otomatis — tanpa perlu admin kirim manual satu per satu");
  footer(s, 12);

  const reminders = [
    { icon:"📅", title:"H-1 Booking",         time:"Setiap hari jam 10.00 WIB",      detail:"Reminder besok ada jadwal, nama kapster, lokasi cabang", color:C.red },
    { icon:"⏰", title:"1 Jam Sebelum",        time:"Setiap jam (on the hour)",        detail:"Pengingat 1 jam sebelum jadwal — ajak pelanggan berangkat sekarang", color:C.gold },
    { icon:"🎂", title:"Ulang Tahun",           time:"Setiap hari jam 08.00 WIB",      detail:"Ucapan selamat ultah + penawaran spesial untuk pelanggan setia", color:C.purple },
    { icon:"🔔", title:"Re-engagement",        time:"Otomatis setelah 30 hari tidak kunjung", detail:"Pelanggan yang lama tidak datang diingatkan kembali ke Redbox", color:C.green },
  ];

  reminders.forEach((r, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.42 + col * 4.82, y = 1.55 + row * 1.82;
    card(s, x, y, 4.6, 1.65, { shadow:true });
    s.addShape(pres.ShapeType.rect, { x,y, w:0.055,h:1.65, fill:{color:r.color}, line:{color:r.color} });
    s.addText(r.icon, { x:x+0.2,y:y+0.2, w:0.7,h:0.65, fontSize:28, align:"center" });
    s.addText(r.title, { x:x+1.05,y:y+0.1, w:3.4,h:0.38, fontSize:13, bold:true, color:C.white });
    s.addShape(pres.ShapeType.roundRect, { x:x+1.05,y:y+0.5, w:3.0,h:0.22, fill:{color:C.card2}, line:{color:C.border}, rectRadius:0.04 });
    s.addText(r.time, { x:x+1.05,y:y+0.5, w:3.0,h:0.22, fontSize:8, color:C.gray, align:"center", valign:"middle" });
    s.addText(r.detail, { x:x+1.05,y:y+0.82, w:3.4,h:0.72, fontSize:9.5, color:C.offW, lineSpacingMultiple:1.4 });
  });
}

// ════════════════════════════════════════════════════════════════
// SECTION 4 — WEDDING PACKAGE
// ════════════════════════════════════════════════════════════════
sectionSlide(4, "Wedding Package", "Grooming premium untuk pengantin & rombongan — kapster datang ke venue");

// ─── Slide 13: Konsep ────────────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Wedding", "Apa itu Wedding Package?", "Layanan grooming eksklusif untuk hari paling istimewa — kapster kami datang ke venue pernikahan");
  footer(s, 13);

  const pts = [
    { icon:"💍", title:"Untuk Siapa?",       detail:"Pengantin pria, best man, ayah pengantin, pagar ayu pria — semua rombongan wedding" },
    { icon:"🚗", title:"Kapster ke Venue",    detail:"Kapster datang ke lokasi resepsi, gedung pernikahan, rumah, atau hotel" },
    { icon:"👥", title:"Rombongan 1–4 Orang", detail:"Bisa booking untuk 1 orang hingga seluruh rombongan pria (4+ orang koordinasi langsung)" },
    { icon:"⭐", title:"Standar Premium",     detail:"Layanan sama seperti di cabang, dengan peralatan profesional dibawa kapster" },
  ];

  pts.forEach((p, i) => {
    const col = i%2, row = Math.floor(i/2);
    const x = 0.42+col*4.82, y = 1.55+row*1.82;
    card(s, x, y, 4.6, 1.66, { shadow:true });
    s.addText(p.icon, { x:x+0.18,y:y+0.25, w:0.8,h:0.8, fontSize:30, align:"center" });
    s.addText(p.title, { x:x+1.1,y:y+0.1, w:3.35,h:0.4, fontSize:13, bold:true, color:C.white });
    s.addText(p.detail, { x:x+1.1,y:y+0.54, w:3.35,h:0.88, fontSize:10, color:C.gray, lineSpacingMultiple:1.45 });
  });
}

// ─── Slide 14: Paket & Harga Wedding ────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Wedding", "Pilihan Paket & Harga", "Home Service Wedding dan Wedding Package CSB — fleksibel sesuai kebutuhan");
  footer(s, 14);

  // Left: Home Service Wedding
  card(s, 0.42, 1.55, 4.5, 3.42, { fill:C.card2, shadow:true });
  s.addShape(pres.ShapeType.rect, { x:0.42,y:1.55,w:4.5,h:0.48, fill:{color:C.redDim}, line:{color:C.red} });
  s.addText("HOME SERVICE WEDDING", { x:0.52,y:1.56, w:4.3,h:0.45, fontSize:11.5, bold:true, color:C.white, align:"center" });

  const hsW = [
    { label:"1 Orang",              price:"Rp 350.000" },
    { label:"2 Orang (+ Best Man)", price:"Rp 500.000" },
    { label:"3 Orang",              price:"Rp 750.000" },
    { label:"4 Orang & Rombongan",  price:"Rp 1.000.000" },
  ];
  hsW.forEach((p, i) => {
    s.addShape(pres.ShapeType.rect, { x:0.55,y:2.18+i*0.68, w:4.2,h:0.55, fill:{color:i%2===0?C.card:C.card2}, line:{color:C.border} });
    s.addText(p.label, { x:0.68,y:2.2+i*0.68, w:2.5,h:0.5, fontSize:10.5, color:C.offW, valign:"middle" });
    s.addText(p.price, { x:3.1,y:2.2+i*0.68, w:1.55,h:0.5, fontSize:12, bold:true, color:C.red, align:"right", valign:"middle" });
  });
  s.addText("*Kapster datang ke lokasi · Durasi ~2–2.5 jam", { x:0.52,y:4.66, w:4.2,h:0.28, fontSize:8.5, color:C.gray });

  // Right: CSB Wedding Packages
  card(s, 5.1, 1.55, 4.5, 3.42, { fill:C.card2, shadow:true });
  s.addShape(pres.ShapeType.rect, { x:5.1,y:1.55,w:4.5,h:0.48, fill:{color:C.card2}, line:{color:C.border} });
  s.addText("WEDDING PACKAGE CSB MALL", { x:5.2,y:1.56, w:4.3,h:0.45, fontSize:11.5, bold:true, color:C.white, align:"center" });

  const csbW = [
    { name:"Wedding Royal Grooming",      price:"Rp 510.000", detail:"Paket lengkap premium" },
    { name:"Wedding Gentlemen Grooming",  price:"Rp 360.000", detail:"Paket menengah terbaik" },
    { name:"Wedding Noble Grooming",      price:"Rp 210.000", detail:"Paket entry terjangkau" },
  ];
  csbW.forEach((p, i) => {
    card(s, 5.2, 2.18+i*0.95, 4.2, 0.82, { fill: i===1?"1A1510":C.card, border: i===1?C.gold:C.border });
    if (i===1) badge(s, "TERPOPULER", 8.0, 2.2+i*0.95, { bg:C.goldDim });
    s.addText(p.name, { x:5.35,y:2.25+i*0.95, w:3.3,h:0.34, fontSize:10.5, bold:true, color:i===1?C.gold:C.white });
    s.addText(p.detail, { x:5.35,y:2.6+i*0.95, w:2.0,h:0.28, fontSize:9, color:C.gray });
    s.addText(p.price, { x:7.3,y:2.25+i*0.95, w:1.95,h:0.6, fontSize:13, bold:true, color:i===1?C.gold:C.red, align:"right", valign:"middle" });
  });
  s.addText("*Di cabang CSB Mall — pengantin + home service", { x:5.2,y:4.66, w:4.2,h:0.28, fontSize:8.5, color:C.gray });
}

// ─── Slide 15: Flow Booking Wedding ──────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Wedding", "Flow Booking Wedding", "Proses booking wedding lebih terencana — lakukan minimal H-3 sebelum acara");
  footer(s, 15);

  const steps = [
    { icon:"📱", n:"1", title:"Hubungi Admin\natau Buka Website", detail:"Via WA Bot cabang\natau langsung ke\nbooking page" },
    { icon:"📋", n:"2", title:"Pilih Paket\n& Tanggal Acara",   detail:"Konfirmasi jumlah\norang, venue,\ndan jam acara" },
    { icon:"💬", n:"3", title:"Koordinasi\nKapster",             detail:"Admin matching\nkapster terbaik\nsesuai jadwal" },
    { icon:"✅", n:"4", title:"Konfirmasi\n& DP (bila perlu)",  detail:"Booking dikunci,\nkapster standby\nuntuk hari-H" },
    { icon:"💈", n:"5", title:"Hari-H\nKapster Hadir",          detail:"Kapster tiba di\nvenue sesuai waktu\nyang disepakati" },
  ];

  steps.forEach((st, i) => {
    const x = 0.42 + i * 1.88;
    if (i < 4) arrowRight(s, x+1.52, 2.68);
    card(s, x, 1.55, 1.78, 3.22, { fill:i===4?"111A0D":C.card, border:i===4?C.green:C.border, shadow:true });
    s.addShape(pres.ShapeType.ellipse, { x:x+0.68,y:1.65, w:0.44,h:0.44, fill:{color:C.red}, line:{color:C.red} });
    s.addText(st.n, { x:x+0.68,y:1.65, w:0.44,h:0.44, fontSize:13, bold:true, color:"FFFFFF", align:"center", valign:"middle" });
    s.addText(st.icon, { x,y:2.22, w:1.78,h:0.48, fontSize:24, align:"center" });
    s.addText(st.title, { x,y:2.76, w:1.78,h:0.52, fontSize:10, bold:true, color:C.white, align:"center", lineSpacingMultiple:1.3 });
    s.addShape(pres.ShapeType.rect, { x:x+0.58,y:3.32, w:0.62,h:0.025, fill:{color:C.red}, line:{color:C.red} });
    s.addText(st.detail, { x:x+0.05,y:3.42, w:1.7,h:0.98, fontSize:9, color:C.gray, align:"center", lineSpacingMultiple:1.45 });
  });
}

// ─── Slide 16: Tips Admin Wedding ────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Wedding", "Panduan Admin — Handle Booking Wedding", "Wedding adalah prioritas — pelanggan mengandalkan kita di momen terpenting mereka");
  footer(s, 16);

  const tips = [
    { icon:"📅", title:"Booking Minimal H-3",         detail:"Ingatkan pelanggan untuk booking paling lambat 3 hari sebelum acara agar kapster bisa disiapkan" },
    { icon:"💈", title:"Prioritaskan Kapster Senior",  detail:"Untuk acara wedding, pilihkan kapster paling berpengalaman. Jangan assign kapster baru untuk wedding" },
    { icon:"📍", title:"Konfirmasi Alamat Venue Jelas", detail:"Pastikan admin menerima alamat lengkap + nomor kontak PIC di venue sebelum hari-H" },
    { icon:"📞", title:"Cek H-1 dengan Kapster",       detail:"Admin wajib konfirmasi ulang dengan kapster 1 hari sebelum acara — pastikan tidak ada bentrok jadwal" },
    { icon:"🕐", title:"Tiba 30 Menit Sebelum Waktu", detail:"Kapster disarankan tiba 30 menit lebih awal dari waktu yang diminta pelanggan" },
    { icon:"📷", title:"Dokumentasi Hasil (Opsional)", detail:"Foto hasil grooming pengantin bisa menjadi portofolio — minta izin pelanggan sebelum posting" },
  ];

  tips.forEach((t, i) => {
    const col = i%2, row = Math.floor(i/3);
    const x = 0.42+col*4.82, y = 1.55+Math.floor(i/2)*1.42;
    card(s, x, y, 4.6, 1.3, { shadow:false });
    s.addText(t.icon, { x:x+0.15,y:y+0.12, w:0.6,h:0.6, fontSize:22, align:"center" });
    s.addText(t.title, { x:x+0.85,y:y+0.08, w:3.6,h:0.36, fontSize:12, bold:true, color:C.white });
    s.addText(t.detail, { x:x+0.85,y:y+0.46, w:3.6,h:0.72, fontSize:9.5, color:C.gray, lineSpacingMultiple:1.35 });
  });
}

// ════════════════════════════════════════════════════════════════
// SECTION 5 — MEMBERSHIP
// ════════════════════════════════════════════════════════════════
sectionSlide(5, "Membership & Reward", "Kumpulkan poin setiap kunjungan — semakin sering datang, semakin besar benefitnya");

// ─── Slide 17: Program Poin ──────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Membership", "Program Poin RedBox", "Setiap kunjungan menghasilkan poin yang bisa ditukar menjadi diskon nyata");
  footer(s, 17);

  const pts = [
    { icon:"💈", title:"Setiap Kunjungan",      detail:"Setiap transaksi di cabang menghasilkan poin — semakin sering datang, poin semakin terkumpul", color:C.red },
    { icon:"⭐", title:"Google Review 5 Bintang", detail:"Kasih ulasan positif 5⭐ di Google = 5 poin bonus (senilai Rp 50.000) masuk otomatis ke akun", color:C.gold },
    { icon:"💰", title:"Poin = Diskon Nyata",    detail:"Poin yang terkumpul bisa ditukar langsung menjadi potongan harga di kunjungan berikutnya", color:C.green },
    { icon:"📱", title:"Cek via Member Dashboard", detail:"Pelanggan bisa cek saldo poin, histori kunjungan, dan tier saat ini di member-dashboard.html", color:C.purple },
  ];

  pts.forEach((p, i) => {
    const col = i%2, row = Math.floor(i/2);
    const x = 0.42+col*4.82, y = 1.55+row*1.82;
    card(s, x, y, 4.6, 1.66, { shadow:true });
    s.addShape(pres.ShapeType.rect, { x,y, w:0.055,h:1.66, fill:{color:p.color}, line:{color:p.color} });
    s.addText(p.icon, { x:x+0.2,y:y+0.25, w:0.7,h:0.75, fontSize:28, align:"center" });
    s.addText(p.title, { x:x+1.05,y:y+0.1, w:3.4,h:0.4, fontSize:13, bold:true, color:C.white });
    s.addText(p.detail, { x:x+1.05,y:y+0.55, w:3.4,h:0.88, fontSize:10, color:C.gray, lineSpacingMultiple:1.45 });
  });
}

// ─── Slide 18: 4 Tier ────────────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Membership", "4 Tier Keanggotaan", "Semakin banyak poin, semakin tinggi tier, semakin besar diskon dan benefit eksklusif");
  footer(s, 18);

  const tiers = [
    { name:"BRONZE",   icon:"🥉", range:"0 – 499 poin",  disc:"Mulai 0%", color:"CD7F32", tagline:"Mulai perjalanan member" },
    { name:"SILVER",   icon:"🥈", range:"500 – 999 poin", disc:"s/d 5%",   color:"9CA3AF", tagline:"Benefit lebih menggiurkan" },
    { name:"GOLD",     icon:"🏆", range:"1.000 – 1.999",  disc:"s/d 10%",  color:"FBBF24", tagline:"Member setia terpilih",   featured:true },
    { name:"PLATINUM", icon:"💎", range:"2.000+ poin",    disc:"s/d 15%",  color:"A78BFA", tagline:"Puncak loyalitas Redbox" },
  ];

  tiers.forEach((t, i) => {
    const x = 0.42+i*2.38;
    const yOffset = t.featured ? -0.12 : 0;
    card(s, x, 1.55+yOffset, 2.2, 3.55, { fill:C.card2, border:t.featured?t.color:C.border, shadow:t.featured });
    if (t.featured) {
      s.addShape(pres.ShapeType.roundRect, { x:x+0.4,y:1.35, w:1.4,h:0.28, fill:{color:t.color}, line:{color:t.color}, rectRadius:0.04 });
      s.addText("PALING POPULER", { x:x+0.4,y:1.35, w:1.4,h:0.28, fontSize:7.5, bold:true, color:"000000", align:"center", valign:"middle" });
    }
    s.addText(t.icon, { x,y:1.72+yOffset, w:2.2,h:0.6, fontSize:30, align:"center" });
    s.addText(t.name, { x,y:2.38+yOffset, w:2.2,h:0.36, fontSize:14, bold:true, color:`${t.color}`, align:"center", fontFace:"Arial Black" });
    s.addText(t.range, { x,y:2.78+yOffset, w:2.2,h:0.28, fontSize:9, color:C.gray, align:"center" });
    s.addShape(pres.ShapeType.rect, { x:x+0.55,y:3.1+yOffset, w:1.1,h:0.025, fill:{color:t.color}, line:{color:t.color} });
    s.addShape(pres.ShapeType.roundRect, { x:x+0.38,y:3.2+yOffset, w:1.44,h:0.38, fill:{color:t.featured?"000000":"0A0A0A"}, line:{color:t.color}, rectRadius:0.06 });
    s.addText(t.disc, { x:x+0.38,y:3.2+yOffset, w:1.44,h:0.38, fontSize:13, bold:true, color:`${t.color}`, align:"center", valign:"middle" });
    s.addText("diskon", { x:x+0.38,y:3.58+yOffset, w:1.44,h:0.22, fontSize:8, color:C.gray, align:"center" });
    s.addText(t.tagline, { x,y:3.9+yOffset, w:2.2,h:0.55, fontSize:9, color:C.gray, align:"center", lineSpacingMultiple:1.3 });
  });
}

// ─── Slide 19: Cara Dapat & Redeem Poin ─────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Membership", "Cara Dapat & Gunakan Poin", "Dua cara mudah kumpulkan poin, satu cara tukar jadi diskon nyata");
  footer(s, 19);

  // Left: earn
  card(s, 0.42, 1.55, 4.5, 3.42, { shadow:true });
  s.addText("💰  CARA DAPAT POIN", { x:0.55,y:1.65, w:4.2,h:0.35, fontSize:12, bold:true, color:C.red });
  s.addShape(pres.ShapeType.rect, { x:0.55,y:2.06, w:4.22,h:0.02, fill:{color:C.border}, line:{color:C.border} });

  const earn = [
    { how:"Setiap Kunjungan ke Cabang", detail:"Poin dihitung dari jumlah transaksi — semakin besar transaksi, semakin banyak poin terkumpul" },
    { how:"Google Review Bintang 5",   detail:"Berikan ulasan positif 5⭐ di Google Maps → otomatis 5 poin (Rp 50.000) masuk ke akun member" },
  ];
  earn.forEach((e, i) => {
    s.addShape(pres.ShapeType.ellipse, { x:0.58,y:2.28+i*1.42, w:0.22,h:0.22, fill:{color:C.gold}, line:{color:C.gold} });
    s.addText(e.how, { x:0.9,y:2.22+i*1.42, w:3.85,h:0.36, fontSize:12, bold:true, color:C.white });
    s.addText(e.detail, { x:0.9,y:2.6+i*1.42, w:3.85,h:0.56, fontSize:10, color:C.gray, lineSpacingMultiple:1.4 });
  });

  // Right: redeem
  card(s, 5.1, 1.55, 4.5, 3.42, { shadow:true });
  s.addText("🎁  CARA TUKAR POIN", { x:5.23,y:1.65, w:4.2,h:0.35, fontSize:12, bold:true, color:C.green });
  s.addShape(pres.ShapeType.rect, { x:5.23,y:2.06, w:4.22,h:0.02, fill:{color:C.border}, line:{color:C.border} });

  const redeem = [
    { step:"1", label:"Kunjungi Website / Cabang",    detail:"Buka member-dashboard.html atau datang langsung ke kasir cabang" },
    { step:"2", label:"Kasir Cek Akun Member",        detail:"Admin/kasir melihat saldo poin pelanggan di sistem dashboard" },
    { step:"3", label:"Poin Dipotong dari Tagihan",   detail:"Jumlah poin ditukar otomatis menjadi potongan sesuai tier yang berlaku" },
  ];
  redeem.forEach((r, i) => {
    s.addShape(pres.ShapeType.ellipse, { x:5.22,y:2.24+i*0.98, w:0.28,h:0.28, fill:{color:C.green}, line:{color:C.green} });
    s.addText(r.step, { x:5.22,y:2.24+i*0.98, w:0.28,h:0.28, fontSize:9, bold:true, color:"000000", align:"center", valign:"middle" });
    s.addText(r.label, { x:5.62,y:2.2+i*0.98, w:3.8,h:0.34, fontSize:11.5, bold:true, color:C.white });
    s.addText(r.detail, { x:5.62,y:2.56+i*0.98, w:3.8,h:0.52, fontSize:10, color:C.gray, lineSpacingMultiple:1.35 });
  });

  // Note
  s.addText("💡  Link review dikirim otomatis via WA, 30 menit setelah selesai service — admin tidak perlu kirim manual.", {
    x:0.42, y:5.1, w:9.2, h:0.32, fontSize:9, color:C.gray,
  });
}

// ─── Slide 20: Flow Member Journey ──────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Membership", "Perjalanan Menjadi Member Setia", "Dari pertama daftar hingga Platinum — setiap langkah memberi nilai lebih");
  footer(s, 20);

  const journey = [
    { icon:"📝", label:"Daftar Member",       detail:"Buka membership.html\nIsi data, buat akun" },
    { icon:"💈", label:"Kunjungan Pertama",    detail:"Datang ke cabang\nTransaksi = poin mulai\nterkumpul" },
    { icon:"⭐", label:"Review & Poin Bonus",  detail:"Beri ulasan Google 5⭐\n5 poin langsung\nmasuk akun" },
    { icon:"📈", label:"Naik Tier",            detail:"Semakin banyak poin\nSilver → Gold →\nPlatinum" },
    { icon:"🎁", label:"Redeem & Nikmati",     detail:"Tukar poin jadi\ndiskon di kunjungan\nberikutnya" },
  ];

  journey.forEach((j, i) => {
    const x = 0.42 + i * 1.88;
    if (i < 4) arrowRight(s, x+1.52, 2.68);
    const isLast = i===4;
    card(s, x, 1.55, 1.78, 3.22, { fill:isLast?"0D1A0D":C.card, border:isLast?C.gold:C.border, shadow:true });
    s.addText(j.icon, { x,y:1.68, w:1.78,h:0.55, fontSize:26, align:"center" });
    s.addShape(pres.ShapeType.rect, { x:x+0.55,y:2.3, w:0.68,h:0.025, fill:{color:C.red}, line:{color:C.red} });
    s.addText(j.label, { x,y:2.42, w:1.78,h:0.42, fontSize:11, bold:true, color:isLast?C.gold:C.white, align:"center" });
    s.addText(j.detail, { x:x+0.06,y:2.98, w:1.66,h:1.12, fontSize:9, color:C.gray, align:"center", lineSpacingMultiple:1.45 });
  });
}

// ════════════════════════════════════════════════════════════════
// SECTION 6 — AI GROOMING (MEMBER ONLY)
// ════════════════════════════════════════════════════════════════
sectionSlide(6, "AI Grooming Consultant", "Fitur eksklusif member — analisis wajah & simulasi gaya rambut berbasis AI");

// ─── Slide 21: Apa itu AI Grooming ──────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "AI Grooming", "Apa itu AI Grooming Consultant?", "Teknologi AI yang menganalisis wajah dan merekomendasikan gaya rambut terbaik — eksklusif member");
  footer(s, 21);

  // Member-only badge center
  s.addShape(pres.ShapeType.roundRect, { x:3.8,y:1.55, w:2.45,h:0.38, fill:{color:C.redDim}, line:{color:C.red}, rectRadius:0.06 });
  s.addText("🔒  KHUSUS MEMBER AKTIF", { x:3.8,y:1.55, w:2.45,h:0.38, fontSize:10, bold:true, color:C.white, align:"center", valign:"middle" });

  const pts = [
    { icon:"📸", title:"Upload Foto",           detail:"Member upload foto wajah langsung dari website. Foto diproses aman di server kami" },
    { icon:"🧠", title:"AI Analisis Wajah",     detail:"AI mendeteksi bentuk wajah, jenis rambut, densitas, dan tekstur secara otomatis" },
    { icon:"✂️", title:"Rekomendasi Gaya",      detail:"4 gaya rambut terbaik direkomendasikan AI berdasarkan analisis — lengkap dengan alasannya" },
    { icon:"🖼️", title:"Simulasi Visual",       detail:"AI generate foto preview — lihat tampilan gaya baru sebelum potong beneran" },
  ];

  pts.forEach((p, i) => {
    const col = i%2, row = Math.floor(i/2);
    const x = 0.42+col*4.82, y = 2.15+row*1.72;
    card(s, x, y, 4.6, 1.56, { shadow:true });
    s.addText(p.icon, { x:x+0.18,y:y+0.22, w:0.75,h:0.75, fontSize:28, align:"center" });
    s.addText(p.title, { x:x+1.1,y:y+0.1, w:3.35,h:0.4, fontSize:13, bold:true, color:C.white });
    s.addText(p.detail, { x:x+1.1,y:y+0.54, w:3.35,h:0.82, fontSize:10, color:C.gray, lineSpacingMultiple:1.45 });
  });
}

// ─── Slide 22: 3 Fitur AI ────────────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "AI Grooming", "3 Fitur Utama AI Grooming", "Setiap fitur dirancang untuk memberikan konsultasi grooming berstandar GQ kepada member");
  footer(s, 22);

  const features = [
    {
      icon:"🔬",
      title:"AI Face Analysis",
      badge:"ANALISIS",
      bcolor:C.red,
      items:[
        "Deteksi bentuk wajah (oval, bulat, kotak, heart, diamond)",
        "Analisis jenis rambut: straight, wavy, curly, coily",
        "Cek densitas rambut: thin / medium / thick",
        "Saran produk styling (clay, paste, spray, powder)",
      ],
    },
    {
      icon:"💡",
      title:"Rekomendasi Gaya",
      badge:"REKOMENDASI",
      bcolor:C.gold,
      items:[
        "4 gaya terbaik direkomendasikan (Korean, Classic, Modern, Textured)",
        "5 gaya yang harus dihindari beserta alasannya",
        "Setiap gaya dilengkapi skor kesesuaian (1–100)",
        "Alasan mengapa gaya cocok untuk bentuk wajah itu",
      ],
    },
    {
      icon:"🖼️",
      title:"Simulasi Visual",
      badge:"SIMULASI",
      bcolor:C.purple,
      items:[
        "Pilih gaya dari daftar rekomendasi AI",
        "AI generate foto preview dengan gaya baru",
        "Lihat hasil sebelum potong beneran di cabang",
        "Tampilan premium cinematic — bukan filter biasa",
      ],
    },
  ];

  features.forEach((f, i) => {
    const x = 0.42+i*3.2;
    card(s, x, 1.52, 3.02, 3.7, { shadow:true });
    // Top bar
    s.addShape(pres.ShapeType.roundRect, { x:x+0.1,y:1.52, w:3.02,h:0.42, fill:{color:f.bcolor}, line:{color:f.bcolor}, rectRadius:0.08 });
    s.addText(`${f.icon}  ${f.badge}`, { x:x+0.1,y:1.52, w:3.02,h:0.42, fontSize:10.5, bold:true, color:"FFFFFF", align:"center", valign:"middle", charSpacing:1 });
    s.addText(f.title, { x:x+0.1,y:2.0, w:2.85,h:0.38, fontSize:13, bold:true, color:C.white, align:"center" });
    s.addShape(pres.ShapeType.rect, { x:x+1.1,y:2.42, w:0.82,h:0.025, fill:{color:f.bcolor}, line:{color:f.bcolor} });
    f.items.forEach((it, j) => {
      s.addShape(pres.ShapeType.ellipse, { x:x+0.22,y:2.64+j*0.62, w:0.14,h:0.14, fill:{color:f.bcolor}, line:{color:f.bcolor} });
      s.addText(it, { x:x+0.44,y:2.58+j*0.62, w:2.5,h:0.52, fontSize:9, color:C.offW, lineSpacingMultiple:1.35 });
    });
  });
}

// ─── Slide 23: Flow AI Grooming ──────────────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "AI Grooming", "Flow — Dari Login Hingga Hasil AI", "Hanya 4 langkah untuk mendapatkan konsultasi grooming berstandar premium");
  footer(s, 23);

  const steps = [
    { icon:"🔑", n:"1", title:"Login Member",       detail:"Buka website\nKlik tombol Member\nLogin dengan akun" },
    { icon:"📸", n:"2", title:"Upload Foto Wajah",  detail:"Klik tombol Upload\nFoto dari HP / laptop\nFormat JPG/PNG" },
    { icon:"⏳", n:"3", title:"AI Memproses",        detail:"Tunggu beberapa detik\nAI analisis otomatis\nTidak perlu isi form" },
    { icon:"✨", n:"4", title:"Lihat Hasil AI",      detail:"Rekomendasi gaya muncul\nPilih gaya & simulasikan\nScreenshot & tunjuk kapster" },
  ];

  steps.forEach((st, i) => {
    const x = 0.42 + i * 2.38;
    if (i < 3) arrowRight(s, x+1.9, 2.68);
    const isLast = i===3;
    card(s, x, 1.55, 2.25, 3.3, { fill:isLast?"100D1A":C.card, border:isLast?C.purple:C.border, shadow:true });
    s.addShape(pres.ShapeType.ellipse, { x:x+0.9,y:1.68, w:0.46,h:0.46, fill:{color:C.red}, line:{color:C.red} });
    s.addText(st.n, { x:x+0.9,y:1.68, w:0.46,h:0.46, fontSize:14, bold:true, color:"FFFFFF", align:"center", valign:"middle" });
    s.addText(st.icon, { x,y:2.28, w:2.25,h:0.5, fontSize:26, align:"center" });
    s.addText(st.title, { x,y:2.86, w:2.25,h:0.38, fontSize:12, bold:true, color:isLast?C.purple:C.white, align:"center" });
    s.addShape(pres.ShapeType.rect, { x:x+0.78,y:3.3, w:0.68,h:0.025, fill:{color:C.red}, line:{color:C.red} });
    s.addText(st.detail, { x:x+0.08,y:3.4, w:2.1,h:1.1, fontSize:9.5, color:C.gray, align:"center", lineSpacingMultiple:1.5 });
  });

  // Note
  card(s, 0.42, 5.05, 9.2, 0.38, { fill:C.card2 });
  s.addText("💡  Hasil rekomendasi bisa di-screenshot lalu ditunjukkan langsung ke kapster saat kunjungan ke cabang — kapster langsung tahu gaya yang diinginkan pelanggan!", {
    x:0.6, y:5.06, w:9.0, h:0.36, fontSize:9.5, color:C.offW,
  });
}

// ─── Slide 24: Cara Admin Guide Customer ────────────────────────
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "AI Grooming", "Cara Admin & Kapster Guide Pelanggan", "Bantu pelanggan menemukan dan menggunakan fitur AI Grooming dengan mudah");
  footer(s, 24);

  // Left: who can use
  card(s, 0.42, 1.55, 3.2, 3.42, { fill:C.card2, shadow:true });
  s.addText("🔒  SIAPA YANG BISA?", { x:0.55,y:1.65, w:2.95,h:0.32, fontSize:11, bold:true, color:C.red });
  s.addShape(pres.ShapeType.rect, { x:0.55,y:2.04, w:2.95,h:0.02, fill:{color:C.border}, line:{color:C.border} });

  const who = ["✅  Member aktif (sudah login)", "✅  Semua tier (Bronze s/d Platinum)", "❌  Non-member (harus daftar dulu)", "❌  Admin (bukan untuk akun admin)"];
  who.forEach((w, i) => {
    s.addText(w, { x:0.58,y:2.18+i*0.62, w:2.9,h:0.52, fontSize:10.5, color:i<2?C.green:C.gray, lineSpacingMultiple:1.3 });
  });
  s.addText("Bantu pelanggan daftar\nmember dulu bila belum\npunya akun!", { x:0.58,y:4.24, w:2.9,h:0.62, fontSize:9.5, color:C.gold, lineSpacingMultiple:1.4 });

  // Right: scripts admin
  card(s, 3.78, 1.55, 5.84, 3.42, { shadow:true });
  s.addText("💬  KALIMAT PANDUAN UNTUK ADMIN", { x:3.92,y:1.65, w:5.55,h:0.32, fontSize:11, bold:true, color:C.gold });
  s.addShape(pres.ShapeType.rect, { x:3.92,y:2.04, w:5.55,h:0.02, fill:{color:C.border}, line:{color:C.border} });

  const scripts = [
    { q:"Pelanggan tanya gaya rambut cocok", a:"\"Kak, coba fitur AI Grooming di website kami — upload foto, langsung muncul rekomendasi gaya terbaik buat bentuk wajah kakak! Gratis untuk member.\"" },
    { q:"Pelanggan belum jadi member", a:"\"Daftar member dulu kak, gratis dan cepat — buka membership.html lalu bisa langsung pakai AI Grooming plus dapat poin tiap kunjungan!\"" },
    { q:"Kapster: pelanggan tunjuk hasil AI", a:"Baca rekomendasi AI sebagai panduan — ini memudahkan kamu karena pelanggan sudah tahu gaya yang diinginkan sebelum duduk di kursi." },
  ];

  scripts.forEach((sc, i) => {
    s.addText(`Q: ${sc.q}`, { x:3.95,y:2.14+i*1.06, w:5.55,h:0.28, fontSize:9.5, bold:true, color:C.offW });
    card(s, 3.95, 2.44+i*1.06, 5.55, 0.58, { fill:C.card2, border:C.border });
    s.addText(sc.a, { x:4.08,y:2.46+i*1.06, w:5.3,h:0.52, fontSize:9, color:C.gray, lineSpacingMultiple:1.35 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 25 — EKOSISTEM LENGKAP
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bgDark(s);
  slideHeader(s, "Ringkasan", "Ekosistem Lengkap RedBox 2026", "Semua fitur baru bekerja bersama menciptakan pengalaman pelanggan yang mulus");
  footer(s, 25);

  // Journey line
  const items = [
    { icon:"💬", label:"Chat WA Bot",      sub:"AI auto-reply\n5 cabang",         color:C.red },
    { icon:"📱", label:"Booking Online",   sub:"Website booking\n4 langkah",       color:C.red },
    { icon:"✂️", label:"Kunjungan",        sub:"Di cabang /\nHome Service /\nWedding", color:C.gold },
    { icon:"⭐", label:"Review & Poin",    sub:"Google Review\n→ poin bonus",       color:C.gold },
    { icon:"🏆", label:"Naik Tier Member", sub:"Bronze→Silver\n→Gold→Platinum",    color:C.purple },
    { icon:"🤖", label:"AI Grooming",      sub:"Analisis wajah\n& simulasi gaya",   color:C.purple },
  ];

  items.forEach((it, i) => {
    const x = 0.42 + i * 1.6;
    if (i < 5) {
      s.addShape(pres.ShapeType.rect, { x:x+1.35, y:2.45, w:0.22, h:0.02, fill:{color:C.border}, line:{color:C.border} });
    }
    s.addShape(pres.ShapeType.ellipse, { x:x+0.38,y:1.65, w:0.62,h:0.62, fill:{color:it.color}, line:{color:it.color} });
    s.addText(it.icon, { x:x+0.38,y:1.65, w:0.62,h:0.62, fontSize:22, align:"center", valign:"middle" });
    s.addShape(pres.ShapeType.rect, { x:x+0.67,y:2.27, w:0.04,h:0.36, fill:{color:it.color}, line:{color:it.color} });
    s.addText(it.label, { x:x,y:2.65, w:1.38,h:0.36, fontSize:10, bold:true, color:C.white, align:"center" });
    s.addText(it.sub, { x:x,y:3.04, w:1.38,h:0.7, fontSize:8.5, color:C.gray, align:"center", lineSpacingMultiple:1.35 });
  });

  // Summary cards row
  const summary = [
    "🏠 Home Service — Rp 200K–250K, radius 5KM, jam 06–23",
    "💬 WA Bot — AI 24/7, 5 nomor cabang, reminder otomatis",
    "💍 Wedding — Paket 1–4 orang, kapster ke venue",
    "⭐ Membership — 4 tier, poin + Google Review bonus",
    "🤖 AI Grooming — Analisis & simulasi, eksklusif member",
  ];

  summary.forEach((sm, i) => {
    card(s, 0.42+i*1.93, 4.1, 1.82, 0.82, { fill:C.card2 });
    s.addText(sm, { x:0.52+i*1.93, y:4.15, w:1.65, h:0.72, fontSize:8.2, color:C.offW, lineSpacingMultiple:1.4 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 26 — CLOSING
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bgDark(s);

  s.addShape(pres.ShapeType.rect, { x:0,y:0,w:W,h:H, fill:{color:C.bg}, line:{color:C.bg} });
  s.addShape(pres.ShapeType.rect, { x:0,y:H*0.55,w:W,h:H*0.45, fill:{color:C.red}, line:{color:C.red} });
  s.addShape(pres.ShapeType.rect, { x:0,y:H*0.55,w:W,h:H*0.45, fill:{color:"000000",transparency:50}, line:{color:"000000",transparency:100} });

  s.addText("REDBOX", { x:0.5,y:0.65, w:9.0,h:1.4, fontSize:72, bold:true, color:C.white, fontFace:"Arial Black", align:"center" });
  s.addText("BARBERSHOP", { x:0.5,y:1.85, w:9.0,h:0.85, fontSize:46, bold:true, color:C.red, fontFace:"Arial Black", align:"center" });

  s.addShape(pres.ShapeType.rect, { x:3.5,y:2.85, w:3.0,h:0.04, fill:{color:C.gray}, line:{color:C.gray} });

  s.addText("Terima kasih telah menjadi bagian dari pertumbuhan RedBox!", {
    x:0.5, y:3.05, w:9.0, h:0.42, fontSize:14, color:C.white, align:"center",
  });
  s.addText("Sistem yang baik dimulai dari tim yang memahaminya.", {
    x:0.5, y:3.5, w:9.0, h:0.36, fontSize:12, color:"FFFFFF", transparency:30, align:"center",
  });

  s.addText("Ada pertanyaan? Hubungi Tim IT / Admin Pusat", {
    x:0.5, y:4.1, w:9.0, h:0.32, fontSize:11, color:"FFFFFF", transparency:20, align:"center",
  });

  s.addText("redboxbarbershop.com  ·  Dokumen Internal 2026", {
    x:0.5, y:4.9, w:9.0, h:0.28, fontSize:9, color:"FFFFFF", transparency:35, align:"center",
  });
}

// ════════════════════════════════════════════════════════════════
// SAVE
// ════════════════════════════════════════════════════════════════
const outFile = "RedBox_Update_Sistem_2026.pptx";
pres.writeFile({ fileName: outFile })
  .then(() => console.log(`✅  Berhasil dibuat: ${outFile}  (26 slides)`))
  .catch(err => { console.error("❌  Error:", err); process.exit(1); });
