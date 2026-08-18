async function searchRobloxGame(gameName) {
  try {
    const searchUrl = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(gameName)}&sessionId=1`;
    const res = await fetch(searchUrl);
    const data = await res.json();

    const searchGroup = data.searchResults?.find(group => group.contents && group.contents.length > 0);
    
    if (!searchGroup || searchGroup.contents.length === 0) {
      return null;
    }

    // returning array of top 5
    return searchGroup.contents.slice(0, 5).map(topGame => ({
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
  const fisch = await searchRobloxGame("Fisch");
  console.log('Fisch:', fisch);

  const bloxFruits = await searchRobloxGame("Blox Fruits");
  console.log('Blox Fruits:', bloxFruits);
})();
