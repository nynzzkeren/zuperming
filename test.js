async function searchRobloxGame(gameName) {
  try {
    const searchUrl = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(gameName)}&sessionId=1`;
    const res = await fetch(searchUrl);
    const data = await res.json();
    
    // Let's flatten all contents
    let allContents = [];
    if (data.searchResults) {
        for (const group of data.searchResults) {
            if (group.contents) {
                allContents = allContents.concat(group.contents);
            }
        }
    }

    return allContents.filter(c => c.rootPlaceId).slice(0, 10).map(topGame => ({
      name: topGame.name,
      universeId: topGame.targetId,
      placeId: topGame.rootPlaceId
    }));
  } catch (error) {
    console.error("Error fetching game:", error);
    return null;
  }
}

(async () => {
  console.log('Testing general terms...');
  const g = await searchRobloxGame("Simulator");
  console.log('Simulator:', g);
})();
