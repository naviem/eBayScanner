const fs = require('fs');
const path = require('path');

class UsageStats {
    constructor() {
        this.statsFile = path.join(__dirname, 'usage-stats.json');
        this.currentStats = this.loadStats();
    }

    loadStats() {
        try {
            if (fs.existsSync(this.statsFile)) {
                return JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
        return {
            daily_stats: {},
            monthly_stats: {},
            total_stats: {
                total_bytes: 0,
                total_requests: 0,
                total_items: 0
            }
        };
    }

    saveStats() {
        try {
            fs.writeFileSync(this.statsFile, JSON.stringify(this.currentStats, null, 2));
        } catch (error) {
            console.error('Error saving stats:', error);
        }
    }

    recordScan(bytes, requests, items) {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const monthStr = dateStr.substring(0, 7);

        // Update daily stats
        if (!this.currentStats.daily_stats[dateStr]) {
            this.currentStats.daily_stats[dateStr] = {
                total_bytes: 0,
                total_requests: 0,
                total_items: 0
            };
        }
        this.currentStats.daily_stats[dateStr].total_bytes += bytes;
        this.currentStats.daily_stats[dateStr].total_requests += requests;
        this.currentStats.daily_stats[dateStr].total_items += items;

        // Update monthly stats
        if (!this.currentStats.monthly_stats[monthStr]) {
            this.currentStats.monthly_stats[monthStr] = {
                total_bytes: 0,
                total_requests: 0,
                total_items: 0
            };
        }
        this.currentStats.monthly_stats[monthStr].total_bytes += bytes;
        this.currentStats.monthly_stats[monthStr].total_requests += requests;
        this.currentStats.monthly_stats[monthStr].total_items += items;

        // Update total stats
        this.currentStats.total_stats.total_bytes += bytes;
        this.currentStats.total_stats.total_requests += requests;
        this.currentStats.total_stats.total_items += items;

        this.saveStats();
    }

    getDailyStats(date) {
        return this.currentStats.daily_stats[date] || {
            total_bytes: 0,
            total_requests: 0,
            total_items: 0
        };
    }

    getMonthlyStats(month) {
        return this.currentStats.monthly_stats[month] || {
            total_bytes: 0,
            total_requests: 0,
            total_items: 0
        };
    }

    getTotalStats() {
        return this.currentStats.total_stats;
    }

    clearOldStats(daysToKeep = 30) {
        const now = new Date();
        const cutoff = new Date(now.getTime() - (daysToKeep * 24 * 60 * 60 * 1000));
        
        Object.keys(this.currentStats.daily_stats).forEach(date => {
            if (new Date(date) < cutoff) {
                delete this.currentStats.daily_stats[date];
            }
        });

        this.saveStats();
    }
}

module.exports = new UsageStats(); 