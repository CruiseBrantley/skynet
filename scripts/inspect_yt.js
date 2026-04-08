const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const apiKey = process.env.YOUTUBE_KEY;

if (!apiKey) {
    console.error('❌ YOUTUBE_KEY not found in .env');
    process.exit(1);
}

const videoId = process.argv[2];

if (!videoId) {
    console.log('Usage: node scripts/inspect_yt.js <videoId>');
    process.exit(1);
}

async function inspect(id) {
    console.log(`\n🔍 Inspecting Video ID: ${id}`);
    
    // 1. Query Data API
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${apiKey}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const item = data.items?.[0];
        
        if (!item) {
            console.log('❌ Video not found via API.');
            return;
        }
        
        console.log(`✅ Title: ${item.snippet.title}`);
        console.log(`✅ Channel: ${item.snippet.channelTitle}`);
        console.log('\n--- API Reported Thumbnails ---');
        console.table(Object.keys(item.snippet.thumbnails).map(key => ({
            Resolution: key,
            Width: item.snippet.thumbnails[key].width,
            Height: item.snippet.thumbnails[key].height,
            URL: item.snippet.thumbnails[key].url
        })));
        
        // 2. Test HD Waterfall Fallbacks
        console.log('\n--- Connectivity Check (Status Codes) ---');
        const patterns = [
            { name: 'maxresdefault', url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` },
            { name: 'sddefault', url: `https://i.ytimg.com/vi/${id}/sddefault.jpg` },
            { name: 'hqdefault', url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
            { name: 'mqdefault', url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
            { name: 'default', url: `https://i.ytimg.com/vi/${id}/default.jpg` },
        ];
        
        for (const p of patterns) {
            try {
                const response = await fetch(p.url, { method: 'HEAD' });
                const status = response.status;
                const emoji = status === 200 ? '✅' : '❌';
                console.log(`${emoji} ${p.name.padEnd(15)}: ${status} ${status === 200 ? '(Available)' : '(NOT Available)'}`);
            } catch (e) {
                console.log(`❌ ${p.name.padEnd(15)}: Error ${e.message}`);
            }
        }
        
        console.log('\n--- Recommendation ---');
        const best = patterns.find(async (p) => {
             // Mocking the result of our waterfall
        });
        
    } catch (err) {
        console.error(`❌ Request failed: ${err.message}`);
    }
}

inspect(videoId);
