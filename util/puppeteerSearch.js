const puppeteer = require('puppeteer');
const logger = require('../logger');

/**
 * Perform a hardened, headless browser search using DuckDuckGo HTML.
 * This completely bypasses simple scraper rate-limiting by booting a real Chromium instance.
 */
async function performSearch(query) {
    let browser = null;
    try {
        browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        const page = await browser.newPage();
        
        // Spoof a regular Windows machine to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Use DuckDuckGo HTML version for highly stable, lightweight scraping
        await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        });
        
        const results = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.result'));
            return items.slice(0, 10).map(el => {
                const titleEl = el.querySelector('.result__title');
                const snippetEl = el.querySelector('.result__snippet');
                const linkEl = el.querySelector('.result__url');
                
                return {
                    title: titleEl ? titleEl.innerText.trim() : '',
                    snippet: snippetEl ? snippetEl.innerText.trim() : '',
                    link: linkEl ? linkEl.getAttribute('href') : ''
                };
            }).filter(r => r.title && r.snippet); // ensure it's a valid extraction
        });
        
        logger.info(`Puppeteer correctly extracted ${results.length} search results for "${query}"`);
        return results;
    } catch (e) {
        logger.error(`Puppeteer search threw an anomaly: ${e.message}`);
        throw e;
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

module.exports = { performSearch };
