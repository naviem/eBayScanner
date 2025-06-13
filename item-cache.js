const fs = require('fs').promises;
const path = require('path');

class ItemCache {
    constructor() {
        this.cache = new Map();
        this.cacheFile = process.env.DOCKER ? 
            path.join('/app/data', 'item-cache.json') : 
            path.join(__dirname, 'item-cache.json');
        this.loadCache();
    }

    async loadCache() {
        try {
            const data = await fs.readFile(this.cacheFile, 'utf8');
            const parsed = JSON.parse(data);
            
            // Convert plain object back to Map
            this.cache = new Map();
            for (const [key, value] of Object.entries(parsed)) {
                // Convert arrays back to Sets
                this.cache.set(key, new Set(value));
            }
            console.log('Loaded existing item cache');
        } catch (error) {
            console.log('No existing cache file found, starting fresh');
            this.cache = new Map();
        }
    }

    async saveCache() {
        try {
            // Convert Map to plain object and Sets to arrays for JSON serialization
            const data = {};
            for (const [key, value] of this.cache.entries()) {
                data[key] = Array.from(value);
            }
            await fs.writeFile(this.cacheFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving cache:', error.message);
        }
    }

    getCacheKey(type, identifier) {
        return `${type}:${identifier}`;
    }

    hasItems(type, identifier) {
        const key = this.getCacheKey(type, identifier);
        return this.cache.has(key) && this.cache.get(key).size > 0;
    }

    isFirstScan(type, identifier) {
        const key = this.getCacheKey(type, identifier);
        return !this.cache.has(key) || this.cache.get(key).size === 0;
    }

    isNewItem(type, identifier, itemId) {
        const key = this.getCacheKey(type, identifier);
        if (!this.cache.has(key)) {
            this.cache.set(key, new Set());
        }
        const seenItems = this.cache.get(key);
        if (!seenItems.has(itemId)) {
            seenItems.add(itemId);
            this.saveCache(); // Save after each new item
            return true;
        }
        return false;
    }

    async updateSeenItems(type, identifier, itemIds) {
        const key = this.getCacheKey(type, identifier);
        if (!this.cache.has(key)) {
            this.cache.set(key, new Set());
        }
        const seenItems = this.cache.get(key);
        itemIds.forEach(id => seenItems.add(id));
        await this.saveCache();
    }

    async clearOldItems(maxAgeHours = 24) {
        const now = Date.now();
        const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

        for (const [key, seenItems] of this.cache.entries()) {
            const oldItems = Array.from(seenItems).filter(itemId => {
                const timestamp = parseInt(itemId.split('-')[1] || '0');
                return now - timestamp > maxAgeMs;
            });

            if (oldItems.length > 0) {
                const newSeenItems = new Set(Array.from(seenItems).filter(id => !oldItems.includes(id)));
                this.cache.set(key, newSeenItems);
            }
        }

        await this.saveCache();
    }
}

module.exports = ItemCache; 