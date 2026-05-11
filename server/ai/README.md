# AI Grooming Assistant Backend

## Struktur Folder

```
ai/
├── config/
│   └── database.js          # Supabase client configuration
├── controllers/
│   └── aiController.js      # Main AI API handlers
├── middleware/
│   ├── auth.js              # JWT & membership verification
│   ├── rateLimiter.js       # Tier-based rate limiting
│   └── upload.js            # Image upload handler (Sharp)
├── models/
│   └── aiModel.js           # Database operations
├── routes/
│   └── aiRoutes.js          # Express routes
├── services/
│   ├── aiService.js         # OpenAI/GPT-4 Vision integration
│   ├── imageService.js      # Image processing & storage
│   └── queueService.js      # Bull/Redis queue management
├── workers/
│   └── aiWorker.js          # Background job processor
├── utils/
│   ├── prompts.js           # AI prompts templates
│   └── helpers.js           # Utility functions
├── schema/
│   └── ai_schema.sql        # Database migrations
└── tests/
    └── ai.test.js           # Unit tests
```

## Alur Kerja

1. **Upload** → User upload foto → Sharp compress → Supabase Storage
2. **Queue** → Job masuk Bull queue (Redis)
3. **Process** → Worker panggil OpenAI API
4. **Store** → Hasil disimpan di Supabase
5. **Notify** → WebSocket/HTTP response ke frontend

## Environment Variables

```
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://...
SUPABASE_SERVICE_KEY=eyJ...
```
