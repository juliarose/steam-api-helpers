'use strict';

const { getJSON } = require('./requests');
const { uniq, promiseSeries, reduceChunk, groupBy, indexBy, sleep } = require('./utils');

/**
 * Converts array-like objects into arrays on classinfo response.
 * @private
 * @param {ClassInfo} Classinfo - Classinfo.
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
            return Promise.reject(new Error(`No classinfo for "${classid}"`));
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
            return Promise.reject(new Error('No items in response object'));
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
    
    return {
        getAssetClassInfo,
        getAssetClassInfos,
        getBackpack,
        getInventory
    };
}

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
 * Inventory.
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
