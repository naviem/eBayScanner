const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { v4: uuidv4 } = require('uuid');
const usageStats = require('./usage-stats');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
require('dotenv').config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    underscore: '\x1b[4m',
    blink: '\x1b[5m',
    reverse: '\x1b[7m',
    hidden: '\x1b[8m',
    
    fg: {
        black: '\x1b[30m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m',
        crimson: '\x1b[38m'
    },
    bg: {
        black: '\x1b[40m',
        red: '\x1b[41m',
        green: '\x1b[42m',
        yellow: '\x1b[43m',
        blue: '\x1b[44m',
        magenta: '\x1b[45m',
        cyan: '\x1b[46m',
        white: '\x1b[47m',
        crimson: '\x1b[48m'
    }
};

function getTimestamp() {
    const now = new Date();
    return `[${now.toLocaleTimeString()}]`;
}

// Consolidate show functions into a single utility
const show = {
    success: (message) => console.log(colors.fg.green + `${getTimestamp()} ${message}` + colors.reset),
    error: (message) => console.log(colors.fg.red + `${getTimestamp()} ${message}` + colors.reset),
    info: (message) => console.log(colors.fg.cyan + `${getTimestamp()} ${message}` + colors.reset)
};

async function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        
        try {
            // Try to read the file
            const data = await fs.readFile(configPath, 'utf8');
            return JSON.parse(data);
    } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, create default config
                const defaultConfig = {
            stores: [],
                    searches: [],
                    webhooks: [],
                    settings: {
                        defaultInterval: 5,
                        defaultWebhook: null
                    }
                };
                
                // Save default config
                await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
                show.success('Created new config.json with default settings');
                return defaultConfig;
            }
            throw error; // Re-throw if it's not a "file not found" error
        }
    } catch (error) {
        show.error(`Error loading config.json: ${error.message}`);
        process.exit(1);
    }
}

async function saveConfig(config) {
    try {
        const configPath = path.join(__dirname, 'config.json');
        await fs.writeFile(configPath, JSON.stringify(config, null, 4));
        show.success('Configuration saved successfully!');
    } catch (error) {
        console.error('Error saving config:', error.message);
    }
}

async function listWebhooks(config) {
    console.log('\n' + colors.fg.yellow + `${getTimestamp()} === Webhooks ===` + colors.reset);
    if (config.webhooks.length === 0) {
        show.info('No webhooks configured');
        return;
    }
    
    config.webhooks.forEach((webhook, index) => {
        console.log(colors.fg.cyan + `\n${getTimestamp()} ${index + 1}. ${webhook.name}` + colors.reset);
        console.log(`   URL: ${webhook.url.substring(0, 30)}...`);
        console.log(`   ID: ${webhook.id}`);
        if (webhook.id === config.defaultWebhookId) {
            console.log(colors.fg.green + '   Status: Default' + colors.reset);
        }
    });
}

async function listStores(config) {
    console.log('\n=== Stores ===');
    if (config.stores.length === 0) {
        console.log('No stores configured.');
        return;
    }
    config.stores.forEach((store, index) => {
        console.log(`${index + 1}. ${store.name || '(no name)'}${store.type ? ' [' + store.type + ']' : ''}`);
        if (store.url) {
            console.log(`   URL: ${store.url}`);
        }
        if (store.storeId) {
            console.log(`   Store ID: ${store.storeId}`);
        }
        console.log(`   Status: ${store.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Interval: ${store.interval || '(default)'} minutes`);
        if (store.webhook || store.webhookId) {
            console.log(`   Webhook: ${store.webhook || store.webhookId}`);
        }
        console.log('---');
    });
}

async function listSearches(config) {
    console.log('\n=== Searches ===');
    if (config.searches.length === 0) {
        console.log('No searches configured.');
        return;
    }
    config.searches.forEach((search, index) => {
        console.log(`${index + 1}. ${search.name || '(no name)'}${search.type ? ' [' + search.type + ']' : ''}`);
        if (search.url) {
        console.log(`   URL: ${search.url}`);
        }
        if (search.searchTerm) {
            console.log(`   Search Term: ${search.searchTerm}`);
        }
        if (search.categoryId) {
            console.log(`   Category ID: ${search.categoryId}`);
        }
        if (search.categoryPath) {
            console.log(`   Category Path: ${search.categoryPath}`);
        }
        console.log(`   Status: ${search.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Interval: ${search.interval || '(default)'} minutes`);
        if (search.webhook || search.webhookId) {
            console.log(`   Webhook: ${search.webhook || search.webhookId}`);
        }
        console.log('---');
    });
}

// Helper function to extract store ID from URL
function extractStoreId(url) {
    try {
        // Remove any trailing slashes and get the last part of the URL
        const cleanUrl = url.replace(/\/$/, '');
        const storeId = cleanUrl.split('/').pop();
        return storeId;
    } catch (error) {
        return null;
    }
}

