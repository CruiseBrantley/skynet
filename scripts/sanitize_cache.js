const fs = require('fs');
const path = require('path');

const cachePath = path.join(__dirname, '../metadata_cache.json');

if (!fs.existsSync(cachePath)) {
    console.log('❌ No metadata_cache.json found.');
    process.exit(0);
}

try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const cache = JSON.parse(raw);
    let count = 0;

    console.log(`📂 Loaded cache with ${Object.keys(cache).length} entries.`);

    // Regex to match low-res placeholders and numbered frames
    const lowResRegex = /\/(default|mqdefault|hqdefault|sddefault|[0-3])\.jpg/;

    for (const id in cache) {
        const entry = cache[id];
        if (entry.thumbnail && entry.thumbnail.includes('ytimg.com')) {
            if (lowResRegex.test(entry.thumbnail) && !entry.thumbnail.includes('maxresdefault')) {
                const upgraded = entry.thumbnail.replace(lowResRegex, '/maxresdefault.jpg');
                console.log(`✨ Upgrading [${id}]: ${entry.thumbnail} -> ${upgraded}`);
                entry.thumbnail = upgraded;
                count++;
            }
        }
    }

    if (count > 0) {
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
        console.log(`\n🎉 Successfully sanitized ${count} legacy thumbnail entries!`);
    } else {
        console.log('\n✅ No legacy thumbnails found needing upgrade.');
    }
} catch (err) {
    console.error(`❌ Sanitization failed: ${err.message}`);
}
