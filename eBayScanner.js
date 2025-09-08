require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const ItemCache = require('./item-cache');
const usageStats = require('./usage-stats');

// Initialize eBay API configuration
const hasEbayApiToken = process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID && process.env.EBAY_DEV_ID;
const ebayApiConfig = hasEbayApiToken ? {
    headers: {
        'X-EBAY-API-IAF-TOKEN': process.env.EBAY_OAUTH_TOKEN,
        'X-EBAY-API-APP-ID': process.env.EBAY_APP_ID,
        'X-EBAY-API-CERT-ID': process.env.EBAY_CERT_ID,
        'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKPLACE-ID': 'EBAY_CA',
        'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=CA'
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
        const storeId = store.url.split('/str/')[1].split('/')[0];
        const url = `https://www.ebay.ca/sch/i.html?_nkw=&_sacat=0&_sop=10&_dmd=2&_ipg=200&_ssn=${storeId}`;
        console.log(`${getTimestamp()} 🏪 Scanning store: ${store.name}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];

        // Check for protection/error pages
        if (response.data.includes('Pardon Our Interruption') || response.data.includes('Checking your browser')) {
            console.log(`${getTimestamp()} ⚠️ Bot protection detected for store ${store.name}`);
        }

        let storeItemIndex = 0;
        
        // Try multiple selectors as eBay has changed their structure
        const storeSelectors = [
            'ul.srp-results li.s-item',
            '.srp-river-results li.s-item', 
            'ul.srp-results li.s-card',
            '.srp-river-results li.s-card',
            '.s-item'  // fallback to original
        ];
        
        let storeItemElements = $();
        for (const selector of storeSelectors) {
            const elements = $(selector);
            if (elements.length > 0) {
                storeItemElements = elements;
                break;
            }
        }
        
        storeItemElements.each((_, element) => {
            storeItemIndex++;
            const $item = $(element);
            
            // Try multiple title selectors for different eBay structures
            let title = $item.find('.s-item__title').text().trim() || 
                       $item.find('.s-card__image img').attr('alt') || 
                       $item.find('img').attr('alt') || 
                       $item.find('h3').text().trim() || '';
            
            if (title === 'Shop on eBay') {
                return;
            }

            // Try multiple selectors for different eBay structures
            const price = $item.find('.s-item__price').text().trim() || 
                         $item.find('.notranslate').text().trim() || '';
            
            const url = $item.find('a.s-item__link').attr('href') || 
                       $item.find('a').first().attr('href') || '';
            
            const imageUrl = $item.find('.s-item__image-img').attr('src') || 
                            $item.find('img').attr('src') || '';
            
            const condition = $item.find('.SECONDARY_INFO').text().trim() || 
                             $item.find('.clipped').text().trim() || '';
            
            const shipping = $item.find('.s-item__shipping').text().trim() || '';
            const location = $item.find('.s-item__location').text().trim() || '';
            const bids = $item.find('.s-item__bids').text().trim() || '';
            const timeLeft = $item.find('.s-item__time-left').text().trim() || '';
            
            const itemId = url ? url.split('/itm/')[1]?.split('?')[0] || '' : '';
            
            if (itemId && title) {
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

        console.log(`${getTimestamp()} ✅ Store ${store.name}: ${items.length} items scanned, ${newItems} new found`);
        if (isFirstRun && newItems > 2) {
            console.log(`${getTimestamp()} 📢 Limited notifications to 2 items on first run`);
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
        const url = search.url;
        console.log(`${getTimestamp()} 🔍 Scanning search: ${search.name}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Referer': 'https://www.ebay.ca/'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];

        // Check for protection/error pages
        if (response.data.includes('Pardon Our Interruption') || response.data.includes('Checking your browser')) {
            console.log(`${getTimestamp()} ⚠️ Bot protection detected for search: ${search.name}`);
        }
        
        let itemIndex = 0;
        
        // Try multiple selectors as eBay has changed their structure
        const selectors = [
            'ul.srp-results li.s-item',
            '.srp-river-results li.s-item', 
            'ul.srp-results li.s-card',
            '.srp-river-results li.s-card',
            '.s-item'  // fallback to original
        ];
        
        let itemElements = $();
        for (const selector of selectors) {
            const elements = $(selector);
            if (elements.length > 0) {
                itemElements = elements;
                break;
            }
        }
        
        itemElements.each((_, element) => {
            itemIndex++;
            const $item = $(element);
            
            // Try multiple title selectors for different eBay structures
            let title = $item.find('.s-item__title').text().trim() || 
                       $item.find('.s-card__image img').attr('alt') || 
                       $item.find('img').attr('alt') || 
                       $item.find('h3').text().trim() || '';
            
            if (title === 'Shop on eBay') {
                return;
            }

            // Try multiple selectors for different eBay structures
            const price = $item.find('.s-item__price').text().trim() || 
                         $item.find('.notranslate').text().trim() || '';
            
            const url = $item.find('a.s-item__link').attr('href') || 
                       $item.find('a').first().attr('href') || '';
            
            const imageUrl = $item.find('.s-item__image-img').attr('src') || 
                            $item.find('img').attr('src') || '';
            
            const condition = $item.find('.SECONDARY_INFO').text().trim() || 
                             $item.find('.clipped').text().trim() || '';
            
            const shipping = $item.find('.s-item__shipping').text().trim() || '';
            const location = $item.find('.s-item__location').text().trim() || '';
            const bids = $item.find('.s-item__bids').text().trim() || '';
            const timeLeft = $item.find('.s-item__time-left').text().trim() || '';
            
            const itemId = url ? url.split('/itm/')[1]?.split('?')[0] || '' : '';
            
            if (itemId && title) {
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

        // Sort items by listing date (newest first)
        items.sort((a, b) => {
            const dateA = new Date(a.timeLeft);
            const dateB = new Date(b.timeLeft);
            return dateB - dateA;
        });

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

        console.log(`${getTimestamp()} ✅ Search ${search.name}: ${items.length} items scanned, ${newItems} new found`);
        if (isFirstRun && newItems > 2) {
            console.log(`${getTimestamp()} 📢 Limited notifications to 2 items on first run`);
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

// Helper to extract seller name from store URL
function getSellerNameFromStoreUrl(url) {
    // Example: https://www.ebay.ca/str/surplusbydesign
    const match = url.match(/\/str\/([^/?]+)/i);
    return match ? match[1] : null;
}

// Helper to extract search keywords from search URL
function getSearchParamsFromUrl(url) {
    try {
        const u = new URL(url);
        const params = {};
        if (u.searchParams.get('_nkw')) params.q = u.searchParams.get('_nkw');
        // Add more param extraction as needed
        return params;
    } catch {
        return {};
    }
}

// Updated checkStoreListings
async function checkStoreListings(store) {
    if (hasEbayApiToken) {
        return await checkEbayStoreAPI(store);
    } else {
        return await checkEbayStore(store);
    }
}

// Updated checkSearchListings
async function checkSearchListings(search) {
    if (hasEbayApiToken) {
        // Use the search URL directly from the config
        return await checkEbaySearchAPI(search);
    } else {
        return await checkEbaySearch(search);
    }
}

// Modify token validation
function validateEbayToken() {
    if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID || !process.env.EBAY_DEV_ID) {
        console.log('Missing required eBay API credentials');
        return false;
    }

    if (!process.env.EBAY_OAUTH_TOKEN) {
        console.log('No eBay API token found');
        return false;
    }

    // For Browse API, we need to ensure the token is in the correct format
    const token = process.env.EBAY_OAUTH_TOKEN;
    if (!token.startsWith('v^')) {
        console.log('Invalid eBay API token format. Token should start with v^');
        return false;
    }

    return true;
}

// Add this new function after getEbayToken
async function getDefaultCategory(searchQuery) {
    try {
        const token = await getEbayToken();
        
        // First get the category tree ID for eBay Canada
        const treeResponse = await axios.get(
            'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id',
            {
                params: { marketplace_id: 'EBAY_CA' },
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const treeId = treeResponse.data.categoryTreeId;
        console.log(`${getTimestamp()} Got category tree ID: ${treeId}`);

        // Then get category suggestions for the search query
        const suggestionsResponse = await axios.get(
            `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions`,
            {
                params: { q: searchQuery },
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`${getTimestamp()} Category suggestions:`, JSON.stringify(suggestionsResponse.data, null, 2));

        // Get the first (most relevant) category suggestion
        if (suggestionsResponse.data.categorySuggestions && 
            suggestionsResponse.data.categorySuggestions.length > 0) {
            const category = suggestionsResponse.data.categorySuggestions[0].category;
            console.log(`${getTimestamp()} Selected category:`, category);
            return category.categoryId;
        }

        return null;
    } catch (error) {
        console.error('Error getting default category:', error.message);
        if (error.response) {
            console.error('Category API Response:', error.response.data);
        }
        return null;
    }
}

// Update the checkEbaySearchAPI function to use the default category
async function checkEbaySearchAPI(search) {
    if (!validateEbayToken()) {
        return await checkEbaySearchScraping(search.url);
    }
    try {
        const token = await getEbayToken();
        console.log(`${getTimestamp()} Using category ID: ${search.categoryId}`);

        // Build filter array
        const filterArray = [
            'buyingOptions:{FIXED_PRICE|AUCTION}'
        ];
        
        // Add default delivery country only if not specified in custom filters
        let hasDeliveryCountryFilter = false;
        if (search.filters && search.filters.length > 0) {
            hasDeliveryCountryFilter = search.filters.some(filter => filter.type === '3');
        }
        if (!hasDeliveryCountryFilter) {
            filterArray.push('itemLocationCountry:CA');
        }

        // Add price filters if specified
        if (search.minPrice) {
            filterArray.push(`price:[${search.minPrice}..]`);
        }
        if (search.maxPrice) {
            filterArray.push(`price:[..${search.maxPrice}]`);
        }

        // Add additional filters - convert from config format to API format
        if (search.filters && search.filters.length > 0) {
            for (const filter of search.filters) {
                let filterString = '';
                switch (filter.type) {
                    case '1': // Condition
                        filterString = `conditions:{${filter.value}}`;
                        break;
                    case '2': // Buying Options
                        filterString = `buyingOptions:{${filter.value}}`;
                        break;
                    case '3': // Location (Item Location)
                        filterString = `itemLocationCountry:${filter.value}`;
                        break;
                    case '4': // Free Shipping
                        if (filter.value === 'true') {
                            filterString = 'maxDeliveryCost:0';
                        }
                        break;
                    case '5': // Returns Accepted
                        filterString = `returnsAccepted:${filter.value}`;
                        break;
                }
                if (filterString) {
                    filterArray.push(filterString);
                }
            }
        }

        // Log the full filter string for debugging
        console.log(`${getTimestamp()} Full filter string:`, filterArray.join(','));

        const searchParams = {
            'q': search.searchTerm,
            'sort': 'newlyListed',
            'limit': 200,
            'filter': filterArray.join(',')
        };

        // Add category ID as a separate query parameter if specified
        if (search.categoryId) {
            // Validate category ID format
            if (!/^\d+$/.test(search.categoryId)) {
                console.error(`${getTimestamp()} Invalid category ID format: ${search.categoryId}`);
            } else {
                searchParams.category_ids = search.categoryId;
            }
        }

        console.log(`${getTimestamp()} Making API request with params:`, {
            q: search.searchTerm,
            sort: 'newlyListed',
            limit: 200,
            filter: filterArray.join(',')
        });

        const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
            params: searchParams,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_CA',
                'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=CA'
            }
        });

        // Only log essential response info
        console.log(`${getTimestamp()} API Response Status: ${response.status}`);
        console.log(`${getTimestamp()} Total items found: ${response.data.total}`);
        
        if (response.data.warnings) {
            console.log(`${getTimestamp()} API Warnings:`, response.data.warnings.map(w => w.message).join(', '));
        }

        if (!response.data || (!response.data.itemSummaries && response.data.total > 0)) {
            console.error(`${getTimestamp()} Invalid API response format. Response data:`, response.data);
            await sendDiscordErrorNotification(
                'eBay API Error', 
                `Invalid API response format for search "${search.name}" - missing itemSummaries but total > 0`,
                response.data
            );
            return { newItems: 0, notifiedItems: 0 };
        }

        // Handle case where there are no items (total: 0)
        if (!response.data.itemSummaries || response.data.itemSummaries.length === 0) {
            console.log(`${getTimestamp()} No items found for search "${search.name}" (total: ${response.data.total})`);
            return { newItems: 0, notifiedItems: 0 };
        }

        const items = response.data.itemSummaries;
        let newItems = 0;
        let notifiedItems = 0;
        const newItemsList = [];

        // First, collect all new items
        for (const item of items) {
            if (itemCache.isNewItem('search', search.name, item.itemId)) {
                newItems++;
                
                // Extract shipping cost
                let shippingCost = 'N/A';
                if (item.shippingOptions && item.shippingOptions.length > 0) {
                    const shippingOption = item.shippingOptions[0];
                    if (shippingOption.shippingCost) {
                        if (shippingOption.shippingCost.value === '0.00') {
                            shippingCost = 'Free';
                        } else {
                            shippingCost = `${shippingOption.shippingCost.value} ${shippingOption.shippingCost.currency || 'CAD'}`;
                        }
                    }
                }
                
                // Extract price
                let price = 'N/A';
                let currency = 'CAD';
                if (item.price && item.price.value) {
                    price = `${item.price.value} ${item.price.currency || 'CAD'}`;
                    currency = item.price.currency || 'CAD';
                } else if (item.currentBidPrice && item.currentBidPrice.value) {
                    price = `${item.currentBidPrice.value} ${item.currentBidPrice.currency || 'CAD'} (Current Bid)`;
                    currency = item.currentBidPrice.currency || 'CAD';
                }

                // Extract listing type and bids
                let listingType = 'Unknown';
                let bids = 'N/A';
                if (item.buyingOptions && item.buyingOptions.length > 0) {
                    listingType = item.buyingOptions[0];
                }
                if (item.bidCount !== undefined) {
                    bids = item.bidCount.toString();
                }

                const processedItem = {
                    id: item.itemId,
                    title: item.title,
                    price: price,
                    currency: currency,
                    url: item.itemWebUrl,
                    imageUrl: item.image?.imageUrl,
                    condition: item.condition,
                    location: item.itemLocation?.country,
                    shipping: shippingCost,
                    listingType: listingType,
                    bids: bids,
                    itemEndDate: item.itemEndDate,
                    itemCreationDate: item.itemCreationDate
                };
                
                newItemsList.push(processedItem);
            }
        }

        // Then, send notifications in order
        if (newItems > 0) {
            console.log(`${getTimestamp()} Found ${newItems} new items for search "${search.name}"`);
            
            // Send notifications for the first 2 items or all items if not first run
            const itemsToNotify = isFirstRun ? newItemsList.slice(0, 2) : newItemsList;
            
            for (const item of itemsToNotify) {
                await sendDiscordNotification(search, item);
                notifiedItems++;
            }

            if (isFirstRun && newItems > 2) {
                console.log(`${getTimestamp()} Note: ${newItems - 2} additional new items found but not notified to prevent spam`);
            }
        } else {
            console.log(`${getTimestamp()} No new items found for search "${search.name}"`);
        }

        return newItemsList;

    } catch (error) {
        console.error('Error using eBay API:', error.message);
        if (error.response) {
            console.error('API Response Status:', error.response.status);
            console.error('API Response Headers:', error.response.headers);
        }
        throw error;
    }
}

async function checkEbayStoreAPI(store) {
    try {
        const token = await getEbayToken();
        console.log(`${getTimestamp()} Checking store "${store.name}" using eBay API`);

        // Get store name based on store type
        let storeName;
        if (store.type === 'api') {
            storeName = store.storeId;
        } else {
            // Extract store name from URL for URL-based stores
            storeName = store.url.split('/str/')[1]?.split('?')[0] || store.url.split('_ssn=')[1]?.split('&')[0];
        }
        
        if (!storeName) {
            console.error(`Could not determine store name for store: ${store.name}`);
            return [];
        }

        // Log the API request details
        console.log(`${getTimestamp()} Making API request for store: ${storeName}`);
        
        // Search parameters for Canadian marketplace
        const searchParams = {
            'q': ' ',
            'sort': 'newlyListed',
            'sort_order': 'DESCENDING',
            'limit': 200,
            'filter': [
                'conditions:{NEW|USED}',
                'deliveryCountry:CA',
                'sellers:{' + storeName + '}',
                'buyingOptions:{FIXED_PRICE|AUCTION}',
                'priceCurrency:CAD'
            ].join(',')
        };

        const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
            params: searchParams,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_CA',
                'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=CA'
            }
        });

        // Only log essential response info
        console.log(`${getTimestamp()} API Response Status:`, response.status);
        console.log(`${getTimestamp()} Total items found: ${response.data.total}`);

        if (!response.data || (!response.data.itemSummaries && response.data.total > 0)) {
            console.error(`${getTimestamp()} Invalid API response format. Response data:`, response.data);
            await sendDiscordErrorNotification(
                'eBay API Error', 
                `Invalid API response format for store "${store.name}" - missing itemSummaries but total > 0`,
                response.data
            );
            return { newItems: 0, notifiedItems: 0 };
        }

        // Handle case where there are no items (total: 0)
        if (!response.data.itemSummaries || response.data.itemSummaries.length === 0) {
            console.log(`${getTimestamp()} No items found for store "${store.name}" (total: ${response.data.total})`);
            return { newItems: 0, notifiedItems: 0 };
        }

        const items = response.data.itemSummaries;
        let newItems = 0;
        let notifiedItems = 0;
        const newItemsList = [];

        // First, collect all new items
        for (const item of items) {
            if (itemCache.isNewItem('store', store.name, item.itemId)) {
                newItems++;
                
                // Extract shipping cost
                let shippingCost = 'N/A';
                if (item.shippingOptions && item.shippingOptions.length > 0) {
                    const shippingOption = item.shippingOptions[0];
                    if (shippingOption.shippingCost) {
                        if (shippingOption.shippingCost.value === '0.00') {
                            shippingCost = 'Free';
                        } else {
                            shippingCost = `${shippingOption.shippingCost.value} ${shippingOption.shippingCost.currency || 'CAD'}`;
                        }
                    }
                }
                
                // Extract price
                let price = 'N/A';
                let currency = 'CAD';
                if (item.price && item.price.value) {
                    price = `${item.price.value} ${item.price.currency || 'CAD'}`;
                    currency = item.price.currency || 'CAD';
                } else if (item.currentBidPrice && item.currentBidPrice.value) {
                    price = `${item.currentBidPrice.value} ${item.currentBidPrice.currency || 'CAD'} (Current Bid)`;
                    currency = item.currentBidPrice.currency || 'CAD';
                }

                // Extract listing type and bids
                let listingType = 'Unknown';
                let bids = 'N/A';
                if (item.buyingOptions && item.buyingOptions.length > 0) {
                    listingType = item.buyingOptions[0];
                }
                if (item.bidCount !== undefined) {
                    bids = item.bidCount.toString();
                }

                const processedItem = {
                    id: item.itemId,
                    title: item.title,
                    price: price,
                    currency: currency,
                    url: item.itemWebUrl,
                    imageUrl: item.image?.imageUrl,
                    condition: item.condition,
                    location: item.itemLocation?.country,
                    shipping: shippingCost,
                    listingType: listingType,
                    bids: bids,
                    itemEndDate: item.itemEndDate,
                    itemCreationDate: item.itemCreationDate
                };
                
                newItemsList.push(processedItem);
            }
        }

        // Then, send notifications in order
        if (newItems > 0) {
            console.log(`${getTimestamp()} Found ${newItems} new items for store "${store.name}"`);
            
            // Send notifications for the first 2 items or all items if not first run
            const itemsToNotify = isFirstRun ? newItemsList.slice(0, 2) : newItemsList;
            
            for (const item of itemsToNotify) {
                await sendDiscordNotification(store, item);
                notifiedItems++;
            }

            if (isFirstRun && newItems > 2) {
                console.log(`${getTimestamp()} Note: ${newItems - 2} additional new items found but not notified to prevent spam`);
            }
        } else {
            console.log(`${getTimestamp()} No new items found for store "${store.name}"`);
        }

        return newItemsList;

    } catch (error) {
        console.error('Error using eBay API:', error.message);
        if (error.response) {
            console.error('API Response Status:', error.response.status);
            console.error('API Response Headers:', error.response.headers);
        }
        throw error;
    }
}

// Add function to get a fresh token
async function getEbayToken() {
    try {
        const tokenUrl = process.env.EBAY_SANDBOX === 'true'
            ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
            : 'https://api.ebay.com/identity/v1/oauth2/token';

        const credentials = Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`).toString('base64');

        const response = await axios.post(tokenUrl, 
            'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                }
            }
        );

        return response.data.access_token;
    } catch (error) {
        console.error('Error getting eBay token:', error.message);
        if (error.response) {
            console.error('Token Response Status:', error.response.status);
            console.error('Token Response Data:', error.response.data);
        }
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];
        let totalItemsFound = 0;

        // Try multiple selectors for item containers - Updated for current eBay structure
        const itemSelectors = [
            'ul.srp-results li.s-card',           // Current eBay structure
            '.srp-river-results li.s-card',       // Alternative current structure  
            'ul.srp-results li.s-item',           // Legacy structure
            '.s-item',                            // Legacy structure
            '.srp-result', 
            '[data-view="mi:1686"]', 
            '.s-item__wrapper'
        ];
        let itemsFoundWithSelector = false;
        
        for (const selector of itemSelectors) {
            const elements = $(selector);
            if (elements.length > 0) {
                itemsFoundWithSelector = true;
                
                elements.each((_, element) => {
                    try {
                        const $item = $(element);
                        totalItemsFound++;
                        
                        // Extract title from s-card__image alt attribute (confirmed working structure)
                        let title = $item.find('.s-card__image').attr('alt') || 
                                   $item.find('img').first().attr('alt') || '';
                        if (!title || title === 'Shop on eBay') {
                            return;
                        }

                        // Extract item ID from data-listing-id attribute or URL
                        let itemId = $item.attr('data-listing-id');
                        
                        // Extract URL from /itm/ link (confirmed working)
                        const itemUrl = $item.find('a[href*="/itm/"]').first().attr('href');
                        if (!itemUrl) {
                            return;
                        }
                        
                        // If no data-listing-id, try to get it from the URL
                        if (!itemId) {
                            itemId = itemUrl.split('/itm/')[1]?.split('?')[0] || itemUrl.match(/\/(\d+)(\?|$)/)?.[1] || '';
                        }

                        // Skip items without valid IDs
                        if (!itemId) {
                            return;
                        }

                        // Extract other item details with multiple selectors
                        title = cleanTitle(title);
                        const price = $item.find('.s-item__price, .notranslate, .u-flL.condText, .s-card__price, .s-card__price span').first().text().trim();
                        const condition = $item.find('.SECONDARY_INFO, .s-item__subtitle, .cldt').first().text().trim();
                        const location = $item.find('.s-item__location, .s-item__itemLocation, .lvdetails').first().text().trim();
                        const imageUrl = $item.find('.s-card__image').attr('src') || 
                                        $item.find('img').first().attr('src') ||
                                        $item.find('img').first().attr('data-src');

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
                        const shipping = $item.find('.s-item__shipping, .s-item__logisticsCost, .vi-acc-del-range').first().text().trim();
                        
                        // Get time left for auctions
                        const timeLeft = $item.find('.s-item__time-left, .s-item__timeLeft, .timeMs').first().text().trim();
                        
                        // Get number of bids for auctions
                        const bids = $item.find('.s-item__bids, .s-item__bidCount, .bidsold').first().text().trim();
                
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
                
                // Break after finding items with the first working selector
                break;
            }
        }
        
        if (!itemsFoundWithSelector) {
            console.log(`${getTimestamp()} No items found with any selector. eBay structure may have changed.`);
        }

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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        const $ = cheerio.load(response.data);
        const items = [];
        let totalItemsFound = 0;

        // Try multiple selectors for item containers - Updated for current eBay structure
        const itemSelectors = [
            'ul.srp-results li.s-card',           // Current eBay structure
            '.srp-river-results li.s-card',       // Alternative current structure  
            'ul.srp-results li.s-item',           // Legacy structure
            '.s-item',                            // Legacy structure
            '.srp-result', 
            '[data-view="mi:1686"]', 
            '.s-item__wrapper'
        ];
        let itemsFoundWithSelector = false;
        
        for (const selector of itemSelectors) {
            const elements = $(selector);
            if (elements.length > 0) {
                itemsFoundWithSelector = true;
                
                elements.each((_, element) => {
                    try {
                        const $item = $(element);
                        totalItemsFound++;
                        
                        // Extract title from s-card__image alt attribute (confirmed working structure)
                        let title = $item.find('.s-card__image').attr('alt') || 
                                   $item.find('img').first().attr('alt') || '';
                        if (!title || title === 'Shop on eBay') {
                            return;
                        }

                        // Extract item ID from data-listing-id attribute or URL
                        let itemId = $item.attr('data-listing-id');
                        
                        // Extract URL from /itm/ link (confirmed working)
                        const itemUrl = $item.find('a[href*="/itm/"]').first().attr('href');
                        if (!itemUrl) {
                            return;
                        }
                        
                        // If no data-listing-id, try to get it from the URL
                        if (!itemId) {
                            itemId = itemUrl.split('/itm/')[1]?.split('?')[0] || itemUrl.match(/\/(\d+)(\?|$)/)?.[1] || '';
                        }

                        // Skip items without valid IDs
                        if (!itemId) {
                            return;
                        }

                        // Extract other item details with multiple selectors
                        title = cleanTitle(title);
                        const price = $item.find('.s-item__price, .notranslate, .u-flL.condText, .s-card__price, .s-card__price span').first().text().trim();
                        const condition = $item.find('.SECONDARY_INFO, .s-item__subtitle, .cldt').first().text().trim();
                        const location = $item.find('.s-item__location, .s-item__itemLocation, .lvdetails').first().text().trim();
                        const imageUrl = $item.find('.s-card__image').attr('src') || 
                                        $item.find('img').first().attr('src') ||
                                        $item.find('img').first().attr('data-src');

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
                        const shipping = $item.find('.s-item__shipping, .s-item__logisticsCost, .vi-acc-del-range').first().text().trim();
                        
                        // Get time left for auctions
                        const timeLeft = $item.find('.s-item__time-left, .s-item__timeLeft, .timeMs').first().text().trim();
                        
                        // Get number of bids for auctions
                        const bids = $item.find('.s-item__bids, .s-item__bidCount, .bidsold').first().text().trim();
                
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
                
                // Break after finding items with the first working selector
                break;
            }
        }
        
        if (!itemsFoundWithSelector) {
            console.log(`${getTimestamp()} No items found with any selector. eBay structure may have changed.`);
        }

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
    // Reset isFirstRun to true when bot starts/restarts
    isFirstRun = true;
    const apiMode = hasEbayApiToken;
    
    console.log(`\n🚀 eBayScanner Starting...`);
    console.log(`📊 Monitoring: ${config.stores.length} stores, ${config.searches.length} searches`);
    console.log(`🔧 Method: ${apiMode ? 'eBay API' : 'Web Scraping'}`);
    console.log(`⏰ Started at ${getTimestamp()}\n`);

    // Filter stores and searches by type
    const storesToScan = config.stores.filter(store => 
        apiMode ? store.type === 'api' : store.type !== 'api'
    );
    const searchesToScan = config.searches.filter(search => 
        apiMode ? search.type === 'api' : search.type !== 'api'
    );

    // Schedule store checks
    storesToScan.forEach(store => {
        if (store.enabled) {
            const interval = store.interval || 5;
            console.log(`🏪 Store: ${store.name} (every ${interval}min)`);
            const initialDelay = getRandomDelay(1, 15);
            setTimeout(async () => {
                try {
                    await checkStoreListings(store);
                } catch (error) {
                    console.error(`${getTimestamp()} Error checking store "${store.name}":`, error.message);
                    await sendDiscordErrorNotification(
                        'Store Check Error',
                        `Failed to check store "${store.name}": ${error.message}`,
                        { storeName: store.name, error: error.stack }
                    );
                }
                scheduleNextStoreScan(store, interval);
            }, initialDelay * 1000);
        }
    });

    // Schedule search checks
    searchesToScan.forEach(search => {
        if (search.enabled) {
            const interval = search.interval || 5;
            console.log(`🔍 Search: ${search.name} (every ${interval}min)`);
            const initialDelay = getRandomDelay(1, 15);
            setTimeout(async () => {
                try {
                    await checkSearchListings(search);
                } catch (error) {
                    console.error(`${getTimestamp()} Error checking search "${search.name}":`, error.message);
                    await sendDiscordErrorNotification(
                        'Search Check Error',
                        `Failed to check search "${search.name}": ${error.message}`,
                        { searchName: search.name, error: error.stack }
                    );
                }
                scheduleNextSearchScan(search, interval);
            }, initialDelay * 1000);
        }
    });
}

function scheduleNextStoreScan(store, interval) {
    const delay = getRandomDelay(1, 15);
    const nextScanTime = new Date(Date.now() + (interval * 60 * 1000) + (delay * 1000));
    console.log(`${getTimestamp()} Next store scan scheduled for ${nextScanTime.toLocaleTimeString()} (${interval} minutes plus ${delay} seconds from now)`);
    
    setTimeout(async () => {
        isFirstRun = false;
        try {
            await checkStoreListings(store);
        } catch (error) {
            console.error(`${getTimestamp()} Error checking store "${store.name}":`, error.message);
            await sendDiscordErrorNotification(
                'Store Check Error',
                `Failed to check store "${store.name}": ${error.message}`,
                { storeName: store.name, error: error.stack }
            );
        }
        scheduleNextStoreScan(store, interval);
    }, (interval * 60 * 1000) + (delay * 1000));
}

function scheduleNextSearchScan(search, interval) {
    const delay = getRandomDelay(1, 15);
    const nextScanTime = new Date(Date.now() + (interval * 60 * 1000) + (delay * 1000));
    console.log(`${getTimestamp()} Next search scan scheduled for ${nextScanTime.toLocaleTimeString()} (${interval} minutes plus ${delay} seconds from now)`);
    
    setTimeout(async () => {
        isFirstRun = false;
        try {
            await checkSearchListings(search);
        } catch (error) {
            console.error(`${getTimestamp()} Error checking search "${search.name}":`, error.message);
            await sendDiscordErrorNotification(
                'Search Check Error',
                `Failed to check search "${search.name}": ${error.message}`,
                { searchName: search.name, error: error.stack }
            );
        }
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

async function sendDiscordErrorNotification(errorType, errorMessage, details = null) {
    try {
        console.log(`${getTimestamp()} Sending error notification: ${errorType}`);
        
        // Get webhook URL (use first available webhook)
        let webhookUrl = null;
        if (config.webhooks.length > 0) {
            webhookUrl = config.webhooks[0].url;
        } else {
            console.log(`${getTimestamp()} No webhooks configured for error notifications`);
            return;
        }

        // Create error embed
        const embed = {
            title: '🚨 eBay Scanner Error',
            color: 0xff0000, // Red color for errors
            fields: [
                {
                    name: 'Error Type',
                    value: errorType,
                    inline: true
                },
                {
                    name: 'Message',
                    value: errorMessage,
                    inline: false
                }
            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: 'eBay Scanner Error Alert'
            }
        };

        // Add details if provided
        if (details) {
            embed.fields.push({
                name: 'Details',
                value: typeof details === 'object' ? JSON.stringify(details, null, 2).substring(0, 1000) : details.toString().substring(0, 1000),
                inline: false
            });
        }

        const payload = {
            embeds: [embed]
        };

        // Send to Discord
        const response = await axios.post(webhookUrl, payload);

        if (response.status === 204) {
            console.log(`${getTimestamp()} Discord error notification sent successfully`);
        } else {
            console.error(`${getTimestamp()} Unexpected response from Discord:`, response.status);
        }
    } catch (error) {
        console.error(`${getTimestamp()} Error sending Discord error notification:`, error.message);
    }
}

async function sendDiscordNotification(search, item) {
    try {
        console.log(`${getTimestamp()} Sending notification for item: ${item.title}`);
        
        // Get webhook URL
        let webhookUrl = null;
        if (search.webhookId) {
            const webhook = config.webhooks.find(w => w.id === search.webhookId);
            if (webhook) {
                webhookUrl = webhook.url;
                console.log(`${getTimestamp()} Using webhook: ${webhookUrl}`);
            } else {
                console.log(`${getTimestamp()} Webhook "${search.webhookId}" not found in configuration`);
                return;
            }
        } else {
            // Try to use default webhook if no specific webhook is assigned
            if (config.webhooks.length > 0) {
                webhookUrl = config.webhooks[0].url;
                console.log(`${getTimestamp()} Using default webhook: ${webhookUrl}`);
            } else {
                console.log(`${getTimestamp()} No webhooks configured`);
                return;
            }
        }

        // Create embed
        const embed = {
            title: item.title,
            url: item.url,
            color: 0x00ff00,
            fields: [
                {
                    name: 'Price',
                    value: item.price,
                    inline: true
                }
            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: `New item from ${search.type === 'store' ? 'store' : 'search'} "${search.name}"`
            }
        };

        // Add condition if available
        if (item.condition) {
            embed.fields.push({
                name: 'Condition',
                value: item.condition,
                inline: true
            });
        }

        // Add shipping if available
        if (item.shipping) {
            embed.fields.push({
                name: 'Shipping',
                value: item.shipping,
                inline: true
            });
        }

        // Add location if available
        if (item.location) {
            embed.fields.push({
                name: 'Location',
                value: item.location,
                inline: true
            });
        }

        // Add listing type if available
        if (item.listingType) {
            embed.fields.push({
                name: 'Listing Type',
                value: item.listingType,
                inline: true
            });
        }

        // Add bids if available
        if (item.bids !== 'N/A') {
            embed.fields.push({
                name: 'Bids',
                value: item.bids,
                inline: true
            });
        }

        // Add end date if available
        if (item.itemEndDate) {
            const endDate = new Date(item.itemEndDate);
            embed.fields.push({
                name: 'Ends',
                value: endDate.toLocaleString(),
                inline: true
            });
        }

        // Add image if available
        if (item.imageUrl) {
            embed.image = {
                url: item.imageUrl
            };
        }

        // Send to Discord
        const response = await axios.post(webhookUrl, {
            embeds: [embed]
        });

        if (response.status === 204) {
            console.log(`${getTimestamp()} Discord notification sent successfully`);
        } else {
            console.error(`${getTimestamp()} Unexpected response from Discord:`, response.status);
        }

        // Wait 2 seconds before next notification to avoid rate limits
        console.log(`${getTimestamp()} Waiting 2 seconds before next notification...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
        console.error(`${getTimestamp()} Error sending Discord notification:`, error.message);
    }
} 
