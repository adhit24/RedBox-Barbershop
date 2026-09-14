'use strict';

const { buildCustomerFactsContext } = require('./customerFactsContext');
const { serializeKnowledgeForPrompt } = require('./knowledge/knowledgeContext');
const { loadCanonicalBarbers, resolveCanonicalBarber } = require('../../services/canonicalBarberResolver');
const { getBarberScheduleStatus } = require('../../services/barberScheduleAuthority');
const { checkBarberAvailability } = require('../../services/barberAvailabilityQuery');
const {
  extractBookingContext, buildPrefilledBookingUrl, reconstructBookingContextFromTurns, resolveRelativeDate,
  resolveBranch, resolveTimeAndPreference, resolveTimePeriodRange,
} = require('./bookingContext');
const { guardReddyReply, suppressUnsolicitedBookingCta, REDDY_BOOKING_EXECUTION } = require('./bookingGuards');
const { guardRealtimeBarberFacts } = require('./realtimeFactGuard');
const { stripGenericClosingQuestion } = require('./closingSuppressionGuard');
const { deriveBookingEligibility } = require('./bookingEligibility');
const { logOrchestratedEvent, logAvailabilityQueryEvent } = require('../../orchestrator/telemetry');
const { classifyBarberPresenceQuery } = require('./barberPresenceIntent');
const { classifyDeterministically } = require('../../orchestrator/routingPolicy');

// Staging-verification P1 fix: a cheap, free pre-check (no DB) so the roster
// is fetched only for messages that could plausibly be a bare barber-name
// availability question — never on every inbound message.
const BARE_BARBER_AVAILABILITY_PRECHECK = /\b(ada|kosong|available|penuh|full|masuk|jadwal|slot|bisa|kerja)\b/i;

// Reddy barber-availability MVP: orchestrator intents backed by
// server/services/barberAvailabilityQuery.js — always answered from a real,
// deterministic tool lookup, never from LLM free-form text (spec §10).
const AVAILABILITY_QUERY_INTENTS = new Set([
  'barber_availability_query',
  'specific_time_availability_query',
  'branch_availability_query',
]);

const BOOKING_URL = 'https://www.redboxbarbershop.com/booking.html';

/**
 * Resolve the parameters an availability lookup needs from the current
 * message + already-resolved context. Branch/date/time are always
 * re-resolved fresh per turn (spec §23 freshness rule) — never carried over
 * silently from a stale earlier decision.
 */
function resolveAvailabilityParams(text, { branch, barberMatch, fallbackDate = null } = {}) {
  const explicitBranch = resolveBranch(text);
  const resolvedBranch = explicitBranch || barberMatch?.barber?.branch || branch;
  // Fresh-per-turn date resolution (spec §23): the CURRENT message's own
  // explicit date always wins; only when it says nothing about date do we
  // fall back to the barber/date carried over from conversation history
  // (never a cached availability RESULT — see the contextual time-refinement
  // follow-up fix), and only after that to "today".
  const dateResolution = resolveRelativeDate(text)
    || (fallbackDate ? { date: fallbackDate } : null)
    || resolveRelativeDate('hari ini');
  const timeResolution = resolveTimeAndPreference(text);
  const timeRange = !timeResolution.time ? resolveTimePeriodRange(text) : null;
  return {
    branch: resolvedBranch,
    date: dateResolution?.date || null,
    time: timeResolution.time || null,
    timeRange,
  };
}

function formatSlotList(slots) {
  if (slots.length <= 1) return slots.join('');
  return `${slots.slice(0, -1).join(', ')} dan ${slots[slots.length - 1]}`;
}

/**
 * Deterministic, zero-LLM reply builder for the barber-availability MVP
 * (spec §12/§13). Every branch is filled ONLY from the tool result — never
 * guessed — and never claims a slot is reserved/held/locked.
 */
