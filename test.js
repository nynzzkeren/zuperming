const q = 'blox fruits';

async function testDDG() {
    console.log('Testing DuckDuckGo...');
    try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=site:roblox.com/games+${encodeURIComponent(q)}`);
        const html = await res.text();
        const matches = [...html.matchAll(/roblox\.com\/games\/(\d+)\/([^<"'\s]+)/g)];
        const games = [];
        const seen = new Set();
        for (const m of matches) {
            if (!seen.has(m[1])) {
                seen.add(m[1]);
                let name = decodeURIComponent(m[2]).replace(/-/g, ' ');
                // remove trailing stuff
                if (name.includes('&')) name = name.split('&')[0];
                if (name.includes('%')) name = decodeURIComponent(name);
                games.push({ id: m[1], name });
            }
        }
        console.log('DDG Results:', games.slice(0, 5));
    } catch (e) {
        console.error('DDG Error:', e);
    }
}

async function testRoPro() {
    console.log('Testing RoPro...');
    try {
        const res = await fetch(`https://api.ropro.io/gameSearchInternal.php?q=${encodeURIComponent(q)}`);
        console.log('RoPro status:', res.status);
        const data = await res.text();
        console.log('RoPro data:', data.slice(0, 200));
    } catch (e) {
        console.error('RoPro error:', e);
    }
}

async function testRoMonitor() {
    console.log('Testing RoMonitor...');
    try {
        // rolimons uses universe id mainly, hard to search. let's just use duckduckgo.
    } catch(e) {}
}

async function run() {
    await testDDG();
    await testRoPro();
}
run();
