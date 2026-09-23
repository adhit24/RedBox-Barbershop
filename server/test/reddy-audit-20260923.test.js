'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { guardFactualServiceNumbers } = require('../agents/reddy/personalityPolicy');
const { resetServicesCatalogCache } = require('../services/servicesCatalog');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { classifyDeterministically } = require('../orchestrator/routingPolicy');
const { checkBarberAvailability } = require('../services/barberAvailabilityQuery');
const rows = [{ id:'grooming', name:'Gentleman Grooming', price:95000, duration_minutes:75, is_active:true }];
function catalogDb() { return { from: () => ({ select: () => ({ eq: async () => ({ data:rows, error:null }) }) }) }; }

for (const nominal of ['Rp75.000', 'Rp75 ribu', '75rb', '75k']) {
  test(`unbound service price ${nominal} cannot authorize a fabricated package`, async () => {
    resetServicesCatalogCache();
    const result = await guardFactualServiceNumbers(`${nominal} biasanya untuk potongan standar, sedangkan Rp85.000 tekniknya berbeda.`, { supabase:catalogDb() });
    assert.equal(result.blocked, true);
    assert.doesNotMatch(result.sanitizedReply, /potongan standar|tekniknya berbeda|75|85/);
  });
}
test('a known service elsewhere does not authorize an unbound price', async () => {
  resetServicesCatalogCache();
  const result = await guardFactualServiceNumbers('Gentleman Grooming Rp95.000. Rp75.000 biasanya untuk potongan standar.', {supabase:catalogDb()});
  assert.doesNotMatch(result.sanitizedReply, /75|potongan standar/);
});
test('catalog failure fails closed on a current price', async () => {
  resetServicesCatalogCache();
  const result = await guardFactualServiceNumbers('Gentleman Grooming Rp75.000.', {supabase:{from(){throw Error('offline');}}});
  assert.equal(result.blocked,true);
  assert.doesNotMatch(result.sanitizedReply,/75/);
});
test('canonical service price is preserved', async () => {
  resetServicesCatalogCache();
  const result = await guardFactualServiceNumbers('Gentleman Grooming Rp95.000.', {supabase:catalogDb()});
  assert.equal(result.sanitizedReply,'Gentleman Grooming Rp95.000.');
});
test('a price dispute keyword is not evidence of a historical transaction', async()=>{
  resetServicesCatalogCache();
  const result=await guardFactualServiceNumbers('Beda harga Rp75.000 biasanya untuk potongan standar.',{supabase:catalogDb()});
  assert.equal(result.blocked,true);
  assert.doesNotMatch(result.sanitizedReply,/75|potongan standar/);
});
test('a rejected barber claim cannot leave its slot list behind', () => {
  const result = guardRealtimeBarberFacts('Mas Abdul tersedia sekarang. Slotnya jam 10:00, 11:00, 12:00 dan 13:00.');
  assert.equal(result.triggered,true);
  assert.doesNotMatch(result.sanitizedReply,/10:00|11:00|12:00|13:00/);
});
test('standalone model-generated slot list is blocked', () => {
  const result = guardRealtimeBarberFacts('Masih ada 8 slot: 10:00, 11:00, 12:00.');
  assert.equal(result.triggered,true);
  assert.doesNotMatch(result.sanitizedReply,/10:00|11:00|12:00/);
});
test('availability without service identity and duration cannot return 30-minute slots', async () => {
  const result = await checkBarberAvailability({}, {branch:'bypass',barberId:'abdul',date:'2026-09-24'});
  assert.equal(result.reason_code,'service_required');
});
for (const text of ['Saya kirim softfile proposal sesuai arahan petugas cabang', 'Proposal sponsorship kegiatan kampus', 'Kami vendor, barangkali mau pesan']) {
  test(`business correspondence bypasses CRM: ${text}`, () => {
    assert.equal(classifyDeterministically(text)?.intent,'business_correspondence');
  });
}
test('login help is public instructions, not a private member lookup', () => {
  assert.equal(classifyDeterministically('Cara login member gimana?')?.intent,'member_login_help');
});
test('an explicit request for a human still wins over public login help',()=>{
  assert.equal(classifyDeterministically('Saya mau bicara dengan admin soal login member')?.intent,'human_request');
});

test('guarded duplicate outcome records provenance even after RPC marks row failed', async () => {
  const { createGuardedSend } = require('../services/waOutboundGuard');
  const row = {id:'inbound-1',processing_status:'failed',terminal_source:null};
  const db = {
    rpc:async () => ({data:[{decision:'duplicate_content',claim_id:null}],error:null}),
    from(table) {
      assert.equal(table,'wa_inbound_events');
      const filters=[]; let patch;
      const q={update(p){patch=p;return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},
        then(resolve){if(filters.every(([k,v])=>row[k]===v))Object.assign(row,patch);resolve({error:null});}};
      return q;
    },
  };
  const send=createGuardedSend({supabase:db,inboundEventRowId:'inbound-1',realSend:async()=>{throw Error('must not send duplicate');}});
  const result=await send('628100000001','Siap, Kak.',{correlationId:'req-1'});
  assert.equal(result.reason,'duplicate_content');
  assert.equal(row.failure_reason,'duplicate_suppressed');
  assert.equal(row.terminal_source,'wa_outbound_guard');
  assert.equal(row.correlation_id,'req-1');
});

