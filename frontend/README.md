# Redbox Barbershop - Next.js Frontend

SEO-optimized frontend for Redbox Barbershop built with Next.js + Supabase.

## Architecture

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **Backend API**: Express server in `/server` (kept separate)
- **Database**: Supabase PostgreSQL

## Setup

1. **Environment Variables** (already created in `.env.local`):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://khcvklzxfohwkyocenaf.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_zXzyWRuSjJbXYomkJ1ws8w_iHHq1LSg
   ```

2. **Run development server**:
   ```bash
   npm run dev
   # Runs on http://localhost:3000
   ```

3. **Run with API backend** (from root):
   ```bash
   npm run dev:all
   # Runs both frontend (3000) and API (3001)
   ```

## Supabase Integration

- **Server Components**: `utils/supabase/server.ts` - for data fetching
- **Client Components**: `utils/supabase/client.ts` - for browser interactivity
- **Middleware**: `middleware.ts` - for session refresh

## Project Structure

```
src/
├── app/                    # Next.js pages
│   ├── page.tsx           # Homepage
│   └── bookings/          # Bookings page (example)
├── utils/supabase/        # Supabase clients
│   ├── server.ts          # Server-side client
│   ├── client.ts          # Browser client
│   └── middleware.ts      # Middleware helper
└── middleware.ts          # Next.js middleware
```

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