function buildAvailabilityReply({ mode, barberName, availability }) {
  if (!availability?.success) {
    return `Aku belum bisa baca jadwal live-nya sebentar ini kak. Buat memastikan slotnya, cek langsung di booking Redbox ya:\n${BOOKING_URL}`;
  }

  if (mode === 'branch_wide') {
    const { barbers = [] } = availability;
    if (!barbers.length) {
      return 'Untuk jam itu belum ada kapster yang keliatan kosong kak. Coba cek jam lain ya, atau langsung lihat di website Redbox.';
    }
    const names = barbers.map((b) => `Mas ${b.name}`);
    return `Sekarang masih ada ${formatSlotList(names)} kak 👍\n\nKalau mau ambil salah satunya, booking-nya tetap lewat website Redbox ya: ${BOOKING_URL}`;
  }

  const name = `Mas ${barberName}`;

  if (availability.reason_code === 'barber_off') {
    return `Hari ini ${name} lagi nggak ada jadwal kak.`;
  }

  if (Object.hasOwn(availability, 'requested_time')) {
    if (availability.available) {
      return `Iya kak, dari jadwal saat ini ${name} masih available jam ${availability.requested_time} 👍\n\nKalau mau diamankan, tinggal booking lewat website Redbox ya: ${BOOKING_URL}`;
    }
    const alternatives = availability.alternative_slots || [];
    if (alternatives.length) {
      return `Jam ${availability.requested_time} ${name} udah terisi kak. Yang masih available paling dekat jam ${formatSlotList(alternatives)}.`;
    }
    return `Jam ${availability.requested_time} ${name} udah terisi kak, dan belum keliatan slot kosong lain hari ini.`;
  }

  if (availability.reason_code === 'no_slot') {
    return `${name} masuk hari ini, tapi slot beliau udah penuh kak.`;
  }

  const slots = availability.available_slots || [];
  return `${name} hari ini masih ada slot jam ${formatSlotList(slots)} kak 👍\n\nKalau mau ambil salah satunya, booking-nya lewat website Redbox ya: ${BOOKING_URL}`;
}

// Task orchestratorService.buildDecisionEnvelope already decided, upstream,
// whether this turn is a customer-reported booking completion ("sudah kak",
// "udah booking di web"). Reddy must acknowledge naturally but must NEVER
// claim a backend-confirmed booking or repeat the booking CTA — the safest
// way to guarantee both is a single deterministic reply that bypasses the
// LLM (and therefore also bypasses guardReddyReply's prohibited-claim regex,
// which cannot distinguish "Reddy claims it booked" from "customer says they
// already booked" and was the actual source of the original bug).
const BOOKING_COMPLETION_ACK_REPLY =
  'Sip Kak, kalau sudah selesai booking di website berarti tinggal datang sesuai jadwal yang dipilih ya.';

// Explicit future schedule questions retain the existing time-bound lookup.
// Bare current questions are handled earlier by classifyBarberPresenceQuery;
// they must not depend on these explicit temporal markers.
const REALTIME_BARBER_QUERY_VERB_PATTERN = /\b(masuk|kerja|hadir|ada|tersedia|standby|bertugas)\b/i;
const REALTIME_BARBER_QUERY_TIME_PATTERN = /\bhari\s*ini\b|\bsekarang\b|\bbesok\b|\blusa\b/i;

function jakartaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// International WhatsApp multilingual contract, correction round 2: extended
// to Japanese and Spanish (the two languages the contract's own barber
// presence authority tests name) — mirrors the Indonesian branch's exact
// fact structure (ambiguous / not-found / scheduled±caveat / not-scheduled /
// unknown) so the language-switch is presentation-only, never a fact change.
// Deliberately bounded to these two; other languages keep using the existing
// LLM + guardRealtimeBarberFacts backstop path (see the gate below).
function buildPresenceReply({
  barberMatch, scheduleStatus, claimType, responseLanguage = 'indonesian',
}) {
  const lang = String(responseLanguage || 'indonesian').toLowerCase();

  if (lang === 'japanese') {
    if (barberMatch.status === 'ambiguous') {
      return '同じ名前のスタイリストが複数在籍しています。どちらの店舗のスタイリストでしょうか？';
    }
    if (barberMatch.status !== 'verified') {
      return '恐れ入りますが、そのお名前のスタイリストが見つかりませんでした。お名前をもう一度教えていただけますか？';
    }
    const name = `${barberMatch.barber.name}さん`;
    if (scheduleStatus?.status === 'scheduled') {
      if (claimType === 'availability') {
        return `${name}は本日出勤予定ですが、今すぐ対応可能かどうかは確認済みのデータでは分かりかねます。`;
      }
      return `${name}は本日出勤予定ですが、今この瞬間の在店状況を確認できるデータはございません。`;
    }
    if (scheduleStatus?.status === 'not_scheduled') {
      return `${name}は本日の出勤予定に入っておりません。`;
    }
    return `${name}が今いるかどうか、確認済みのデータでは分かりかねます。`;
  }

  if (lang === 'spanish') {
    if (barberMatch.status === 'ambiguous') {
      return 'Hay más de un barbero con ese nombre. ¿A qué sucursal te refieres?';
    }
    if (barberMatch.status !== 'verified') {
      return 'No encontré a ese barbero en los datos activos. ¿Puedes escribir el nombre de nuevo?';
    }
    const name = barberMatch.barber.name;
    if (scheduleStatus?.status === 'scheduled') {
      if (claimType === 'availability') {
        return `${name} sí está programado para trabajar hoy, pero no puedo confirmar con datos verificados si está disponible en este momento.`;
      }
      return `${name} sí está programado para trabajar hoy, pero no tengo datos verificados de asistencia para confirmar que esté ahí ahora mismo.`;
    }
    if (scheduleStatus?.status === 'not_scheduled') {
      return `${name} no figura programado para trabajar hoy.`;
    }
    return `No puedo confirmar si ${name} está ahí ahora mismo con datos verificados.`;
  }

  if (barberMatch.status === 'ambiguous') {
    return 'Ada lebih dari satu kapster dengan nama itu, Kak. Cabang mana yang Kak maksud?';
  }
  if (barberMatch.status !== 'verified') {
    return 'Aku belum menemukan nama kapster itu di data kapster aktif, Kak. Bisa tulis nama kapsternya lagi?';
  }

  const name = `Mas ${barberMatch.barber.name}`;
  if (scheduleStatus?.status === 'scheduled') {
    if (claimType === 'availability') {
      return `${name} memang dijadwalkan masuk hari ini, Kak. Tapi aku belum bisa memastikan beliau sedang free/tersedia sekarang dari data yang terverifikasi.`;
    }
    return `${name} memang dijadwalkan masuk hari ini, Kak. Tapi aku belum punya data check-in/kehadiran untuk memastikan beliau sudah hadir sekarang.`;
  }
  if (scheduleStatus?.status === 'not_scheduled') {
    return `${name} tidak tercatat dijadwalkan masuk hari ini, Kak.`;
  }
  return `Aku belum bisa memastikan ${name} ada sekarang dari data yang terverifikasi, Kak.`;
}

