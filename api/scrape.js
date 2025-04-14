import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { sql } from '@vercel/postgres';
import * as cheerio from 'cheerio';
import url from 'url';

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

const PROXY_HOST = '185.199.231.45';
const PROXY_PORT = '8382';
const PROXY_USER = 'jgvnfgna';
const PROXY_PWD = 'qusdss57vicn';

// --- End Configuration ---

// --- Helper Functions (Copied from server.js) ---
const parsePrice = (priceStr) => {
    if (!priceStr) return 0;
    const cleanPrice = priceStr.replace(/[^\d.]/g, '');
    const parts = cleanPrice.split('.');
    let finalPrice = '';
    if (parts.length > 1) {
        finalPrice = parts.join('');
    } else {
        finalPrice = cleanPrice;
    }
    const parsedPrice = parseInt(finalPrice, 10);
    return isNaN(parsedPrice) ? 0 : parsedPrice;
};
const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};
// --- End Helper Functions ---

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', ['POST']);
        return response.status(405).json({ message: `Method ${request.method} Not Allowed` });
    }

    // Vercel automatically parses JSON body for POST
    const minPriceRaw = request.body?.minPrice; // Use optional chaining
    const minPrice = minPriceRaw ? parsePrice(minPriceRaw) : 0;
    console.log(`Received scrape request. Min Price Filter: ${minPrice}`);

    let browser = null; // Define browser variable outside try block
    try {
        console.log("Launching browser...");
        // Launch Puppeteer using @sparticuz/chromium
        browser = await puppeteer.launch({
            args: [ 
                `--proxy-server=http://${PROXY_USER}:${PROXY_PWD}@${PROXY_HOST}:${PROXY_PORT}`,
                ...chromium.args 
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(), // <-- Use await and call as function
            headless: chromium.headless, // Use 'new' headless mode if supported/needed, otherwise use boolean
            ignoreHTTPSErrors: true,
        });
        
        const page = await browser.newPage();
        // Set a random User Agent for the browser page
        await page.setUserAgent(getRandomUserAgent());

        // *** ADDED: Block unnecessary resources ***
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                request.abort();
            } else {
                request.continue();
            }
        });
        // *** END BLOCKING ***

        console.log(`Navigating to ${VENDOR_URL} (blocking resources)...`);
        // Navigate to the page
        await page.goto(VENDOR_URL, {
            waitUntil: 'domcontentloaded', // Wait for initial DOM
            timeout: 20000 // Timeout for initial navigation
        });
        console.log("Navigation successful (DOM loaded).");

        // *** ADDED: Wait specifically for listing items to appear ***
        const listingItemSelector = `li.${TARGET_CLASS.split(' ').join('.')}`;
        console.log(`Waiting for selector: ${listingItemSelector}`);
        await page.waitForSelector(listingItemSelector, {
             timeout: 15000 // Wait up to 15 seconds for listings to render
        });
        console.log("Listing selector found. Getting content...");
        // *** END ADDED WAIT ***

        // Get the fully rendered HTML content NOW
        const htmlContent = await page.content();
        console.log(`Got HTML content, length: ${htmlContent.length}`);

        // Close the browser ASAP
        await browser.close();
        browser = null; // Ensure it's marked as closed
        console.log("Browser closed.");

        // --- Now parse with Cheerio as before ---
        const $ = cheerio.load(htmlContent);
        const baseUrl = new url.URL(VENDOR_URL).origin;

        // 2. Scrape current listings
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

        // 3. Filter scraped listings if minPrice is provided
        const listingsToSave = minPrice > 0
            ? scrapedListings.filter(l => parsePrice(l.price) >= minPrice)
            : scrapedListings;
        console.log(`${listingsToSave.length} listings after price filter (if any).`);

        // 4. Get previous listings URLs from DB
        const { rows: previousListingsDocs } = await sql`SELECT url FROM listings;`;
        const previousListingUrls = new Set(previousListingsDocs.map(doc => doc.url));
        console.log(`Found ${previousListingUrls.size} listings in DB.`);

        // 5. Find new listings
        const newListings = listingsToSave.filter(l => !previousListingUrls.has(l.url));
        console.log(`Found ${newListings.length} new listings.`);

        // 6. Update the database (Transactional approach recommended for production)
        // For simplicity here: DELETE ALL then INSERT ALL filtered listings.
        // A more robust way would be INSERT ... ON CONFLICT DO UPDATE or separate INSERT/DELETE.
        await sql`DELETE FROM listings;`;
        console.log(`Removed old listings from DB.`);

        if (listingsToSave.length > 0) {
            // Prepare batch insert query
            // Need to map listingsToSave into values for the SQL query
            // Example for one insert (loop or batching needed for multiple):
            // await sql`INSERT INTO listings (url, price) VALUES (${listingsToSave[0].url}, ${listingsToSave[0].price});`;
            
            // Batch insert using map and Promise.all (more efficient)
            const insertPromises = listingsToSave.map(listing =>
                sql`INSERT INTO listings (url, price) VALUES (${listing.url}, ${listing.price}) ON CONFLICT (url) DO UPDATE SET price = EXCLUDED.price, scraped_at = CURRENT_TIMESTAMP;`
            );
            await Promise.all(insertPromises);
            console.log(`Inserted/Updated ${listingsToSave.length} current listings into DB.`);
        }

        // 7. Return NEW listings
        return response.status(200).json({ newListings: newListings });

    } catch (error) {
        console.error("Error during scraping process:", error);
        // Ensure browser is closed even on error
        if (browser !== null) {
            await browser.close();
            console.log("Browser closed after error.");
        }
        let status = 500;
        let message = "An internal server error occurred during scraping.";
        // Handle specific error types if needed
        if (error.message && error.message.includes('Navigation timeout')) {
            status = 504; // Gateway Timeout
            message = "Timeout navigating to the vendor page.";
        } else if (error.code && error.code.startsWith('POSTGRES_')) {
            status = 500;
            message = "Database error during scrape update.";
        }
        return response.status(status).json({ message: message, error: error.message || 'Unknown error' });
    }
} 