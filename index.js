require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const ItemCache = require('./item-cache');
const usageStats = require('./usage-stats');

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

// Add this constant at the top of the file after the imports
const MAX_INITIAL_NOTIFICATIONS = 5; // Maximum number of notifications to send on initial scan

// Add this at the top with other variables
let isFirstRun = true;

function getTimestamp() {
    const now = new Date();
    return `[${now.toLocaleTimeString()}]`;
}

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
        console.log(`${getTimestamp()} Checking store: ${store.name}`);
        const startTime = Date.now();
        let bytesReceived = 0;
        let requestCount = 0;
        let itemsProcessed = 0;
        const storeId = store.url.split('/str/')[1].split('/')[0];
        const url = `https://www.ebay.ca/sch/i.html?_nkw=&_sacat=0&_sop=10&_dmd=2&_ipg=200&_ssn=${storeId}`;
        console.log(`${getTimestamp()} Fetching store items from: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];

        $('.s-item').each((_, element) => {
            const $item = $(element);
            const title = $item.find('.s-item__title').text().trim();
            if (title === 'Shop on eBay') return;

            const price = $item.find('.s-item__price').text().trim();
            const url = $item.find('a.s-item__link').attr('href');
            const imageUrl = $item.find('.s-item__image-img').attr('src');
            const condition = $item.find('.SECONDARY_INFO').text().trim();
            const shipping = $item.find('.s-item__shipping').text().trim();
            const location = $item.find('.s-item__location').text().trim();
            const bids = $item.find('.s-item__bids').text().trim();
            const timeLeft = $item.find('.s-item__time-left').text().trim();
            const itemId = url.split('/itm/')[1]?.split('?')[0] || '';

            if (itemId) {
                items.push({
                    id: itemId,
                    title: cleanTitle(title),
                    price,
                    url,
                    imageUrl,
                    condition,
                    shipping,
                    location,
                    bids,
                    timeLeft
                });
            }
        });

        console.log(`${getTimestamp()} Total items found on page: ${items.length}`);

        let newItems = 0;
        let notifiedItems = 0;

        for (const item of items) {
            if (itemCache.isNewItem('store', store.name, item.id)) {
                newItems++;
                // Only send notification if it's not the first run or we haven't hit the limit
                if (!isFirstRun || notifiedItems < 2) {
                    await sendDiscordNotification(store, item);
                    notifiedItems++;
                }
            }
        }

        console.log(`${getTimestamp()} New items found: ${newItems}`);
        if (isFirstRun && newItems > 2) {
            console.log(`${getTimestamp()} Note: ${newItems - 2} additional new items found but not notified to prevent spam`);
        }

        // After successful store check, record stats
        bytesReceived = response.data.length;
        requestCount = 1;
        itemsProcessed = items.length;

        usageStats.recordScan(bytesReceived, requestCount, itemsProcessed);

    } catch (error) {
        console.error(`${getTimestamp()} Error checking store ${store.name}:`, error.message);
    }
}

async function checkEbaySearch(search) {
    try {
        console.log(`${getTimestamp()} Checking search: ${search.name}`);
        const startTime = Date.now();
        let bytesReceived = 0;
        let requestCount = 0;
        let itemsProcessed = 0;
        
        // Parse the search URL to extract parameters
        const searchUrl = new URL(search.url);
        const params = new URLSearchParams(searchUrl.search);
        
        // Construct the search URL properly
        const searchParams = new URLSearchParams({
            '_nkw': params.get('_nkw') || '',
            '_sacat': '0',
            '_from': 'R40',
            '_sop': '10',
            'rt': 'nc'
        });
        
        // Add minimum price if specified
        const minPrice = params.get('_udlo');
        if (minPrice) {
            searchParams.append('_udlo', minPrice);
        }
        
        const url = `https://www.ebay.ca/sch/i.html?${searchParams.toString()}`;
        console.log(`${getTimestamp()} Fetching search results from: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];

        $('.s-item').each((_, element) => {
            const $item = $(element);
            const title = $item.find('.s-item__title').text().trim();
            if (title === 'Shop on eBay') return;

            const price = $item.find('.s-item__price').text().trim();
            const url = $item.find('a.s-item__link').attr('href');
            const imageUrl = $item.find('.s-item__image-img').attr('src');
            const condition = $item.find('.SECONDARY_INFO').text().trim();
            const shipping = $item.find('.s-item__shipping').text().trim();
            const location = $item.find('.s-item__location').text().trim();
            const bids = $item.find('.s-item__bids').text().trim();
            const timeLeft = $item.find('.s-item__time-left').text().trim();
            const itemId = url.split('/itm/')[1]?.split('?')[0] || '';

            if (itemId) {
                items.push({
                    id: itemId,
                    title: cleanTitle(title),
                    price,
                    url,
                    imageUrl,
                    condition,
                    shipping,
                    location,
                    bids,
                    timeLeft
                });
            }
        });

        console.log(`${getTimestamp()} Total items found on page: ${items.length}`);

        let newItems = 0;
        let notifiedItems = 0;

        for (const item of items) {
            if (itemCache.isNewItem('search', search.name, item.id)) {
                newItems++;
                // Only send notification if it's not the first run or we haven't hit the limit
                if (!isFirstRun || notifiedItems < 2) {
                    await sendDiscordNotification(search, item);
                    notifiedItems++;
                }
            }
        }

        console.log(`${getTimestamp()} New items found: ${newItems}`);
        if (isFirstRun && newItems > 2) {
            console.log(`${getTimestamp()} Note: ${newItems - 2} additional new items found but not notified to prevent spam`);
        }

        // After successful search check, record stats
        bytesReceived = response.data.length;
        requestCount = 1;
        itemsProcessed = items.length;

        usageStats.recordScan(bytesReceived, requestCount, itemsProcessed);

    } catch (error) {
        console.error(`${getTimestamp()} Error checking search ${search.name}:`, error.message);
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
        // Extract store name from URL if it's a full URL
        let storeName = storeId;
        if (storeId.startsWith('http')) {
            const urlParts = storeId.split('/');
            storeName = urlParts[urlParts.length - 1].split('?')[0];
        }

        // Use the search API endpoint with seller filter
        const searchUrl = `https://www.ebay.ca/sch/i.html?_nkw=&_sacat=0&_sop=10&_dmd=2&_ipg=200&_ssn=${storeName}`;
        console.log(`${getTimestamp()} Fetching store items from: ${searchUrl}`);
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];
        let totalItemsFound = 0;

        // Find all item containers
        $('.s-item').each((_, element) => {
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
                const title = cleanTitle($item.find('.s-item__title').text());
                const price = $item.find('.s-item__price').text().trim();
                const condition = $item.find('.SECONDARY_INFO').text().trim();
                const location = $item.find('.s-item__location').text().trim();
                const imageUrl = $item.find('.s-item__image-img').attr('src');

                // Get listing type (Auction/Buy It Now)
                let listingType = 'Unknown';
                const buyItNow = $item.find('.s-item__purchase-options').text().includes('Buy It Now');
                const auction = $item.find('.s-item__bids').length > 0;
                if (buyItNow && auction) {
                    listingType = 'Auction with Buy It Now';
                } else if (buyItNow) {
                    listingType = 'Buy It Now';
                } else if (auction) {
                    listingType = 'Auction';
                }

                // Get shipping info
                const shipping = $item.find('.s-item__shipping').text().trim();
                
                // Get time left for auctions
                const timeLeft = $item.find('.s-item__time-left').text().trim();
                
                // Get number of bids for auctions
                const bids = $item.find('.s-item__bids').text().trim();
                
                // Get item specifics if available
                const specifics = [];
                $item.find('.s-item__details').each((_, detail) => {
                    const text = $(detail).text().trim();
                    if (text) {
                        specifics.push(text);
                    }
                });

                // Check if this is a new item
                if (itemCache.isNewItem('store', storeId, itemId)) {
                    items.push({
                        id: itemId,
                        title,
                        price,
                        condition,
                        location,
                        url: itemUrl,
                        imageUrl,
                        listingType,
                        shipping,
                        timeLeft,
                        bids,
                        specifics: specifics.join(' | ')
                    });
                }
            } catch (error) {
                console.error('Error processing item:', error.message);
            }
        });

        console.log(`${getTimestamp()} Total items found on page: ${totalItemsFound}`);
        console.log(`${getTimestamp()} New items found: ${items.length}`);

        return items;
    } catch (error) {
        console.error(`${getTimestamp()} Error fetching store items:`, error.message);
        if (error.response) {
            console.error(`${getTimestamp()} Response status:`, error.response.status);
            console.error(`${getTimestamp()} Response headers:`, error.response.headers);
        }
        return [];
    }
}