async function addStore() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Add New Store ===');
    
    // Get store URL or ID
    const storeInput = await question('Enter store URL or ID (e.g., https://www.ebay.ca/str/surplusbydesign or surplusbydesign): ');
    if (!storeInput) {
        console.log('Store URL/ID is required');
        return;
    }

    // Get check interval
    const intervalInput = await question('Enter check interval in minutes (default: 5): ');
    let interval = intervalInput ? parseInt(intervalInput) : 5;
    if (isNaN(interval) || interval < 1) {
        console.log('Invalid interval. Using default of 5 minutes.');
        interval = 5;
    }

    // Get webhook assignment
    console.log('\nAvailable webhooks:');
    config.webhooks.forEach((webhook, index) => {
        console.log(`${index + 1}. ${webhook.name} (${webhook.url.substring(0, 30)}...)`);
    });
    
    const webhookChoice = await question('Choose webhook number (press Enter for default): ');
    let webhookId = null;
    
    if (webhookChoice) {
        const webhookIndex = parseInt(webhookChoice) - 1;
        if (webhookIndex >= 0 && webhookIndex < config.webhooks.length) {
            webhookId = config.webhooks[webhookIndex].id;
        }
    }

    // Add the store
    const store = {
        id: storeInput,
        name: storeInput.split('/').pop().split('?')[0], // Extract name from URL or use ID
        interval,
        enabled: true,
        webhookId
    };

    config.stores.push(store);
    await saveConfig(config);
    console.log('Store added successfully!');
}

async function addSearch() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Add New Search ===');
    const name = await question('Enter search name: ');
    const url = await question('Enter eBay search URL: ');
    const interval = parseInt(await question('Enter check interval in minutes: '));
    const enabled = (await question('Enable search? (y/n): ')).toLowerCase() === 'y';

    // List available webhooks
    console.log('\nAvailable webhooks:');
    config.webhooks.forEach((webhook, index) => {
        console.log(`${index + 1}. ${webhook.name}`);
    });
    
    const webhookIndex = parseInt(await question('Select webhook (number): ')) - 1;
    if (webhookIndex < 0 || webhookIndex >= config.webhooks.length) {
        console.error('Invalid webhook selection');
        return;
    }
    
    const webhook = config.webhooks[webhookIndex].name;
    
    config.searches.push({
        name,
        url,
        interval,
        enabled,
        webhook
    });
    
    await saveConfig(config);
    console.log('Search added successfully!');
}

async function deleteSearch() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Delete Search ===');
    
    if (config.searches.length === 0) {
        show.error('No searches configured');
        return;
    }

    // Show all searches
    console.log('\nConfigured searches:');
    config.searches.forEach((search, index) => {
        console.log(`${index + 1}. ${search.name} (${search.type})`);
        console.log(`   Term: ${search.searchTerm}`);
        console.log(`   Interval: ${search.interval} minutes`);
        console.log(`   Status: ${search.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(''); // Add blank line between searches
    });
    
    const searchNumber = await question('Enter search number to delete: ');
    const searchIndex = parseInt(searchNumber) - 1;
    
    if (isNaN(searchIndex) || searchIndex < 0 || searchIndex >= config.searches.length) {
        show.error('Invalid search number');
        return;
    }

    const search = config.searches[searchIndex];
    const confirm = await question(`Are you sure you want to delete "${search.name}"? (y/n): `);
    
    if (confirm.toLowerCase() === 'y') {
        config.searches.splice(searchIndex, 1);
        await saveConfig(config);
        show.success('Search deleted successfully');
    } else {
        show.info('Deletion cancelled');
    }
}

async function toggleStoreStatus(index) {
    const config = await loadConfig();
    const store = config.stores[index];
    store.enabled = !store.enabled;
    await saveConfig(config);
    console.log(`Store "${store.name}" ${store.enabled ? 'enabled' : 'disabled'}.`);
}

async function toggleSearchStatus() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Toggle Search Status ===');
    
    if (config.searches.length === 0) {
        show.error('No searches configured');
        return;
    }

    // Show all searches
    console.log('\nConfigured searches:');
    config.searches.forEach((search, index) => {
        console.log(`${index + 1}. ${search.name} (${search.type})`);
        console.log(`   Term: ${search.searchTerm}`);
        console.log(`   Current Status: ${search.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(''); // Add blank line between searches
    });
    
    const searchNumber = await question('Enter search number to toggle: ');
    const searchIndex = parseInt(searchNumber) - 1;
    
    if (isNaN(searchIndex) || searchIndex < 0 || searchIndex >= config.searches.length) {
        show.error('Invalid search number');
        return;
    }

    const search = config.searches[searchIndex];
    search.enabled = !search.enabled;
    await saveConfig(config);
    show.success(`Search "${search.name}" is now ${search.enabled ? 'enabled' : 'disabled'}`);
}

async function updateSearchInterval() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Update Check Interval ===');
    
    if (config.searches.length === 0) {
        show.error('No searches configured');
        return;
    }

    // Show all searches
    console.log('\nConfigured searches:');
    config.searches.forEach((search, index) => {
        console.log(`${index + 1}. ${search.name} (${search.type})`);
        console.log(`   Term: ${search.searchTerm}`);
        console.log(`   Current Interval: ${search.interval} minutes`);
        console.log(''); // Add blank line between searches
    });
    
    const searchNumber = await question('Enter search number to update: ');
    const searchIndex = parseInt(searchNumber) - 1;
    
    if (isNaN(searchIndex) || searchIndex < 0 || searchIndex >= config.searches.length) {
        show.error('Invalid search number');
        return;
    }
    
    const search = config.searches[searchIndex];
    const newInterval = await question(`Enter new check interval in minutes (current: ${search.interval}): `);
    
    const interval = parseInt(newInterval);
    if (!isNaN(interval) && interval > 0) {
        search.interval = interval;
    await saveConfig(config);
        show.success(`Check interval updated to ${interval} minutes`);
    } else {
        show.error('Invalid interval. No changes made.');
    }
}

