require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const ItemCache = require('./item-cache');

// Initialize eBay API configuration if credentials are available
const hasEbayCredentials = process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID && process.env.EBAY_DEV_ID;
const ebayApiConfig = hasEbayCredentials ? {
    headers: {
        'X-EBAY-API-IAF-TOKEN': process.env.EBAY_APP_ID,
        'Content-Type': 'application/json'
    }
} : null;

// Load configuration
let config;
try {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (error) {
    console.error('Error loading config.json:', error.message);
    process.exit(1);
}

// Initialize item cache
const itemCache = new ItemCache();

async function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const configData = await fs.promises.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        // Ensure all required arrays exist
        if (!config.webhooks) config.webhooks = [];
        if (!config.stores) config.stores = [];
        if (!config.searches) config.searches = [];
        
        return config;
    } catch (error) {
        console.error('Error loading config:', error.message);
        return {
            webhooks: [],
            stores: [],
            searches: []
        };
    }
}

async function checkEbayStore(store) {
    try {
        const newItems = await checkStoreListings(store);
        if (newItems.length > 0) {
            await sendDiscordNotification(newItems, store);
            // Update seen items in the cache
            await itemCache.updateSeenItems('store', store.id, newItems.map(item => item.id));
        }
        console.log(`Checked store ${store.name} (${store.id}) - Found ${newItems.length} new items`);
    } catch (error) {
        console.error(`Error checking store ${store.name}:`, error.message);
    }
}

async function checkEbaySearch(search) {
    try {
        console.log(`Checking search: ${search.name}`);
        const items = await checkEbaySearchScraping(search.url);
        
        if (items.length > 0) {
            // Get the webhook configuration
            const webhookConfig = config.webhooks.find(w => w.name === search.webhook);
            if (!webhookConfig) {
                console.error(`Webhook "${search.webhook}" not found in configuration`);
                return;
            }

            // Check if this is the first scan for this search
            const isFirstScan = itemCache.isFirstScan('search', search.url);
            
            // On first scan, only send the newest 2 items
            const itemsToNotify = isFirstScan ? items.slice(0, 2) : items;
            
            if (isFirstScan) {
                console.log(`First scan: Only notifying about the newest 2 items out of ${items.length} found`);
            }

            // Send notifications with rate limiting
            for (const item of itemsToNotify) {
                const embed = {
                    title: item.title,
                    url: item.url,
                    color: 0x00ff00,
                    fields: [
                        { name: 'Price', value: item.price, inline: true },
                        { name: 'Condition', value: item.condition || 'Not specified', inline: true },
                        { name: 'Location', value: item.location || 'Not specified', inline: true }
                    ],
                    thumbnail: { url: item.imageUrl },
                    footer: { text: `Search: ${search.name}` },
                    timestamp: new Date().toISOString()
                };

                try {
                    await sendDiscordNotification(webhookConfig.url, {
                        content: `🔔 New item found in search "${search.name}"!`,
                        embeds: [embed]
                    });
                    // Add a small delay between notifications to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error('Error sending notification:', error.message);
                    // If we hit rate limits, wait longer
                    if (error.response?.status === 429) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            }

            // Update the cache with all items we've seen
            await itemCache.updateSeenItems('search', search.url, items.map(item => item.id));
        }
    } catch (error) {
        console.error(`Error checking search ${search.name}:`, error.message);
    }
}

async function checkStoreListings(store) {
    if (hasEbayCredentials) {
        return await checkEbayStoreAPI(store.id);
    } else {
        return await checkEbayStoreScraping(store.id);
    }
}

async function checkSearchListings(search) {
    if (hasEbayCredentials) {
        // Extract search parameters from URL
        const url = new URL(search.url);
        const params = Object.fromEntries(url.searchParams);
        return await checkEbaySearchAPI(params);
    } else {
        return await checkEbaySearchScraping(search.url);
    }
}

async function checkEbayStoreAPI(storeId) {
    try {
        const apiUrl = process.env.EBAY_SANDBOX === 'true' 
            ? 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search'
            : 'https://api.ebay.com/buy/browse/v1/item_summary/search';

        const response = await axios.get(apiUrl, {
            ...ebayApiConfig,
            params: {
                filter: `sellerName:${storeId}`,
                sort: 'newlyListed',
                limit: 100
            }
        });

        const items = response.data.itemSummaries || [];
        
        // Filter out items we've already seen
        return items
            .filter(item => itemCache.isNewItem('store', storeId, item.itemId))
            .map(item => ({
                id: item.itemId,
                title: item.title,
                price: item.price.value,
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl,
                condition: item.condition,
                location: item.itemLocation
            }));
    } catch (error) {
        console.error('Error using eBay API:', error.message);
        throw error;
    }
}

async function checkEbaySearchAPI(params) {
    try {
        const apiUrl = process.env.EBAY_SANDBOX === 'true' 
            ? 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search'
            : 'https://api.ebay.com/buy/browse/v1/item_summary/search';

        const response = await axios.get(apiUrl, {
            ...ebayApiConfig,
            params: {
                ...params,
                sort: 'newlyListed',
                limit: 100
            }
        });

        const items = response.data.itemSummaries || [];
        
        // Filter out items we've already seen
        return items
            .filter(item => itemCache.isNewItem('search', params._nkw, item.itemId))
            .map(item => ({
                id: item.itemId,
                title: item.title,
                price: item.price.value,
                url: item.itemWebUrl,
                imageUrl: item.image?.imageUrl,
                condition: item.condition,
                location: item.itemLocation
            }));
    } catch (error) {
        console.error('Error using eBay API:', error.message);
        throw error;
    }
}

async function checkEbayStoreScraping(storeId) {
    try {
        const url = `https://www.ebay.com/sch/${storeId}/i.html?_sacat=0&_sop=10`;
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        
        const items = [];
        
        $('.s-item').each((_, element) => {
            const itemId = $(element).attr('data-listing-id');
            if (itemId && itemCache.isNewItem('store', storeId, itemId)) {
                const title = $(element).find('.s-item__title').text().trim();
                const price = $(element).find('.s-item__price').text().trim();
                const imageUrl = $(element).find('.s-item__image-img').attr('src');
                const itemUrl = $(element).find('.s-item__link').attr('href');
                const condition = $(element).find('.SECONDARY_INFO').text().trim();
                const location = $(element).find('.s-item__location').text().trim();

                items.push({
                    id: itemId,
                    title,
                    price,
                    url: itemUrl,
                    imageUrl,
                    condition,
                    location
                });
            }
        });

        return items;
    } catch (error) {
        console.error('Error scraping eBay store:', error.message);
        throw error;
    }
}

async function checkEbaySearchScraping(url) {
    try {
        console.log(`Fetching search results from: ${url}`);
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];
        let totalItemsFound = 0;

        // Find all item containers
        $('.s-item__wrapper').each((_, element) => {
            try {
                const $item = $(element);
                totalItemsFound++;
                
                // Skip the first item if it's the "Shop on eBay" item
                if ($item.find('.s-item__title').text().trim() === 'Shop on eBay') {
                    return;
                }

                // Extract item ID from data-listing-id attribute
                let itemId = $item.attr('data-listing-id');
                
                // If no data-listing-id, try to get it from the URL
                if (!itemId) {
                    const itemUrl = $item.find('.s-item__link').attr('href');
                    if (itemUrl) {
                        const match = itemUrl.match(/\/(\d+)\?/);
                        if (match) {
                            itemId = match[1];
                        }
                    }
                }

                // Skip items without valid IDs
                if (!itemId) {
                    return;
                }

                // Get the item URL
                const itemUrl = $item.find('.s-item__link').attr('href');
                if (!itemUrl) {
                    return;
                }

                // Extract other item details
                const title = $item.find('.s-item__title').text().trim();
                const price = $item.find('.s-item__price').text().trim();
                const condition = $item.find('.SECONDARY_INFO').text().trim();
                const location = $item.find('.s-item__location').text().trim();
                const imageUrl = $item.find('.s-item__image-img').attr('src');

                // Check if this is a new item
                if (itemCache.isNewItem('search', url, itemId)) {
                    items.push({
                        id: itemId,
                        title,
                        price,
                        condition,
                        location,
                        url: itemUrl,
                        imageUrl
                    });
                }
            } catch (error) {
                console.error('Error processing item:', error.message);
            }
        });

        console.log(`Total items found on page: ${totalItemsFound}`);
        console.log(`New items found: ${items.length}`);
        return items;
    } catch (error) {
        console.error('Error fetching search results:', error.message);
        return [];
    }
}

