import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';
import { config } from './config/models.js';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applySecurityHeaders,
  buildCorsOptions
} from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = config.port || process.env.PORT || 3000;
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '300mb';
const serverRequestTimeoutMs = config.serverRequestTimeoutMs;
const serverHeadersTimeoutMs = Math.max(config.serverHeadersTimeoutMs, serverRequestTimeoutMs + 1000);

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Middleware
app.use(applySecurityHeaders);
app.use(cors(buildCorsOptions(config)));
app.use(express.json({ limit: requestBodyLimit }));

// API Routes
app.use('/', apiRoutes);

// Serve Frontend Static Files
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// Catch-all route to serve index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error Handling
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request body too large',
      details: `Increase REQUEST_BODY_LIMIT if you need to send larger base64 media payloads. Current limit: ${requestBodyLimit}.`
    });
  }

  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`
  🚀 AI Provider Server running on http://localhost:${PORT}
  
  Endpoints:
  - GET /health
  - GET /available-models
  - POST /run

  Server timeouts:
  - requestTimeout: ${serverRequestTimeoutMs}ms
  - headersTimeout: ${serverHeadersTimeoutMs}ms
  
  Check .env for configuration.
  `);
});

server.requestTimeout = serverRequestTimeoutMs;
server.headersTimeout = serverHeadersTimeoutMs;