async function updateSearchWebhook() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Update Webhook Assignment ===');
    
    if (config.searches.length === 0) {
        show.error('No searches configured');
        return;
    }

    if (config.webhooks.length === 0) {
        show.error('No webhooks configured');
        return;
    }

    // Show all searches
    console.log('\nConfigured searches:');
    config.searches.forEach((search, index) => {
        console.log(`${index + 1}. ${search.name} (${search.type})`);
        console.log(`   Term: ${search.searchTerm}`);
        console.log(`   Current Webhook: ${search.webhookId ? config.webhooks.find(w => w.id === search.webhookId)?.name || 'None' : 'None'}`);
        console.log(''); // Add blank line between searches
    });
    
    const searchNumber = await question('Enter search number to update: ');
    const searchIndex = parseInt(searchNumber) - 1;
    
    if (isNaN(searchIndex) || searchIndex < 0 || searchIndex >= config.searches.length) {
        show.error('Invalid search number');
        return;
    }
    
    const search = config.searches[searchIndex];
    
    // Show available webhooks
    console.log('\nAvailable webhooks:');
    config.webhooks.forEach((webhook, index) => {
        console.log(`${index + 1}. ${webhook.name} (${webhook.url.substring(0, 30)}...)`);
    });
    console.log(`${config.webhooks.length + 1}. None (remove webhook)`);
    
    const webhookChoice = await question('Choose webhook number: ');
    const webhookIndex = parseInt(webhookChoice) - 1;
    
    if (webhookIndex === config.webhooks.length) {
        search.webhookId = null;
        show.success('Webhook removed from search');
    } else if (webhookIndex >= 0 && webhookIndex < config.webhooks.length) {
        search.webhookId = config.webhooks[webhookIndex].id;
        show.success(`Webhook "${config.webhooks[webhookIndex].name}" assigned to search`);
    } else {
        show.error('Invalid webhook choice. No changes made.');
        return;
    }
    
    await saveConfig(config);
}

async function editWebhook(index) {
    console.clear();
    const config = await loadConfig();
    const webhook = config.webhooks[index];
    console.log('\n=== Edit Webhook ===');
    console.log(`Current Name: ${webhook.name}`);
    console.log(`Current URL: ${webhook.url}`);

    const newName = await question('Enter new name (or press Enter to keep current): ');
    const newUrl = await question('Enter new URL (or press Enter to keep current): ');

    if (newName) {
        if (config.webhooks.some(w => w.name === newName && w.id !== webhook.id)) {
            console.log('A webhook with this name already exists.');
            return;
        }
        webhook.name = newName;
    }

    if (newUrl) {
        try {
            new URL(newUrl);
            webhook.url = newUrl;
        } catch (e) {
            console.log('Invalid URL format. Changes not saved.');
            return;
        }
    }

    await saveConfig(config);
    console.log('Webhook updated successfully.');
}

async function addWebhook() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Add New Webhook ===');
    
    const name = await question('Enter webhook name: ');
    if (!name) {
        console.log('Webhook name is required.');
        return;
    }

    // Check if webhook name already exists
    if (config.webhooks.some(w => w.name === name)) {
        console.log('A webhook with this name already exists.');
        return;
    }

    const url = await question('Enter Discord webhook URL: ');
    if (!url) {
        console.log('Webhook URL is required.');
        return;
    }

    // Validate URL format
    try {
        new URL(url);
    } catch (e) {
        console.log('Invalid URL format. Please enter a valid Discord webhook URL.');
        return;
    }

    // Add new webhook
    config.webhooks.push({
        name,
        url,
        id: uuidv4()
    });

    // Save configuration
    await saveConfig(config);
    console.log(`Webhook "${name}" added successfully.`);
}

async function deleteWebhook(index) {
    const config = await loadConfig();
    const webhook = config.webhooks[index];
    const confirm = await question(`Are you sure you want to delete webhook "${webhook.name}"? (y/n): `);
    
    if (confirm.toLowerCase() === 'y') {
        config.webhooks.splice(index, 1);
        await saveConfig(config);
        console.log(`Webhook "${webhook.name}" deleted successfully.`);
    } else {
        console.log('Deletion cancelled.');
    }
}

async function setDefaultWebhook(index) {
    const config = await loadConfig();
    const webhook = config.webhooks[index];
    
    // Remove default status from all webhooks
    config.webhooks.forEach(w => w.isDefault = false);
    
    // Set the selected webhook as default
    webhook.isDefault = true;
    
    await saveConfig(config);
    console.log(`Webhook "${webhook.name}" set as default.`);
}

