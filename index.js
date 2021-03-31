'use strict';

const { getJSON } = require('./requests');
const { uniq, promiseSeries, reduceChunk, groupBy, indexBy, sleep } = require('./utils');

/**
 * Converts array-like objects into arrays on classinfo response. This modifies the original object.
 * @private
 * @param {ClassInfo} classinfo - Classinfo.
 * @returns {ClassInfo} Classinfo.
 */
function fixClassInfo(classinfo) {
    [
        'actions',
        'market_actions',
        'tags',
        'descriptions'
    ].forEach((key) => {
        if (classinfo[key]) {
            classinfo[key] = Object.values(classinfo[key]);
        }
    });
    
    return classinfo;
}

/**
 * Merges the descriptions to the items in the trade. This modifies the original object.
 * @private
 * @param {TradeHistoryResponse} response - Trade history response.
 * @returns {ClassInfo} Classinfo.
 */
function mergeTradeHistoryResponseDescriptions(response) {
    // adds descriptions to the trade item
    function withDescriptions(items) {
        return items.map((item) => {
            const classinfo = (
                table[item.appid] &&
                table[item.appid][item.classid]
            ) || {};
            
            // combine them
            return {
                ...item,
                ...classinfo
            };
        });
    }
    
    const table = Object.entries(groupBy(response.descriptions, 'appid'))
        .reduce((table, [appid, classinfo]) => {
            table[appid] = indexBy(classinfo, 'classid');
            
            return table;
        }, {});
    
    // merge the descriptions onto each asset
    response.trades = response.trades.map((trade) => {
        if (trade.assets_given !== undefined) {
            trade.assets_given = withDescriptions(trade.assets_given);
        }
        
        if (trade.assets_received !== undefined) {
            trade.assets_received = withDescriptions(trade.assets_received);
        }
        
        return trade;
    });
    
    // these are no longer needed
    delete response.descriptions;
    
    return response;
}

/**
 * Interface for Steam API.
 * @typedef {object} SteamAPI
 */

/**
 * Creates an interface for making requests to the Steam API.
 * @module createSteamAPI
 * @param {string} apiKey - API key to use for requests.
 * @returns {SteamAPI} SteamAPI interface.
 */
