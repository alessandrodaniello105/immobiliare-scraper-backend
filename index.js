// index.js - Combined Server for Render Web Service
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import url from 'url';
import { sql } from '@vercel/postgres'; // Use Vercel Postgres SDK

// Import puppeteer packages (ensure they are dependencies)
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const app = express();
// Render sets the PORT environment variable
const PORT = process.env.PORT || 3001;

// --- Configuration (Consider moving to .env for production) ---
const VENDOR_URL = "https://www.immobiliare.it/agenzie-immobiliari/12328/nicoletta-zaggia-padova/";
const TARGET_TAG = "li";
const TARGET_CLASS = "nd-list__item";
const LINK_TAG_SELECTOR = "a.in-listingCardTitle";
const PRICE_SELECTOR = "div.in-listingCardPrice span, div.in-listingCardPrice";
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
];
const BASE_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
};
// --- End Configuration ---

// --- Helper Functions ---
const parsePrice = (priceStr) => {
    if (!priceStr) return 0;
    const cleanPrice = priceStr.replace(/[^\d.]/g, '');
    const parts = cleanPrice.split('.');
    let finalPrice = '';
    if (parts.length > 1) finalPrice = parts.join(''); else finalPrice = cleanPrice;
    const parsedPrice = parseInt(finalPrice, 10);
    return isNaN(parsedPrice) ? 0 : parsedPrice;
};
const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};
// --- End Helper Functions ---

// --- Middleware ---
// Allow requests from your frontend domain (update if needed)
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' })); 
app.use(express.json()); // Parse JSON bodies
// --- End Middleware ---

// --- API Routes ---

// GET /api/listings - Fetch all stored listings
app.get('/api/listings', async (req, res) => {
    console.log("GET /api/listings received");
    try {
      const { rows } = await sql`SELECT url, price FROM listings ORDER BY scraped_at DESC;`;
      res.status(200).json({ listings: rows });
    } catch (error) {
      console.error('Database Error (GET /api/listings):', error);
      res.status(500).json({ message: 'Error fetching listings from database.', error: error.message });
    }
});

// DELETE /api/listings - Remove all stored listings
app.delete('/api/listings', async (req, res) => {
    console.log("DELETE /api/listings received");
    try {
      await sql`DELETE FROM listings;`;
      console.log('Deleted all listings from DB.');
      res.status(200).json({ message: 'Successfully deleted all listings.' });
    } catch (error) {
      console.error('Database Error (DELETE /api/listings):', error);
      res.status(500).json({ message: 'Error clearing database.', error: error.message });
    }
});

// POST /api/scrape - Scan vendor page, update DB, return new listings
app.post('/api/scrape', async (req, res) => {
    const minPriceRaw = req.body?.minPrice;
    const minPrice = minPriceRaw ? parsePrice(minPriceRaw) : 0;
    console.log(`POST /api/scrape received. Min Price Filter: ${minPrice}`);

    let browser = null;
    try {
        console.log("Launching browser...");
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });
        const page = await browser.newPage();
        await page.setUserAgent(getRandomUserAgent());

        console.log(`Navigating to ${VENDOR_URL} (blocking resources)...`);
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                request.abort();
            } else {
                request.continue();
            }
        });
        
        await page.goto(VENDOR_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 45000 // Increased timeout for Render
        });
        console.log("Navigation successful (DOM loaded).");

        const listingItemSelector = `li.${TARGET_CLASS.split(' ').join('.')}`;
        console.log(`Waiting for selector: ${listingItemSelector}`);
        await page.waitForSelector(listingItemSelector, {
             timeout: 30000 // Increased timeout for Render
        });
        console.log("Listing selector found. Getting content...");
        
        const htmlContent = await page.content();
        console.log(`Got HTML content, length: ${htmlContent.length}`);
        await browser.close();
        browser = null;
        console.log("Browser closed.");

        const $ = cheerio.load(htmlContent);
        const baseUrl = new url.URL(VENDOR_URL).origin;
        let scrapedListings = [];
        $(`${TARGET_TAG}.${TARGET_CLASS.split(' ').join('.')}`).each((i, element) => {
             const linkTag = $(element).find(LINK_TAG_SELECTOR);
             const priceTag = $(element).find(PRICE_SELECTOR);
             if (linkTag.length > 0) {
                 const href = linkTag.attr('href');
                 const priceText = priceTag.text().trim();
                 if (href && href.includes("immobiliare.it/annunci/")) {
                     let absoluteLink = href.startsWith('/') ? baseUrl + href : href;
                     scrapedListings.push({ url: absoluteLink, price: priceText });
                 }
             }
         });
        console.log(`Scraped ${scrapedListings.length} listings from page content.`);

        const listingsToSave = minPrice > 0
            ? scrapedListings.filter(l => parsePrice(l.price) >= minPrice)
            : scrapedListings;
        console.log(`${listingsToSave.length} listings after price filter (if any).`);

        const { rows: previousListingsDocs } = await sql`SELECT url FROM listings;`;
        const previousListingUrls = new Set(previousListingsDocs.map(doc => doc.url));
        console.log(`Found ${previousListingUrls.size} listings in DB.`);

        const newListings = listingsToSave.filter(l => !previousListingUrls.has(l.url));
        console.log(`Found ${newListings.length} new listings.`);

        await sql`DELETE FROM listings;`;
        console.log(`Removed old listings from DB.`);
        if (listingsToSave.length > 0) {
            const insertPromises = listingsToSave.map(listing =>
                sql`INSERT INTO listings (url, price) VALUES (${listing.url}, ${listing.price}) ON CONFLICT (url) DO UPDATE SET price = EXCLUDED.price, scraped_at = CURRENT_TIMESTAMP;`
            );
            await Promise.all(insertPromises);
            console.log(`Inserted/Updated ${listingsToSave.length} current listings into DB.`);
        }

        res.status(200).json({ newListings: newListings });

    } catch (error) {
        console.error("Error during scraping process:", error);
        if (browser !== null) {
            await browser.close();
            console.log("Browser closed after error.");
        }
        let status = 500;
        let message = "An internal server error occurred during scraping.";
        if (error.message && error.message.includes('Timeout')) { // General timeout check
            status = 504;
            message = "Timeout during scraping operation.";
        } else if (error.code && error.code.startsWith('POSTGRES_')) {
            status = 500;
            message = "Database error during scrape update.";
        }
        res.status(status).json({ message: message, error: error.message || 'Unknown error' });
    }
});