async function checkEbaySearchScraping(url) {
    try {
        console.log(`${getTimestamp()} Fetching search results from: ${url}`);
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
                const title = cleanTitle($item.find('.s-item__title').text());
                const price = $item.find('.s-item__price').text().trim();
                const condition = $item.find('.SECONDARY_INFO').text().trim();
                const location = $item.find('.s-item__location').text().trim();
                const imageUrl = $item.find('.s-item__image-img').attr('src');

                // Get listing type (Auction/Buy It Now)
                let listingType = 'Unknown';
                const buyItNow = $item.find('.s-item__purchase-options').text().includes('Buy It Now');
                const auction = $item.find('.s-item__bids').length > 0;
                if (buyItNow && auction) {
                    listingType = 'Auction with Buy It Now';
                } else if (buyItNow) {
                    listingType = 'Buy It Now';
                } else if (auction) {
                    listingType = 'Auction';
                }

                // Get shipping info
                const shipping = $item.find('.s-item__shipping').text().trim();
                
                // Get time left for auctions
                const timeLeft = $item.find('.s-item__time-left').text().trim();
                
                // Get number of bids for auctions
                const bids = $item.find('.s-item__bids').text().trim();
                
                // Get item specifics if available
                const specifics = [];
                $item.find('.s-item__details').each((_, detail) => {
                    const text = $(detail).text().trim();
                    if (text) {
                        specifics.push(text);
                    }
                });

                // Check if this is a new item
                if (itemCache.isNewItem('search', url, itemId)) {
                    items.push({
                        id: itemId,
                        title,
                        price,
                        condition,
                        location,
                        url: itemUrl,
                        imageUrl,
                        listingType,
                        shipping,
                        timeLeft,
                        bids,
                        specifics: specifics.join(' | ')
                    });
                }
            } catch (error) {
                console.error('Error processing item:', error.message);
            }
        });

        console.log(`${getTimestamp()} Total items found on page: ${totalItemsFound}`);
        console.log(`${getTimestamp()} New items found: ${items.length}`);
        return items;
    } catch (error) {
        console.error('Error fetching search results:', error.message);
        return [];
    }
}

