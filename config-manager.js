const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { v4: uuidv4 } = require('uuid');
const usageStats = require('./usage-stats');

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

function showSuccess(message) {
    console.log(colors.fg.green + `${getTimestamp()} ${message}` + colors.reset);
}

function showError(message) {
    console.log(colors.fg.red + `${getTimestamp()} ${message}` + colors.reset);
}

function showInfo(message) {
    console.log(colors.fg.cyan + `${getTimestamp()} ${message}` + colors.reset);
}

async function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        // Ensure all required arrays exist
        if (!config.webhooks) config.webhooks = [];
        if (!config.stores) config.stores = [];
        if (!config.searches) config.searches = [];
        
        return config;
    } catch (error) {
        console.error('Error loading config:', error.message);
        // Return a properly initialized config object
        return {
            webhooks: [],
            stores: [],
            searches: []
        };
    }
}

async function saveConfig(config) {
    try {
        const configPath = path.join(__dirname, 'config.json');
        await fs.writeFile(configPath, JSON.stringify(config, null, 4));
        showSuccess('Configuration saved successfully!');
    } catch (error) {
        console.error('Error saving config:', error.message);
    }
}

async function listWebhooks(config) {
    console.log('\n' + colors.fg.yellow + `${getTimestamp()} === Webhooks ===` + colors.reset);
    if (config.webhooks.length === 0) {
        showInfo('No webhooks configured');
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
        console.log(`${index + 1}. ${store.name} (${store.id})`);
        console.log(`   Status: ${store.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Interval: ${store.interval} minutes`);
        console.log(`   Webhook: ${store.webhook || 'Default'}`);
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
        console.log(`${index + 1}. ${search.name}`);
        console.log(`   URL: ${search.url}`);
        console.log(`   Status: ${search.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   Interval: ${search.interval} minutes`);
        console.log(`   Webhook: ${search.webhook || 'Default'}`);
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

async function deleteStore(index) {
    const config = await loadConfig();
    const store = config.stores[index];
    const confirm = await question(`Are you sure you want to delete ${store.name}? (y/n): `);
    if (confirm.toLowerCase() === 'y') {
        config.stores.splice(index, 1);
        await saveConfig(config);
        console.log(`Store "${store.name}" deleted successfully.`);
    } else {
        console.log('Deletion cancelled.');
    }
}

async function deleteSearch(index) {
    const config = await loadConfig();
    const search = config.searches[index];
    const confirm = await question(`Are you sure you want to delete ${search.name}? (y/n): `);
    if (confirm.toLowerCase() === 'y') {
        config.searches.splice(index, 1);
        await saveConfig(config);
        console.log(`Search "${search.name}" deleted successfully.`);
    } else {
        console.log('Deletion cancelled.');
    }
}

async function toggleStoreStatus(index) {
    const config = await loadConfig();
    const store = config.stores[index];
    store.enabled = !store.enabled;
    await saveConfig(config);
    console.log(`Store "${store.name}" ${store.enabled ? 'enabled' : 'disabled'}.`);
}

async function toggleSearchStatus(index) {
    const config = await loadConfig();
    const search = config.searches[index];
    search.enabled = !search.enabled;
    await saveConfig(config);
    console.log(`Search "${search.name}" ${search.enabled ? 'enabled' : 'disabled'}.`);
}

async function updateInterval(index, type) {
    const config = await loadConfig();
    const item = type === 'store' ? config.stores[index] : config.searches[index];
    const currentInterval = item.interval;
    
    console.log(`\n=== Update ${type === 'store' ? 'Store' : 'Search'} Interval ===`);
    console.log(`Current interval: ${currentInterval} minutes`);
    
    const newInterval = parseInt(await question('Enter new interval in minutes: '));
    if (isNaN(newInterval) || newInterval < 1) {
        console.log('Invalid interval. Must be a positive number.');
        return;
    }
    
    item.interval = newInterval;
    await saveConfig(config);
    console.log(`Interval updated to ${newInterval} minutes.`);
}

async function updateWebhookAssignment(index, type) {
    const config = await loadConfig();
    const item = type === 'store' ? config.stores[index] : config.searches[index];
    
    console.log(`\n=== Update ${type === 'store' ? 'Store' : 'Search'} Webhook ===`);
    console.log('Available webhooks:');
    config.webhooks.forEach((webhook, i) => {
        console.log(`${i + 1}. ${webhook.name}`);
    });
    
    const webhookIndex = parseInt(await question('Select webhook number (press Enter for default): ')) - 1;
    if (webhookIndex < -1 || webhookIndex >= config.webhooks.length) {
        console.log('Invalid webhook selection.');
        return;
    }
    
    if (webhookIndex === -1) {
        item.webhookId = null;
    } else {
        item.webhookId = config.webhooks[webhookIndex].id;
    }
    
    await saveConfig(config);
    console.log('Webhook assignment updated successfully.');
}

async function editWebhook(index) {
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

async function editSearch(index) {
    const config = await loadConfig();
    const search = config.searches[index];
    console.log('\n=== Edit Search ===');
    console.log(`Current Name: ${search.name}`);
    console.log(`Current URL: ${search.url}`);
    console.log(`Current Interval: ${search.interval} minutes`);

    const newName = await question('Enter new name (or press Enter to keep current): ');
    const newUrl = await question('Enter new URL (or press Enter to keep current): ');
    const newInterval = await question('Enter new interval in minutes (or press Enter to keep current): ');

    if (newName) search.name = newName;
    if (newUrl) search.url = newUrl;
    if (newInterval) {
        const interval = parseInt(newInterval);
        if (!isNaN(interval) && interval > 0) {
            search.interval = interval;
        }
    }

    await saveConfig(config);
    console.log('Search updated successfully.');
}

// Add new view mode functions
async function showWebhookView() {
    const config = await loadConfig();
    console.clear();
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
    console.log('- Press B to go back to main menu');
    
    const input = await question('\nEnter your choice: ');
    if (input.toLowerCase() === 'b') {
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
    while (true) {
        console.log('\n=== eBay Scanner Configuration ===');
        console.log('1. Webhook Management');
        console.log('2. Store Management');
        console.log('3. Search Management');
        console.log('4. Data Management');
        console.log('5. Exit');
        
        const choice = await question('\nEnter your choice (1-5): ');
        
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
    }
}

async function showStoreView() {
    const config = await loadConfig();
    console.clear();
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
        await addStore();
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
    const config = await loadConfig();
    console.clear();
    console.log('==========================================');
    console.log('=== Searches ===');
    config.searches.forEach((search, index) => {
        console.log(`${index + 1}. ${search.name}`);
        console.log(`   URL: ${search.url}`);
        console.log(`   Status: ${search.enabled ? 'Enabled' : 'Disabled'}`);
        console.log('');
    });
    console.log('==========================================');
    console.log('\nOptions:');
    console.log('- Press Enter to return to main menu');
    console.log('- Press number to select search');
    console.log('- Press A to add new search');
    
    const input = await question('\nEnter your choice: ');
    if (input === '') {
        return showMenu();
    } else if (input.toLowerCase() === 'a') {
        await addSearch();
        return showSearchView();
    } else {
        const index = parseInt(input) - 1;
        if (index >= 0 && index < config.searches.length) {
            await showSearchActions(index);
        }
        return showSearchView();
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

async function showSearchActions(index) {
    const config = await loadConfig();
    console.clear();
    const search = config.searches[index];
    console.log('==========================================');
    console.log(`=== Search: ${search.name} ===`);
    console.log(`URL: ${search.url}`);
    console.log(`Status: ${search.enabled ? 'Enabled' : 'Disabled'}`);
    console.log('==========================================');
    console.log('\nOptions:');
    console.log('- Press E to edit search');
    console.log('- Press D to delete search');
    console.log('- Press T to toggle status');
    console.log('- Press B to go back');
    
    const input = await question('\nEnter your choice: ');
    switch(input.toLowerCase()) {
        case 'e':
            await editSearch(index);
            break;
        case 'd':
            await deleteSearch(index);
            break;
        case 't':
            await toggleSearchStatus(index);
            break;
        case 'b':
            return;
    }
}

// Start the configuration manager
showMenu().catch(error => {
    console.error('Error:', error);
    process.exit(1);
}); 