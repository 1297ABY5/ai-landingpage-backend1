import express from 'express';
import OpenAI from 'openai';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { z, ZodError } from 'zod';

// ========== CONFIGURATION ==========
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

// ENV CHECK
if (!OPENAI_API_KEY) {
  console.error('FATAL ERROR: OPENAI_API_KEY environment variable is not set.');
  process.exit(1);
}

// ========== SCHEMAS ==========
const allowedModels = ['gpt-4o', 'gpt-3.5-turbo'];
const GenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(5000),
  model: z.enum(allowedModels).optional().default('gpt-4o'),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  max_tokens: z.number().min(1).max(4000).optional().default(1000)
});

// ========== OPENAI CLIENT ==========
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  timeout: 15000,
  maxRetries: 2
});

// ========== EXPRESS SETUP ==========
const app = express();
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10kb' }));

// RATE LIMITING
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100, // 100 req per IP per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ========== ROUTES ==========

// Health check
app.get('/ping', (req, res) => {
  res.json({
    status: "ok",
    message: "pong",
    timestamp: Date.now(),
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

// AI Generation endpoint
app.post('/generate', async (req, res) => {
  const startTime = Date.now();
  try {
    // Validate input
    const { prompt, model, temperature, max_tokens } = GenerationRequestSchema.parse(req.body);

    // Logging (mask prompt in production)
    if (NODE_ENV === 'development') {
      console.log(`[${new Date().toISOString()}] Generation request`, { model, promptLength: prompt.length });
    }

    // Setup timeout controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const openaiRes = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const content = openaiRes.choices[0]?.message?.content;
      if (!content) throw new Error('Empty content received from AI');
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const tokensUsed = openaiRes.usage?.total_tokens || 0;

      // Response
      return res.json({
        success: true,
        data: { content },
        meta: {
          model,
          processing_time: processingTime,
          tokens_used: tokensUsed,
          timestamp: new Date().toISOString()
        }
      });

    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return res.status(504).json({ success: false, error: "AI response timed out" });
      }
      if (err instanceof OpenAI.APIError) {
        console.error('OpenAI API Error:', { status: err.status, code: err.code, message: err.message });
        return res.status(err.status || 500).json({
          success: false,
          error: "OpenAI API error",
          details: { code: err.code, message: err.message }
        });
      }
      // Other errors
      return res.status(500).json({ success: false, error: "AI generation failed", details: err.message });
    }
  } catch (err) {
    // Zod validation errors
    if (err instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: err.errors
      });
    }
    // Other errors
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
    return res.status(500).json({
      success: false,
      error: "Server error processing request",
      details: NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ========== SERVER STARTUP ==========
app.listen(PORT, () => {
  console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});