// Add this helper function at the top of the file after the imports
function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function startMonitoring() {
    console.log(`${getTimestamp()} Starting eBay scanner with ${config.stores.length} stores and ${config.searches.length} searches`);
    console.log(`${getTimestamp()} Using web scraping method`);

    // Schedule store checks
    config.stores.forEach(store => {
        if (store.enabled) {
            const interval = store.interval || 5; // Default to 5 minutes if not specified
            console.log(`${getTimestamp()} Scheduling store ${store.name} to check every ${interval} minutes`);
            
            // Run initial scan
            console.log(`${getTimestamp()} Running initial scan for store ${store.name}`);
            const initialDelay = getRandomDelay(1, 15);
            console.log(`${getTimestamp()} Waiting ${initialDelay} seconds before initial store scan`);
            setTimeout(() => {
                checkEbayStore(store);
                // Schedule next scan after this one completes
                scheduleNextStoreScan(store, interval);
            }, initialDelay * 1000);
        }
    });

    // Schedule search checks
    config.searches.forEach(search => {
        if (search.enabled) {
            const interval = search.interval || 5; // Default to 5 minutes if not specified
            console.log(`${getTimestamp()} Scheduling search ${search.name} to check every ${interval} minutes`);
            
            // Run initial scan
            console.log(`${getTimestamp()} Running initial scan for search ${search.name}`);
            const initialDelay = getRandomDelay(1, 15);
            console.log(`${getTimestamp()} Waiting ${initialDelay} seconds before initial search scan`);
            setTimeout(() => {
                checkEbaySearch(search);
                // Schedule next scan after this one completes
                scheduleNextSearchScan(search, interval);
            }, initialDelay * 1000);
        }
    });
}

