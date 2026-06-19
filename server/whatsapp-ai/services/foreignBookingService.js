/**
 * Foreign Customer Booking Service
 * 
 * Flow for non-Indonesian speakers:
 * 1. Detect foreign language → respond in their language
 * 2. Provide service & kapster info
 * 3. Ask: what day, what service, which kapster
 * 4. Collect booking details conversationally
 * 5. Send summary to admin for manual Moka booking
 */

const config = require('../config');
const whatsappService = require('./whatsappService');
const knowledgeService = require('./knowledgeService');
const logger = require('../utils/logger');
const { notifyKapster } = require('./notificationService');

// In-memory sessions for foreign customers
const sessions = new Map(); // phone → { state, data, language, history[] }

// Kepala Cabang — penerima notifikasi semua reservasi orang asing.
// Beliau yang akan meneruskan ke staff cabang masing-masing.
// Format: tanpa tanda + (Fonnte/WA gateway pakai format internasional tanpa +)
const KEPALA_CABANG_WA = '628817803761';

const STATES = {
  IDLE: 'idle',
  GREETING_SENT: 'greeting_sent',         // Greeting + services sent, waiting branch choice
  AWAITING_BRANCH: 'awaiting_branch',
  AWAITING_SERVICE: 'awaiting_service',
  AWAITING_KAPSTER: 'awaiting_kapster',
  AWAITING_DATE: 'awaiting_date',
  AWAITING_TIME: 'awaiting_time',
  AWAITING_NAME: 'awaiting_name',
  CONFIRMING: 'confirming',
};

// Kapster list per branch (simplified — common across branches)
const KAPSTER_LIST = [
  'Mas Dika', 'Mas Rian', 'Mas Adit', 'Mas Fajar', 'Mas Ilham',
  'Mas Yoga', 'Mas Bayu', 'Mas Deni', 'Mas Reza', 'Mas Fikri'
];

const BRANCHES = ['Bypass', 'CSB Mall', 'Samadikun', 'Sumber', 'Tegal'];

// --- Session Management ---

const getSession = (phone) => sessions.get(phone) || null;

