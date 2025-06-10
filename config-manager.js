const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

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
        console.log('Configuration saved successfully!');
    } catch (error) {
        console.error('Error saving config:', error.message);
    }
}

async function listWebhooks(config) {
    console.log('\n=== Discord Webhooks ===');
    if (config.webhooks.length === 0) {
        console.log('No webhooks configured.');
        return;
    }
    config.webhooks.forEach((webhook, index) => {
        console.log(`${index + 1}. ${webhook.name}`);
        console.log(`   URL: ${webhook.url}`);
        console.log(`   Default: ${webhook.default ? 'Yes' : 'No'}`);
        console.log('---');
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

async function addStore(config) {
    console.log('\n=== Add New Store ===');
    
    // Get store URL or ID
    const storeInput = await question('Enter store URL or ID (e.g., https://www.ebay.ca/str/surplusbydesign or surplusbydesign): ');
    if (!storeInput) {
        console.log('Store URL/ID is required');
        return;
    }

    // Get check interval
    const intervalInput = await question('Enter check interval in minutes (default: 5): ');
    const interval = intervalInput ? parseInt(intervalInput) : 5;
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

async function addSearch(config) {
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

async function deleteStore(config) {
    await listStores(config);
    if (config.stores.length === 0) return;

    const index = parseInt(await question('\nEnter store number to delete (0 to cancel): ')) - 1;
    if (index < 0 || index >= config.stores.length) {
        console.log('Invalid store number.');
        return;
    }

    const store = config.stores[index];
    const confirm = await question(`Are you sure you want to delete ${store.name}? (y/n): `);
    if (confirm.toLowerCase() === 'y') {
        config.stores.splice(index, 1);
        await saveConfig(config);
        console.log('Store deleted successfully!');
    }
}

async function deleteSearch(config) {
    await listSearches(config);
    if (config.searches.length === 0) return;

    const index = parseInt(await question('\nEnter search number to delete (0 to cancel): ')) - 1;
    if (index < 0 || index >= config.searches.length) {
        console.log('Invalid search number.');
        return;
    }

    const search = config.searches[index];
    const confirm = await question(`Are you sure you want to delete ${search.name}? (y/n): `);
    if (confirm.toLowerCase() === 'y') {
        config.searches.splice(index, 1);
        await saveConfig(config);
        console.log('Search deleted successfully!');
    }
}

async function toggleStoreStatus(config) {
    await listStores(config);
    if (config.stores.length === 0) return;

    const index = parseInt(await question('\nEnter store number to toggle (0 to cancel): ')) - 1;
    if (index < 0 || index >= config.stores.length) {
        console.log('Invalid store number.');
        return;
    }

    config.stores[index].enabled = !config.stores[index].enabled;
    await saveConfig(config);
    console.log(`Store ${config.stores[index].name} is now ${config.stores[index].enabled ? 'enabled' : 'disabled'}`);
}

async function toggleSearchStatus(config) {
    await listSearches(config);
    if (config.searches.length === 0) return;

    const index = parseInt(await question('\nEnter search number to toggle (0 to cancel): ')) - 1;
    if (index < 0 || index >= config.searches.length) {
        console.log('Invalid search number.');
        return;
    }

    config.searches[index].enabled = !config.searches[index].enabled;
    await saveConfig(config);
    console.log(`Search ${config.searches[index].name} is now ${config.searches[index].enabled ? 'enabled' : 'disabled'}`);
}

async function updateInterval(config) {
    console.log('\n=== Update Check Interval ===');
    console.log('1. Update store interval');
    console.log('2. Update search interval');
    const choice = await question('Enter your choice (1-2): ');

    if (choice === '1') {
        await listStores(config);
        if (config.stores.length === 0) return;

        const index = parseInt(await question('\nEnter store number to update (0 to cancel): ')) - 1;
        if (index < 0 || index >= config.stores.length) {
            console.log('Invalid store number.');
            return;
        }

        const interval = parseInt(await question('Enter new interval (minutes): '));
        config.stores[index].interval = interval;
        await saveConfig(config);
        console.log('Store interval updated successfully!');
    } else if (choice === '2') {
        await listSearches(config);
        if (config.searches.length === 0) return;

        const index = parseInt(await question('\nEnter search number to update (0 to cancel): ')) - 1;
        if (index < 0 || index >= config.searches.length) {
            console.log('Invalid search number.');
            return;
        }

        const interval = parseInt(await question('Enter new interval (minutes): '));
        config.searches[index].interval = interval;
        await saveConfig(config);
        console.log('Search interval updated successfully!');
    }
}

async function updateWebhook(config) {
    console.log('\n=== Update Webhook Assignment ===');
    console.log('1. Update store webhook');
    console.log('2. Update search webhook');
    const choice = await question('Enter your choice (1-2): ');

    if (choice === '1') {
        await listStores(config);
        if (config.stores.length === 0) return;

        const index = parseInt(await question('\nEnter store number to update (0 to cancel): ')) - 1;
        if (index < 0 || index >= config.stores.length) {
            console.log('Invalid store number.');
            return;
        }

        await listWebhooks(config);
        const useCustom = (await question('Use custom webhook? (y/n): ')).toLowerCase() === 'y';
        if (useCustom) {
            const webhookIndex = parseInt(await question('Enter webhook number: ')) - 1;
            if (webhookIndex >= 0 && webhookIndex < config.webhooks.length) {
                config.stores[index].webhook = config.webhooks[webhookIndex].name;
                await saveConfig(config);
                console.log('Store webhook updated successfully!');
            }
        }
    } else if (choice === '2') {
        await listSearches(config);
        if (config.searches.length === 0) return;

        const index = parseInt(await question('\nEnter search number to update (0 to cancel): ')) - 1;
        if (index < 0 || index >= config.searches.length) {
            console.log('Invalid search number.');
            return;
        }

        await listWebhooks(config);
        const useCustom = (await question('Use custom webhook? (y/n): ')).toLowerCase() === 'y';
        if (useCustom) {
            const webhookIndex = parseInt(await question('Enter webhook number: ')) - 1;
            if (webhookIndex >= 0 && webhookIndex < config.webhooks.length) {
                config.searches[index].webhook = config.webhooks[webhookIndex].name;
                await saveConfig(config);
                console.log('Search webhook updated successfully!');
            }
        }
    }
}

async function editWebhook(config) {
    await listWebhooks(config);
    if (config.webhooks.length === 0) return;

    const index = parseInt(await question('\nEnter webhook number to edit (0 to cancel): ')) - 1;
    if (index < 0 || index >= config.webhooks.length) {
        console.log('Invalid webhook number.');
        return;
    }

    const webhook = config.webhooks[index];
    console.log(`Current URL: ${webhook.url}`);
    
    const newUrl = await question('Enter new webhook URL (press Enter to keep current): ');
    if (newUrl.trim()) {
        webhook.url = newUrl.trim();
        await saveConfig(config);
        console.log('Webhook URL updated successfully!');
    }
}

async function showMenu() {
    const config = await loadConfig();
    
    while (true) {
        console.log('\n=== eBay Scanner Configuration ===');
        console.log('Webhook Management:');
        console.log('1. List all webhooks');
        console.log('2. Add new webhook');
        console.log('3. Edit webhook URL');
        console.log('4. Delete webhook');
        console.log('5. Set default webhook');
        console.log('6. Update webhook assignment');
        console.log('\nStore Management:');
        console.log('7. List all stores');
        console.log('8. Add new store');
        console.log('9. Delete store');
        console.log('10. Toggle store status');
        console.log('\nSearch Management:');
        console.log('11. List all searches');
        console.log('12. Add new search');
        console.log('13. Delete search');
        console.log('14. Toggle search status');
        console.log('15. Update check interval');
        console.log('\n0. Exit');

        const choice = await question('\nEnter your choice (0-15): ');

        switch (choice) {
            case '0':
                console.log('Exiting...');
                return;
            case '1':
                await listWebhooks(config);
                break;
            case '2':
                await addWebhook(config);
                break;
            case '3':
                await editWebhook(config);
                break;
            case '4':
                await deleteWebhook(config);
                break;
            case '5':
                await setDefaultWebhook(config);
                break;
            case '6':
                await updateWebhook(config);
                break;
            case '7':
                await listStores(config);
                break;
            case '8':
                await addStore(config);
                break;
            case '9':
                await deleteStore(config);
                break;
            case '10':
                await toggleStoreStatus(config);
                break;
            case '11':
                await listSearches(config);
                break;
            case '12':
                await addSearch(config);
                break;
            case '13':
                await deleteSearch(config);
                break;
            case '14':
                await toggleSearchStatus(config);
                break;
            case '15':
                await updateInterval(config);
                break;
            default:
                console.log('Invalid choice, please try again.');
        }
    }
}

// Start the configuration manager
showMenu().catch(error => {
    console.error('Error:', error);
    process.exit(1);
}); 