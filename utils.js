'use strict';

/**
 * Executes a series of Promises in sequence.
 * @param {Array} funcs - An array of functions where each function returns a Promise.
 * @returns {Promise<Array>} Promise that resolves with an array containing results from each resolved Promise in series.
 * 
 * @example
 * const urls = ['/url1', '/url2', '/url3'];
 * promiseSeries(urls.map(url => () => $.ajax(url)))
 *     .then(response => console.log(response));
 */
function promiseSeries(funcs) {
    // derived from, with some modifications to functionality
    // - all previous resolved values in passed to next resolve in series
    // - but there's a catch
    // https://stackoverflow.com/questions/24586110/resolve-promises-one-after-another-i-e-in-sequence/41115086#41115086
    function concat(list) {
        return Array.prototype.concat.bind(list);
    }
    
    function promiseConcat(func) {
        // resolves is an array of values from each resolve
        return function(resolves) {
            // pass resolves array to function
            return func(resolves)
                .then(concat(resolves))
                .catch(error => Promise.reject(error));
        };
    }
    
    function promiseReduce(chain, func) {
        return chain
            .then(promiseConcat(func))
            .catch(error => Promise.reject(error));
    }
    
    return funcs.reduce(promiseReduce, Promise.resolve([]));
}

/**
 * Gets unique values from array.
 * @param {Array} arr - Array of items.
 * @param {(String|function)} [filter] - String or function to filter by.
 * @returns {Array} Array with unique values.
 */
function uniq(arr, filter) {
    if (filter === undefined) {
        // primitive uniq method
        return [...new Set(arr)];
    }
    
    const filterIsFunction = typeof filter === 'function';
    // for storing values
    let valueList = {};
    
    return arr.filter((item, i, array) => {
        const value = (
            // the filter is a function
            filterIsFunction ?
            filter(item, i, array) :
            // the filter is a string
            item[filter]
        );
        
        // the value for this item already exists
        if (valueList[value]) {
            return false;
        }
        
        // store the value
        valueList[value] = true;
        
        return true;
    });
}

/**
 * Returns a function to pass to reduce to chunk array.
 * @param {number} chunksize- The chunksize to break array down.
 * @returns {function} Reduce function.
 */
function reduceChunk(chunksize) {
    return function(total, item) {
        let currentIndex = total.length - 1;
        // whether a new chunk should be started or not
        const shouldStartNewChunk = Boolean(
            // array is empty
            currentIndex === -1 ||
            total[currentIndex].length >= chunksize
        );
        
        if (shouldStartNewChunk) {
            // add an empty array
            total.push([]);
            // add to the index
            currentIndex += 1;
        }
        
        // add the current item to the array
        total[currentIndex].push(item);
        
        return total;
    }
}

/**
 * Groups an array by value from key.
 * @param {Array} arr - Array.
 * @param {(String|Function)} key - Key to take value from.
 * @returns {Object} Object of groups.
 */
function groupBy(arr, key) {
    // if 'key' is a function, set method to 'key'
    const fn = typeof key === 'function' ? key : null;
    
    return arr.reduce((group, item, i) => {
        const value = fn ? fn(item, i) : item[key];
        
        (group[value] = group[value] || []).push(item);
        
        return group;
    }, {});
}

/**
 * Indexes an array by value from key.
 * @param {Array} arr - Array.
 * @param {(String|Function)} key - Key to take value from.
 * @returns {Object} Indexed object.
 */
function indexBy(arr, key) {
    // if 'key' is a function, set method to 'key'
    const fn = typeof key === 'function' ? key : null;
    
    return arr.reduce((group, item, i) => {
        const value = fn ? fn(item, i) : item[key];
        
        if (group[value] === undefined) {
            group[value] = item;
        }
        
        return group;
    }, {});
}

/**
 * Sleeps for a set amount of time.
 * @param {number} time - Time in milliseconds to sleep.
 */
async function sleep(time) {
    return new Promise((resolve) => {
        setTimeout(resolve, time);
    });
}

module.exports = {
    promiseSeries,
    uniq,
    reduceChunk,
    groupBy,
    indexBy,
    sleep
};
