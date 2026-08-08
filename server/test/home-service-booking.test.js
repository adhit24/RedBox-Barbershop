const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bookingSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'booking.js'),
  'utf8'
);
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('home service family initializes the second person with the same per-person service', () => {
  assert.match(
    bookingSource,
    /const packagePeople = isWeddingPackage \? weddingPackage\.peopleCount : \(hsPackage === 'family' \? 2 : 1\);[\s\S]{0,500}allBookingPeople\(\)\.slice\(1\)\.forEach\(person => \{ person\.service = state\.service; \}\);/,
    'Family booking must initialize person 2 so the total is two times the per-person price'
  );
});

test('home service family remains priced per person at Rp200.000', () => {
  assert.match(bookingSource, /const HS_PRICE_FAMILY = 200000;/);
});

test('wedding package people counts drive multi-person booking', () => {
  assert.match(bookingSource, /wedding-silver[\s\S]*peopleCount: 2/);
  assert.match(bookingSource, /wedding-gold[\s\S]*peopleCount: 3/);
  assert.match(bookingSource, /wedding-platinum[\s\S]*peopleCount: 4/);
  assert.match(bookingSource, /ensurePersonTabs\(n\)/);
  assert.match(bookingSource, /const people = allBookingPeople\(\);[\s\S]{0,80}people\.some\(p => !p\.barber\)/);
  assert.match(bookingSource, /weddingPackage\.price \/ weddingPackage\.peopleCount/);
  assert.match(bookingSource, /package_people: isWeddingPackage \? weddingPackage\.peopleCount/);
  assert.match(serverSource, /packagePrice \/ packagePeople/);
});
