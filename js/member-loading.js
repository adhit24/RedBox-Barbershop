(function () {
  var COPY = [
    'Sedang mempersiapkan kursi hangat untukmu...',
    'Kapster lagi ngasihin minyak rambut dulu...',
    'Sebentar ya, sisirnya lagi dicuci...',
    'Data kamu hampir siap, sabar dulu bang!',
  ];
  var MIN_DISPLAY_MS = 2500;
  var CLIENT_TIMEOUT_MS = 10000;

  var token = localStorage.getItem('rb_member_token');
  if (!token) { window.location.href = 'member-login.html'; return; }

  var memberData = JSON.parse(localStorage.getItem('redbox_member') || '{}');
  var name = memberData.name || memberData.full_name || 'Sobat RedBox';

  var nameEl  = document.getElementById('member-name');
  var copyEl  = document.getElementById('loading-copy');
  var toastEl = document.getElementById('sync-toast');
  if (nameEl) nameEl.textContent = name;
  if (copyEl) copyEl.textContent = COPY[0];

  var idx = 0;
  var cycleTimer = setInterval(function () {
    idx = (idx + 1) % COPY.length;
    if (copyEl) copyEl.textContent = COPY[idx];
  }, 2500);

  var fetchSync = fetch('/api/member/sync', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
  }).then(function (r) { return r.json(); }).catch(function () { return { success: false }; });

  var syncPromise = Promise.race([
    fetchSync,
    new Promise(function (r) { setTimeout(function () { r({ success: false, error: 'timeout' }); }, CLIENT_TIMEOUT_MS); }),
  ]);

  var minWait = new Promise(function (r) { setTimeout(r, MIN_DISPLAY_MS); });

  Promise.all([syncPromise, minWait]).then(function (results) {
    clearInterval(cycleTimer);
    var data = results[0];

    if (data && data.success) {
      var updated = Object.assign({}, memberData, {
        visits:     data.visits,
        points:     data.points,
        tier:       data.tier,
        lastVisit:  data.last_visit,
        joinDate:   data.first_visit || memberData.joinDate,
        totalSpent: data.total_spent,
        full_name:  data.full_name || memberData.full_name,
        name:       data.full_name || memberData.name,
      });
      localStorage.setItem('redbox_member', JSON.stringify(updated));
      window.location.href = 'member-dashboard.html';
    } else {
      if (toastEl) {
        toastEl.textContent = 'Data tidak sempat diperbarui, tapi tetap bisa dipakai ya! 🪒';
        toastEl.style.opacity = '1';
      }
      setTimeout(function () {
        window.location.href = 'member-dashboard.html';
      }, 2000);
    }
  });
})();
