// Booking success celebration: confetti burst + popup overlay
(function () {
  'use strict';

  // ── CONFETTI CONFIG ─────────────────────────────────────
  var COLORS = ['#C1121F','#E63946','#FF6B35','#FFD700','#ffffff','#FF85A1','#4ECDC4'];
  var PARTICLE_COUNT = 180;
  var BURST_DURATION = 5500; // ms before stopping new launches

  // ── PARTICLE FACTORY ────────────────────────────────────
  function makeParticle(cx, cy, idx) {
    var angle = (Math.random() * Math.PI * 2);
    var speed = 6 + Math.random() * 10;
    // bias toward upward arc
    var upBias = -1.2 - Math.random() * 1.2;
    return {
      x:  cx + (Math.random() - 0.5) * 30,
      y:  cy,
      vx: Math.cos(angle) * speed * 0.9,
      vy: Math.sin(angle) * speed * 0.4 + upBias * 8,
      w:  6 + Math.random() * 10,
      h:  3 + Math.random() * 5,
      r:  Math.random() * Math.PI * 2,
      rv: (Math.random() - 0.5) * 0.28,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 1,
      type: Math.random() > 0.35 ? 'rect' : 'circle',
    };
  }

  // ── CONFETTI RUNNER ─────────────────────────────────────
  function runConfetti(canvas) {
    var ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    var particles = [];
    var raf = null;
    var startTime = Date.now();

    // Two launchers: bottom-left and bottom-right (like two pistol pita)
    var launchers = [
      { x: canvas.width * 0.25, y: canvas.height * 0.85 },
      { x: canvas.width * 0.75, y: canvas.height * 0.85 },
    ];

    // Initial burst
    launchers.forEach(function (l) {
      for (var i = 0; i < PARTICLE_COUNT / 2; i++) {
        particles.push(makeParticle(l.x, l.y, i));
      }
    });

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.vy += 0.22;          // gravity
        p.vx *= 0.992;         // air drag x
        p.x  += p.vx;
        p.y  += p.vy;
        p.r  += p.rv;

        // fade out as particle exits viewport
        if (p.y > canvas.height * 0.8) {
          p.alpha -= 0.025;
        }

        if (p.alpha <= 0) { particles.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.color;
        if (p.type === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }

      if (particles.length > 0) {
        raf = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    draw();

    // Return stop function
    return function stop() {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }

  // ── PUBLIC API ──────────────────────────────────────────
  window.showBookingSuccess = function () {
    var overlay = document.getElementById('rbSuccessOverlay');
    var canvas  = document.getElementById('rbConfettiCanvas');
    var closeBtn = document.getElementById('rbSuccessClose');
    if (!overlay) return;

    // Show overlay (triggers CSS transitions)
    overlay.removeAttribute('aria-hidden');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Run confetti
    var stopConfetti = canvas ? runConfetti(canvas) : function () {};

    // Auto-stop confetti after burst duration
    var stopTimer = setTimeout(stopConfetti, BURST_DURATION);

    // Close handler
    function close() {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
      clearTimeout(stopTimer);
      setTimeout(function () {
        stopConfetti();
        overlay.setAttribute('aria-hidden', 'true');
      }, 400);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', close, { once: true });
    }

    // Also close on backdrop click (not on popup itself)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    }, { once: true });
  };
})();
