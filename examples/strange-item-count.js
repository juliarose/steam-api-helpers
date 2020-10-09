const createSteamAPI = require('steam-api-helpers');
const API_KEY = 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
// pass your api key to the function
const { getBackpack } = createSteamAPI(API_KEY);

async function getTF2Inventory(steamid) {
    return getBackpack('440', steamid);
}

(async function() {
    const steamid = '76561198080179568';
    
    try {
        const backpack = await getTF2Inventory(steamid);
        // get all the strange items in the backpack
        const strangeItems = backpack.items.filter((item) => {
            return item.quality === 11;
        });
        
        if (strangeItems.length === 0) {
            console.log('You don\'t have any strange items in your inventory!');
        } else {
            console.log(`You have ${strangeItems.length} strange items in your inventory`);
        }
    } catch (e) {
        console.log('Backpack failed to load', e.message);
    }
}());
