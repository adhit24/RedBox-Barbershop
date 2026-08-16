'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Scissors, Calendar, Clock, User, MapPin, Check, 
  ChevronRight, Sparkles, Star, Phone, MessageSquare, 
  X, HelpCircle, Shield, Award, CalendarClock, CreditCard
} from 'lucide-react';
import axios from 'axios';
import { createClient } from '@/utils/supabase/client';

// Prefetched/Fallback branches data based on rules_ai.md
const FALLBACK_BRANCHES = [
  { id: 'samadikun', name: 'Samadikun', address: 'Jl. Kapten Samadikun No.60, Kesenden, Kota Cirebon', phone: '+62 818-202-589', wa: '62818202589' },
  { id: 'bypass', name: 'Bypass', address: 'Jl. Ahmad Yani No.88, Kecapi, Harjamukti, Cirebon', phone: '+62 818-202-569', wa: '62818202569' },
  { id: 'csb', name: 'CSB Mall', address: 'LG Floor #1270, CSB Mall, Jl. Dr. Cipto Mangunkusumo No.26, Cirebon', phone: '+62 818-202-889', wa: '62818202889' },
  { id: 'sumber', name: 'Sumber', address: 'Jl. Pangeran Cakrabuana No.2, Kemantren, Sumber, Kab. Cirebon', phone: '+62 818-202-599', wa: '62818202599' },
  { id: 'tegal', name: 'Tegal Kota', address: 'Jl. Kapten Sudibyo No.100, Pekauman, Tegal Barat, Kota Tegal', phone: '+62 818-268-883', wa: '62818268883' }
];

// Prefetched/Fallback services
const FALLBACK_SERVICES = [
  { id: '1', name: 'RedBox Signature Cut', category: 'haircut', price: 50000, duration: 40, description: 'Potongan rambut premium disesuaikan bentuk wajah + keramas + pijat kepala + handuk hangat + styling pomade.' },
  { id: '2', name: 'Gentleman Grooming', category: 'package', price: 120000, description: 'Paket lengkap terbaik: Signature Haircut + Hair Wash + Classic Shave/Beard Trim + Face Massage + Hair Tonic.', duration: 60 },
  { id: '3', name: 'Home Service (Gentleman Grooming)', category: 'package', price: 200000, duration: 60, description: 'Layanan Gentleman Grooming premium langsung di rumah Anda. Maksimal 5 KM dari cabang terdekat.' },
  { id: '4', name: 'Classic Beard Trim', category: 'shaving', price: 35000, duration: 25, description: 'Perapihan dan pencukuran jenggot/kumis menggunakan masker cukur premium dan handuk hangat.' },
  { id: '5', name: 'Haircut + Hair Spa / Masker', category: 'package', price: 90000, duration: 55, description: 'Signature haircut dilengkapi dengan perawatan kulit kepala intensif untuk rambut lebih sehat.' },
  { id: '6', name: 'Junior Haircut (Anak-anak)', category: 'haircut', price: 35000, duration: 30, description: 'Gaya potongan rambut keren untuk anak usia di bawah 10 tahun.' }
];

// Fallback barbers by branch
const FALLBACK_BARBERS: Record<string, Array<{ id: string; name: string; role: string }>> = {
  samadikun: [
    { id: 'yuki', name: 'Yuki', role: 'Senior Barber' },
    { id: 'dian', name: 'Dian', role: 'Barberman' },
    { id: 'ubay', name: 'Ubay', role: 'Junior Barber' }
  ],
  bypass: [
    { id: 'asep', name: 'Asep', role: 'Senior Barber' },
    { id: 'dedi', name: 'Dedi', role: 'Barberman' },
    { id: 'budi', name: 'Budi', role: 'Junior Barber' }
  ],
  csb: [
    { id: 'rian', name: 'Rian', role: 'Master Barber' },
    { id: 'kevin', name: 'Kevin', role: 'Senior Barber' }
  ],
  sumber: [
    { id: 'jaka', name: 'Jaka', role: 'Senior Barber' },
    { id: 'dani', name: 'Dani', role: 'Barberman' }
  ],
  tegal: [
    { id: 'fajar', name: 'Fajar', role: 'Senior Barber' },
    { id: 'hendra', name: 'Hendra', role: 'Barberman' }
  ]
};

const TIME_SLOTS = [
  '10:00', '11:00', '12:00', '13:00', '14:00', 
  '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'
];