module.exports = function createSteamAPI(apiKey) {
    const API_HOSTNAME = 'api.steampowered.com';
    const COMMUNITY_HOSTNAME = 'steamcommunity.com';
    
    /**
     * Gets backpack for user.
     * @memberof SteamAPI
     * @param {string} uri - Request url.
     * @param {object} [options={}] - Any options to send to request as parameters.
     * @returns {Promise.<object>} Resolves with the inventory for this user.
     */
    async function request(uri, options) {
        return getJSON({
            method: 'GET',
            uri,
            qs: {
                key: apiKey,
                ...options
            }
        });
    }
    
    /**
     * Gets player summaries for given steamids.
     * @memberof SteamAPI
     * @param {string[]} steamids - Steam IDs.
     * @param {string} [format='json'] - Format.
     * @returns {Promise.<PlayerSummary[]>} Resolves with player summaries.
     */
    async function getPlayerSummaries(steamids, format = 'json') {
        const response = await getJSON({
            method: 'GET',
            uri: `https://${API_HOSTNAME}/ISteamUser/GetPlayerSummaries/v0002`,
            qs: {
                steamids,
                format,
                key: apiKey
            }
        });
        
        if (!response.response) {
            throw new Error('No response.');
        }
        
        return response.response.players;
    }
    
    /**
     * Gets classinfo for a classid.
     * @memberof SteamAPI
     * @param {string} appid - Appid.
     * @param {string} classids - Classid.
     * @param {object} [options={}] - Any additional options to send to request as parameters.
     * @returns {Promise.<ClassInfo>} Resolves with classinfo.
     */
    async function getAssetClassInfo(appid, classid, options = {}) {
        const response = await getJSON({
            method: 'GET',
            uri: `https://${API_HOSTNAME}/ISteamEconomy/GetAssetClassInfo/v0001`,
            qs: {
                appid,
                class_count: 1,
                classid0: classid,
                key: apiKey,
                ...options
            }
        });
        
        // only get the classinfo for this classid
        const classinfo = (
            response.result &&
            response.result[classid]
        );
        
        if (!classinfo) {
            throw new Error(`No classinfo for "${classid}"`);
        }
        
        return fixClassInfo(classinfo);
    }
    
    /**
     * Gets classinfo for an array of classids.
     * @memberof SteamAPI
     * @param {string} appid - Appid.
     * @param {string[]} classids - Classids.
     * @param {object} [options={}] - Any additional options to send to request as parameters.
     * @returns {Promise.<ClassInfoContainer>} Resolves with object containing classinfos.
     */
    async function getAssetClassInfos(appid, classids, options = {}) {
        // performs the request for a group of classids
        async function getAssetClassInfoRequest(classids) {
            // create an object map of all classids
            // e.g. { classid0: 1, classid1: 2 } 
            const classidsMap = classids.reduce((total, classid, i) => {
                total['classid' + i] = classid;
                
                return total;
            }, {});
            
            return getJSON({
                method: 'GET',
                uri: `https://${API_HOSTNAME}/ISteamEconomy/GetAssetClassInfo/v0001`,
                qs: {
                    appid,
                    key: apiKey,
                    class_count: classids.length,
                    ...classidsMap,
                    ...options
                }
            });
        }
        
        // get classids in a series of requests
        const series = uniq(classids)
            // split the classids into chunks of 20
            .reduce(reduceChunk(20), [])
            .map((chunk) => {
                return async () => {
                    const response = await getAssetClassInfoRequest(chunk);
                    const { result } = response;
                    // we don't need it
                    delete result.success;
                    // add some space between requests
                    await sleep(2000);
                    
                    return Object.entries(result)
                        .reduce((classinfo, [classid, value]) => {
                            classinfo[classid] = fixClassInfo(value);
                            
                            return classinfo;
                        }, {});
                };
            });
        // get all apps in series
        const responses = await promiseSeries(series);
        
        // merge the responses togeher
        return responses.reduce((total, response) => {
            return Object.assign(total, response);
        }, {});
    }
    
    /**
     * Gets backpack for user.
     * @memberof SteamAPI
     * @static
     * @promise getBackpackPromise
     * @fulfills {Backpack} The backpack for this user..
     * @param {string} appid - Appid.
     * @param {string} steamid - Steamid.
     * @param {object} [options={}] - Any additional options to send to request as parameters.
     * @returns {Promise.<Backpack>} Resolves with the backpack for this user.
     */
    async function getBackpack(appid, steamid, options = {}) {
        const response = await getJSON({
            method: 'GET',
            uri: `https://${API_HOSTNAME}/IEconItems_${appid}/GetPlayerItems/v0001/`,
            qs: {
                SteamID: steamid,
                key: apiKey,
                ...options
            }
        });
        
        const backpack = response.result;
        const hasItems = Boolean(
            backpack &&
            backpack.items
        );
        
        if (!hasItems) {
            throw new Error('No items in response object');
        }
        
        return backpack;
    }
    
    /**
     * Gets backpack for user.
     * @memberof SteamAPI
     * @param {string} appid - Appid.
     * @param {string} contextid - Contextid.
     * @param {string} steamid - Steamid.
     * @param {object} [options={}] - Any additional options to send to request as parameters.
     * @returns {Promise.<Inventory>} Resolves with the inventory for this user.
     */
    async function getInventory(appid, contextid, steamid, options = {}) {
        const response = await getJSON({
            method: 'GET',
            uri: `https://${COMMUNITY_HOSTNAME}/inventory/${steamid}/${appid}/${contextid}`,
            qs: {
                l: 'english',
                count: 5000,
                ...options
            }
        });
        const { assets, descriptions } = response;
        // create description look-up table
        // e.g.
        // {
        //     classid: {
        //         instanceid: {
        //             ... 
        //         }
        //     }
        // }
        const classinfos = Object.entries(groupBy(descriptions, 'classid'))
            .reduce((classinfo, [classid, value]) => {
                classinfo[classid] = indexBy(value, 'instanceid');
                
                return classinfo;
            }, {});
       
       // combine the items with descriptions
       return assets.map((item) => {
           // find the description
           const description = (
               classinfos[item.classid] &&
               classinfos[item.classid][item.instanceid]
           );
           
           // combine
           return {
               ...item,
               ...description
           };
       });
    }
    
    /**
     * Gets backpack for user.
     * @memberof SteamAPI
     * @param {string} appid - Appid.
     * @param {string} ugcid - Ugcid.
     * @param {string} [steamid] - Steamid.
     * @param {object} [options={}] - Any additional options to send to request as parameters.
     * @returns {Promise.<UGCFileDetailsResponse>} Resolves with the UGC details for this item.
     */
    async function getUGCFileDetails(appid, ugcid, steamid, options = {}) {
        const response = await getJSON({
            method: 'GET',
            uri: `https://${API_HOSTNAME}/ISteamRemoteStorage/GetUGCFileDetails/v1/`,
            qs: {
                steamid,
                appid,
                ugcid,
                key: apiKey,
                ...options
            }
        });
        
        if (response.status && response.status.code === 9) {
            throw new Error('Given ID not found.')
        }
        
        if (!response.data) {
            throw new Error('No response data.');
        }
        
        return response.data;
    }
    
    /**
     * Gets your trade history.
     * @memberof SteamAPI
     * @param {object} [options={}] - Any options to send to request as parameters.
     * @param {number} [options.max_trades] - The number of trades to return information for.
     * @param {number} [options.start_after_time] - The time of the last trade shown on the previous page of results, or the time of the first trade if navigating back.
     * @param {number} [options.start_after_tradeid] - The tradeid shown on the previous page of results, or the ID of the first trade if navigating back.
     * @param {number} [options.navigating_back] - The user wants the previous page of results, so return the previous max_trades trades before the start time and ID.
     * @param {number} [options.get_descriptions] - If set, the item display data for the items included in the returned trades will also be returned.
     * @param {number} [options.language] - The language to use when loading item display data.
     * @param {number} [options.include_failed] - Include failed trades.
     * @param {number} [options.include_total] - If set, the total number of trades the account has participated in will be included in the response.
     * @param {boolean} [options.combine_descriptions] - 	If set, merge descriptions in response with items.
     * @returns {Promise.<TradeHistoryResponse>} Resolves with the trade history results for given query.
     */
    async function getTradeHistory(options = {}) {
        // copy the options so we do not modify the original object
        const params = {
            ...options
        };
        const { combine_descriptions } = params;
        
        // this is not passed to the request
        delete params.combine_descriptions;
        
        const response = await getJSON({
            method: 'GET',
            uri: `https://${API_HOSTNAME}/IEconService/GetTradeHistory/v1/`,
            qs: {
                key: apiKey,
                ...params
            }
        });
        
        if (!response.response) {
            throw new Error('No response data.');
        }
        
        if (combine_descriptions) {
            return mergeTradeHistoryResponseDescriptions(response.response);
        }
        
        // data is in response
        return response.response;
    }
    
    return {
        request,
        getPlayerSummaries,
        getAssetClassInfo,
        getAssetClassInfos,
        getBackpack,
        getInventory,
        getUGCFileDetails,
        getTradeHistory
    };
}

