// ================================================
// REDBOX BARBERSHOP — DATA LAYANAN TERBARU
// ================================================

const REDBOX_SERVICES = [
  // ── HAIR ──────────────────────────────────────
  {
    id: 'haircut',
    category: 'haircut',
    name: 'Hair Cut',
    icon: '✂️',
    img: 'Brand_assets/Services/Hair_Cut.jpg',
    duration: '45 menit',
    price: 85000,
    csbPrice: 110000,
    desc: 'Potongan rambut presisi atau teknik fade modern untuk tampilan yang tajam.'
  },
  {
    id: 'haircut-fade',
    category: 'haircut',
    name: 'Hair and Fade Cut',
    icon: '✂️',
    img: 'Brand_assets/Services/Fade_Cut.jpg',
    duration: '60 menit',
    price: 95000,
    csbPrice: 120000,
    desc: 'Potongan rambut presisi atau teknik fade modern untuk tampilan yang tajam dengan shade dan fade degradasi'
  },
  {
    id: 'hair-tattoo-single',
    category: 'haircut',
    name: 'Hair Tattoo Single Side',
    icon: '🎨',
    img: 'Brand_assets/Services/Hair_Tatto_Single_Side.jpg',
    duration: '15 menit',
    price: 45000,
    desc: 'Desain seni pada satu sisi rambut untuk gaya yang unik.'
  },
  {
    id: 'hair-tattoo-double',
    category: 'haircut',
    name: 'Hair Tattoo Double Side',
    icon: '🎨',
    img: 'Brand_assets/Services/Hair_Tattoo_Double_Side.jpg',
    duration: '30 menit',
    price: 75000,
    desc: 'Desain seni pada kedua sisi rambut untuk tampilan yang lebih ekspresif.'
  },
  {
    id: 'hair-color',
    category: 'haircut',
    name: 'Hair Color',
    icon: '🌈',
    img: 'Brand_assets/Services/Hair_Color.jpg',
    duration: '45 menit',
    price: 135000,
    csbPrice: 150000,
    desc: 'Pewarnaan rambut profesional dengan pilihan warna yang trendi.'
  },
  {
    id: 'hair-bleaching',
    category: 'haircut',
    name: 'Hair Bleaching',
    icon: '✨',
    img: 'Brand_assets/Services/Hair_Bleaching.jpg',
    duration: '180 menit',
    price: 360000,
    desc: 'Proses pemutihan rambut sebelum pewarnaan untuk hasil warna yang maksimal.'
  },
  {
    id: 'hair-highlight',
    category: 'haircut',
    name: 'Hair Highlighting',
    icon: '🌟',
    img: 'Brand_assets/Services/Hair_Highlighting.jpg',
    duration: '180 menit',
    price: 310000,
    desc: 'Teknik highlight untuk memberikan dimensi dan kilau pada rambut Anda.'
  },
  {
    id: 'hair-curly',
    category: 'haircut',
    name: 'Hair Curly',
    icon: '🌀',
    img: 'Brand_assets/Services/Hair_Curly.jpg',
    duration: '90 menit',
    price: 310000,
    desc: 'Proses pengeritingan rambut untuk tekstur dan volume yang lebih gaya.'
  },
  {
    id: 'hair-smoothing',
    category: 'haircut',
    name: 'Hair Smoothing',
    icon: '🧴',
    img: 'Brand_assets/Services/Hair_Smoothing.jpg',
    duration: '90 menit',
    price: 360000,
    desc: 'Meluruskan dan menghaluskan rambut agar lebih mudah diatur and berkilau.'
  },
  {
    id: 'hair-spa',
    category: 'haircut',
    name: 'Hair Spa',
    icon: '🧖',
    img: 'Brand_assets/Services/Hair_Spa.jpg',
    duration: '30 menit',
    price: 110000,
    desc: 'Perawatan mendalam untuk kesehatan rambut yang lebih optimal.'
  },
  {
    id: 'down-perm',
    category: 'haircut',
    name: 'Down Perm / Root Lift',
    icon: '📏',
    img: 'Brand_assets/Services/Down_Perm.jpg',
    duration: '60 menit',
    price: 175000,
    desc: 'Teknik untuk mengatur arah tumbuh rambut agar lebih rapi dan bervolume.'
  },

  // ── SHAVE ─────────────────────────────────────
  {
    id: 'shaving',
    category: 'shave',
    name: 'Shaving',
    icon: '🪒',
    img: 'Brand_assets/Services/Shaving.jpg',
    duration: '20 menit',
    price: 40000,
    desc: 'Pencukuran jenggot atau kumis standar agar tampil bersih.'
  },
  {
    id: 'traditional-shave',
    category: 'shave',
    name: 'Traditional Shaving',
    icon: '🪒',
    img: 'Brand_assets/Services/Traditional_Shaving.jpg',
    duration: '30 menit',
    price: 70000,
    desc: 'Pencukuran klasik dengan handuk hangat untuk kenyamanan ekstra.'
  },
  {
    id: 'premium-head-shave',
    category: 'shave',
    name: 'Premium Head Shave',
    icon: '👨‍🦲',
    img: 'Brand_assets/Services/Premium_Head_Shave.jpg',
    duration: '45 menit',
    price: 130000,
    desc: 'Pencukuran kepala hingga licin dengan perawatan premium.'
  },

  // ── OTHER SERVICES ────────────────────────────
  {
    id: 'men-massage',
    category: 'other',
    name: 'Men Massage Service',
    icon: '💆‍♂️',
    img: 'Brand_assets/Services/Men_Massage_Service.jpg',
    duration: '45 menit',
    price: 145000,
    desc: 'Pijat relaksasi khusus pria meliputi Kepala, Wajah, Tangan & Bahu.'
  },
  {
    id: 'nose-wax',
    category: 'other',
    name: 'Nose Wax',
    icon: '👃',
    img: 'Brand_assets/Services/Nose_Wax.jpg',
    duration: '25 menit',
    price: 70000,
    desc: 'Pembersihan bulu hidung dengan teknik waxing yang cepat dan efektif.'
  },
  {
    id: 'ear-wax',
    category: 'other',
    name: 'Ear Wax',
    icon: '👂',
    img: 'Brand_assets/Services/Ear_Wax.jpg',
    duration: '25 menit',
    price: 70000,
    desc: 'Pembersihan bulu telinga dengan teknik waxing.'
  },
  {
    id: 'ear-singeing',
    category: 'other',
    name: 'Ear Singeing',
    icon: '🔥',
    img: 'Brand_assets/Services/Ear_Singeing.jpg',
    duration: '20 menit',
    price: 75000,
    desc: 'Teknik tradisional menghilangkan bulu telinga menggunakan api.'
  },
  {
    id: 'charcoal-cleansing',
    category: 'other',
    name: 'Charcoal Deep Cleansing',
    icon: '🖤',
    img: 'Brand_assets/Services/Charcoal_Deep_Cleansing.jpg',
    duration: '45 menit',
    price: 105000,
    desc: 'Pembersihan wajah mendalam dengan masker charcoal untuk mengangkat kotoran.'
  },
  {
    id: 'ear-candle',
    category: 'other',
    name: 'Ear Candle',
    icon: '🕯️',
    img: 'Brand_assets/Services/Ear_Candle.jpg',
    duration: '25 menit',
    price: 40000,
    desc: 'Terapi pembersihan telinga untuk relaksasi dan kebersihan.'
  },
  {
    id: 'charcoal-nose-strip',
    category: 'other',
    name: 'Charcoal Nose Cleansing Strip',
    icon: '👃',
    img: 'Brand_assets/Services/Charcoal_Nose_Cleansing_Strip.jpg',
    duration: '30 menit',
    price: 65000,
    desc: 'Pembersihan komedo pada hidung dengan charcoal strip.'
  },

  // ── GROOMING PACKAGES ─────────────────────────
  {
    id: 'package-royal',
    category: 'package',
    name: 'Redbox Royal Grooming',
    icon: '👑',
    img: 'Brand_assets/Redbox Royal.jpg',
    duration: '90 menit',
    price: 305000,
    badge: 'ROYAL',
    desc: 'Haircut, Face & Back Massage, Charcoal Cleansing, Traditional Shaving, Waxing Nose & Ear.'
  },
  {
    id: 'package-duxe',
    category: 'package',
    name: 'Redbox Duxe Grooming',
    icon: '💎',
    img: 'Brand_assets/Redbox Duxe.jpg',
    duration: '90 menit',
    price: 250000,
    badge: 'DUXE',
    desc: 'Haircut, Charcoal Deep Cleansing, Face Scrub, Hair Spa.'
  },
  {
    id: 'package-earl',
    category: 'package',
    name: 'Redbox Earl Grooming',
    icon: '👔',
    img: 'Brand_assets/Redbox Earl.jpg',
    duration: '90 menit',
    price: 185000,
    badge: 'EARL',
    desc: 'Haircut, Face & Back Massage, Hair Spa.'
  },
  {
    id: 'package-baron',
    category: 'package',
    name: 'Redbox Baron Grooming',
    icon: '🎖️',
    img: 'Brand_assets/Redbox Baron.jpg',
    duration: '90 menit',
    price: 150000,
    csbPrice: 180000,
    badge: 'BARON',
    desc: 'Haircut / Fade / Long Trim.'
  },
  {
    id: 'package-noble',
    category: 'package',
    name: 'Redbox Noble Grooming',
    icon: '🎩',
    img: 'Brand_assets/Redbox Noble.jpg',
    duration: '90 menit',
    price: 140000,
    badge: 'NOBLE',
    desc: 'Haircut, Face & Back Massage, Ear Singeing.'
  }
];
