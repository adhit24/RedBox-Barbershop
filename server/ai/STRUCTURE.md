# AI Backend Structure

## Tree View

```
ai/
├── README.md
├── STRUCTURE.md
├── .env.example
├── index.js                    # Module entry point
│
├── config/
│   └── database.js             # Supabase config & helpers
│
├── controllers/
│   └── aiController.js           # API handlers
│
├── middleware/
│   ├── auth.js                 # JWT & membership auth
│   ├── rateLimiter.js          # Tier-based rate limiting
│   └── upload.js               # Multer file upload
│
├── models/
│   └── aiModel.js              # (Optional) Data models
│
├── routes/
│   └── aiRoutes.js             # Express routes
│
├── services/
│   ├── aiService.js            # OpenAI integration
│   ├── imageService.js         # Sharp + Supabase Storage
│   └── queueService.js         # Bull/Redis queue
│
├── workers/
│   └── aiWorker.js             # Background job processor
│
├── utils/
│   ├── prompts.js              # AI prompt templates
│   └── helpers.js              # Utility functions
│
├── schema/
│   └── ai_schema.sql           # Database migrations
│
└── tests/
    └── ai.test.js              # Unit tests (optional)
```

## Data Flow

```
1. User Upload
   Frontend → POST /api/ai/upload
   → Multer (upload.js)
   → Sharp (imageService.processImage)
   → Supabase Storage (imageService.uploadToStorage)
   → DB Record (database.createUpload)

2. Queue Analysis
   Frontend → POST /api/ai/analyze
   → Auth Check (auth.js)
   → Rate Limit (rateLimiter.js)
   → Credit Check (database.decrementCredits)
   → Add to Queue (queueService.addJob)

3. Background Processing
   aiWorker.js
   → Download Image (imageService.downloadImage)
   → Call OpenAI (aiService.processByType)
   → Save Results (database.saveResults)
   → Update Status (database.updateUploadStatus)

4. Get Results
   Frontend → GET /api/ai/results/:id
   → Auth Check
   → Fetch from DB (database.getUpload)
   → Return JSON Response
```

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/ai/upload | Upload image | ✅ Member |
| POST | /api/ai/analyze | Queue analysis | ✅ Member |
| GET | /api/ai/results/:id | Get results | ✅ |
| GET | /api/ai/status/:id | Check status | ✅ |
| GET | /api/ai/history | Get history | ✅ |
| GET | /api/ai/credits | Get credits | ✅ |
| GET | /api/ai/stats | Get stats | ✅ |
| POST | /api/ai/retry/:id | Retry failed | ✅ Member |
| DELETE | /api/ai/upload/:id | Delete upload | ✅ |

## Database Tables

- `ai_uploads` - Upload records & status
- `ai_results` - Analysis results
- `ai_usage_logs` - Usage tracking
- `users` (extended) - ai_credits, ai_subscription_tier

## External Services

- **OpenAI** - GPT-4 Vision, DALL-E 3
- **Supabase** - Database & Storage
- **Redis** - Queue management
