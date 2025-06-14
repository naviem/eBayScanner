# eBay Scanner

A Node.js tool that monitors eBay stores and searches for new listings, sending notifications to Discord when new items are found.

## Features

- Monitor multiple eBay stores for new listings
- Monitor specific eBay search URLs for new listings
- Configurable check intervals for each store and search
- Discord notifications with item details
- Support for both eBay API and web scraping methods
- Interactive configuration manager

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your configuration:
   ```
   EBAY_APP_ID=your_ebay_app_id
   EBAY_CERT_ID=your_ebay_cert_id
   EBAY_DEV_ID=your_ebay_dev_id
   EBAY_OAUTH_TOKEN=your_ebay_user_token
   EBAY_SANDBOX=false   ```

4. Configure your stores and searches using the interactive configuration manager:
   ```bash
   node config-manager.js
   ```
   This will let you add and configure your stores and searches. Exit when you're done configuring.

5. Start the scanner:
   ```bash
   node index.js
   ```
   This will start monitoring your configured stores and searches.

## Usage

### Configuration Manager
The configuration manager (`config-manager.js`) is used to set up and modify your monitoring configuration. You only need to run it when you want to make changes to your configuration.

```bash
node config-manager.js
```

### Main Scanner
The main scanner (`index.js`) is what actually monitors eBay and sends notifications. This is the program that needs to keep running to monitor your stores and searches.

```bash
node index.js
```

### Making Changes
If you want to make changes to your configuration:
1. Stop the scanner (Ctrl+C)
2. Run the configuration manager to make your changes
3. Start the scanner again

### Configuration File
Alternatively, you can manually edit `config.json`:
```json
{
    "stores": [
        {
            "id": "store_username",
            "name": "Store Name",
            "enabled": true,
            "interval": 5
        }
    ],
    "searches": [
        {
            "name": "Search Name",
            "url": "https://www.ebay.com/sch/i.html?_nkw=search+terms&_sop=10",
            "enabled": true,
            "interval": 10
        }
    ]
}
```

## Configuration Manager Details

### Adding a Store
- Enter the store's eBay username
- Provide a display name for notifications
- Set the check interval in minutes
- Choose whether to enable the store

### Adding a Search
- Enter a name for the search
- Provide the full eBay search URL
- Set the check interval in minutes
- Choose whether to enable the search

### Managing Existing Entries
- View all configured stores and searches
- Enable/disable individual stores and searches
- Update check intervals
- Delete unwanted entries

## eBay API Setup (Optional)

For better performance and reliability, you can use the eBay API instead of web scraping:

1. Create an eBay developer account at https://developer.ebay.com
2. Create a new application to get your API credentials
3. Add the credentials to your `.env` file:
   ```
   EBAY_APP_ID=your_app_id
   EBAY_CERT_ID=your_cert_id
   EBAY_DEV_ID=your_dev_id
   EBAY_OAUTH_TOKEN=your_ebay_user_token
   ```

## Search URL Tips

When creating search URLs to monitor:

1. Use the `_sop=10` parameter to sort by newly listed
2. Add any filters you want (e.g., `LH_BIN=1` for Buy It Now)
3. Set price ranges with `_udlo` and `_udhi`
4. Add category filters with `_sacat`
5. Use `+` for spaces in search terms

Example search URL:
```
https://www.ebay.com/sch/i.html?_nkw=gaming+console&_sacat=0&_sop=10&LH_BIN=1&_udlo=100&_udhi=500
```

## Notes

- The scanner will check each store and search at its configured interval
- New items are detected by comparing against previously seen items
- Discord notifications include item title, price, condition, location 