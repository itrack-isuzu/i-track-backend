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

const corsOrigin =
  env.clientOrigin === '*'
    ? true
    : env.clientOrigin.split(',').map((origin) => origin.trim());

app.use(
  cors({
    origin: corsOrigin,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