async function sendDiscordNotification(webhookUrl, message) {
    try {
        await axios.post(webhookUrl, message);
        console.log(`Discord notification sent successfully`);
    } catch (error) {
        console.error('Error sending Discord notification:', error.message);
    }
}

async function startMonitoring() {
    try {
        // Load configuration
        const config = await loadConfig();
        
        // Initialize item cache
        await itemCache.loadCache();
        
        console.log(`Starting eBay scanner with ${config.stores.length} stores and ${config.searches.length} searches`);
        console.log(`Using ${hasEbayCredentials ? 'eBay API' : 'web scraping'} method`);

        // Schedule store checks
        for (const store of config.stores) {
            if (store.enabled) {
                console.log(`Scheduling store ${store.name} to check every ${store.interval} minutes`);
                cron.schedule(`*/${store.interval} * * * *`, () => checkEbayStore(store));
            }
        }

        // Schedule search checks
        for (const search of config.searches) {
            if (search.enabled) {
                console.log(`Scheduling search ${search.name} to check every ${search.interval} minutes`);
                cron.schedule(`*/${search.interval} * * * *`, () => checkEbaySearch(search));
            }
        }

        // Run initial checks
        for (const store of config.stores) {
            if (store.enabled) {
                await checkEbayStore(store);
            }
        }

        for (const search of config.searches) {
            if (search.enabled) {
                await checkEbaySearch(search);
            }
        }
    } catch (error) {
        console.error('Error starting monitoring:', error.message);
        process.exit(1);
    }
}

// Start the monitoring
startMonitoring(); 