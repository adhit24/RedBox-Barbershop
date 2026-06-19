export type SlideId =
  | 'hair'
  | 'shave'
  | 'other'
  | 'packages'
  | 'membership'
  | 'reservation'
  | 'special';

export const SLIDE_DURATION_MS = 12000;

export const slides: { id: SlideId; index: string }[] = [
  { id: 'hair', index: '01' },
  { id: 'shave', index: '02' },
  { id: 'other', index: '03' },
  { id: 'packages', index: '04' },
  { id: 'membership', index: '05' },
  { id: 'reservation', index: '06' },
  { id: 'special', index: '07' },
];

export type ServiceItem = { name: string; desc: string };
export type CategorySlideData = {
  index: string;
  eyebrow: string;
  title: string;
  display: { line1: string; line2: string; italic: string };
  intro: string;
  upsell: string;
  bg: string;
  items: ServiceItem[];
};

export const categorySlides: Record<'hair' | 'shave' | 'other', CategorySlideData> = {
  hair: {
    index: '01',
    eyebrow: 'The Craft — Chapter One',
    title: 'Hair',
    display: { line1: 'Every strand,', line2: 'shaped with', italic: 'intent.' },
    intro:
      'From signature gentleman cuts to colour, texture, and restoration — your crown, refined by hands trained for years.',
    upsell:
      'Not sure where to start? Ask your barber to recommend a ritual built around your hair, your routine, your week.',
    bg: '/signage/cat-hair.jpg',
    items: [
      { name: 'Redbox Gentleman Grooming', desc: 'Our signature ritual — cut, wash, finish.' },
      { name: 'Hair Tattoo · Single & Double Side', desc: 'Bold lines, hand-carved by senior artists.' },
      { name: 'Hair Color', desc: 'From discreet grey blending to statement tones.' },
      { name: 'Hair Bleaching · Highlighting', desc: 'Lifted, layered, and protected through every step.' },
      { name: 'Hair Curly · Smoothing', desc: 'Texture engineered to last months, not days.' },
      { name: 'Hair Spa', desc: 'Deep nourishment for tired scalps.' },
      { name: 'Down Perm · Root Lift', desc: 'Effortless volume from the root.' },
    ],
  },
  shave: {
    index: '02',
    eyebrow: 'The Craft — Chapter Two',
    title: 'Shave',
    display: { line1: 'The lost art,', line2: 'kept', italic: 'alive.' },
    intro:
      'Hot towel, sharp blade, steady hand. A practice older than time — performed the way it was meant to be performed.',
    upsell:
      'Pair a Traditional Shave with our hot towel ritual — the small upgrade that defines the morning.',
    bg: '/signage/cat-shave.jpg',
    items: [
      { name: 'Shaving', desc: 'Clean, comfortable — the daily essential.' },
      { name: 'Traditional Shaving', desc: 'Straight razor. Warm lather. A ceremony.' },
      { name: 'Premium Head Shave', desc: 'Scalp prepped, polished, and protected.' },
    ],
  },
  other: {
    index: '03',
    eyebrow: 'The Craft — Chapter Three',
    title: 'Other Rituals',
    display: { line1: 'The quiet', line2: 'luxuries that', italic: 'finish a gentleman.' },
    intro:
      'The details most overlook — and the ones that change how a man moves through his day. Performed with care, and a measure of ceremony.',
    upsell:
      'Add a 15-minute ritual to any cut — a Charcoal Cleanse or Nose Wax slips beautifully into your visit.',
    bg: '/signage/cat-other.jpg',
    items: [
      { name: 'Men Massage Service', desc: 'Face & back relief, after a long week.' },
      { name: 'Nose Wax · Ear Wax', desc: 'Discreet detail work. Always.' },
      { name: 'Ear Singeing', desc: 'An old-world cleanse, performed with care.' },
      { name: 'Ear Candle', desc: 'Soft, soothing, ceremonial.' },
      { name: 'Charcoal Deep Cleansing', desc: 'A detox for skin that breathes city air.' },
      { name: 'Charcoal Nose Strip', desc: 'Pore-deep purge — a fifteen-minute reset.' },
    ],
  },
};

export const packages = [
  {
    name: 'Redbox Royal Grooming',
    tag: 'The full coronation.',
    items: 'Haircut · Face & Back Massage · Charcoal Cleansing · Traditional Shaving · Nose & Ear Waxing',
    image: '/signage/royal.jpg',
    hero: true,
  },
  {
    name: 'Redbox Duxe Grooming',
    tag: 'Deep cleanse, fully restored.',
    items: 'Haircut · Charcoal Deep Cleansing · Face Scrub · Hair Spa',
    image: '/signage/duxe.jpg',
  },
  {
    name: 'Redbox Earl Grooming',
    tag: 'Quiet luxury, well earned.',
    items: 'Haircut · Face & Back Massage · Hair Spa',
    image: '/signage/earl.jpg',
  },
  {
    name: 'Redbox Baron Grooming',
    tag: 'The signature cut.',
    items: 'Haircut / Fade / Long Trim',
    image: '/signage/baron.jpg',
  },
  {
    name: 'Redbox Noble Grooming',
    tag: 'Classic, with finishing touches.',
    items: 'Haircut · Face & Back Massage · Ear Singeing',
    image: '/signage/noble.jpg',
  },
];

export const membershipBenefits = [
  { n: '01', title: 'Priority Seat', body: 'Skip the wait. Your chair is reserved when you walk in.' },
  { n: '02', title: 'Member Pricing', body: 'Exclusive rates across every cut, shave, and ritual on the menu.' },
  { n: '03', title: 'Signature Perks', body: 'Complimentary hot towel · birthday grooming · early access to new services.' },
];

export const reservationFeatures = [
  { n: '01', title: 'Open Around the Clock', body: 'Book any seat, any time — 02.00 or 23.00. The chair is always within reach.' },
  { n: '02', title: 'Choose Your Barber', body: 'Pick the hand you trust. See their schedule, their specialties, their next opening.' },
  { n: '03', title: 'Instant Confirmation', body: 'No phone calls, no waiting. Your seat is held the moment you tap confirm.' },
  { n: '04', title: 'Reschedule with Ease', body: 'Plans change. Move your appointment in seconds — no awkward calls required.' },
];

export const bookingUrl = 'https://redboxbarbershop.com';

export const specialServices = [
  {
    id: 'home',
    eyebrow: 'Beyond the Chair — Lot I',
    title: 'Home Service',
    tagline: 'The shop, brought to you.',
    body: 'For the father who cannot leave, the executive between meetings, or the child more comfortable at home — a senior barber arrives with the full kit. The same ritual, in your space.',
    note: 'Booked one day in advance · within service area',
    image: '/signage/home.png',
  },
  {
    id: 'wedding',
    eyebrow: 'Beyond the Chair — Lot II',
    title: 'Wedding Service',
    tagline: 'Groomed for the moment.',
    body: 'On the day that will be photographed forever, the smallest details matter most. Our master barbers attend to the groom and his line — on location, before the first guest arrives.',
    note: 'Full grooming · groom & groomsmen · location service',
    image: '/signage/wedding.png',
  },
];
