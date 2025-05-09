// index.js - Combined Server for Render Web Service
import express from 'express';
import cors from 'cors';
import { sql } from '@vercel/postgres'; // Use Vercel Postgres SDK
import listingsRouter from './api/listings.js';
import scrapeRouter from './api/scrape.js';
import detailsRouter from './api/details.js';


//const express = require('express');
//const cors = require('cors')
//const { sql } = require('@vercel/postgres'); // Use Vercel Postgres SDK
//const listingsRouter = require('./api/listings.js');
//const scrapeRouter = require('./api/scrape.js');
//const detailsRouter = require('./api/details.js');



const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json()); // Parse JSON bodies

// --- API Routes ---
app.use('/api/listings', listingsRouter);
app.use('/api/scrape', scrapeRouter);
app.use('/api/details', detailsRouter);

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Database connection details should be loaded from environment variables.`);
});
