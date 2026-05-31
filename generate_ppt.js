const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "RedBox Barbershop — Update Sistem 2026";

// ─── Color Palette ───────────────────────────────────────────────
const C = {
  dark:    "111827",   // near-black bg
  navy:    "1E293B",   // card bg
  gold:    "C9A84C",   // primary accent
  goldL:   "E8C96A",   // lighter gold
  white:   "FFFFFF",
  offW:    "F1F5F9",
  gray:    "94A3B8",
  red:     "DC2626",
  green:   "16A34A",
  teal:    "0D9488",
  purple:  "7C3AED",
};

const makeShadow = () => ({ type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.25 });

// ════════════════════════════════════════════════════════════════
// SLIDE 1 — COVER
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  // Gold accent left bar
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  // Faint grid pattern overlay (decorative rectangles)
  for (let i = 0; i < 6; i++) {
    s.addShape(pres.shapes.RECTANGLE, {
      x: 2 + i * 1.4, y: -0.2, w: 0.02, h: 6, fill: { color: "FFFFFF", transparency: 90 }, line: { color: "FFFFFF", transparency: 90 }
    });
  }

  // REDBOX tag
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 0.5, w: 2.4, h: 0.55, fill: { color: C.red }, line: { color: C.red } });
  s.addText("REDBOX BARBERSHOP", {
    x: 0.4, y: 0.5, w: 2.4, h: 0.55,
    fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0
  });

  // Main title
  s.addText("LAPORAN UPDATE SISTEM", {
    x: 0.4, y: 1.3, w: 9.2, h: 1.1,
    fontSize: 44, bold: true, color: C.white, align: "left", valign: "middle", margin: 0,
    fontFace: "Calibri"
  });

  // Gold underline
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 2.5, w: 5.5, h: 0.06, fill: { color: C.gold }, line: { color: C.gold } });

  // Subtitle
  s.addText("Fitur Baru & Pengembangan Platform\nAdmin Dashboard — Mei 2026", {
    x: 0.4, y: 2.7, w: 7, h: 0.9,
    fontSize: 16, color: C.gray, align: "left", valign: "top", margin: 0, fontFace: "Calibri"
  });

  // Right side — feature pills
  const features = ["Home Service", "WhatsApp Otomatis", "Paket Wedding", "Membership", "AI Chatbot"];
  features.forEach((f, i) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.2, y: 1.1 + i * 0.78, w: 2.5, h: 0.58, fill: { color: C.navy }, line: { color: C.gold, pt: 1 },
      shadow: makeShadow()
    });
    s.addText(f, {
      x: 7.2, y: 1.1 + i * 0.78, w: 2.5, h: 0.58,
      fontSize: 13, bold: true, color: C.goldL, align: "center", valign: "middle", margin: 0
    });
  });

  // Footer
  s.addText("Confidential  |  Admin Internal  |  2026", {
    x: 0.4, y: 5.2, w: 9.2, h: 0.3,
    fontSize: 9, color: C.gray, align: "left", margin: 0
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 2 — AGENDA
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  s.addText("AGENDA PRESENTASI", {
    x: 0.4, y: 0.3, w: 9, h: 0.7,
    fontSize: 30, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.05, w: 4, h: 0.04, fill: { color: C.gold }, line: { color: C.gold } });

  const items = [
    ["01", "Home Service", "Layanan di rumah dengan jam operasional diperluas (06.00–23.00)"],
    ["02", "WhatsApp Otomatis", "Reminder & notifikasi booking di 5 cabang"],
    ["03", "Paket Wedding", "Paket grooming pengantin & serombongan"],
    ["04", "Membership", "Program loyalitas & poin reward pelanggan"],
    ["05", "AI Chatbot", "Bot WhatsApp cerdas untuk booking & FAQ"],
    ["06", "Ringkasan & Next Steps", "Rencana pengembangan ke depan"],
  ];

  items.forEach(([num, title, desc], i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const x = 0.4 + col * 4.8;
    const y = 1.25 + row * 1.35;

    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.5, h: 1.1, fill: { color: C.navy }, line: { color: C.navy }, shadow: makeShadow() });
    // Gold left accent
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.06, h: 1.1, fill: { color: C.gold }, line: { color: C.gold } });

    s.addText(num, { x: x + 0.15, y, w: 0.5, h: 0.45, fontSize: 20, bold: true, color: C.gold, margin: 0, valign: "middle" });
    s.addText(title, { x: x + 0.65, y: y + 0.05, w: 3.7, h: 0.4, fontSize: 14, bold: true, color: C.white, margin: 0 });
    s.addText(desc, { x: x + 0.65, y: y + 0.5, w: 3.7, h: 0.55, fontSize: 10, color: C.gray, margin: 0 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 3 — HOME SERVICE
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  // Section label
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 0.25, w: 1.6, h: 0.38, fill: { color: C.red }, line: { color: C.red } });
  s.addText("HOME SERVICE", { x: 0.4, y: 0.25, w: 1.6, h: 0.38, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });

  s.addText("Layanan Cukur ke Rumah", {
    x: 0.4, y: 0.75, w: 9, h: 0.65,
    fontSize: 28, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });

  // Big time callout
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.55, w: 3.2, h: 1.8, fill: { color: C.gold }, line: { color: C.gold }, shadow: makeShadow() });
  s.addText("06.00", { x: 0.4, y: 1.65, w: 3.2, h: 0.75, fontSize: 42, bold: true, color: C.dark, align: "center", margin: 0 });
  s.addText("–  23.00 WIB", { x: 0.4, y: 2.35, w: 3.2, h: 0.5, fontSize: 20, bold: true, color: C.dark, align: "center", margin: 0 });
  s.addText("Jam Operasional Diperluas", { x: 0.4, y: 2.85, w: 3.2, h: 0.35, fontSize: 10, color: C.dark, align: "center", margin: 0 });

  // Feature cards right
  const feats = [
    ["Booking via WhatsApp / Website", "Pelanggan pilih kapster, tanggal & jam langsung dari platform"],
    ["Biaya Transportasi Terpisah", "Dihitung otomatis berdasarkan jarak lokasi pelanggan"],
    ["Konfirmasi Real-time", "Admin & kapster terima notifikasi instan saat booking masuk"],
    ["Area Layanan 5 Cabang", "Setiap cabang memiliki radius layanan home service sendiri"],
  ];

  feats.forEach(([title, desc], i) => {
    const y = 1.55 + i * 0.98;
    s.addShape(pres.shapes.RECTANGLE, { x: 3.85, y, w: 5.8, h: 0.82, fill: { color: C.navy }, line: { color: C.navy }, shadow: makeShadow() });
    s.addShape(pres.shapes.OVAL, { x: 3.95, y: y + 0.17, w: 0.35, h: 0.35, fill: { color: C.gold }, line: { color: C.gold } });
    s.addText("✓", { x: 3.95, y: y + 0.17, w: 0.35, h: 0.35, fontSize: 11, bold: true, color: C.dark, align: "center", valign: "middle", margin: 0 });
    s.addText(title, { x: 4.45, y: y + 0.05, w: 5.1, h: 0.32, fontSize: 13, bold: true, color: C.white, margin: 0 });
    s.addText(desc, { x: 4.45, y: y + 0.4, w: 5.1, h: 0.35, fontSize: 10, color: C.gray, margin: 0 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 4 — WHATSAPP AUTOMATION
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 0.25, w: 2.1, h: 0.38, fill: { color: C.green }, line: { color: C.green } });
  s.addText("WHATSAPP OTOMATIS", { x: 0.4, y: 0.25, w: 2.1, h: 0.38, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });

  s.addText("Sistem Reminder Booking Otomatis", {
    x: 0.4, y: 0.75, w: 9.2, h: 0.65,
    fontSize: 26, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });

  // 5 Branch cards
  const branches = ["Cabang 1\nCimanggis", "Cabang 2\nGaluh Mas", "Cabang 3\nDepok", "Cabang 4\nCibubur", "Cabang 5\nBekasi"];
  branches.forEach((br, i) => {
    const x = 0.35 + i * 1.87;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.55, w: 1.65, h: 0.9, fill: { color: C.green, transparency: 80 }, line: { color: C.green, pt: 1 } });
    s.addText(br, { x, y: 1.55, w: 1.65, h: 0.9, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
  });

  // Workflow
  const steps = [
    { label: "Booking\nMasuk", color: C.teal },
    { label: "Konfirmasi\nOtomatis", color: C.teal },
    { label: "Reminder\nH-1", color: C.gold },
    { label: "Reminder\n3 Jam\nSebelum", color: C.gold },
    { label: "Selesai /\nCancel", color: C.gray },
  ];

  steps.forEach((st, i) => {
    const x = 0.35 + i * 1.9;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 2.8, w: 1.65, h: 1.0, fill: { color: st.color, transparency: 20 }, line: { color: st.color, pt: 1 }, shadow: makeShadow() });
    s.addText(st.label, { x, y: 2.8, w: 1.65, h: 1.0, fontSize: 12, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    if (i < steps.length - 1) {
      s.addShape(pres.shapes.LINE, { x: x + 1.65, y: 3.3, w: 0.25, h: 0, line: { color: C.gold, width: 2 } });
    }
  });

  s.addText("Alur Notifikasi Booking", { x: 0.35, y: 2.6, w: 5, h: 0.25, fontSize: 11, color: C.gray, margin: 0 });

  // Stats
  const stats = [
    ["5", "Cabang Aktif"],
    ["3x", "Notifikasi/Booking"],
    ["100%", "Otomatis via Cron"],
  ];
  stats.forEach(([num, label], i) => {
    const x = 0.35 + i * 3.2;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 4.15, w: 2.8, h: 1.1, fill: { color: C.navy }, line: { color: C.navy }, shadow: makeShadow() });
    s.addText(num, { x, y: 4.2, w: 2.8, h: 0.6, fontSize: 32, bold: true, color: C.gold, align: "center", margin: 0 });
    s.addText(label, { x, y: 4.8, w: 2.8, h: 0.3, fontSize: 11, color: C.gray, align: "center", margin: 0 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 5 — PAKET WEDDING
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 0.25, w: 1.7, h: 0.38, fill: { color: C.purple }, line: { color: C.purple } });
  s.addText("PAKET WEDDING", { x: 0.4, y: 0.25, w: 1.7, h: 0.38, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });

  s.addText("Grooming Spesial Hari Pernikahan", {
    x: 0.4, y: 0.75, w: 9.2, h: 0.65,
    fontSize: 26, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });

  // 3 Package cards
  const pkgs = [
    {
      name: "SILVER", price: "Rp 350.000", color: C.gray,
      items: ["Haircut Pengantin Pria", "Shaving & Grooming", "Hair Styling", "Untuk 1 orang"]
    },
    {
      name: "GOLD", price: "Rp 850.000", color: C.gold,
      items: ["Haircut + Shaving (Pengantin)", "Haircut Pagar Ayu x3", "Grooming Sesi 3 Jam", "Snack & Minuman"]
    },
    {
      name: "PLATINUM", price: "Rp 1.800.000", color: C.goldL,
      items: ["Full Wedding Party (10 org)", "Kapster Khusus On-site", "Makeup Touch-up Pria", "Dokumentasi + Sertifikat"]
    },
  ];

  pkgs.forEach((pkg, i) => {
    const x = 0.35 + i * 3.2;
    // Card
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.55, w: 2.9, h: 3.7, fill: { color: C.navy }, line: { color: pkg.color, pt: 2 }, shadow: makeShadow() });
    // Header accent
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.55, w: 2.9, h: 0.6, fill: { color: pkg.color, transparency: pkg.name === "SILVER" ? 40 : 0 }, line: { color: pkg.color } });
    s.addText(pkg.name, { x, y: 1.55, w: 2.9, h: 0.6, fontSize: 16, bold: true, color: pkg.name === "GOLD" ? C.dark : C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(pkg.price, { x, y: 2.2, w: 2.9, h: 0.6, fontSize: 17, bold: true, color: pkg.color, align: "center", margin: 0 });

    pkg.items.forEach((item, j) => {
      s.addText([
        { text: "• ", options: { bold: true, color: pkg.color } },
        { text: item, options: { color: C.offW } }
      ], { x: x + 0.2, y: 2.9 + j * 0.5, w: 2.5, h: 0.45, fontSize: 11, margin: 0 });
    });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 6 — MEMBERSHIP
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 0.25, w: 1.4, h: 0.38, fill: { color: C.teal }, line: { color: C.teal } });
  s.addText("MEMBERSHIP", { x: 0.4, y: 0.25, w: 1.4, h: 0.38, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });

  s.addText("Program Loyalitas Pelanggan", {
    x: 0.4, y: 0.75, w: 9.2, h: 0.65,
    fontSize: 26, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });

  // Tier cards
  const tiers = [
    { name: "BRONZE", color: "CD7F32", min: "0", pts: "1 pts/10rb", perks: ["Diskon 5% haircut", "Reminder booking", "Badge Bronze"] },
    { name: "SILVER", color: C.gray, min: "500", pts: "1.2 pts/10rb", perks: ["Diskon 10% haircut", "1 Free Shaving/bln", "Badge Silver"] },
    { name: "GOLD", color: C.gold, min: "1.500", pts: "1.5 pts/10rb", perks: ["Diskon 15%", "Free Minuman", "Prioritas Antrian"] },
    { name: "PLATINUM", color: C.goldL, min: "5.000", pts: "2 pts/10rb", perks: ["Diskon 20%", "Kapster Pilihan", "Akses Event Eksklusif"] },
  ];

  tiers.forEach((tier, i) => {
    const x = 0.35 + i * 2.37;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.55, w: 2.1, h: 3.75, fill: { color: C.navy }, line: { color: tier.color, pt: 2 }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.55, w: 2.1, h: 0.55, fill: { color: tier.color, transparency: tier.name === "BRONZE" ? 20 : 0 }, line: { color: tier.color } });
    s.addText(tier.name, { x, y: 1.55, w: 2.1, h: 0.55, fontSize: 14, bold: true, color: tier.name === "GOLD" ? C.dark : C.white, align: "center", valign: "middle", margin: 0 });

    s.addText(`Min. ${tier.min} poin`, { x: x + 0.1, y: 2.18, w: 1.9, h: 0.35, fontSize: 10, color: tier.color, bold: true, margin: 0 });
    s.addText(tier.pts, { x: x + 0.1, y: 2.5, w: 1.9, h: 0.3, fontSize: 9, color: C.gray, margin: 0 });

    tier.perks.forEach((perk, j) => {
      s.addText([
        { text: "✓  ", options: { bold: true, color: tier.color } },
        { text: perk, options: { color: C.offW } }
      ], { x: x + 0.1, y: 2.9 + j * 0.55, w: 1.9, h: 0.45, fontSize: 10, margin: 0 });
    });
  });

  // Bottom note
  s.addShape(pres.shapes.RECTANGLE, { x: 0.35, y: 5.05, w: 9.3, h: 0.4, fill: { color: C.navy }, line: { color: C.navy } });
  s.addText("Poin otomatis dihitung dari setiap transaksi. Member dapat tukar poin melalui dashboard atau WhatsApp.", {
    x: 0.5, y: 5.07, w: 9, h: 0.35, fontSize: 10, color: C.gray, margin: 0
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 7 — AI CHATBOT
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 0.25, w: 1.5, h: 0.38, fill: { color: C.teal }, line: { color: C.teal } });
  s.addText("AI CHATBOT", { x: 0.4, y: 0.25, w: 1.5, h: 0.38, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });

  s.addText("Bot WhatsApp Cerdas — Berbasis AI", {
    x: 0.4, y: 0.75, w: 9.2, h: 0.65,
    fontSize: 26, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });

  // Left: chat mockup
  const chats = [
    { from: "user", text: "Halo, mau booking besok jam 10 pagi" },
    { from: "bot",  text: "Hai! Pilih cabang & kapster ya ✂️\n1. Cimanggis\n2. Depok\n3. Cibubur" },
    { from: "user", text: "1, kapster mana yang available?" },
    { from: "bot",  text: "Tersedia: Andi (10.00), Reza (10.30)\nMau pilih yang mana?" },
  ];

  s.addShape(pres.shapes.RECTANGLE, { x: 0.35, y: 1.55, w: 4.3, h: 3.8, fill: { color: C.navy }, line: { color: C.teal, pt: 1 }, shadow: makeShadow() });
  s.addText("💬 WhatsApp Bot Preview", { x: 0.45, y: 1.6, w: 4.1, h: 0.3, fontSize: 10, color: C.teal, bold: true, margin: 0 });

  chats.forEach((c, i) => {
    const isUser = c.from === "user";
    const y = 2.0 + i * 0.82;
    s.addShape(pres.shapes.RECTANGLE, {
      x: isUser ? 2.2 : 0.5, y, w: 2.2, h: 0.65,
      fill: { color: isUser ? C.teal : "2A3547" }, line: { color: "00000000" }
    });
    s.addText(c.text, {
      x: isUser ? 2.25 : 0.55, y: y + 0.05, w: 2.1, h: 0.55,
      fontSize: 9, color: C.white, margin: 0
    });
  });

  // Right: capabilities
  const caps = [
    ["Booking Otomatis", "Pelanggan booking tanpa perlu hubungi admin"],
    ["Cek Ketersediaan", "Real-time slot & kapster tersedia"],
    ["FAQ Pintar", "Jawab pertanyaan harga, lokasi, jam buka"],
    ["Multi-Cabang", "Bot tahu jadwal semua 5 cabang"],
    ["Eskalasi ke Admin", "Jika tidak bisa jawab, forward ke CS"],
  ];

  caps.forEach(([title, desc], i) => {
    const y = 1.55 + i * 0.74;
    s.addShape(pres.shapes.RECTANGLE, { x: 5.0, y, w: 4.65, h: 0.62, fill: { color: C.navy }, line: { color: C.navy }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: 5.0, y, w: 0.06, h: 0.62, fill: { color: C.teal }, line: { color: C.teal } });
    s.addText(title, { x: 5.2, y: y + 0.04, w: 4.3, h: 0.25, fontSize: 12, bold: true, color: C.white, margin: 0 });
    s.addText(desc, { x: 5.2, y: y + 0.32, w: 4.3, h: 0.25, fontSize: 10, color: C.gray, margin: 0 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 8 — INTEGRASI SISTEM
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 0.25, w: 1.8, h: 0.38, fill: { color: C.purple }, line: { color: C.purple } });
  s.addText("INTEGRASI SISTEM", { x: 0.4, y: 0.25, w: 1.8, h: 0.38, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });

  s.addText("Ekosistem Platform RedBox", {
    x: 0.4, y: 0.75, w: 9.2, h: 0.65,
    fontSize: 26, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });

  // Center circle — platform
  s.addShape(pres.shapes.OVAL, { x: 3.8, y: 1.85, w: 2.4, h: 1.8, fill: { color: C.gold }, line: { color: C.gold }, shadow: makeShadow() });
  s.addText("REDBOX\nPLATFORM", { x: 3.8, y: 1.85, w: 2.4, h: 1.8, fontSize: 14, bold: true, color: C.dark, align: "center", valign: "middle", margin: 0 });

  // Satellite nodes
  const nodes = [
    { label: "Website\nBooking", x: 0.5, y: 1.55, color: C.teal },
    { label: "WhatsApp\nBot", x: 0.5, y: 3.6, color: C.green },
    { label: "Admin\nDashboard", x: 7.7, y: 1.55, color: C.purple },
    { label: "Moka POS\nIntegrasi", x: 7.7, y: 3.6, color: C.red },
    { label: "Home\nService", x: 3.8, y: 4.7, color: C.gold },
  ];

  nodes.forEach(node => {
    s.addShape(pres.shapes.RECTANGLE, { x: node.x, y: node.y, w: 1.7, h: 0.9, fill: { color: node.color, transparency: 20 }, line: { color: node.color, pt: 1 }, shadow: makeShadow() });
    s.addText(node.label, { x: node.x, y: node.y, w: 1.7, h: 0.9, fontSize: 11, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
  });

  // Connection lines (approximate)
  const lines = [
    [2.2, 2.1, 3.8, 2.5],
    [2.2, 4.05, 3.8, 3.2],
    [9.4, 2.1, 9.4, 2.5],
    [9.4, 4.05, 9.4, 3.2],
  ];
  // Skip complex lines, just show label
  s.addText("Semua modul terhubung ke database Supabase terpusat & real-time sync", {
    x: 0.4, y: 5.1, w: 9.2, h: 0.35, fontSize: 11, color: C.gray, align: "center", margin: 0
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 9 — RINGKASAN & NEXT STEPS
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: C.gold }, line: { color: C.gold } });

  s.addText("RINGKASAN & NEXT STEPS", {
    x: 0.4, y: 0.3, w: 9.2, h: 0.65,
    fontSize: 28, bold: true, color: C.white, fontFace: "Calibri", margin: 0
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.0, w: 4, h: 0.04, fill: { color: C.gold }, line: { color: C.gold } });

  // Done column
  s.addText("✅  SUDAH LIVE", { x: 0.4, y: 1.15, w: 4.5, h: 0.4, fontSize: 14, bold: true, color: C.green, margin: 0 });
  const done = [
    "Home Service + jam diperluas 06.00–23.00",
    "WhatsApp reminder otomatis di 5 cabang",
    "Paket Wedding (Silver / Gold / Platinum)",
    "Membership 4 tier + sistem poin",
    "AI Chatbot booking & FAQ",
    "Integrasi Moka POS anti-double booking",
  ];
  done.forEach((item, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.65 + i * 0.57, w: 4.5, h: 0.47, fill: { color: C.navy }, line: { color: C.navy } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.65 + i * 0.57, w: 0.05, h: 0.47, fill: { color: C.green }, line: { color: C.green } });
    s.addText(item, { x: 0.6, y: 1.65 + i * 0.57, w: 4.2, h: 0.47, fontSize: 11, color: C.offW, valign: "middle", margin: 0 });
  });

  // Next steps column
  s.addText("🚀  ROADMAP KE DEPAN", { x: 5.3, y: 1.15, w: 4.3, h: 0.4, fontSize: 14, bold: true, color: C.gold, margin: 0 });
  const next = [
    ["Q3 2026", "Loyalty card digital (Apple/Google Wallet)"],
    ["Q3 2026", "Notifikasi push via mobile app"],
    ["Q4 2026", "Dashboard analitik revenue per kapster"],
    ["Q4 2026", "Home Service tracking real-time (GPS)"],
    ["2027",    "Program referral & affiliate member"],
  ];
  next.forEach(([quarter, item], i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 5.3, y: 1.65 + i * 0.67, w: 4.3, h: 0.57, fill: { color: C.navy }, line: { color: C.navy } });
    s.addShape(pres.shapes.RECTANGLE, { x: 5.3, y: 1.65 + i * 0.67, w: 0.05, h: 0.57, fill: { color: C.gold }, line: { color: C.gold } });
    s.addText(quarter, { x: 5.5, y: 1.65 + i * 0.67, w: 0.8, h: 0.28, fontSize: 9, bold: true, color: C.gold, margin: 0 });
    s.addText(item, { x: 5.5, y: 1.9 + i * 0.67, w: 3.9, h: 0.28, fontSize: 11, color: C.offW, margin: 0 });
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 10 — PENUTUP
// ════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  // Gold top bar
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: C.gold }, line: { color: C.gold } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.505, w: 10, h: 0.12, fill: { color: C.gold }, line: { color: C.gold } });

  s.addShape(pres.shapes.RECTANGLE, { x: 1.5, y: 0.5, w: 7, h: 4.5, fill: { color: C.navy }, line: { color: C.navy }, shadow: makeShadow() });

  // Red tag
  s.addShape(pres.shapes.RECTANGLE, { x: 3.8, y: 0.9, w: 2.4, h: 0.55, fill: { color: C.red }, line: { color: C.red } });
  s.addText("REDBOX BARBERSHOP", { x: 3.8, y: 0.9, w: 2.4, h: 0.55, fontSize: 10, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });

  s.addText("Terima Kasih", {
    x: 1.5, y: 1.6, w: 7, h: 1.0,
    fontSize: 46, bold: true, color: C.gold, align: "center", fontFace: "Calibri", margin: 0
  });

  s.addShape(pres.shapes.RECTANGLE, { x: 3.5, y: 2.65, w: 3, h: 0.05, fill: { color: C.gold, transparency: 50 }, line: { color: C.gold, transparency: 50 } });

  s.addText("Sistem terus berkembang untuk memberikan\npengalaman terbaik bagi pelanggan & tim RedBox.", {
    x: 1.5, y: 2.8, w: 7, h: 0.9,
    fontSize: 14, color: C.gray, align: "center", margin: 0
  });

  s.addText("robotalives@gmail.com  |  Admin RedBox Barbershop  |  2026", {
    x: 1.5, y: 4.0, w: 7, h: 0.35,
    fontSize: 11, color: C.gray, align: "center", margin: 0
  });
}

// Save
pres.writeFile({ fileName: "RedBox_Update_Sistem_2026.pptx" })
  .then(() => console.log("✅  File saved: RedBox_Update_Sistem_2026.pptx"))
  .catch(err => console.error("❌  Error:", err));
