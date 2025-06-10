const fs = require('fs').promises;
const path = require('path');

class ItemCache {
    constructor() {
        this.cache = new Map();
        this.cacheFile = path.join(__dirname, 'item-cache.json');
        this.loadCache();
    }

    async loadCache() {
        try {
            const data = await fs.readFile(this.cacheFile, 'utf8');
            const parsed = JSON.parse(data);
            // Convert the plain object back to a Map with Sets
            this.cache = new Map(
                Object.entries(parsed).map(([key, value]) => [
                    key,
                    new Set(Array.isArray(value) ? value : [])
                ])
            );
            console.log('Loaded existing item cache');
        } catch (error) {
            console.log('No existing cache file found, starting fresh');
            this.cache = new Map();
        }
    }

    async saveCache() {
        try {
            // Convert Map and Sets to plain objects for JSON serialization
            const data = Object.fromEntries(
                Array.from(this.cache.entries()).map(([key, value]) => [
                    key,
                    Array.from(value)
                ])
            );
            await fs.writeFile(this.cacheFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving cache:', error.message);
        }
    }

    getCacheKey(type, identifier) {
        return `${type}:${identifier}`;
    }

    hasSeenItems(type, identifier) {
        const key = this.getCacheKey(type, identifier);
        return this.cache.has(key);
    }

    isFirstScan(type, identifier) {
        const key = this.getCacheKey(type, identifier);
        return !this.cache.has(key) || this.cache.get(key).size === 0;
    }

    isNewItem(type, identifier, itemId) {
        const key = this.getCacheKey(type, identifier);
        const seenItems = this.cache.get(key) || new Set();
        return !seenItems.has(itemId);
    }

    async updateSeenItems(type, identifier, itemIds) {
        const key = this.getCacheKey(type, identifier);
        const seenItems = this.cache.get(key) || new Set();
        
        for (const itemId of itemIds) {
            seenItems.add(itemId);
        }
        
        this.cache.set(key, seenItems);
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