export default function PremiumLandingPage() {
  const [branches, setBranches] = useState(FALLBACK_BRANCHES);
  const [services, setServices] = useState(FALLBACK_SERVICES);
  const [barbers, setBarbers] = useState<any[]>([]);
  
  // Booking Wizard States
  const [bookingStep, setBookingStep] = useState(1);
  const [selectedBranch, setSelectedBranch] = useState<any>(null);
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedBarber, setSelectedBarber] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingResult, setBookingResult] = useState<any>(null);
  
  // Real-time Booked Slots state
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);

  // UI States
  const [activeCategory, setActiveCategory] = useState('all');
  const [isWaWidgetOpen, setIsWaWidgetOpen] = useState(false);
  
  // Supabase Client for dynamic fetch
  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      
      // Fetch active outlets
      const { data: dbOutlets } = await supabase
        .from('outlets')
        .select('*')
        .eq('is_active', true);
      if (dbOutlets && dbOutlets.length > 0) {
        // Map db outlets to match our schema and merge custom wa links
        const mapped = dbOutlets.map(o => {
          const matchedFallback = FALLBACK_BRANCHES.find(fb => fb.id === o.slug);
          return {
            id: o.slug || o.id,
            name: o.name,
            address: o.address || matchedFallback?.address || '',
            phone: o.phone || matchedFallback?.phone || '',
            wa: matchedFallback?.wa || '62818202589'
          };
        });
        setBranches(mapped);
      }

      // Fetch active services
      const { data: dbServices } = await supabase
        .from('services')
        .select('*')
        .eq('is_active', true);
      if (dbServices && dbServices.length > 0) {
        const mapped = dbServices.map(s => ({
          id: s.id,
          name: s.name,
          category: s.moka_category_name?.toLowerCase().includes('package') ? 'package' : s.moka_category_name?.toLowerCase().includes('shave') ? 'shaving' : 'haircut',
          price: s.price,
          duration: s.duration_minutes || 45,
          description: s.moka_variant_name || s.name
        }));
        setServices(mapped);
      }
    }
    
    fetchData();
  }, []);

  // Sync barbers when branch is selected
  useEffect(() => {
    if (!selectedBranch) return;
    async function fetchBarbers() {
      const supabase = createClient();
      const { data: dbBarbers } = await supabase
        .from('barbers')
        .select('*')
        .eq('is_active', true)
        .eq('branch', selectedBranch.name); // match branch name

      if (dbBarbers && dbBarbers.length > 0) {
        setBarbers(dbBarbers);
      } else {
        // Use fallback barbers
        setBarbers(FALLBACK_BARBERS[selectedBranch.id] || []);
      }
    }
    fetchBarbers();
  }, [selectedBranch]);

  // Sync busy/booked time slots when date and barber/branch are chosen
  useEffect(() => {
    if (!selectedBranch || !selectedDate) return;
    async function fetchBookedSlots() {
      const supabase = createClient();
      let query = supabase
        .from('bookings')
        .select('time')
        .eq('location', selectedBranch.name)
        .eq('date', selectedDate)
        .in('status', ['confirmed', 'pending']);
      
      if (selectedBarber && selectedBarber.id !== 'anyone') {
        query = query.eq('barber_id', selectedBarber.id);
      }

      const { data } = await query;
      if (data) {
        // Map time (e.g. "10:00:00" or "10:00") to HH:MM format
        const slots = data.map(b => b.time.slice(0, 5));
        setBookedSlots(slots);
      } else {
        setBookedSlots([]);
      }
    }
    fetchBookedSlots();
  }, [selectedBranch, selectedDate, selectedBarber]);

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !customerPhone) return;
    
    setIsSubmitting(true);
    
    // Map Home Service note
    let finalNotes = notes;
    if (selectedService.name.toLowerCase().includes('home service') || selectedService.id === '3') {
      finalNotes = `[HOME SERVICE] Alamat: ${address}. ${notes}`;
    }

    const payload = {
      name: customerName,
      wa: customerPhone,
      service_id: selectedService.id,
      service: selectedService.name,
      price: selectedService.price,
      duration: `${selectedService.duration} menit`,
      barber_id: selectedBarber?.id === 'anyone' ? null : selectedBarber?.id,
      date: selectedDate,
      time: `${selectedTime}:00`,
      location: selectedBranch.name,
      payment: paymentMethod,
      notes: finalNotes
    };

    try {
      // Axios request to post the booking details
      const response = await axios.post('/api/bookings', payload);
      const data = response.data;
      
      if (data.success) {
        setBookingResult(data.booking);
        setBookingStep(6);
        
        // Google Analytics Lead event
        if (typeof window !== 'undefined' && (window as any).gtag) {
          (window as any).gtag('event', 'booking_complete', {
            event_category: 'Engagement',
            event_label: selectedBranch.name,
            value: selectedService.price
          });
        }
        
        // Facebook Pixel Event
        if (typeof window !== 'undefined' && (window as any).fbq) {
          (window as any).fbq('track', 'Lead', {
            content_name: selectedService.name,
            value: selectedService.price,
            currency: 'IDR'
          });
        }
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Gagal mengirim pesanan booking. Silakan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getMinDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const getMaxDate = () => {
    const today = new Date();
    today.setDate(today.getDate() + 7); // Allow booking max 7 days in advance
    return today.toISOString().split('T')[0];
  };

  // Helper to open WhatsApp for booking confirmation
  const getWhatsAppConfirmationUrl = () => {
    if (!bookingResult) return '';
    const number = selectedBranch.wa || '62818202589';
    const text = encodeURIComponent(
      `Halo RedBox Barbershop ${selectedBranch.name},\n\n` +
      `Saya ingin konfirmasi booking online:\n` +
      `- Nama: ${bookingResult.name}\n` +
      `- Layanan: ${bookingResult.service}\n` +
      `- Tanggal: ${bookingResult.date}\n` +
      `- Jam: ${bookingResult.time.slice(0, 5)}\n` +
      `- Pembayaran: ${bookingResult.payment}\n` +
      `${address ? `- Alamat: ${address}\n` : ''}` +
      `Mohon dikonfirmasi ya. Terima kasih!`
    );
    return `https://wa.me/${number}?text=${text}`;
  };

  // Helper to open general WhatsApp chat
  const getWhatsAppGeneralUrl = (branchWa: string, branchName: string) => {
    const text = encodeURIComponent(`Halo RedBox Barbershop ${branchName}, saya ingin bertanya tentang layanan haircut...`);
    return `https://wa.me/${branchWa}?text=${text}`;
  };

  const scrollToBooking = () => {
    const element = document.getElementById('booking-section');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const filteredServices = activeCategory === 'all' 
    ? services 
    : services.filter(s => s.category === activeCategory);

  return (
    <div className="min-h-screen text-white bg-[#060408] font-sans antialiased overflow-x-hidden">
      
      {/* Top Ambient Light */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[500px] pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[20%] w-[60%] h-[80%] rounded-full bg-radial from-[#C72820]/15 to-transparent blur-3xl" />
      </div>

      {/* HEADER NAVBAR */}
      <nav className="sticky top-0 z-40 w-full backdrop-blur-md bg-[#060408]/80 border-b border-white/5 py-4 px-6 md:px-12 flex justify-between items-center transition-all">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-1.5"
        >
          <span className="text-xl font-black tracking-[0.2em] uppercase select-none">
            <span className="text-[#F0EAEB]">RED</span>
            <span className="text-[#C72820]">BOX</span>
          </span>
          <span className="text-[9px] border border-[#C72820]/30 bg-[#C72820]/10 px-2 py-0.5 rounded text-amber-500 font-bold uppercase tracking-widest hidden sm:inline-block">
            PREMIUM
          </span>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-4"
        >
          <button 
            onClick={scrollToBooking}
            className="px-5 py-2 bg-[#C72820] hover:bg-[#a61e18] active:scale-95 text-[#FFF0EF] text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-[0_4px_20px_rgba(199,40,32,0.3)] cursor-pointer"
          >
            Book Now
          </button>
        </motion.div>
      </nav>

      {/* HERO SECTION */}
      <header className="relative w-full min-h-[90dvh] flex flex-col justify-center items-center text-center px-6 py-20 z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#060408_90%)] z-10" />
        
        {/* Background Image with Priority Hint */}
        <div className="absolute inset-0 w-full h-full opacity-15">
          <img 
            src="https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&q=80&w=1200" 
            alt="Barber Shop Interior" 
            className="w-full h-full object-cover object-center"
            fetchPriority="high"
          />
        </div>

        <div className="relative max-w-4xl z-20 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full backdrop-blur-md"
          >
            <Sparkles size={13} className="text-[#C72820]" />
            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-gray-300">Sensasi Potong Rambut Kelas Dunia</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight leading-none uppercase"
          >
            SHARP CUTS.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#C72820] via-red-500 to-amber-500">BOLD STYLE.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="max-w-2xl mx-auto text-sm sm:text-base text-gray-400 font-medium leading-relaxed"
          >
            RedBox Barbershop mendefinisikan ulang gaya pria modern dengan ketelitian luar biasa. Dari cukuran klasik hingga perpaduan gaya kontemporer didukung analisis AI.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6"
          >
            <button
              onClick={scrollToBooking}
              className="w-full sm:w-auto px-8 py-4 bg-[#C72820] hover:bg-[#a61e18] active:scale-95 text-[#FFF0EF] text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-[0_4px_30px_rgba(199,40,32,0.4)] cursor-pointer"
            >
              Reservasi Sekarang
            </button>
            <a
              href="/ai-hairstyle"
              className="w-full sm:w-auto px-8 py-4 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest transition-all cursor-pointer inline-flex items-center justify-center gap-2"
            >
              <Sparkles size={14} className="text-[#C72820]" />
              AI Style Analyzer
            </a>
          </motion.div>

          {/* Running Tag Ticker */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="w-full max-w-4xl mx-auto overflow-hidden py-3 bg-[#C72820]/10 border-y border-[#C72820]/20 rounded-xl mt-12 relative z-20"
          >
            <style>{`
              @keyframes marquee {
                0% { transform: translateX(0%); }
                100% { transform: translateX(-50%); }
              }
              .animate-marquee {
                display: flex;
                width: max-content;
                animation: marquee 25s linear infinite;
              }
            `}</style>
            <div className="animate-marquee flex gap-8 whitespace-nowrap text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em] text-[#E87068]">
              <span>★ 1 KIP BERSIH PER PELANGGAN ★ 1 HANDUK SEGAR PER KUNJUNGAN ★ 1 SET ALAT STERIL PER SESI ★ STANDAR HIGIENITAS REDBOX: TANPA KOMPROMI ★</span>
              <span>★ 1 KIP BERSIH PER PELANGGAN ★ 1 HANDUK SEGAR PER KUNJUNGAN ★ 1 SET ALAT STERIL PER SESI ★ STANDAR HIGIENITAS REDBOX: TANPA KOMPROMI ★</span>
            </div>
          </motion.div>
        </div>
      </header>

      {/* CORE STATS / BRAND METRICS */}
      <section className="relative max-w-7xl mx-auto px-6 py-12 z-20 border-y border-white/5 bg-[#060408]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: '5', label: 'Cabang Premium' },
            { value: '25k+', label: 'Pelanggan Puas' },
            { value: '15+', label: 'Barber Berpengalaman' },
            { value: '4.9', label: 'Rating Ulasan Google' }
          ].map((stat, i) => (
            <div key={i} className="space-y-1">
              <p className="text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-500">{stat.value}</p>
              <p className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>


      {/* SERVICES LIST */}
      <section className="max-w-7xl mx-auto px-6 py-24 z-20 space-y-12">
        <div className="text-center space-y-3">
          <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-[#C72820]">Katalog Layanan</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight uppercase">Menu & Tarif RedBox</h2>
          <div className="w-12 h-0.5 bg-[#C72820] mx-auto" />
        </div>

        {/* Categories Tab */}
        <div className="flex justify-center gap-2 overflow-x-auto pb-4">
          {[
            { id: 'all', label: 'Semua' },
            { id: 'haircut', label: 'Potong Rambut' },
            { id: 'shaving', label: 'Cukur Jenggot' },
            { id: 'package', label: 'Paket & Spesial' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveCategory(tab.id)}
              className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                activeCategory === tab.id
                  ? 'bg-[#C72820] text-[#FFF0EF] shadow-md'
                  : 'bg-white/5 border border-white/5 text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredServices.map((service) => (
              <motion.div
                layout
                key={service.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="group relative rounded-2xl p-6 bg-gradient-to-r from-white/[0.02] to-transparent border border-white/5 hover:border-[#C72820]/30 transition-all flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex justify-between items-start gap-4">
                    <h3 className="font-bold text-base sm:text-lg group-hover:text-[#E87068] transition-colors">{service.name}</h3>
                    <p className="font-mono text-base font-bold text-amber-500 whitespace-nowrap">
                      Rp {service.price.toLocaleString('id-ID')}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{service.description}</p>
                </div>
                <div className="flex justify-between items-center pt-4 mt-4 border-t border-white/5">
                  <span className="text-[10px] text-gray-500 flex items-center gap-1">
                    <Clock size={12} /> {service.duration} Menit
                  </span>
                  <button
                    onClick={() => {
                      setSelectedService(service);
                      setBookingStep(1); // Reset to branch selection
                      scrollToBooking();
                    }}
                    className="text-[10px] uppercase font-bold tracking-widest text-[#C72820] hover:text-white flex items-center gap-1 transition-all cursor-pointer"
                  >
                    Booking <ChevronRight size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </section>

      {/* LOOKBOOK / GALLERY */}
      <section className="max-w-7xl mx-auto px-6 py-24 border-t border-white/5 bg-[#08060a]">
        <div className="text-center space-y-3 mb-16">
          <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-[#C72820]">Lookbook Premium</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight uppercase">Inspirasi Potongan Rambut</h2>
          <div className="w-12 h-0.5 bg-[#C72820] mx-auto" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {[
            { title: 'Modern Pompadour', img: 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&q=80&w=400' },
            { title: 'Classic Side Part', img: 'https://images.unsplash.com/photo-1512864084360-7c0c4d0a0845?auto=format&fit=crop&q=80&w=400' },
            { title: 'Textured Crop Fade', img: 'https://images.unsplash.com/photo-1605497746444-ac9dbd324ce8?auto=format&fit=crop&q=80&w=400' }
          ].map((item, i) => (
            <div key={i} className="group relative rounded-2xl overflow-hidden aspect-[4/5] border border-white/5">
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80 z-10" />
              <img 
                src={item.img} 
                alt={item.title} 
                className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105" 
              />
              <div className="absolute bottom-6 left-6 z-20">
                <p className="text-xs uppercase font-bold tracking-widest text-[#C72820] mb-1">Gaya Populer</p>
                <h3 className="text-lg font-bold text-white uppercase tracking-wide">{item.title}</h3>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* INTERACTIVE BOOKING WIZARD */}
      <section id="booking-section" className="max-w-4xl mx-auto px-6 py-24 z-20">
        <div className="text-center space-y-3 mb-12">
          <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-[#C72820]">Sistem Reservasi</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight uppercase">Booking Online Mandiri</h2>
          <p className="text-xs text-gray-500">Reservasi cepat bebas antrean kurang dari 1 menit.</p>
        </div>

        {/* Step Indicator */}
        <div className="flex justify-between items-center mb-8 max-w-md mx-auto relative px-2">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/5 -translate-y-1/2 z-0" />
          {[1, 2, 3, 4, 5].map((s) => (
            <div 
              key={s} 
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold relative z-10 transition-all border ${
                bookingStep >= s
                  ? 'bg-[#C72820] text-[#FFF0EF] border-[#C72820] shadow-[0_0_12px_rgba(199,40,32,0.3)]'
                  : 'bg-[#060408] text-gray-600 border-white/5'
              }`}
            >
              {bookingStep > s ? <Check size={14} /> : s}
            </div>
          ))}
        </div>

        {/* Booking Card Frame */}
        <div 
          className="relative rounded-3xl p-6 sm:p-10 border border-white/10 backdrop-blur-2xl bg-gradient-to-b from-white/[0.03] to-transparent shadow-[0_40px_80px_rgba(0,0,0,0.6)]"
        >
          {/* STEP 1: SELECT BRANCH */}
          {bookingStep === 1 && (
            <div className="space-y-6">
              <h3 className="text-lg font-bold uppercase tracking-wide flex items-center gap-2">
                <MapPin size={18} className="text-[#C72820]" />
                Langkah 1: Pilih Cabang Terdekat
              </h3>
              <div className="grid grid-cols-1 gap-3.5">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    onClick={() => {
                      setSelectedBranch(branch);
                      setBookingStep(2);
                    }}
                    className={`w-full text-left p-5 rounded-2xl border transition-all cursor-pointer flex justify-between items-center ${
                      selectedBranch?.id === branch.id
                        ? 'bg-[#C72820]/10 border-[#C72820] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                        : 'bg-white/[0.01] border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div>
                      <h4 className="font-bold text-sm sm:text-base">{branch.name}</h4>
                      <p className="text-xs text-gray-500 mt-1">{branch.address}</p>
                      <p className="text-[10px] text-[#C72820] mt-1 font-semibold">{branch.phone}</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 flex-shrink-0 ml-4" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: SELECT SERVICE */}
          {bookingStep === 2 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold uppercase tracking-wide flex items-center gap-2">
                  <Scissors size={18} className="text-[#C72820]" />
                  Langkah 2: Pilih Layanan Haircut
                </h3>
                <button 
                  onClick={() => setBookingStep(1)} 
                  className="text-xs text-gray-500 hover:text-white cursor-pointer"
                >
                  Kembali
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3.5">
                {services.map((service) => (
                  <button
                    key={service.id}
                    onClick={() => {
                      setSelectedService(service);
                      setBookingStep(3);
                    }}
                    className={`w-full text-left p-5 rounded-2xl border transition-all cursor-pointer flex justify-between items-center ${
                      selectedService?.id === service.id
                        ? 'bg-[#C72820]/10 border-[#C72820]'
                        : 'bg-white/[0.01] border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="space-y-1 pr-4">
                      <h4 className="font-bold text-sm sm:text-base">{service.name}</h4>
                      <p className="text-xs text-gray-500 leading-relaxed">{service.description}</p>
                      <span className="inline-block text-[10px] text-gray-500 font-medium pt-1">🕒 {service.duration} Menit</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono text-sm sm:text-base font-bold text-amber-500">
                        Rp {service.price.toLocaleString('id-ID')}
                      </p>
                      <span className="text-[9px] text-[#C72820] font-bold uppercase tracking-widest block mt-1">PILIH</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: SELECT BARBER */}
          {bookingStep === 3 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold uppercase tracking-wide flex items-center gap-2">
                  <User size={18} className="text-[#C72820]" />
                  Langkah 3: Pilih Kapster
                </h3>
                <button 
                  onClick={() => setBookingStep(2)} 
                  className="text-xs text-gray-500 hover:text-white cursor-pointer"
                >
                  Kembali
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Anyone Option */}
                <button
                  onClick={() => {
                    setSelectedBarber({ id: 'anyone', name: 'Siapa Saja (Tersedia Paling Cepat)' });
                    setBookingStep(4);
                  }}
                  className={`p-5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-3 ${
                    selectedBarber?.id === 'anyone'
                      ? 'bg-[#C72820]/10 border-[#C72820]'
                      : 'bg-white/[0.01] border-white/5 hover:border-white/15'
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-[#C72820]/10 border border-[#C72820]/20 flex items-center justify-center text-[#C72820]">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm sm:text-base">Siapa Saja</h4>
                    <p className="text-[10px] text-gray-500 mt-1">Kami pilihkan kapster terbaik yang tersedia</p>
                  </div>
                </button>

                {/* DB Barbers */}
                {barbers.map((barber) => (
                  <button
                    key={barber.id}
                    onClick={() => {
                      setSelectedBarber(barber);
                      setBookingStep(4);
                    }}
                    className={`p-5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-3 ${
                      selectedBarber?.id === barber.id
                        ? 'bg-[#C72820]/10 border-[#C72820]'
                        : 'bg-white/[0.01] border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#C72820] to-amber-500 flex items-center justify-center font-bold text-white text-base">
                      {barber.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm sm:text-base">{barber.name}</h4>
                      <p className="text-[10px] text-gray-500 mt-1">{barber.role || 'Barberman'}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: SELECT DATE & TIME */}
          {bookingStep === 4 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold uppercase tracking-wide flex items-center gap-2">
                  <CalendarClock size={18} className="text-[#C72820]" />
                  Langkah 4: Jadwal Kunjungan
                </h3>
                <button 
                  onClick={() => setBookingStep(3)} 
                  className="text-xs text-gray-500 hover:text-white cursor-pointer"
                >
                  Kembali
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Pilih Tanggal</label>
                  <input
                    type="date"
                    min={getMinDate()}
                    max={getMaxDate()}
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      setSelectedTime(''); // Reset time on date change
                    }}
                    className="w-full h-12 bg-white/[0.03] border border-white/10 rounded-xl px-4 text-sm focus:outline-none focus:border-[#C72820] [color-scheme:dark]"
                  />
                </div>

                {selectedDate && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Pilih Jam</label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {TIME_SLOTS.map((time) => {
                        const isBooked = bookedSlots.includes(time);
                        const isSelected = selectedTime === time;
                        return (
                          <button
                            key={time}
                            disabled={isBooked}
                            onClick={() => setSelectedTime(time)}
                            className={`h-11 rounded-xl text-xs font-semibold font-mono tracking-wide transition-all border cursor-pointer ${
                              isSelected
                                ? 'bg-[#C72820] text-[#FFF0EF] border-[#C72820] shadow-[0_0_12px_rgba(199,40,32,0.35)]'
                                : isBooked
                                  ? 'bg-transparent text-gray-700 border-white/5 cursor-not-allowed line-through'
                                  : 'bg-white/[0.02] border-white/5 text-gray-300 hover:border-white/15'
                            }`}
                          >
                            {time}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {selectedDate && selectedTime && (
                <div className="pt-4 flex justify-end">
                  <button
                    onClick={() => setBookingStep(5)}
                    className="px-6 py-3 bg-[#C72820] text-[#FFF0EF] text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-[0_4px_20px_rgba(199,40,32,0.3)] hover:bg-[#a61e18] cursor-pointer"
                  >
                    Lanjut
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 5: CUSTOMER INFO */}
          {bookingStep === 5 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold uppercase tracking-wide flex items-center gap-2">
                  <User size={18} className="text-[#C72820]" />
                  Langkah 5: Informasi Pelanggan
                </h3>
                <button 
                  onClick={() => setBookingStep(4)} 
                  className="text-xs text-gray-500 hover:text-white cursor-pointer"
                >
                  Kembali
                </button>
              </div>

              <form onSubmit={handleBookingSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Nama Lengkap</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Budi Santoso"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full h-12 bg-white/[0.03] border border-white/10 rounded-xl px-4 text-sm focus:outline-none focus:border-[#C72820] placeholder:text-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Nomor WhatsApp</label>
                  <input
                    type="tel"
                    required
                    placeholder="Contoh: 08123456789"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full h-12 bg-white/[0.03] border border-white/10 rounded-xl px-4 text-sm focus:outline-none focus:border-[#C72820] placeholder:text-gray-700 font-mono"
                  />
                </div>

                {/* Home Service Address (Conditional) */}
                {(selectedService.name.toLowerCase().includes('home service') || selectedService.id === '3') && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-purple-400 mb-2">Alamat Lengkap Kunjungan</label>
                    <textarea
                      required
                      placeholder="Masukkan alamat lengkap rumah Anda. Maksimal 5 KM dari cabang terdekat."
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full p-4 bg-white/[0.03] border border-[#C72820]/30 rounded-xl text-sm focus:outline-none focus:border-[#C72820] placeholder:text-gray-700 min-h-[80px]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Metode Pembayaran</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'Cash', label: 'Bayar Cash di Tempat' },
                      { id: 'QRIS', label: 'QRIS Statis / E-Wallet' }
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPaymentMethod(p.id)}
                        className={`h-12 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border cursor-pointer flex items-center justify-center gap-2 ${
                          paymentMethod === p.id
                            ? 'bg-[#C72820]/15 border-[#C72820] text-white'
                            : 'bg-white/[0.01] border-white/5 text-gray-500'
                        }`}
                      >
                        <CreditCard size={14} />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Catatan Tambahan (Opsional)</label>
                  <input
                    type="text"
                    placeholder="Contoh: Ingin potong fade samping tipis"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-12 bg-white/[0.03] border border-white/10 rounded-xl px-4 text-sm focus:outline-none focus:border-[#C72820] placeholder:text-gray-700"
                  />
                </div>

                {/* Summary panel before submit */}
                <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 text-xs text-gray-400 space-y-1">
                  <p className="font-bold text-gray-300 uppercase tracking-widest mb-1.5">Ringkasan Reservasi</p>
                  <p>💇 Cabang: <span className="text-white font-semibold">{selectedBranch?.name}</span></p>
                  <p>💇 Layanan: <span className="text-white font-semibold">{selectedService?.name} (Rp {selectedService?.price.toLocaleString('id-ID')})</span></p>
                  <p>💇 Kapster: <span className="text-white font-semibold">{selectedBarber?.name}</span></p>
                  <p>📅 Jadwal: <span className="text-white font-semibold">{selectedDate} pada {selectedTime}</span></p>
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2 h-12 bg-[#C72820] text-[#FFF0EF] text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-[0_4px_30px_rgba(199,40,32,0.4)] disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? 'Mengirim Data...' : 'Konfirmasi & Kirim'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 6: SUCCESS & WA REDIRECT */}
          {bookingStep === 6 && bookingResult && (
            <div className="text-center space-y-6 py-6">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center text-green-500 mx-auto shadow-[0_0_24px_rgba(34,197,94,0.2)]">
                <Check size={32} strokeWidth={2.5} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-2xl font-black uppercase tracking-wide text-white">Booking Berhasil!</h3>
                <p className="text-xs text-gray-400 max-w-sm mx-auto">Data reservasi Anda telah berhasil disimpan di database RedBox Barbershop.</p>
              </div>

              <div className="max-w-md mx-auto p-5 rounded-2xl bg-white/[0.02] border border-white/5 text-left text-xs space-y-2 text-gray-300">
                <p className="font-bold text-sm text-white uppercase tracking-wider border-b border-white/5 pb-2 mb-2">Rincian Tiket Booking</p>
                <div className="grid grid-cols-2 gap-y-1.5 font-mono">
                  <p className="text-gray-500">KODE BOOKING:</p>
                  <p className="text-white font-bold">{bookingResult.id.substring(0, 8).toUpperCase()}</p>
                  
                  <p className="text-gray-500">NAMA:</p>
                  <p className="text-white font-semibold">{bookingResult.name}</p>

                  <p className="text-gray-500">LAYANAN:</p>
                  <p className="text-amber-500 font-semibold">{bookingResult.service}</p>

                  <p className="text-gray-500">CABANG:</p>
                  <p className="text-white font-semibold">{bookingResult.location}</p>

                  <p className="text-gray-500">WAKTU:</p>
                  <p className="text-white font-semibold">{bookingResult.date} | {bookingResult.time.slice(0, 5)} WIB</p>

                  <p className="text-gray-500">PEMBAYARAN:</p>
                  <p className="text-white font-semibold">{bookingResult.payment}</p>
                </div>
              </div>

              <div className="space-y-3 pt-4 max-w-sm mx-auto">
                <a
                  href={getWhatsAppConfirmationUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 h-12 bg-green-600 hover:bg-green-700 text-[#FFF0EF] text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-[0_4px_24px_rgba(22,163,74,0.3)] cursor-pointer"
                >
                  <MessageSquare size={15} />
                  Kirim Konfirmasi ke WA Cabang
                </a>
                
                <button
                  onClick={() => {
                    setBookingStep(1);
                    setSelectedBranch(null);
                    setSelectedService(null);
                    setSelectedBarber(null);
                    setSelectedDate('');
                    setSelectedTime('');
                    setCustomerName('');
                    setCustomerPhone('');
                    setNotes('');
                    setAddress('');
                    setBookingResult(null);
                  }}
                  className="w-full text-center text-[10px] text-gray-500 hover:text-white uppercase font-bold tracking-widest transition-colors cursor-pointer"
                >
                  Buat Booking Baru
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* WHY CHOOSE US / VALUES */}
      <section className="max-w-7xl mx-auto px-6 py-24 border-t border-white/5 bg-[#060408]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: <Award size={24} className="text-[#C72820]" />, title: 'Kapster Master & Senior', desc: 'Semua kapster kami menjalani sertifikasi ketat untuk menguasai teknik cukur modern dan gaya rambut vintage.' },
            { icon: <Shield size={24} className="text-amber-500" />, title: 'Higienitas Terjamin', desc: 'Setiap peralatan cukur dibersihkan menggunakan cairan disinfektan medis sebelum digunakan untuk kenyamanan Anda.' },
            { icon: <Sparkles size={24} className="text-purple-400" />, title: 'Analisis Gaya AI', desc: 'Rekomendasi gaya potong rambut cerdas disesuaikan dengan bentuk wajah dan tipe rambut Anda sebelum mencukur.' }
          ].map((item, i) => (
            <div key={i} className="p-6 rounded-2xl bg-white/[0.01] border border-white/5 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">{item.icon}</div>
              <h3 className="font-bold text-lg uppercase tracking-wide">{item.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#050306] border-t border-white/5 py-12 px-6 md:px-12 z-20 relative">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 pb-10 border-b border-white/5">
          <div className="space-y-4">
            <h3 className="text-lg font-black tracking-[0.2em]">
              <span className="text-[#F0EAEB]">RED</span>
              <span className="text-[#C72820]">BOX</span>
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Premium barbershop experience in Cirebon and Tegal. Bringing sharp styles and clean grooming to the modern gentlemen.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-widest font-bold text-gray-400">Cabang Kami</h4>
            <ul className="text-xs text-gray-500 space-y-1.5">
              <li>📍 Bypass Cirebon</li>
              <li>📍 Samadikun Cirebon</li>
              <li>📍 CSB Mall Cirebon</li>
              <li>📍 Sumber Kab. Cirebon</li>
              <li>📍 Tegal Kota</li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-widest font-bold text-gray-400">Akses Internal</h4>
            <a 
              href="/portal" 
              className="inline-flex items-center gap-1 text-xs text-[#C72820] hover:text-white font-bold uppercase tracking-wider transition-all"
            >
              Portal Staf RedBox <ChevronRight size={14} />
            </a>
          </div>
        </div>

        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center pt-8 text-[10px] text-gray-600 gap-4">
          <p>© 2026 RedBox Barbershop. All rights reserved.</p>
          <div className="flex gap-4">
            <span>Powered by Rasa Kopi Digital Studio</span>
          </div>
        </div>
      </footer>

      {/* FLOATING WHATSAPP CHAT WIDGET */}
      <div className="fixed bottom-6 right-6 z-50">
        <AnimatePresence>
          {isWaWidgetOpen && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.9 }}
              className="mb-4 w-72 rounded-2xl bg-slate-900 border border-slate-800 shadow-[0_16px_48px_rgba(0,0,0,0.8)] overflow-hidden"
            >
              {/* Widget Header */}
              <div className="p-4 bg-green-700 flex justify-between items-center text-white">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
                  <div>
                    <h4 className="font-bold text-xs uppercase tracking-wider">RedBox Support</h4>
                    <p className="text-[9px] opacity-75">Customer Business Chat</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsWaWidgetOpen(false)} 
                  className="p-1 rounded hover:bg-green-800 text-white cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Widget Body */}
              <div className="p-4 space-y-3 bg-[#0c101b]">
                <p className="text-[11px] text-slate-400 leading-normal">
                  Halo! Silakan pilih cabang terdekat untuk memulai chat dan konsultasi langsung dengan staf kami:
                </p>
                <div className="space-y-1.5">
                  {branches.map((branch) => (
                    <a
                      key={branch.id}
                      href={getWhatsAppGeneralUrl(branch.wa, branch.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 hover:bg-[#C72820]/10 border border-slate-800 hover:border-[#C72820]/30 transition-all text-xs font-semibold text-slate-200 hover:text-white"
                    >
                      <span>📍 Cabang {branch.name}</span>
                      <ChevronRight size={12} className="opacity-60" />
                    </a>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Float Button */}
        <motion.button
          onClick={() => setIsWaWidgetOpen(prev => !prev)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-14 h-14 rounded-full bg-green-600 hover:bg-green-700 text-white flex items-center justify-center shadow-[0_8px_32px_rgba(22,163,74,0.4)] border border-green-500/20 cursor-pointer relative"
        >
          {isWaWidgetOpen ? <X size={22} /> : <MessageSquare size={22} />}
          {!isWaWidgetOpen && (
            <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-[#C72820] border-2 border-slate-900 rounded-full animate-bounce" />
          )}
        </motion.button>
      </div>

    </div>
  );
}