/**
 * Player summary.
 * @typedef {object} PlayerSummary
 * @property {string} steamid - 64bit SteamID of the user.
 * @property {string} personaname - The player's persona name (display name).
 * @property {string} profileurl - The full URL of the player's Steam Community profile.
 * @property {string} avatar - The full URL of the player's 32x32px avatar. If the user hasn't configured an avatar, this will be the default ? avatar.
 * @property {string} avatarmedium - The full URL of the player's 64x64px avatar. If the user hasn't configured an avatar, this will be the default ? avatar.
 * @property {string} avatarfull - The full URL of the player's 184x184px avatar. If the user hasn't configured an avatar, this will be the default ? avatar.
 * @property {number} personastate - The user's current status. 0 - Offline, 1 - Online, 2 - Busy, 3 - Away, 4 - Snooze, 5 - looking to trade, 6 - looking to play. If the player's profile is private, this will always be "0", except is the user has set his status to looking to trade or looking to play, because a bug makes those status appear even if the profile is private.
 * @property {number} communityvisibilitystate - This represents whether the profile is visible or not, and if it is visible, why you are allowed to see it. Note that because this WebAPI does not use authentication, there are only two possible values returned: 1 - the profile is not visible to you (Private, Friends Only, etc), 3 - the profile is "Public", and the data is visible. Mike Blaszczak's post on Steam forums says, "The community visibility state this API returns is different than the privacy state. It's the effective visibility state from the account making the request to the account being viewed given the requesting account's relationship to the viewed account."
 * @property {number} profilestate - If set, indicates the user has a community profile configured (will be set to '1')
 * @property {number} lastlogoff - The last time the user was online, in unix time.
 * @property {number} commentpermission - If set, indicates the profile allows public comments.
 * @property {string} [realname] - The player's "Real Name", if they have set it.
 * @property {string} [primaryclanid] - The player's primary group, as configured in their Steam Community profile.
 * @property {number} [timecreated] - The time the player's account was created.
 * @property {string} [gameid] - If the user is currently in-game, this value will be returned and set to the gameid of that game.
 * @property {string} [gameserverip] - The ip and port of the game server the user is currently playing on, if they are playing on-line in a game using Steam matchmaking. Otherwise will be set to "0.0.0.0:0".
 * @property {string} [gameextrainfo] - If the user is currently in-game, this will be the name of the game they are playing. This may be the name of a non-Steam game shortcut.
 * @property {number} [cityid] - This value will be removed in a future update (see loccityid).
 * @property {string} [loccountrycode] - If set on the user's Steam Community profile, The user's country of residence, 2-character ISO country code.
 * @property {number} [locstatecode] - If set on the user's Steam Community profile, The user's state of residence.
 * @property {number} [loccityid] - An internal code indicating the user's city of residence. A future update will provide this data in a more useful way.
 */