async function resolvePresenceFactDecision({ text, supabase, loadBarbers, getSchedule }) {
  let canonicalSource;
  try {
    canonicalSource = await loadBarbers(supabase);
  } catch (_error) {
    canonicalSource = { status: 'unavailable', barbers: [], reason: 'canonical_source_error' };
  }

  const barberMatch = resolveCanonicalBarber(text, canonicalSource?.barbers || [], null);
  let scheduleStatus = null;
  if (barberMatch.status === 'verified' && supabase) {
    try {
      scheduleStatus = await getSchedule(supabase, {
        barberId: barberMatch.barber.id,
        date: jakartaDate(),
      });
    } catch (_error) {
      scheduleStatus = { status: 'unknown', source: null, date: jakartaDate() };
    }
  }

  const barber = barberMatch.status === 'verified'
    ? {
      id: barberMatch.barber.id,
      name: barberMatch.barber.name,
      branch: barberMatch.barber.branch,
    }
    : null;

  return {
    canonicalSource,
    barberMatch,
    scheduleStatus,
    factDecision: {
      barber,
      schedule_status: scheduleStatus?.status || 'unknown',
      attendance_status: 'unavailable',
      availability_status: 'unverified',
    },
  };
}

/**
 * Redbox Reddy Execution Adapter v0.1
 * Adapts AI Orchestrator route decision ("reddy_agent") to existing Reddy conversation execution.
 */

