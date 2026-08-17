// REDBOX BARBERSHOP - NAVBAR LETTER-SCRAMBLE HOVER EFFECT
(function () {
 const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%&*';

 function randomChar() {
 return CHARS[Math.floor(Math.random() * CHARS.length)];
 }

 class ScrambleText {
 constructor(el) {
 this.el = el;
 this.original = el.textContent.trim();
 this.frame = 0;
 this.frameRequest = null;
 this.queue = [];
 }

 run() {
 cancelAnimationFrame(this.frameRequest);
 this.queue = this.original.split('').map((ch) => ({
 to: ch,
 end: Math.floor(Math.random() * 16) + 8,
 char: ch === ' ' ? ' ' : randomChar()
 }));
 this.frame = 0;
 this.update();
 }

 update() {
 let output = '';
 let complete = 0;
 for (let i = 0; i < this.queue.length; i++) {
 const item = this.queue[i];
 if (item.to === ' ') {
 output += ' ';
 complete++;
 continue;
 }
 if (this.frame >= item.end) {
 output += item.to;
 complete++;
 } else {
 if (Math.random() < 0.5) item.char = randomChar();
 output += item.char;
 }
 }
 this.el.textContent = output;
 if (complete < this.queue.length) {
 this.frame++;
 this.frameRequest = requestAnimationFrame(() => this.update());
 } else {
 this.el.textContent = this.original;
 }
 }
 }

 function initNavScramble() {
 document.querySelectorAll('.nav-link').forEach((link) => {
 if (link.dataset.scrambleReady) return;
 link.dataset.scrambleReady = 'true';
 const fx = new ScrambleText(link);
 link.addEventListener('mouseenter', () => fx.run());
 });
 }

 document.addEventListener('DOMContentLoaded', initNavScramble);
})();