/**
 * Definition for an item class.
 * @typedef {object} ClassInfo
 * @property {string} classid - Classid.
 * @property {string} [instanceid] - Instanceid.
 * @property {string} [type] - Type.
 * @property {string} icon_url - Icon URL.
 * @property {string} icon_url_large - Large Icon URL.
 * @property {string} name - Name.
 * @property {string} market_name - Market name.
 * @property {string} market_hash_name - Market hash name.
 * @property {string} background_color - Background color.
 * @property {string} name_color - Name color.
 * @property {string} fraudwarnings - Fraud warnings.
 * @property {(string|number)} currency - Currency.
 * @property {(string|number)} tradable - Tradable.
 * @property {(string|number)} commodity - Commodity.
 * @property {(string|number)} marketable - Marketable.
 * @property {string} market_tradable_restriction - Market tradable restriction.
 * @property {string} market_marketable_restriction - Market marketable restriction.
 * @property {ClassInfoAction[]} actions - Actions.
 * @property {ClassInfoAction[]} market_actions - Market actions.
 * @property {ClassInfoDescription[]} [descriptions] - Descriptions.
 * @property {ClassInfoTag[]} [tags] - Tags.
 * @property {object} [appdata] - App data.
 */

/**
 * An action belonging to a classinfo.
 * @typedef {object} ClassInfoAction
 * @property {string} name - Name.
 * @property {string} link - Link.
 */