async function editStore(index) {
    console.clear();
    const config = await loadConfig();
    const store = config.stores[index];
    console.log('\n=== Edit Store ===');
    console.log(`Current Name: ${store.name}`);
    console.log(`Current URL: ${store.url}`);
    console.log(`Current Interval: ${store.interval} minutes`);

    const newName = await question('Enter new name (or press Enter to keep current): ');
    const newUrl = await question('Enter new URL (or press Enter to keep current): ');
    const newInterval = await question('Enter new interval in minutes (or press Enter to keep current): ');

    if (newName) store.name = newName;
    if (newUrl) store.url = newUrl;
    if (newInterval) {
        const interval = parseInt(newInterval);
        if (!isNaN(interval) && interval > 0) {
            store.interval = interval;
        }
    }

    await saveConfig(config);
    console.log('Store updated successfully.');
}

async function editSearch() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Edit Search ===');
    
    if (config.searches.length === 0) {
        show.error('No searches configured');
        return;
    }

    // Show all searches
    console.log('\nConfigured searches:');
    config.searches.forEach((search, index) => {
        console.log(`${index + 1}. ${search.name} (${search.type})`);
        console.log(`   Term: ${search.searchTerm}`);
        console.log(`   Interval: ${search.interval} minutes`);
        console.log(`   Status: ${search.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(''); // Add blank line between searches
    });
    
    const searchNumber = await question('Enter search number to edit: ');
    const searchIndex = parseInt(searchNumber) - 1;
    
    if (isNaN(searchIndex) || searchIndex < 0 || searchIndex >= config.searches.length) {
        show.error('Invalid search number');
        return;
    }

    const search = config.searches[searchIndex];
    console.log(`\nEditing search: ${search.name}`);
    
    const newName = await question(`Enter new name (current: ${search.name}): `);
    const newTerm = await question(`Enter new search term (current: ${search.searchTerm}): `);
    const newInterval = await question(`Enter new check interval in minutes (current: ${search.interval}): `);

    if (newName) search.name = newName;
    if (newTerm) search.searchTerm = newTerm;
    if (newInterval) {
        const interval = parseInt(newInterval);
        if (!isNaN(interval) && interval > 0) {
            search.interval = interval;
        } else {
            show.error('Invalid interval. Keeping current value.');
        }
    }

    await saveConfig(config);
    show.success('Search updated successfully');
}

// Add new view mode functions
async function showWebhookView() {
    console.clear();
    const config = await loadConfig();
    console.log('==========================================');
    console.log('=== Webhooks ===');
    config.webhooks.forEach((webhook, index) => {
        console.log(`${index + 1}. ${webhook.name}`);
        console.log(`   URL: ${webhook.url}`);
        console.log(`   Status: ${webhook.isDefault ? 'Default' : 'Active'}`);
        console.log('');
    });
    console.log('==========================================');
    console.log('\nOptions:');
    console.log('- Press Enter to return to main menu');
    console.log('- Press number to select webhook');
    console.log('- Press A to add new webhook');
    
    const input = await question('\nEnter your choice: ');
    if (input === '') {
        return showMenu();
    } else if (input.toLowerCase() === 'a') {
        await addWebhook();
        return showWebhookView();
    } else {
        const index = parseInt(input) - 1;
        if (index >= 0 && index < config.webhooks.length) {
            await showWebhookActions(index);
        }
        return showWebhookView();
    }
}

async function showWebhookActions(index) {
    const config = await loadConfig();
    console.clear();
    const webhook = config.webhooks[index];
    console.log('==========================================');
    console.log(`=== Webhook: ${webhook.name} ===`);
    console.log(`URL: ${webhook.url}`);
    console.log(`Status: ${webhook.isDefault ? 'Default' : 'Active'}`);
    console.log('==========================================');
    console.log('\nOptions:');
    console.log('- Press E to edit webhook');
    console.log('- Press D to delete webhook');
    console.log('- Press S to set as default');
    console.log('- Press B to go back');
    
    const input = await question('\nEnter your choice: ');
    switch(input.toLowerCase()) {
        case 'e':
            await editWebhook(index);
            break;
        case 'd':
            await deleteWebhook(index);
            break;
        case 's':
            await setDefaultWebhook(index);
            break;
        case 'b':
            return;
    }
}

async function showDataManagementView() {
    console.clear();
    console.log('==========================================');
    console.log('=== Data Management ===');
    console.log('1. View Daily Statistics');
    console.log('2. View Monthly Statistics');
    console.log('3. View Total Usage');
    console.log('4. Clear Old Statistics');
    console.log('==========================================');
    console.log('\nOptions:');
    console.log('- Press number to select option');
    console.log('- Press Enter to return to main menu');
    
    const input = await question('\nEnter your choice: ');
    if (input === '') {
        return showMenu();
    }
    
    switch(input) {
        case '1':
            await showDailyStats();
            break;
        case '2':
            await showMonthlyStats();
            break;
        case '3':
            await showTotalStats();
            break;
        case '4':
            await clearOldStats();
            break;
    }
    return showDataManagementView();
}

async function showDailyStats() {
    console.clear();
    console.log('==========================================');
    console.log('=== Daily Statistics ===');
    const today = new Date().toISOString().split('T')[0];
    const stats = usageStats.getDailyStats(today);
    console.log(`Date: ${today}`);
    console.log(`Total Bytes: ${(stats.total_bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total Requests: ${stats.total_requests}`);
    console.log(`Total Items: ${stats.total_items}`);
    console.log('==========================================');
    await question('\nPress Enter to continue...');
}

async function showMonthlyStats() {
    console.clear();
    console.log('==========================================');
    console.log('=== Monthly Statistics ===');
    const month = new Date().toISOString().substring(0, 7);
    const stats = usageStats.getMonthlyStats(month);
    console.log(`Month: ${month}`);
    console.log(`Total Bytes: ${(stats.total_bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total Requests: ${stats.total_requests}`);
    console.log(`Total Items: ${stats.total_items}`);
    console.log('==========================================');
    await question('\nPress Enter to continue...');
}

async function showTotalStats() {
    console.clear();
    console.log('==========================================');
    console.log('=== Total Usage Statistics ===');
    const stats = usageStats.getTotalStats();
    console.log(`Total Bytes: ${(stats.total_bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total Requests: ${stats.total_requests}`);
    console.log(`Total Items: ${stats.total_items}`);
    console.log('==========================================');
    await question('\nPress Enter to continue...');
}

async function clearOldStats() {
    console.clear();
    console.log('==========================================');
    console.log('=== Clear Old Statistics ===');
    const days = await question('Enter number of days to keep (default: 30): ');
    const daysToKeep = parseInt(days) || 30;
    usageStats.clearOldStats(daysToKeep);
    console.log(`Cleared statistics older than ${daysToKeep} days`);
    console.log('==========================================');
    await question('\nPress Enter to continue...');
}

// Modify showMenu to include new view mode system
async function showMenu() {
    console.clear();
    console.log('=== eBay Scanner Configuration Manager ===');
        console.log('1. Webhook Management');
        console.log('2. Store Management');
        console.log('3. Search Management');
        console.log('4. Data Management');
        console.log('5. Exit');
        
    const choice = await question('\nEnter your choice: ');
        
        switch (choice) {
            case '1':
                await showWebhookView();
                break;
            case '2':
                await showStoreView();
                break;
            case '3':
                await showSearchView();
                break;
            case '4':
                await showDataManagementView();
                break;
            case '5':
                console.log('Exiting configuration...');
                return;
            default:
                console.log('Invalid choice. Please enter a number between 1 and 5.');
        }
    return showMenu();
}

async function showStoreView() {
    console.clear();
    const config = await loadConfig();
    console.log('==========================================');
    console.log('=== Stores ===');
    config.stores.forEach((store, index) => {
        console.log(`${index + 1}. ${store.name}`);
        console.log(`   URL: ${store.url}`);
        console.log(`   Status: ${store.enabled ? 'Enabled' : 'Disabled'}`);
        console.log('');
    });
    console.log('==========================================');
    console.log('\nOptions:');
    console.log('- Press Enter to return to main menu');
    console.log('- Press number to select store');
    console.log('- Press A to add new store');
    
    const input = await question('\nEnter your choice: ');
    if (input === '') {
        return showMenu();
    } else if (input.toLowerCase() === 'a') {
        await configureStore();
        return showStoreView();
    } else {
        const index = parseInt(input) - 1;
        if (index >= 0 && index < config.stores.length) {
            await showStoreActions(index);
        }
        return showStoreView();
    }
}

async function showSearchView() {
    console.clear();
    const config = await loadConfig();
    while (true) {
        console.log('\n=== Search Management ===');
        console.log('1. List all searches');
        console.log('2. Add new search (URL)');
        
        // Only show API option if credentials are available
        const hasApiCredentials = process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID;
        if (hasApiCredentials) {
            console.log('3. Add new search (API)');
        } else {
            console.log('3. Add new search (API) - Requires eBay API credentials');
        }
        
        console.log('4. Edit search');
        console.log('5. Delete search');
        console.log('6. Toggle search status');
        console.log('7. Update check interval');
        console.log('8. Update webhook assignment');
        console.log('9. Back to main menu');
    
        const choice = await question('\nEnter your choice: ');

        switch (choice) {
            case '1':
                await listSearches(config);
                break;
            case '2':
        await addSearch();
                break;
            case '3':
                if (hasApiCredentials) {
                    await configureApiSearch();
    } else {
                    show.info('eBay API credentials not found. Please set EBAY_APP_ID and EBAY_CERT_ID in your .env file to use API features.');
                    show.info('You can still use URL-based searches without API credentials.');
                }
                break;
            case '4':
                await editSearch();
                break;
            case '5':
                await deleteSearch();
                break;
            case '6':
                await toggleSearchStatus();
                break;
            case '7':
                await updateSearchInterval();
                break;
            case '8':
                await updateSearchWebhook();
                break;
            case '9':
                return;
            default:
                console.log('Invalid choice');
        }
    }
}

async function showStoreActions(index) {
    const config = await loadConfig();
    console.clear();
    const store = config.stores[index];
    console.log('==========================================');
    console.log(`=== Store: ${store.name} ===`);
    console.log(`URL: ${store.url}`);
    console.log(`Status: ${store.enabled ? 'Enabled' : 'Disabled'}`);
    console.log('==========================================');
    console.log('\nOptions:');
    console.log('- Press E to edit store');
    console.log('- Press D to delete store');
    console.log('- Press T to toggle status');
    console.log('- Press B to go back');
    
    const input = await question('\nEnter your choice: ');
    switch(input.toLowerCase()) {
        case 'e':
            await editStore(index);
            break;
        case 'd':
            await deleteStore(index);
            break;
        case 't':
            await toggleStoreStatus(index);
            break;
        case 'b':
            return;
    }
}

async function lookupCategories(searchTerm) {
    try {
        // Get eBay token
        const token = await getEbayToken();
        if (!token) {
            show.error('Failed to get eBay token');
            return null;
        }

        // Get category tree ID for Canadian marketplace
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
        if (!treeId) {
            show.error('Failed to get category tree ID');
            return null;
        }

        // Get category suggestions
        show.info('Requesting category suggestions...');
        const suggestionsResponse = await axios.get(
            `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions`,
            {
                params: { 
                    q: searchTerm,
                    limit: 10
                },
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const suggestions = suggestionsResponse.data.categorySuggestions;
        if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
            show.info('No category suggestions found for this search term');
            return null;
        }

        // Display category suggestions
        console.log('\n=== Category Suggestions ===');
        console.log('IMPORTANT: Selecting a category will ONLY show items from that specific category.');
        console.log('For example, selecting "Cell Phones & Smartphones" will exclude accessories and parts.\n');
        
        suggestions.forEach((suggestion, index) => {
            if (suggestion && suggestion.category) {
                const category = suggestion.category;
                console.log(`${index + 1}. ${category.categoryName} (ID: ${category.categoryId})`);
                
                // Show category path if available
                if (suggestion.categoryTreeNodeAncestors && Array.isArray(suggestion.categoryTreeNodeAncestors)) {
                    const path = suggestion.categoryTreeNodeAncestors
                        .map(ancestor => ancestor.categoryName)
                        .reverse()
                        .join(' > ');
                    console.log(`   Path: ${path} > ${category.categoryName}`);
                }
            }
        });

        if (suggestions.length === 0) {
            show.info('No categories found. You can continue without a category.');
            return null;
        }

        // Let user select a category
        const choice = await question('\nSelect a category number (or press Enter to skip): ');
        if (!choice) return null;

        const selectedIndex = parseInt(choice) - 1;
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
            const selected = suggestions[selectedIndex];
            if (selected && selected.category) {
                // Return both ID and path for better context
                return {
                    id: selected.category.categoryId,
                    name: selected.category.categoryName,
                    path: selected.categoryTreeNodeAncestors
                        ? [...selected.categoryTreeNodeAncestors.map(a => a.categoryName).reverse(), selected.category.categoryName].join(' > ')
                        : selected.category.categoryName
                };
            }
        }

        show.error('Invalid category selection');
        return null;
    } catch (error) {
        if (error.response) {
            show.error(`eBay API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            show.error(`Error looking up categories: ${error.message}`);
        }
        return null;
    }
}

async function getEbayToken() {
    try {
        // Check if credentials exist
        if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID) {
            show.error('eBay API credentials not found. Please set EBAY_APP_ID and EBAY_CERT_ID in your .env file to use API features.');
            show.info('You can still use URL-based searches without API credentials.');
            return null;
        }

        show.info('Authenticating with eBay API...');
        const response = await axios.post(
            'https://api.ebay.com/identity/v1/oauth2/token',
            'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(process.env.EBAY_APP_ID + ':' + process.env.EBAY_CERT_ID).toString('base64')}`
                }
            }
        );
        show.success('Successfully authenticated with eBay API');
        return response.data.access_token;
    } catch (error) {
        if (error.response) {
            show.error(`eBay API Error: ${error.response.status} - ${error.response.data.error_description || 'Authentication failed'}`);
            if (error.response.status === 401) {
                show.error('Please check your eBay API credentials (EBAY_APP_ID and EBAY_CERT_ID)');
                show.info('You can still use URL-based searches without API credentials.');
            }
        } else if (error.request) {
            show.error('No response from eBay API. Please check your internet connection.');
        } else {
            show.error(`Error setting up eBay API request: ${error.message}`);
        }
        return null;
    }
}

async function configureApiSearch() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Configure API Search ===');
    
    // Get search term
    const searchTerm = await question('Enter search term: ');
    if (!searchTerm) {
        show.error('Search term is required');
        return;
    }

    // Use search term as name
    const name = searchTerm;

    // Get category (optional)
    const useCategory = (await question('Would you like to specify a category? (y/n): ')).toLowerCase() === 'y';
    let category = null;
    if (useCategory) {
        show.info('Looking up categories for your search term...');
        category = await lookupCategories(searchTerm);
        if (!category) {
            show.error('Failed to get category suggestions. Continuing without category...');
        } else {
            show.success(`Selected category: ${category.path}`);
            show.info('Only items from this specific category will be shown.');
        }
    }

    // Get price range (optional)
    const usePriceRange = (await question('Would you like to set a price range? (y/n): ')).toLowerCase() === 'y';
    let minPrice = null;
    let maxPrice = null;
    if (usePriceRange) {
        minPrice = await question('Enter minimum price (leave empty for no minimum): ');
        maxPrice = await question('Enter maximum price (leave empty for no maximum): ');
    }

    // Get other filters
    const useFilters = (await question('Would you like to add additional filters? (y/n): ')).toLowerCase() === 'y';
    let filters = [];
    if (useFilters) {
        while (true) {
            console.log('\nAvailable filters:');
            console.log('1. Condition');
            console.log('   - NEW');
            console.log('   - USED');
            console.log('   - OPEN_BOX');
            console.log('   - REFURBISHED');
            console.log('   - FOR_PARTS_OR_NOT_WORKING');
            console.log('\n2. Buying Options');
            console.log('   - AUCTION');
            console.log('   - FIXED_PRICE');
            console.log('   - BEST_OFFER');
            console.log('\n3. Location');
            console.log('   - US');
            console.log('   - CA');
            console.log('   - WORLDWIDE');
            console.log('\n4. Free Shipping');
            console.log('   - true');
            console.log('   - false');
            console.log('\n5. Returns Accepted');
            console.log('   - true');
            console.log('   - false');
            console.log('\n6. Done adding filters');
    
            const filterChoice = await question('\nChoose filter number: ');
            if (!filterChoice || filterChoice === '6') break;

            let filterValue;
            switch (filterChoice) {
                case '1':
                    filterValue = await question('Enter condition (NEW/USED/OPEN_BOX/REFURBISHED/FOR_PARTS_OR_NOT_WORKING): ');
            break;
                case '2':
                    filterValue = await question('Enter buying option (AUCTION/FIXED_PRICE/BEST_OFFER): ');
            break;
                case '3':
                    filterValue = await question('Enter location (US/CA/WORLDWIDE): ');
            break;
                case '4':
                    filterValue = await question('Free shipping? (true/false): ');
                    break;
                case '5':
                    filterValue = await question('Returns accepted? (true/false): ');
                    break;
                default:
                    show.error('Invalid filter choice');
                    continue;
            }

            if (filterValue) {
                filters.push({ type: filterChoice, value: filterValue });
                show.success(`Added filter: ${filterValue}`);
            }
        }
    }

    // Get check interval
    const intervalInput = await question('Enter check interval in minutes (default: 5): ');
    let interval = intervalInput ? parseInt(intervalInput) : 5;
    if (isNaN(interval) || interval < 1) {
        show.info('Invalid interval. Using default of 5 minutes.');
        interval = 5;
    }

    // Get webhook assignment
    let webhookId = null;
    if (config.webhooks.length > 0) {
        console.log('\nAvailable webhooks:');
        config.webhooks.forEach((webhook, index) => {
            console.log(`${index + 1}. ${webhook.name} (${webhook.url.substring(0, 30)}...)`);
        });
        console.log(`${config.webhooks.length + 1}. None (no webhook)`);
        
        const webhookChoice = await question('Choose webhook number: ');
        const webhookIndex = parseInt(webhookChoice) - 1;
        
        if (webhookIndex >= 0 && webhookIndex < config.webhooks.length) {
            webhookId = config.webhooks[webhookIndex].id;
            show.success(`Selected webhook: ${config.webhooks[webhookIndex].name}`);
        } else if (webhookIndex === config.webhooks.length) {
            show.info('No webhook selected');
        } else {
            show.error('Invalid webhook choice. No webhook selected.');
        }
    } else {
        show.info('No webhooks configured. You can add webhooks later.');
    }

    // Create the search configuration
    const searchConfig = {
        name,
        type: 'api',
        searchTerm,
        categoryId: category?.id || null,
        categoryPath: category?.path || null,
        minPrice,
        maxPrice,
        filters,
        interval,
        enabled: true,
        webhookId: webhookId || null
    };

    // Test the search configuration
    console.log('\nTesting search configuration...');
    try {
        console.log('\nSearch configuration:');
        console.log(JSON.stringify(searchConfig, null, 2));
        
        const save = await question('\nWould you like to save this search? (y/n): ');
        if (save.toLowerCase() === 'y') {
            // Ensure webhookId is properly set before saving
            if (!webhookId && config.webhooks.length > 0) {
                const useDefaultWebhook = await question('Would you like to use the default webhook? (y/n): ');
                if (useDefaultWebhook.toLowerCase() === 'y') {
                    webhookId = config.webhooks[0].id;
                    searchConfig.webhookId = webhookId;
                    show.success(`Using default webhook: ${config.webhooks[0].name}`);
                }
            }
            
            config.searches.push(searchConfig);
            await saveConfig(config);
            show.success('API search added successfully!');
        } else {
            show.info('Search configuration discarded.');
        }
    } catch (error) {
        show.error(`Error testing search: ${error.message}`);
    }
}

async function configureStore() {
    console.clear();
    const config = await loadConfig();
    console.log('\n=== Configure Store ===');

    // Check if API credentials exist
    const hasApiCredentials = process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID;
    
    // Let user choose store type
    console.log('\nStore Type:');
    console.log('1. URL-based (Web Scraping)');
    if (hasApiCredentials) {
        console.log('2. API-based (Requires eBay API credentials)');
    }
    
    const typeChoice = await question('\nChoose store type: ');
    let storeType;
    
    if (typeChoice === '2' && hasApiCredentials) {
        storeType = 'api';
    } else {
        storeType = 'url';
        if (typeChoice === '2') {
            show.error('eBay API credentials not found. Defaulting to URL-based store.');
            show.info('To use API-based stores, set EBAY_APP_ID and EBAY_CERT_ID in your .env file.');
        }
    }

    // Get store name
    const name = await question('Enter store name: ');
    if (!name) {
        show.error('Store name is required');
            return;
    }

    let storeConfig;
    
    if (storeType === 'api') {
        // API-based store configuration
        const storeId = await question('Enter eBay seller username or store name: ');
        if (!storeId) {
            show.error('Seller username/store name is required for API-based stores');
            return;
        }

        // Get check interval
        const intervalInput = await question('Enter check interval in minutes (default: 5): ');
        let interval = intervalInput ? parseInt(intervalInput) : 5;
        if (isNaN(interval) || interval < 1) {
            show.info('Invalid interval. Using default of 5 minutes.');
            interval = 5;
        }

        // Get webhook assignment
        let webhookId = null;
        if (config.webhooks.length > 0) {
            console.log('\nAvailable webhooks:');
            config.webhooks.forEach((webhook, index) => {
                console.log(`${index + 1}. ${webhook.name} (${webhook.url.substring(0, 30)}...)`);
            });
            console.log(`${config.webhooks.length + 1}. None (no webhook)`);
            
            const webhookChoice = await question('Choose webhook number: ');
            const webhookIndex = parseInt(webhookChoice) - 1;
            
            if (webhookIndex >= 0 && webhookIndex < config.webhooks.length) {
                webhookId = config.webhooks[webhookIndex].id;
                show.success(`Selected webhook: ${config.webhooks[webhookIndex].name}`);
            } else if (webhookIndex === config.webhooks.length) {
                show.info('No webhook selected');
            } else {
                show.error('Invalid webhook choice. No webhook selected.');
            }
        } else {
            show.info('No webhooks configured. You can add webhooks later.');
        }

        storeConfig = {
            name,
            type: 'api',
            storeId,
            interval,
            enabled: true,
            webhookId: webhookId || null
        };
    } else {
        // URL-based store configuration
        const url = await question('Enter store URL: ');
        if (!url) {
            show.error('Store URL is required');
            return;
        }

        // Get check interval
        const intervalInput = await question('Enter check interval in minutes (default: 5): ');
        let interval = intervalInput ? parseInt(intervalInput) : 5;
        if (isNaN(interval) || interval < 1) {
            show.info('Invalid interval. Using default of 5 minutes.');
            interval = 5;
        }

        // Get webhook assignment
        let webhookId = null;
        if (config.webhooks.length > 0) {
            console.log('\nAvailable webhooks:');
            config.webhooks.forEach((webhook, index) => {
                console.log(`${index + 1}. ${webhook.name} (${webhook.url.substring(0, 30)}...)`);
            });
            console.log(`${config.webhooks.length + 1}. None (no webhook)`);
            
            const webhookChoice = await question('Choose webhook number: ');
            const webhookIndex = parseInt(webhookChoice) - 1;
            
            if (webhookIndex >= 0 && webhookIndex < config.webhooks.length) {
                webhookId = config.webhooks[webhookIndex].id;
                show.success(`Selected webhook: ${config.webhooks[webhookIndex].name}`);
            } else if (webhookIndex === config.webhooks.length) {
                show.info('No webhook selected');
            } else {
                show.error('Invalid webhook choice. No webhook selected.');
            }
        } else {
            show.info('No webhooks configured. You can add webhooks later.');
        }

        storeConfig = {
            name,
            type: 'url',
            url,
            interval,
            enabled: true,
            webhookId: webhookId || null
        };
    }

    // Test the store configuration
    console.log('\nTesting store configuration...');
    try {
        console.log('\nStore configuration:');
        console.log(JSON.stringify(storeConfig, null, 2));
        
        const save = await question('\nWould you like to save this store? (y/n): ');
        if (save.toLowerCase() === 'y') {
            // Ensure webhookId is properly set before saving
            if (!storeConfig.webhookId && config.webhooks.length > 0) {
                const useDefaultWebhook = await question('Would you like to use the default webhook? (y/n): ');
                if (useDefaultWebhook.toLowerCase() === 'y') {
                    storeConfig.webhookId = config.webhooks[0].id;
                    show.success(`Using default webhook: ${config.webhooks[0].name}`);
                }
            }
            
            config.stores.push(storeConfig);
            await saveConfig(config);
            show.success('Store added successfully!');
        } else {
            show.info('Store configuration discarded.');
        }
    } catch (error) {
        show.error(`Error testing store: ${error.message}`);
    }
}

async function deleteStore(index) {
    console.clear();
    const config = await loadConfig();
    if (config.stores.length === 0) {
        show.error('No stores configured');
        return;
    }
    const store = config.stores[index];
    const confirm = await question(`Are you sure you want to delete store "${store.name}"? (y/n): `);
    if (confirm.toLowerCase() === 'y') {
        config.stores.splice(index, 1);
        await saveConfig(config);
        show.success('Store deleted successfully');
    } else {
        show.info('Deletion cancelled');
    }
}

// Start the configuration manager
showMenu().catch(error => {
    console.error('Error:', error);
    process.exit(1);
}); 