const createSession = (phone, language) => {
  const session = {
    state: STATES.IDLE,
    language: language || 'english',
    data: {},
    history: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  sessions.set(phone, session);
  return session;
};

const updateSession = (phone, updates) => {
  const session = sessions.get(phone);
  if (session) {
    Object.assign(session, updates, { lastActivity: Date.now() });
    sessions.set(phone, session);
  }
};

const clearSession = (phone) => sessions.delete(phone);

const isActive = (phone) => {
  const session = sessions.get(phone);
  if (!session) return false;
  // Auto-expire after 30 minutes of inactivity
  if (Date.now() - session.lastActivity > 30 * 60 * 1000) {
    clearSession(phone);
    return false;
  }
  return true;
};

// --- Language Detection ---

const isForeignLanguage = (text) => {
  const lower = text.toLowerCase().trim();

  // Common Indonesian indicators (if >2 Indonesian words found, it's probably Indonesian)
  const indonesianWords = [
    'mau', 'bisa', 'aku', 'saya', 'kak', 'mas', 'pak', 'bang',
    'gimana', 'bagaimana', 'berapa', 'kapan', 'dimana', 'siapa',
    'booking', 'potong', 'cukur', 'rambut', 'harga', 'layanan',
    'ada', 'gak', 'tidak', 'bukan', 'ya', 'iya', 'oke',
    'tolong', 'bantu', 'minta', 'kasih', 'terima', 'kasih',
    'hari', 'jam', 'tanggal', 'besok', 'lusa', 'nanti',
    'selamat', 'pagi', 'siang', 'sore', 'malam',
    'ini', 'itu', 'yang', 'dan', 'atau', 'dengan', 'untuk',
    'sudah', 'udah', 'belum', 'lagi', 'juga', 'sih', 'dong', 'deh',
    'assalamualaikum', 'waalaikumsalam', 'halo', 'hai'
  ];

  const words = lower.split(/\s+/);
  const indonesianCount = words.filter(w => indonesianWords.includes(w)).length;

  // If more than 30% of words are Indonesian, treat as Indonesian
  if (words.length > 0 && indonesianCount / words.length > 0.3) {
    return false;
  }

  // Common English/foreign patterns
  const foreignPatterns = [
    /\b(i want|i need|i would|i'd like|can i|could you|please|thank you|thanks)\b/i,
    /\b(hello|hey|good morning|good afternoon|good evening)\b/i,
    /\b(haircut|hair cut|barber|appointment|schedule|book|reserve)\b/i,
    /\b(how much|what time|when|where|which)\b/i,
    /\b(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(do you|are you|is there|can you|will you)\b/i,
    /\b(my name|i am|i'm)\b/i,
    // Chinese
    /[\u4e00-\u9fff]/,
    // Japanese
    /[\u3040-\u309f\u30a0-\u30ff]/,
    // Korean
    /[\uac00-\ud7af]/,
    // Arabic
    /[\u0600-\u06ff]/,
    // Thai
    /[\u0e00-\u0e7f]/,
    // Turkish (latin-script with keywords)
    /\b(merhaba|selam|berber|randevu|rezervasyon|istiyorum|l\u00fctfen|te\u015fekk\u00fcrler|sa\u00e7|kesim|t\u0131ra\u015f)\b/i,
  ];

  return foreignPatterns.some(pattern => pattern.test(lower));
};

// Detect specific language for better AI prompting
const detectLanguage = (text) => {
  if (/[\u4e00-\u9fff]/.test(text)) return 'chinese';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'korean';
  if (/[\u0600-\u06ff]/.test(text)) return 'arabic';
  if (/[\u0e00-\u0e7f]/.test(text)) return 'thai';
  // Turkish detection (latin-script with special chars)
  const turkishWords = ['merhaba', 'selam', 'günaydın', 'iyi günler', 'saç', 'berber', 'randevu',
    'rezervasyon', 'ne kadar', 'kaç para', 'ne zaman', 'yarın', 'bugün', 'istiyorum',
    'lütfen', 'teşekkürler', 'tıraş', 'kesim', 'sakal'];
  const lower = text.toLowerCase();
  if (turkishWords.some(w => lower.includes(w))) return 'turkish';
  return 'english'; // default fallback for latin-script foreign languages
};

// --- Booking Flow Handler ---

const handle = async (phone, name, text, aiService) => {
  let session = getSession(phone);

  if (!session) {
    const language = detectLanguage(text);
    session = createSession(phone, language);
  }

  session.history.push({ role: 'user', content: text });
  session.lastActivity = Date.now();

  const lower = text.toLowerCase().trim();

  // Cancel commands (multilingual)
  if (['cancel', 'batal', 'stop', 'nevermind', 'no thanks', '取消', 'キャンセル', 'iptal'].some(k => lower.includes(k))) {
    const cancelMsg = buildCancelMessage(session.language);
    clearSession(phone);
    return { reply: cancelMsg, done: true };
  }

  switch (session.state) {
    case STATES.IDLE: {
      // First contact — send greeting + ask which branch first
      session.state = STATES.GREETING_SENT;
      sessions.set(phone, session);

      const greeting = buildGreetingWithServices(name, session.language);
      session.history.push({ role: 'assistant', content: greeting });
      return { reply: greeting, done: false };
    }

    case STATES.GREETING_SENT:
    case STATES.AWAITING_BRANCH: {
      const branchMatch = extractBranch(text);
      if (branchMatch) {
        session.data.branch = branchMatch;
        session.state = STATES.AWAITING_SERVICE;
        sessions.set(phone, session);
        const msg = buildServiceQuestion(session.language);
        session.history.push({ role: 'assistant', content: msg });
        return { reply: msg, done: false };
      }
      // Re-ask branch with clearer list
      session.state = STATES.AWAITING_BRANCH;
      sessions.set(phone, session);
      const msg = buildBranchQuestion(session.language);
      session.history.push({ role: 'assistant', content: msg });
      return { reply: msg, done: false };
    }

    case STATES.AWAITING_SERVICE: {
      // Try to extract service preference from their message
      const serviceMatch = extractService(text);
      if (serviceMatch) {
        session.data.service = serviceMatch;
        session.state = STATES.AWAITING_KAPSTER;
        sessions.set(phone, session);
        const msg = buildKapsterQuestion(session.language);
        session.history.push({ role: 'assistant', content: msg });
        return { reply: msg, done: false };
      }

      // If they're asking questions, use AI to respond in their language then re-ask
      sessions.set(phone, session);
      const aiReply = await getAIReplyForForeigner(phone, name, text, session, aiService);
      session.history.push({ role: 'assistant', content: aiReply });
      return { reply: aiReply, done: false };
    }

    case STATES.AWAITING_KAPSTER: {
      // Accept "any", "no preference", or a specific name
      const kapsterChoice = extractKapster(text);
      session.data.kapster = kapsterChoice || 'Any available';
      session.state = STATES.AWAITING_DATE;
      sessions.set(phone, session);
      const msg = buildDateQuestion(session.language);
      session.history.push({ role: 'assistant', content: msg });
      return { reply: msg, done: false };
    }

    case STATES.AWAITING_DATE: {
      session.data.date = text.trim();
      session.state = STATES.AWAITING_TIME;
      sessions.set(phone, session);
      const msg = buildTimeQuestion(session.language);
      session.history.push({ role: 'assistant', content: msg });
      return { reply: msg, done: false };
    }

    case STATES.AWAITING_TIME: {
      session.data.time = text.trim();
      session.state = STATES.AWAITING_NAME;
      sessions.set(phone, session);
      const msg = buildNameQuestion(name, session.language);
      session.history.push({ role: 'assistant', content: msg });
      return { reply: msg, done: false };
    }

    case STATES.AWAITING_NAME: {
      session.data.customerName = text.trim();
      session.state = STATES.CONFIRMING;
      sessions.set(phone, session);
      const msg = buildConfirmation(session.data, session.language);
      session.history.push({ role: 'assistant', content: msg });
      return { reply: msg, done: false };
    }

    case STATES.CONFIRMING: {
      if (isConfirmation(text)) {
        // Send summary to admin
        await sendBookingSummaryToAdmin(phone, name, session);
        const msg = buildSuccessMessage(session.language);
        clearSession(phone);
        return { reply: msg, done: true };
      } else {
        // Reset to let them correct
        session.state = STATES.AWAITING_BRANCH;
        session.data = {};
        sessions.set(phone, session);
        const msg = buildRetryMessage(session.language);
        session.history.push({ role: 'assistant', content: msg });
        return { reply: msg, done: false };
      }
    }

    default:
      clearSession(phone);
      return { reply: 'Sorry, something went wrong. Please start again!', done: true };
  }
};

// --- Message Builders (Multilingual) ---

const buildGreetingWithServices = (name, language) => {
  const services = knowledgeService.getServicesForForeign();
  const branchList = BRANCHES.map((b, i) => `${i + 1}. ${b}`).join('\n');

  if (language === 'chinese') {
    return `你好 ${name}！欢迎来到 RedBox Barbershop ✂️\n\n*我们的服务：*\n${services.chinese}\n\n*我们的分店：*\n${branchList}\n\n请问您想预约 *哪家分店*？（请回复名字或编号）`;
  }
  if (language === 'japanese') {
    return `こんにちは ${name}さん！RedBox Barbershopへようこそ ✂️\n\n*サービス一覧：*\n${services.japanese}\n\n*店舗一覧：*\n${branchList}\n\n*どの店舗* をご希望ですか？（名前または番号でお答えください）`;
  }
  if (language === 'korean') {
    return `안녕하세요 ${name}님! RedBox Barbershop에 오신 것을 환영합니다 ✂️\n\n*서비스 목록:*\n${services.korean}\n\n*지점 목록:*\n${branchList}\n\n*어느 지점* 을 원하시나요? (이름 또는 번호로 답변해 주세요)`;
  }
  if (language === 'turkish') {
    return `Merhaba ${name}! RedBox Barbershop'a hoş geldiniz ✂️\n\n*Hizmetlerimiz:*\n${services.turkish}\n\n*Şubelerimiz:*\n${branchList}\n\n*Hangi şubeyi* tercih edersiniz? (isim veya numara ile cevap verebilirsiniz)`;
  }

  // Default: English
  return `Hello ${name}! Welcome to RedBox Barbershop ✂️\n\n*Our Services:*\n${services.english}\n\n*Our Branches:*\n${branchList}\n\n*Which branch* would you like to visit? (reply with the name or number)`;
};

const buildBranchQuestion = (language) => {
  const branchList = BRANCHES.map((b, i) => `${i + 1}. ${b}`).join('\n');
  if (language === 'chinese') return `请选择 *一家分店*：\n${branchList}\n\n（请回复分店名字或编号）`;
  if (language === 'japanese') return `*ご希望の店舗* をお選びください：\n${branchList}\n\n（名前または番号でお答えください）`;
  if (language === 'korean') return `*지점을 선택* 해 주세요:\n${branchList}\n\n(이름 또는 번호로 답변해 주세요)`;
  if (language === 'turkish') return `Lütfen *bir şube seçin*:\n${branchList}\n\n(şube adı veya numarası ile cevap verin)`;
  return `Please choose *a branch*:\n${branchList}\n\n(reply with the branch name or number)`;
};

const buildServiceQuestion = (language) => {
  const services = knowledgeService.getServicesForForeign();
  const lang = services[language] ? language : 'english';
  if (language === 'chinese') return `好的！您想预约 *什么服务*？\n\n${services.chinese}`;
  if (language === 'japanese') return `承知しました！*どのサービス* をご希望ですか？\n\n${services.japanese}`;
  if (language === 'korean') return `알겠습니다! *어떤 서비스* 를 원하시나요?\n\n${services.korean}`;
  if (language === 'turkish') return `Harika! *Hangi hizmeti* istersiniz?\n\n${services.turkish}`;
  return `Got it! *What service* would you like to book?\n\n${services[lang]}`;
};

const buildKapsterQuestion = (language) => {
  const kapsterNames = KAPSTER_LIST.join(', ');
  if (language === 'chinese') return `好的！您有喜欢的理发师吗？\n\n我们的理发师：${kapsterNames}\n\n如果没有偏好，回复"任意"即可 😊`;
  if (language === 'japanese') return `承知しました！ご希望のバーバーはいますか？\n\nバーバー一覧：${kapsterNames}\n\n特にご希望がなければ「誰でも」とお答えください 😊`;
  if (language === 'korean') return `알겠습니다! 선호하는 바버가 있으신가요?\n\n바버 목록: ${kapsterNames}\n\n선호 없으시면 "아무나"라고 답해주세요 😊`;
  if (language === 'turkish') return `Harika! Tercih ettiğiniz bir berber var mı?\n\nBerberlerimiz: ${kapsterNames}\n\nTercihiniz yoksa "herhangi biri" yazabilirsiniz 😊`;
  return `Great! Do you have a preferred barber?\n\nOur barbers: ${kapsterNames}\n\nIf no preference, just say "any" 😊`;
};

const buildDateQuestion = (language) => {
  if (language === 'chinese') return `好的！您想预约哪一天？\n\n我们每天营业 10:00-21:00\n（例如：明天、周六、6月5日）`;
  if (language === 'japanese') return `かしこまりました！いつご来店ですか？\n\n営業時間：毎日 10:00-21:00\n（例：明日、土曜日、6月5日）`;
  if (language === 'korean') return `알겠습니다! 언제 방문하시겠습니까?\n\n영업시간: 매일 10:00-21:00\n（예: 내일, 토요일, 6월 5일）`;
  if (language === 'turkish') return `Anlaşıldı! Hangi gün gelmek istersiniz?\n\nHer gün açığız 10:00-21:00\n(örn: yarın, Cumartesi, 5 Haziran)`;
  return `Got it! What day would you like to come?\n\nWe're open daily 10:00-21:00\n(e.g., tomorrow, Saturday, June 5th)`;
};

const buildTimeQuestion = (language) => {
  if (language === 'chinese') return `什么时间？我们的营业时间是 10:00-21:00\n（例如：14:00 或 下午2点）`;
  if (language === 'japanese') return `何時がよろしいですか？営業時間：10:00-21:00\n（例：14:00、午後2時）`;
  if (language === 'korean') return `몇 시가 좋으시겠습니까? 영업시간: 10:00-21:00\n（예: 14:00, 오후 2시）`;
  if (language === 'turkish') return `Saat kaçta gelmek istersiniz? Çalışma saatlerimiz: 10:00-21:00\n(örn: 14:00, öğleden sonra 2)`;
  return `What time? We're open 10:00-21:00\n(e.g., 2pm, 14:00, 3 in the afternoon)`;
};

const buildNameQuestion = (name, language) => {
  if (language === 'chinese') return `请问您的全名是什么？（用于预约登记）\n\n是 "${name}" 吗？如果是，回复"是"即可`;
  if (language === 'japanese') return `お名前をフルネームでお教えください（予約登録用）\n\n「${name}」でよろしいですか？よければ「はい」とお答えください`;
  if (language === 'korean') return `성함을 알려주세요（예약 등록용）\n\n"${name}"이 맞으시면 "네"라고 답해주세요`;
  if (language === 'turkish') return `Rezervasyon için tam adınızı öğrenebilir miyim?\n\n"${name}" doğru mu? Doğruysa "evet" yazmanız yeterli`;
  return `What's your full name for the booking?\n\nIs it "${name}"? If yes, just say "yes"`;
};

const buildConfirmation = (data, language) => {
  const summary = `📍 ${data.branch}\n✂️ ${data.service}\n👤 ${data.customerName}\n💇 ${data.kapster}\n📅 ${data.date}\n🕐 ${data.time}`;

  if (language === 'chinese') return `请确认您的预约信息：\n\n${summary}\n\n确认请回复"是"，取消请回复"取消"`;
  if (language === 'japanese') return `ご予約内容の確認：\n\n${summary}\n\n確認は「はい」、キャンセルは「キャンセル」とお答えください`;
  if (language === 'korean') return `예약 내용을 확인해주세요:\n\n${summary}\n\n확인은 "네", 취소는 "취소"라고 답해주세요`;
  if (language === 'turkish') return `Lütfen rezervasyonunuzu onaylayın:\n\n${summary}\n\nOnaylamak için "evet", iptal için "iptal" yazın`;
  return `Please confirm your booking:\n\n${summary}\n\nReply "yes" to confirm or "cancel" to start over`;
};

const buildSuccessMessage = (language) => {
  if (language === 'chinese') return `预约请求已提交！✅\n\n我们的工作人员会尽快在Moka系统中为您确认预约。到时见！ ✂️😊`;
  if (language === 'japanese') return `予約リクエストを受け付けました！✅\n\nスタッフがMokaシステムで予約を確認いたします。お会いできるのを楽しみにしております！ ✂️😊`;
  if (language === 'korean') return `예약 요청이 접수되었습니다！✅\n\n직원이 Moka 시스템에서 예약을 확인해 드리겠습니다. 곧 뵙겠습니다！ ✂️😊`;
  if (language === 'turkish') return `Rezervasyon talebiniz alındı! ✅\n\nEkibimiz en kısa sürede Moka sisteminde randevunuzu onaylayacak. Görüşmek üzere! ✂️😊`;
  return `Your booking request has been submitted! ✅\n\nOur staff will confirm your appointment in our Moka system shortly. See you soon! ✂️😊`;
};

const buildCancelMessage = (language) => {
  if (language === 'chinese') return `已取消。如需帮助，随时联系我们！😊`;
  if (language === 'japanese') return `キャンセルしました。またいつでもお気軽にどうぞ！😊`;
  if (language === 'korean') return `취소되었습니다. 다시 도움이 필요하시면 연락주세요！😊`;
  if (language === 'turkish') return `İptal edildi. Yardıma ihtiyacınız olursa bize ulaşmaktan çekinmeyin! 😊`;
  return `Cancelled. Feel free to reach out anytime you need help! 😊`;
};

const buildRetryMessage = (language) => {
  if (language === 'chinese') return `没问题，让我们重新开始。您想预约什么服务？`;
  if (language === 'japanese') return `了解です、もう一度やり直しましょう。どのサービスをご希望ですか？`;
  if (language === 'korean') return `괜찮습니다, 다시 시작하겠습니다. 어떤 서비스를 원하시나요?`;
  if (language === 'turkish') return `Sorun değil, baştan başlayalım. Hangi hizmeti istersiniz?`;
  return `No problem, let's start over. What service would you like?`;
};

// --- Extraction Helpers ---

const extractService = (text) => {
  const lower = text.toLowerCase();
  const serviceMap = {
    'gentleman': 'Redbox Gentleman Grooming',
    'grooming': 'Redbox Gentleman Grooming',
    'haircut': 'Redbox Gentleman Grooming',
    'hair cut': 'Redbox Gentleman Grooming',
    'potong': 'Redbox Gentleman Grooming',
    'cut': 'Redbox Gentleman Grooming',
    'hair spa': 'Hair Spa',
    'spa': 'Hair Spa',
    'color': 'Hair Color',
    'colour': 'Hair Color',
    'dye': 'Hair Color',
    'warna': 'Hair Color',
    'shave': 'Shaving',
    'shaving': 'Shaving',
    'beard': 'Shaving',
    'massage': 'Men Massage Service',
    'pijat': 'Men Massage Service',
    // Turkish keywords
    'saç kesimi': 'Redbox Gentleman Grooming',
    'kesim': 'Redbox Gentleman Grooming',
    'tıraş': 'Shaving',
    'sakal': 'Shaving',
    'masaj': 'Men Massage Service',
    'boya': 'Hair Color',
    'saç boyası': 'Hair Color',
    'saç bakım': 'Hair Spa',
  };

  for (const [keyword, service] of Object.entries(serviceMap)) {
    if (lower.includes(keyword)) return service;
  }
  return null;
};

const extractBranch = (text) => {
  const trimmed = text.trim();
  // Numeric choice (1-5)
  const numMatch = trimmed.match(/^[1-9]\d*$/);
  if (numMatch) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx >= 0 && idx < BRANCHES.length) return BRANCHES[idx];
  }
  const lower = trimmed.toLowerCase();
  // Name match (partial OK, e.g. 'csb', 'tegal')
  const found = BRANCHES.find(b => lower.includes(b.toLowerCase()));
  if (found) return found;
  // Common aliases
  if (lower.includes('csb') || lower.includes('mall')) return 'CSB Mall';
  if (lower.includes('bypass') || lower.includes('by pass') || lower.includes('by-pass')) return 'Bypass';
  if (lower.includes('samadikun') || lower.includes('sama')) return 'Samadikun';
  if (lower.includes('sumber')) return 'Sumber';
  if (lower.includes('tegal')) return 'Tegal';
  return null;
};

const extractKapster = (text) => {
  const lower = text.toLowerCase();
  if (['any', 'anyone', 'no preference', 'siapa saja', '任意', '誰でも', '아무나', 'doesnt matter', "doesn't matter", "don't mind", 'herhangi biri', 'fark etmez', 'farketmez'].some(k => lower.includes(k))) {
    return 'Any available';
  }
  // Try to match a kapster name
  const match = KAPSTER_LIST.find(k => lower.includes(k.toLowerCase().replace('mas ', '')));
  return match || text.trim();
};

const isConfirmation = (text) => {
  const lower = text.toLowerCase().trim();
  return ['yes', 'ya', 'iya', 'ok', 'oke', 'confirm', 'confirmed', 'yep', 'yeah', 'sure',
    '是', '好', '确认', 'はい', '네', '예', '맞습니다',
    'evet', 'onay', 'tamam', 'doğru'].some(k => lower.includes(k));
};

// --- AI Reply for conversational questions ---

const getAIReplyForForeigner = async (phone, name, text, session, aiService) => {
  // Use the AI service but with a foreign-customer-specific context
  const { reply } = await aiService.chatForeign(phone, name, text, session.language);
  return reply;
};

// --- Kepala Cabang Notification ---
// Notifikasi reservasi orang asing dikirim ke Kepala Cabang.
// Beliau yang akan meneruskan ke staff cabang masing-masing untuk
// di-input manual ke Moka POS.

const sendBookingSummaryToAdmin = async (phone, name, session) => {
  const target = KEPALA_CABANG_WA;
  if (!target) {
    console.warn('[ForeignBooking] No KEPALA_CABANG_WA configured, cannot send summary');
    return;
  }

  const d = session.data;
  const lang = session.language;

  const summary =
    `🌍 *RESERVASI ORANG ASING — INPUT MANUAL*\n` +
    `─────────────────────────────\n` +
    `� Cabang   : *${d.branch || '-'}*\n` +
    `�👤 Nama     : *${d.customerName}*\n` +
    `📱 WhatsApp : wa.me/${phone}\n` +
    `🗣️ Bahasa   : *${lang.charAt(0).toUpperCase() + lang.slice(1)}*\n` +
    `✂️ Layanan  : *${d.service}*\n` +
    `💇 Kapster  : *${d.kapster}*\n` +
    `📅 Tanggal  : *${d.date}*\n` +
    `🕐 Jam      : *${d.time}*\n` +
    `─────────────────────────────\n` +
    `📝 *Tindakan:* Mohon teruskan ke staff cabang *${d.branch || '-'}*\n` +
    `untuk di-input manual ke Moka POS.\n\n` +
    `_Dikirim otomatis oleh AI bot pada ${new Date().toLocaleString('id-ID')}_`;

  try {
    await whatsappService.sendText(target, summary);
    console.log(`[ForeignBooking] ✅ Summary sent to Kepala Cabang (${target}) for ${d.customerName} @ ${d.branch} (${phone})`);
    logger.logIntent(phone, name, 'foreign_booking_submitted', `${d.branch} | ${d.service} | ${d.date} ${d.time}`);
  } catch (err) {
    console.error('[ForeignBooking] ❌ Failed to notify Kepala Cabang:', err.message);
    logger.logError('foreign_booking_kepala_cabang', err.message);
  }

  // Notify kapster directly — same as regular bookings
  try {
    await notifyKapster({
      branch: d.branch,
      customer_name: d.customerName,
      phone_number: phone,
      service: d.service,
      booking_date: d.date,
      booking_time: d.time,
    });
  } catch (err) {
    console.error('[ForeignBooking] ❌ Failed to notify kapster:', err.message);
  }
};

module.exports = {
  handle,
  isActive,
  clearSession,
  isForeignLanguage,
  detectLanguage,
};
