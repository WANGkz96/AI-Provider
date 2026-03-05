import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '100mb';

// Middleware
app.use(cors());
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
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start Server
app.listen(PORT, () => {
  console.log(`
  🚀 AI Provider Server running on http://localhost:${PORT}
  
  Endpoints:
  - GET /health
  - GET /available-models
  - POST /run
  
  Check .env for configuration.
  `);
});

