'use strict';

const { REDBOX_KNOWLEDGE } = require('./redboxKnowledge');
const { validateKnowledge } = require('./validateKnowledge');
const {
  MAX_KNOWLEDGE_FACTS,
  MAX_KNOWLEDGE_PROMPT_CHARS,
  buildKnowledgeContext,
  serializedKnowledgeLength,
} = require('./knowledgeContext');

const DEFAULT_MAX_FACTS = MAX_KNOWLEDGE_FACTS;
const DEFAULT_MAX_CHARS = MAX_KNOWLEDGE_PROMPT_CHARS;
const WORD = 'a-z0-9';

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesAlias(text, alias) {
  const normalizedAlias = normalize(alias);
  if (!normalizedAlias) return false;
  const pattern = escapeRegex(normalizedAlias).replace(/\ /g, '\\s+');
  return new RegExp(`(^|[^${WORD}])${pattern}(?=$|[^${WORD}])`).test(text);
}

function resolveByAliases(items, text) {
  return items.find(item => [item.id, ...item.aliases].some(alias => includesAlias(text, alias)));
}

function explicitBranchReferenceStart(text) {
  const match = new RegExp(`(^|[^${WORD}])(?:cabang|branch)\\s+`).exec(text);
  return match ? match.index + match[0].length : -1;
}

function resolveExplicitBranch(branches, text) {
  const start = explicitBranchReferenceStart(text);
  if (start < 0) return undefined;
  const reference = text.slice(start);
  return branches.find(branch => [branch.id, ...branch.aliases].some(alias => {
    const normalizedAlias = normalize(alias);
    const pattern = escapeRegex(normalizedAlias).replace(/\ /g, '\\s+');
    return new RegExp(`^(?:di\\s+)?${pattern}(?=$|[^${WORD}])`).test(reference);
  }));
}

function trustedBranch(branches, branch) {
  const id = normalize(branch);
  return branches.find(item => item.id === id);
}

function hasExplicitBranchReference(text) {
  return explicitBranchReferenceStart(text) >= 0;
}