test('a later confirmed booking cannot close an unresolved complaint', async () => {
  const { reconcileHandoffBacklog } = require('../services/humanHandoff');
  const row={id:'case-1',status:'waiting_human',priority:'high',branch:'bypass',assigned_to:'admin_bypass',created_at:'2026-09-01T00:00:00Z',customer_phone:'628100000001'};
  const db={from(table){
    let patch; const q={select(){return q;},in(){return q;},eq(){return q;},gte(){return q;},limit(){return q;},order(){return q;},update(p){patch=p;return q;},
      then(resolve){if(patch)Object.assign(row,patch);resolve({data:table==='bookings'?[{id:'new-booking',status:'confirmed'}]:[row],error:null});}};
    return q;
  }};
  await reconcileHandoffBacklog({supabase:db,recordEvaluationEvent:async()=>({status:'recorded'})});
  assert.equal(row.status,'waiting_human');
  assert.equal(row.resolved_at,undefined);
});

async function publicTurn(text, handoff = {status:'none'}, history = []) {
  const { handleMessage } = require('../../api/wa/webhook');
  const sent=[]; const saved=[];
  const forbidden=async()=>{throw Error('public help must not call CRM or model');};
  const result=await handleMessage({from:'628100000001',text,branchFromPayload:'bypass'}, {
    getHandoffState:async()=>handoff,
    appendHandoffMessage:async()=>{}, logHandoffTelemetry:()=>{},
    touchLifecycle:async()=>({reopened:false}),
    loadConversationHistory:async()=>history,
    orchestrate:forbidden,executeIntelligence:forbidden,generateReddy:forbidden,
    send:async(_to,reply)=>{sent.push(reply);return {status:true,finalOutboundText:reply};},
    persistConversation:async(_from,_history,_text,reply)=>saved.push(reply),
  });
  return {result,sent,saved};
}
test('login instructions reach outbound and history with OTP, without CRM', async()=>{
  const {result,sent,saved}=await publicTurn('Cara login member gimana?');
  assert.equal(result.used,'member_login_help');
  assert.match(sent[0],/OTP WhatsApp/);
  assert.match(sent[0],/member-login\.html/);
  assert.doesNotMatch(sent[0],/password|buat.*sandi/i);
  assert.deepEqual(saved,sent);
});
test('proposal reply never claims a missing member profile or approval', async()=>{
  const {result,sent}=await publicTurn('Saya kirim proposal sesuai arahan petugas cabang');
  assert.equal(result.used,'business_correspondence');
  assert.doesNotMatch(sent[0],/member|sudah disetujui/i);
});
test('acknowledgment does not ask the customer to clarify', async()=>{
  const {sent}=await publicTurn('Siap mas');
  assert.match(sent[0],/Siap/);
  assert.doesNotMatch(sent[0],/\?/);
});
test('active human handoff still suppresses login-help shortcut', async()=>{
  const {result,sent}=await publicTurn('Cara login member?',{status:'waiting_human',case:{id:'c1'}});
  assert.equal(result.used,'human_active_suppressed');
  assert.equal(sent.length,0);
});
test('a proposal followup keeps its business context', async()=>{
  const {result}=await publicTurn('Berkasnya sudah dikirim tadi', {status:'none'}, [
    {role:'user',content:'Saya mau mengirim proposal kegiatan kampus'},
    {role:'assistant',content:'Boleh tuliskan tujuan pengajuannya?'},
  ]);
  assert.equal(result.used,'business_correspondence');
});

test('a barber-only inquiry asks for service before any slot lookup', async()=>{
  resetServicesCatalogCache();
  const {executeReddyAgent}=require('../agents/reddy/reddyAdapter');
  let lookups=0;
  const result=await executeReddyAgent({from:'628100000001',text:'Mas Abdul hari ini ada?',branch:'bypass',
    conversationContext:{turns:[],response_language:'indonesian'},
    orchestrationDecision:{intent:'barber_availability_query',route:'reddy_agent'},
  },{
    callOpenAI:async()=>{throw Error('must not infer availability');},
    supabase:catalogDb(),
    loadBarbers:async()=>({status:'verified',barbers:[{id:'abdul',name:'Abdul',branch:'bypass',is_active:true}]}),
    getAvailability:async()=>{lookups++;return {success:true,available_slots:['10:00']};},
    sendWA:async()=>({status:true}),logBookingTelemetry:()=>{},logAvailability:()=>{},
  });
  assert.equal(lookups,0);
  assert.match(result.reply,/layanan apa/);
  assert.doesNotMatch(result.reply,/10:00/);
});
