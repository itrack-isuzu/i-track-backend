import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

import apiRoutes from './routes/index.js';
import { env } from './config/env.js';
import {
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler.js';

const app = express();
const isProduction = env.nodeEnv === 'production';

const corsOrigin =
  env.clientOrigin === '*'
    ? true
    : env.clientOrigin.split(',').map((origin) => origin.trim());

const apiSecurityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=(), payment=(), usb=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'"
  );

  if (isProduction) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }

  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }

  next();
};

app.use(
  cors({
    origin: corsOrigin,
  })
);
app.use(apiSecurityHeaders);
app.use(
  express.json({
    limit: '6mb',
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: '6mb',
  })
);
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/', (req, res) => {
  void req;

  res.json({
    success: true,
    message: 'Welcome to the I-TRACK backend API.',
    data: {
      docs: '/api/health',
    },
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
