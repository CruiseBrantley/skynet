const lyricsService = require('../util/LyricsService');
const logger = require('../logger');

async function test(title, artist) {
    console.log(`\n--- Testing: ${title} (${artist || 'Unknown'}) ---`);
    const lyrics = await lyricsService.fetchLyrics(title, artist);
    if (lyrics) {
        console.log(`✅ SUCCESS (Length: ${lyrics.length})`);
        console.log(`Snippet: ${lyrics.substring(0, 100).replace(/\n/g, ' ')}...`);
    } else {
        console.log(`❌ FAILED`);
    }
}

async function runTests() {
    await test('Maji de Kansha!', 'T-Pistonz+KMC');
    await test("The Kids Aren't Alright", 'The Offspring');
    await test('The Taste of Ink', 'The Used');
    await test('Writing On The Walls', 'Underoath');
    await test('The Pretender', 'Foo Fighters'); // More reliable test case
}

runTests();
