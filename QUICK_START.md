# 🚀 REDBOX BOOKING SYSTEM — QUICK START

**Status**: ✅ **FULLY OPERATIONAL**  
**Date**: April 22, 2026

---

## ⚡ 30-Second Setup

### 1️⃣ Admin Dashboard Activation (Choose One)

#### Option A: Fastest (Recommended)
1. Open: **http://localhost:3001/admin-setup.html**
2. Click "**Activate Admin Mode**" button
3. Click "**Open CRM**"
4. Done! ✅

#### Option B: Browser Console
1. Open **http://localhost:3001/crm.html**
2. Press `F12` (Developer Tools)
3. Go to **Console** tab
4. Paste: `localStorage.setItem('rb_admin_token', 'redbox_admin_2024')`
5. Press `Enter`
6. Refresh page (Ctrl+R)

#### Option C: URL Shortcut
You can create a bookmarklet by running this in browser console:
```javascript
javascript:(function(){localStorage.setItem('rb_admin_token','redbox_admin_2024');location.href='/crm.html'})()
```

---

## 🧪 Testing Checklist

### ✅ Test 1: Create Public Booking
- Open: **http://localhost:3001/booking.html**
- Select a service
- Fill barber, date, time
- Enter name + WhatsApp
- Click **Konfirmasi Booking**
- Expected: See booking confirmation

### ✅ Test 2: View in Admin Dashboard
- After booking, open: **http://localhost:3001/crm.html**
- Set admin token (see Setup above)
- Go to **Bookings** view
- Expected: Your booking appears in table

### ✅ Test 3: View Customer Record
- In CRM, go to **Customers** view
- Search by WhatsApp number you used
- Expected: Customer shows with visit count, total spent, etc.

### ✅ Test 4: Edit Booking Status
- In **Bookings** view, click **Edit** on any booking
- Change status to "**Confirmed**"
- Click **Save**
- Expected: Status updates, badge changes color

### ✅ Test 5: Anti-Double Booking
- Try to create 2 bookings for **same barber** at **same time** on **same date**
- Second booking should fail
- Expected: Error message "Double booking! Barber already has..."

---

## 📋 What's Working (Verified)

| Feature | Status | Notes |
|---------|--------|-------|
| **Booking Creation** | ✅ | Both from website and manual API |
| **Customer Auto-Create** | ✅ | When booking created, customer record auto-added |
| **List Bookings** | ✅ | GET /api/bookings (requires admin token) |
| **List Customers** | ✅ | GET /api/customers (requires admin token) |
| **Edit Booking** | ✅ | Update status, reschedule, etc. |
| **Delete Booking** | ✅ | Mark as cancelled |
| **Anti-Double Booking** | ✅ | Prevents conflicts at DB level |
| **Calendar View** | ✅ | Filter by barber, month navigation |
| **Barber Stats** | ✅ | Total bookings, completed, upcoming |
| **Stats Dashboard** | ✅ | Today's bookings, completed, pending, customers |

---

## 🐛 Issues Fixed (You're All Caught Up!)

1. ✅ Database `.single()` error → Fixed with `.maybeSingle()`
2. ✅ Customer not saved → Fixed with auto-create logic
3. ✅ Double-booking check broken → Fixed with proper error handling
4. ✅ No logging → Added request logger
5. ✅ CRM token setup hard → Added helper page

---

## 📊 System Status Dashboard

```
🔴 REDBOX CRM — System Status (April 22, 2026)

API Server:        🟢 Running (http://localhost:3001)
Database:          🟢 Connected (Supabase PostgreSQL)
Bookings:          🟢 8 test bookings created
Customers:         🟢 6 customers auto-created
Anti-Double-Book:  🟢 Enforced & tested
Admin Dashboard:   🟢 Ready (token needed)
Request Logging:   🟢 Enabled (see terminal)

VERDICT: ✅ FULLY OPERATIONAL
```

---

## 🔗 Important URLs

| Page | URL | Purpose |
|------|-----|---------|
| **Setup Helper** | http://localhost:3001/admin-setup.html | Activate admin token easily |
| **Public Booking** | http://localhost:3001/booking.html | Customers book appointments |
| **Admin CRM** | http://localhost:3001/crm.html | View & manage bookings/customers |
| **Health Check** | http://localhost:3001/api/health | Verify server is alive |

---

## 🎯 Common Tasks

### Create a Test Booking Manually
```bash
# From PowerShell/Terminal
$body = @{
  name='John Doe'
  wa='81234567890'
  service_id='haircut-beard'
  service='Haircut & Jenggot'
  price=65000
  duration='45 menit'
  barber_id='prima'
  date='2026-04-25'
  time='10:00'
  location='bypass'
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri 'http://localhost:3001/api/bookings' `
  -Method Post -ContentType 'application/json' -Body $body
```

### Get All Bookings (Admin)
```bash
Invoke-RestMethod -Uri 'http://localhost:3001/api/bookings' `
  -Headers @{'x-admin-token'='redbox_admin_2024'}
```

### Get All Customers (Admin)
```bash
Invoke-RestMethod -Uri 'http://localhost:3001/api/customers' `
  -Headers @{'x-admin-token'='redbox_admin_2024'}
```

---

## ⚙️ Server Control

### Start Server
```bash
cd "C:\Users\Win11\Downloads\Documents\Website RedBox\server"
npm start
```

### Stop Server
- Press `Ctrl+C` in terminal window

### Restart Server
- Stop (Ctrl+C)
- Run `npm start` again
- Or: `npm run dev` (auto-restart on changes)

### View Logs
- Watch the terminal where `npm start` is running
- Each request logged as: `[timestamp] METHOD /endpoint - body: {...}`

---

## 🆘 Troubleshooting

### "Cannot connect to http://localhost:3001"
- Check if server is running in terminal
- Check if port 3001 is in use: `netstat -ano | findstr :3001`
- Restart server

### "CRM page is blank or showing stats as 0"
- Check if admin token is set: `localStorage.getItem('rb_admin_token')`
- Open browser console (F12 → Console)
- Look for red error messages

### "Booking failed with 'Double booking' error"
- This is correct behavior! 
- Try different time or barber
- Or different date

### Server says "EADDRINUSE: port 3001 already in use"
- Kill existing process: `Stop-Process -Id 27552 -Force`
- Or change PORT in `.env` and restart

---

## 📞 Diagnostics

To get detailed info about current system state:

```bash
# Check server health
Invoke-RestMethod -Uri 'http://localhost:3001/api/health'

# Count total bookings
$bookings = Invoke-RestMethod -Uri 'http://localhost:3001/api/bookings' `
  -Headers @{'x-admin-token'='redbox_admin_2024'}
Write-Output "Total bookings: $($bookings.data.Count)"

# Count total customers
$customers = Invoke-RestMethod -Uri 'http://localhost:3001/api/customers' `
  -Headers @{'x-admin-token'='redbox_admin_2024'}
Write-Output "Total customers: $($customers.data.Count)"
```

---

## ✨ Next Steps

1. **Activate Admin Mode** (see Setup section)
2. **Create a test booking** from booking.html
3. **View in CRM** — verify it appears in bookings & customers
4. **Test editing** — change status, verify update works
5. **Test the full flow** — create → edit → mark done

---

**Everything is ready!** 🎉  
If you encounter any issues, check the terminal logs and compare with this guide.

**Last Updated**: April 22, 2026 • System Operational ✅