function scheduleNextStoreScan(store, interval) {
    const delay = getRandomDelay(1, 15);
    const nextScanTime = new Date(Date.now() + (interval * 60 * 1000) + (delay * 1000));
    console.log(`${getTimestamp()} Next store scan scheduled for ${nextScanTime.toLocaleTimeString()} (${interval} minutes plus ${delay} seconds from now)`);
    
    setTimeout(() => {
        isFirstRun = false;
        checkEbayStore(store);
        // Schedule the next scan after this one completes
        scheduleNextStoreScan(store, interval);
    }, (interval * 60 * 1000) + (delay * 1000));
}

function scheduleNextSearchScan(search, interval) {
    const delay = getRandomDelay(1, 15);
    const nextScanTime = new Date(Date.now() + (interval * 60 * 1000) + (delay * 1000));
    console.log(`${getTimestamp()} Next search scan scheduled for ${nextScanTime.toLocaleTimeString()} (${interval} minutes plus ${delay} seconds from now)`);
    
    setTimeout(() => {
        isFirstRun = false;
        checkEbaySearch(search);
        // Schedule the next scan after this one completes
        scheduleNextSearchScan(search, interval);
    }, (interval * 60 * 1000) + (delay * 1000));
}

// Start the monitoring
startMonitoring();

// Add this helper function at the top of the file after the imports
function cleanTitle(title) {
    return title
        .replace(/^New Listing/i, '')
        .replace(/^New/i, '')
        .replace(/^Hot/i, '')
        .replace(/^Best Match/i, '')
        .replace(/^Shop on eBay/i, '')
        .trim();
}

async function sendDiscordNotification(target, item) {
    try {
        console.log(`${getTimestamp()} Sending notification for item: ${item.title}`);
        
        // Get the webhook configuration
        const webhookConfig = config.webhooks.find(w => w.name === target.webhook);
        if (!webhookConfig) {
            console.error(`${getTimestamp()} Webhook "${target.webhook}" not found in configuration`);
            return;
        }

        console.log(`${getTimestamp()} Using webhook: ${webhookConfig.url}`);

        const embed = {
            title: item.title,
            url: item.url,
            color: 0x00ff00,
            fields: [
                {
                    name: 'Price',
                    value: item.price,
                    inline: true
                },
                {
                    name: 'Condition',
                    value: item.condition || 'Not specified',
                    inline: true
                },
                {
                    name: 'Location',
                    value: item.location || 'Not specified',
                    inline: true
                },
                {
                    name: 'Listing Type',
                    value: item.listingType || 'Not specified',
                    inline: true
                }
            ],
            thumbnail: {
                url: item.imageUrl
            },
            footer: {
                text: `New item found from ${target.name}`
            },
            timestamp: new Date().toISOString()
        };

        // Add shipping info if available
        if (item.shipping) {
            embed.fields.push({
                name: 'Shipping',
                value: item.shipping,
                inline: true
            });
        }

        // Add time left for auctions
        if (item.timeLeft) {
            embed.fields.push({
                name: 'Time Left',
                value: item.timeLeft,
                inline: true
            });
        }

        // Add bids for auctions
        if (item.bids) {
            embed.fields.push({
                name: 'Bids',
                value: item.bids,
                inline: true
            });
        }

        // Add item specifics if available
        if (item.specifics) {
            embed.fields.push({
                name: 'Details',
                value: item.specifics,
                inline: false
            });
        }

        const message = {
            content: `🔔 New item found in ${target.name}!`,
            embeds: [embed]
        };

        const response = await axios.post(webhookConfig.url, message);
        if (response.status === 204) {
            console.log(`${getTimestamp()} Discord notification sent successfully`);
        } else {
            console.error(`${getTimestamp()} Unexpected response from Discord:`, response.status);
        }

        // Wait 2 seconds before sending next notification
        console.log(`${getTimestamp()} Waiting 2 seconds before next notification...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
        if (error.response && error.response.status === 429) {
            const retryAfter = error.response.headers['retry-after'] || 5;
            console.log(`${getTimestamp()} Rate limited by Discord. Waiting ${retryAfter} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return sendDiscordNotification(target, item); // Retry once
        }
        console.error(`${getTimestamp()} Error sending Discord notification:`, error.message);
    }
} 