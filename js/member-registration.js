'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('membershipRegistrationForm');
  const submit = document.getElementById('registrationSubmit');
  const status = document.getElementById('formStatus');
  const formView = document.getElementById('registrationFormView');
  const confirmation = document.getElementById('registrationConfirmation');
  const registrationCode = document.getElementById('registrationCode');
  const confirmationSummary = document.getElementById('confirmationSummary');
  const confirmationDeadline = document.getElementById('confirmationDeadline');
  const tierInputs = Array.from(document.querySelectorAll('input[name="tier"]'));
  const allowedTiers = new Set(['silver', 'gold', 'platinum']);
  const tierLabels = { silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

  function normalizePhone(value) {
    const raw = String(value || '').trim();
    if (!/^\+?[0-9\s()./-]+$/.test(raw)) throw new Error('Masukkan nomor WhatsApp Indonesia yang valid.');
    const digits = raw.replace(/\D/g, '');
    let canonical = '';
    if (raw.startsWith('+') && digits.startsWith('62')) canonical = `+${digits}`;
    else if (digits.startsWith('62')) canonical = `+${digits}`;
    else if (digits.startsWith('0')) canonical = `+62${digits.slice(1)}`;
    else if (digits.startsWith('8')) canonical = `+62${digits}`;
    if (!/^\+628[1-9]\d{7,10}$/.test(canonical)) throw new Error('Masukkan nomor WhatsApp Indonesia yang valid.');
    return canonical;
  }

  function formatRupiah(amount) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
  }

  function formatDeadline(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Bawa kode ini ke outlet dalam 7 hari.';
    return `Berlaku sampai ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(date)}.`;
  }

  function showStatus(message, type = '') {
    status.textContent = message;
    status.className = `form-status${type ? ` is-${type}` : ''}`;
  }

  const requestedTier = new URLSearchParams(window.location.search).get('tier');
  if (allowedTiers.has(requestedTier)) {
    const target = document.querySelector(`input[name="tier"][value="${requestedTier}"]`);
    if (target) target.checked = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = document.getElementById('fullName').value.trim();
    const phoneInput = document.getElementById('phone');
    const email = document.getElementById('email').value.trim();
    const tier = tierInputs.find((input) => input.checked)?.value;

    if (!fullName) return showStatus('Nama lengkap wajib diisi.', 'error');
    if (!allowedTiers.has(tier)) return showStatus('Pilih salah satu tier membership.', 'error');

    let phone;
    try {
      phone = normalizePhone(phoneInput.value);
      phoneInput.value = phone;
    } catch (error) {
      return showStatus(error.message, 'error');
    }

    submit.disabled = true;
    submit.textContent = 'Membuat kode pendaftaran…';
    showStatus('');
    try {
      const response = await fetch('/api/membership/registrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName, phone, email: email || null, tier }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Pendaftaran belum dapat diproses. Coba lagi.');

      registrationCode.textContent = result.registrationCode || 'Kode sedang diproses';
      confirmationSummary.textContent = `${tierLabels[result.tier] || tier} • ${formatRupiah(result.amount)} • status ${result.status || 'PENDING'}`;
      confirmationDeadline.textContent = formatDeadline(result.expiresAt);
      formView.hidden = true;
      confirmation.classList.add('is-visible');
      confirmation.focus({ preventScroll: true });
      confirmation.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      showStatus(error.message || 'Pendaftaran belum dapat diproses. Coba lagi.', 'error');
      submit.disabled = false;
      submit.textContent = 'Lanjutkan Pendaftaran';
    }
  });
});
