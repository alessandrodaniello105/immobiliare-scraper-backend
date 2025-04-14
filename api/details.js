import axios from 'axios';
import * as cheerio from 'cheerio';
import url from 'url'; // Needed for VENDOR_URL if used for referer

// --- Configuration (Copied from server.js) ---
const VENDOR_URL = "https://www.immobiliare.it/agenzie-immobiliari/12328/nicoletta-zaggia-padova/"; // Needed for Referer
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

// --- Helper Function (Copied from server.js) ---
const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};
// --- End Helper Functions ---

export default async function handler(request, response) {
    if (request.method !== 'GET') {
        response.setHeader('Allow', ['GET']);
        return response.status(405).json({ message: `Method ${request.method} Not Allowed` });
    }

    // Get URL from query parameter (Vercel provides request.query)
    const propertyUrl = request.query.url;

    if (!propertyUrl || !propertyUrl.startsWith('https://www.immobiliare.it/annunci/')) {
        return response.status(400).json({ message: "Valid 'url' query parameter starting with 'https://www.immobiliare.it/annunci/' is required." });
    }
    console.log(`Received request to scrape details: ${propertyUrl}`);

    try {
        // Use MINIMAL headers for details request as well
        const minimalDetailHeaders = {
            ...BASE_HEADERS,
            'User-Agent': getRandomUserAgent(),
            // Consider adding Referer if still facing issues after testing minimal
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
                          $('.ld-title__content').first().text().trim() ||
                          'N/A';
        let descriptionContainer = $('.in-readAll');
        if (descriptionContainer.length > 0) {
             let descElement = descriptionContainer.children('div').first();
             if (!descElement.text().trim()) {
                 descElement = descriptionContainer.find('div[class*="description"]').first();
             }
             details.description = descElement.text().trim() || 'N/A';
         } else {
             details.description = $('[data-testid="description"]').text().trim() || 
                                   $('[data-testid="description"]').text().trim() || 
                                   $('.in-readAll').first().text().trim() ||
                                   'N/A';
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
        return response.status(200).json(details); // Send success response

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
        return response.status(status).json({ message: message, error: error.message || 'Unknown error', url: propertyUrl });
    }
} 