// GET /api/details - Fetch details for a specific property
app.get('/api/details', async (req, res) => {
    const propertyUrl = req.query.url;
    if (!propertyUrl || !propertyUrl.startsWith('https://www.immobiliare.it/annunci/')) {
        return res.status(400).json({ message: "Valid 'url' query parameter is required." });
    }
    console.log(`GET /api/details received for: ${propertyUrl}`);

    try {
        // Use MINIMAL headers for details request
        const minimalDetailHeaders = {
            ...BASE_HEADERS,
            'User-Agent': getRandomUserAgent(),
            'Referer': VENDOR_URL
        };
        console.log("Using MINIMAL headers for details:", minimalDetailHeaders);

        const axiosResponse = await axios.get(propertyUrl, {
             headers: minimalDetailHeaders,
             timeout: 25000 
            });
        console.log(`Detail fetch successful (Status: ${axiosResponse.status})`);
        const htmlContent = axiosResponse.data;
        const $ = cheerio.load(htmlContent);

        // Re-using the selectors from the previously working version
        const details = {};
        details.price = $('[data-testid="price-value"]').first().text().trim() ||
                        $('.in-price__value').first().text().trim() ||
                        $('.im-priceDetail__price').first().text().trim() ||
                        'N/A';
        details.address = $('[data-testid="address"]').first().text().trim() ||
                          $('.in-location span').first().text().trim() ||
                          'N/A';
        let descriptionContainer = $('.in-readAll');
        if (descriptionContainer.length > 0) {
             let descElement = descriptionContainer.children('div').first();
             if (!descElement.text().trim()) {
                 descElement = descriptionContainer.find('div[class*="description"]').first();
             }
             details.description = descElement.text().trim() || 'N/A';
         } else {
             details.description = $('[data-testid="description"]').text().trim() || 'N/A';
         }
        details.features = [];
        $('[data-testid="features"] dl.im-features__list, dl.in-features__list, dl.nd-list--features').children().each((i, el) => {
            const $el = $(el);
            if (el.tagName === 'dt') {
                const key = $el.text().trim();
                const valueElement = $el.next('dd');
                const value = valueElement.text().trim();
                if (key && value) {
                    details.features.push({ key, value });
                }
            }
        });
        if (details.features.length === 0) {
             $('dt.ld-featuresItem__title').each((i, dtElement) => {
                 const key = $(dtElement).text().trim();
                 const value = $(dtElement).next('dd.ld-featuresItem__description').text().trim();
                 if (key && value) {
                     details.features.push({ key, value });
                 }
             });
        }
        details.otherFeatures = [];
         $('[data-testid="features-others"] .im-features__tag').each((i, el) => {
            details.otherFeatures.push($(el).text().trim());
         });
         if (details.otherFeatures.length === 0) {
            $('li.ld-featuresBadges__badge span').each((i, el) => {
                details.otherFeatures.push($(el).text().trim());
            });
         }
        details.surface = details.features.find(f => f.key.toLowerCase().includes('superficie'))?.value || 'N/A';
        if (details.surface === 'N/A') {
             details.surface = $('[data-testid="surface-value"]').text().trim() ||
                               $('.ld-surfaceElement').text().trim() ||
                               'N/A';
        }
        details.costs = [];
        $('h2:contains("Costi"), h2:contains("Spese")').first().next('dl').children().each((i, el) => {
             const $el = $(el);
             if (el.tagName === 'dt') {
                 const key = $el.text().trim();
                 const value = $el.next('dd').text().trim();
                 if (key && value) {
                    details.costs.push({ key, value });
                 }
             }
         });
        if (details.costs.length === 0) {
             $('dl.in-detailFeatures').children().each((i, el) => {
                  const $el = $(el);
                  if (el.tagName === 'dt') {
                      const key = $el.text().trim();
                      const value = $el.next('dd').text().trim();
                      if (key && value) {
                         details.costs.push({ key, value });
                      }
                  }
              });
        }

        console.log(`Extracted details for ${propertyUrl}`);
        res.status(200).json(details);

    } catch (error) {
        console.error(`Error scraping details for ${propertyUrl}:`, error);
        let status = 500;
        let message = "An internal server error occurred while scraping details.";
        if (error.isAxiosError && error.response) {
            status = error.response.status;
            message = `Failed to fetch or parse detail page. Status: ${status}`;
        } else if (error.isAxiosError && error.request) {
            status = 504;
            message = "No response received from target server.";
        }
        res.status(status).json({ message: message, error: error.message || 'Unknown error', url: propertyUrl });
    }
});

// --- End API Routes ---

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Database connection details should be loaded from environment variables.`);
}); 