async function searchGame(keyword) {
  try {
    const url = `https://games.roblox.com/v1/games/list?model.keyword=${encodeURIComponent(keyword)}&model.maxRows=5`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.games || data.games.length === 0) {
      return "Game tidak ditemukan!";
    }

    return data.games;
  } catch (err) {
    console.error("Error fetching Roblox API:", err);
  }
}

// Uji coba langsung:
(async () => {
  console.log('Blox Fruits:', await searchGame("Blox Fruits"));
  console.log('Fisch:', await searchGame("Fisch"));
})();