/**
 * A description belonging to a classinfo.
 * @typedef {object} ClassInfoDescription
 * @property {string} type - Type.
 * @property {string} value - Value.
 * @property {object} app_data - App data.
 * @property {string} [color] - Color.
 */

/**
 * A tag belonging to a classinfo.
 * @typedef {object} ClassInfoTag
 * @property {string} internal_name - Internal name.
 * @property {string} name - Name.
 * @property {string} category - Category.
 * @property {string} category_name - Category name.
 * @property {string} [color] - Color.
 */

/**
 * An object whose values are ClassInfo.
 * @typedef {object.<string, ClassInfo>} ClassInfoContainer
 */

/**
 * Attributes for a backpack item.
 * @typedef {object} BackpackItemAttribute
 * @property {number} defindex - Defindex.
 * @property {number} value - Value.
 * @property {number} float_value - Float value.
 * @property {BackpackItemAttribute[]} attributes - Attributes.
 */

/**
 * A user's backpack.
 * @typedef {object} Backpack
 * @property {BackpackItem[]} items - Array of items.
 * @property {number} status -  Status of request.
 * @property {number} num_backpack_items - Number of backpack items.
 */
 
/**
 * An item from a backpack.
 * @typedef {object} BackpackItem
 * @property {number} id - ID.
 * @property {number} original_id - Original ID.
 * @property {number} defindex - Defindex.
 * @property {number} level - Level.
 * @property {number} quality - Quality.
 * @property {number} inventory - Inventory.
 * @property {number} quantity - Quantity.
 * @property {number} origin - Origin.
 * @property {boolean} flag_cannot_trade - Whether the item can be traded or not.
 * @property {boolean} flag_cannot_craft - Whether the item can be crafted or not.
 * @property {BackpackItemAttribute[]} attributes - Attributes.
 */

/**
 * A user's inventory.
 * @typedef {InventoryItem[]} Inventory
 */

/**
 * An item from a user's inventory.
 * @typedef {ClassInfo} InventoryItem
 * @property {number} appid - Appid.
 * @property {string} contextid - Contextid.
 * @property {string} assetid - Assetid.
 * @property {string} instanceid - Instanceid.
 * @property {string} amount - Amount.
 */

/**
 * UGC file details.
 * @typedef {object} UGCFileDetailsResponse
 * @property {number} [status] - Status.
 * @property {string} [filename] - Filename.
 * @property {string} [url] - URL.
 * @property {number} [size] - Size.
 */
 
 /**
  * A trade from your trade history.
  * @typedef {object} TradeHistoryTradeItem
  * @property {number} appid - Appid.
  * @property {string} contextid - Contextid.
  * @property {string} assetid - Assetid.
  * @property {string} amount - Amount.
  * @property {string} classid - Classid.
  * @property {string} instanceid - Instanceid.
  * @property {string} new_assetid - New assetid.
  * @property {string} new_contextid - New contextid.
  */
 
 /**
  * A trade from your trade history.
  * @typedef {object} TradeHistoryTrade
  * @property {string} tradeid - Tradeid.
  * @property {string} steamid_other - The steamid of the other trader.
  * @property {number} time_init - Time of trade.
  * @property {number} status - Trade status.
  * @property {TradeHistoryTradeItem[]} [assets_received] - Items received.
  * @property {TradeHistoryTradeItem[]} [assets_given] - Items given.
  */

/**
 * Trade history details.
 * @typedef {object} TradeHistoryResponse
 * @property {TradeHistoryTrade[]} trades - Trades.
 * @property {boolean} more - Whether there are more results or not.
 * @property {ClassInfo[]} [descriptions] - Array of classinfos for items.
 * @property {string} [url] - URL.
 */
 