function dateInJakarta(now) {
  const date = now instanceof Date ? now : new Date();
  if (Number.isNaN(date.getTime())) throw new TypeError('now must be a valid Date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function promotionStatus(promotion, jakartaDate) {
  if (promotion.status !== 'active') return 'inactive';
  if (jakartaDate < promotion.valid_from) return 'future';
  if (jakartaDate > promotion.valid_until) return 'expired';
  return 'active';
}

function cloneFact(category, item) {
  return { category, ...structuredClone(item) };
}

function topicSignals(intent, text, service, branch) {
  const normalizedIntent = normalize(intent);
  const has = (...values) => values.includes(normalizedIntent);
  const signals = {
    general: has('general_chat', 'general', 'small_talk', 'greeting'),
    services: Boolean(service) || has('service', 'services', 'service_price', 'price', 'service_list') || /\b(harga|biaya|layanan|service)\b/.test(text),
    serviceList: has('service_list', 'services') || /\b(daftar|semua)\s+(layanan|service)\b/.test(text),
    branches: Boolean(branch) || has('branch', 'branches', 'branch_info', 'operating_hours', 'hours') || /\b(cabang|jam\s*(buka|tutup)|alamat)\b/.test(text),
    operational: has('operational_policy', 'operational_policies', 'policy') || /\b(kebijakan|operasional)\b/.test(text),
    booking: has('booking', 'booking_policy', 'booking_policies', 'booking_availability') || /\b(booking|reservasi|walk[ -]?in)\b/.test(text),
    live: has('booking_availability', 'availability', 'live_slot') || /\b(slot|kapster|tersedia|availability)\b/.test(text),
    membership: has('membership', 'membership_public') || /\b(member|membership|gold|silver|platinum|poin)\b/.test(text),
    promotion: has('promotion', 'promotions', 'promo') || /\bpromo\b/.test(text),
    faq: has('faq', 'faqs') || /\bpertanyaan umum\b/.test(text),
    contact: has('contact', 'contacts') || /\b(whatsapp|wa|kontak|hubungi)\b/.test(text),
    capability: has('capability', 'capabilities') || /\b(home service|wedding)\b/.test(text),
  };
  return signals;
}

function isPrivateMembershipRequest(text) {
  return /\b(saya|aku|my)\b.*\b(gold|silver|platinum|member|membership|poin|aktif)\b|\b(gold|silver|platinum|member|membership|poin)\b.*\b(saya|aku|aktif)\b/.test(text);
}

function serviceFact(service, selectedBranch) {
  const fact = cloneFact('service', service);
  if (selectedBranch) {
    const priceScope = selectedBranch.id === 'csb' ? 'csb' : 'standard';
    fact.price_scope = priceScope;
    fact.price_idr = service.prices[priceScope];
  }
  return fact;
}

function maxNumber(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function hardLimit(value, fallback, ceiling) {
  return Math.min(maxNumber(value, fallback), ceiling);
}

function boundContext({ topics, unknownFields, facts, maxFacts, maxChars }) {
  const candidates = facts.slice(0, maxFacts);
  let chosen = [];
  let dropped = facts.length > candidates.length;

  for (const fact of candidates) {
    const tentative = [...chosen, fact];
    const context = buildKnowledgeContext({ topics, unknown_fields: unknownFields, facts: tentative, bounded: dropped });
    if (serializedKnowledgeLength(context) > maxChars) {
      dropped = true;
      continue;
    }
    chosen = tentative;
  }

  let context = buildKnowledgeContext({ topics, unknown_fields: unknownFields, facts: chosen, bounded: dropped });
  while (chosen.length && serializedKnowledgeLength(context) > maxChars) {
    chosen = chosen.slice(0, -1);
    dropped = true;
    context = buildKnowledgeContext({ topics, unknown_fields: unknownFields, facts: chosen, bounded: dropped });
  }
  return context;
}

function resolveKnowledgeContext({
  intent = '', text = '', branch = '', now, knowledge = REDBOX_KNOWLEDGE,
  maxFacts = DEFAULT_MAX_FACTS, maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  validateKnowledge(knowledge);
  const normalizedText = normalize(text);
  const hasExplicitBranch = hasExplicitBranchReference(normalizedText);
  const explicitTextBranch = hasExplicitBranch ? resolveExplicitBranch(knowledge.branches, normalizedText) : undefined;
  const selectedTextBranch = hasExplicitBranch ? explicitTextBranch : resolveByAliases(knowledge.branches, normalizedText);
  const selectedHandlerBranch = trustedBranch(knowledge.branches, branch);
  const unknownFields = [];
  const explicitUnknownBranch = hasExplicitBranch && !explicitTextBranch;
  const selectedBranch = explicitUnknownBranch ? undefined : (selectedTextBranch || selectedHandlerBranch);
  if (explicitUnknownBranch || (branch && !selectedHandlerBranch && !selectedTextBranch)) unknownFields.push('branch');

  const service = resolveByAliases(knowledge.services, normalizedText);
  const signals = topicSignals(intent, normalizedText, service, selectedBranch);
  if (signals.general) {
    return buildKnowledgeContext({ status: 'no_verified_fact', topics: [], facts: [], unknown_fields: [] });
  }

  const topics = [];
  const facts = [];
  const addTopic = value => { if (!topics.includes(value)) topics.push(value); };
  const addFact = fact => { if (!facts.some(existing => existing.category === fact.category && existing.id === fact.id)) facts.push(fact); };

  if (signals.live) {
    addTopic('booking');
    addFact(cloneFact('capability', knowledge.capabilities.find(item => item.id === 'live-booking-boundary')));
  } else if (signals.membership && isPrivateMembershipRequest(normalizedText)) {
    addTopic('membership_public');
    addFact(cloneFact('capability', knowledge.capabilities.find(item => item.id === 'membership-crm-boundary')));
  } else {
    if (signals.branches) {
      addTopic('branches');
      if (selectedBranch) addFact(cloneFact('branch', selectedBranch));
      else if (!explicitUnknownBranch && !branch) knowledge.branches.forEach(item => addFact(cloneFact('branch', item)));
      if (selectedBranch) addFact(cloneFact('operational_policy', knowledge.operational_policies.find(item => item.id === 'operating-hours')));
    }

    if (signals.operational) {
      addTopic('operational_policies');
      knowledge.operational_policies.forEach(item => addFact(cloneFact('operational_policy', item)));
    }

    if (signals.services) {
      addTopic('services');
      if (service) addFact(serviceFact(service, selectedBranch));
      else if (signals.serviceList) knowledge.services.forEach(item => addFact(serviceFact(item, selectedBranch)));
      else if (/\b(harga|biaya)\b/.test(normalizedText)) unknownFields.push('service');
    }

    if (signals.booking) {
      addTopic('booking_policies');
      knowledge.booking_policies.forEach(item => addFact(cloneFact('booking_policy', item)));
    }

    if (signals.membership) {
      addTopic('membership_public');
      addFact({ category: 'membership_public', id: 'membership-public', ...structuredClone(knowledge.membership_public) });
    }

    if (signals.faq) {
      addTopic('faqs');
      knowledge.faqs.forEach(item => addFact(cloneFact('faq', item)));
    }

    if (signals.promotion) {
      addTopic('promotions');
      const jakartaDate = dateInJakarta(now);
      knowledge.promotions.forEach(item => {
        if (!selectedBranch || item.branches.includes(selectedBranch.id)) {
          addFact({ category: 'promotion', ...structuredClone(item), status: promotionStatus(item, jakartaDate) });
        }
      });
    }

    if (signals.contact) {
      addTopic('contacts');
      knowledge.contacts.filter(item => item.public && (!selectedBranch || item.branches.includes(selectedBranch.id)))
        .forEach(item => addFact(cloneFact('contact', item)));
    }

    if (signals.capability) {
      addTopic('capabilities');
      const capabilityId = /\bwedding\b/.test(normalizedText) ? 'wedding-grooming' : 'home-service';
      addFact(cloneFact('capability', knowledge.capabilities.find(item => item.id === capabilityId)));
    }
  }

  return boundContext({
    topics,
    unknownFields: [...new Set(unknownFields)],
    facts,
    maxFacts: hardLimit(maxFacts, DEFAULT_MAX_FACTS, MAX_KNOWLEDGE_FACTS),
    maxChars: hardLimit(maxChars, DEFAULT_MAX_CHARS, MAX_KNOWLEDGE_PROMPT_CHARS),
  });
}

module.exports = { resolveKnowledgeContext };