async function executeReddyAgent(params = {}, dependencies = {}) {
  const {
    from,
    name,
    text,
    branch = 'bypass',
    knowledgeContext = null,
    customerIntelligence = null,
    conversationContext = null,
    orchestrationDecision = null,
  } = params;
  const {
    callOpenAI,
    sendWA,
    supabase = null,
    loadBarbers = loadCanonicalBarbers,
    getSchedule = getBarberScheduleStatus,
    getAvailability = checkBarberAvailability,
    logBookingTelemetry = logOrchestratedEvent,
    logAvailability = logAvailabilityQueryEvent,
    persistConversation = null,
  } = dependencies;

  if (!callOpenAI || typeof callOpenAI !== 'function') {
    throw new Error('callOpenAI dependency function required for Reddy execution');
  }

  let factsContext = null;
  if (customerIntelligence) {
    factsContext = buildCustomerFactsContext(customerIntelligence);
  }

  let knowledgeFactsContext = knowledgeContext?.knowledgeFactsContext || null;
  if (!knowledgeFactsContext && knowledgeContext) {
    if (typeof knowledgeContext === 'string') {
      knowledgeFactsContext = knowledgeContext;
    } else {
      knowledgeFactsContext = serializeKnowledgeForPrompt(knowledgeContext);
    }
  }

  let reply;
  let used = 'reddy_agent';
  let error = null;

  // Verified CRM name source: derive ONLY from customerIntelligence facts or customer entity
  const verifiedCrmName = customerIntelligence?.facts?.name || customerIntelligence?.customer?.name || null;
  const presenceIntent = classifyBarberPresenceQuery(text);
  const responseLanguage = String(conversationContext?.response_language || 'indonesian').toLowerCase();

  // Task 14.1 correction round 2: booking MEMORY, booking RESPONSE authority,
  // and booking CTA authority are three genuinely different, separately
  // computed questions — see bookingEligibility.js for the exact rules.
  // Booking-adjacent VOCABULARY (barber, kapster, jam, besok...) alone is
  // deliberately NOT enough for response/CTA eligibility; it only feeds the
  // (intentionally broad) memory layer.
  const {
    memoryRelevant: bookingMemoryRelevant,
    responseEligible: bookingResponseEligible,
    ctaEligible: derivedBookingCtaEligible,
    reason: derivedBookingEligibilityReason,
  } = deriveBookingEligibility({ text, orchestrationDecision });
  const bookingCtaEligible = presenceIntent.matched ? false : derivedBookingCtaEligible;
  const bookingEligibilityReason = presenceIntent.matched
    ? 'barber_presence_fact_query'
    : derivedBookingEligibilityReason;

  const isBookingCompletionReport = orchestrationDecision?.conversational_act === 'booking_completion_report';

  if (isBookingCompletionReport) {
    const completionReply = BOOKING_COMPLETION_ACK_REPLY;

    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_completion_acknowledged',
      branch,
      trust_status: 'unverified',
      execution_status: 'acknowledged',
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });

    if (persistConversation && typeof persistConversation === 'function') {
      await persistConversation(
        from, conversationContext?.turns || [], text, completionReply,
        {}, conversationContext?.providerDeviceHash || null,
      );
    }

    let completionSendResult = null;
    if (sendWA && typeof sendWA === 'function') {
      try {
        completionSendResult = await sendWA(from, completionReply, { branch });
      } catch (err) {
        err.outboundFailure = true;
        err.failureReason = err.failureReason || 'processing_failed';
        throw err;
      }
    }

    return { used: 'reddy_agent', reply: completionReply, sendResult: completionSendResult, error: null };
  }

  // P0 first-turn presence fact decision. Facts are resolved deterministically
  // and never expose roster rows to an LLM. Presentation remains owned by the
  // already-resolved conversation language: Indonesian/Japanese/Spanish keep
  // the zero-LLM response (buildPresenceReply has a dedicated branch for
  // each — round 2 correction, tests 25/26), while any other language
  // receives only the bounded fact decision and falls through to the LLM +
  // guardRealtimeBarberFacts backstop path below (English's existing route).
  let presenceResolution = null;
  if (presenceIntent.matched) {
    presenceResolution = await resolvePresenceFactDecision({
      text, supabase, loadBarbers, getSchedule,
    });

    const useDeterministicPresencePresentation = ['indonesian', 'japanese', 'spanish'].includes(responseLanguage);

    if (useDeterministicPresencePresentation) {
      const { barberMatch, scheduleStatus } = presenceResolution;
      let presenceReply = buildPresenceReply({
        barberMatch,
        scheduleStatus,
        claimType: presenceIntent.claimType,
        responseLanguage,
      });

      // Barber-availability MVP enrichment: when the barber is verified,
      // scheduled to work, and we can resolve real slot data, upgrade the
      // bare "he's scheduled" fact into actual slot times (spec §12, the
      // literal "Mas Abdul hari ini ada?" example) instead of leaving the
      // customer with only a yes/no. Only applies to Indonesian presentation
      // (the richer template set is not yet localized); any lookup failure
      // falls back to the unchanged presence-only reply above.
      if (responseLanguage === 'indonesian' && barberMatch.status === 'verified'
        && scheduleStatus?.status === 'scheduled' && supabase) {
        const availParams = resolveAvailabilityParams(text, { branch, barberMatch });
        if (availParams.date) {
          const availStart = Date.now();
          let availability = null;
          try {
            availability = await getAvailability(supabase, {
              branch: availParams.branch,
              barberId: barberMatch.barber.id,
              date: availParams.date,
              time: availParams.time,
              timeRange: availParams.timeRange,
            });
          } catch (_error) {
            availability = null;
          }
          if (availability?.success) {
            presenceReply = buildAvailabilityReply({
              mode: 'single_barber', barberName: barberMatch.barber.name, availability,
            });
            logAvailability({
              branch: availParams.branch,
              barber_id: barberMatch.barber.id,
              intent: 'barber_availability_query',
              requested_date: availParams.date,
              requested_time: availParams.time,
              result_status: availability.reason_code,
              result_count: (availability.available_slots || []).length,
              latency_ms: Date.now() - availStart,
              customer_phone: from,
            });
          }
        }
      }

      logBookingTelemetry({
        route: 'reddy_agent',
        agent: 'reddy_agent',
        intent: orchestrationDecision?.intent || 'barber_inquiry',
        action: 'barber_presence_first_turn_guard',
        branch: barberMatch.barber?.branch || branch,
        trust_status: scheduleStatus?.status === 'scheduled' || scheduleStatus?.status === 'not_scheduled'
          ? 'verified' : 'unverified',
        execution_status: 'deterministic_response',
        booking_cta_eligible: false,
      });

      if (persistConversation && typeof persistConversation === 'function') {
        await persistConversation(
          from, conversationContext?.turns || [], text, presenceReply,
          {}, conversationContext?.providerDeviceHash || null,
        );
      }
      let presenceSendResult = null;
      if (sendWA && typeof sendWA === 'function') {
        try {
          presenceSendResult = await sendWA(from, presenceReply, { branch });
        } catch (err) {
          err.outboundFailure = true;
          err.failureReason = err.failureReason || 'processing_failed';
          throw err;
        }
      }
      return {
        used: 'reddy_barber_presence_guard',
        reply: presenceReply,
        sendResult: presenceSendResult,
        error: null,
      };
    }
  }

  const realtimeBarberQuerySignal = REALTIME_BARBER_QUERY_VERB_PATTERN.test(String(text || ''))
    && REALTIME_BARBER_QUERY_TIME_PATTERN.test(String(text || ''));

  const upstreamAvailabilityIntentMatched = responseLanguage === 'indonesian'
    && AVAILABILITY_QUERY_INTENTS.has(orchestrationDecision?.intent);

  // Staging-verification P1 fix: a bare barber name with no honorific
  // ("abdul ada ga hari ini") isn't classified upstream at all (the
  // orchestrator's classifier has no barber roster) and would otherwise
  // silently miss this capability. This cheap regex pre-check decides
  // whether it's even worth loading the roster below; the actual roster-
  // aware decision happens once canonicalBarberSource is available.
  //
  // Restricted to a "weak" upstream classification (unknown/general_question)
  // — same guard orchestratorService.js's own contextual-followup branches
  // use before overriding. A message already classified into a SPECIFIC
  // business intent (e.g. 'barber_inquiry', tested extensively by the
  // existing realtime-fact-guard suite for phrasing like "Mas X masuk hari
  // ini gak?") must never be silently re-routed just because it also
  // happens to contain a roster name + a signal word like "masuk".
  const WEAK_UPSTREAM_INTENTS = new Set(['unknown', 'general_question']);
  const maybeBareBarberAvailability = !upstreamAvailabilityIntentMatched
    && responseLanguage === 'indonesian'
    && WEAK_UPSTREAM_INTENTS.has(orchestrationDecision?.intent)
    && BARE_BARBER_AVAILABILITY_PRECHECK.test(String(text || ''));

  const canonicalBarberSource = presenceResolution?.canonicalSource
    || ((bookingMemoryRelevant || realtimeBarberQuerySignal || upstreamAvailabilityIntentMatched || maybeBareBarberAvailability)
      ? await loadBarbers(supabase)
      : { status: 'not_requested', barbers: [], reason: null });

  // Roster is now available (if it was going to be loaded at all) — resolve
  // the actual bare-name decision. A booking-write verb or an already-
  // resolved non-availability intent from a real business topic never gets
  // overridden; classifyBareBarberAvailability's own write-verb guard
  // handles the former, and the roster/signal-word requirement keeps this
  // narrow (never fires on an unrelated message that merely mentions a
  // barber's name, e.g. "Abdul ganteng juga ya").
  let effectiveAvailabilityIntent = upstreamAvailabilityIntentMatched ? orchestrationDecision.intent : null;
  if (!effectiveAvailabilityIntent && maybeBareBarberAvailability && canonicalBarberSource?.barbers?.length) {
    const bareClassification = classifyDeterministically(text, {
      canonicalBarberNames: canonicalBarberSource.barbers.map((b) => b.name),
    });
    if (bareClassification && AVAILABILITY_QUERY_INTENTS.has(bareClassification.intent)) {
      effectiveAvailabilityIntent = bareClassification.intent;
    }
  }
  const availabilityIntentMatched = Boolean(effectiveAvailabilityIntent);
  const effectiveOrchestrationDecision = effectiveAvailabilityIntent && effectiveAvailabilityIntent !== orchestrationDecision?.intent
    ? { ...orchestrationDecision, intent: effectiveAvailabilityIntent, action: 'answer_barber_availability' }
    : orchestrationDecision;

  // Barber-availability MVP: specific-time and branch-wide queries never
  // match classifyBarberPresenceQuery's bare current-tense regex (it
  // requires the WHOLE message to be a presence-shaped question — "Abdul
  // kosong jam berapa?" and "jam 7 malam Bypass siapa yang kosong?" both
  // fail that anchor), so they get their own deterministic, zero-LLM branch
  // here, gated on the orchestrator's own intent classification instead.
  if (availabilityIntentMatched && supabase) {
    let barberMatch = resolveCanonicalBarber(text, canonicalBarberSource?.barbers || [], null);
    let historicalFallbackDate = null;

    // Contextual time-refinement follow-up ("Kalau jam 8?", "Jam 7?") carries
    // no barber/date of its own — only the orchestrator-level routing fix
    // (contextReference === 'prior_availability_barber_date') recovers
    // enough SEMANTIC context (never a cached availability result) via the
    // existing bookingContext.js accumulator to fill them back in.
    if (effectiveOrchestrationDecision.context_reference === 'prior_availability_barber_date'
      && barberMatch.status !== 'verified') {
      const historicalContext = extractBookingContext(
        text,
        reconstructBookingContextFromTurns(conversationContext?.turns || [], {
          sessionStatus: conversationContext?.sessionStatus,
          canonicalBarbers: canonicalBarberSource?.barbers || [],
        }),
        { canonicalBarbers: canonicalBarberSource?.barbers || [] },
      );
      if (historicalContext.barber?.id) {
        barberMatch = {
          status: 'verified',
          barber: {
            id: historicalContext.barber.id, name: historicalContext.barber.name, branch: historicalContext.barber.branch,
          },
          reason: null,
        };
      }
      historicalFallbackDate = historicalContext.date?.value || null;
    }

    const isBranchWide = effectiveOrchestrationDecision.intent === 'branch_availability_query'
      || barberMatch.status !== 'verified';
    const availParams = resolveAvailabilityParams(text, { branch, barberMatch, fallbackDate: historicalFallbackDate });

    let availabilityReply = null;
    let telemetryResult = null;
    if (!isBranchWide) {
      const availStart = Date.now();
      let availability = null;
      try {
        availability = await getAvailability(supabase, {
          branch: availParams.branch,
          barberId: barberMatch.barber.id,
          date: availParams.date,
          time: availParams.time,
          timeRange: availParams.timeRange,
        });
      } catch (_error) {
        availability = { success: false, reason_code: 'tool_error' };
      }
      availabilityReply = buildAvailabilityReply({ mode: 'single_barber', barberName: barberMatch.barber.name, availability });
      telemetryResult = { availability, barberId: barberMatch.barber.id, latency: Date.now() - availStart };
    } else if (barberMatch.status !== 'verified' && effectiveOrchestrationDecision.intent !== 'branch_availability_query') {
      // Named-but-unresolved barber on a barber/specific-time query: never
      // silently fall through to the branch-wide answer for a name we
      // simply failed to match — tell the customer plainly instead.
      availabilityReply = barberMatch.status === 'ambiguous'
        ? 'Ada lebih dari satu kapster dengan nama itu, Kak. Cabang mana yang Kak maksud?'
        : 'Aku belum menemukan nama kapster itu di data kapster aktif, Kak. Bisa tulis nama kapsternya lagi?';
    } else {
      const availStart = Date.now();
      let availability = null;
      try {
        availability = await getAvailability(supabase, {
          branch: availParams.branch,
          date: availParams.date,
          time: availParams.time,
          timeRange: availParams.timeRange,
        });
      } catch (_error) {
        availability = { success: false, reason_code: 'tool_error' };
      }
      availabilityReply = buildAvailabilityReply({ mode: 'branch_wide', availability });
      telemetryResult = { availability, barberId: null, latency: Date.now() - availStart };
    }

    if (telemetryResult) {
      logAvailability({
        branch: availParams.branch,
        barber_id: telemetryResult.barberId,
        intent: effectiveOrchestrationDecision.intent,
        requested_date: availParams.date,
        requested_time: availParams.time,
        result_status: telemetryResult.availability.reason_code || (telemetryResult.availability.success ? 'success' : 'tool_error'),
        result_count: (telemetryResult.availability.available_slots || telemetryResult.availability.barbers || []).length,
        latency_ms: telemetryResult.latency,
        partial: Boolean(telemetryResult.availability.partial),
        customer_phone: from,
      });
    }

    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: effectiveOrchestrationDecision.intent,
      action: 'answer_barber_availability',
      branch: availParams.branch,
      trust_status: telemetryResult?.availability?.success ? 'verified' : 'unverified',
      execution_status: 'deterministic_response',
      booking_cta_eligible: false,
    });

    if (persistConversation && typeof persistConversation === 'function') {
      await persistConversation(
        from, conversationContext?.turns || [], text, availabilityReply,
        {}, conversationContext?.providerDeviceHash || null,
      );
    }
    let availabilitySendResult = null;
    if (sendWA && typeof sendWA === 'function') {
      try {
        availabilitySendResult = await sendWA(from, availabilityReply, { branch });
      } catch (err) {
        err.outboundFailure = true;
        err.failureReason = err.failureReason || 'processing_failed';
        throw err;
      }
    }
    return {
      used: 'reddy_barber_availability_guard',
      reply: availabilityReply,
      sendResult: availabilitySendResult,
      error: null,
    };
  }

  // Task 14.1 correction round 2 (Blocker 3): registered-at-branch (roster),
  // scheduled-today (barber_working_hours + barber_date_overrides via
  // getBarberScheduleStatus), present-now (attendance — no source exists),
  // and available-for-a-slot are four separate authorities. Only the first
  // two are ever fetched here; the real-time fact guard below never lets a
  // reply upgrade "scheduled" into "present"/"attending" regardless.
  let verifiedSchedule = null;
  if (presenceResolution?.barberMatch?.status === 'verified'
    && presenceResolution?.scheduleStatus
    && presenceResolution.scheduleStatus.status !== 'unknown') {
    verifiedSchedule = {
      barberName: presenceResolution.barberMatch.barber.name,
      status: presenceResolution.scheduleStatus.status,
      date: presenceResolution.scheduleStatus.date,
    };
  } else if (realtimeBarberQuerySignal && supabase) {
    const scheduleBarberMatch = resolveCanonicalBarber(text, canonicalBarberSource?.barbers || [], null);
    const scheduleDate = resolveRelativeDate(text) || resolveRelativeDate('hari ini');
    if (scheduleBarberMatch.status === 'verified' && scheduleDate?.date) {
      const scheduleStatus = await getSchedule(supabase, {
        barberId: scheduleBarberMatch.barber.id,
        date: scheduleDate.date,
      });
      if (scheduleStatus && scheduleStatus.status !== 'unknown') {
        verifiedSchedule = {
          barberName: scheduleBarberMatch.barber.name,
          status: scheduleStatus.status,
          date: scheduleStatus.date,
        };
      }
    }
  }
  // booking_context is never persisted to storage (only raw {role, content} turns
  // are) — so the prior turn's structured preferences are reconstructed statelessly
  // from recent customer turns each request, respecting the existing session policy.
  const priorBookingContext = bookingMemoryRelevant
    ? reconstructBookingContextFromTurns(conversationContext?.turns || [], {
      sessionStatus: conversationContext?.sessionStatus,
      canonicalBarbers: canonicalBarberSource?.barbers || [],
    })
    : null;
  const bookingContext = bookingMemoryRelevant
    ? extractBookingContext(text, priorBookingContext, {
      canonicalBarbers: canonicalBarberSource?.barbers || [],
    })
    : null;
  // handoff_url is computed for the deterministic guard/sanitizer below even on
  // an ineligible turn (guardReddyReply still needs a real URL to redirect a
  // false booking claim to), but it is NEVER placed where the LLM can see it
  // unless bookingCtaEligible — see boundedConversationContext below.
  const handoffUrl = buildPrefilledBookingUrl(bookingContext);

  const boundedConversationContext = {
    ...(conversationContext && typeof conversationContext === 'object' ? conversationContext : {
      turns: [],
      turn_count: 0,
      history_status: 'empty',
      sessionStatus: 'expired',
    }),
    ...(orchestrationDecision && typeof orchestrationDecision === 'object' ? {
      orchestrator_decision: {
        intent: orchestrationDecision.intent || 'unknown',
        conversational_act: orchestrationDecision.conversational_act || 'unknown',
        continuation_type: orchestrationDecision.continuation_type || 'none',
        context_reference: orchestrationDecision.context_reference || null,
        route: orchestrationDecision.route || 'reddy_agent',
        required_sources: Array.isArray(orchestrationDecision.required_sources) ? orchestrationDecision.required_sources : [],
        allowed_claims: Array.isArray(orchestrationDecision.allowed_claims) ? orchestrationDecision.allowed_claims : [],
        prohibited_claims: Array.isArray(orchestrationDecision.prohibited_claims) ? orchestrationDecision.prohibited_claims : [],
        clarification_required: Boolean(orchestrationDecision.clarification_required),
        session_behavior: orchestrationDecision.session_behavior || 'continue',
        response_strategy: orchestrationDecision.response_strategy || 'answer_directly',
      },
    } : {}),
    // booking_context (memory) may still be attached even when the CTA is not
    // eligible — it lets Reddy correctly say things like "kalau nanti mau
    // lanjut booking di Bypass" in passing without granting a URL/CTA.
    ...(bookingContext ? { booking_context: bookingContext } : {}),
    ...(verifiedSchedule ? { barber_schedule_status: verifiedSchedule } : {}),
    ...(presenceResolution ? {
      barber_presence_fact_decision: presenceResolution.factDecision,
    } : {}),
    ...(bookingCtaEligible ? {
      booking_authority: {
        whatsapp_mode: 'assist_and_guide_only',
        execution: REDDY_BOOKING_EXECUTION,
        reservation_authority: 'website_booking_system',
        handoff_url: handoffUrl,
        canonical_barber_source_status: canonicalBarberSource?.status || 'unavailable',
      },
    } : {}),
    reply_persistence_deferred: true,
  };

  try {
    if (knowledgeFactsContext) {
      reply = await callOpenAI(from, text, verifiedCrmName, branch, knowledgeFactsContext, factsContext, boundedConversationContext);
    } else {
      reply = await callOpenAI(from, text, verifiedCrmName, branch, null, factsContext, boundedConversationContext);
    }
  } catch (err) {
    err.generationError = true;
    throw err;
  }

  // Deterministic outbound safeguard (Task 14.1 correction): prompt-only
  // "use the URL only if relevant" already proved insufficient in production.
  // Runs BEFORE guardReddyReply so a legitimate booking-claim redirect (which
  // always includes the URL, and only fires when the turn IS booking-relevant)
  // is never itself mistaken for an unsolicited CTA.
  const ctaSanitized = suppressUnsolicitedBookingCta(reply, { bookingCtaEligible });
  reply = ctaSanitized.sanitizedReply;
  if (ctaSanitized.ctaSuppressed) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_cta_suppressed',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });
  }

  // Task 14.1 correction round 2 (Blocker 2): guardReddyReply's OWN safe
  // corrections used to always embed the booking URL, even when the turn had
  // already been determined CTA-ineligible — reintroducing exactly what the
  // sanitizer above had just removed. bookingCtaEligible is now threaded
  // through so the correction text itself never contains a URL on an
  // ineligible turn.
  const guarded = guardReddyReply(reply, {
    isBackendVerified: false,
    bookingUrl: handoffUrl,
    bookingCtaEligible,
    responseLanguage,
  });
  reply = guarded.sanitizedReply;

  if (guarded.blockedProhibitedClaim || guarded.blockedUnverifiedAvailability) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_reply_guard',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      guard_blocked_prohibited_claim: guarded.blockedProhibitedClaim,
      guard_blocked_unverified_availability: guarded.blockedUnverifiedAvailability,
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });
  }

  // Deterministic real-time barber fact guard (Task 14.1 correction round 2,
  // Blocker 3): prompt-only instructions already failed once in production.
  // Runs regardless of whether a schedule lookup happened this turn — an
  // unsupported presence/attendance claim must be caught even if the model
  // produces one unprompted (e.g. the customer's phrasing didn't trigger
  // realtimeBarberQuerySignal, or the model just hallucinates one anyway).
  const realtimeGuarded = guardRealtimeBarberFacts(reply, {
    verifiedSchedule,
    requestedClaim: presenceIntent.matched ? presenceIntent.claimType : null,
    knownBarberNames: presenceResolution?.factDecision?.barber?.name
      ? [presenceResolution.factDecision.barber.name]
      : [],
    responseLanguage,
  });
  reply = realtimeGuarded.sanitizedReply;
  if (realtimeGuarded.triggered) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'realtime_fact_guard',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      realtime_fact_guard_triggered: true,
    });
  }

  // Conversation lifecycle: normal replies must not append a generic closing
  // question — the idle-timeout cron, not the LLM on every turn, controls
  // when a conversation ends (see conversationLifecycle.js). Prompt-only
  // instructions already proved insufficient elsewhere in this codebase
  // (guardReddyReply's own history), so this is a deterministic safety net,
  // not the only defense. A genuine task-advancing clarification question is
  // never matched by these patterns and survives untouched.
  const closingGuarded = stripGenericClosingQuestion(reply);
  reply = closingGuarded.sanitizedReply;
  if (closingGuarded.closingStripped) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'generic_closing_suppressed',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
    });
  }

  const isWebsiteLinkRequested = /\b(?:web|website|link|url)\b/i.test(String(text || ''));
  if (isWebsiteLinkRequested && !/\bhttps?:\/\/|\bredboxbarbershop\.com\b/i.test(reply)) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'request_ack_without_fulfillment',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
    });
    reply = `${reply.trim()}\n\nWebsite resmi RedBox: https://redboxbarbershop.com`;
  }

  // Final-send invariant (Task 14.1 correction round 2): whatever guard ran
  // above, or however many of them, the literal string that reaches sendWA
  // must never carry a booking URL on an ineligible turn. Runs a second,
  // idempotent pass immediately before send/persist rather than trusting the
  // upstream guards to have been exhaustive — cheap when there's nothing left
  // to strip, and closes the door on any future guard/branch that reintroduces
  // a URL the way guardReddyReply's own corrections just did.
  // Exception: explicit website link request (isWebsiteLinkRequested) preserves official URL.
  const finalSanitized = suppressUnsolicitedBookingCta(reply, { bookingCtaEligible: bookingCtaEligible || isWebsiteLinkRequested });
  if (finalSanitized.ctaSuppressed) {
    reply = finalSanitized.sanitizedReply;
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_cta_suppressed',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });
  }

  if (persistConversation && typeof persistConversation === 'function') {
    await persistConversation(
      from, boundedConversationContext.turns || [], text, reply,
      {}, boundedConversationContext.providerDeviceHash || null,
    );
  }

  let sendResult = null;
  if (sendWA && typeof sendWA === 'function') {
    try {
      sendResult = await sendWA(from, reply, { branch });
    } catch (err) {
      err.outboundFailure = true;
      err.failureReason = err.failureReason || 'processing_failed';
      throw err;
    }
  }

  return {
    used,
    reply,
    sendResult,
    error,
  };
}

module.exports = { executeReddyAgent, classifyBarberPresenceQuery };
